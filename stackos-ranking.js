// ============================================================
// RANKING — Importar planilha ("Encontrar nomes") + Ajuste manual
// ------------------------------------------------------------
// Só mexe nos dados do RANKING (saldo inicial e ajustes, guardados em
// rankings.pontos_config). Não toca em torneio, caixa, financeiro ou fichas.
// ============================================================
(function () {
    'use strict';

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    // Tira numeração do começo: "12 - Fulano", "1. Fulano", "3º Fulano"
    const limparNome = (s) => String(s || '').replace(/^\s*\d+\s*(º|°|ª)?\s*[-.)–:]?\s*/, '').trim();
    const toast = (m) => { try { showToast(m); } catch (_) {} };
    const ehAdmin = () => { try { return currentUser && (currentUser.role === 'admin' || currentUser.papel === 'admin' || window._isSuperAdmin); } catch (_) { return false; } };
    const getRk = (id) => (typeof rankings !== 'undefined' ? rankings : []).find(x => String(x.id) === String(id));

    async function salvarRanking(r) {
        try { localStorage.setItem('ps_rankings', JSON.stringify(rankings)); } catch (_) {}
        if (window.sbClube && typeof sb !== 'undefined') {
            const { error } = await sb.from('rankings').update(_rankingToDb(r)).eq('id', r.id);
            if (error) { toast('⚠️ Salvo localmente, mas falhou ao sincronizar: ' + error.message); return false; }
        }
        try { if (typeof renderRankingsList === 'function') renderRankingsList(); } catch (_) {}
        return true;
    }

    function modal(html, id) {
        let ov = document.getElementById(id);
        if (ov) ov.remove();
        ov = document.createElement('div');
        ov.id = id;
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(9,9,11,.9);z-index:100003;overflow:auto;padding:16px;';
        ov.innerHTML = '<div style="max-width:880px;margin:0 auto;background:#14141a;border:1px solid #27272a;border-radius:12px;padding:18px;color:#e4e4e7;font-family:inherit">' + html + '</div>';
        document.body.appendChild(ov);
        return ov;
    }
    const btn = (id, txt, estilo) => '<button id="' + id + '" style="padding:9px 14px;border-radius:8px;cursor:pointer;font-family:inherit;' + (estilo || 'border:1px solid #3f3f46;background:#18181b;color:#e4e4e7') + '">' + txt + '</button>';

    // ---------------- ENCONTRAR NOMES ----------------
    function encontrar(nomePlanilha) {
        const alvo = norm(limparNome(nomePlanilha));
        if (!alvo) return { status: 'no', jogadorId: '' };
        const lista = (typeof jogadores !== 'undefined' ? jogadores : []);
        const exatos = lista.filter(j => norm(j.nome) === alvo || (j.apelido && norm(j.apelido) === alvo));
        if (exatos.length === 1) return { status: 'ok', jogadorId: exatos[0].id };
        // Sugestão SÓ com casamento forte: precisa bater pelo menos 2 palavras "de nome"
        // (ignora junior, filho, da, de...) OU todas as palavras quando o nome tem 1 só.
        // Evita sugerir "Andy Silva Júnior" para "Almir Junior" só pelo "junior".
        const COMUNS = new Set(['junior', 'jr', 'filho', 'neto', 'sobrinho', 'da', 'de', 'do', 'das', 'dos', 'e']);
        const palavras = alvo.split(' ').filter(w => w.length >= 3 && !COMUNS.has(w));
        let melhor = null, melhorScore = 0, empate = false;
        lista.forEach(j => {
            const toks = norm(j.nome + ' ' + (j.apelido || '')).split(' ').filter(t => !COMUNS.has(t));
            let sc = 0;
            palavras.forEach(w => { if (toks.includes(w)) sc++; });
            const forte = palavras.length >= 2 ? sc >= 2 : (palavras.length === 1 && sc === 1 && toks.length <= 2);
            if (!forte) return;
            if (sc > melhorScore) { melhorScore = sc; melhor = j; empate = false; }
            else if (sc === melhorScore) empate = true;
        });
        if (exatos.length > 1) return { status: 'sg', jogadorId: exatos[0].id };
        if (melhor && !empate) return { status: 'sg', jogadorId: melhor.id };
        return { status: 'no', jogadorId: '' };
    }

    // ---------------- IMPORTAR ----------------
    let imp = null; // { rid, linhas:[[...]], colNome, colPts, itens:[{nome, pontos, status, jogadorId}], modo }

    function abrirImportar(rid) {
        const r = getRk(rid);
        if (!r) return;
        imp = { rid, linhas: [], colNome: 0, colPts: 1, itens: [], modo: 'substituir', corte: new Date().toISOString().slice(0, 10), so: false };
        renderImportar();
    }

    async function lerArquivo(file) {
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        let linhas = [];
        if (ext === 'csv' || ext === 'txt') {
            const txt = await file.text();
            linhas = txt.split(/\r?\n/).map(l => l.split(/[;,\t]/));
        } else {
            if (typeof XLSX === 'undefined' && typeof _carregarSheetJS === 'function') await _carregarSheetJS();
            const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
            const sh = wb.Sheets[wb.SheetNames[0]];
            linhas = XLSX.utils.sheet_to_json(sh, { header: 1, defval: '' });
        }
        definirLinhas(linhas);
    }
    function lerTexto(txt) {
        definirLinhas(String(txt || '').split(/\r?\n/).map(l => {
            // "Nome 150", "Nome;150", "1. Nome 150 PTS"
            const m = l.match(/^(.*?)[\s;,\t]+(-?\d+(?:[.,]\d+)?)\s*(pts|pontos)?\s*$/i);
            return m ? [m[1], m[2]] : [l];
        }));
    }
    function definirLinhas(linhas) {
        imp.linhas = (linhas || []).filter(r => Array.isArray(r) && r.some(c => String(c || '').trim() !== ''));
        // Detecta colunas: a de pontos = mais numérica; a de nome = mais texto
        const nCols = Math.max(1, ...imp.linhas.map(r => r.length));
        let colPts = 1, colNome = 0, bestNum = -1, bestTxt = -1;
        for (let c = 0; c < nCols; c++) {
            let num = 0, txt = 0;
            imp.linhas.forEach(r => { const v = String(r[c] == null ? '' : r[c]).trim(); if (!v) return; if (/^-?\d+([.,]\d+)?$/.test(v)) num++; else if (/[a-zA-ZÀ-ú]{2,}/.test(v)) txt++; });
            if (num > bestNum) { bestNum = num; colPts = c; }
            if (txt > bestTxt) { bestTxt = txt; colNome = c; }
        }
        imp.colNome = colNome; imp.colPts = colPts;
        montarItens();
    }
    function montarItens() {
        imp.itens = imp.linhas.map(r => {
            const nome = limparNome(r[imp.colNome]);
            const pts = Number(String(r[imp.colPts] == null ? '' : r[imp.colPts]).replace(',', '.'));
            if (!nome || !isFinite(pts) || /^(nome|jogador|pontos|colocacao|colocação)$/i.test(nome)) return null;
            const f = encontrar(nome);
            return { nome, pontos: pts, status: f.status, jogadorId: f.jogadorId };
        }).filter(Boolean);
        // Mesmo jogador em 2 linhas: soma
        renderImportar();
    }

    function renderImportar() {
        if (!imp) return;
        const r = getRk(imp.rid);
        const lista = (typeof jogadores !== 'undefined' ? jogadores : []).slice().sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
        const nCols = Math.max(0, ...imp.linhas.map(x => x.length));
        const cab = imp.linhas[0] || [];
        const optCol = (sel) => Array.from({ length: nCols }, (_, c) => '<option value="' + c + '"' + (c === sel ? ' selected' : '') + '>Coluna ' + (c + 1) + (cab[c] ? ' — ' + esc(String(cab[c]).slice(0, 20)) : '') + '</option>').join('');
        const ok = imp.itens.filter(i => i.jogadorId && i.status === 'ok').length;
        const sg = imp.itens.filter(i => i.jogadorId && i.status !== 'ok').length;
        const no = imp.itens.filter(i => !i.jogadorId).length;
        const opts = (jid) => '<option value="">— escolher jogador —</option><option value="__ignorar"' + (jid === '__ignorar' ? ' selected' : '') + '>Ignorar esta linha</option>' + lista.map(j => '<option value="' + j.id + '"' + (String(j.id) === String(jid) ? ' selected' : '') + '>' + esc(j.nome) + (j.apelido ? ' (' + esc(j.apelido) + ')' : '') + '</option>').join('');
        const linhasHtml = imp.itens.map((it, i) => {
            if (imp.so && it.jogadorId && it.status === 'ok') return '';
            const tag = it.jogadorId === '__ignorar' ? '<span style="color:#71717a">ignorada</span>' : (!it.jogadorId ? '<span style="color:#fca5a5">❌</span>' : (it.status === 'ok' ? '<span style="color:#86efac">✅</span>' : '<span style="color:#fcd34d">🟡</span>'));
            return '<tr><td style="padding:6px;border-bottom:1px solid #222">' + esc(it.nome) + '</td>' +
                '<td style="padding:6px;border-bottom:1px solid #222">' + tag + ' <select data-imp-sel="' + i + '" style="max-width:260px;background:#0f0f14;border:1px solid #3f3f46;color:#e4e4e7;border-radius:6px;padding:4px">' + opts(it.jogadorId) + '</select>' +
                (!it.jogadorId ? ' <button data-imp-novo="' + i + '" style="padding:3px 8px;border-radius:6px;border:1px solid #3f3f46;background:#18181b;color:#e4e4e7;cursor:pointer;font-size:12px">+ Cadastro rápido</button>' : '') + '</td>' +
                '<td style="padding:6px;border-bottom:1px solid #222;text-align:right;font-weight:800;color:#f5d572;font-variant-numeric:tabular-nums">' + it.pontos + '</td></tr>';
        }).join('');
        const validos = imp.itens.filter(i => i.jogadorId && i.jogadorId !== '__ignorar');
        const ov = modal(
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><div><div style="font-size:12px;color:#a1a1aa;text-transform:uppercase;letter-spacing:.08em">Rankings › ' + esc(r ? r.nome : '') + '</div><div style="font-weight:800;font-size:18px">📥 Importar planilha</div></div>' + btn('imp-x', '✕') + '</div>' +
            '<div style="margin-top:14px;padding:12px;border:1px solid #27272a;border-radius:10px"><div style="font-size:12px;color:#a1a1aa;text-transform:uppercase;margin-bottom:8px">1 · Arquivo</div>' +
                '<input type="file" id="imp-file" accept=".xlsx,.xls,.csv,.txt" style="color:#e4e4e7"> <span style="font-size:12px;color:#71717a">ou cole a lista (uma linha por jogador: "Nome 150"):</span>' +
                '<textarea id="imp-txt" rows="3" style="width:100%;margin-top:6px;background:#0f0f14;border:1px solid #3f3f46;color:#e4e4e7;border-radius:8px;padding:8px;box-sizing:border-box" placeholder="Anderson Bozin 150&#10;João Zanella 130"></textarea>' + btn('imp-colar', 'Ler lista colada') +
                (imp.linhas.length ? '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;font-size:13px"><label>Nome: <select id="imp-cn" style="background:#0f0f14;border:1px solid #3f3f46;color:#e4e4e7;border-radius:6px;padding:4px">' + optCol(imp.colNome) + '</select></label><label>Pontos: <select id="imp-cp" style="background:#0f0f14;border:1px solid #3f3f46;color:#e4e4e7;border-radius:6px;padding:4px">' + optCol(imp.colPts) + '</select></label><label>Pontos válidos até: <input id="imp-corte" type="date" value="' + imp.corte + '" style="background:#0f0f14;border:1px solid #3f3f46;color:#e4e4e7;border-radius:6px;padding:3px"></label></div>' : '') +
            '</div>' +
            (imp.itens.length ? (
            '<div style="margin-top:12px;padding:12px;border:1px solid #27272a;border-radius:10px"><div style="font-size:12px;color:#a1a1aa;text-transform:uppercase;margin-bottom:8px">2 · Encontrar nomes</div>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;font-size:13px;font-weight:700"><span style="background:rgba(34,197,94,.15);color:#86efac;padding:4px 10px;border-radius:8px">✅ ' + ok + ' encontrados</span><span style="background:rgba(245,158,11,.15);color:#fcd34d;padding:4px 10px;border-radius:8px">🟡 ' + sg + ' sugestões</span><span style="background:rgba(239,68,68,.15);color:#fca5a5;padding:4px 10px;border-radius:8px">❌ ' + no + ' não encontrados</span>' +
                '<label style="margin-left:auto;font-weight:400"><input type="checkbox" id="imp-so"' + (imp.so ? ' checked' : '') + '> só pendentes</label></div>' +
                '<div style="max-height:360px;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><tr style="color:#a1a1aa;font-size:11px;text-transform:uppercase"><th style="text-align:left;padding:6px">Na planilha</th><th style="text-align:left;padding:6px">Jogador no sistema</th><th style="text-align:right;padding:6px">Pontos</th></tr>' + linhasHtml + '</table></div></div>' +
            '<div style="margin-top:12px;padding:12px;border:1px solid #27272a;border-radius:10px"><div style="font-size:12px;color:#a1a1aa;text-transform:uppercase;margin-bottom:8px">3 · Confirmar</div>' +
                '<label style="display:block;font-size:13px;margin-bottom:4px"><input type="radio" name="imp-modo" value="substituir"' + (imp.modo === 'substituir' ? ' checked' : '') + '> <b>Substituir</b> os pontos iniciais pelos da planilha</label>' +
                '<label style="display:block;font-size:13px"><input type="radio" name="imp-modo" value="somar"' + (imp.modo === 'somar' ? ' checked' : '') + '> <b>Somar</b> aos pontos iniciais atuais (ex.: um torneio antigo que faltou)</label>' +
                '<div style="font-size:12px;color:#a1a1aa;margin-top:8px">Os torneios marcados para este ranking continuam somando automaticamente. Linhas sem jogador escolhido não entram.</div></div>' +
            '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">' + btn('imp-cancel', 'Cancelar') + btn('imp-ok', 'Importar ' + validos.length + ' jogador(es)', 'border:0;background:#f5d572;color:#111;font-weight:800') + '</div>'
            ) : ''), 'rk-import-ov');

        const $ = (q) => ov.querySelector(q);
        $('#imp-x').onclick = () => { imp = null; ov.remove(); };
        if ($('#imp-cancel')) $('#imp-cancel').onclick = () => { imp = null; ov.remove(); };
        $('#imp-file').onchange = (e) => { const f = e.target.files[0]; if (f) lerArquivo(f).catch(err => toast('⚠️ Não consegui ler o arquivo: ' + err.message)); };
        $('#imp-colar').onclick = () => lerTexto($('#imp-txt').value);
        if ($('#imp-cn')) $('#imp-cn').onchange = (e) => { imp.colNome = Number(e.target.value); montarItens(); };
        if ($('#imp-cp')) $('#imp-cp').onchange = (e) => { imp.colPts = Number(e.target.value); montarItens(); };
        if ($('#imp-corte')) $('#imp-corte').onchange = (e) => { imp.corte = e.target.value; };
        if ($('#imp-so')) $('#imp-so').onchange = (e) => { imp.so = e.target.checked; renderImportar(); };
        ov.querySelectorAll('input[name="imp-modo"]').forEach(rd => rd.onchange = () => { imp.modo = rd.value; });
        ov.querySelectorAll('[data-imp-sel]').forEach(sel => sel.onchange = () => { const it = imp.itens[Number(sel.dataset.impSel)]; it.jogadorId = sel.value; it.status = sel.value ? 'ok' : 'no'; renderImportar(); });
        ov.querySelectorAll('[data-imp-novo]').forEach(b => b.onclick = async () => {
            const it = imp.itens[Number(b.dataset.impNovo)];
            try {
                const novo = await db.jogadores.create({ nome: it.nome, apelido: '', whatsapp: '', cidade: '', uf: '' });
                try { logAudit && logAudit('JOGADOR_CRIA', 'Cadastro rápido (importação de ranking): ' + it.nome, { id: novo.id }); } catch (_) {}
                it.jogadorId = novo.id; it.status = 'ok';
                toast('✅ ' + it.nome + ' cadastrado');
                renderImportar();
            } catch (e) { toast('⚠️ Não foi possível cadastrar: ' + (e.message || e)); }
        });
        if ($('#imp-ok')) $('#imp-ok').onclick = async () => {
            const rk = getRk(imp.rid);
            if (!rk) return;
            const soma = {};
            imp.itens.forEach(i => { if (i.jogadorId && i.jogadorId !== '__ignorar') soma[i.jogadorId] = (soma[i.jogadorId] || 0) + (Number(i.pontos) || 0); });
            const ids = Object.keys(soma);
            if (!ids.length) return toast('⚠️ Nenhuma linha com jogador escolhido');
            let saldo = imp.modo === 'somar' ? (rk.saldoInicial || []).slice() : [];
            ids.forEach(jid => {
                const ex = saldo.find(s => String(s.jogadorId) === String(jid));
                if (ex) ex.pontos = (Number(ex.pontos) || 0) + soma[jid];
                else saldo.push({ jogadorId: jid, pontos: soma[jid] });
            });
            rk.saldoInicial = saldo;
            rk.importacoes = (rk.importacoes || []).concat([{ ts: Date.now(), operador: (currentUser && currentUser.nome) || '', modo: imp.modo, qtd: ids.length, corte: imp.corte }]);
            try { logAudit && logAudit('RANKING_IMPORTA', 'Ranking "' + rk.nome + '": importados ' + ids.length + ' jogadores (' + imp.modo + ')', { id: rk.id }); } catch (_) {}
            if (await salvarRanking(rk)) toast('✅ ' + ids.length + ' jogadores importados no ranking');
            imp = null; ov.remove();
        };
    }

    // ---------------- AJUSTE MANUAL ----------------
    function abrirAjuste(rid) {
        const r = getRk(rid);
        if (!r) return;
        let pont = [];
        try { pont = calcularPontuacoesRanking(r); } catch (_) {}
        const lista = (typeof jogadores !== 'undefined' ? jogadores : []).slice().sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
        const hist = (r.ajustes || []).slice().reverse().slice(0, 30).map(a => '<div style="font-size:12px;padding:5px 0;border-bottom:1px solid #222">' + new Date(a.ts).toLocaleString('pt-BR') + ' · <b>' + esc(getJogadorNome(a.jogadorId)) + '</b> ' + (a.pontos > 0 ? '+' : '') + a.pontos + ' pts · ' + esc(a.motivo) + (a.operador ? ' · ' + esc(a.operador) : '') + '</div>').join('') || '<div style="font-size:12px;color:#71717a">Nenhum ajuste ainda.</div>';
        const tabela = pont.slice(0, 80).map((p, i) => '<tr><td style="padding:5px">' + (i + 1) + '</td><td style="padding:5px">' + esc(p.nome) + '<div style="font-size:11px;color:#71717a">inicial ' + (p.inicial || 0) + ' + ' + (p.torneios || 0) + ' torneio(s) ' + (p.pontosTorneios || 0) + (p.ajuste ? ' · ajuste ' + (p.ajuste > 0 ? '+' : '') + p.ajuste : '') + '</div></td><td style="padding:5px;text-align:right;font-weight:800;color:#f5d572">' + p.pontos + '</td></tr>').join('');
        const ov = modal(
            '<div style="display:flex;justify-content:space-between;align-items:center"><div style="font-weight:800;font-size:18px">± Ajustar pontos · ' + esc(r.nome) + '</div>' + btn('aj-x', '✕') + '</div>' +
            '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;margin-top:12px">' +
                '<div><div style="font-size:12px;color:#a1a1aa;text-transform:uppercase;margin-bottom:6px">Novo ajuste</div>' +
                    '<select id="aj-j" style="width:100%;background:#0f0f14;border:1px solid #3f3f46;color:#e4e4e7;border-radius:8px;padding:8px"><option value="">— jogador —</option>' + lista.map(j => '<option value="' + j.id + '">' + esc(j.nome) + '</option>').join('') + '</select>' +
                    '<input id="aj-p" type="number" step="1" placeholder="Pontos (ex.: 10 ou -5)" style="width:100%;margin-top:8px;background:#0f0f14;border:1px solid #3f3f46;color:#e4e4e7;border-radius:8px;padding:8px;box-sizing:border-box">' +
                    '<input id="aj-m" type="text" placeholder="Motivo (obrigatório) — ex.: correção torneio 12/10" style="width:100%;margin-top:8px;background:#0f0f14;border:1px solid #3f3f46;color:#e4e4e7;border-radius:8px;padding:8px;box-sizing:border-box">' +
                    '<div style="margin-top:8px">' + btn('aj-ok', 'Lançar ajuste', 'border:0;background:#f5d572;color:#111;font-weight:800') + '</div>' +
                    '<div style="font-size:12px;color:#a1a1aa;text-transform:uppercase;margin:14px 0 6px">Histórico de ajustes</div>' + hist + '</div>' +
                '<div><div style="font-size:12px;color:#a1a1aa;text-transform:uppercase;margin-bottom:6px">Classificação atual</div><div style="max-height:420px;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">' + tabela + '</table></div></div>' +
            '</div>', 'rk-ajuste-ov');
        ov.querySelector('#aj-x').onclick = () => ov.remove();
        ov.querySelector('#aj-ok').onclick = async () => {
            const jid = ov.querySelector('#aj-j').value;
            const pts = parseInt(ov.querySelector('#aj-p').value, 10);
            const motivo = ov.querySelector('#aj-m').value.trim();
            if (!jid) return toast('⚠️ Escolha o jogador');
            if (!pts) return toast('⚠️ Informe os pontos (positivo ou negativo)');
            if (motivo.length < 3) return toast('⚠️ Informe o motivo do ajuste');
            r.ajustes = (r.ajustes || []).concat([{ id: (typeof _genUuid === 'function' ? _genUuid() : String(Date.now())), jogadorId: jid, pontos: pts, motivo, ts: Date.now(), operador: (currentUser && currentUser.nome) || '' }]);
            try { logAudit && logAudit('RANKING_AJUSTE', 'Ranking "' + r.nome + '": ' + getJogadorNome(jid) + ' ' + (pts > 0 ? '+' : '') + pts + ' pts — ' + motivo, { id: r.id }); } catch (_) {}
            if (await salvarRanking(r)) toast('✅ Ajuste lançado');
            abrirAjuste(rid);
        };
    }

    // ---------------- Botões nos cards do ranking ----------------
    function injetar() {
        if (!ehAdmin()) return;
        document.querySelectorAll('button[onclick^="editarRanking("]').forEach(b => {
            if (b.dataset.rkExtra) return;
            b.dataset.rkExtra = '1';
            const m = (b.getAttribute('onclick') || '').match(/editarRanking\('([^']+)'\)/);
            if (!m) return;
            const rid = m[1];
            const mk = (txt, title, fn) => { const x = document.createElement('button'); x.className = 'btn-ghost'; x.type = 'button'; x.title = title; x.style.cssText = 'padding:.35rem .65rem;font-size:.75rem;'; x.textContent = txt; x.onclick = () => fn(rid); return x; };
            b.insertAdjacentElement('beforebegin', mk('📥 Importar', 'Importar planilha de pontos', abrirImportar));
            b.insertAdjacentElement('beforebegin', mk('± Ajustar', 'Ajuste manual de pontos', abrirAjuste));
        });
    }
    setInterval(() => { try { injetar(); } catch (_) {} }, 1000);
    window.stackosRanking = { abrirImportar, abrirAjuste, _encontrar: encontrar };
})();
