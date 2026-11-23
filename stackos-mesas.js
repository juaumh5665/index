// ============================================================
// MESAS E LUGARES DOS TORNEIOS — StackOS
// ------------------------------------------------------------
// Fonte única: tabela torneio_lugares (+ torneio_mesas_estado), sempre alterada por
// funções do banco (lugares_aplicar, lugar_sortear, mesas_estado_salvar), que fazem
// tudo-ou-nada e não deixam a mesma cadeira com dois jogadores. O app do operador
// (esta aba) e o app do floor (PWA) leem e escrevem o mesmo lugar, em tempo real.
//
// - Aba "Mesas" do torneio: mesas ovais, faixa "Sem lugar", arrastar para mover/trocar,
//   liberar (sem eliminar), eliminar (abre o fluxo normal), balancear, quebrar mesa,
//   mesa final, imprimir mapa, configuração (clube e torneio).
// - Sorteio na entrada (opcional, desligado por padrão): ao registrar o buy-in, senta o
//   jogador na mesa aberta mais vazia; reentrada mantém a cadeira (configurável).
//   NUNCA bloqueia a entrada: se falhar, o jogador fica em "Sem lugar".
// - Comprovante: imprime "MESA x · CADEIRA y" quando o jogador já tem lugar.
// Não mexe em financeiro, fichas, relógio nem TV.
// ============================================================
(function () {
    'use strict';
    if (window.Lugares) return;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const toast = (m) => { try { showToast(m); } catch (_) { console.log(m); } };
    const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
    const nomeDe = (jid) => { try { return getJogadorNome(jid) || 'Jogador'; } catch (_) { return 'Jogador'; } };
    const ini = (n) => String(n || '?').trim().split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
    const por = () => { try { const u = window.currentUser || {}; return u.nome || u.email || null; } catch (_) { return null; } };
    const sbOk = () => typeof sb !== 'undefined' && sb && typeof sbClube !== 'undefined' && sbClube && sbClube.id;

    // ─── estado em memória por torneio ───
    // T[tid] = { lugares: Map(jid -> {m,c,status}), estado: {abertas:[], cadeiras, sorteio_entrada}, ok, carregando }
    const T = {};
    const st = (tid) => (T[tid] = T[tid] || { lugares: new Map(), estado: { abertas: [], cadeiras: null, sorteio_entrada: null }, ok: false, carregando: null });

    function cfgClube() {
        const c = (typeof sbClube !== 'undefined' && sbClube && sbClube.mesas_cfg) || {};
        return {
            cadeiras: Number(c.cadeiras) || 9,
            salao: Number(c.salao) || 50,
            mesaFinal: Number(c.mesaFinal) || 9,
            sorteioEntrada: c.sorteioEntrada === true,
            reentradaMantem: c.reentradaMantem !== false,
            abrirAuto: c.abrirAuto !== false
        };
    }
    const cadeirasDe = (tid) => Number(st(tid).estado.cadeiras) || cfgClube().cadeiras;
    function sorteioLigado(tid) {
        const v = st(tid).estado.sorteio_entrada;
        return (v === true || v === false) ? v : cfgClube().sorteioEntrada;
    }

    function ativos(t) {
        const elim = new Set((t.eliminados || []).map(e => String(e.jogadorId)));
        const ids = [];
        const vistos = new Set();
        (t.entries || []).forEach(e => {
            if (!e || e.tipo === 'addon') return;
            const id = String(e.jogadorId);
            if (!vistos.has(id) && !elim.has(id)) { vistos.add(id); ids.push(id); }
        });
        return ids;
    }

    async function carregar(tid, forcar) {
        const s = st(tid);
        if (s.ok && !forcar) return s;
        if (s.carregando) return s.carregando;
        s.carregando = (async () => {
            try {
                const [l, e] = await Promise.all([
                    sb.from('torneio_lugares').select('jogador_id,mesa,cadeira,status').eq('torneio_id', tid),
                    sb.from('torneio_mesas_estado').select('abertas,cadeiras,sorteio_entrada').eq('torneio_id', tid).maybeSingle()
                ]);
                if (l.error) throw l.error;
                s.lugares = new Map((l.data || []).map(r => [String(r.jogador_id), { m: r.mesa, c: r.cadeira, status: r.status }]));
                s.estado = e.data ? { abertas: e.data.abertas || [], cadeiras: e.data.cadeiras, sorteio_entrada: e.data.sorteio_entrada } : { abertas: [], cadeiras: null, sorteio_entrada: null };
                s.ok = true;
            } catch (err) { console.warn('[Lugares] carregar', err); }
            finally { s.carregando = null; }
            return s;
        })();
        return s.carregando;
    }

    // ─── tempo real ───
    let canal = null, canalClube = null;
    function ligarRealtime() {
        if (!sbOk() || canalClube === sbClube.id) return;
        try { if (canal) sb.removeChannel(canal); } catch (_) {}
        canalClube = sbClube.id;
        canal = sb.channel('lugares:' + canalClube)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'torneio_lugares', filter: 'clube_id=eq.' + canalClube }, (p) => {
                const r = p.new && Object.keys(p.new).length ? p.new : p.old; if (!r || !r.torneio_id) return;
                const s = T[r.torneio_id]; if (!s || !s.ok) return;
                if (p.eventType === 'DELETE') s.lugares.delete(String(p.old.jogador_id));
                else s.lugares.set(String(p.new.jogador_id), { m: p.new.mesa, c: p.new.cadeira, status: p.new.status });
                agendarRender(r.torneio_id);
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'torneio_mesas_estado', filter: 'clube_id=eq.' + canalClube }, (p) => {
                const r = p.new; if (!r || !r.torneio_id) return;
                const s = T[r.torneio_id]; if (!s || !s.ok) return;
                s.estado = { abertas: r.abertas || [], cadeiras: r.cadeiras, sorteio_entrada: r.sorteio_entrada };
                agendarRender(r.torneio_id);
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'floor_pedidos', filter: 'clube_id=eq.' + canalClube }, () => carregarPedidos())
            .subscribe();
        carregarPedidos();
    }
    let _rt = null;

    // ─── pedidos de eliminação vindos do app do floor ───
    let PED = [];
    async function carregarPedidos() {
        if (!sbOk()) return;
        try {
            const { data, error } = await sb.from('floor_pedidos').select('id,torneio_id,jogador_id,mesa,cadeira,criado_por,criado_em').eq('clube_id', sbClube.id).eq('status', 'pendente').order('criado_em');
            if (error) throw error;
            PED = (data || []).map(p => Object.assign(p, { jogador_id: String(p.jogador_id) }));
            // Já eliminado no app (ex.: o caixa eliminou antes de ver o aviso): conclui sozinho
            for (const p of PED.slice()) {
                const t = (torneios || []).find(x => x.id === p.torneio_id);
                if (t && (t.eliminados || []).some(e => String(e.jogadorId) === p.jogador_id)) {
                    try { await sb.rpc('floor_pedido_resolver', { p_id: p.id, p_status: 'feito' }); } catch (_) {}
                    PED = PED.filter(x => x.id !== p.id);
                }
            }
        } catch (e) { console.warn('[Lugares] pedidos', e); }
        renderPedidos();
        const t = torneioAtivo(); if (t && abaVisivel()) agendarRender(t.id);
    }
    function renderPedidos() {
        let el = document.getElementById('lg-pedidos');
        if (!PED.length) { if (el) el.remove(); return; }
        css();
        if (!el) { el = document.createElement('div'); el.id = 'lg-pedidos'; document.body.appendChild(el); }
        el.innerHTML = `<div class="lg-ped-h">📱 Floor pediu eliminação (${PED.length})</div>` + PED.slice(0, 5).map(p => {
            const t = (torneios || []).find(x => x.id === p.torneio_id);
            return `<div class="lg-ped"><div style="min-width:0"><b>${esc(nomeDe(p.jogador_id))}</b><small>${esc(t ? t.nome : 'Torneio')}${p.mesa ? ` · Mesa ${p.mesa} · Cad ${p.cadeira}` : ''} · por ${esc(p.criado_por || 'floor')}</small></div>
                <button class="lg-btn bad" data-pe="${p.id}">Eliminar</button><button class="lg-btn" data-pi="${p.id}" title="Ignorar (o jogador continua no torneio, em Sem lugar)">✕</button></div>`;
        }).join('');
        el.querySelectorAll('[data-pe]').forEach(b => b.onclick = () => {
            const p = PED.find(x => x.id === b.dataset.pe); if (!p) return;
            const idx = (torneios || []).findIndex(x => x.id === p.torneio_id);
            if (idx < 0) return toast('Torneio não encontrado');
            try {
                abrirDetalhesTorneio(idx);
                setTimeout(() => {
                    try { openModalEliminarJogador(idx, p.jogador_id); } catch (err) { console.warn(err); }
                }, 250);
            } catch (err) { console.warn(err); }
        });
        el.querySelectorAll('[data-pi]').forEach(b => b.onclick = async () => {
            try { await sb.rpc('floor_pedido_resolver', { p_id: b.dataset.pi, p_status: 'ignorado' }); } catch (_) {}
            PED = PED.filter(x => x.id !== b.dataset.pi); renderPedidos(); toast('Pedido ignorado: o jogador continua no torneio (em Sem lugar)');
        });
    }
    function agendarRender(tid) {
        clearTimeout(_rt);
        _rt = setTimeout(() => { const t = torneioAtivo(); if (t && t.id === tid && abaVisivel()) desenhar(t); }, 120);
    }
    const torneioAtivo = () => { try { return (activeTorneioIdx !== null && activeTorneioIdx !== undefined) ? torneios[activeTorneioIdx] : null; } catch (_) { return null; } };
    const abaVisivel = () => { const el = document.getElementById('lug-aba'); return !!(el && el.offsetParent !== null); };

    // ─── chamadas ao banco (em fila: uma por vez, na ordem) ───
    let fila = Promise.resolve();
    const enfileirar = (fn) => (fila = fila.then(fn, fn));
    const MSG = { ocupada: 'Essa cadeira acabou de ser ocupada. A tela foi atualizada.', mudou: 'Alguém mudou esse lugar agora há pouco. A tela foi atualizada.', cadeira_invalida: 'Cadeira inválida.', mesa_com_jogadores: 'Ainda tem jogador nessa mesa.', cadeira_ocupada_acima: 'Tem jogador sentado numa cadeira acima desse número.', sem_permissao: 'Sem permissão.' };

    async function aplicar(t, ops, acao) {
        if (!ops.length) return true;
        try {
            const { data, error } = await sb.rpc('lugares_aplicar', { p_torneio: t.id, p_ops: ops, p_por: por(), p_acao: acao });
            if (error) throw error;
            if (!data || !data.ok) { toast('⚠️ ' + (MSG[data && data.erro] || 'Não foi possível mudar o lugar.')); await carregar(t.id, true); desenhar(t); return false; }
            const s = st(t.id);
            ops.forEach(o => {
                if (o.para === 'remover') s.lugares.delete(String(o.j));
                else if (o.para === 'fora') s.lugares.set(String(o.j), { m: null, c: null, status: 'fora' });
                else { s.lugares.set(String(o.j), { m: o.para.m, c: o.para.c, status: 'sentado' }); if (!s.estado.abertas.includes(o.para.m)) s.estado.abertas = [...s.estado.abertas, o.para.m].sort((a, b) => a - b); }
            });
            return true;
        } catch (e) {
            console.warn('[Lugares] aplicar', e);
            toast('⚠️ Sem conexão com o servidor: o lugar não foi alterado.');
            return false;
        }
    }
    async function salvarEstado(t, campos) {
        try {
            const { data, error } = await sb.rpc('mesas_estado_salvar', Object.assign({ p_torneio: t.id, p_por: por() }, campos));
            if (error) throw error;
            if (!data || !data.ok) { toast('⚠️ ' + (MSG[data && data.erro] || 'Não foi possível salvar.')); return false; }
            await carregar(t.id, true);
            return true;
        } catch (e) { console.warn('[Lugares] estado', e); toast('⚠️ Sem conexão com o servidor.'); return false; }
    }
    async function sortear(t, jid, manter) {
        const { data, error } = await sb.rpc('lugar_sortear', { p_torneio: t.id, p_jogador: jid, p_manter: manter !== false, p_por: por() });
        if (error) throw error;
        const s = st(t.id);
        if (data && data.ok && data.mesa) {
            s.lugares.set(String(jid), { m: data.mesa, c: data.cadeira, status: 'sentado' });
            if (!s.estado.abertas.includes(data.mesa)) s.estado.abertas = [...s.estado.abertas, data.mesa].sort((a, b) => a - b);
        }
        return data || {};
    }

    // ─── ganchos chamados pelo app ───
    function aoEntrar(t, jid) {
        if (!sbOk() || !t || !isUuid(t.id) || !jid) return;
        ligarRealtime();
        enfileirar(async () => {
            try {
                await carregar(t.id);
                if (!sorteioLigado(t.id)) { agendarRender(t.id); return; }
                const ult = (t.entries || []).filter(e => String(e.jogadorId) === String(jid)).pop();
                const ehReentrada = ult && /reentr|reentry/i.test(String(ult.tipo || ''));
                const manter = !ehReentrada || cfgClube().reentradaMantem;
                const r = await sortear(t, jid, manter);
                if (r.mesa) toast(`🪑 ${nomeDe(jid)} → ${r.mantido ? 'mantém ' : ''}Mesa ${r.mesa} · Cadeira ${r.cadeira}${r.abriu_mesa ? ' (mesa aberta agora)' : ''}`);
                else if (r.sem_lugar) toast(`⚠️ Sem cadeira livre: ${nomeDe(jid)} ficou em "Sem lugar" (aba Mesas)`);
                agendarRender(t.id);
            } catch (e) {
                console.warn('[Lugares] sorteio na entrada', e);
                toast(`⚠️ Lugar de ${nomeDe(jid)} não sorteado (sem conexão?). Ele fica em "Sem lugar".`);
            }
        });
    }
    function aoSair(t, jid) {
        if (!sbOk() || !t || !isUuid(t.id) || !jid) return;
        enfileirar(async () => {
            try {
                if (PED.some(p => p.torneio_id === t.id && p.jogador_id === String(jid))) {
                    try { await sb.rpc('floor_pedidos_concluir_jogador', { p_torneio: t.id, p_jogador: jid }); } catch (_) {}
                    PED = PED.filter(p => !(p.torneio_id === t.id && p.jogador_id === String(jid))); renderPedidos();
                }
                await carregar(t.id);
                if (!st(t.id).lugares.has(String(jid))) return;
                await aplicar(t, [{ j: String(jid), para: 'remover' }], 'eliminar');
                agendarRender(t.id);
            } catch (e) { console.warn('[Lugares] aoSair', e); }
        });
    }
    function textoComprovante(t, jid) {
        if (!t || !jid) return '';
        const s = T[t.id]; if (!s) return '';
        const l = s.lugares.get(String(jid));
        if (!l || l.status !== 'sentado') return '';
        const col = (typeof _printColWidth === 'function') ? _printColWidth() : 32;
        const linha = (typeof _printLine === 'function') ? _printLine('=', col) : '='.repeat(col);
        const centro = (x) => (typeof _printCenter === 'function') ? _printCenter(x, col) : x;
        return '\n' + linha + '\n' + centro(`MESA ${l.m}  -  POSIÇÃO ${l.c}`) + '\n' + linha + '\n';
    }

    // ─── CSS ───
    const CSS = `
.lg,.lg-dlg,.lg-pop{--lp:#0e0e11;--lp2:#16161b;--ll:#24242c;--lm:#9a9aa6;--ld:#5f5f6b;--la:#a855f7;--las:rgba(168,85,247,.16);--lgo:#f5b53d;--lgs:rgba(245,181,61,.12);--lok:#22c55e;--loks:rgba(34,197,94,.14);--lbad:#f87171;--lblu:#38bdf8}
.lg{display:flex;flex-direction:column;gap:.7rem;color:#ececf0;font-family:Manrope,system-ui,sans-serif;min-width:0}
.lg-tb{display:flex;gap:.45rem;align-items:center;flex-wrap:wrap}.lg-tb .sp{flex:1}
.lg-lbl{font-size:.62rem;font-weight:800;color:var(--ld);letter-spacing:.08em;text-transform:uppercase}
.lg-kp{display:flex;gap:.8rem;font-size:.7rem;color:var(--lm);flex-wrap:wrap}.lg-kp b{color:#ececf0;font-family:var(--font-mono,ui-monospace,monospace)}
.lg-btn{font:inherit;font-weight:800;font-size:.7rem;border-radius:.5rem;border:1px solid var(--ll);background:var(--lp2);color:#ececf0;padding:.42rem .7rem;cursor:pointer;white-space:nowrap}
.lg-btn:hover{border-color:#3f3f46}.lg-btn.pri{background:var(--la);border-color:var(--la);color:#fff}.lg-btn.gold{background:var(--lgo);border-color:var(--lgo);color:#1a1205}.lg-btn.bad{color:var(--lbad);border-color:rgba(248,113,113,.4);background:transparent}
.lg-btn[disabled]{opacity:.4;cursor:default}
.lg-seg{display:inline-flex;border:1px solid var(--ll);border-radius:.5rem;overflow:hidden}.lg-seg button{font:inherit;font-size:.68rem;font-weight:800;border:0;background:var(--lp2);color:var(--lm);padding:.4rem .65rem;cursor:pointer}.lg-seg button.on{background:var(--las);color:#fff}
.lg-al{border-radius:.65rem;padding:.55rem .75rem;font-size:.73rem;display:flex;gap:.6rem;align-items:center;flex-wrap:wrap}
.lg-al.w{background:var(--lgs);border:1px solid rgba(245,181,61,.35);color:#fde68a}.lg-al.i{background:rgba(56,189,248,.08);border:1px solid rgba(56,189,248,.3);color:#bae6fd}
.lg-al .lg-btn{margin-left:auto}
.lg-tray{display:flex;gap:.35rem;flex-wrap:wrap;align-items:center;background:var(--lp);border:1px dashed #33333d;border-radius:.7rem;padding:.5rem .6rem;max-height:150px;overflow:auto}
.lg-chip{display:flex;align-items:center;gap:.35rem;background:var(--lp2);border:1px solid var(--ll);border-radius:999px;padding:.2rem .6rem .2rem .2rem;font-size:.7rem;font-weight:800;cursor:grab;user-select:none;touch-action:none}
.lg-chip i{font-style:normal;width:22px;height:22px;border-radius:50%;background:var(--las);color:#e9d5ff;display:flex;align-items:center;justify-content:center;font-size:.58rem}
.lg-chip.on{border-color:var(--la);background:var(--las)}.lg-chip.fora{opacity:.75;border-style:dashed}
.lg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:.7rem}.lg-grid.um{grid-template-columns:1fr}
.lg-mesa{background:var(--lp);border:1px solid var(--ll);border-radius:.85rem;padding:.5rem .6rem .6rem;min-width:0}
.lg-mh{display:flex;align-items:center;gap:.45rem}.lg-mh b{font-size:.82rem}.lg-mh .oc{font-family:var(--font-mono,ui-monospace,monospace);font-size:.68rem;color:var(--lm)}
.lg-mesa.cheia .oc{color:var(--lgo)}.lg-mesa.curta .oc{color:var(--lblu)}
.lg-mh .acts{margin-left:auto;display:flex;gap:.25rem}.lg-mh .acts button{font:inherit;font-size:.6rem;font-weight:800;border:1px solid var(--ll);background:transparent;color:var(--lm);border-radius:.35rem;padding:.15rem .4rem;cursor:pointer}
.lg-tbl{position:relative;width:100%;aspect-ratio:1.9/1;margin-top:.4rem}.lg-grid.um .lg-tbl{aspect-ratio:2/1;max-width:760px;margin:.6rem auto 0}
.lg-felt{position:absolute;left:15%;right:15%;top:20%;bottom:20%;border-radius:999px;background:radial-gradient(ellipse at 50% 45%,#16774a,#0f5132 55%,#0a3a24);border:6px solid #3b2414;box-shadow:inset 0 0 0 2px rgba(255,255,255,.06),0 8px 24px rgba(0,0,0,.5)}
.lg-logo{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;color:rgba(255,255,255,.35);font-weight:800;letter-spacing:.12em;font-size:.48rem;pointer-events:none}.lg-logo b{display:block;font-size:1rem;color:rgba(255,255,255,.55);letter-spacing:.02em}
.lg-grid.um .lg-logo{font-size:.55rem}.lg-grid.um .lg-logo b{font-size:1.3rem}
.lg-dl{position:absolute;transform:translate(-50%,-50%);font-size:.5rem;font-weight:800;background:#fff;color:#111;border-radius:5px;padding:1px 5px}
.lg-st{position:absolute;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:1px;border:0;background:none;font:inherit;color:#ececf0;padding:0;cursor:pointer;width:64px;touch-action:none}
.lg-st .av{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.58rem;background:#25252d;border:1.5px solid #3a3a46;box-shadow:0 3px 10px rgba(0,0,0,.4)}
.lg-st .nm{font-size:.54rem;font-weight:800;max-width:64px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:rgba(10,10,14,.88);border-radius:4px;padding:0 4px}
.lg-st .no{display:none;font-size:.48rem;color:var(--lm);font-weight:800}
.lg-grid.um .lg-st{width:100px}.lg-grid.um .lg-st .av{width:46px;height:46px;font-size:.85rem;border-width:2px}.lg-grid.um .lg-st .nm{font-size:.7rem;max-width:100px}.lg-grid.um .lg-st .no{display:block}
.lg-st.livre .av{background:transparent;border:1.5px dashed rgba(34,197,94,.6);color:var(--lok)}.lg-st.livre .nm{display:none}.lg-grid.um .lg-st.livre .nm{display:block;color:var(--lok);background:transparent}
.lg-st.sel .av{border-color:var(--la);box-shadow:0 0 0 4px rgba(168,85,247,.35)}
.lg-st.alvo .av{border-color:var(--lok);box-shadow:0 0 0 4px rgba(34,197,94,.3)}
.lg-st.drop .av{background:var(--loks);transform:scale(1.15)}
.lg-pop{position:fixed;z-index:100050;background:#141419;border:1px solid #33333d;border-radius:.75rem;padding:.65rem;width:240px;box-shadow:0 16px 40px rgba(0,0,0,.6);color:#ececf0;font-family:Manrope,system-ui,sans-serif}
.lg-pop h4{margin:0;font-size:.85rem}.lg-pop .sub{font-size:.66rem;color:#9a9aa6;margin:.1rem 0 .5rem}
.lg-pop .acts{display:grid;grid-template-columns:1fr 1fr;gap:.35rem}.lg-pop .acts .lg-btn{padding:.5rem .3rem}
.lg-ghost{position:fixed;z-index:100060;pointer-events:none;background:#a855f7;color:#fff;font-weight:800;font-size:.72rem;border-radius:999px;padding:6px 12px;box-shadow:0 10px 30px rgba(0,0,0,.5);font-family:Manrope,system-ui,sans-serif}
.lg-ov{position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:100040;display:flex;align-items:center;justify-content:center;padding:16px}
.lg-dlg{background:#111114;border:1px solid #2f2f38;border-radius:.9rem;padding:1rem;width:100%;max-width:460px;max-height:90vh;overflow:auto;display:flex;flex-direction:column;gap:.6rem;color:#ececf0;font-family:Manrope,system-ui,sans-serif}
.lg-dlg h3{margin:0;font-size:.95rem}.lg-dlg .note{font-size:.72rem;color:#9a9aa6;line-height:1.45}
.lg-mv{display:flex;flex-direction:column;gap:.3rem;max-height:46vh;overflow:auto}.lg-mv .row{display:flex;justify-content:space-between;gap:.5rem;font-size:.75rem;background:#16161b;border:1px solid #24242c;border-radius:.5rem;padding:.4rem .6rem}.lg-mv .row b{font-family:var(--font-mono,ui-monospace,monospace);font-size:.68rem;color:#22c55e;white-space:nowrap}
.lg-dlg .rowb{display:flex;gap:.5rem;justify-content:flex-end;flex-wrap:wrap}
.lg-f{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}.lg-f label{display:flex;flex-direction:column;gap:.25rem;font-size:.66rem;font-weight:800;color:#9a9aa6}
.lg-f input,.lg-f select{font:inherit;font-size:.8rem;background:#0c0c0f;color:#ececf0;border:1px solid #2f2f38;border-radius:.45rem;padding:.4rem .5rem}
.lg-ck{display:flex;gap:.5rem;align-items:flex-start;font-size:.76rem;cursor:pointer}.lg-ck input{margin-top:.2rem;accent-color:#a855f7}.lg-ck small{display:block;color:#9a9aa6;font-size:.68rem}
.lg-sec{font-size:.62rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#f5b53d;margin-top:.3rem}
.lg-legend{font-size:.66rem;color:var(--ld)}
body.lg-dragging,body.lg-dragging *{cursor:grabbing!important}
#lg-pedidos{position:fixed;left:16px;bottom:16px;z-index:100030;width:340px;max-width:calc(100vw - 32px);background:#141419;border:1px solid rgba(248,113,113,.45);border-radius:.8rem;padding:.6rem;box-shadow:0 16px 40px rgba(0,0,0,.6);display:flex;flex-direction:column;gap:.4rem;color:#ececf0;font-family:Manrope,system-ui,sans-serif;--lp:#0e0e11;--lp2:#16161b;--ll:#24242c;--lbad:#f87171}
.lg-ped-h{font-size:.72rem;font-weight:800;color:#fca5a5}
.lg-ped{display:flex;align-items:center;gap:.4rem;background:#0e0e11;border:1px solid #24242c;border-radius:.55rem;padding:.4rem .5rem}.lg-ped>div{flex:1}.lg-ped b{display:block;font-size:.8rem}.lg-ped small{display:block;font-size:.64rem;color:#9a9aa6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
`;
    function css() { if (document.getElementById('lg-css')) return; const s = document.createElement('style'); s.id = 'lg-css'; s.textContent = CSS; document.head.appendChild(s); }

    // ─── visão da aba ───
    const V = { zoom: 'todas', uma: null, sel: null, modo: null, pegou: null, verFora: false, _limpouEm: 0 };
    function pos(i, n) { const a = Math.PI / 2 + (i + 1) * 2 * Math.PI / (n + 1); return [50 + 42 * Math.cos(a), 50 + 40 * Math.sin(a)]; }

    function modelo(t) {
        const s = st(t.id), cad = cadeirasDe(t.id);
        const at = ativos(t), atSet = new Set(at);
        const porMesa = new Map();
        const sentados = new Set(), fora = [];
        s.lugares.forEach((l, jid) => {
            if (!atSet.has(jid)) return;
            if (l.status === 'sentado') { if (!porMesa.has(l.m)) porMesa.set(l.m, new Array(cad).fill(null)); const arr = porMesa.get(l.m); if (l.c >= 1 && l.c <= cad) arr[l.c - 1] = jid; sentados.add(jid); }
            else fora.push(jid);
        });
        const nums = new Set([...(s.estado.abertas || []), ...porMesa.keys()]);
        const mesas = [...nums].sort((a, b) => a - b).map(n => ({ n, s: porMesa.get(n) || new Array(cad).fill(null) }));
        const semLugar = at.filter(j => !s.lugares.has(j));
        return { cad, mesas, semLugar, fora, ativos: at, sentados };
    }
    const ocup = (m) => m.s.filter(Boolean).length;

    function sugestaoBalancear(M) {
        const ms = M.mesas.filter(m => ocup(m) > 0).map(m => ({ n: m.n, s: m.s.slice() }));
        if (ms.length < 2) return [];
        const movs = [], movidos = new Set();
        for (let k = 0; k < 200; k++) {
            ms.sort((a, b) => ocup(b) - ocup(a));
            const mx = ms[0], mn = ms[ms.length - 1];
            if (ocup(mx) - ocup(mn) < 2) break;
            const cands = mx.s.map((j, i) => [j, i]).filter(x => x[0] && !movidos.has(x[0]));
            const livres = mn.s.map((j, i) => [j, i]).filter(x => !x[0]);
            if (!cands.length || !livres.length) break;
            const [j, i] = cands[Math.floor(Math.random() * cands.length)];
            const [, li] = livres[Math.floor(Math.random() * livres.length)];
            mx.s[i] = null; mn.s[li] = j; movidos.add(j);
            movs.push({ j, de: { m: mx.n, c: i + 1 }, para: { m: mn.n, c: li + 1 } });
        }
        return movs;
    }
    function sugestaoQuebra(M) {
        const occ = M.mesas.filter(m => ocup(m) > 0);
        const total = occ.reduce((a, m) => a + ocup(m), 0);
        if (occ.length < 2 || total > (occ.length - 1) * M.cad) return null;
        const alvo = occ.slice().sort((a, b) => ocup(a) - ocup(b) || b.n - a.n)[0];
        const outras = occ.filter(m => m.n !== alvo.n).map(m => ({ n: m.n, s: m.s.slice() }));
        const movs = [];
        alvo.s.forEach((j, i) => {
            if (!j) return;
            outras.sort((a, b) => ocup(a) - ocup(b));
            const d = outras[0]; const livres = d.s.map((x, k) => [x, k]).filter(x => !x[0]);
            const [, li] = livres[Math.floor(Math.random() * livres.length)];
            d.s[li] = j; movs.push({ j, de: { m: alvo.n, c: i + 1 }, para: { m: d.n, c: li + 1 } });
        });
        return { mesa: alvo.n, movs };
    }
    function sugestaoMesaFinal(M) {
        const occ = M.mesas.filter(m => ocup(m) > 0);
        const total = occ.reduce((a, m) => a + ocup(m), 0);
        const mf = Math.min(cfgClube().mesaFinal, M.cad);
        if (occ.length < 2 || total > mf || total < 2) return null;
        const destino = occ[0].n;
        const jogs = []; occ.forEach(m => m.s.forEach((j, i) => { if (j) jogs.push({ j, de: { m: m.n, c: i + 1 } }); }));
        const cadeiras = Array.from({ length: M.cad }, (_, i) => i + 1).sort(() => Math.random() - .5);
        return { mesa: destino, movs: jogs.map((x, k) => ({ j: x.j, de: x.de, para: { m: destino, c: cadeiras[k] } })) };
    }

    function renderAba(t) {
        const el = document.getElementById('lug-aba');
        if (!el || !sbOk() || !t || !isUuid(t.id)) return false;
        css(); ligarRealtime();
        const s = st(t.id);
        if (!s.ok) {
            el.innerHTML = '<div class="lg"><div class="lg-legend">Carregando mesas…</div></div>';
            carregar(t.id).then(() => { if (torneioAtivo() === t) desenhar(t); });
            return true;
        }
        desenhar(t);
        return true;
    }

    function desenhar(t) {
        const el = document.getElementById('lug-aba');
        if (!el) return;
        fecharPop();
        const M = modelo(t);
        limparEliminados(t);
        const livresTot = M.mesas.filter(m => ocup(m)).reduce((a, m) => a + m.s.filter(x => !x).length, 0);
        const qb = sugestaoQuebra(M), bal = qb ? [] : sugestaoBalancear(M), mf = sugestaoMesaFinal(M);
        let av = '';
        if (V.modo) av = `<div class="lg-al i">${V.modo.tipo === 'mover' ? '👉 Clique numa cadeira <b>livre</b> para mover' : '🔁 Clique em quem vai <b>trocar</b> com'} <b>${esc(nomeDe(V.modo.j))}</b>.<button class="lg-btn" data-a="cancelar">Cancelar</button></div>`;
        else if (mf) av = `<div class="lg-al w">🏆 Os ${M.sentados.size} jogadores cabem numa mesa só: <b>formar a mesa final</b> (sorteio das cadeiras).<button class="lg-btn gold" data-a="final">Formar mesa final</button></div>`;
        else if (qb) av = `<div class="lg-al w">💥 Dá para <b>quebrar a Mesa ${qb.mesa}</b>: os jogadores dela cabem nas outras mesas.<button class="lg-btn gold" data-a="quebrar">Quebrar mesa</button></div>`;
        else if (bal.length) { const o = M.mesas.filter(m => ocup(m)).sort((a, b) => ocup(b) - ocup(a)); av = `<div class="lg-al w">⚖️ Mesa ${o[0].n} com ${ocup(o[0])} e Mesa ${o[o.length - 1].n} com ${ocup(o[o.length - 1])}: mover ${bal.length} jogador(es).<button class="lg-btn gold" data-a="balancear">Balancear</button></div>`; }

        const pedT = PED.filter(p => p.torneio_id === t.id);
        if (!V.modo && pedT.length) av = `<div class="lg-al i">📱 Floor pediu a eliminação de <b>${pedT.map(p => esc(nomeDe(p.jogador_id))).join(', ')}</b>: confirme no aviso do canto da tela.</div>` + av;
        const sorteio = sorteioLigado(t.id);
        const tray = (M.semLugar.length || M.fora.length) ? `<div class="lg-tray">
            ${M.semLugar.length ? `<span class="lg-lbl" style="margin-right:.2rem">🪑 Sem lugar (${M.semLugar.length})</span>${M.semLugar.map(j => `<span class="lg-chip ${V.pegou === j ? 'on' : ''}" data-j="${esc(j)}" title="${esc(nomeDe(j))}"><i>${esc(ini(nomeDe(j)))}</i>${esc(nomeDe(j))}</span>`).join('')}` : ''}
            ${M.fora.length ? `<button class="lg-btn" data-a="verfora" style="padding:.25rem .55rem">${V.verFora ? '▾' : '▸'} Liberados (${M.fora.length})</button>${V.verFora ? M.fora.map(j => `<span class="lg-chip fora ${V.pegou === j ? 'on' : ''}" data-j="${esc(j)}" title="Liberado: saiu da mesa sem ser eliminado"><i>${esc(ini(nomeDe(j)))}</i>${esc(nomeDe(j))}</span>`).join('') : ''}` : ''}
            <span style="flex:1"></span>${M.semLugar.length ? '<span class="lg-legend">arraste até uma cadeira livre</span><button class="lg-btn pri" data-a="sortearTodos">🎲 Sortear lugares</button>' : ''}</div>` : '';

        const mesasVis = V.zoom === 'uma' ? M.mesas.filter(m => m.n === V.uma).concat(M.mesas.length && !M.mesas.some(m => m.n === V.uma) ? [M.mesas[0]] : []).slice(0, 1) : M.mesas;
        const mesaHtml = (m) => {
            const o = ocup(m);
            return `<div class="lg-mesa ${o === M.cad ? 'cheia' : o && o < M.cad - 3 ? 'curta' : ''}">
                <div class="lg-mh"><b>Mesa ${m.n}</b><span class="oc">${o}/${M.cad}</span><span class="acts">
                    ${V.zoom === 'uma' ? `<button data-a="prev" title="Mesa anterior">‹</button><button data-a="next" title="Próxima mesa">›</button>` : `<button data-a="ampliar" data-m="${m.n}">Ampliar</button>`}
                    <button data-a="imprimir1" data-m="${m.n}" title="Imprimir mapa desta mesa">🖨️</button>
                    ${o === 0 ? `<button data-a="fechar" data-m="${m.n}" title="Fechar mesa vazia">Fechar</button>` : ''}</span></div>
                <div class="lg-tbl"><div class="lg-felt"></div><div class="lg-logo">MESA<b>${m.n}</b>${o}/${M.cad}</div><span class="lg-dl" style="left:50%;top:84%">D</span>
                ${m.s.map((j, i) => {
                    const [x, y] = pos(i, M.cad);
                    const sel = V.sel && V.sel.m === m.n && V.sel.c === i + 1;
                    const alvo = (V.modo && V.modo.tipo === 'mover' && !j) || (V.modo && V.modo.tipo === 'trocar' && j && j !== V.modo.j) || (V.pegou && !j);
                    const nm = j ? nomeDe(j) : '';
                    return `<button class="lg-st ${j ? '' : 'livre'} ${sel ? 'sel' : ''} ${alvo ? 'alvo' : ''}" data-m="${m.n}" data-c="${i + 1}" ${j ? `data-j="${esc(j)}"` : ''} style="left:${x}%;top:${y}%" title="${j ? esc(nm) + ' · ' : ''}Mesa ${m.n} · Cadeira ${i + 1}"><span class="av">${j ? esc(ini(nm)) : (V.zoom === 'uma' ? '+' : i + 1)}</span><span class="nm">${j ? esc(nm) : 'livre'}</span><span class="no">CADEIRA ${i + 1}</span></button>`;
                }).join('')}</div></div>`;
        };

        el.innerHTML = `<div class="lg">
            <div class="lg-tb"><span class="lg-lbl">Distribuição de mesas</span>
                <span class="lg-kp"><span>Ativos <b>${M.ativos.length}</b></span><span>Mesas <b>${M.mesas.filter(m => ocup(m)).length}</b></span><span>Cadeiras livres <b>${livresTot}</b></span><span title="Sorteio de mesa e cadeira ao registrar o buy-in">Sorteio na entrada <b style="color:${sorteio ? '#22c55e' : '#71717a'}">${sorteio ? 'ligado' : 'desligado'}</b></span></span>
                <span class="sp"></span>
                <span class="lg-seg"><button data-z="todas" class="${V.zoom === 'todas' ? 'on' : ''}">Todas as mesas</button><button data-z="uma" class="${V.zoom === 'uma' ? 'on' : ''}">Uma mesa</button></span>
                <button class="lg-btn" data-a="imprimir">🖨️ Imprimir mapa</button>
                <button class="lg-btn" data-a="abrir">＋ Abrir mesa</button>
                <button class="lg-btn" data-a="config" title="Configuração de mesas">⚙</button></div>
            ${av}${tray}
            ${M.mesas.length ? `<div class="lg-grid ${V.zoom === 'uma' ? 'um' : ''}">${mesasVis.map(mesaHtml).join('')}</div>` : `<div class="lg-al i">Nenhuma mesa aberta ainda. ${M.semLugar.length ? 'Use <b>🎲 Sortear lugares</b> ou ' : ''}clique em <b>＋ Abrir mesa</b>.</div>`}
            <div class="lg-legend">Arraste para mover · arraste sobre outro jogador para trocar · clique no jogador para Liberar ou Eliminar · o floor vê e mexe nas mesmas mesas, em tempo real.</div>
        </div>`;
        ligar(t, el);
    }

    // Jogador eliminado que ainda aparece sentado (ex.: eliminado sem conexão): limpa uma vez
    function limparEliminados(t) {
        if (Date.now() - V._limpouEm < 20000) return;
        const s = st(t.id); const elim = new Set((t.eliminados || []).map(e => String(e.jogadorId))); const at = new Set(ativos(t));
        const ops = []; s.lugares.forEach((l, j) => { if (elim.has(j) && !at.has(j)) ops.push({ j, para: 'remover' }); });
        if (!ops.length) return;
        V._limpouEm = Date.now();
        enfileirar(() => aplicar(t, ops, 'limpeza'));
    }

    function ligar(t, el) {
        el.querySelectorAll('[data-z]').forEach(b => b.onclick = () => { V.zoom = b.dataset.z; if (V.zoom === 'uma' && V.uma == null) { const M = modelo(t); V.uma = (M.mesas[0] || {}).n; } desenhar(t); });
        el.querySelectorAll('[data-a]').forEach(b => b.onclick = (e) => acao(t, b.dataset.a, b, e));
        el.querySelectorAll('.lg-st').forEach(b => b.onpointerdown = (e) => arrastar(t, e, { m: +b.dataset.m, c: +b.dataset.c, j: b.dataset.j || null }));
        el.querySelectorAll('.lg-chip').forEach(c => c.onpointerdown = (e) => arrastar(t, e, { j: c.dataset.j, chip: true }));
    }

    async function acao(t, a, b, e) {
        const M = modelo(t);
        if (a === 'cancelar') { V.modo = null; V.sel = null; V.pegou = null; return desenhar(t); }
        if (a === 'verfora') { V.verFora = !V.verFora; return desenhar(t); }
        if (a === 'ampliar') { V.zoom = 'uma'; V.uma = +b.dataset.m; return desenhar(t); }
        if (a === 'prev' || a === 'next') { const ns = M.mesas.map(m => m.n); const k = ns.indexOf(V.uma); V.uma = ns[(k + (a === 'next' ? 1 : -1) + ns.length) % ns.length]; return desenhar(t); }
        if (a === 'imprimir') return imprimir(t, null);
        if (a === 'imprimir1') return imprimir(t, +b.dataset.m);
        if (a === 'config') return abrirConfig(t);
        if (a === 'fechar') { const n = +b.dataset.m; const ab = (st(t.id).estado.abertas || []).filter(x => x !== n); if (await salvarEstado(t, { p_abertas: ab })) { toast(`Mesa ${n} fechada`); if (V.uma === n) V.zoom = 'todas'; desenhar(t); } return; }
        if (a === 'abrir') {
            const usados = new Set(M.mesas.map(m => m.n)); let n = 1; while (usados.has(n)) n++;
            if (n > cfgClube().salao) return toast('⚠️ Todas as mesas do salão já estão abertas (ajuste em ⚙)');
            return dialogo(`<h3>Abrir Mesa ${n}?</h3><div class="note">${livresTot(M)} cadeira(s) livre(s) nas mesas abertas.</div><div class="rowb"><button class="lg-btn" data-x>Cancelar</button><button class="lg-btn pri" data-ok>Abrir mesa</button></div>`, async (fechar) => {
                const ab = [...new Set([...(st(t.id).estado.abertas || []), ...M.mesas.map(m => m.n), n])];
                fechar(); if (await salvarEstado(t, { p_abertas: ab })) { toast(`Mesa ${n} aberta`); desenhar(t); }
            });
        }
        if (a === 'sortearTodos') {
            const lista = M.semLugar.slice(); if (!lista.length) return;
            b.disabled = true; let ok = 0, sem = 0;
            for (const j of lista) { try { const r = await sortear(t, j, true); if (r.mesa) ok++; else sem++; } catch (err) { console.warn(err); sem++; } }
            toast(`🎲 ${ok} jogador(es) sentado(s)${sem ? ` · ${sem} sem cadeira livre` : ''}`);
            return desenhar(t);
        }
        if (a === 'balancear') { const movs = sugestaoBalancear(M); if (!movs.length) return; return confirmarMovs(t, '⚖️ Balancear mesas', 'Só quem precisa mudar de lugar:', movs, 'balancear'); }
        if (a === 'quebrar') { const q = sugestaoQuebra(M); if (!q) return; return confirmarMovs(t, `💥 Quebrar Mesa ${q.mesa}`, 'Sorteio nas cadeiras livres das outras mesas:', q.movs, 'quebrar', async () => { const ab = (st(t.id).estado.abertas || []).filter(x => x !== q.mesa); await salvarEstado(t, { p_abertas: ab }); if (V.uma === q.mesa) V.zoom = 'todas'; }); }
        if (a === 'final') { const f = sugestaoMesaFinal(M); if (!f) return; return confirmarMovs(t, '🏆 Formar mesa final', `Todos na Mesa ${f.mesa}, cadeiras sorteadas:`, f.movs, 'mesa_final', async () => { const ab = [f.mesa]; await salvarEstado(t, { p_abertas: ab }); V.zoom = 'uma'; V.uma = f.mesa; }); }
    }
    const livresTot = (M) => M.mesas.filter(m => ocup(m)).reduce((a, m) => a + m.s.filter(x => !x).length, 0);

    function confirmarMovs(t, titulo, sub, movs, acaoNome, depois) {
        const linhas = movs.map(m => `<div class="row"><span>${esc(nomeDe(m.j))}</span><b>M${m.de.m}·C${m.de.c} → M${m.para.m}·C${m.para.c}</b></div>`).join('');
        dialogo(`<h3>${titulo}</h3><div class="note">${sub}</div><div class="lg-mv">${linhas}</div><div class="rowb"><button class="lg-btn" data-print>🖨️ Imprimir</button><button class="lg-btn" data-x>Cancelar</button><button class="lg-btn pri" data-ok>Confirmar</button></div>`, async (fechar) => {
            fechar();
            if (await aplicar(t, movs, acaoNome)) { if (depois) await depois(); toast(`✅ ${movs.length} jogador(es) mudaram de lugar`); }
            desenhar(t);
        }, () => imprimirTexto(titulo.replace(/^\S+\s/, ''), movs.map(m => `${nomeDe(m.j)}\n   Mesa ${m.de.m} Cad ${m.de.c} -> Mesa ${m.para.m} Cad ${m.para.c}`).join('\n')));
    }

    function dialogo(html, onOk, onPrint) {
        const ov = document.createElement('div'); ov.className = 'lg-ov';
        ov.innerHTML = `<div class="lg-dlg">${html}</div>`;
        document.body.appendChild(ov);
        const fechar = () => ov.remove();
        ov.addEventListener('click', (e) => { if (e.target === ov) fechar(); });
        ov.querySelectorAll('[data-x]').forEach(b => b.onclick = fechar);
        const ok = ov.querySelector('[data-ok]'); if (ok) ok.onclick = () => onOk && onOk(fechar, ov);
        const pr = ov.querySelector('[data-print]'); if (pr && onPrint) pr.onclick = onPrint;
        return ov;
    }

    // ─── popover de cadeira / jogador ───
    let popEl = null;
    function fecharPop() { if (popEl) { popEl.remove(); popEl = null; } }
    document.addEventListener('pointerdown', (e) => { if (popEl && !e.target.closest('.lg-pop') && !e.target.closest('.lg-st')) { fecharPop(); if (V.sel && !V.modo) { V.sel = null; const t = torneioAtivo(); if (t && abaVisivel()) desenhar(t); } } });

    async function clique(t, alvo, ev) {
        const M = modelo(t);
        if (V.pegou) {
            if (alvo.j) return toast('Escolha uma cadeira livre');
            const j = V.pegou; V.pegou = null;
            if (await aplicar(t, [{ j, para: { m: alvo.m, c: alvo.c } }], 'sentar')) toast(`✅ ${nomeDe(j)} → Mesa ${alvo.m} · Cadeira ${alvo.c}`);
            return desenhar(t);
        }
        if (V.modo) {
            const md = V.modo;
            if (md.tipo === 'mover') { if (alvo.j) return toast('Escolha uma cadeira livre'); V.modo = null; V.sel = null; if (await aplicar(t, [{ j: md.j, de: md.de, para: { m: alvo.m, c: alvo.c } }], 'mover')) toast(`✅ ${nomeDe(md.j)} → Mesa ${alvo.m} · Cadeira ${alvo.c}`); return desenhar(t); }
            if (md.tipo === 'trocar') { if (!alvo.j || alvo.j === md.j) return toast('Clique em outro jogador'); V.modo = null; V.sel = null; if (await aplicar(t, [{ j: md.j, de: md.de, para: { m: alvo.m, c: alvo.c } }, { j: alvo.j, de: { m: alvo.m, c: alvo.c }, para: md.de }], 'trocar')) toast(`🔁 ${nomeDe(md.j)} ⇄ ${nomeDe(alvo.j)}`); return desenhar(t); }
        }
        V.sel = { m: alvo.m, c: alvo.c }; desenhar(t);
        popEl = document.createElement('div'); popEl.className = 'lg-pop';
        if (alvo.j) {
            const nm = nomeDe(alvo.j), nEnt = (t.entries || []).filter(e => String(e.jogadorId) === alvo.j && e.tipo !== 'addon').length;
            popEl.innerHTML = `<h4>${esc(nm)}</h4><div class="sub">Mesa ${alvo.m} · Cadeira ${alvo.c} · ${nEnt} entrada(s)</div><div class="acts">
                <button class="lg-btn" data-p="mover">↗ Mover</button><button class="lg-btn" data-p="trocar">🔁 Trocar</button>
                <button class="lg-btn" data-p="liberar">🪑 Liberar</button><button class="lg-btn bad" data-p="eliminar">✖ Eliminar</button></div>
                <div class="sub" style="margin:.45rem 0 0">Liberar = saiu da mesa sem ser eliminado (não ganha posição, não mexe em nada).</div>`;
        } else {
            const cands = M.semLugar.concat(M.fora).slice(0, 8);
            popEl.innerHTML = `<h4>Mesa ${alvo.m} · Cadeira ${alvo.c}</h4><div class="sub">Cadeira livre</div><div class="acts">${cands.map(j => `<button class="lg-btn pri" data-sentar="${esc(j)}" title="${esc(nomeDe(j))}" style="overflow:hidden;text-overflow:ellipsis">${esc(nomeDe(j).split(' ')[0])}</button>`).join('') || '<span class="sub">Ninguém sem lugar</span>'}</div>`;
        }
        document.body.appendChild(popEl);
        const w = 250, h = popEl.offsetHeight || 160;
        popEl.style.left = Math.max(8, Math.min(ev.clientX + 12, innerWidth - w - 8)) + 'px';
        popEl.style.top = Math.max(8, Math.min(ev.clientY + 12, innerHeight - h - 8)) + 'px';
        popEl.querySelectorAll('[data-sentar]').forEach(bt => bt.onclick = async () => { const j = bt.dataset.sentar; fecharPop(); V.sel = null; if (await aplicar(t, [{ j, para: { m: alvo.m, c: alvo.c } }], 'sentar')) toast(`✅ ${nomeDe(j)} → Mesa ${alvo.m} · Cadeira ${alvo.c}`); desenhar(t); });
        popEl.querySelectorAll('[data-p]').forEach(bt => bt.onclick = async () => {
            const p = bt.dataset.p; fecharPop();
            const de = { m: alvo.m, c: alvo.c };
            if (p === 'mover' || p === 'trocar') { V.modo = { tipo: p, j: alvo.j, de }; return desenhar(t); }
            V.sel = null;
            if (p === 'liberar') { if (await aplicar(t, [{ j: alvo.j, de, para: 'fora' }], 'liberar')) toast(`🪑 Cadeira liberada (${nomeDe(alvo.j)} não foi eliminado)`); return desenhar(t); }
            if (p === 'eliminar') {
                desenhar(t);
                try { openModalEliminarJogador(activeTorneioIdx, alvo.j); } catch (err) { console.warn(err); toast('Use o botão Eliminar Jogador do torneio'); }
            }
        });
    }

    // ─── arrastar (mouse e toque) ───
    function arrastar(t, e, src) {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        const x0 = e.clientX, y0 = e.clientY; let g = null, alvo = null;
        const nome = src.j ? nomeDe(src.j) : '';
        const mv = (ev) => {
            if (!g) {
                if (!src.j || Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
                g = document.createElement('div'); g.className = 'lg-ghost'; g.textContent = nome; document.body.appendChild(g);
                document.body.classList.add('lg-dragging'); fecharPop();
            }
            g.style.left = ev.clientX + 10 + 'px'; g.style.top = ev.clientY + 10 + 'px';
            document.querySelectorAll('.lg-st.drop').forEach(x => x.classList.remove('drop'));
            const el = document.elementFromPoint(ev.clientX, ev.clientY);
            alvo = el && el.closest('.lg-st');
            if (alvo && !src.chip && +alvo.dataset.m === src.m && +alvo.dataset.c === src.c) alvo = null;
            if (alvo) alvo.classList.add('drop');
        };
        const up = async (ev) => {
            removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
            document.body.classList.remove('lg-dragging');
            if (g) g.remove();
            if (!g) {
                if (src.chip) { V.pegou = V.pegou === src.j ? null : src.j; desenhar(t); if (V.pegou) toast('Agora clique numa cadeira livre'); return; }
                return clique(t, src, ev);
            }
            if (!alvo) return desenhar(t);
            const am = +alvo.dataset.m, ac = +alvo.dataset.c, aj = alvo.dataset.j || null;
            if (src.chip) {
                if (aj) { toast('Essa cadeira está ocupada'); return desenhar(t); }
                if (await aplicar(t, [{ j: src.j, para: { m: am, c: ac } }], 'sentar')) toast(`✅ ${nome} → Mesa ${am} · Cadeira ${ac}`);
                return desenhar(t);
            }
            const de = { m: src.m, c: src.c };
            if (aj) { if (await aplicar(t, [{ j: src.j, de, para: { m: am, c: ac } }, { j: aj, de: { m: am, c: ac }, para: de }], 'trocar')) toast(`🔁 ${nome} ⇄ ${nomeDe(aj)}`); }
            else if (await aplicar(t, [{ j: src.j, de, para: { m: am, c: ac } }], 'mover')) toast(`✅ ${nome} → Mesa ${am} · Cadeira ${ac}`);
            V.sel = null; desenhar(t);
        };
        addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
    }

    // ─── impressão ───
    function imprimirTexto(titulo, corpo) {
        try { abrirPreviewImpressao(titulo, corpo); } catch (e) { console.warn(e); toast('⚠️ Impressão indisponível'); }
    }
    function imprimir(t, so) {
        const M = modelo(t);
        const col = (typeof _printColWidth === 'function') ? _printColWidth() : 32;
        const L = (c) => (typeof _printLine === 'function') ? _printLine(c, col) : c.repeat(col);
        const C = (x) => (typeof _printCenter === 'function') ? _printCenter(x, col) : x;
        const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const ms = M.mesas.filter(m => so == null ? ocup(m) > 0 : m.n === so);
        if (!ms.length) return toast('Nenhuma mesa com jogadores');
        const txt = ms.map(m => {
            let s = (typeof _printHeaderCfg === 'function' ? _printHeaderCfg() : '') + C(`MAPA DA MESA ${m.n}`) + '\n' + C(String(t.nome || '').slice(0, col)) + '\n' + C('Conferencia do dealer - ' + hora) + '\n' + L('-') + '\n';
            m.s.forEach((j, i) => { s += (String(i + 1).padStart(2, ' ') + '  ' + (j ? nomeDe(j) : '-- livre --')).slice(0, col) + '\n'; });
            return s + L('-') + '\n' + C(`${ocup(m)} jogador(es)`) + '\n';
        }).join('\n\n' + L('=') + '\n\n');
        imprimirTexto(so == null ? 'Mapa das mesas' : `Mapa da Mesa ${so}`, txt);
    }

    // ─── configuração ───
    function abrirConfig(t) {
        const c = cfgClube(), e = st(t.id).estado;
        const admin = (() => { try { const p = String((window.currentUser || {}).papel || (window.currentUser || {}).role || '').toLowerCase(); return p === 'admin' || p === 'administrador' || p === 'gerente'; } catch (_) { return false; } })();
        const sv = e.sorteio_entrada === true ? 'sim' : e.sorteio_entrada === false ? 'nao' : 'padrao';
        const ov = dialogo(`<h3>⚙ Configuração de mesas</h3>
            <div class="lg-sec">Neste torneio</div>
            <div class="lg-f">
                <label>Sorteio de mesa na entrada<select data-k="t_sorteio"><option value="padrao" ${sv === 'padrao' ? 'selected' : ''}>Padrão do clube (${c.sorteioEntrada ? 'ligado' : 'desligado'})</option><option value="sim" ${sv === 'sim' ? 'selected' : ''}>Ligado</option><option value="nao" ${sv === 'nao' ? 'selected' : ''}>Desligado</option></select></label>
                <label>Cadeiras por mesa<input type="number" min="2" max="12" data-k="t_cad" value="${e.cadeiras || c.cadeiras}"></label>
            </div>
            <div class="lg-sec">Padrão do clube ${admin ? '' : '<span style="color:#9a9aa6;text-transform:none;letter-spacing:0">(só administrador altera)</span>'}</div>
            <div class="lg-f">
                <label>Cadeiras por mesa<input type="number" min="2" max="12" data-k="c_cad" value="${c.cadeiras}" ${admin ? '' : 'disabled'}></label>
                <label>Mesas no salão<input type="number" min="1" max="200" data-k="c_salao" value="${c.salao}" ${admin ? '' : 'disabled'}></label>
                <label>Jogadores na mesa final<input type="number" min="2" max="12" data-k="c_mf" value="${c.mesaFinal}" ${admin ? '' : 'disabled'}></label>
            </div>
            <label class="lg-ck"><input type="checkbox" data-k="c_sorteio" ${c.sorteioEntrada ? 'checked' : ''} ${admin ? '' : 'disabled'}><span><b>Sortear mesa e cadeira na entrada</b><small>Ao registrar o buy-in, o jogador já vai para a mesa aberta mais vazia, e o lugar sai na confirmação e no comprovante. Desligado: o floor senta os jogadores pela aba Mesas ou pelo app do floor.</small></span></label>
            <label class="lg-ck"><input type="checkbox" data-k="c_reent" ${c.reentradaMantem ? 'checked' : ''} ${admin ? '' : 'disabled'}><span><b>Na reentrada, manter a mesma cadeira</b><small>Só sorteia outra se a cadeira já tiver sido liberada. Rebuy e add-on sempre mantêm.</small></span></label>
            <label class="lg-ck"><input type="checkbox" data-k="c_auto" ${c.abrirAuto ? 'checked' : ''} ${admin ? '' : 'disabled'}><span><b>Abrir a próxima mesa sozinho quando as abertas lotarem</b><small>Desligado: o jogador fica em "Sem lugar" até alguém abrir a mesa.</small></span></label>
            <div class="lg-sec">App do floor (celular)</div>
            <div class="note">Endereço: <b style="color:#ececf0;user-select:all">${location.origin}/floor</b> · abra no celular e toque em "Adicionar à tela inicial". Login com o mesmo usuário do StackOS. Administradores sempre têm acesso.</div>
            <div id="lg-floor-users" class="lg-mv"><div class="note">${admin ? 'Carregando usuários…' : 'Só o administrador libera o acesso.'}</div></div>
            <div class="rowb"><button class="lg-btn" data-x>Cancelar</button><button class="lg-btn pri" data-ok>Salvar</button></div>`, async (fechar, ov) => {
            const q = (k) => ov.querySelector(`[data-k="${k}"]`);
            const tCad = Math.max(2, Math.min(12, parseInt(q('t_cad').value, 10) || c.cadeiras));
            const okT = await salvarEstado(t, { p_sorteio: q('t_sorteio').value, p_cadeiras: tCad !== c.cadeiras || e.cadeiras ? tCad : null });
            if (!okT) return;
            if (admin) {
                const novo = {
                    cadeiras: Math.max(2, Math.min(12, parseInt(q('c_cad').value, 10) || 9)),
                    salao: Math.max(1, Math.min(200, parseInt(q('c_salao').value, 10) || 50)),
                    mesaFinal: Math.max(2, Math.min(12, parseInt(q('c_mf').value, 10) || 9)),
                    sorteioEntrada: q('c_sorteio').checked, reentradaMantem: q('c_reent').checked, abrirAuto: q('c_auto').checked
                };
                try {
                    const { error } = await sb.from('clubes').update({ mesas_cfg: novo }).eq('id', sbClube.id);
                    if (error) throw error;
                    sbClube.mesas_cfg = novo;
                    try { if (typeof logAudit === 'function') logAudit('CONFIG_MESAS', 'Configuração de mesas do clube alterada', novo); } catch (_) {}
                } catch (err) { console.warn(err); toast('⚠️ Não foi possível salvar o padrão do clube'); return; }
            }
            fechar(); toast('✅ Configuração de mesas salva'); desenhar(t);
        });
        if (admin) (async () => {
            const box = ov.querySelector('#lg-floor-users'); if (!box) return;
            try {
                const { data, error } = await sb.rpc('floor_admin_usuarios'); if (error) throw error;
                const us = (data && data.usuarios) || [];
                box.innerHTML = us.map(u => `<label class="row" style="cursor:${u.papel === 'admin' ? 'default' : 'pointer'}"><span>${esc(u.nome || u.email)} <small style="color:#9a9aa6">${esc(u.papel || '')}</small></span><input type="checkbox" data-fu="${u.id}" ${u.permitido ? 'checked' : ''} ${u.papel === 'admin' ? 'disabled title="Administrador sempre tem acesso"' : ''} style="accent-color:#a855f7;width:18px;height:18px"></label>`).join('') || '<div class="note">Nenhum usuário.</div>';
                box.querySelectorAll('[data-fu]').forEach(ck => ck.onchange = async () => {
                    try { const r = await sb.rpc('floor_definir_permissao', { p_user_id: ck.dataset.fu, p_permitir: ck.checked }); if (r.error || !(r.data && r.data.ok)) throw r.error || new Error('erro'); toast(ck.checked ? '✅ Acesso ao app do floor liberado' : 'Acesso ao app do floor removido'); }
                    catch (err) { ck.checked = !ck.checked; toast('⚠️ Não foi possível alterar'); }
                });
            } catch (err) { box.innerHTML = '<div class="note">Não foi possível carregar os usuários.</div>'; }
        })();
        return ov;
    }

    window.Lugares = { aoEntrar, aoSair, textoComprovante, renderAba, carregar, _T: T, _modelo: modelo, _sugestaoBalancear: sugestaoBalancear, _sugestaoQuebra: sugestaoQuebra };

    // Pré-carrega os lugares do torneio aberto (para o comprovante já sair com a mesa)
    setInterval(() => { try { if (sbOk()) ligarRealtime(); } catch (_) {} try { const t = torneioAtivo(); if (t && isUuid(t.id) && sbOk() && !st(t.id).ok && !st(t.id).carregando) { ligarRealtime(); carregar(t.id); } } catch (_) {} }, 5000);
})();
