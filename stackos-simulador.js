// ============================================================
// SIMULADOR DE TORNEIO (modo teste) — StackOS
// ------------------------------------------------------------
// Faz uma CÓPIA do torneio só na memória e lança jogadores fictícios.
// Usa as MESMAS funções de cálculo do app (getRake, getPrize, getStaffCascata,
// getStaffFixo, renderPayout, gerarComprovanteCompra) sem alterar nenhuma delas.
// NÃO grava nada: sem saveData, sem transações, sem sync, sem TV, sem auditoria.
// Opção do clube (padrão DESLIGADO): Configurações → Torneios.
// ============================================================
(function () {
    'use strict';

    const FLAG = 'simulador_torneio';
    const TIPOS = [
        ['buyin', 'Buy-in'], ['buyin_duplo', 'Buy-in duplo'], ['reentry', 'Re-entry (eliminado)'],
        ['rebuy_simples', 'Rebuy simples'], ['rebuy_duplo', 'Rebuy duplo'], ['addon', 'Add-on'], ['last_chance', 'Last Chance'],
    ];
    const ALERTA = '⚠️ Depois da primeira entrada real, buy-in, rake, taxa administrativa, add-on e fichas ficam travados. Confira tudo aqui antes de lançar jogadores.';

    let sim = null; // { tid, t (cópia), lanc: [{entry, nome, total}], n }

    const ativo = () => { try { return !!(window.sbClube && sbClube.config && sbClube.config[FLAG]); } catch (_) { return false; } };
    const ehAdmin = () => { try { return currentUser && (currentUser.role === 'admin' || currentUser.papel === 'admin' || window._isSuperAdmin); } catch (_) { return false; } };
    const fm = (v) => (typeof formatMoney === 'function') ? formatMoney(v) : ('R$ ' + Number(v || 0).toFixed(2));
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const nomeFake = (i) => 'Jogador Teste ' + String(i).padStart(2, '0');
    const nomeDe = (jid) => { const l = sim && sim.lanc.find(x => x.entry.jogadorId === jid); return l ? l.nome : jid; };
    const ehKO = (t) => !!t && ['bounty', 'pko', 'knockout'].includes(t.tipo);
    const splitPko = (t) => Number(t.pkoSplit != null ? t.pkoSplit : t.bountyKoSplit) || 0;
    const cabeca = (t, jid) => (typeof _bountyNaCabeca === 'function') ? _bountyNaCabeca(t, jid) : 0;
    function ativosSim(t) {
        const saiu = new Set((t.eliminados || []).map(e => e.jogadorId));
        return [...new Set(t.entries.filter(e => e.tipo !== 'addon').map(e => e.jogadorId))].filter(id => !saiu.has(id));
    }
    // ---------- KO: eliminação simulada (mesma regra do real: o eliminador recebe o bounty da cabeça) ----------
    function eliminarSim() {
        if (!sim) return;
        const t = sim.t;
        const jid = (document.getElementById('sim-ko-elim') || {}).value;
        const por = (document.getElementById('sim-ko-por') || {}).value || null;
        if (!jid) return showToast('⚠️ Escolha quem foi eliminado');
        if (por && por === jid) return showToast('⚠️ O jogador não pode eliminar ele mesmo');
        const ativos = ativosSim(t);
        if (ativos.length < 2) return showToast('⚠️ Torneio já terminou');
        const pago = por ? cabeca(t, jid) : 0;
        const ts = Date.now() + (sim.kos || []).length;
        t.eliminados.push({ jogadorId: jid, eliminadorId: por, bountyPago: pago, posicao: ativos.length, ts });
        // Histórico de KOs à parte: a re-entry tira o jogador dos eliminados, mas o KO já foi pago
        (sim.kos = sim.kos || []).push({ jogadorId: jid, eliminadorId: por, bountyPago: pago, posicao: ativos.length, ts });
        render();
    }
    function desfazerElimSim(i) {
        if (!sim) return;
        const k = (sim.kos || [])[i];
        if (!k) return;
        sim.kos.splice(i, 1);
        sim.t.eliminados = sim.t.eliminados.filter(e => e.ts !== k.ts);
        render();
    }
    function blocoKO(t) {
        if (!ehKO(t)) return '';
        const v = Number(t.bountyValor) || 0;
        const ativos = ativosSim(t);
        const fim = ativos.length === 1 && t.eliminados.length > 0;
        const noBolso = (e) => t.tipo === 'pko' ? (Number(e.bountyPago) || 0) * splitPko(t) / 100 : (Number(e.bountyPago) || 0);
        const kos = sim.kos || [];
        const pagos = kos.reduce((s, e) => s + (e.eliminadorId ? noBolso(e) : 0), 0);
        const naMesa = ativos.reduce((s, id) => s + cabeca(t, id), 0);
        const perdidos = kos.filter(e => !e.eliminadorId).length;
        const qtdComBounty = t.entries.filter(e => e.tipo !== 'addon' && e.tipo !== 'last_chance').length;
        const reservado = t.tipo === 'bounty' ? qtdComBounty * v : 0;
        const ganhos = {};
        kos.forEach(e => { if (e.eliminadorId) { const g = ganhos[e.eliminadorId] || (ganhos[e.eliminadorId] = { n: 0, v: 0 }); g.n++; g.v += noBolso(e); } });
        const row = (k, val, cor) => '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #222;font-size:13px;font-variant-numeric:tabular-nums"><span style="color:#a1a1aa">' + k + '</span><b style="color:' + (cor || '#e4e4e7') + '">' + val + '</b></div>';
        const opt = (ids, vazio) => (vazio ? '<option value="">' + vazio + '</option>' : '<option value="">— escolha —</option>') + ids.map(id => '<option value="' + esc(id) + '">' + esc(nomeDe(id)) + ' · ' + fm(cabeca(t, id)) + '</option>').join('');
        const avisos = [];
        if (t.tipo === 'knockout') avisos.push('⚡ "Somente KO": a premiação final é ZERO — todo o dinheiro vira bounty. Para KO fixo (ex.: R$ 25 por KO) use "💰 Bounty Fixo".');
        if (t.tipo === 'bounty' && t.entries.some(e => e.tipo === 'rebuy_simples' || e.tipo === 'rebuy_duplo')) avisos.push('Rebuy em Bounty Fixo tira mais ' + fm(v) + ' da premiação por rebuy sem aumentar o bounty da cabeça.');
        if (perdidos) avisos.push(perdidos + ' eliminação(ões) sem eliminador: esse bounty não foi pago a ninguém.');
        if (fim) avisos.push('🏆 Fim: o campeão ' + esc(nomeDe(ativos[0])) + ' recebe o próprio bounty (' + fm(cabeca(t, ativos[0])) + ') — no torneio real o crédito é lançado sozinho na conta dele.');
        const voltou = (e) => !t.eliminados.some(x => x.ts === e.ts);
        const elimLista = kos.map((e, i) => '<div style="display:flex;justify-content:space-between;gap:8px;font-size:12.5px;padding:5px 0;border-bottom:1px solid #1f1f25"><span>' + e.posicao + 'º · ' + esc(nomeDe(e.jogadorId)) + ' <span style="color:#71717a">por ' + (e.eliminadorId ? esc(nomeDe(e.eliminadorId)) : 'ninguém') + (voltou(e) ? ' <span style="font-size:10px;background:#1e3a2a;color:#86efac;border-radius:999px;padding:1px 6px">VOLTOU (re-entry)</span>' : '') + '</span></span><span style="display:flex;gap:8px;align-items:center"><b style="color:#fcd34d">' + (e.eliminadorId ? '+' + fm(noBolso(e)) : '—') + '</b><button data-sim-unelim="' + i + '" style="background:none;border:0;color:#fca5a5;cursor:pointer" title="Desfazer">✕</button></span></div>').join('');
        if (fim && cabeca(t, ativos[0]) > 0) { const g = ganhos[ativos[0]] || (ganhos[ativos[0]] = { n: 0, v: 0 }); g.camp = cabeca(t, ativos[0]); g.v += g.camp; }
        const ganhosLista = Object.keys(ganhos).sort((a, b) => ganhos[b].v - ganhos[a].v).map(id => row(esc(nomeDe(id)) + ' · ' + ganhos[id].n + ' KO' + (ganhos[id].camp ? ' + próprio (campeão)' : ''), fm(ganhos[id].v), '#fcd34d')).join('');
        return '<div style="background:#14141a;border:1px solid #b45309;border-radius:12px;padding:16px;min-width:0">' +
            '<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#fcd34d;margin-bottom:10px">🎯 KO — eliminações e bounties</div>' +
            avisos.map(a => '<div style="background:#2a1e04;border:1px solid #92400e;color:#fde68a;border-radius:8px;padding:8px 10px;font-size:12.5px;margin-bottom:8px;line-height:1.4">' + a + '</div>').join('') +
            '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;align-items:end">' +
                '<label style="font-size:11px;color:#a1a1aa">Eliminado<select id="sim-ko-elim" style="width:100%;margin-top:4px;background:#0f0f14;border:1px solid #3f3f46;color:#e4e4e7;border-radius:8px;padding:8px">' + opt(ativos) + '</select></label>' +
                '<label style="font-size:11px;color:#a1a1aa">Quem eliminou<select id="sim-ko-por" style="width:100%;margin-top:4px;background:#0f0f14;border:1px solid #3f3f46;color:#e4e4e7;border-radius:8px;padding:8px">' + opt(ativos, '— ninguém (desistiu) —') + '</select></label>' +
                '<button id="sim-ko-btn" style="padding:9px;border-radius:8px;border:0;background:#b91c1c;color:#fff;font-weight:700;cursor:pointer"' + (ativos.length < 2 ? ' disabled' : '') + '>💀 Eliminar</button>' +
            '</div>' +
            '<div style="font-size:11px;color:#71717a;margin:6px 0 10px">Depois de eliminar, "+ Re-entry" volta o último eliminado com bounty novo.</div>' +
            row('Bounty por KO', t.tipo === 'bounty' ? fm(v) : (t.tipo === 'pko' ? splitPko(t) + '% vai pro bolso' : '100% do líquido')) +
            (t.tipo === 'bounty' ? row('Separado da premiação (' + qtdComBounty + ' entradas × ' + fm(v) + ')', fm(reservado)) : '') +
            row('Já pago aos eliminadores', fm(pagos), '#fcd34d') +
            row(fim ? 'Bounty do campeão (crédito automático)' : 'Ainda na cabeça dos ativos (' + ativos.length + ')', fm(naMesa)) +
            (ganhosLista ? '<div style="font-size:11px;color:#a1a1aa;text-transform:uppercase;letter-spacing:.06em;margin:12px 0 4px">Quem ganhou KO (= fichas de KO a trocar no caixa)</div>' + ganhosLista : '') +
            (elimLista ? '<div style="font-size:11px;color:#a1a1aa;text-transform:uppercase;letter-spacing:.06em;margin:12px 0 4px">Eliminações</div><div style="max-height:220px;overflow:auto">' + elimLista + '</div>' : '') +
        '</div>';
    }

    // ---------- Monta a entry com a MESMA regra do lançamento real (sem passaporte) ----------
    function montarEntry(t, jid, tipo) {
        let valorBase = (typeof _getBuyinEfetivo === 'function') ? _getBuyinEfetivo(t) : (Number(t.buyin) || 0);
        if (tipo === 'reentry')       valorBase = (typeof _getReentryValor === 'function') ? _getReentryValor(t) : (Number(t.reentryValor || t.buyin) || 0);
        if (tipo === 'rebuy_simples') valorBase = Number(t.rebuyValor || t.rebuySimples) || 0;
        if (tipo === 'rebuy_duplo')   valorBase = Number(t.rebuyDuploValor || t.rebuyDuplo) || 0;
        if (tipo === 'buyin_duplo')   valorBase = Number(t.buyinDuploValor) || 0;
        if (tipo === 'addon')         valorBase = Number(t.addonValor) || 0;
        if (tipo === 'last_chance')   valorBase = Number(t.lastChanceValor || t.last_chance_valor) || 0;
        const valorPromo = (tipo !== 'buyin_duplo' && typeof _calcValorBuyinPromo === 'function') ? _calcValorBuyinPromo(t, tipo) : null;
        if (valorPromo !== null) valorBase = valorPromo;
        if (tipo === 'buyin' && valorBase === 0 && _staffFixoAtivo(t) && (t.staffFixoModo || 'embutido') === 'embutido' && t.staffFixoCobrarFree) valorBase = Number(t.staffFixoValor) || 0;
        if (tipo === 'buyin' && valorBase === 0 && _isStaffFixoAdicionalV2(t) && t.staffFixoCobrarFree) valorBase = Number(t.staffFixoValor) || 0;
        const taxaAdm = _taxaAdmAplica(t, tipo) ? Number(t.taxaAdm) : 0;
        const isV2 = _isStaffFixoAdicionalV2(t);
        const isLeg = _staffFixoAtivo(t) && (t.staffFixoModo || 'embutido') === 'adicional' && !isV2;
        let staff = 0;
        if ((isLeg || isV2) && _isTipoStaffFixoElegivel(t, tipo, valorBase)) staff = Number(t.staffFixoValor) || 0;
        let valorEntry = valorBase;
        if (isV2 && staff > 0) valorEntry = Math.max(0, valorBase - staff);
        const total = isV2 ? (valorBase + taxaAdm) : (valorBase + staff + taxaAdm);
        const e = { id: 'sim-' + Math.random().toString(36).slice(2), jogadorId: jid, tipo, ts: Date.now(), valor: valorEntry, staff, taxaAdm, comboId: 'sim' };
        const bonus = (typeof _calcBonusFichasParaEntry === 'function') ? _calcBonusFichasParaEntry(t, tipo) : 0;
        if (bonus > 0) e.bonusFichas = bonus;
        const fp = (typeof _calcFichasBuyinPromo === 'function') ? _calcFichasBuyinPromo(t, tipo) : null;
        if (fp !== null) { e.fichasOverride = fp; e.isPromo = true; }
        return { entry: e, total };
    }

    // Nível do relógio na simulação: 'pre' = antes de iniciar; número = índice em t.blinds
    function aplicarNivel(t, sel) {
        if (sel === 'pre' || sel == null) { t.iniciadoEm = null; t.nivelAtual = 0; return; }
        t.iniciadoEm = Date.now() - 1000;
        t.nivelAtual = Number(sel) || 0;
    }
    function rotuloNivel(t, sel) {
        if (sel === 'pre' || sel == null) return 'Antes de iniciar';
        const idx = Number(sel) || 0;
        const b = (t.blinds || [])[idx];
        let n = 0; for (let i = 0; i <= idx; i++) { if ((t.blinds || [])[i] && !t.blinds[i].isBreak) n++; }
        return (b && b.isBreak) ? ('Intervalo após nível ' + Math.max(1, n)) : ('Nível ' + n + (b && (b.sb || b.bb) ? ' (' + (b.sb || 0) + '/' + (b.bb || 0) + ')' : ''));
    }
    function fichasDaEntry(t, e) {
        if (Number(e.fichasOverride) > 0) return Number(e.fichasOverride);
        return (typeof _fichasStackPorTipo === 'function') ? _fichasStackPorTipo(t, e.tipo) : (Number(t.stack) || 0);
    }

    // ---------- Abrir / fechar ----------
    function abrir() {
        const t0 = (typeof activeTorneioIdx !== 'undefined' && activeTorneioIdx !== null) ? torneios[activeTorneioIdx] : null;
        if (!t0) return showToast('⚠️ Abra um torneio primeiro');
        const t = JSON.parse(JSON.stringify(t0));
        t.entries = []; t.eliminados = []; t.jackpotCompras = []; t.estornos = []; t.mesas = []; t.bounties = {};
        t.premiacaoProjetada = t0.premiacaoProjetada ? JSON.parse(JSON.stringify(t0.premiacaoProjetada)) : t.premiacaoProjetada;
        sim = { tid: t0.id, t, lanc: [], n: 0, nivel: 'pre' };
        aplicarNivel(t, 'pre');
        render();
    }
    function recarregarConfig() {
        // Depois de "Ajustar configuração": pega a config nova do torneio real e refaz os lançamentos
        if (!sim) return;
        const t0 = (torneios || []).find(x => x.id === sim.tid);
        if (!t0) return;
        const antigos = sim.lanc.map(l => ({ jid: l.entry.jogadorId, tipo: l.entry.tipo, nome: l.nome, combo: l.combo || null, nivel: l.nivel }));
        const t = JSON.parse(JSON.stringify(t0));
        t.entries = []; t.eliminados = []; t.jackpotCompras = []; t.estornos = []; t.mesas = []; t.bounties = {};
        sim.t = t; sim.lanc = []; sim.kos = [];
        const feitos = new Set();
        const nivelAtualSel = sim.nivel;
        antigos.forEach(a => {
            sim.nivel = a.nivel; aplicarNivel(sim.t, a.nivel);
            if (!a.combo) return lancar(a.tipo, a.jid, a.nome, true);
            if (feitos.has(a.combo)) return;
            feitos.add(a.combo);
            lancarComboPara(antigos.filter(x => x.combo === a.combo).map(x => x.tipo), a.jid, a.nome);
        });
        sim.nivel = nivelAtualSel; aplicarNivel(sim.t, nivelAtualSel);
        render();
    }
    function fechar() {
        sim = null;
        const m = document.getElementById('sim-torneio-modal');
        if (m) m.remove();
    }

    function lancar(tipo, jid, nome, silencioso) {
        if (!sim) return;
        if (!jid) {
            // Buy-in / duplo = jogador novo; demais = último jogador lançado (ou novo se não houver)
            const ultimo = sim.lanc.length ? sim.lanc[sim.lanc.length - 1] : null;
            const elimRecente = (tipo === 'reentry' && (sim.t.eliminados || []).length) ? sim.t.eliminados[sim.t.eliminados.length - 1] : null;
            if (elimRecente) { jid = elimRecente.jogadorId; nome = nomeDe(jid); }
            else if (tipo === 'buyin' || tipo === 'buyin_duplo' || !ultimo) { sim.n++; jid = 'sim-j' + sim.n; nome = nomeFake(sim.n); }
            else { jid = ultimo.entry.jogadorId; nome = ultimo.nome; }
        }
        // Re-entry reativa o jogador eliminado (igual ao real): sai da lista de eliminados
        if (tipo === 'reentry') sim.t.eliminados = (sim.t.eliminados || []).filter(e => e.jogadorId !== jid);
        const r = montarEntry(sim.t, jid, tipo);
        sim.t.entries.push(r.entry);
        sim.lanc.push({ entry: r.entry, nome, total: r.total, nivel: sim.nivel });
        if (!silencioso) render();
    }
    // COMBO: várias ações do mesmo jogador num lançamento só (igual ao combo real:
    // mesma ordem buy-in → duplo → rebuys → add-on, mesmo comboId, comprovante consolidado)
    const ORDEM_COMBO = ['buyin', 'buyin_duplo', 'rebuy_simples', 'rebuy_duplo', 'addon', 'last_chance'];
    function lancarComboPara(tipos, jid, nome) {
        const key = 'combo-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        ORDEM_COMBO.filter(tp => tipos.includes(tp)).forEach((tp, i) => {
            const r = montarEntry(sim.t, jid, tp);
            r.entry.comboId = key;
            r.entry.ts = Date.now() + i;
            sim.t.entries.push(r.entry);
            sim.lanc.push({ entry: r.entry, nome, total: r.total, combo: key, nivel: sim.nivel });
        });
    }
    function lancarCombo() {
        if (!sim) return;
        const tipos = [...document.querySelectorAll('[data-sim-combo]:checked')].map(c => c.dataset.simCombo);
        if (tipos.length < 2) return showToast('⚠️ Marque pelo menos 2 ações para o combo');
        sim.n++;
        lancarComboPara(tipos, 'sim-j' + sim.n, nomeFake(sim.n));
        sim.comboSel = tipos;
        render();
    }
    function gerarVarios() {
        const q = Math.max(1, Math.min(300, parseInt((document.getElementById('sim-qtd') || {}).value, 10) || 0));
        const tipo = (document.getElementById('sim-qtd-tipo') || {}).value || 'buyin';
        for (let i = 0; i < q; i++) lancar(tipo, null, null, true);
        render();
    }
    function remover(i) {
        if (!sim) return;
        const l = sim.lanc[i];
        if (!l) return;
        // Combo sai inteiro
        const ids = new Set(l.combo ? sim.lanc.filter(x => x.combo === l.combo).map(x => x.entry.id) : [l.entry.id]);
        sim.lanc = sim.lanc.filter(x => !ids.has(x.entry.id));
        sim.t.entries = sim.t.entries.filter(e => !ids.has(e.id));
        const comEntry = new Set(sim.t.entries.filter(e => e.tipo !== 'addon').map(e => e.jogadorId));
        const okK = (e) => comEntry.has(e.jogadorId) && (!e.eliminadorId || comEntry.has(e.eliminadorId));
        sim.t.eliminados = (sim.t.eliminados || []).filter(okK);
        sim.kos = (sim.kos || []).filter(okK);
        render();
    }
    function limpar() { if (!sim) return; sim.lanc = []; sim.t.entries = []; sim.t.eliminados = []; sim.t.bounties = {}; sim.kos = []; sim.n = 0; render(); }

    function verComprovante(i) {
        if (!sim) return;
        const l = sim.lanc[i];
        if (!l || typeof gerarComprovanteCompra !== 'function') return;
        let txt = '';
        try {
            if (l.combo && typeof gerarComprovanteCombo === 'function') {
                const ents = sim.lanc.filter(x => x.combo === l.combo).map(x => x.entry);
                txt = ents.length > 1 ? gerarComprovanteCombo(sim.t, { entries: ents, jogadorNome: l.nome })
                                      : gerarComprovanteCompra(sim.t, { entry: l.entry, jogadorNome: l.nome });
            } else {
                txt = gerarComprovanteCompra(sim.t, { entry: l.entry, jogadorNome: l.nome });
            }
        } catch (e) { txt = '(não foi possível gerar o comprovante: ' + e.message + ')'; }
        const marca = '*** SIMULAÇÃO — SEM VALOR ***';
        mostrarTexto('Comprovante (simulação)', marca + '\n\n' + txt + '\n\n' + marca);
    }
    function mostrarTexto(titulo, txt) {
        let ov = document.getElementById('sim-comp-ov');
        if (ov) ov.remove();
        ov = document.createElement('div');
        ov.id = 'sim-comp-ov';
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:100001;display:flex;align-items:center;justify-content:center;padding:16px;';
        ov.innerHTML = '<div style="background:#18181b;border:1px solid #3f3f46;border-radius:12px;max-width:420px;width:100%;max-height:90vh;display:flex;flex-direction:column;">' +
            '<div style="padding:12px 16px;border-bottom:1px solid #27272a;display:flex;justify-content:space-between;align-items:center;font-weight:800;color:#fcd34d;">' + esc(titulo) +
            '<button id="sim-comp-x" style="background:none;border:0;color:#a1a1aa;font-size:18px;cursor:pointer">✕</button></div>' +
            '<pre style="margin:0;padding:16px;overflow:auto;background:#fff;color:#111;font:12px/1.35 \'Courier New\',monospace;white-space:pre-wrap;">' + esc(txt) + '</pre>' +
            '<div style="padding:10px 16px;font-size:12px;color:#a1a1aa;border-top:1px solid #27272a">🖨️ Impressão desativada na simulação — só visualização.</div></div>';
        document.body.appendChild(ov);
        ov.addEventListener('click', (e) => { if (e.target === ov || e.target.id === 'sim-comp-x') ov.remove(); });
    }

    // ---------- Tela ----------
    function render() {
        if (!sim) return;
        const t = sim.t;
        let m = document.getElementById('sim-torneio-modal');
        if (!m) {
            m = document.createElement('div');
            m.id = 'sim-torneio-modal';
            m.style.cssText = 'position:fixed;inset:0;background:rgba(9,9,11,.96);z-index:100000;overflow:auto;padding:16px;';
            document.body.appendChild(m);
        }
        let rake = 0, prize = 0, cascata = 0, fixo = 0;
        try { rake = getRake(t); } catch (_) {}
        try { prize = getPrize(t); } catch (_) {}
        try { cascata = getStaffCascata(t); } catch (_) {}
        try { fixo = getStaffFixo(t); } catch (_) {}
        const taxaAdm = t.entries.reduce((s, e) => s + (Number(e.taxaAdm) || 0), 0);
        const arrecadado = sim.lanc.reduce((s, l) => s + (Number(l.total) || 0), 0);
        const jogadoresUnicos = new Set(t.entries.filter(e => e.tipo !== 'addon').map(e => e.jogadorId)).size;
        let chip = t.entries.reduce((s, e) => s + fichasDaEntry(t, e), 0);
        try { chip += (typeof _getFichasExtrasBonus === 'function') ? _getFichasExtrasBonus(t) : 0; } catch (_) {}
        const media = jogadoresUnicos ? Math.round(chip / jogadoresUnicos) : 0;
        const fmtN = (n) => Number(n || 0).toLocaleString('pt-BR');

        const linhas = sim.lanc.map((l, i) => {
            const lbl = (typeof _labelTipoEntry === 'function') ? _labelTipoEntry(l.entry.tipo) : l.entry.tipo;
            return '<div style="display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid #222;font-size:13px">' +
                '<span>' + esc(l.nome) + ' · ' + esc(lbl) + (l.entry.isPromo ? ' PROMO' : '') + (l.combo ? ' <span style="font-size:10px;background:#3b2a05;color:#fcd34d;border-radius:999px;padding:1px 6px">COMBO</span>' : '') + '<br><span style="font-size:11px;color:#71717a">' + esc(rotuloNivel(t, l.nivel)) + '</span></span>' +
                '<span style="font-variant-numeric:tabular-nums;color:#d4d4d8">' + fm(l.total) + ' · ' + fmtN(fichasDaEntry(t, l.entry)) + ' fichas</span>' +
                '<button data-sim-comp="' + i + '" style="background:#27272a;border:1px solid #3f3f46;color:#e4e4e7;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px">🧾</button>' +
                '<button data-sim-rm="' + i + '" style="background:none;border:0;color:#fca5a5;cursor:pointer;font-size:14px" title="Remover">✕</button></div>';
        }).join('') || '<div style="color:#71717a;font-size:13px;padding:10px 0">Nenhum lançamento ainda. Use os botões acima.</div>';

        const btnTipo = TIPOS.map(([k, l]) => '<button data-sim-lanc="' + k + '" style="padding:10px;border-radius:8px;border:0;background:#a16207;color:#fff;font-weight:700;cursor:pointer;font-size:13px">+ ' + l + '</button>').join('');
        const row = (k, v, cor) => '<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #222;font-size:13px;font-variant-numeric:tabular-nums"><span style="color:#a1a1aa">' + k + '</span><b style="color:' + (cor || '#e4e4e7') + '">' + v + '</b></div>';
        const stat = (k, v) => '<div style="background:#0f0f14;border:1px solid #27272a;border-radius:8px;padding:10px"><div style="font-size:11px;color:#a1a1aa;text-transform:uppercase">' + k + '</div><b style="font-size:20px">' + v + '</b></div>';

        m.innerHTML = '<div style="max-width:1100px;margin:0 auto;display:grid;gap:14px;font-family:inherit;color:#e4e4e7">' +
            '<div style="background:repeating-linear-gradient(45deg,#3b2a05,#3b2a05 12px,#2a1e04 12px,#2a1e04 24px);border:1px solid #b45309;color:#fde68a;border-radius:10px;padding:12px 14px;font-weight:800;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">' +
                '<span>🧪 SIMULAÇÃO — nada aqui é salvo, não entra no caixa, extrato, ranking nem na TV</span><span style="font-size:12px;background:#78350f;padding:3px 10px;border-radius:999px">' + esc(t.nome || '') + '</span></div>' +
            '<div style="background:#2a1215;border:1px solid #b91c1c;color:#fecaca;border-radius:10px;padding:12px 16px;font-size:14px;font-weight:700;line-height:1.45">' + ALERTA + '</div>' +
            '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px">' +
                '<div style="background:#14141a;border:1px solid #27272a;border-radius:12px;padding:16px;min-width:0">' +
                    '<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#a1a1aa;margin-bottom:10px">Lançar jogadores fictícios</div>' +
                    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;padding:8px 10px;background:#0f0f14;border:1px solid #3f3f46;border-radius:8px">' +
                        '<span style="font-size:12px;color:#a1a1aa">⏱️ Lançar como se o relógio estivesse em:</span>' +
                        '<select id="sim-nivel" style="flex:1;min-width:180px;background:#18181b;border:1px solid #52525b;color:#e4e4e7;border-radius:6px;padding:6px">' +
                            ['pre'].concat((t.blinds || []).map((_, i) => String(i))).map(v => '<option value="' + v + '"' + (String(sim.nivel) === v ? ' selected' : '') + '>' + esc(rotuloNivel(t, v)) + '</option>').join('') +
                        '</select>' +
                        '<span style="font-size:11px;color:#71717a;width:100%">Mostra como fica o buy-in free, promo, taxa e bônus de fichas em cada nível. Os lançamentos já feitos mantêm o nível em que foram lançados.</span>' +
                    '</div>' +
                    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">' + btnTipo + '</div>' +
                    '<div style="font-size:11px;color:#71717a;margin-top:6px">Buy-in cria jogador novo; rebuy, add-on e last chance vão para o último jogador lançado. Re-entry é a volta de um jogador eliminado (no torneio real só aparece depois de eliminar) — usa o valor de re-entry configurado, ou o do buy-in se não houver.</div>' +
                    '<div style="margin-top:10px;padding:10px;border:1px solid #3f3f46;border-radius:8px;background:#0f0f14">' +
                        '<div style="font-size:11px;color:#fcd34d;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Combo (mesmo jogador, um comprovante só)</div>' +
                        '<div style="display:flex;flex-wrap:wrap;gap:10px;font-size:13px">' +
                            ORDEM_COMBO.map(k => '<label style="display:flex;gap:4px;align-items:center;cursor:pointer"><input type="checkbox" data-sim-combo="' + k + '"' + ((sim.comboSel || ['buyin', 'rebuy_duplo']).includes(k) ? ' checked' : '') + ' style="accent-color:#f5d572">' + ((TIPOS.find(x => x[0] === k) || [k, k])[1]) + '</label>').join('') +
                        '</div>' +
                        '<button id="sim-combo" style="margin-top:8px;width:100%;padding:9px;border-radius:8px;border:0;background:#a16207;color:#fff;font-weight:700;cursor:pointer">+ Lançar combo</button>' +
                    '</div>' +
                    '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><input id="sim-qtd" type="number" min="1" max="300" value="20" style="width:80px;background:#0f0f14;border:1px solid #3f3f46;color:#e4e4e7;border-radius:8px;padding:8px">' +
                    '<select id="sim-qtd-tipo" style="background:#0f0f14;border:1px solid #3f3f46;color:#e4e4e7;border-radius:8px;padding:8px">' + TIPOS.map(([k, l]) => '<option value="' + k + '">' + l + '</option>').join('') + '</select>' +
                    '<button id="sim-gerar" style="flex:1;padding:8px;border-radius:8px;border:1px solid #3f3f46;background:#18181b;color:#e4e4e7;cursor:pointer">⚡ Gerar em lote</button></div>' +
                    '<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#a1a1aa;margin:16px 0 6px">Lançamentos simulados (' + sim.lanc.length + ')</div>' +
                    '<div style="max-height:340px;overflow:auto">' + linhas + '</div></div>' +
                '<div style="background:#14141a;border:1px solid #27272a;border-radius:12px;padding:16px;min-width:0">' +
                    '<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#a1a1aa;margin-bottom:10px">Resultado (mesmos cálculos do sistema)</div>' +
                    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px">' + stat('Entradas', t.entries.filter(e => e.tipo !== 'addon').length) + stat('Jogadores', jogadoresUnicos) + stat('Chipcount', fmtN(chip)) + stat('Média', fmtN(media)) + '</div>' +
                    row('Arrecadado (cobrado dos jogadores)', fm(arrecadado)) +
                    row('Rake (' + (Number(t.rake) || 0) + '%)', fm(rake)) +
                    row('Staff cascata', fm(cascata)) + row('Staff fixo', fm(fixo)) +
                    row('Taxa adm.', fm(taxaAdm)) +
                    row('Prize pool', fm(prize), '#86efac') +
                    '<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#a1a1aa;margin:14px 0 6px">Premiação</div><div id="sim-payout"></div>' +
                '</div></div>' +
            blocoKO(t) +
            '<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;background:#14141a;border:1px solid #27272a;border-radius:12px;padding:12px">' +
                '<button id="sim-limpar" style="padding:10px 14px;border-radius:8px;border:1px solid #7f1d1d;background:#18181b;color:#fca5a5;cursor:pointer">🗑️ Limpar simulação</button>' +
                '<button id="sim-ajustar" style="padding:10px 14px;border-radius:8px;border:1px solid #3f3f46;background:#18181b;color:#e4e4e7;cursor:pointer">✏️ Ajustar configuração</button>' +
                '<button id="sim-fechar" style="padding:10px 14px;border-radius:8px;border:0;background:#15803d;color:#fff;font-weight:700;cursor:pointer">Fechar simulação</button></div>' +
            '</div>';

        try { if (typeof renderPayout === 'function') renderPayout(t, 'sim-payout', true); } catch (_) {}
        const selNv = document.getElementById('sim-nivel');
        if (selNv) selNv.onchange = () => { sim.nivel = selNv.value; aplicarNivel(sim.t, sim.nivel); render(); };

        m.onclick = (ev) => {
            const b = ev.target.closest('button');
            if (!b) return;
            if (b.dataset.simLanc) return lancar(b.dataset.simLanc);
            if (b.dataset.simComp != null) return verComprovante(Number(b.dataset.simComp));
            if (b.dataset.simRm != null) return remover(Number(b.dataset.simRm));
            if (b.id === 'sim-gerar') return gerarVarios();
            if (b.id === 'sim-combo') return lancarCombo();
            if (b.id === 'sim-ko-btn') return eliminarSim();
            if (b.dataset.simUnelim != null) return desfazerElimSim(Number(b.dataset.simUnelim));
            if (b.id === 'sim-limpar') return limpar();
            if (b.id === 'sim-fechar') return fechar();
            if (b.id === 'sim-ajustar') {
                const idx = (torneios || []).findIndex(x => x.id === sim.tid);
                m.style.display = 'none';
                try { abrirEditarTorneio(idx); } catch (_) {}
                // Quando o Editar fechar, volta pra simulação com a config nova
                const iv = setInterval(() => {
                    // O Editar é position:fixed (offsetParent sempre null) — basta ver se ainda existe
                    if (document.getElementById('modal-editar-torneio')) return;
                    clearInterval(iv);
                    if (!sim) return;
                    m.style.display = '';
                    recarregarConfig();
                }, 600);
            }
        };
    }

    // ---------- Botão no modal do torneio ----------
    function garantirBotao() {
        const t = (typeof activeTorneioIdx !== 'undefined' && activeTorneioIdx !== null && Array.isArray(window.torneios || torneios)) ? torneios[activeTorneioIdx] : null;
        const btnEdit = document.querySelector('button[onclick="abrirEditarTorneio(activeTorneioIdx)"]');
        let b = document.getElementById('btn-simular-torneio');
        const mostrar = !!(ativo() && t && btnEdit && !t.iniciadoEm && !['finished', 'encerrado'].includes(String(t.status || '')));
        if (!mostrar) { if (b) b.style.display = 'none'; return; }
        if (!b) {
            b = document.createElement('button');
            b.id = 'btn-simular-torneio';
            b.className = 'btn-ghost';
            b.type = 'button';
            b.title = 'Testar a configuração com jogadores fictícios (nada é salvo)';
            b.style.cssText = 'font-size:.8rem;color:#fcd34d;border-color:rgba(245,158,11,.45);margin-left:.4rem;';
            b.innerHTML = '🧪 Simular torneio';
            b.addEventListener('click', abrir);
            btnEdit.insertAdjacentElement('afterend', b);
        }
        b.style.display = '';
    }

    // ---------- Opção nas Configurações → Torneios (só admin) ----------
    function garantirOpcao() {
        const aba = document.getElementById('cfg-trn-recursos') || document.getElementById('cfg-torneios');
        if (!aba || !ehAdmin() || document.getElementById('cfg-sim-torneio-card')) return;
        const card = document.createElement('div');
        card.id = 'cfg-sim-torneio-card';
        card.style.cssText = 'margin-bottom:1rem;padding:1rem;background:#14141a;border:1px solid #27272a;border-radius:.6rem;';
        card.innerHTML = '<label style="display:flex;gap:.6rem;align-items:flex-start;cursor:pointer">' +
            '<input type="checkbox" id="cfg-sim-torneio" style="width:18px;height:18px;margin-top:2px;accent-color:#f5d572">' +
            '<span><b>🧪 Simulador de torneio</b><br><span style="font-size:.78rem;color:#a1a1aa">Mostra o botão "Simular torneio" antes de iniciar. Testa a configuração com jogadores fictícios (rake, staff, prize, fichas, premiação e comprovantes) sem salvar nada.</span></span></label>';
        aba.insertBefore(card, aba.firstChild);
        const cb = card.querySelector('#cfg-sim-torneio');
        cb.checked = ativo();
        cb.addEventListener('change', async () => {
            if (!window.sbClube) return;
            const novo = Object.assign({}, sbClube.config || {}, { [FLAG]: cb.checked });
            try {
                const { error } = await sb.from('clubes').update({ config: novo }).eq('id', sbClube.id);
                if (error) throw error;
                sbClube.config = novo;
                showToast(cb.checked ? '🧪 Simulador de torneio ativado' : 'Simulador de torneio desativado');
            } catch (e) {
                cb.checked = !cb.checked;
                showToast('⚠️ Não foi possível salvar: ' + (e.message || e));
            }
        });
    }

    // ---------- Opção: aviso de eliminação na TV (padrão desligado) ----------
    function garantirOpcaoTvElim() {
        const aba = document.getElementById('cfg-trn-recursos') || document.getElementById('cfg-torneios');
        if (!aba || !ehAdmin() || document.getElementById('cfg-tv-elim-card')) return;
        const card = document.createElement('div');
        card.id = 'cfg-tv-elim-card';
        card.style.cssText = 'margin-bottom:1rem;padding:1rem;background:#14141a;border:1px solid #27272a;border-radius:.6rem;';
        card.innerHTML = '<label style="display:flex;gap:.6rem;align-items:flex-start;cursor:pointer">' +
            '<input type="checkbox" id="cfg-tv-elim" style="width:18px;height:18px;margin-top:2px;accent-color:#f5d572">' +
            '<span><b>📺 Aviso de eliminação na TV</b><br><span style="font-size:.78rem;color:#a1a1aa">Quando um jogador é eliminado, a TV (interna e pública) mostra por 5 segundos "❌ NOME · ELIMINADO EM Xº". No fim, mostra o campeão. Não cobre relógio, blinds nem os dados da tela.</span></span></label>';
        const ref = document.getElementById('cfg-sim-torneio-card');
        if (ref && ref.parentNode === aba) ref.insertAdjacentElement('afterend', card); else aba.insertBefore(card, aba.firstChild);
        const cb = card.querySelector('#cfg-tv-elim');
        cb.checked = !!(window.sbClube && sbClube.config && sbClube.config.tv_aviso_eliminacao);
        cb.addEventListener('change', async () => {
            if (!window.sbClube) return;
            const novo = Object.assign({}, sbClube.config || {}, { tv_aviso_eliminacao: cb.checked });
            try {
                const { error } = await sb.from('clubes').update({ config: novo }).eq('id', sbClube.id);
                if (error) throw error;
                sbClube.config = novo;
                showToast(cb.checked ? '📺 Aviso de eliminação na TV ativado' : 'Aviso de eliminação na TV desativado');
            } catch (e) { cb.checked = !cb.checked; showToast('⚠️ Não foi possível salvar: ' + (e.message || e)); }
        });
    }

    // Faixa "EM PAUSA" na TV: já existia e continua ligada por padrão. O clube pode desligar
    // (ex.: pausa para descontar minutos por mão na mesa final). Guardado como tv_ocultar_pausa.
    function garantirOpcaoTvPausa() {
        const aba = document.getElementById('cfg-trn-recursos') || document.getElementById('cfg-torneios');
        if (!aba || !ehAdmin() || document.getElementById('cfg-tv-pausa-card')) return;
        const card = document.createElement('div');
        card.id = 'cfg-tv-pausa-card';
        card.style.cssText = 'margin-bottom:1rem;padding:1rem;background:#14141a;border:1px solid #27272a;border-radius:.6rem;';
        card.innerHTML = '<label style="display:flex;gap:.6rem;align-items:flex-start;cursor:pointer">' +
            '<input type="checkbox" id="cfg-tv-pausa" style="width:18px;height:18px;margin-top:2px;accent-color:#f5d572">' +
            '<span><b>⏸️ Faixa "EM PAUSA" na TV</b><br><span style="font-size:.78rem;color:#a1a1aa">Quando o relógio é pausado, a TV (interna e pública) mostra a faixa "EM PAUSA". Desligue se o clube pausa para descontar minutos por mão (ex.: mesa final) e não quer a faixa na tela. O relógio continua parado igual.</span></span></label>';
        const ref = document.getElementById('cfg-tv-elim-card');
        if (ref && ref.parentNode === aba) ref.insertAdjacentElement('afterend', card); else aba.appendChild(card);
        const cb = card.querySelector('#cfg-tv-pausa');
        cb.checked = !(window.sbClube && sbClube.config && sbClube.config.tv_ocultar_pausa);
        cb.addEventListener('change', async () => {
            if (!window.sbClube) return;
            const novo = Object.assign({}, sbClube.config || {}, { tv_ocultar_pausa: !cb.checked });
            try {
                const { error } = await sb.from('clubes').update({ config: novo }).eq('id', sbClube.id);
                if (error) throw error;
                sbClube.config = novo;
                showToast(cb.checked ? '⏸️ Faixa "EM PAUSA" na TV ligada' : 'Faixa "EM PAUSA" na TV desligada');
                try { if (typeof updateTV === 'function' && typeof activeTorneioIdx !== 'undefined' && activeTorneioIdx !== null) updateTV(activeTorneioIdx); } catch (_) {}
            } catch (e) { cb.checked = !cb.checked; showToast('⚠️ Não foi possível salvar: ' + (e.message || e)); }
        });
    }

    setInterval(() => { try { garantirBotao(); garantirOpcao(); garantirOpcaoTvElim(); garantirOpcaoTvPausa(); } catch (_) {} }, 1000);
    window.stackosSimuladorAbrir = abrir;
})();
