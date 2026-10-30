// =====================================================================
// StackOS — barra "Abertos agora" (atalho entre torneios e mesas de cash)
//
// Só NAVEGA. Não lança, não edita, não grava nada e não altera nenhuma
// função do app.html. Usa apenas as mesmas ações dos botões de sempre:
//   - abrir torneio  → abrirDetalhesTorneio(idx)   (botão "Abrir" da lista)
//   - fechar torneio → closeModal('modal-torneio') (o X da janela)
//   - ir ao cash     → showPage('cash')             (menu Cash Game)
// Atalhos: Alt+1…Alt+9 (itens da barra) · Alt+Q (voltar ao anterior).
// =====================================================================
(function () {
    'use strict';
    if (window.__stackOsAbertos) return;
    window.__stackOsAbertos = true;

    const EXP_KEY = 'stackos_abertos_exp';   // '0' recolhida (só o ícone) | '1' aberta — por computador
    const $ = (id) => document.getElementById(id);
    const e = (s) => (s == null ? '' : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]));
    const LSg = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } };
    const LSs = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
    const toast = (m) => { try { if (typeof showToast === 'function') showToast(m); } catch (_) {} };
    const modalAberto = (id) => { const m = $(id); return !!(m && m.classList.contains('open')); };

    let ultimoHtml = '', lugarAtual = null, lugarAnterior = null, mesaFoco = null, ajusteModal = false;

    // ---------- dados (só leitura do que já está carregado na tela) ----------
    function torneiosAbertos() {
        let lista = [];
        try { lista = (typeof torneios !== 'undefined' ? torneios : []); } catch (_) { return []; }
        return lista.map((t, idx) => ({ t, idx })).filter(({ t }) => {
            if (!t || !t.id) return false;
            const st = String(t.status || '').toLowerCase();
            if (['running', 'paused', 'break'].includes(st)) return true;
            return st === 'waiting' && Array.isArray(t.entries) && t.entries.length > 0;   // inscrições abertas antes de começar
        });
    }
    function mesasAbertas() {
        try { return (typeof cashMesas !== 'undefined' ? cashMesas : []).filter(m => m && (m.status === 'aberta' || m.status === 'ativa')); } catch (_) { return []; }
    }
    function pedidosSangeur() {
        try { const s = window._stackSangeurCaixa && window._stackSangeurCaixa.estado(); return (s && s.pedidos) ? s.pedidos.filter(p => p.status === 'pendente') : []; } catch (_) { return []; }
    }
    function itens() {
        const ped = pedidosSangeur();
        const t = torneiosAbertos().map(({ t, idx }) => ({ chave: 't:' + t.id, tipo: 't', id: t.id, idx, nome: t.nome || 'Torneio', ped: ped.filter(p => p.torneio_id === t.id).length }));
        const c = mesasAbertas().map(m => ({ chave: 'c:' + m.id, tipo: 'c', id: m.id, nome: m.nome || 'Mesa', ped: ped.filter(p => p.mesa_id === m.id).length }));
        return t.concat(c);
    }
    function torneioAbertoId() {
        if (!modalAberto('modal-torneio')) return null;
        try { const i = activeTorneioIdx; return (i != null && torneios[i]) ? torneios[i].id : null; } catch (_) { return null; }
    }
    function naPaginaCash() { const pg = $('page-cash'); return !!(pg && pg.style.display !== 'none' && pg.offsetParent !== null); }
    function lugar() {
        const tid = torneioAbertoId(); if (tid) return 't:' + tid;
        if (naPaginaCash()) return 'c:' + (mesaFoco || '');
        return null;
    }
    // outro modal aberto (lançamento, recompra, confirmação...): não navega para não perder o que está sendo feito
    function outroModalAberto() {
        return Array.from(document.querySelectorAll('.modal-overlay.open')).some(m => m.id !== 'modal-torneio');
    }
    function logado() {
        const app = $('main-app');
        return !!(app && app.style.display !== 'none' && window.currentUser);
    }

    // ---------- navegação ----------
    function ir(it) {
        if (!it) return;
        if (outroModalAberto()) { toast('⚠️ Termine ou feche a janela aberta antes de trocar'); return; }
        if (it.tipo === 't') {
            const idx = (typeof torneios !== 'undefined' ? torneios : []).findIndex(x => x && x.id === it.id);
            if (idx < 0) return toast('⚠️ Torneio não encontrado');
            if (torneioAbertoId() === it.id) return;
            if (modalAberto('modal-torneio')) closeModal('modal-torneio');
            abrirDetalhesTorneio(idx);
        } else {
            if (modalAberto('modal-torneio')) closeModal('modal-torneio');
            if (!naPaginaCash() && typeof showPage === 'function') showPage('cash');
            mesaFoco = it.id;
            setTimeout(() => destacarMesa(it.id), 120);
        }
        setTimeout(atualizar, 60);
    }
    function destacarMesa(mid) {
        const lc = $('cash-mesas-list'); if (!lc) return;
        const bt = lc.querySelector('button[onclick="abrirAddJogadorCash(\'' + mid + '\')"]');
        const card = bt && bt.closest('.t-card'); if (!card) return;
        try { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
        card.style.transition = 'box-shadow .3s'; card.style.boxShadow = '0 0 0 2px #f59e0b, 0 0 28px rgba(245,158,11,.35)';
        setTimeout(() => { card.style.boxShadow = ''; }, 1600);
    }
    function voltarAnterior() {
        if (!lugarAnterior) return toast('↩️ Ainda não há um lugar anterior');
        const [tp, id] = lugarAnterior.split(':');
        const it = itens().find(x => x.tipo === tp && (tp === 'c' ? (!id || x.id === id) : x.id === id)) || (tp === 'c' ? { tipo: 'c', id: id || null } : null);
        if (!it) return toast('⚠️ O lugar anterior não está mais aberto');
        if (tp === 'c' && !it.id) { if (outroModalAberto()) return toast('⚠️ Termine ou feche a janela aberta antes de trocar'); if (modalAberto('modal-torneio')) closeModal('modal-torneio'); showPage('cash'); setTimeout(atualizar, 60); return; }
        ir(it);
    }

    // ---------- DOM ----------
    function estilo() {
        if ($('ab-estilo')) return;
        const st = document.createElement('style'); st.id = 'ab-estilo';
        st.textContent = `
#ab-barra{display:flex;align-items:center;gap:6px;min-width:0;flex:1;justify-content:center;margin:0 1rem;font-family:'Manrope',system-ui,sans-serif}
#ab-barra.ab-flut{position:fixed;top:6px;left:50%;transform:translateX(-50%);z-index:105;margin:0;flex:none;max-width:max(320px, calc(100vw - 760px));background:#0d0c12;border:1px solid #3a2d12;border-radius:12px;padding:3px 4px;box-shadow:0 8px 24px rgba(0,0,0,.5)}
#ab-barra .ab-ico{flex:0 0 auto;height:30px;display:inline-flex;align-items:center;gap:6px;padding:0 10px;border-radius:9px;border:none;cursor:pointer;background:linear-gradient(135deg,#f59e0b,#fbbf24);color:#1a1306;font:800 12px 'Manrope',sans-serif;letter-spacing:.02em;box-shadow:0 0 0 0 rgba(245,158,11,.6)}
#ab-barra .ab-ico.ab-pulso{animation:abPulso 1.6s ease-out infinite}
@keyframes abPulso{0%{box-shadow:0 0 0 0 rgba(245,158,11,.6)}100%{box-shadow:0 0 0 10px rgba(245,158,11,0)}}
#ab-barra .ab-lista{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;min-width:0}
#ab-barra .ab-lista::-webkit-scrollbar{display:none}
#ab-barra .ab-it{flex:0 0 auto;height:30px;display:inline-flex;align-items:center;gap:6px;padding:0 10px;border-radius:9px;border:1px solid #2a2a30;background:#111113;color:#d4d4d8;font:700 12px 'Manrope',sans-serif;cursor:pointer;white-space:nowrap;max-width:220px}
#ab-barra .ab-it span.n{overflow:hidden;text-overflow:ellipsis}
#ab-barra .ab-it:hover{border-color:#f59e0b;color:#fff}
#ab-barra .ab-it.on{border-color:#f59e0b;background:rgba(245,158,11,.14);color:#fde68a}
#ab-barra .ab-it.t i{color:#fbbf24}
#ab-barra .ab-it.c i{color:#22c55e}
#ab-barra .ab-k{font:600 10px 'JetBrains Mono',monospace;color:#71717a;border:1px solid #2a2a30;border-radius:4px;padding:0 4px}
#ab-barra .ab-p{font:800 10.5px 'Manrope',sans-serif;color:#1a1306;background:#fbbf24;border-radius:999px;padding:1px 7px}
#ab-barra .ab-volta{flex:0 0 auto;height:30px;width:34px;border-radius:9px;border:1px solid #2a2a30;background:none;color:#a1a1aa;cursor:pointer}
#ab-barra .ab-volta:hover{border-color:#f59e0b;color:#fde68a}
`;
        document.head.appendChild(st);
    }
    function montar() {
        estilo();
        let b = $('ab-barra');
        if (!b) {
            b = document.createElement('div'); b.id = 'ab-barra'; b.setAttribute('role', 'navigation'); b.setAttribute('aria-label', 'Torneios e mesas abertos agora');
            b.addEventListener('click', (ev) => {
                const x = ev.target.closest('[data-ab]'); if (!x) return;
                if (x.dataset.ab === 'exp') { LSs(EXP_KEY, LSg(EXP_KEY, '1') === '0' ? '1' : '0'); ultimoHtml = ''; atualizar(); return; }
                if (x.dataset.ab === 'volta') { voltarAnterior(); return; }
                const it = itens().find(i => i.chave === x.dataset.ab); ir(it);
            });
        }
        return b;
    }
    // Com o torneio aberto, a barra flutua acima da janela; afasta a janela só o necessário para não cobrir nada
    function ajustarModal(ligar) {
        const ov = $('modal-torneio'); if (!ov) return;
        const box = ov.firstElementChild;
        if (ligar) {
            ov.style.paddingTop = '46px';
            if (box) box.style.maxHeight = 'min(92vh, calc(100vh - 70px))';
            ajusteModal = true;
        } else if (ajusteModal) {
            ov.style.paddingTop = '';
            if (box) box.style.maxHeight = '';
            ajusteModal = false;
        }
    }
    function atualizar() {
        const tit = $('page-title'), header = tit ? tit.parentNode : null;
        const b = $('ab-barra');
        const lista = logado() ? itens() : [];
        const lg = logado() ? lugar() : null;
        if (lg && lg !== lugarAtual) { if (lugarAtual) lugarAnterior = lugarAtual; lugarAtual = lg; }
        const torneioAberto = modalAberto('modal-torneio');
        if (!lista.length || !header) {
            if (b) b.remove(); ultimoHtml = ''; ajustarModal(false); return;
        }
        const el = montar();
        // posição: dentro do cabeçalho do app; flutuando quando o torneio está aberto
        const flut = torneioAberto && !outroModalAberto();
        if (torneioAberto && outroModalAberto()) { el.style.display = 'none'; ajustarModal(false); return; }
        el.style.display = '';
        el.classList.toggle('ab-flut', flut);
        if (flut) { if (el.parentNode !== document.body) document.body.appendChild(el); ajustarModal(true); }
        else { ajustarModal(false); const titulo = $('page-title'); if (el.parentNode !== header) header.insertBefore(el, titulo ? titulo.nextSibling : header.firstChild); }
        const exp = LSg(EXP_KEY, '1') !== '0';
        const totPed = lista.reduce((s, x) => s + x.ped, 0);
        const tidAberto = torneioAbertoId(), cash = naPaginaCash();
        let h = '<button type="button" class="ab-ico' + (totPed && !exp ? ' ab-pulso' : '') + '" data-ab="exp" title="' + (exp ? 'Recolher atalhos' : 'Mostrar torneios e mesas abertos') + '">' +
            '<i class="fa-solid fa-bolt"></i>' + (exp ? 'Abertos' : 'Abertos · ' + lista.length) + (totPed && !exp ? ' <span class="ab-p">' + totPed + '</span>' : '') + '</button>';
        if (exp) {
            h += '<div class="ab-lista">' + lista.map((it, i) => {
                const on = it.tipo === 't' ? tidAberto === it.id : (!tidAberto && cash && (mesaFoco === it.id || (!mesaFoco && mesasAbertas().length === 1)));
                return '<button type="button" class="ab-it ' + it.tipo + (on ? ' on' : '') + '" data-ab="' + e(it.chave) + '" title="' + (it.tipo === 't' ? 'Abrir torneio ' : 'Ir para a mesa ') + e(it.nome) + (i < 9 ? ' (Alt+' + (i + 1) + ')' : '') + '">' +
                    '<i class="fa-solid ' + (it.tipo === 't' ? 'fa-trophy' : 'fa-layer-group') + '"></i><span class="n">' + e(it.nome) + '</span>' +
                    (it.ped ? '<span class="ab-p">' + it.ped + '</span>' : '') + (i < 9 ? '<span class="ab-k">' + (i + 1) + '</span>' : '') + '</button>';
            }).join('') + '</div>' +
            '<button type="button" class="ab-volta" data-ab="volta" title="Voltar ao anterior (Alt+Q)"><i class="fa-solid fa-arrow-right-arrow-left"></i></button>';
        }
        if (h !== ultimoHtml) { el.innerHTML = h; ultimoHtml = h; }
    }

    // ---------- teclado: Alt+1…9 e Alt+Q (livres no app) ----------
    document.addEventListener('keydown', (ev) => {
        if (!ev.altKey || ev.ctrlKey || ev.metaKey || !logado() || !$('ab-barra')) return;
        const k = String(ev.key || '').toLowerCase();
        if (/^[1-9]$/.test(k) || (ev.code && /^Digit[1-9]$/.test(ev.code))) {
            const n = /^[1-9]$/.test(k) ? Number(k) : Number(ev.code.slice(5));
            const it = itens()[n - 1]; if (!it) return;
            ev.preventDefault(); ev.stopPropagation(); ir(it);
        } else if (k === 'q' || ev.code === 'KeyQ') {
            ev.preventDefault(); ev.stopPropagation(); voltarAnterior();
        }
    }, true);

    // lembra a mesa em que o caixa mexeu por último (para "voltar ao anterior" cair nela)
    document.addEventListener('click', (ev) => {
        const card = ev.target.closest && ev.target.closest('#cash-mesas-list .t-card'); if (!card) return;
        const bt = card.querySelector('button[onclick^="abrirAddJogadorCash("]');
        const m = bt && /abrirAddJogadorCash\('([^']+)'\)/.exec(bt.getAttribute('onclick'));
        if (m) { mesaFoco = m[1]; setTimeout(atualizar, 30); }
    }, true);

    setInterval(atualizar, 1500);
    try {
        const obs = new MutationObserver(() => atualizar());
        // qualquer janela que abre/fecha (lançamento, recompra...) atualiza na hora: a barra sai da frente
        const ligar = () => { document.querySelectorAll('.modal-overlay').forEach(ov => obs.observe(ov, { attributes: true, attributeFilter: ['class'] })); };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ligar); else ligar();
    } catch (_) {}
    window._stackOsAbertos = { atualizar, itens, voltarAnterior };
})();
