// ============================================================
// DISPOSITIVOS CONECTADOS + MODO ESPERA — StackOS
// ------------------------------------------------------------
// 1) Cada aba aberta do sistema avisa o banco que está viva (a cada 45s):
//    quem é o operador, que navegador, última vez que alguém mexeu nela.
// 2) MODO ESPERA: aba sem ninguém mexer há X minutos (padrão 30, Config →
//    Segurança) mostra "Este computador está em espera" e PARA DE GRAVAR no
//    banco. A fila de pendências fica guardada; ao clicar, envia o que tiver
//    e recarrega tudo do banco (dados frescos).
//    Nunca entra em espera:
//      - aba que abriu a TV (janela da TV aberta);
//      - aba que controla o relógio de um torneio rodando (opção "Travar relógio");
//      - sem a trava do relógio: se há torneio rodando aqui e nenhuma OUTRA
//        máquina do clube está acordada (alguém precisa continuar o relógio);
//      - enquanto houver pendência ainda não enviada.
// 3) Painel "Dispositivos conectados" (admin/gerente): lista as abas e permite
//    DESCONECTAR uma à distância (ela entra em espera na hora em que receber).
// Não altera cálculo nenhum. O único ponto no app.html é sincronizarEstado()
// respeitar window._stackEspera.
// ============================================================
(function () {
    'use strict';
    if (window.__stackDispositivos) return;
    window.__stackDispositivos = true;

    const HEARTBEAT_MS = 45 * 1000;
    const ONLINE_MS = 3 * 60 * 1000;
    const PADRAO_MIN = 30;

    // Mesma identidade por aba usada pela trava do relógio
    let deviceId = null;
    try { deviceId = sessionStorage.getItem('ps_relogio_device_id'); } catch (_) {}
    if (!deviceId) {
        deviceId = 'dev-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        try { sessionStorage.setItem('ps_relogio_device_id', deviceId); } catch (_) {}
    }

    let ultimaAtividade = Date.now();
    let abertoEm = Date.now();
    let emEspera = false;
    let motivoEspera = null;        // 'inativo' | 'remoto'
    let desconectadoPor = null;
    let ultimoDesconectarVisto = null;
    let outros = [];                // dispositivos do clube (último heartbeat)
    let hbTimer = null;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const toast = (m) => { try { showToast(m); } catch (_) {} };
    const clube = () => { try { return window.sbClube || (typeof sbClube !== 'undefined' ? sbClube : null); } catch (_) { return null; } };
    const usuario = () => { try { return typeof currentUser !== 'undefined' ? currentUser : null; } catch (_) { return null; } };
    const pronto = () => !!(clube() && clube().id && usuario() && typeof sb !== 'undefined' && !window._modoSuporte);
    const ehGestor = () => { const u = usuario(); return !!(u && (['admin', 'gerente'].includes(u.role) || ['admin', 'gerente'].includes(u.papel) || window._isSuperAdmin)); };
    const minutosEspera = () => {
        try {
            const v = clube() && clube().config ? clube().config.espera_min : undefined;
            if (v === 0 || v === '0') return 0;
            const n = Number(v);
            return (isFinite(n) && n > 0) ? n : PADRAO_MIN;
        } catch (_) { return PADRAO_MIN; }
    };

    function descricaoDispositivo() {
        const ua = navigator.userAgent || '';
        const nav = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
        const so = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
        return nav + (so ? ' · ' + so : '');
    }

    // ---------- Atividade do operador ----------
    let ultimoMove = 0;
    function marcarAtividade() { if (!emEspera) ultimaAtividade = Date.now(); }
    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => window.addEventListener(ev, marcarAtividade, { capture: true, passive: true }));
    window.addEventListener('mousemove', () => { const a = Date.now(); if (a - ultimoMove > 5000) { ultimoMove = a; marcarAtividade(); } }, { capture: true, passive: true });

    // ---------- Heartbeat ----------
    async function heartbeat() {
        if (!pronto()) return;
        const u = usuario();
        const row = {
            device_id: deviceId,
            clube_id: clube().id,
            user_id: u.id || null,
            operador_nome: u.nome || 'Operador',
            dispositivo: descricaoDispositivo(),
            ultima_atividade: new Date(ultimaAtividade).toISOString(),
            heartbeat_em: new Date().toISOString(),
            em_espera: emEspera,
            aberto_em: new Date(abertoEm).toISOString(),
        };
        try {
            const { data, error } = await sb.from('dispositivos_sessao').upsert(row).select('desconectar_em, desconectar_por').single();
            if (error) { console.warn('[DISPOSITIVOS] heartbeat:', error.message); return; }
            // Pedido de desconexão feito DEPOIS que esta aba abriu/voltou → entra em espera
            if (data && data.desconectar_em) {
                const ts = new Date(data.desconectar_em).getTime();
                if (ts > abertoEm && ts !== ultimoDesconectarVisto) {
                    ultimoDesconectarVisto = ts;
                    desconectadoPor = data.desconectar_por || 'o administrador';
                    entrarEspera('remoto');
                }
            }
        } catch (e) { console.warn('[DISPOSITIVOS] heartbeat:', e); }
        try {
            const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
            const { data: lista } = await sb.from('dispositivos_sessao').select('*').eq('clube_id', clube().id).gte('heartbeat_em', desde).order('heartbeat_em', { ascending: false });
            outros = lista || [];
            const aba = document.getElementById('cfg-seguranca');
            if (aba && aba.offsetParent !== null) renderLista(true);
        } catch (_) {}
    }

    // ---------- Pode entrar em espera? ----------
    function pendencias() { try { return typeof _contarPendencias === 'function' ? _contarPendencias() : 0; } catch (_) { return 0; } }
    function torneiosRodando() {
        try { return (typeof torneios !== 'undefined' && torneios ? torneios : []).filter(t => t && t.rodando && !['finished', 'encerrado', 'cancelado'].includes(String(t.status || ''))); } catch (_) { return []; }
    }
    function outraMaquinaAcordada() {
        const agora = Date.now();
        // Acordada = com sinal, fora da espera e USADA há pouco (duas máquinas paradas não
        // "contam uma com a outra" e dormem juntas deixando o relógio sem ninguém)
        const janela = Math.max(1, minutosEspera()) * 60 * 1000;
        return outros.some(d => d.device_id !== deviceId && !d.em_espera
            && (agora - new Date(d.heartbeat_em).getTime()) < ONLINE_MS
            && (agora - new Date(d.ultima_atividade || 0).getTime()) < janela);
    }
    function motivoParaFicarAcordado() {
        try { if (typeof tvWindow !== 'undefined' && tvWindow && !tvWindow.closed) return 'tv'; } catch (_) {}
        if (pendencias() > 0) return 'pendencias';
        const rodando = torneiosRodando();
        if (!rodando.length) return null;
        const travaRelogio = !!(clube() && clube().config && clube().config.relogio_controle);
        if (travaRelogio && window._relogioCtrl && window._relogioCtrl.ctrl) {
            const meu = rodando.some(t => { const r = window._relogioCtrl.ctrl.get(t.id); return !r || r.device_id === deviceId; });
            return meu ? 'relogio' : null;
        }
        return outraMaquinaAcordada() ? null : 'ultima_maquina';
    }

    function verificarInatividade() {
        if (emEspera || !pronto()) return;
        const min = minutosEspera();
        if (!min) return;
        if (Date.now() - ultimaAtividade < min * 60 * 1000) return;
        if (motivoParaFicarAcordado()) return;
        entrarEspera('inativo');
    }

    // ---------- Entrar / sair da espera ----------
    function entrarEspera(motivo) {
        if (emEspera && motivoEspera === motivo) return;
        emEspera = true;
        motivoEspera = motivo;
        window._stackEspera = true;
        console.log('[DISPOSITIVOS] 💤 Em espera (' + motivo + ') — este computador não grava até voltar a ser usado');
        mostrarFaixa();
        heartbeat();
    }

    async function sairEspera() {
        const ov = document.getElementById('stack-espera-ov');
        const msg = ov && ov.querySelector('#stack-espera-msg');
        if (msg) msg.textContent = 'Atualizando os dados…';
        window._stackEspera = false;
        emEspera = false;
        ultimaAtividade = Date.now();
        // Envia o que estiver na fila (nada se perde) antes de recarregar
        try {
            if (pendencias() > 0 && typeof sincronizarEstado === 'function' && (typeof dbOnline === 'undefined' || dbOnline)) {
                await sincronizarEstado();
                const limite = Date.now() + 15000;
                while (pendencias() > 0 && Date.now() < limite) await new Promise(r => setTimeout(r, 500));
            }
        } catch (e) { console.warn('[DISPOSITIVOS] envio antes de recarregar:', e); }
        if (pendencias() > 0) {
            // Sem conexão: não recarrega (as pendências continuam guardadas e saem quando a internet voltar)
            if (ov) ov.remove();
            toast('⚠️ Sem conexão: o computador voltou, mas os dados só atualizam quando a internet voltar');
            return;
        }
        try { await heartbeat(); } catch (_) {}
        location.reload();
    }

    function mostrarFaixa() {
        let ov = document.getElementById('stack-espera-ov');
        if (ov) ov.remove();
        ov = document.createElement('div');
        ov.id = 'stack-espera-ov';
        ov.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(9,9,11,.82);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:16px;cursor:pointer;';
        const remoto = motivoEspera === 'remoto';
        const titulo = remoto ? 'Este computador foi desconectado' : 'Este computador está em espera';
        const texto = remoto
            ? 'Desconectado à distância por <b>' + esc(desconectadoPor) + '</b>. Enquanto estiver assim, ele não grava nada no sistema.'
            : 'Ninguém mexe nele há mais de ' + minutosEspera() + ' minutos. Enquanto estiver em espera, ele não grava nada no sistema.';
        ov.innerHTML = '<div style="background:#18181b;border:1px solid #3f3f46;border-radius:14px;max-width:440px;width:100%;padding:22px 20px;color:#e4e4e7;font-family:inherit;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5)">' +
            '<div style="font-size:34px;line-height:1;margin-bottom:10px">' + (remoto ? '🔌' : '💤') + '</div>' +
            '<div style="font-weight:800;font-size:18px;margin-bottom:8px">' + titulo + '</div>' +
            '<div style="font-size:14px;line-height:1.5;color:#a1a1aa">' + texto + '</div>' +
            '<button id="stack-espera-btn" style="margin-top:16px;padding:11px 18px;border-radius:9px;border:0;background:#f5d572;color:#111;font-weight:800;font-size:14px;cursor:pointer">Clique para continuar</button>' +
            '<div id="stack-espera-msg" style="margin-top:10px;font-size:12px;color:#71717a">Ao continuar, os dados são recarregados do sistema.</div></div>';
        document.body.appendChild(ov);
        let indo = false;
        ov.addEventListener('click', (e) => { e.stopPropagation(); if (indo) return; indo = true; sairEspera(); }, true);
    }

    // ---------- Painel "Dispositivos conectados" (Config → Segurança) ----------
    function tempoRel(iso) {
        if (!iso) return '—';
        const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
        if (s < 60) return 'agora';
        const m = Math.round(s / 60);
        if (m < 60) return 'há ' + m + ' min';
        const h = Math.floor(m / 60);
        if (h < 24) return 'há ' + h + 'h' + (m % 60 ? String(m % 60).padStart(2, '0') : '');
        return 'há ' + Math.floor(h / 24) + ' dia(s)';
    }
    function statusDe(d) {
        const semSinal = Date.now() - new Date(d.heartbeat_em).getTime();
        if (semSinal > ONLINE_MS) return { txt: 'Fechado / sem sinal', cor: '#71717a', bg: 'rgba(113,113,122,.12)' };
        if (d.em_espera) return { txt: 'Em espera', cor: '#93c5fd', bg: 'rgba(59,130,246,.12)' };
        const parado = Date.now() - new Date(d.ultima_atividade || d.heartbeat_em).getTime();
        if (parado > 10 * 60 * 1000) return { txt: 'Aberto, sem uso', cor: '#fcd34d', bg: 'rgba(245,158,11,.12)' };
        return { txt: 'Em uso', cor: '#86efac', bg: 'rgba(34,197,94,.12)' };
    }
    function controlaRelogio(id) {
        try {
            if (!window._relogioCtrl || !window._relogioCtrl.ctrl) return [];
            const nomes = [];
            window._relogioCtrl.ctrl.forEach((r, tid) => {
                if (r.device_id !== id) return;
                const t = (torneios || []).find(x => x.id === tid);
                if (t && !['finished', 'encerrado'].includes(String(t.status || ''))) nomes.push(t.nome);
            });
            return nomes;
        } catch (_) { return []; }
    }

    let ultimoRenderLista = 0;
    function renderLista(forcar) {
        const box = document.getElementById('cfg-disp-lista');
        if (!box) return;
        if (!outros.length) { box.innerHTML = '<div style="font-size:.8rem;color:#71717a;padding:.6rem 0">Carregando…</div>'; return; }
        if (!forcar && Date.now() - ultimoRenderLista < 15000) return;
        ultimoRenderLista = Date.now();
        box.innerHTML = outros.map(d => {
            const st = statusDe(d);
            const eu = d.device_id === deviceId;
            const rel = controlaRelogio(d.device_id);
            const fechado = (Date.now() - new Date(d.heartbeat_em).getTime()) > ONLINE_MS;
            const pedido = d.desconectar_em && new Date(d.desconectar_em).getTime() > new Date(d.aberto_em || 0).getTime();
            return '<div style="display:flex;gap:.75rem;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:.7rem .8rem;background:#0f0f12;border:1px solid #1e1e23;border-radius:.6rem;margin-bottom:.5rem">' +
                '<div style="min-width:0;flex:1">' +
                '<div style="font-weight:700;font-size:.85rem;color:#e4e4e7">' + esc(d.operador_nome || 'Operador') + (eu ? ' <span style="font-size:.7rem;color:#f5d572">(esta aba)</span>' : '') + '</div>' +
                '<div style="font-size:.72rem;color:#71717a;margin-top:.15rem">' + esc(d.dispositivo || '') + ' · última atividade ' + tempoRel(d.ultima_atividade) + ' · aberto ' + tempoRel(d.aberto_em) + '</div>' +
                (rel.length ? '<div style="font-size:.72rem;color:#86efac;margin-top:.15rem">🎛️ Controla o relógio: ' + esc(rel.join(', ')) + '</div>' : '') +
                '</div>' +
                '<span style="font-size:.7rem;font-weight:700;padding:.25rem .55rem;border-radius:999px;color:' + st.cor + ';background:' + st.bg + '">' + (pedido && !d.em_espera && !fechado ? 'Desconectando…' : st.txt) + '</span>' +
                (!eu && !fechado && !d.em_espera ? '<button data-disp-off="' + esc(d.device_id) + '" style="padding:.4rem .7rem;border-radius:.45rem;border:1px solid #7f1d1d;background:rgba(239,68,68,.1);color:#fca5a5;font-size:.75rem;font-weight:700;cursor:pointer">Desconectar</button>' : '') +
                '</div>';
        }).join('');
        box.querySelectorAll('[data-disp-off]').forEach(b => b.addEventListener('click', () => confirmarDesconectar(b.getAttribute('data-disp-off'))));
    }

    function confirmarDesconectar(id) {
        const d = outros.find(x => x.device_id === id);
        const rel = controlaRelogio(id);
        let ov = document.getElementById('disp-off-ov');
        if (ov) ov.remove();
        ov = document.createElement('div');
        ov.id = 'disp-off-ov';
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:100060;display:flex;align-items:center;justify-content:center;padding:16px;';
        ov.innerHTML = '<div style="background:#18181b;border:1px solid #3f3f46;border-radius:12px;max-width:420px;width:100%;padding:18px;color:#e4e4e7;font-family:inherit">' +
            '<div style="font-weight:800;font-size:16px;margin-bottom:8px">🔌 Desconectar este computador?</div>' +
            '<div style="font-size:14px;line-height:1.5;color:#d4d4d8"><b>' + esc(d ? d.operador_nome : '') + '</b> · ' + esc(d ? d.dispositivo : '') + '<br>Ele para de gravar no sistema em até 1 minuto e mostra um aviso na tela. Quem estiver nele pode clicar para continuar (os dados recarregam).</div>' +
            (rel.length ? '<div style="font-size:13px;margin-top:8px;color:#fcd34d">⚠️ Ele controla o relógio de: ' + esc(rel.join(', ')) + '. Assuma o relógio em outra máquina.</div>' : '') +
            '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">' +
            '<button id="disp-off-cancel" style="padding:9px 14px;border-radius:8px;border:1px solid #3f3f46;background:#18181b;color:#e4e4e7;cursor:pointer">Cancelar</button>' +
            '<button id="disp-off-ok" style="padding:9px 14px;border-radius:8px;border:0;background:#ef4444;color:#fff;font-weight:800;cursor:pointer">Desconectar</button></div></div>';
        document.body.appendChild(ov);
        ov.querySelector('#disp-off-cancel').onclick = () => ov.remove();
        ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
        ov.querySelector('#disp-off-ok').onclick = async () => {
            ov.remove();
            try {
                const { data, error } = await sb.rpc('dispositivo_desconectar', { p_device_id: id });
                if (error) throw error;
                if (!data || !data.ok) throw new Error(data && data.erro === 'sem_permissao' ? 'apenas admin ou gerente' : 'dispositivo não encontrado');
                toast('🔌 Pedido enviado — o computador entra em espera em até 1 minuto');
                const x = outros.find(o => o.device_id === id);
                if (x) { x.desconectar_em = new Date().toISOString(); }
                renderLista(true);
            } catch (e) { toast('⚠️ Não foi possível desconectar: ' + (e.message || e)); }
        };
    }

    function painel() {
        const aba = document.getElementById('cfg-seguranca');
        if (!aba || !ehGestor()) return;
        let card = document.getElementById('cfg-disp-card');
        if (!card) {
            card = document.createElement('div');
            card.id = 'cfg-disp-card';
            card.className = 'stat-card';
            card.style.cssText = 'padding:1.5rem;margin-bottom:1rem;';
            card.innerHTML =
                '<div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;flex-wrap:wrap;margin-bottom:.5rem">' +
                '<div style="font-size:.65rem;color:var(--gold);font-weight:700;text-transform:uppercase;letter-spacing:.1em"><i class="fa-solid fa-display"></i> Dispositivos conectados</div>' +
                '<button id="cfg-disp-atualizar" class="btn-ghost" style="padding:.35rem .7rem;border-radius:.45rem;font-size:.72rem"><i class="fa-solid fa-rotate"></i> Atualizar</button></div>' +
                '<div style="font-size:.75rem;color:#71717a;margin-bottom:1rem">Computadores e celulares com o sistema aberto nas últimas 24h. Se algum ficou esquecido aberto (em casa, por exemplo), desconecte daqui.</div>' +
                '<div id="cfg-disp-lista"></div>' +
                '<div style="margin-top:1rem;padding:.85rem;background:#0f0f12;border:1px solid #1e1e23;border-radius:.6rem;display:flex;gap:.75rem;align-items:center;justify-content:space-between;flex-wrap:wrap">' +
                '<div style="min-width:0;flex:1"><div style="font-weight:700;font-size:.82rem;color:#e4e4e7">💤 Modo espera</div>' +
                '<div style="font-size:.72rem;color:#71717a;margin-top:.15rem">Computador sem uso entra em espera e para de gravar. Nunca entra a máquina da TV, a que controla o relógio, nem a última máquina acordada com torneio rodando.</div></div>' +
                '<select id="cfg-disp-espera" class="inp" style="width:auto;min-width:9rem">' +
                '<option value="0">Desligado</option><option value="15">Após 15 min</option><option value="20">Após 20 min</option><option value="30">Após 30 min</option><option value="60">Após 1 hora</option></select></div>';
            aba.insertBefore(card, aba.firstChild);
            card.querySelector('#cfg-disp-atualizar').addEventListener('click', async () => { await heartbeat(); renderLista(true); });
            const sel = card.querySelector('#cfg-disp-espera');
            sel.addEventListener('change', async () => {
                const c = clube(); if (!c) return;
                const v = Number(sel.value);
                const novo = Object.assign({}, c.config || {}, { espera_min: v });
                try {
                    const { error } = await sb.from('clubes').update({ config: novo }).eq('id', c.id);
                    if (error) throw error;
                    c.config = novo;
                    toast(v ? '💤 Modo espera: após ' + v + ' min sem uso' : 'Modo espera desligado');
                } catch (e) {
                    sel.value = String(minutosEspera());
                    toast('⚠️ Não foi possível salvar: ' + (e.message || e));
                }
            });
        }
        const sel = card.querySelector('#cfg-disp-espera');
        if (sel && document.activeElement !== sel) {
            const m = String(minutosEspera());
            if (![...sel.options].some(o => o.value === m)) { const o = document.createElement('option'); o.value = m; o.textContent = 'Após ' + m + ' min'; sel.appendChild(o); }
            sel.value = m;
        }
        if (aba.style.display !== 'none' && aba.offsetParent !== null) renderLista(false);
    }

    window._stackDispositivos = { deviceId: () => deviceId, estado: () => ({ emEspera, motivoEspera, ultimaAtividade, outros, motivoParaFicarAcordado: motivoParaFicarAcordado() }), entrarEspera, sairEspera };

    setInterval(() => {
        try {
            if (pronto() && !hbTimer) { heartbeat(); hbTimer = setInterval(heartbeat, HEARTBEAT_MS); }
            verificarInatividade();
            painel();
        } catch (e) { console.warn('[DISPOSITIVOS]', e); }
    }, 5000);
})();
