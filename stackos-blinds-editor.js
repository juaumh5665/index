// ============================================================
// EDITOR DE ESTRUTURA DE BLINDS — StackOS (#15)
// ------------------------------------------------------------
// Um editor só, usado em dois lugares:
//   1) Novo/Editar torneio (antes de começar): edita o array global `blindStructure`.
//   2) Aba "Blinds" do torneio rodando: edita uma CÓPIA de t.blinds e só grava
//      ao clicar "Salvar estrutura". Níveis jogados e o nível atual não mudam de lugar.
// Botões + segurar e arrastar (mouse e toque) para inserir/reordenar.
// Mesmo formato de dados de sempre: { sb, bb, ante, tempo } e
// { isBreak:true, tempo, breakDeCompras, sb:0, bb:0, ante:0 }.
// Não mexe em rake, prize, fichas, entradas nem caixa.
// ============================================================
(function () {
    'use strict';
    if (window.BlindEditor) return;

    const LADDER = [10,20,25,30,40,50,60,75,80,100,120,150,200,250,300,400,500,600,800,1000,1200,1500,1600,2000,2500,3000,4000,5000,6000,8000,10000,12000,15000,20000,25000,30000,40000,50000,60000,80000,100000,120000,150000,200000,250000,300000,400000,500000,600000,800000,1000000,1200000,1500000,2000000,2500000,3000000,4000000,5000000];
    const near = (x) => LADDER.reduce((b, v) => Math.abs(v - x) < Math.abs(b - x) ? v : b, LADDER[0]);
    const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('pt-BR');
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const clone = (x) => JSON.parse(JSON.stringify(x || []));
    const toast = (m) => { try { showToast(m); } catch (_) { console.log(m); } };
    const isN = (b) => b && !b.isBreak;

    // ─── CSS (uma vez) ───
    const CSS = `
.be-root{--be-line:#23232a;--be-line2:#2f2f38;--be-p2:#0c0c0f;--be-row:#141419;--be-mut:#9a9aa6;--be-dim:#686874;--be-acc:#a855f7;--be-acc-s:rgba(168,85,247,.14);--be-gold:#f5b53d;--be-gold-s:rgba(245,181,61,.11);--be-brk:#38bdf8;--be-brk-s:rgba(56,189,248,.08);--be-now:#22c55e;--be-now-s:rgba(34,197,94,.1);--be-bad:#f87171;display:flex;flex-direction:column;gap:.6rem;color:#ececf0;font-family:Manrope,system-ui,sans-serif;min-width:0}
.be-root.be-full{position:fixed;inset:0;z-index:100000;background:#09090b;padding:16px max(16px,env(safe-area-inset-left,0px));overflow:auto}
.be-tb{display:flex;gap:.45rem;flex-wrap:wrap;align-items:center}
.be-tb .be-sp{flex:1}
.be-btn{font:inherit;font-weight:800;font-size:.72rem;border-radius:.5rem;border:1px solid var(--be-line2);background:var(--be-p2);color:#ececf0;padding:.4rem .65rem;cursor:pointer;white-space:nowrap}
.be-btn:hover{border-color:#52525b}
.be-btn.pri{background:var(--be-acc);border-color:var(--be-acc);color:#fff}
.be-btn.gold{border-color:rgba(245,181,61,.45);color:var(--be-gold);background:var(--be-gold-s)}
.be-btn.ghost{background:transparent}
.be-btn.bad{border-color:rgba(248,113,113,.4);color:var(--be-bad);background:transparent}
.be-root select,.be-root .be-in{font:inherit;background:var(--be-p2);color:#ececf0;border:1px solid var(--be-line2);border-radius:.45rem;padding:.38rem .5rem;min-width:0}
.be-root select{font-weight:700;font-size:.72rem;max-width:100%}
.be-seg{display:inline-flex;border:1px solid var(--be-line2);border-radius:.5rem;overflow:hidden}
.be-seg button{font:inherit;font-size:.68rem;font-weight:700;padding:.35rem .55rem;border:0;background:var(--be-p2);color:var(--be-mut);cursor:pointer}
.be-seg button[aria-pressed="true"]{background:var(--be-acc-s);color:#fff}
.be-chip{font-size:.68rem;font-weight:700;padding:.2rem .5rem;border-radius:999px;background:var(--be-p2);border:1px solid var(--be-line2);color:var(--be-mut);font-family:var(--font-mono,ui-monospace,monospace)}
.be-body{display:grid;grid-template-columns:minmax(0,1fr);gap:.75rem}
.be-root.be-wide .be-body{grid-template-columns:minmax(0,1fr) 270px}
@media (max-width:900px){.be-root.be-wide .be-body{grid-template-columns:minmax(0,1fr)}}
.be-main{min-width:0;display:flex;flex-direction:column;gap:.5rem}
.be-side{min-width:0;display:flex;flex-direction:column;gap:.6rem}
.be-tbl{border:1px solid var(--be-line);border-radius:.7rem;overflow:auto;max-height:420px;background:var(--be-p2)}
.be-root.be-wide .be-tbl{max-height:60vh}
.be-root.be-full .be-tbl{max-height:calc(100vh - 210px)}
.be-hdr,.be-r{display:grid;grid-template-columns:22px 46px minmax(64px,1fr) minmax(64px,1fr) minmax(64px,1fr) 58px 58px 30px;gap:6px;align-items:center;padding:0 8px;min-width:480px}
.be-root:not(.be-wide) .be-hdr,.be-root:not(.be-wide) .be-r{grid-template-columns:20px 40px minmax(52px,1fr) minmax(52px,1fr) minmax(52px,1fr) 50px 26px;min-width:0;gap:4px;padding:0 6px}
.be-root:not(.be-wide) .be-hdr .be-hc,.be-root:not(.be-wide) .be-r .be-t{display:none}
.be-root:not(.be-wide) .be-lock,.be-root:not(.be-wide) .be-fold,.be-root:not(.be-wide) .be-dropline{min-width:0}
.be-hdr{position:sticky;top:0;z-index:3;background:#16161c;height:30px;font-size:.58rem;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--be-dim)}
.be-hdr span{text-align:center}.be-hdr span:nth-child(2){text-align:left}
.be-r{height:40px;border-top:1px solid var(--be-line);font-variant-numeric:tabular-nums;position:relative}
.be-r .be-n{font-family:var(--font-mono,ui-monospace,monospace);color:var(--be-dim);font-size:.75rem;white-space:nowrap}
.be-r input{font-family:var(--font-mono,ui-monospace,monospace);font-size:.8rem;width:100%;text-align:center;background:transparent;border:1px solid transparent;border-radius:.35rem;color:#ececf0;padding:.3rem .2rem;min-width:0}
.be-r input:hover{border-color:var(--be-line2)}
.be-r input:focus{background:#111114;border-color:var(--be-acc);outline:none}
.be-r input.be-pad{color:var(--be-dim)}
.be-r .be-t{font-family:var(--font-mono,ui-monospace,monospace);font-size:.7rem;color:var(--be-mut);text-align:center;white-space:nowrap}
.be-del{font:inherit;background:none;border:0;color:var(--be-dim);cursor:pointer;font-size:.85rem;border-radius:.35rem;padding:.2rem}
.be-del:hover{color:var(--be-bad);background:rgba(248,113,113,.1)}
.be-r.be-b{background:var(--be-brk-s)}
.be-r.be-b .be-bl{grid-column:3 / span 3;display:flex;align-items:center;gap:.5rem;color:var(--be-brk);font-weight:800;font-size:.75rem;flex-wrap:wrap;min-width:0}
.be-r.be-b.be-c{background:var(--be-gold-s)}
.be-r.be-b.be-c .be-bl{color:var(--be-gold)}
.be-tg{font:inherit;font-size:.62rem;font-weight:800;padding:.15rem .45rem;border-radius:999px;border:1px solid var(--be-line2);background:#111114;color:var(--be-mut);cursor:pointer}
.be-r.be-b.be-c .be-tg{border-color:rgba(245,181,61,.5);color:var(--be-gold)}
.be-r.be-now{background:var(--be-now-s);box-shadow:inset 3px 0 0 var(--be-now)}
.be-r.be-now .be-n{color:var(--be-now);font-weight:700}
.be-agora{font-family:Manrope,system-ui,sans-serif;font-size:.55rem;font-weight:800;background:var(--be-now);color:#04130a;border-radius:999px;padding:1px 5px;margin-left:3px}
.be-r.be-past input{color:var(--be-dim);pointer-events:none}
.be-r.be-past .be-del,.be-r.be-past .be-hd{visibility:hidden}
.be-hd{cursor:grab;color:var(--be-dim);font-size:.85rem;line-height:1;user-select:none;touch-action:none;display:flex;align-items:center;justify-content:center;height:100%;border-radius:.35rem}
.be-hd:hover{color:#fff;background:var(--be-row)}
.be-r.be-drag{opacity:.35}
.be-ghost{position:fixed;z-index:100001;pointer-events:none;background:#1b1424;border:1px solid var(--be-acc,#a855f7);border-radius:.6rem;padding:.45rem .7rem;font-weight:800;font-size:.75rem;color:#e9d5ff;box-shadow:0 10px 30px rgba(0,0,0,.5);font-family:Manrope,system-ui,sans-serif}
.be-ghost.ib{background:#0f1c24;border-color:#38bdf8;color:#bae6fd}
.be-dropline{height:0;position:relative;min-width:480px}
.be-dropline::after{content:"";position:absolute;left:8px;right:8px;top:-2px;height:4px;border-radius:4px;background:#a855f7;box-shadow:0 0 0 3px rgba(168,85,247,.25)}
.be-pal-w{display:flex;gap:.4rem;flex-wrap:wrap;align-items:center}
.be-pal{font:inherit;font-weight:800;font-size:.72rem;border-radius:.55rem;padding:.45rem .7rem;cursor:grab;touch-action:none;user-select:none;border:1px dashed var(--be-acc);background:var(--be-acc-s);color:#e9d5ff}
.be-pal.ib{border-color:var(--be-brk);background:var(--be-brk-s);color:#bae6fd}
.be-pal.c{border-color:rgba(245,181,61,.6);background:var(--be-gold-s);color:var(--be-gold)}
body.be-dragging,body.be-dragging *{cursor:grabbing!important}
.be-lock{min-width:480px;display:flex;align-items:center;gap:.4rem;padding:.25rem .6rem;font-size:.65rem;font-weight:800;color:var(--be-bad);background:rgba(248,113,113,.06);border-top:1px solid rgba(248,113,113,.3)}
.be-fold{min-width:480px;border-top:1px solid var(--be-line)}
.be-fold button{font:inherit;width:100%;text-align:left;background:none;border:0;color:var(--be-mut);padding:.5rem .7rem;cursor:pointer;font-weight:700;font-size:.72rem}
.be-fold button:hover{color:#fff}
.be-note{font-size:.66rem;color:var(--be-dim);line-height:1.5}
.be-box{background:var(--be-p2);border:1px solid var(--be-line);border-radius:.7rem;padding:.65rem}
.be-lbl{font-size:.58rem;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--be-dim)}
.be-kv{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}
.be-kv .be-v{font-family:var(--font-mono,ui-monospace,monospace);font-weight:700;font-size:.9rem;margin-top:.1rem}
.be-al{font-size:.7rem;border-radius:.5rem;padding:.4rem .55rem;line-height:1.4;border:1px solid}
.be-al.w{color:#fde68a;background:rgba(251,191,36,.07);border-color:rgba(251,191,36,.3)}
.be-al.b{color:#fecaca;background:rgba(248,113,113,.08);border-color:rgba(248,113,113,.35)}
.be-al.g{color:#a7f3d0;background:rgba(52,211,153,.07);border-color:rgba(52,211,153,.3)}
.be-alerts{display:flex;flex-direction:column;gap:.35rem}
.be-mass{display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:.35rem;align-items:end}
.be-mass label{display:flex;flex-direction:column;gap:.2rem;font-size:.58rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--be-dim)}
.be-mass input{font-family:var(--font-mono,ui-monospace,monospace);width:100%}
.be-legend{display:flex;flex-direction:column;gap:.25rem;font-size:.66rem;color:var(--be-mut)}
.be-save{display:flex;gap:.4rem;justify-content:flex-end;flex-wrap:wrap;align-items:center}
.be-dirty{font-size:.68rem;color:#fbbf24;font-weight:700;margin-right:auto}
.be-ov{position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:100002;display:flex;align-items:center;justify-content:center;padding:16px}
.be-mdl{background:#111114;border:1px solid #2f2f38;border-radius:1rem;width:100%;max-width:440px;padding:1.1rem;display:flex;flex-direction:column;gap:.75rem;color:#ececf0;font-family:Manrope,system-ui,sans-serif}
.be-mdl h2{margin:0;font-size:1rem}
.be-mdl .g2{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}
.be-mdl label{display:flex;flex-direction:column;gap:.3rem;font-weight:700;font-size:.75rem}
.be-mdl input,.be-mdl select{font:inherit;background:#0c0c0f;color:#ececf0;border:1px solid #2f2f38;border-radius:.45rem;padding:.45rem .55rem}
.be-mdl .row{display:flex;justify-content:flex-end;gap:.5rem}
`;
    function injetarCss() {
        if (document.getElementById('be-css')) return;
        const st = document.createElement('style'); st.id = 'be-css'; st.textContent = CSS; document.head.appendChild(st);
    }

    // ─── utilidades de estrutura ───
    function numeros(arr) { let k = 0; return arr.map(r => isN(r) ? ++k : null); }
    function proximoBB(arr, pos) {
        const ns = arr.slice(0, pos).filter(isN);
        if (!ns.length) return 200;
        const a = Number(ns[ns.length - 1].bb) || 200, b = ns.length > 1 ? (Number(ns[ns.length - 2].bb) || a / 1.25) : a / 1.25;
        const ia = LADDER.indexOf(near(a)), ib = LADDER.indexOf(near(b));
        const passo = Math.max(1, ia - ib);
        return LADDER[Math.min(LADDER.length - 1, ia + passo)] || Math.round(a * 1.3);
    }
    function ladderFrom(bb0, n, vel) {
        const out = []; let alvo = bb0, last = 0;
        for (let i = 0; i < n; i++) {
            let v = i === 0 ? bb0 : near(alvo);
            if (v <= last) v = LADDER.find(x => x > last) || last * 2;
            out.push(v); last = v; alvo = Math.max(alvo * vel, v * vel * .98);
        }
        return out;
    }
    const anteDe = (modo, bb) => modo === 'bb' ? bb : modo === 'classico' ? Math.max(0, Math.round(bb / 8 / 5) * 5) : 0;
    // Qual regra de ante a estrutura segue (para os botões e para níveis novos). null = manual/misturado
    function anteModo(arr) {
        const ns = arr.filter(isN);
        if (!ns.length) return 'bb';
        for (const m of ['bb', 'sem', 'classico']) if (ns.every(r => (Number(r.ante) || 0) === anteDe(m, Number(r.bb) || 0))) return m;
        return null;
    }
    function anteParaNovo(arr, pos, bb) {
        const m = anteModo(arr);
        if (m) return anteDe(m, bb);
        const prev = arr.slice(0, pos).filter(isN).pop();
        if (!prev || !Number(prev.bb)) return 0;
        return near((Number(prev.ante) || 0) * bb / Number(prev.bb)) || 0;
    }
    const minLabel = (m) => Math.floor(m / 60) + 'h' + String(Math.round(m % 60)).padStart(2, '0');
    const hora = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    // ─── instâncias ───
    // ctx: { modo:'criar'|'rodando', el, rows(), setRows(a), padrao(), stack(), ateNivel(), addon(), idxAtual(), restanteSeg(), rodando(), onChange(), wide, verPassados, full }
    function render(ctx) {
        injetarCss();
        const arr = ctx.rows(), live = ctx.modo === 'rodando', nums = numeros(arr);
        const idxAtual = live ? ctx.idxAtual() : -1;
        const padrao = ctx.padrao();
        const durDe = (r) => isN(r) ? (Number(r.tempo) || padrao) : (Number(r.tempo) || 10);
        const ate = Number(ctx.ateNivel()) || 0;
        const agora = Date.now();

        // horário de início de cada linha
        const ini = []; let acc = 0;
        arr.forEach((r, i) => {
            if (live && i < idxAtual) { ini.push(null); return; }
            ini.push(acc);
            acc += (live && i === idxAtual) ? (ctx.restanteSeg() / 60) : durDe(r);
        });
        const quando = (i) => {
            if (ini[i] == null) return 'jogado';
            if (live) return i === idxAtual ? 'agora' : hora(agora + ini[i] * 60000);
            return minLabel(ini[i]);
        };

        const passadoOuAtual = (i) => live && i <= idxAtual;
        const linha = (r, i) => {
            const passado = live && i < idxAtual, atual = live && i === idxAtual;
            const ro = passado ? 'tabindex="-1" readonly' : '';
            const hd = (passado || atual) ? '<span></span>' : `<span class="be-hd" data-h="${i}" title="Segure e arraste" aria-label="Arrastar">⋮⋮</span>`;
            const del = (passado || atual) ? '<span></span>' : `<button class="be-del" data-del="${i}" title="Remover" aria-label="Remover">✕</button>`;
            if (!isN(r)) {
                const c = !!r.breakDeCompras;
                return `<div class="be-r be-b ${c ? 'be-c' : ''} ${passado ? 'be-past' : ''} ${atual ? 'be-now' : ''}" data-row="${i}">
                    ${hd}<span class="be-n">${c ? '🛒' : '☕'}${atual ? '<span class="be-agora">AGORA</span>' : ''}</span>
                    <span class="be-bl">${c ? 'Intervalo de compras' : 'Intervalo'}${passado ? '' : `<button class="be-tg" data-tg="${i}">${c ? '🛒 é de compras' : 'marcar como compras'}</button>`}</span>
                    <input type="number" min="1" value="${Number(r.tempo) || 10}" data-k="tempo" data-i="${i}" aria-label="Minutos do intervalo" ${ro}>
                    <span class="be-t">${quando(i)}</span>${del}</div>`;
            }
            const temPadrao = !(Number(r.tempo) > 0);
            return `<div class="be-r ${atual ? 'be-now' : ''} ${passado ? 'be-past' : ''}" data-row="${i}">
                ${hd}<span class="be-n">${nums[i]}${atual ? '<span class="be-agora">AGORA</span>' : ''}</span>
                <input type="number" min="0" value="${Number(r.sb) || 0}" data-k="sb" data-i="${i}" aria-label="Small blind" ${ro}>
                <input type="number" min="0" value="${Number(r.bb) || 0}" data-k="bb" data-i="${i}" aria-label="Big blind" ${ro}>
                <input type="number" min="0" value="${Number(r.ante) || 0}" data-k="ante" data-i="${i}" aria-label="Ante" ${ro}>
                <input type="number" min="1" value="${temPadrao ? padrao : Number(r.tempo)}" class="${temPadrao ? 'be-pad' : ''}" data-k="tempo" data-i="${i}" aria-label="Minutos" title="${temPadrao ? 'Tempo padrão do torneio' : 'Tempo deste nível'}" ${ro}>
                <span class="be-t">${quando(i)}</span>${del}</div>`;
        };

        let tbl = `<div class="be-hdr"><span></span><span>Nível</span><span>Small</span><span>Big</span><span>Ante</span><span>Min</span><span class="be-hc">${live ? 'Começa' : 'Início +'}</span><span></span></div>`;
        arr.forEach((r, i) => {
            if (live && i < idxAtual && !ctx.verPassados) {
                if (i === 0) { const jog = nums.filter((n, j) => n && j < idxAtual).length; tbl += `<div class="be-fold"><button data-fold="1">▸ ${jog} nível(is) já jogado(s) (travados) · clique para ver</button></div>`; }
                return;
            }
            if (live && i === 0 && ctx.verPassados && idxAtual > 0) tbl += `<div class="be-fold"><button data-fold="0">▾ Recolher níveis jogados</button></div>`;
            tbl += linha(r, i);
            if (isN(r) && ate > 0 && nums[i] === ate) tbl += `<div class="be-lock">🔒 Entradas e reentradas encerram depois do nível ${ate}</div>`;
        });

        // resumo / alertas
        const nNiv = nums.filter(Boolean).length, nInt = arr.filter(r => !isN(r)).length;
        const totalMin = acc;
        const am = anteModo(arr);
        const al = [];
        const ultimo = arr[arr.length - 1];
        const iComp = arr.findIndex(r => !isN(r) && r.breakDeCompras);
        if (ultimo && !isN(ultimo)) al.push(['b', 'A estrutura termina num intervalo: depois dele não há mais níveis. Use "+ 5 níveis no fim".']);
        if (ctx.addon() && iComp < 0) al.push(['w', 'Tem add-on, mas nenhum intervalo de compras: o add-on não vai liberar. Marque um intervalo como 🛒.']);
        if (iComp >= 0) { const depois = nums.slice(iComp).filter(Boolean).length; if (depois > 0 && depois < 6) al.push(['w', `Só ${depois} nível(is) depois do intervalo de compras.`]); }
        if (ate > 0 && nNiv < ate) al.push(['w', `Entradas até o nível ${ate}, mas a estrutura tem ${nNiv} níveis.`]);
        for (let i = 1; i < arr.length; i++) if (!isN(arr[i]) && !isN(arr[i - 1])) { al.push(['w', 'Dois intervalos seguidos.']); break; }
        const ns = arr.filter(isN);
        for (let i = 1; i < ns.length; i++) if ((Number(ns[i].bb) || 0) <= (Number(ns[i - 1].bb) || 0)) { al.push(['w', `O big blind não sobe entre os níveis ${i} e ${i + 1}.`]); break; }
        if (!al.length) al.push(['g', `Estrutura completa: ${nNiv} níveis, ${nInt} intervalo(s), ${live ? 'termina' : 'dura'} ${live ? 'por volta das ' + hora(agora + totalMin * 60000) : minLabel(totalMin)}.`]);
        ctx._temErroGrave = al.some(a => a[0] === 'b');

        const bb1 = (ns[0] || {}).bb; const stack = Number(ctx.stack()) || 0;
        const resumo = `<div class="be-box"><div class="be-lbl" style="margin-bottom:.4rem">Resumo</div><div class="be-kv">
            <div><div class="be-lbl">Níveis</div><div class="be-v">${nNiv}</div></div>
            <div><div class="be-lbl">Intervalos</div><div class="be-v">${nInt}</div></div>
            <div><div class="be-lbl">${live ? 'Tempo restante' : 'Tempo total'}</div><div class="be-v">${minLabel(totalMin)}</div></div>
            <div><div class="be-lbl">${live ? 'Fim previsto' : 'Stack em BBs'}</div><div class="be-v">${live ? hora(agora + totalMin * 60000) : (stack && bb1 ? fmt(stack / bb1) : '—')}</div></div>
        </div></div>`;
        const alertas = `<div class="be-alerts">${al.map(([c, x]) => `<div class="be-al ${c}">${c === 'g' ? '✅' : c === 'b' ? '⛔' : '⚠️'} ${esc(x)}</div>`).join('')}</div>`;
        const massa = `<div class="be-box"><div class="be-lbl" style="margin-bottom:.4rem">Tempo em massa</div><div class="be-mass">
            <label>Do nível<input class="be-in" type="number" min="1" data-m="de" value="${ctx._mDe || (live ? (nums[idxAtual] || 0) + 1 : 1)}"></label>
            <label>Até o<input class="be-in" type="number" min="1" data-m="ate" value="${ctx._mAte || nNiv}"></label>
            <label>Minutos<input class="be-in" type="number" min="1" data-m="min" value="${ctx._mMin || padrao}"></label>
            <button class="be-btn" data-act="massa">Aplicar</button></div></div>`;
        const legenda = `<div class="be-box be-legend"><div class="be-lbl">Legenda</div>
            <div>🔒 linha vermelha: entradas e reentradas encerram</div>
            <div><span style="color:#f5b53d">🛒 amarelo</span>: intervalo de compras (libera re-entry, rebuy e add-on)</div>
            <div><span style="color:#38bdf8">☕ azul</span>: intervalo comum</div>
            <div>minutos em cinza = tempo padrão do torneio</div></div>`;
        const salvarBar = live ? `<div class="be-save">${ctx.dirty ? '<span class="be-dirty">● Alterações não salvas</span>' : '<span class="be-dirty" style="color:#686874">Sem alterações</span>'}
            <button class="be-btn ghost" data-act="descartar" ${ctx.dirty ? '' : 'disabled style="opacity:.4"'}>Descartar</button>
            <button class="be-btn pri" data-act="salvar" ${ctx.dirty ? '' : 'disabled style="opacity:.4"'}>💾 Salvar estrutura</button></div>`
            : `<div class="be-save"><button class="be-btn" data-act="salvar-modelo">💾 Salvar como modelo</button></div>`;

        const wide = ctx.wide || ctx.full;
        const tb = live
            ? `<div class="be-tb"><span class="be-chip" style="color:#22c55e;border-color:rgba(34,197,94,.4)">● Nível ${nums[idxAtual] || '—'} · ${ctx.rodando() ? 'rodando' : 'pausado'}</span>
                <span class="be-seg" role="group" aria-label="Ante">${['bb', 'classico', 'sem'].map(m => `<button data-ante="${m}" aria-pressed="${am === m}">${{ bb: 'BB ante', classico: 'Ante clássico', sem: 'Sem ante' }[m]}</button>`).join('')}</span>
                <span class="be-sp"></span><button class="be-btn ghost" data-act="expandir">${ctx.full ? '✕ Fechar' : '⤢ Expandir'}</button></div>`
            : `<div class="be-tb">
                <select data-act="modelo" aria-label="Modelos de estrutura"><option value="">📂 Modelos…</option>${modelosOptions()}</select>
                <button class="be-btn gold" data-act="gerar">⚡ Gerar estrutura</button>
                <span class="be-seg" role="group" aria-label="Ante">${['bb', 'classico', 'sem'].map(m => `<button data-ante="${m}" aria-pressed="${am === m}">${{ bb: 'BB ante', classico: 'Ante clássico', sem: 'Sem ante' }[m]}</button>`).join('')}</span>
                <span class="be-sp"></span>
                ${typeof window.abrirModalFaixas === 'function' ? '<button class="be-btn ghost" data-act="faixas" title="Tempos por faixa de níveis">⏱ Faixas</button>' : ''}
                <button class="be-btn ghost" data-act="expandir">${ctx.full ? '✕ Fechar' : '⤢ Expandir'}</button></div>`;

        const scrollAntes = (ctx.el.querySelector('.be-tbl') || {}).scrollTop || 0;
        // Mantém o foco no campo onde o operador estava (Tab entre campos não se perde ao redesenhar)
        const ae = document.activeElement, foco = (ae && ctx.el.contains(ae)) ? { k: ae.dataset.k, i: ae.dataset.i, m: ae.dataset.m } : null;
        ctx.el.className = 'be-root' + (wide ? ' be-wide' : '') + (ctx.full ? ' be-full' : '');
        ctx.el.innerHTML = `${ctx.full ? `<div style="font-weight:800;font-size:1rem">${live ? 'Estrutura de blinds · torneio rodando' : 'Estrutura de blinds · novo torneio'}</div>` : ''}${tb}
            <div class="be-body"><div class="be-main">
                <div class="be-tbl">${tbl}</div>
                <div class="be-pal-w">
                    <span class="be-pal" data-pal="n">⋮⋮ + Nível</span>
                    <span class="be-pal ib" data-pal="b">⋮⋮ + Intervalo</span>
                    <span class="be-pal c" data-pal="c">⋮⋮ + Intervalo de compras</span>
                    <button class="be-btn" data-act="mais5">+ 5 níveis no fim</button>
                </div>
                <div class="be-note">Clique num botão para acrescentar no fim, ou <b>segure e arraste</b> até a posição. Para mudar a ordem, segure o <b>⋮⋮</b> da linha e arraste.${live ? ' Níveis jogados e o nível atual não mudam de lugar.' : ''}</div>
                ${wide ? '' : alertas}
            </div>
            <div class="be-side">${wide ? resumo + alertas : ''}${massa}${wide ? legenda : ''}${salvarBar}</div></div>`;
        const tblEl = ctx.el.querySelector('.be-tbl'); if (tblEl) tblEl.scrollTop = scrollAntes;
        ligar(ctx);
        if (foco) {
            const sel = foco.k ? `input[data-k="${foco.k}"][data-i="${foco.i}"]` : (foco.m ? `input[data-m="${foco.m}"]` : null);
            const f = sel && ctx.el.querySelector(sel);
            if (f) { try { f.focus({ preventScroll: true }); if (f.select) f.select(); } catch (_) {} }
        }
    }

    function alterou(ctx, msg) {
        if (ctx.modo === 'rodando') ctx.dirty = true;
        try { ctx.onChange && ctx.onChange(); } catch (e) { console.warn('[BlindEditor] onChange', e); }
        if (msg) toast(msg);
        render(ctx);
    }

    function novoItem(ctx, tipo, pos) {
        const arr = ctx.rows();
        if (tipo === 'n') {
            const bb = proximoBB(arr, pos);
            const prev = arr.slice(0, pos).filter(isN).pop();
            const it = { sb: Math.round(bb / 2), bb, ante: anteParaNovo(arr, pos, bb) };
            if (ctx.modo === 'rodando' && prev && Number(prev.tempo) > 0) it.tempo = Number(prev.tempo);
            return it;
        }
        if (tipo === 'c') { arr.forEach(x => { if (!isN(x)) x.breakDeCompras = false; }); return { isBreak: true, tempo: 30, sb: 0, bb: 0, ante: 0, breakDeCompras: true }; }
        return { isBreak: true, tempo: 10, sb: 0, bb: 0, ante: 0 };
    }
    const nomePal = { n: 'Nível', b: 'Intervalo', c: 'Intervalo de compras' };
    function primeiroLivre(ctx) { return ctx.modo === 'rodando' ? ctx.idxAtual() + 1 : 0; }

    function ligar(ctx) {
        const el = ctx.el, arr = ctx.rows();
        el.querySelectorAll('.be-r input[data-k]').forEach(inp => inp.onchange = () => {
            const i = Number(inp.dataset.i), r = arr[i], k = inp.dataset.k;
            if (!r || (ctx.modo === 'rodando' && i < ctx.idxAtual())) return render(ctx);
            const v = Math.round(Number(inp.value));
            if (!(v >= 0) || ((k === 'bb' || k === 'tempo') && v <= 0)) { toast('⚠️ Valor inválido'); return render(ctx); }
            if (k === 'bb') {
                const modo = anteModo(arr), antigo = Number(r.bb) || 0;
                if ((Number(r.sb) || 0) === Math.round(antigo / 2)) r.sb = Math.round(v / 2);
                r.bb = v;
                if (modo) r.ante = anteDe(modo, v);
            } else if (k === 'tempo') {
                if (isN(r) && ctx.modo === 'criar' && v === ctx.padrao()) { delete r.tempo; delete r._tempoSource; }
                else { r.tempo = v; if (isN(r)) r._tempoSource = 'manual'; }
            } else r[k] = v;
            // redesenha depois que o foco já foi para o próximo campo (Tab/Enter não se perdem)
            setTimeout(() => alterou(ctx), 0);
        });
        el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
            const i = Number(b.dataset.del);
            if (ctx.modo === 'rodando' && i <= ctx.idxAtual()) return;
            if (ctx.modo === 'criar' && arr.filter(isN).length <= 2 && isN(arr[i])) return toast('⚠️ Mínimo 2 níveis');
            arr.splice(i, 1); alterou(ctx, 'Removido.');
        });
        el.querySelectorAll('[data-tg]').forEach(b => b.onclick = () => {
            const i = Number(b.dataset.tg), r = arr[i];
            if (!r || (ctx.modo === 'rodando' && i < ctx.idxAtual())) return;
            const v = !r.breakDeCompras;
            arr.forEach(x => { if (!isN(x)) x.breakDeCompras = false; });
            r.breakDeCompras = v;
            alterou(ctx, v ? '🛒 Intervalo de compras marcado (libera re-entry, rebuy e add-on)' : 'Marcação de compras removida');
        });
        el.querySelectorAll('[data-fold]').forEach(b => b.onclick = () => { ctx.verPassados = b.dataset.fold === '1'; render(ctx); });
        el.querySelectorAll('.be-hd[data-h]').forEach(h => h.onpointerdown = (e) => arrastar(ctx, e, { mover: Number(h.dataset.h) }));
        el.querySelectorAll('.be-pal').forEach(p => p.onpointerdown = (e) => arrastar(ctx, e, { novo: p.dataset.pal }));
        el.querySelectorAll('[data-ante]').forEach(b => b.onclick = () => {
            const m = b.dataset.ante, min = primeiroLivre(ctx); let c = 0;
            arr.forEach((r, i) => { if (isN(r) && i >= min) { r.ante = anteDe(m, Number(r.bb) || 0); c++; } });
            alterou(ctx, `Ante aplicado em ${c} nível(is)` + (ctx.modo === 'rodando' ? ' (só os próximos)' : ''));
        });
        el.querySelectorAll('[data-m]').forEach(inp => inp.oninput = () => { ctx['_m' + { de: 'De', ate: 'Ate', min: 'Min' }[inp.dataset.m]] = inp.value; });
        const act = (n, fn) => { const b = el.querySelector(`[data-act="${n}"]`); if (b) (b.tagName === 'SELECT' ? (b.onchange = () => fn(b)) : (b.onclick = () => fn(b))); };
        act('mais5', () => { for (let k = 0; k < 5; k++) arr.push(novoItem(ctx, 'n', arr.length)); alterou(ctx, '5 níveis acrescentados no fim, seguindo a progressão.'); const t = el.querySelector('.be-tbl'); if (t) t.scrollTop = t.scrollHeight; });
        act('massa', () => {
            const de = Number(el.querySelector('[data-m="de"]').value), ate = Number(el.querySelector('[data-m="ate"]').value), mi = Number(el.querySelector('[data-m="min"]').value);
            if (!(de > 0 && ate >= de && mi > 0)) return toast('⚠️ Confira os campos do tempo em massa');
            const nums = numeros(arr), min = primeiroLivre(ctx); let c = 0;
            arr.forEach((r, i) => { if (isN(r) && nums[i] >= de && nums[i] <= ate && i >= min) { if (ctx.modo === 'criar' && mi === ctx.padrao()) { delete r.tempo; delete r._tempoSource; } else { r.tempo = mi; r._tempoSource = 'manual'; } c++; } });
            if (!c) return toast(ctx.modo === 'rodando' ? 'Nenhum nível nessa faixa (jogados e o atual não mudam).' : 'Nenhum nível nessa faixa.');
            alterou(ctx, `${c} nível(is) do ${de} ao ${ate} com ${mi} min.`);
        });
        act('expandir', () => { ctx.full = !ctx.full; document.body.style.overflow = ctx.full ? 'hidden' : ''; render(ctx); });
        act('faixas', () => { try { window.abrirModalFaixas(); } catch (_) {} });
        act('gerar', () => abrirGerar(ctx));
        act('modelo', (sel) => { const v = sel.value; sel.value = ''; if (v) aplicarModelo(ctx, v); });
        act('salvar-modelo', () => salvarModelo(ctx));
        act('salvar', () => ctx.salvar && ctx.salvar());
        act('descartar', () => ctx.descartar && ctx.descartar());
    }

    // ─── segurar e arrastar (mouse e toque) ───
    function arrastar(ctx, e, alvoCtx) {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        const el = ctx.el, tbl = el.querySelector('.be-tbl');
        const x0 = e.clientX, y0 = e.clientY; let ativo = false, ghost = null, line = null, alvo = null;
        const posicao = (y) => {
            const linhas = [...tbl.querySelectorAll('.be-r[data-row]')], min = primeiroLivre(ctx);
            for (const r of linhas) { const i = Number(r.dataset.row); if (i < min) continue; const rc = r.getBoundingClientRect(); if (y < rc.top + rc.height / 2) return { i, el: r, antes: true }; }
            return { i: ctx.rows().length, el: linhas[linhas.length - 1], antes: false };
        };
        const mov = (ev) => {
            if (!ativo) {
                if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
                ativo = true; document.body.classList.add('be-dragging');
                ghost = document.createElement('div');
                if (alvoCtx.mover != null) {
                    const r = ctx.rows()[alvoCtx.mover];
                    ghost.className = 'be-ghost' + (isN(r) ? '' : ' ib');
                    ghost.textContent = isN(r) ? 'Nível ' + numeros(ctx.rows())[alvoCtx.mover] + ' · ' + fmt(r.sb) + '/' + fmt(r.bb) : (r.breakDeCompras ? '🛒 Intervalo de compras' : '☕ Intervalo') + ' · ' + (r.tempo || 10) + ' min';
                    const rEl = tbl.querySelector(`.be-r[data-row="${alvoCtx.mover}"]`); if (rEl) rEl.classList.add('be-drag');
                } else { ghost.className = 'be-ghost' + (alvoCtx.novo !== 'n' ? ' ib' : ''); ghost.textContent = '+ ' + nomePal[alvoCtx.novo]; }
                document.body.appendChild(ghost);
                line = document.createElement('div'); line.className = 'be-dropline';
            }
            ghost.style.left = (ev.clientX + 12) + 'px'; ghost.style.top = (ev.clientY + 8) + 'px';
            const rc = tbl.getBoundingClientRect();
            if (ev.clientY < rc.top + 36) tbl.scrollTop -= 12; else if (ev.clientY > rc.bottom - 36) tbl.scrollTop += 12;
            const dentro = ev.clientX >= rc.left && ev.clientX <= rc.right && ev.clientY >= rc.top - 20 && ev.clientY <= rc.bottom + 70;
            if (!dentro) { alvo = null; line.remove(); return; }
            alvo = posicao(ev.clientY);
            if (alvo.el) { if (alvo.antes) alvo.el.before(line); else alvo.el.after(line); }
        };
        const fim = () => {
            window.removeEventListener('pointermove', mov); window.removeEventListener('pointerup', fim); window.removeEventListener('pointercancel', fim);
            document.body.classList.remove('be-dragging'); if (ghost) ghost.remove(); if (line) line.remove();
            const arr = ctx.rows();
            if (!ativo) {
                if (alvoCtx.novo) { arr.push(novoItem(ctx, alvoCtx.novo, arr.length)); alterou(ctx, nomePal[alvoCtx.novo] + ' acrescentado no fim.'); const t = ctx.el.querySelector('.be-tbl'); if (t) t.scrollTop = t.scrollHeight; }
                return;
            }
            if (!alvo) { render(ctx); return; }
            const min = primeiroLivre(ctx);
            let para = Math.max(min, alvo.i);
            if (alvoCtx.mover != null) {
                if (alvoCtx.mover < min) { render(ctx); return; }
                const [it] = arr.splice(alvoCtx.mover, 1); if (para > alvoCtx.mover) para--; arr.splice(para, 0, it);
                alterou(ctx, 'Movido.');
            } else { arr.splice(para, 0, novoItem(ctx, alvoCtx.novo, para)); alterou(ctx, nomePal[alvoCtx.novo] + ' inserido na posição.'); }
        };
        window.addEventListener('pointermove', mov); window.addEventListener('pointerup', fim); window.addEventListener('pointercancel', fim);
    }

    // ─── Gerar estrutura ───
    function abrirGerar(ctx) {
        const ate = Number(ctx.ateNivel()) || 0;
        const ov = document.createElement('div'); ov.className = 'be-ov';
        const am = anteModo(ctx.rows()) || 'bb';
        ov.innerHTML = `<form class="be-mdl"><h2>⚡ Gerar estrutura</h2>
            <div class="g2">
                <label>Quantos níveis?<input type="number" name="n" value="30" min="3" max="80"></label>
                <label>Minutos por nível<input type="number" name="min" value="${ctx.padrao()}" min="1" max="120"></label>
                <label>Big blind inicial<input type="number" name="bb" value="${(ctx.rows().find(isN) || {}).bb || 200}" min="2"></label>
                <label>Velocidade<select name="vel"><option value="1.18">🐢 Lenta</option><option value="1.25" selected>⚖️ Padrão</option><option value="1.34">⚡ Turbo</option></select></label>
            </div>
            <label>Intervalos depois dos níveis <span style="font-weight:500;color:#686874">(separe por vírgula)</span><input type="text" name="brk" value="${ate > 0 ? ate : 6}"></label>
            <div class="g2">
                <label>Minutos do intervalo<input type="number" name="bmin" value="10" min="1"></label>
                <label>Intervalo de compras<select name="comp"></select></label>
            </div>
            <label>Ante<select name="ante"><option value="bb" ${am === 'bb' ? 'selected' : ''}>BB ante</option><option value="classico" ${am === 'classico' ? 'selected' : ''}>Ante clássico</option><option value="sem" ${am === 'sem' ? 'selected' : ''}>Sem ante</option></select></label>
            <div style="font-size:.7rem;color:#fbbf24">Substitui a estrutura inteira desta tela.</div>
            <div class="row"><button type="button" class="be-btn ghost" data-x>Cancelar</button><button type="submit" class="be-btn pri">Gerar</button></div></form>`;
        document.body.appendChild(ov);
        const f = ov.querySelector('form');
        const opc = () => {
            const ps = f.brk.value.split(/[,;\s]+/).map(Number).filter(n => n > 0);
            const sel = ps.filter(x => !ate || x <= ate).pop() || 0;
            f.comp.innerHTML = '<option value="0">nenhum</option>' + ps.map(p => `<option value="${p}" ${p === sel ? 'selected' : ''}>depois do nível ${p}</option>`).join('');
        };
        opc(); f.brk.oninput = opc;
        const fechar = () => ov.remove();
        ov.querySelector('[data-x]').onclick = fechar;
        ov.onclick = (e) => { if (e.target === ov) fechar(); };
        f.onsubmit = (e) => {
            e.preventDefault();
            const n = Math.min(80, Math.max(3, Number(f.n.value) || 30)), min = Number(f.min.value) || 15, bb = Number(f.bb.value) || 200, vel = Number(f.vel.value) || 1.25;
            const ps = f.brk.value.split(/[,;\s]+/).map(Number).filter(x => x > 0 && x < n), comp = Number(f.comp.value) || 0, bmin = Number(f.bmin.value) || 10, ante = f.ante.value;
            const rows = [];
            ladderFrom(bb, n, vel).forEach((v, i) => {
                rows.push({ sb: Math.round(v / 2), bb: v, ante: anteDe(ante, v) });
                if (ps.includes(i + 1)) { const c = (i + 1) === comp; rows.push(c ? { isBreak: true, tempo: Math.max(bmin, 10), sb: 0, bb: 0, ante: 0, breakDeCompras: true } : { isBreak: true, tempo: bmin, sb: 0, bb: 0, ante: 0 }); }
            });
            if (ctx.setPadrao) ctx.setPadrao(min);
            ctx.setRows(rows);
            fechar();
            alterou(ctx, `Estrutura gerada: ${n} níveis de ${min} min, ${ps.length} intervalo(s).`);
        };
        f.n.focus();
    }

    // ─── Modelos (do clube + torneios recentes) ───
    let _modelos = [];
    async function carregarModelos() {
        try {
            if (typeof sb === 'undefined' || !sb || typeof sbClube === 'undefined' || !sbClube) return;
            const { data, error } = await sb.from('blind_modelos').select('id,nome,blinds,tempo_nivel,criado_em').eq('clube_id', sbClube.id).order('criado_em', { ascending: false }).limit(50);
            if (!error && Array.isArray(data)) _modelos = data;
        } catch (_) {}
    }
    function recentes() {
        const lista = (typeof torneios !== 'undefined' && Array.isArray(torneios)) ? torneios.slice() : [];
        const vistos = new Set(), out = [];
        lista.sort((a, b) => (Number(b.iniciadoEm) || 0) - (Number(a.iniciadoEm) || 0));
        for (const t of lista) {
            if (!t || !Array.isArray(t.blinds) || t.blinds.filter(isN).length < 3) continue;
            const k = (t.nome || '').trim().toLowerCase(); if (!k || vistos.has(k)) continue;
            vistos.add(k); out.push(t); if (out.length >= 8) break;
        }
        return out;
    }
    function modelosOptions() {
        const m = _modelos.map(x => `<option value="m:${esc(x.id)}">${esc(x.nome)} · ${(x.blinds || []).filter(isN).length} níveis</option>`).join('');
        const r = recentes().map(t => `<option value="t:${esc(t.id)}">${esc(t.nome)} · ${t.blinds.filter(isN).length} níveis</option>`).join('');
        return (m ? `<optgroup label="Modelos do clube">${m}</optgroup>` : '') + (r ? `<optgroup label="Igual a um torneio recente">${r}</optgroup>` : '');
    }
    function aplicarModelo(ctx, v) {
        let blinds = null, tempo = null, nome = '';
        if (v.startsWith('m:')) { const m = _modelos.find(x => x.id === v.slice(2)); if (m) { blinds = m.blinds; tempo = m.tempo_nivel; nome = m.nome; } }
        else { const t = (torneios || []).find(x => String(x.id) === v.slice(2)); if (t) { blinds = t.blinds; tempo = t.tempoNivel; nome = t.nome; } }
        if (!Array.isArray(blinds) || !blinds.length) return toast('⚠️ Modelo vazio');
        const limpo = clone(blinds).map(b => b.isBreak
            ? { isBreak: true, tempo: Number(b.tempo) || 10, sb: 0, bb: 0, ante: 0, ...(b.breakDeCompras ? { breakDeCompras: true } : {}) }
            : { sb: Number(b.sb) || 0, bb: Number(b.bb) || 0, ante: Number(b.ante) || 0, ...(Number(b.tempo) > 0 ? { tempo: Number(b.tempo) } : {}) });
        if (tempo && ctx.setPadrao) ctx.setPadrao(Number(tempo));
        ctx.setRows(limpo);
        alterou(ctx, 'Estrutura carregada: ' + nome);
    }
    async function salvarModelo(ctx) {
        const nome = (prompt('Nome do modelo de estrutura (ex: Padrão 15 min):') || '').trim();
        if (!nome) return;
        try {
            const { data, error } = await sb.from('blind_modelos').insert({ clube_id: sbClube.id, nome, blinds: clone(ctx.rows()), tempo_nivel: ctx.padrao() }).select('id,nome,blinds,tempo_nivel,criado_em').single();
            if (error) throw error;
            _modelos.unshift(data);
            toast('💾 Modelo "' + nome + '" salvo para o clube');
            render(ctx);
        } catch (e) { console.warn('[BlindEditor] salvar modelo', e); toast('⚠️ Não foi possível salvar o modelo'); }
    }

    // ─── 1) Criação do torneio (blindStructure global) ───
    const ctxCriar = {
        modo: 'criar',
        rows: () => blindStructure,
        setRows: (a) => { blindStructure = a; },
        padrao: () => parseInt((document.getElementById('t-tempo') || {}).value, 10) || 15,
        setPadrao: (m) => { const el = document.getElementById('t-tempo'); if (el) { el.value = m; el.dispatchEvent(new Event('input', { bubbles: true })); } },
        stack: () => parseInt((document.getElementById('t-stack') || {}).value, 10) || 0,
        ateNivel: () => parseInt((document.getElementById('t-reentry') || {}).value, 10) || 0,
        addon: () => (parseFloat((document.getElementById('t-addon-valor') || {}).value) || 0) > 0 || (parseInt((document.getElementById('t-addon-fichas') || {}).value, 10) || 0) > 0,
        idxAtual: () => -1, restanteSeg: () => 0, rodando: () => false,
        onChange: () => {
            try { if (typeof _atualizarResumoTorneio === 'function') _atualizarResumoTorneio(); } catch (_) {}
            try { if (typeof window.t2AtualizarStatusRebuy === 'function') window.t2AtualizarStatusRebuy(); } catch (_) {}
        }
    };
    function renderCriar() {
        const c = document.getElementById('blinds-setup');
        if (!c) return false;
        ctxCriar.el = c;
        render(ctxCriar);
        try { if (typeof _atualizarResumoTorneio === 'function') setTimeout(_atualizarResumoTorneio, 30); } catch (_) {}
        return true;
    }
    // Ao mudar tempo padrão / trava / add-on no formulário, atualiza o editor (sem perder foco do campo)
    document.addEventListener('change', (e) => {
        const id = e.target && e.target.id;
        if (['t-tempo', 't-reentry', 't-stack', 't-addon-valor', 't-addon-fichas'].includes(id) && ctxCriar.el && document.body.contains(ctxCriar.el)) render(ctxCriar);
    });

    // ─── 2) Torneio rodando (cópia de t.blinds, grava ao salvar) ───
    const ctxRod = {
        modo: 'rodando', wide: true, dirty: false, draft: null, tid: null, baseNivel: null,
        rows: () => ctxRod.draft,
        setRows: (a) => { ctxRod.draft = a; },
        torneio: () => (typeof activeTorneioIdx !== 'undefined' && activeTorneioIdx !== null) ? torneios[activeTorneioIdx] : null,
        padrao: () => Number((ctxRod.torneio() || {}).tempoNivel) || 15,
        stack: () => Number((ctxRod.torneio() || {}).stack) || 0,
        ateNivel: () => Number((ctxRod.torneio() || {}).reentryAte) || 0,
        addon: () => { const t = ctxRod.torneio() || {}; return (Number(t.addonValor) || 0) > 0 || (Number(t.addonFichas) || 0) > 0; },
        idxAtual: () => Number((ctxRod.torneio() || {}).nivelAtual) || 0,
        restanteSeg: () => { const t = ctxRod.torneio() || {}; if (t.rodando && t.tempoAlvo && typeof _nowServidor === 'function') return Math.max(0, (Number(t.tempoAlvo) - _nowServidor()) / 1000); return Number(t.tempoRestante) || 0; },
        rodando: () => !!(ctxRod.torneio() || {}).rodando,
        onChange: () => {},
        salvar: () => salvarRodando(),
        descartar: () => { ctxRod.dirty = false; ctxRod.draft = null; renderRodando(); toast('Alterações descartadas'); }
    };
    function renderRodando() {
        const c = document.getElementById('be-rodando');
        const t = ctxRod.torneio();
        if (!c || !t) return false;
        // Rascunho novo se trocou de torneio ou não há alteração pendente (pega o que veio da sincronização)
        if (ctxRod.tid !== t.id || !ctxRod.dirty || !ctxRod.draft || ctxRod.baseNivel !== t.nivelAtual) {
            if (ctxRod.dirty && ctxRod.tid === t.id && ctxRod.baseNivel !== t.nivelAtual) toast('⚠️ O relógio mudou de nível enquanto você editava: a estrutura foi recarregada, refaça a alteração.');
            ctxRod.tid = t.id; ctxRod.draft = clone(t.blinds); ctxRod.dirty = false; ctxRod.baseNivel = t.nivelAtual; ctxRod.verPassados = false;
        }
        ctxRod.el = c;
        render(ctxRod);
        return true;
    }
    function salvarRodando() {
        const t = ctxRod.torneio();
        if (!t || !ctxRod.dirty || !ctxRod.draft) return;
        if (t.id !== ctxRod.tid || t.nivelAtual !== ctxRod.baseNivel) { ctxRod.dirty = false; renderRodando(); return toast('⚠️ O relógio mudou de nível: refaça a alteração.'); }
        const novo = clone(ctxRod.draft), idx = t.nivelAtual || 0;
        // Garantia: níveis jogados ficam exatamente como estavam; o atual continua na mesma posição e tipo
        for (let i = 0; i < idx; i++) {
            if (JSON.stringify(novo[i]) !== JSON.stringify(t.blinds[i])) { toast('⚠️ Níveis já jogados não podem mudar. Nada foi salvo.'); return; }
        }
        if (!novo[idx] || !!novo[idx].isBreak !== !!(t.blinds[idx] || {}).isBreak) { toast('⚠️ O nível atual não pode mudar de lugar. Nada foi salvo.'); return; }
        if (!novo.length || novo[novo.length - 1].isBreak) { if (!confirm('A estrutura termina num intervalo (depois dele não há mais níveis). Salvar mesmo assim?')) return; }
        if (!confirm('Salvar a nova estrutura de blinds?\n\nVale na hora para o relógio e a TV. Níveis jogados não mudam.')) return;
        const tempoAntes = Number((t.blinds[idx] || {}).tempo) || 0;
        t.blinds = novo;
        const tempoDepois = Number((t.blinds[idx] || {}).tempo) || 0;
        // Mudou o tempo do nível atual: ajusta o relógio proporcionalmente (como o editor antigo)
        if (tempoDepois && tempoDepois !== tempoAntes && !t.isBreak) {
            const total = tempoDepois * 60, pct = t.tempoTotal > 0 ? (t.tempoRestante / t.tempoTotal) : 1;
            t.tempoTotal = total; t.tempoRestante = Math.floor(total * pct);
            try { if (typeof _recalcTempoAlvo === 'function') _recalcTempoAlvo(t); } catch (_) {}
        }
        try { saveData(); } catch (e) { console.warn('[BlindEditor] saveData', e); }
        try { if (typeof logAudit === 'function') logAudit('EDIT_BLINDS_INLINE', `Estrutura de blinds editada (editor novo) · ${t.nome}`, { torneioId: t.id, niveis: novo.filter(isN).length, intervalos: novo.filter(b => b.isBreak).length }); } catch (_) {}
        ctxRod.dirty = false;
        toast('✅ Estrutura de blinds salva');
        renderRodando();
        try { if (typeof renderTorneioControle === 'function') renderTorneioControle(); } catch (_) {}
        try { if (typeof updateModalTorneio === 'function') updateModalTorneio(); } catch (_) {}
        try { if (typeof updateTV === 'function') updateTV(activeTorneioIdx); } catch (_) {}
    }
    // Atualiza horários/nível atual a cada 15s enquanto a aba está visível e sem edição pendente
    setInterval(() => {
        try {
            const c = document.getElementById('be-rodando');
            if (!c || c.offsetParent === null || ctxRod.dirty) return;
            if (document.activeElement && c.contains(document.activeElement)) return;
            if (document.body.classList.contains('be-dragging')) return;
            renderRodando();
        } catch (_) {}
    }, 15000);
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        for (const c of [ctxCriar, ctxRod]) if (c.full) { c.full = false; document.body.style.overflow = ''; render(c); }
    });

    window.BlindEditor = { renderCriar, renderRodando, carregarModelos, _ctxCriar: ctxCriar, _ctxRod: ctxRod, _anteModo: anteModo, _proximoBB: proximoBB };
    carregarModelos();
    setTimeout(carregarModelos, 8000);
    // Se a tela de criação já está aberta quando o módulo carrega, troca pelo editor novo
    try { if (document.getElementById('blinds-setup') && document.getElementById('blinds-setup').offsetParent) renderCriar(); } catch (_) {}
})();
