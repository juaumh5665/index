// ============================================================
// CONTROLE DO RELÓGIO POR MÁQUINA — StackOS
// ------------------------------------------------------------
// Opção do clube (padrão DESLIGADO): Configurações → Torneios.
// A máquina que mexe no relógio de um torneio vira a controladora dele.
// Nas outras, os botões do relógio (play/pausa, ±1 min, nível, break,
// encerrar/reabrir) e o Editar do torneio pedem "Assumir controle".
// Entradas, eliminações, pagamentos e cash continuam livres em todas.
// Se a controladora ficar offline (presença do canal realtime), a próxima
// máquina assume direto, sem perguntar.
// NÃO altera nenhuma função do sistema: só decide se o clique segue ou não.
// O avanço automático de nível pelo cronômetro nunca é bloqueado.
// ============================================================
(function () {
    'use strict';

    const FLAG = 'relogio_controle';
    const FUNCS = ['toggleTimer', 'adjTime', 'nextLevel', 'prevLevel', 'toggleBreak', 'encerrarTorneio', 'reabrirTorneio', 'abrirEditarTorneio'];

    let deviceId = null;
    try { deviceId = localStorage.getItem('ps_device_id'); } catch (_) {}
    if (!deviceId) {
        deviceId = 'dev-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        try { localStorage.setItem('ps_device_id', deviceId); } catch (_) {}
    }

    const ctrl = new Map();        // torneio_id -> { device_id, operador_nome, assumido_em }
    let online = new Set();        // device_ids online (presença)
    let presencaPronta = false;
    let canal = null, clubeCanal = null;

    const ativo = () => { try { return !!(window.sbClube && sbClube.config && sbClube.config[FLAG]); } catch (_) { return false; } };
    const ehAdmin = () => { try { return currentUser && (currentUser.role === 'admin' || currentUser.papel === 'admin' || window._isSuperAdmin); } catch (_) { return false; } };
    const meuNome = () => { try { return (currentUser && currentUser.nome) || 'Operador'; } catch (_) { return 'Operador'; } };
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const toast = (m) => { try { showToast(m); } catch (_) {} };

    // Clique/tecla do operador? (o cronômetro chama nextLevel sozinho — esse nunca é bloqueado)
    function acaoDoOperador() {
        const ev = window.event;
        return !!(ev && /^(click|keydown|keyup|pointerup|mouseup|touchend|submit)$/.test(ev.type));
    }

    // ---------- Conexão (tabela + presença), só com a opção ligada ----------
    async function conectar() {
        if (!ativo() || !window.sbClube || typeof sb === 'undefined') return;
        if (canal && clubeCanal === sbClube.id) return;
        desconectar();
        clubeCanal = sbClube.id;
        try {
            const { data } = await sb.from('torneio_controle').select('*').eq('clube_id', sbClube.id);
            ctrl.clear();
            (data || []).forEach(r => ctrl.set(r.torneio_id, r));
        } catch (_) {}
        canal = sb.channel('relogio-ctrl-' + sbClube.id, { config: { presence: { key: deviceId } } });
        canal.on('postgres_changes', { event: '*', schema: 'public', table: 'torneio_controle', filter: 'clube_id=eq.' + sbClube.id }, (p) => {
            const novo = p.new && p.new.torneio_id ? p.new : null;
            const antigo = p.old && p.old.torneio_id ? ctrl.get(p.old.torneio_id) : null;
            if (p.eventType === 'DELETE' && p.old) { ctrl.delete(p.old.torneio_id); return; }
            if (!novo) return;
            const anterior = ctrl.get(novo.torneio_id) || antigo;
            ctrl.set(novo.torneio_id, novo);
            if (anterior && anterior.device_id === deviceId && novo.device_id !== deviceId) {
                const t = (torneios || []).find(x => x.id === novo.torneio_id);
                toast('🔄 O controle do relógio' + (t ? ' de ' + t.nome : '') + ' passou para ' + (novo.operador_nome || 'outra máquina'));
            }
        });
        canal.on('presence', { event: 'sync' }, () => {
            try {
                const st = canal.presenceState();
                online = new Set(Object.keys(st || {}));
                presencaPronta = true;
            } catch (_) {}
        });
        canal.subscribe(async (status) => {
            if (status === 'SUBSCRIBED') { try { await canal.track({ nome: meuNome(), ts: Date.now() }); } catch (_) {} }
        });
    }
    function desconectar() {
        try { if (canal) sb.removeChannel(canal); } catch (_) {}
        canal = null; clubeCanal = null; presencaPronta = false; online = new Set();
    }

    async function assumir(tid) {
        const row = { torneio_id: tid, clube_id: sbClube.id, device_id: deviceId, operador_nome: meuNome(), assumido_em: new Date().toISOString() };
        ctrl.set(tid, row);
        try {
            const { error } = await sb.from('torneio_controle').upsert(row);
            if (error) console.warn('[RELOGIO-CTRL] assumir:', error.message);
        } catch (e) { console.warn('[RELOGIO-CTRL] assumir:', e); }
    }

    function confirmarAssumir(nomeOutro, onOk) {
        let ov = document.getElementById('relogio-ctrl-ov');
        if (ov) ov.remove();
        ov = document.createElement('div');
        ov.id = 'relogio-ctrl-ov';
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:100002;display:flex;align-items:center;justify-content:center;padding:16px;';
        ov.innerHTML = '<div style="background:#18181b;border:1px solid #3f3f46;border-radius:12px;max-width:420px;width:100%;padding:18px;color:#e4e4e7;font-family:inherit">' +
            '<div style="font-weight:800;font-size:16px;margin-bottom:8px">🔒 Assumir o relógio?</div>' +
            '<div style="font-size:14px;line-height:1.5;color:#d4d4d8"><b>' + esc(nomeOutro) + '</b> está controlando o relógio deste torneio agora. Ao assumir, os botões do relógio dele ficam travados.</div>' +
            '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">' +
            '<button id="relogio-ctrl-cancel" style="padding:9px 14px;border-radius:8px;border:1px solid #3f3f46;background:#18181b;color:#e4e4e7;cursor:pointer">Cancelar</button>' +
            '<button id="relogio-ctrl-ok" style="padding:9px 14px;border-radius:8px;border:0;background:#f59e0b;color:#111;font-weight:800;cursor:pointer">Assumir</button></div></div>';
        document.body.appendChild(ov);
        ov.querySelector('#relogio-ctrl-cancel').onclick = () => ov.remove();
        ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
        ov.querySelector('#relogio-ctrl-ok').onclick = () => { ov.remove(); onOk(); };
    }

    // ---------- Envolve as funções do relógio (sem mudar o que elas fazem) ----------
    function envolver(nome) {
        const original = window[nome];
        if (typeof original !== 'function' || original.__relogioCtrl) return;
        const w = function (idx) {
            const args = arguments, self = this;
            if (!ativo() || !acaoDoOperador()) return original.apply(self, args);
            const t = (typeof torneios !== 'undefined' && torneios) ? torneios[idx] : null;
            if (!t || !t.id || !window.sbClube) return original.apply(self, args);
            const row = ctrl.get(t.id);
            if (!row || row.device_id === deviceId) {
                if (!row) assumir(t.id);
                return original.apply(self, args);
            }
            // Controladora offline → assume direto
            if (presencaPronta && !online.has(row.device_id)) {
                assumir(t.id);
                toast('🎛️ Você assumiu o relógio (' + (row.operador_nome || 'a outra máquina') + ' está offline)');
                return original.apply(self, args);
            }
            confirmarAssumir(row.operador_nome || 'Outra máquina', async () => {
                await assumir(t.id);
                toast('🎛️ Você assumiu o controle do relógio');
                try { original.apply(self, args); } catch (e) { console.warn('[RELOGIO-CTRL]', e); }
            });
            return undefined;
        };
        w.__relogioCtrl = true;
        window[nome] = w;
    }

    // ---------- Selo no modal do torneio ----------
    function selo() {
        const btnEdit = document.querySelector('button[onclick="abrirEditarTorneio(activeTorneioIdx)"]');
        let el = document.getElementById('relogio-ctrl-selo');
        const t = (typeof activeTorneioIdx !== 'undefined' && activeTorneioIdx !== null && typeof torneios !== 'undefined') ? torneios[activeTorneioIdx] : null;
        const row = t ? ctrl.get(t.id) : null;
        if (!ativo() || !btnEdit || !t || !row || ['finished', 'encerrado'].includes(String(t.status || ''))) { if (el) el.style.display = 'none'; return; }
        if (!el) {
            el = document.createElement('span');
            el.id = 'relogio-ctrl-selo';
            el.style.cssText = 'display:inline-flex;align-items:center;gap:.35rem;font-size:.72rem;font-weight:700;padding:.3rem .6rem;border-radius:999px;margin-left:.4rem;vertical-align:middle;';
            btnEdit.parentNode.insertBefore(el, btnEdit);
        }
        el.style.display = 'inline-flex';
        if (row.device_id === deviceId) {
            el.style.background = 'rgba(34,197,94,.15)'; el.style.color = '#86efac'; el.style.border = '1px solid #166534';
            el.textContent = '🎛️ Você controla o relógio';
        } else {
            const off = presencaPronta && !online.has(row.device_id);
            el.style.background = 'rgba(245,158,11,.12)'; el.style.color = '#fcd34d'; el.style.border = '1px solid #92400e';
            el.textContent = '🔒 Relógio: ' + (row.operador_nome || 'outra máquina') + (off ? ' (offline)' : '');
        }
    }

    // ---------- Opção nas Configurações → Torneios (só admin) ----------
    function opcao() {
        const aba = document.getElementById('cfg-torneios');
        if (!aba || !ehAdmin() || document.getElementById('cfg-relogio-ctrl-card')) return;
        const card = document.createElement('div');
        card.id = 'cfg-relogio-ctrl-card';
        card.style.cssText = 'margin-bottom:1rem;padding:1rem;background:#14141a;border:1px solid #27272a;border-radius:.6rem;';
        card.innerHTML = '<label style="display:flex;gap:.6rem;align-items:flex-start;cursor:pointer">' +
            '<input type="checkbox" id="cfg-relogio-ctrl" style="width:18px;height:18px;margin-top:2px;accent-color:#f5d572">' +
            '<span><b>🎛️ Travar relógio em uma máquina</b><br><span style="font-size:.78rem;color:#a1a1aa">Só a máquina que controla o torneio mexe no relógio (play/pausa, tempo, nível, break, encerrar) e no Editar. As outras podem assumir com um clique; se a controladora cair, assumem direto. Entradas, eliminações, pagamentos e cash ficam livres em todas.</span></span></label>';
        const ref = document.getElementById('cfg-sim-torneio-card');
        if (ref && ref.parentNode === aba) ref.insertAdjacentElement('afterend', card); else aba.insertBefore(card, aba.firstChild);
        const cb = card.querySelector('#cfg-relogio-ctrl');
        cb.checked = ativo();
        cb.addEventListener('change', async () => {
            if (!window.sbClube) return;
            const novo = Object.assign({}, sbClube.config || {}, { [FLAG]: cb.checked });
            try {
                const { error } = await sb.from('clubes').update({ config: novo }).eq('id', sbClube.id);
                if (error) throw error;
                sbClube.config = novo;
                toast(cb.checked ? '🎛️ Controle do relógio por máquina ativado' : 'Controle do relógio por máquina desativado');
                if (cb.checked) conectar(); else desconectar();
            } catch (e) {
                cb.checked = !cb.checked;
                toast('⚠️ Não foi possível salvar: ' + (e.message || e));
            }
        });
    }

    window._relogioCtrl = { ctrl, deviceId: () => deviceId, online: () => online }; // diagnóstico

    setInterval(() => {
        try {
            FUNCS.forEach(envolver);
            if (ativo()) conectar(); else if (canal) desconectar();
            selo(); opcao();
        } catch (_) {}
    }, 1000);
})();
