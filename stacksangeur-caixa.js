// =====================================================================
// StackSangeur — painel do CAIXA (carregado pelo app.html)
//
// Princípios (não negociáveis):
//  - Só liga no clube com clubes.feature_overrides.feature_sangeur === true
//    (checagem estrita; fora disso este arquivo não faz NADA).
//  - Não lança entrada nem mexe em transação/ficha por conta própria:
//    "Aceitar" abre o modal "Registrar Entrada" de sempre, preenchido,
//    e o caixa confirma normalmente. O painel só OBSERVA se a entrada
//    foi criada para marcar o pedido como aceito.
//  - Não altera nenhuma função existente do app.html; só chama as públicas
//    (openModalEntrada, atualizarResumoEntrada, _togglePagoNaHora, ...).
// =====================================================================
(function () {
    'use strict';
    if (window.__stackSangeurCaixa) return;
    window.__stackSangeurCaixa = true;

    const LADO_KEY = 'stacksangeur_lado';          // 'direita' | 'esquerda' | 'off'  (por computador)
    const EXP_KEY = 'stacksangeur_painel_exp';     // '1' expandido | '0' recolhido
    const SOM_KEY = 'stacksangeur_som';            // '0' desliga o som
    const PEND_KEY = 'stacksangeur_concluir_pend'; // aceites que não chegaram ao servidor (reenvio)
    const LARGURA = 340, FAIXA = 58, MARGEM = 20;
    const TIPO_NOME = { reentry: 'Reentrada', rebuy_simples: 'Rebuy simples', rebuy_duplo: 'Rebuy duplo', addon: 'Add-on', last_chance: 'Last Chance' };
    const PAG_NOME = { dinheiro: 'Dinheiro', pix: 'PIX', debito: 'Débito', credito: 'Crédito', cheque: 'Cheque' };

    let clubeAtivo = null, canal = null, pedidos = [], pollT = null, renderT = null, carregarT = null;
    let fluxo = null;            // lançamento em andamento { p, tid, antes:Set, pagto, abriu }
    let recusando = null;        // id do pedido com o campo de motivo aberto
    let aba = 'pedidos';         // 'pedidos' | 'pochete'
    let poc = [];                // pochetes das sangeurs (sangeur_pochete)
    let movAberto = null;        // { sid, tipo:'carga'|'devolucao' } com o campo de fichas aberto
    let primeiraCarga = true, _audio = null, _obs = null;
    const vistos = new Set();

    // ---------- utilidades ----------
    const LSg = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } };
    const LSs = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
    const $ = (id) => document.getElementById(id);
    const e = (s) => (s == null ? '' : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]));
    const money = (v) => { const n = Number(v) || 0; return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }); };
    const toast = (m) => { try { if (typeof showToast === 'function') showToast(m); } catch (_) {} };
    const pNome = (n) => String(n || '').trim().split(/\s+/)[0] || '';
    const meuId = () => (window.currentUser && window.currentUser.id) || null;
    const modalAberto = (id) => { const m = $(id); return !!(m && m.classList.contains('open')); };
    function liberado() {
        const c = window.sbClube;
        return !!(c && c.feature_overrides && c.feature_overrides.feature_sangeur === true);
    }
    function lado() { const l = LSg(LADO_KEY, 'direita'); return ['direita', 'esquerda', 'off'].includes(l) ? l : 'direita'; }
    function telaLarga() { return window.innerWidth >= 1480; }
    function telaPequena() { return window.innerWidth < 900; }
    function expandido() { const v = LSg(EXP_KEY, null); return v == null ? telaLarga() : v === '1'; }
    function haQuanto(iso) {
        const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
        if (s < 60) return 'há ' + s + 's';
        const m = Math.floor(s / 60); if (m < 60) return 'há ' + m + 'min' + (s % 60 && m < 5 ? ' ' + (s % 60) + 's' : '');
        return 'há ' + Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'min' : '');
    }
    function idxTorneio(id) { try { return (typeof torneios !== 'undefined' ? torneios : []).findIndex(t => t && t.id === id); } catch (_) { return -1; } }
    function torneioPorId(id) { const i = idxTorneio(id); return i >= 0 ? torneios[i] : null; }
    function idxAtivo() { try { return typeof activeTorneioIdx !== 'undefined' ? activeTorneioIdx : null; } catch (_) { return null; } }

    function bip() {
        if (LSg(SOM_KEY, '1') === '0') return;
        try {
            if (!_audio) _audio = new (window.AudioContext || window.webkitAudioContext)();
            if (_audio.state === 'suspended') _audio.resume();
            [660, 990].forEach((f, i) => {
                const o = _audio.createOscillator(), g = _audio.createGain(), t0 = _audio.currentTime + i * 0.17;
                o.frequency.value = f; o.type = 'sine';
                g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);
                o.connect(g).connect(_audio.destination); o.start(t0); o.stop(t0 + 0.17);
            });
        } catch (_) {}
    }

    // ---------- ciclo de vida (liga/desliga conforme o clube logado) ----------
    function verificar() {
        const id = window.sbClube && window.sbClube.id;
        if (liberado() && id) { if (clubeAtivo !== id) { parar(); iniciar(id); } else mostrarMenu(true); }
        else if (clubeAtivo) parar();
    }
    setInterval(verificar, 3000);
    window.addEventListener('stackos:logged-in', () => setTimeout(verificar, 500));

    function iniciar(id) {
        clubeAtivo = id; primeiraCarga = true; vistos.clear(); pedidos = [];
        montarDom();
        try {
            canal = sb.channel('stacksangeur-caixa-' + id)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'sangeur_solicitacoes', filter: 'clube_id=eq.' + id }, () => agendarCarga())
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sangeur_fichas_mov', filter: 'clube_id=eq.' + id }, (pl) => {
                    const n = pl && pl.new;
                    if (n && n.tipo === 'contagem') toast('🪙 ' + pNome(n.criado_nome) + ' informou ' + (Number(n.quantidade) || 0).toLocaleString('pt-BR') + ' fichas');
                    carregarPochete();
                })
                .subscribe();
        } catch (err) { console.warn('[SANGEUR] realtime:', err); }
        carregar(); carregarPochete();
        pollT = setInterval(() => { carregar(); reenviarPendentes(); if (aba === 'pochete') carregarPochete(); }, 30000);
        renderT = setInterval(render, 5000);   // atualiza o "há X min"
        _obs = new MutationObserver(onModais);
        ['modal-torneio', 'modal-entrada'].forEach(mid => { const m = $(mid); if (m) _obs.observe(m, { attributes: true, attributeFilter: ['class'] }); });
        window.addEventListener('resize', posicionar);
        document.addEventListener('click', capturaConfirmar, true);
        mostrarMenu(true);
        reenviarPendentes();
    }
    function parar() {
        try { if (canal) sb.removeChannel(canal); } catch (_) {}
        canal = null; clearInterval(pollT); clearInterval(renderT); clearTimeout(carregarT);
        if (_obs) { _obs.disconnect(); _obs = null; }
        window.removeEventListener('resize', posicionar);
        document.removeEventListener('click', capturaConfirmar, true);
        restaurarPadding();
        ['sg-painel', 'sg-flutuante'].forEach(i => { const el = $(i); if (el) el.remove(); });
        mostrarMenu(false);
        clubeAtivo = null; pedidos = []; fluxo = null;
    }

    // Item "StackSangeur" no menu lateral (só admin), abre a página de configuração
    function mostrarMenu(on) {
        const existente = $('nav-stacksangeur');
        if (!on || !window.currentUser || String(window.currentUser.papel || '').toLowerCase() !== 'admin') { if (existente) existente.remove(); return; }
        if (existente) return;
        const ref = $('nav-stackbar') || $('nav-stackclock') || $('nav-config');
        if (!ref || !ref.parentNode) return;
        const a = document.createElement('a');
        a.id = 'nav-stacksangeur'; a.href = '/stacksangeur-painel.html'; a.target = '_blank'; a.className = 'nav-item';
        a.style.cssText = 'display:flex;align-items:center;gap:.75rem;padding:.7rem 1rem;border-radius:.5rem;font-size:.85rem;font-weight:700;color:#a1a1aa;text-decoration:none;';
        a.innerHTML = '<i class="fa-solid fa-coins nav-ico" style="width:16px;color:#a855f7;"></i> StackSangeur';
        ref.parentNode.insertBefore(a, ref.nextSibling);
    }

    // ---------- dados ----------
    function agendarCarga() { clearTimeout(carregarT); carregarT = setTimeout(() => { carregar(); carregarPochete(); }, 250); }
    async function carregarPochete() {
        if (!clubeAtivo) return;
        try { const d = await rpc('sangeur_pochete', {}); if (d && d.ok) { poc = d.sangeurs || []; render(); } }
        catch (err) { console.warn('[SANGEUR] pochete:', err); }
    }
    const fN = (n) => (Number(n) || 0).toLocaleString('pt-BR');
    function pocheteHtml() {
        if (!poc.length) return '<div class="sg-vazio">Nenhuma sangeur com permissão.<br>Libere em <a href="/stacksangeur-painel.html" target="_blank" style="color:#c4b5fd">Configurações</a>.</div>';
        return poc.map(x => {
            const cont = x.contagem, temCarga = Number(x.cargas) > 0;
            const atual = x.atual == null ? null : Number(x.atual);
            const hr = (t) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            let h = '<div class="sg-card"><div class="sg-l1"><div style="min-width:0"><div class="sg-nm">' + e(x.nome) + '</div>' +
                '<div class="sg-sub">' + (cont ? 'Tinha ' + fN(cont.quantidade) + ' às ' + hr(cont.em) : (temCarga ? 'Sem contagem · pelo que o caixa entregou' : 'Ainda não informou as fichas')) + '</div></div>' +
                '<div><div class="sg-val" style="color:' + (atual != null && atual < 0 ? '#fca5a5' : '#fafafa') + '">' + (atual == null ? '—' : fN(atual)) + '</div><div class="sg-tp">com ela agora</div></div></div>';
            if (cont) {
                const dist = Number(cont.entregues_desde) || 0, rec = Number(cont.cargas_desde) || 0, dev = Number(cont.devolucoes_desde) || 0;
                const topo = (Number(cont.quantidade) || 0) + rec;
                h += '<div style="height:6px;border-radius:99px;background:#231e33;overflow:hidden"><i style="display:block;height:100%;width:' + (topo > 0 ? Math.max(0, Math.min(100, (atual / topo) * 100)) : 0).toFixed(1) + '%;background:linear-gradient(90deg,#c06cff,#5b5bff)"></i></div>';
                h += '<div class="sg-info">Distribuiu ' + fN(dist) + ' desde a contagem' + (rec ? ' · recebeu +' + fN(rec) : '') + (dev ? ' · devolveu ' + fN(dev) : '') + '</div>';
                if (temCarga) {
                    const esp = Number(cont.esperado_na_contagem) || 0, dif = Number(cont.quantidade) - esp;
                    h += dif === 0 ? '<div class="sg-info" style="color:#86efac;font-weight:700">✓ Na contagem, bateu com o sistema (' + fN(esp) + ')</div>'
                                   : '<div class="sg-info" style="color:#fca5a5;font-weight:700">Na contagem: diferença de ' + (dif > 0 ? '+' : '−') + fN(Math.abs(dif)) + ' · sistema ' + fN(esp) + '</div>';
                }
            }
            h += '<div class="sg-info">Turno: recebeu ' + fN(x.cargas) + ' · entregou ' + fN(x.entregues) + ' · devolveu ' + fN(x.devolucoes) + (Number(x.dinheiro) > 0 ? ' · ' + money(x.dinheiro) + ' em dinheiro' : '') + '</div>';
            if (movAberto && movAberto.sid === x.sangeur_id) {
                h += '<input class="sg-mot sg-qtd" data-sid="' + x.sangeur_id + '" inputmode="numeric" style="border-color:#4c2f7a;background:#0c0a12;font-family:\'JetBrains Mono\',monospace" placeholder="' + (movAberto.tipo === 'carga' ? 'Fichas entregues a ela' : 'Fichas recebidas de volta') + '">' +
                     '<div class="sg-bts"><button type="button" class="sg-ok" data-a="mov-ok" data-sid="' + x.sangeur_id + '">' + (movAberto.tipo === 'carga' ? 'Confirmar entrega' : 'Confirmar devolução') + '</button>' +
                     '<button type="button" class="sg-ok sg-sec" style="flex:0 0 80px" data-a="mov-voltar">Voltar</button></div>';
            } else {
                h += '<div class="sg-bts"><button type="button" class="sg-ok sg-sec" data-a="mov-abrir" data-tipo="carga" data-sid="' + x.sangeur_id + '">Entregar fichas</button>' +
                     '<button type="button" class="sg-ok sg-sec" data-a="mov-abrir" data-tipo="devolucao" data-sid="' + x.sangeur_id + '">Receber de volta</button></div>';
            }
            return h + '</div>';
        }).join('');
    }
    async function confirmarMov(sid, valor) {
        const n = parseInt(String(valor || '').replace(/\D/g, ''), 10) || 0;
        if (!movAberto || n <= 0) { toast('⚠️ Digite a quantidade de fichas'); return; }
        try {
            const d = await rpc('sangeur_caixa_mov_fichas', { p_sangeur: sid, p_tipo: movAberto.tipo, p_quantidade: n });
            if (!d || !d.ok) throw new Error((d && d.erro) || 'erro');
            toast(movAberto.tipo === 'carga' ? '🪙 ' + fN(n) + ' fichas entregues à sangeur' : '🪙 Devolução de ' + fN(n) + ' fichas registrada');
            movAberto = null; carregarPochete();
        } catch (err) { toast('⚠️ Não salvou: ' + (err.message || 'sem conexão')); }
    }
    async function carregar() {
        if (!clubeAtivo) return;
        try {
            const { data, error } = await sb.from('sangeur_solicitacoes')
                .select('id,torneio_id,jogador_id,jogador_nome,tipo,quantidade,valor_estimado,forma_pagto,sangeur_id,sangeur_nome,status,criado_em,processando_em,processando_por')
                .eq('clube_id', clubeAtivo).in('status', ['pendente', 'processando'])
                .order('criado_em', { ascending: true }).limit(100);
            if (error) throw error;
            const novos = (data || []);
            let chegouNovo = false;
            novos.forEach(p => { if (!vistos.has(p.id)) { vistos.add(p.id); if (!primeiraCarga && p.status === 'pendente') chegouNovo = true; } });
            primeiraCarga = false;
            pedidos = novos;
            if (chegouNovo) { bip(); piscarTitulo(); }
            recuperarMeusProcessando();
            render();
        } catch (err) { console.warn('[SANGEUR] carregar:', err); }
    }

    // Pedido que ficou "em lançamento" comigo (página recarregada no meio, queda de luz...):
    // se a entrada já existe localmente, conclui; senão deixa o botão "Retomar".
    function recuperarMeusProcessando() {
        if (fluxo) return;
        pedidos.filter(p => p.status === 'processando' && p.processando_por === meuId()).forEach(p => {
            const t = torneioPorId(p.torneio_id); if (!t) return;
            const desde = new Date(p.processando_em || p.criado_em).getTime() - 5000;
            const feitas = (t.entries || []).filter(x => String(x.jogadorId) === String(p.jogador_id) && x.tipo === p.tipo && Number(x.ts) >= desde);
            if (feitas.length) concluir(p, feitas.map(x => x.id).join(','), null);
        });
    }

    // ---------- DOM ----------
    function montarDom() {
        if (!$('sg-estilo')) {
            const st = document.createElement('style'); st.id = 'sg-estilo';
            st.textContent = `
#sg-painel{position:fixed;top:1.5rem;bottom:1.5rem;display:none;flex-direction:column;background:#110f19;border:1px solid #3b2a5c;border-radius:16px;overflow:hidden;font-family:'Manrope',system-ui,sans-serif;color:#e4e4e7;box-shadow:0 20px 50px rgba(0,0,0,.45)}
#sg-painel.sg-faixa{cursor:pointer;align-items:center;gap:12px;padding:16px 0}
#sg-painel .sg-h{padding:14px 14px 12px;border-bottom:1px solid #231e33;display:flex;align-items:center;gap:8px}
#sg-painel .sg-h b{flex:1;font-size:14.5px;font-weight:800;color:#fafafa}
#sg-painel .sg-ib{width:32px;height:32px;border-radius:9px;border:1px solid #33294a;background:none;color:#b4adc8;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:13px}
#sg-painel .sg-ib:hover{color:#fff;border-color:#a855f7}
#sg-painel .sg-lista{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
#sg-painel .sg-card{background:#0c0a12;border:1px solid #27213a;border-radius:12px;padding:11px 12px;display:flex;flex-direction:column;gap:8px}
#sg-painel .sg-card.sg-atr{border-color:#7c5a12;box-shadow:inset 3px 0 0 #f59e0b}
#sg-painel .sg-card.sg-proc{border-color:#4c2f7a;opacity:.85}
#sg-painel .sg-l1{display:flex;justify-content:space-between;gap:8px}
#sg-painel .sg-nm{font-size:14px;font-weight:800;color:#fafafa;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#sg-painel .sg-sub{font-size:11.5px;color:#a1a1aa;margin-top:2px}
#sg-painel .sg-val{font:700 14.5px 'JetBrains Mono',ui-monospace,monospace;color:#fbbf24;text-align:right;white-space:nowrap}
#sg-painel .sg-tp{font-size:11px;font-weight:700;color:#71717a;text-align:right}
#sg-painel .sg-tp.sg-x{color:#f59e0b}
#sg-painel .sg-info{font-size:11.5px;color:#9a93b0}
#sg-painel .sg-bts{display:flex;gap:8px}
#sg-painel .sg-ok{flex:1;height:38px;border:none;border-radius:10px;background:#22c55e;color:#052e16;font:800 13px 'Manrope',sans-serif;cursor:pointer}
#sg-painel .sg-ok.sg-sec{background:none;border:1px solid #4c2f7a;color:#c4b5fd}
#sg-painel .sg-no{width:90px;height:38px;border:1px solid #3f1d1d;border-radius:10px;background:none;color:#fca5a5;font:700 12.5px 'Manrope',sans-serif;cursor:pointer}
#sg-painel .sg-mot{width:100%;height:36px;border-radius:9px;border:1px solid #3f1d1d;background:#140c0c;color:#fff;padding:0 10px;font:600 13px 'Manrope',sans-serif;outline:none}
#sg-painel .sg-vazio{color:#71717a;font-size:12.5px;text-align:center;padding:28px 10px;line-height:1.5}
#sg-painel .sg-rod{padding:10px 12px;border-top:1px solid #231e33;font-size:11px;color:#71717a;display:flex;gap:8px;align-items:center}
#sg-painel .sg-badge{font:700 13px 'JetBrains Mono',monospace;color:#1a1306;background:#fbbf24;border-radius:999px;min-width:30px;height:30px;padding:0 9px;display:flex;align-items:center;justify-content:center}
#sg-painel .sg-badge.sg-zero{background:#231e33;color:#9a93b0}
#sg-painel .sg-vert{writing-mode:vertical-rl;transform:rotate(180deg);font:800 11.5px 'Manrope',sans-serif;color:#a855f7;letter-spacing:1.4px}
#sg-flutuante{position:fixed;right:22px;bottom:22px;z-index:90;display:none;align-items:center;gap:10px;background:#110f19;border:1px solid #7c5a12;color:#fde68a;border-radius:999px;padding:10px 16px 10px 12px;font:800 13px 'Manrope',sans-serif;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.45)}
#sg-flutuante .sg-badge{font:700 13px 'JetBrains Mono',monospace;color:#1a1306;background:#fbbf24;border-radius:999px;min-width:28px;height:28px;padding:0 8px;display:flex;align-items:center;justify-content:center}
#sg-entrada-aviso{background:rgba(168,85,247,.08);border:1px solid rgba(168,85,247,.4);border-radius:.6rem;padding:.65rem .8rem;font-size:.8rem;color:#ede9fe;line-height:1.45}
#sg-entrada-aviso b{color:#c4b5fd}
#sg-entrada-aviso .sg-warn{color:#fbbf24;font-weight:700}
`;
            document.head.appendChild(st);
        }
        if (!$('sg-painel')) {
            const a = document.createElement('div'); a.id = 'sg-painel'; a.setAttribute('role', 'complementary'); a.setAttribute('aria-label', 'Solicitações da sangeur');
            a.addEventListener('click', cliquePainel);
            a.addEventListener('keydown', (ev) => {
                if (ev.key !== 'Enter') return;
                if (ev.target.classList.contains('sg-qtd')) { ev.preventDefault(); confirmarMov(ev.target.dataset.sid, ev.target.value); return; }
                if (ev.target.classList.contains('sg-mot')) { ev.preventDefault(); confirmarRecusa(ev.target.dataset.id, ev.target.value); }
            });
            a.addEventListener('input', (ev) => { if (!ev.target.classList.contains('sg-qtd')) return; const n = parseInt(ev.target.value.replace(/\D/g, ''), 10) || 0; ev.target.value = n ? n.toLocaleString('pt-BR') : ''; });
            document.body.appendChild(a);
        }
        if (!$('sg-flutuante')) {
            const f = document.createElement('button'); f.id = 'sg-flutuante'; f.type = 'button';
            f.addEventListener('click', abrirTorneioDoPrimeiro);
            document.body.appendChild(f);
        }
    }

    function onModais(muts) {
        const mudouEntrada = muts.some(m => m.target.id === 'modal-entrada');
        if (mudouEntrada && fluxo && fluxo.abriu && !modalAberto('modal-entrada')) setTimeout(finalizarFluxo, 350);
        render();
    }

    function restaurarPadding() {
        const ov = $('modal-torneio'); if (!ov) return;
        if (ov.dataset.sgPad) { ov.style.paddingLeft = ''; ov.style.paddingRight = ''; delete ov.dataset.sgPad; }
    }
    function posicionar() {
        const a = $('sg-painel'), ov = $('modal-torneio');
        if (!a) return;
        const vis = !!clubeAtivo && lado() !== 'off' && modalAberto('modal-torneio');
        if (!vis) { a.style.display = 'none'; restaurarPadding(); return; }
        const exp = expandido(), larg = exp ? LARGURA : FAIXA;
        // Tela estreita (celular/tablet): sem faixa — só o aviso flutuante, que abre o painel como gaveta
        if (telaPequena()) {
            restaurarPadding();
            if (!exp) { a.style.display = 'none'; return; }
            a.style.display = 'flex'; a.classList.remove('sg-faixa');
            a.style.width = Math.min(LARGURA, window.innerWidth - 24) + 'px';
            a.style.left = lado() === 'esquerda' ? '12px' : ''; a.style.right = lado() === 'direita' ? '12px' : '';
            a.style.zIndex = String((parseInt(ov.style.zIndex, 10) || 100) + 5);
            return;
        }
        a.style.display = 'flex';
        a.style.width = larg + 'px';
        a.style.left = lado() === 'esquerda' ? MARGEM + 'px' : '';
        a.style.right = lado() === 'direita' ? MARGEM + 'px' : '';
        a.style.zIndex = String((parseInt(ov.style.zIndex, 10) || 100) + 5);
        a.classList.toggle('sg-faixa', !exp);
        // Abre espaço ao lado do torneio só se a sobra natural da tela não comportar o painel
        // (painel aberto em tela estreita flutua por cima, como gaveta).
        ov.style.paddingLeft = ''; ov.style.paddingRight = '';
        const box = ov.firstElementChild;
        const bw = box ? box.getBoundingClientRect().width : 1100;
        const livre = (window.innerWidth - bw) / 2;
        const precisa = larg + MARGEM + 8;
        const reserva = (exp && !telaLarga()) || livre >= precisa ? 0 : (precisa + 12);
        ov.dataset.sgPad = '1';
        ov.style.paddingLeft = lado() === 'esquerda' && reserva ? reserva + 'px' : '';
        ov.style.paddingRight = lado() === 'direita' && reserva ? reserva + 'px' : '';
    }

    function linhaInfo(p) {
        const sg = pNome(p.sangeur_nome) || 'Sangeur';
        if (p.forma_pagto) return e(sg) + ' informou: ' + (PAG_NOME[p.forma_pagto] || e(p.forma_pagto));
        return e(sg) + ' · pagamento no caixa';
    }
    function cardHtml(p) {
        const seg = (Date.now() - new Date(p.criado_em).getTime()) / 1000;
        const atrasado = p.status === 'pendente' && seg > 60;
        const t = torneioPorId(p.torneio_id);
        const outroCaixa = p.status === 'processando' && p.processando_por !== meuId();
        const meu = p.status === 'processando' && p.processando_por === meuId();
        const noTorneioAberto = modalAberto('modal-torneio') && idxAtivo() === idxTorneio(p.torneio_id);
        let h = '<div class="sg-card' + (atrasado ? ' sg-atr' : '') + (outroCaixa ? ' sg-proc' : '') + '">' +
            '<div class="sg-l1"><div style="min-width:0"><div class="sg-nm">' + e(p.jogador_nome) + '</div>' +
            '<div class="sg-sub">' + (TIPO_NOME[p.tipo] || e(p.tipo)) + (p.quantidade > 1 ? ' ' + p.quantidade + 'x' : '') + (t ? ' · ' + e(t.nome) : '') + '</div></div>' +
            '<div><div class="sg-val">' + (Number(p.valor_estimado) > 0 ? money(p.valor_estimado) : 'cortesia') + '</div><div class="sg-tp' + (atrasado ? ' sg-x' : '') + '">' + haQuanto(p.criado_em) + '</div></div></div>' +
            '<div class="sg-info">' + linhaInfo(p) + '</div>';
        if (recusando === p.id) {
            h += '<input class="sg-mot" data-id="' + p.id + '" maxlength="140" placeholder="Motivo (a sangeur vê no celular)">' +
                 '<div class="sg-bts"><button type="button" class="sg-no" style="flex:1;width:auto" data-a="recusar-ok" data-id="' + p.id + '">Confirmar recusa</button>' +
                 '<button type="button" class="sg-ok sg-sec" style="flex:0 0 80px" data-a="recusar-voltar">Voltar</button></div>';
        } else if (outroCaixa) {
            const min = (Date.now() - new Date(p.processando_em).getTime()) / 60000;
            h += '<div class="sg-info" style="color:#c4b5fd">Em lançamento por outro caixa</div>';
            if (min > 2) h += '<div class="sg-bts"><button type="button" class="sg-ok sg-sec" data-a="assumir" data-id="' + p.id + '">Assumir (parado há ' + Math.floor(min) + ' min)</button></div>';
        } else if (fluxo && fluxo.p.id === p.id) {
            h += '<div class="sg-info" style="color:#c4b5fd">Lançando agora — confirme no “Registrar Entrada”</div>';
        } else if (!t) {
            h += '<div class="sg-info" style="color:#fbbf24">Torneio não carregado neste computador</div>' +
                 '<div class="sg-bts"><button type="button" class="sg-no" style="flex:1;width:auto" data-a="recusar" data-id="' + p.id + '">Recusar</button></div>';
        } else if (!noTorneioAberto) {
            h += '<div class="sg-bts"><button type="button" class="sg-ok sg-sec" data-a="abrir" data-id="' + p.id + '">Abrir torneio</button>' +
                 '<button type="button" class="sg-no" data-a="recusar" data-id="' + p.id + '">Recusar</button></div>';
        } else {
            h += '<div class="sg-bts"><button type="button" class="sg-ok" data-a="aceitar" data-id="' + p.id + '">' + (meu ? 'Retomar' : 'Aceitar') + '</button>' +
                 '<button type="button" class="sg-no" data-a="' + (meu ? 'liberar' : 'recusar') + '" data-id="' + p.id + '">' + (meu ? 'Devolver' : 'Recusar') + '</button></div>';
        }
        return h + '</div>';
    }

    function render() {
        const a = $('sg-painel'), f = $('sg-flutuante');
        if (!a || !clubeAtivo) return;
        posicionar();
        const n = pedidos.filter(p => p.status === 'pendente').length;
        const total = pedidos.length;
        // Aviso flutuante: torneio fechado e há pedidos esperando
        const torneioFechado = !modalAberto('modal-torneio');
        if (f) {
            const gaveta = !torneioFechado && telaPequena() && !expandido() && lado() !== 'off' && !modalAberto('modal-entrada');
            const mostra = gaveta || (torneioFechado && n > 0 && lado() !== 'off' && !document.querySelector('.modal-overlay.open'));
            f.style.display = mostra ? 'flex' : 'none';
            f.style.zIndex = gaveta ? String((parseInt(($('modal-torneio') || {}).style?.zIndex, 10) || 100) + 6) : '90';
            if (mostra) f.innerHTML = '<span class="sg-badge">' + n + '</span>Sangeur · ' + (n === 1 ? '1 pedido esperando' : n + ' pedidos esperando');
        }
        if (a.style.display === 'none') return;
        // mantém o texto que o caixa está digitando no motivo
        const motAtual = recusando ? (a.querySelector('.sg-mot') || {}).value : null;
        if (!expandido()) {
            a.innerHTML = '<span class="sg-badge' + (n ? '' : ' sg-zero') + '">' + n + '</span><span class="sg-vert">SANGEUR' + (n ? ' · ' + n + (n === 1 ? ' PENDENTE' : ' PENDENTES') : '') + '</span>';
            a.title = 'Abrir solicitações da sangeur';
            return;
        }
        a.title = '';
        const som = LSg(SOM_KEY, '1') !== '0';
        const abaBt = (id, txt) => '<button type="button" data-a="aba-' + id + '" style="height:32px;padding:0 10px;border-radius:9px;border:1px solid ' + (aba === id ? '#a855f7' : '#33294a') + ';background:' + (aba === id ? 'rgba(168,85,247,.16)' : 'none') + ';color:' + (aba === id ? '#e9d5ff' : '#9a93b0') + ';font:800 12.5px Manrope,sans-serif;cursor:pointer;display:flex;align-items:center;gap:6px">' + txt + '</button>';
        let h = '<div class="sg-h"><div style="flex:1;display:flex;gap:6px">' + abaBt('pedidos', 'Pedidos <span class="sg-badge' + (n ? '' : ' sg-zero') + '" style="min-width:20px;height:20px;font-size:11px;padding:0 6px">' + n + '</span>') + abaBt('pochete', 'Pochetes') + '</div>' +
            '<button type="button" class="sg-ib" data-a="som" title="' + (som ? 'Som ligado' : 'Som desligado') + '"><i class="fa-solid ' + (som ? 'fa-volume-high' : 'fa-volume-xmark') + '"></i></button>' +
            '<button type="button" class="sg-ib" data-a="lado" title="Mudar de lado"><i class="fa-solid fa-right-left"></i></button>' +
            '<button type="button" class="sg-ib" data-a="recolher" title="Recolher"><i class="fa-solid fa-chevron-' + (lado() === 'esquerda' ? 'left' : 'right') + '"></i></button></div>';
        h += '<div class="sg-lista">';
        if (aba === 'pochete') {
            h += pocheteHtml() + '</div><div class="sg-rod"><span style="flex:1">Fichas do turno (últimas 18h) · a sangeur informa a contagem pelo celular</span></div>';
            const qAtual = movAberto ? (a.querySelector('.sg-qtd') || {}).value : null;
            a.innerHTML = h;
            if (movAberto) { const i = a.querySelector('.sg-qtd'); if (i) { if (qAtual) i.value = qAtual; if (document.activeElement !== i) i.focus(); } }
            return;
        }
        if (!total) h += '<div class="sg-vazio">Nenhum pedido agora.<br>Quando a sangeur pedir pelo celular, aparece aqui com som.</div>';
        // pedidos do torneio aberto primeiro
        const aberto = (modalAberto('modal-torneio') && idxAtivo() != null && torneios[idxAtivo()]) ? torneios[idxAtivo()].id : null;
        pedidos.slice().sort((x, y) => (x.torneio_id === aberto ? 0 : 1) - (y.torneio_id === aberto ? 0 : 1) || new Date(x.criado_em) - new Date(y.criado_em))
            .forEach(p => { h += cardHtml(p); });
        h += '</div><div class="sg-rod"><span style="flex:1">Lado e modos em <a href="/stacksangeur-painel.html" target="_blank" style="color:#c4b5fd">Configurações</a></span></div>';
        a.innerHTML = h;
        if (recusando) { const inp = a.querySelector('.sg-mot'); if (inp) { if (motAtual) inp.value = motAtual; if (document.activeElement !== inp) inp.focus(); } }
    }

    function cliquePainel(ev) {
        const a = $('sg-painel');
        if (a.classList.contains('sg-faixa')) { LSs(EXP_KEY, '1'); render(); return; }
        const b = ev.target.closest('[data-a]'); if (!b) return;
        const ac = b.dataset.a, p = pedidos.find(x => x.id === b.dataset.id);
        if (ac === 'som') { LSs(SOM_KEY, LSg(SOM_KEY, '1') === '0' ? '1' : '0'); render(); return; }
        if (ac === 'lado') { LSs(LADO_KEY, lado() === 'direita' ? 'esquerda' : 'direita'); render(); return; }
        if (ac === 'recolher') { LSs(EXP_KEY, '0'); render(); return; }
        if (ac === 'aba-pedidos' || ac === 'aba-pochete') { aba = ac.slice(4); movAberto = null; recusando = null; if (aba === 'pochete') carregarPochete(); render(); return; }
        if (ac === 'mov-abrir') { movAberto = { sid: b.dataset.sid, tipo: b.dataset.tipo }; render(); return; }
        if (ac === 'mov-voltar') { movAberto = null; render(); return; }
        if (ac === 'mov-ok') { const i = a.querySelector('.sg-qtd'); confirmarMov(b.dataset.sid, i ? i.value : ''); return; }
        if (ac === 'recusar-voltar') { recusando = null; render(); return; }
        if (ac === 'recusar') { recusando = b.dataset.id; render(); return; }
        if (ac === 'recusar-ok') { const inp = a.querySelector('.sg-mot'); confirmarRecusa(b.dataset.id, inp ? inp.value : ''); return; }
        if (!p) return;
        if (ac === 'abrir') { const i = idxTorneio(p.torneio_id); if (i >= 0 && typeof abrirDetalhesTorneio === 'function') abrirDetalhesTorneio(i); return; }
        if (ac === 'aceitar') { aceitar(p, false); return; }
        if (ac === 'assumir') {
            showConfirmModal('Assumir pedido parado?',
                'Outro caixa começou este lançamento e parou há mais de 2 minutos.\n\nConfira na aba Jogadores se a entrada de ' + e(p.jogador_nome) + ' ainda NÃO foi lançada antes de continuar.',
                () => aceitar(p, true), { icon: '⚠️', confirmLabel: 'Assumir', confirmColor: '#16a34a', borderColor: '#f59e0b' });
            return;
        }
        if (ac === 'liberar') { liberar(p).then(carregar); return; }
    }

    function abrirTorneioDoPrimeiro() {
        if (modalAberto('modal-torneio')) { LSs(EXP_KEY, '1'); render(); return; }   // celular: abre a gaveta
        const p = pedidos.find(x => x.status === 'pendente' && idxTorneio(x.torneio_id) >= 0);
        if (!p) return toast('⚠️ O torneio do pedido não está carregado neste computador');
        if (typeof abrirDetalhesTorneio === 'function') abrirDetalhesTorneio(idxTorneio(p.torneio_id));
    }

    let _tituloT = null;
    function piscarTitulo() {
        if (!document.hidden) return;
        const orig = document.title; let on = false; clearInterval(_tituloT);
        _tituloT = setInterval(() => { document.title = on ? orig : '🟢 Pedido da sangeur'; on = !on; if (!document.hidden) { clearInterval(_tituloT); document.title = orig; } }, 1000);
    }

    // ---------- ações no servidor ----------
    async function rpc(nome, args) { const { data, error } = await sb.rpc(nome, args); if (error) throw error; return data; }
    async function liberar(p) { try { await rpc('sangeur_caixa_liberar', { p_id: p.id }); } catch (err) { console.warn('[SANGEUR] liberar:', err); } }
    async function confirmarRecusa(id, motivo) {
        motivo = String(motivo || '').trim();
        if (!motivo) { toast('⚠️ Escreva o motivo da recusa'); return; }
        try {
            const d = await rpc('sangeur_caixa_recusar', { p_id: id, p_motivo: motivo });
            toast(d && d.ok ? '✋ Pedido recusado — a sangeur foi avisada' : '⚠️ Este pedido já foi resolvido');
        } catch (err) { toast('⚠️ Sem conexão. Tente de novo.'); return; }
        recusando = null; carregar();
    }
    async function concluir(p, comboIds, pagto) {
        try {
            const d = await rpc('sangeur_caixa_concluir', { p_id: p.id, p_combo_id: comboIds, p_forma_pagto: pagto });
            if (!d || !d.ok) {
                console.warn('[SANGEUR] concluir não aplicou (pedido assumido/resolvido por outro caixa)', p.id);
                try { showConfirmModal('Atenção: pedido assumido por outro caixa',
                    'A entrada de ' + e(p.jogador_nome) + ' FOI lançada aqui, mas outro caixa assumiu este pedido enquanto você lançava.\n\nAvise o outro caixa para NÃO lançar de novo.',
                    () => {}, { icon: '⚠️', confirmLabel: 'Entendi', confirmColor: '#d97706', borderColor: '#f59e0b', cancelLabel: 'Fechar' }); } catch (_) {}
            }
        } catch (err) {
            // A entrada JÁ foi lançada; só a marcação do pedido falhou → guarda e reenvia
            console.warn('[SANGEUR] concluir falhou, guardando p/ reenviar:', err);
            try { const l = JSON.parse(LSg(PEND_KEY, '[]')); l.push({ id: p.id, combo: comboIds, pagto }); LSs(PEND_KEY, JSON.stringify(l)); } catch (_) {}
        }
        carregar();
    }
    async function reenviarPendentes() {
        let l = []; try { l = JSON.parse(LSg(PEND_KEY, '[]')); } catch (_) {}
        if (!l.length) return;
        const resto = [];
        for (const it of l) { try { await rpc('sangeur_caixa_concluir', { p_id: it.id, p_combo_id: it.combo, p_forma_pagto: it.pagto }); } catch (_) { resto.push(it); } }
        LSs(PEND_KEY, JSON.stringify(resto));
    }

    // ---------- ACEITAR: abre o lançamento de sempre, preenchido ----------
    async function aceitar(p, forcar) {
        if (fluxo) return toast('⏳ Termine o lançamento em andamento primeiro');
        const idx = idxTorneio(p.torneio_id);
        if (idx < 0) return toast('⚠️ Torneio não carregado neste computador');
        if (idxAtivo() !== idx || !modalAberto('modal-torneio')) { abrirDetalhesTorneio(idx); return; }
        const t = torneios[idx];
        if (!(typeof jogadores !== 'undefined' && jogadores.some(j => String(j.id) === String(p.jogador_id)))) {
            return toast('⚠️ Jogador não encontrado neste computador — atualize a página');
        }
        // Proteção contra lançamento em dobro: já existe entrada desse jogador depois do pedido?
        const desde = new Date(p.criado_em).getTime() - 5000;
        const jaFeitas = (t.entries || []).filter(x => String(x.jogadorId) === String(p.jogador_id) && x.tipo === p.tipo && Number(x.ts) >= desde);
        if (jaFeitas.length && (p.status === 'pendente' || forcar)) {
            const hr = new Date(Number(jaFeitas[0].ts)).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            showConfirmModal('Já existe lançamento',
                e(p.jogador_nome) + ' já tem ' + jaFeitas.length + 'x ' + (TIPO_NOME[p.tipo] || p.tipo) + ' lançado depois do pedido (às ' + hr + ').\n\nMarcar o pedido como aceito SEM lançar de novo?',
                async () => {
                    try { const r = await rpc('sangeur_caixa_reservar', { p_id: p.id, p_forcar: false }); if (r && r.ok) await concluir(p, jaFeitas.map(x => x.id).join(','), null); else toast('⚠️ Pedido indisponível'); }
                    catch (_) { toast('⚠️ Sem conexão'); }
                    carregar();
                }, { icon: '🛡️', confirmLabel: 'Marcar como aceito', confirmColor: '#16a34a', borderColor: '#a855f7', cancelLabel: 'Voltar' });
            return;
        }
        let r;
        try { r = await rpc('sangeur_caixa_reservar', { p_id: p.id, p_forcar: !!forcar }); }
        catch (err) { return toast('⚠️ Sem conexão com o servidor. Tente de novo.'); }
        if (!r || !r.ok) {
            if (r && r.erro === 'em_uso') toast('🔒 ' + (pNome(r.processando_nome) || 'Outro caixa') + ' já está lançando este pedido');
            else toast('⚠️ Este pedido já foi resolvido');
            return carregar();
        }
        fluxo = { p, tid: t.id, antes: new Set((t.entries || []).map(x => x.id)), pagto: null, abriu: false };
        render();
        try { openModalEntrada(idx); } catch (err) { console.warn('[SANGEUR] openModalEntrada:', err); }
        if (!modalAberto('modal-entrada')) {   // ex.: compras encerradas — o próprio app avisa
            const f = fluxo; fluxo = null; await liberar(f.p); carregar(); return;
        }
        fluxo.abriu = true;
        setTimeout(() => preencher(p, t), 130);
    }

    function preencher(p, t) {
        if (!fluxo || fluxo.p.id !== p.id || !modalAberto('modal-entrada')) return;
        const sel = $('entrada-jogador');
        if (sel) {
            sel.__pickedByUser = true;
            sel.value = p.jogador_id;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            setTimeout(() => { sel.__pickedByUser = false; }, 50);
            try { PlayerSearch.mount('entrada-jogador'); } catch (_) {}
        }
        let okTipo = false, motivoTipo = '';
        const multi = $('entrada-acoes-multi');
        const modoMulti = !!(multi && multi.style.display !== 'none' && multi.children.length > 0);
        if (modoMulti) {
            const cb = $('entrada-acao-' + p.tipo);
            if (cb && !cb.disabled) {
                multi.querySelectorAll('input[type=checkbox]').forEach(x => { if (x !== cb && !x.disabled && !x.dataset.anchor) x.checked = false; });
                cb.checked = true; okTipo = true;
            } else motivoTipo = cb ? 'bloqueado agora' : 'não disponível para este jogador';
        } else {
            const ts = $('entrada-tipo');
            const opt = ts ? Array.from(ts.options).find(o => o.value === p.tipo) : null;
            if (opt && !opt.disabled) { ts.value = p.tipo; okTipo = true; }
            else motivoTipo = opt ? 'bloqueado agora' : 'não disponível para este jogador';
        }
        try { atualizarResumoEntrada(); } catch (_) {}
        if (okTipo && p.tipo === 'reentry' && Number(p.quantidade) > 1 && typeof _rmEscolherQtd === 'function') {
            try { _rmEscolherQtd(Number(p.quantidade)); } catch (_) {}
        }
        if (p.forma_pagto && PAG_NOME[p.forma_pagto]) {
            try { _togglePagoNaHora(true); _selectMetodoPagoNaHora(p.forma_pagto); atualizarResumoEntrada(); } catch (_) {}
        }
        // Aviso no topo do modal (só durante este lançamento)
        const antigo = $('sg-entrada-aviso'); if (antigo) antigo.remove();
        const col = document.querySelector('#modal-entrada > div > div:nth-child(2)');
        if (col) {
            const d = document.createElement('div'); d.id = 'sg-entrada-aviso';
            d.innerHTML = '<b>Pedido da sangeur ' + e(pNome(p.sangeur_nome)) + '</b>: ' + (TIPO_NOME[p.tipo] || e(p.tipo)) + (p.quantidade > 1 ? ' ' + p.quantidade + 'x' : '') +
                (Number(p.valor_estimado) > 0 ? ' · ' + money(p.valor_estimado) : '') + (p.forma_pagto ? ' · pagou ' + (PAG_NOME[p.forma_pagto] || e(p.forma_pagto)) : ' · pagamento no caixa') +
                (okTipo ? '<br>Confira e clique em <b>Confirmar Entrada</b>. Fechar sem confirmar devolve o pedido para a fila.'
                        : '<br><span class="sg-warn">⚠️ ' + (TIPO_NOME[p.tipo] || p.tipo) + ' ' + motivoTipo + '.</span> Escolha outra opção ou feche e recuse o pedido.');
            col.insertBefore(d, col.firstChild);
        }
    }

    // Guarda a forma de pagamento usada no momento em que o caixa confirma
    function capturaConfirmar(ev) {
        if (!fluxo || !ev.target.closest || !ev.target.closest('#btn-confirmar-entrada')) return;
        const tg = $('pago-na-hora-toggle');
        fluxo.pagto = (tg && tg.checked) ? (window._pagoNaHoraMetodo || null) : null;
    }

    async function finalizarFluxo() {
        if (!fluxo || modalAberto('modal-entrada')) return;
        const f = fluxo; fluxo = null;
        const aviso = $('sg-entrada-aviso'); if (aviso) aviso.remove();
        const t = torneioPorId(f.tid);
        const novas = ((t && t.entries) || []).filter(x => !f.antes.has(x.id) && String(x.jogadorId) === String(f.p.jogador_id));
        if (novas.length) {
            await concluir(f.p, novas.map(x => x.id).join(','), f.pagto);
            toast('✅ Pedido da sangeur aceito — ' + pNome(f.p.sangeur_nome) + ' foi avisada');
        } else {
            await liberar(f.p);
            toast('↩️ Pedido de ' + f.p.jogador_nome + ' voltou para a fila');
            carregar();
        }
    }

    // exposto só para diagnóstico/testes
    window._stackSangeurCaixa = { verificar, carregar, estado: () => ({ clubeAtivo, pedidos, fluxo }) };
})();
