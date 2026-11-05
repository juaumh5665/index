// ============================================================
// ASSINATURA POR PIX DIRETO (chave do StackOS) — sem boleto
// ------------------------------------------------------------
// Clube: escolhe plano/ciclo → QR Pix na tela (valor certo, identificador do clube)
//        → "Já paguei" (comprovante opcional). Se estava vencido, ganha 24h de acesso.
// Super admin: lista "Pagamentos Pix aguardando" → Confirmar (estende validade,
//        respeitando o dia fixo de vencimento) ou Recusar.
// O valor é calculado no banco (valor combinado do clube ou preço do plano).
// O fluxo do Asaas continua no código (window._abrirModalPagamentoAsaas), só não aparece.
// ============================================================
(function () {
    'use strict';

    const PIX = { chave: '06755503940', nome: 'JOAO HENRIQUE S ZANELLA', cidade: 'PATO BRANCO' };
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const money = (v) => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const toast = (m) => { try { showToast(m); } catch (_) { alert(m); } };

    // ---------- BR Code (Pix estático, padrão Banco Central) ----------
    const tlv = (id, v) => id + String(v.length).padStart(2, '0') + v;
    function crc16(s) {
        let c = 0xFFFF;
        for (let i = 0; i < s.length; i++) {
            c ^= s.charCodeAt(i) << 8;
            for (let b = 0; b < 8; b++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xFFFF : (c << 1) & 0xFFFF;
        }
        return c.toString(16).toUpperCase().padStart(4, '0');
    }
    function brCode(valor, txid) {
        const p = tlv('00', '01') + tlv('26', tlv('00', 'br.gov.bcb.pix') + tlv('01', PIX.chave)) +
            tlv('52', '0000') + tlv('53', '986') + tlv('54', Number(valor).toFixed(2)) + tlv('58', 'BR') +
            tlv('59', PIX.nome.slice(0, 25)) + tlv('60', PIX.cidade.slice(0, 15)) + tlv('62', tlv('05', txid)) + '6304';
        return p + crc16(p);
    }
    function txidClube() {
        const nome = String((window.sbClube && sbClube.nome) || 'CLUBE').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const d = new Date();
        return ('STACKOS' + nome.replace(/CLUB(E)?$/, '').slice(0, 12) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getFullYear()).slice(2)).slice(0, 25);
    }

    // Biblioteca do QR: servida pelo próprio StackOS (/qrcode-lib.js), sem depender de CDN
    let _libQR = null;
    function carregarLibQR() {
        if (window.QRCode && typeof window.QRCode.toCanvas === 'function') return Promise.resolve(true);
        if (_libQR) return _libQR;
        _libQR = new Promise(res => {
            const s = document.createElement('script');
            s.src = '/qrcode-lib.js?v=1';
            s.onload = () => res(!!(window.QRCode && window.QRCode.toCanvas));
            s.onerror = () => res(false);
            document.head.appendChild(s);
            setTimeout(() => res(!!(window.QRCode && window.QRCode.toCanvas)), 6000);
        });
        return _libQR;
    }

    // ---------- Tela do clube ----------
    let st = null;
    async function abrirPix() {
        const p = window._planoEscolhido || (typeof _planoEscolhido !== 'undefined' ? _planoEscolhido : null);
        if (!p) return;
        st = { plano: p, ciclo: 'mensal', valor: null, txid: txidClube(), arquivo: null, pendente: null };
        try {
            const { data } = await sb.from('pix_solicitacoes').select('*').eq('clube_id', sbClube.id).eq('status', 'aguardando').order('criado_em', { ascending: false }).limit(1);
            st.pendente = (data && data[0]) || null;
        } catch (_) {}
        render();
        await atualizarValor();
    }
    async function atualizarValor() {
        st.valor = null; render();
        try {
            const { data, error } = await sb.rpc('pix_valor', { p_plano: st.plano.id, p_ciclo: st.ciclo });
            if (error) throw error;
            st.valor = Number(data && data.valor);
            st.combinado = !!(data && data.combinado);
        } catch (e) { st.erro = 'Não foi possível calcular o valor: ' + (e.message || e); }
        render();
    }
    function fechar() { const ov = document.getElementById('modal-pagamento'); if (ov) ov.remove(); }
    function render() {
        fechar();
        const p = st.plano;
        const box = (txt) => `<div style="padding:.85rem;border-radius:.6rem;font-size:.85rem;line-height:1.5;${txt}"`;
        let corpo;
        if (st.pendente) {
            const s = st.pendente;
            corpo = box('background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.35);color:#fcd34d;') + `>⏳ <b>Pagamento enviado para confirmação.</b><br>Recebemos o aviso do seu Pix de ${money(s.valor)} (${esc(s.plano_id)} ${esc(s.ciclo)}). A liberação acontece assim que o pagamento for conferido.${s.liberacao_ate ? `<br>Seu acesso está liberado até <b>${new Date(s.liberacao_ate).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</b> enquanto aguarda.` : ''}</div>`;
        } else {
            const pronto = st.valor > 0;
            const code = pronto ? brCode(st.valor, st.txid) : '';
            corpo = `
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-bottom:1rem;">
                    ${['mensal', 'anual'].map(c => `<button type="button" data-ciclo="${c}" style="padding:.8rem;border-radius:.5rem;font-weight:800;cursor:pointer;font-family:inherit;${st.ciclo === c ? 'background:var(--gold);color:#0a0a0b;border:none;' : 'background:#18181b;color:#fafafa;border:1px solid #27272a;'}">${c === 'mensal' ? 'Mensal' : 'Anual'}${!st.combinado ? ' · ' + money(c === 'mensal' ? p.preco_mensal : p.preco_anual) : ''}${c === 'anual' ? '<div style="font-size:.7rem;color:' + (st.ciclo === c ? '#065f46' : '#10b981') + ';margin-top:.1rem;">Economize ~17%</div>' : ''}</button>`).join('')}
                </div>
                ${st.erro ? box('background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);color:#fca5a5;') + `>${esc(st.erro)}</div>` : ''}
                <div style="background:#fff;border-radius:.75rem;padding:.6rem;width:230px;max-width:100%;margin:0 auto .75rem;min-height:230px;display:flex;align-items:center;justify-content:center;">
                    ${pronto ? '<canvas id="pix-qr"></canvas>' : '<span style="color:#71717a;font-size:.8rem">Gerando QR…</span>'}
                </div>
                <div style="text-align:center;font-family:var(--font-mono);font-weight:800;font-size:1.6rem;color:var(--gold);">${pronto ? money(st.valor) : '—'}</div>
                <div style="text-align:center;color:#a1a1aa;font-size:.78rem;margin:.25rem 0 .85rem;">Pix para <b style="color:#e4e4e7">João Henrique S Zanella</b> · Pato Branco<br>Identificador: <b style="color:#e4e4e7">${esc(st.txid)}</b></div>
                <div style="display:flex;gap:.5rem;align-items:center;background:#18181b;border:1px solid #27272a;border-radius:.5rem;padding:.5rem;">
                    <code style="flex:1;min-width:0;font-family:var(--font-mono);font-size:.68rem;color:#d4d4d8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(code)}</code>
                    <button type="button" id="pix-copiar" ${pronto ? '' : 'disabled'} style="padding:.45rem .8rem;border-radius:.4rem;border:1px solid #3f3f46;background:#0d0d0f;color:#e4e4e7;font-weight:700;cursor:pointer;font-family:inherit;">Copiar</button>
                </div>
                <div style="margin:.85rem 0;font-size:.8rem;color:#a1a1aa;line-height:1.7;"><b style="color:#e4e4e7">1.</b> Abra o app do banco › Pix › Ler QR Code (ou "Pix copia e cola").<br><b style="color:#e4e4e7">2.</b> Confira o valor e o nome e confirme.<br><b style="color:#e4e4e7">3.</b> Volte aqui e toque em <b style="color:#e4e4e7">Já paguei</b>.</div>
                <label style="display:block;border:1px dashed #3f3f46;border-radius:.5rem;padding:.65rem;text-align:center;color:#a1a1aa;font-size:.8rem;cursor:pointer;margin-bottom:.75rem;">📎 <span id="pix-arq-nome">${st.arquivo ? esc(st.arquivo.name) : 'Anexar comprovante (opcional)'}</span><input type="file" id="pix-arq" accept="image/*,application/pdf" style="display:none"></label>
                <button type="button" id="pix-paguei" ${pronto ? '' : 'disabled'} style="width:100%;padding:.85rem;border-radius:.5rem;border:none;background:#22c55e;color:#04210f;font-weight:800;font-size:.95rem;cursor:pointer;font-family:inherit;">✅ Já paguei</button>`;
        }
        const ov = document.createElement('div');
        ov.id = 'modal-pagamento';
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:1rem;overflow-y:auto;';
        ov.innerHTML = `<div style="background:#0d0d0f;border:1px solid #27272a;border-radius:.75rem;max-width:460px;width:100%;padding:1.5rem;color:#fafafa;margin:auto 0;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1rem;">
                <div><div style="font-size:.7rem;color:#71717a;text-transform:uppercase;letter-spacing:.1em;">Assinar plano · Pix</div><div style="font-size:1.4rem;font-weight:800;margin-top:.2rem;">${esc(p.nome)}</div></div>
                <button type="button" id="pix-x" style="background:transparent;border:none;color:#71717a;font-size:1.5rem;cursor:pointer;padding:0;">&times;</button>
            </div>${corpo}</div>`;
        document.body.appendChild(ov);
        ov.querySelector('#pix-x').onclick = fechar;
        ov.querySelectorAll('[data-ciclo]').forEach(b => b.onclick = () => { st.ciclo = b.dataset.ciclo; atualizarValor(); });
        const cv = ov.querySelector('#pix-qr');
        if (cv) carregarLibQR().then(ok => {
            if (!ok) { cv.replaceWith(Object.assign(document.createElement('div'), { textContent: 'Use o Pix copia e cola abaixo', style: 'color:#71717a;font-size:.8rem;text-align:center' })); return; }
            try { QRCode.toCanvas(cv, brCode(st.valor, st.txid), { width: 214, margin: 1 }, (err) => { if (err) console.warn('[PIX] QR:', err); }); } catch (e) { console.warn('[PIX] QR:', e); }
        });
        const cp = ov.querySelector('#pix-copiar');
        if (cp) cp.onclick = async () => {
            const code = brCode(st.valor, st.txid);
            try { await navigator.clipboard.writeText(code); toast('📋 Pix copia e cola copiado'); }
            catch (_) { const t = document.createElement('textarea'); t.value = code; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); toast('📋 Copiado'); } catch (__) {} t.remove(); }
        };
        const arq = ov.querySelector('#pix-arq');
        if (arq) arq.onchange = () => { st.arquivo = arq.files && arq.files[0]; const n = ov.querySelector('#pix-arq-nome'); if (n) n.textContent = st.arquivo ? st.arquivo.name : 'Anexar comprovante (opcional)'; };
        const pg = ov.querySelector('#pix-paguei');
        if (pg) pg.onclick = jaPaguei;
    }
    async function jaPaguei() {
        const btn = document.getElementById('pix-paguei');
        if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }
        try {
            let caminho = null;
            if (st.arquivo) {
                if (st.arquivo.size > 8 * 1024 * 1024) throw new Error('Comprovante muito grande (máx. 8 MB)');
                const ext = (st.arquivo.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
                caminho = sbClube.id + '/' + Date.now() + '.' + ext;
                const { error: eUp } = await sb.storage.from('pix-comprovantes').upload(caminho, st.arquivo, { upsert: false, contentType: st.arquivo.type || undefined });
                if (eUp) { console.warn('[PIX] comprovante:', eUp); caminho = null; toast('⚠️ Comprovante não enviado — o aviso segue sem ele'); }
            }
            const { data, error } = await sb.rpc('pix_avisar_pagamento', { p_plano: st.plano.id, p_ciclo: st.ciclo, p_txid: st.txid, p_comprovante_url: caminho });
            if (error) throw error;
            if (data && data.liberado_24h) toast('✅ Aviso enviado! Seu acesso está liberado por 24h enquanto conferimos.');
            else toast('✅ Aviso enviado! A liberação acontece assim que o pagamento for conferido.');
            const { data: lst } = await sb.from('pix_solicitacoes').select('*').eq('id', data.id).limit(1);
            st.pendente = (lst && lst[0]) || { valor: st.valor, plano_id: st.plano.id, ciclo: st.ciclo };
            render();
            if (data && data.liberado_24h) {
                try { if (typeof carregarAssinaturaAtual === 'function') await carregarAssinaturaAtual(); } catch (_) {}
                setTimeout(() => { try { location.reload(); } catch (_) {} }, 2500);
            }
        } catch (e) {
            toast('⚠️ ' + (e.message || e));
            if (btn) { btn.disabled = false; btn.textContent = '✅ Já paguei'; }
        }
    }

    // ---------- Painel do super admin ----------
    async function adminPix() {
        // Só roda dentro do painel de super admin; o banco recusa para qualquer outro usuário.
        const alvo = document.getElementById('admin-content-clubes');
        if (!alvo) return;
        let box = document.getElementById('admin-pix-box');
        if (!box) {
            box = document.createElement('div'); box.id = 'admin-pix-box'; box.style.cssText = 'margin-bottom:1.25rem;';
            const tabela = alvo.querySelector('div[style*="overflow:hidden"]');
            if (tabela) alvo.insertBefore(box, tabela); else alvo.appendChild(box);
        }
        let lista = [];
        try { const { data, error } = await sb.rpc('admin_listar_pix'); if (error) throw error; lista = data || []; }
        catch (e) { box.innerHTML = '<div style="color:#fca5a5;font-size:.8rem">Pix: ' + esc(e.message || e) + '</div>'; return; }
        const pend = lista.filter(s => s.status === 'aguardando' || s.status === 'expirado');
        const rec = lista.filter(s => !(s.status === 'aguardando' || s.status === 'expirado')).slice(0, 5);
        const linha = (s, acoes) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:.75rem;flex-wrap:wrap;padding:.75rem .9rem;border:1px solid #27272a;border-radius:.6rem;background:#111114;margin-bottom:.5rem;">
            <div style="min-width:0"><b>${esc(s.clube_nome)}</b> · ${esc(s.plano_id)} ${esc(s.ciclo)} · <b style="color:#f5d572">${money(s.valor)}</b>
            <div style="font-size:.72rem;color:#8b8b93;margin-top:.15rem">${esc(s.txid)} · ${new Date(s.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}${s.liberacao_ate ? ' · liberado 24h' + (s.status === 'expirado' ? ' (expirou)' : ' até ' + new Date(s.liberacao_ate).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })) : ''}${s.dia_vencimento ? ' · vence todo dia ' + s.dia_vencimento : ''}${s.comprovante_url ? ` · <a href="#" data-comp="${esc(s.comprovante_url)}" style="color:#a5b4fc">📎 comprovante</a>` : ''}</div></div>
            <div style="display:flex;gap:.4rem">${acoes}</div></div>`;
        box.innerHTML = `<div style="font-size:.8rem;color:#a1a1aa;font-weight:800;letter-spacing:.06em;text-transform:uppercase;margin-bottom:.6rem;">Pagamentos Pix aguardando ${pend.length ? `<span style="background:rgba(245,158,11,.15);color:#fbbf24;padding:.1rem .5rem;border-radius:999px;margin-left:.3rem">${pend.length}</span>` : '<span style="color:#52525b;text-transform:none;font-weight:600">· nenhum</span>'}</div>` +
            pend.map(s => linha(s, `<button data-ok="${s.id}" style="padding:.45rem .8rem;border-radius:.4rem;border:0;background:#a855f7;color:#fff;font-weight:800;cursor:pointer">Confirmar e liberar ${s.ciclo === 'anual' ? '1 ano' : '1 mês'}</button><button data-no="${s.id}" style="padding:.45rem .8rem;border-radius:.4rem;border:1px solid #3f3f46;background:transparent;color:#d4d4d8;font-weight:700;cursor:pointer">Recusar</button>`)).join('') +
            (rec.length ? `<details style="margin-top:.4rem"><summary style="cursor:pointer;color:#71717a;font-size:.75rem">Últimos resolvidos</summary><div style="margin-top:.5rem">${rec.map(s => linha(s, `<span style="font-size:.72rem;font-weight:800;color:${s.status === 'confirmado' ? '#86efac' : '#fca5a5'}">${s.status.toUpperCase()}</span>`)).join('')}</div></details>` : '');
        box.querySelectorAll('[data-ok]').forEach(b => b.onclick = async () => {
            const s = lista.find(x => x.id === b.dataset.ok);
            if (!confirm(`Confirmar Pix de ${money(s.valor)} de "${s.clube_nome}"?\n\nConfira no app do Nubank se caiu o Pix com o identificador ${s.txid}.`)) return;
            b.disabled = true;
            try { const { data, error } = await sb.rpc('pix_confirmar', { p_id: s.id }); if (error) throw error; toast(`✓ ${s.clube_nome} liberado até ${new Date(data.validade + 'T12:00:00').toLocaleDateString('pt-BR')}`); }
            catch (e) { alert('Erro: ' + (e.message || e)); }
            await adminPix(); try { await adminCarregarClubes(); } catch (_) {}
        });
        box.querySelectorAll('[data-no]').forEach(b => b.onclick = async () => {
            const s = lista.find(x => x.id === b.dataset.no);
            const motivo = prompt(`Recusar o aviso de Pix de "${s.clube_nome}"? Motivo (opcional):`, 'Pix não encontrado');
            if (motivo === null) return;
            try { const { error } = await sb.rpc('pix_recusar', { p_id: s.id, p_motivo: motivo || null }); if (error) throw error; toast('Aviso recusado'); }
            catch (e) { alert('Erro: ' + (e.message || e)); }
            await adminPix(); try { await adminCarregarClubes(); } catch (_) {}
        });
        box.querySelectorAll('[data-comp]').forEach(a => a.onclick = async (ev) => {
            ev.preventDefault();
            try { const { data, error } = await sb.storage.from('pix-comprovantes').createSignedUrl(a.dataset.comp, 300); if (error) throw error; window.open(data.signedUrl, '_blank'); }
            catch (e) { alert('Não foi possível abrir: ' + (e.message || e)); }
        });
    }

    // Dia fixo de vencimento e valor combinado (super admin)
    async function adminCobranca(clubeId, nome) {
        const c = (typeof _adminClubesCache !== 'undefined' ? _adminClubesCache : []).find(x => x.id === clubeId) || {};
        const dia = prompt(`Dia fixo de vencimento de "${nome}" (1 a 28). Vazio = sem dia fixo (conta 30 dias a partir do pagamento):`, c.dia_vencimento || '');
        if (dia === null) return;
        const diaNum = String(dia).trim() === '' ? null : parseInt(dia, 10);
        if (diaNum !== null && (isNaN(diaNum) || diaNum < 1 || diaNum > 28)) return alert('Dia inválido (1 a 28)');
        const val = prompt(`Valor mensal combinado de "${nome}" (R$). Vazio = preço do plano:`, c.valor_combinado != null ? String(c.valor_combinado).replace('.', ',') : '');
        if (val === null) return;
        const valNum = String(val).trim() === '' ? null : parseFloat(String(val).replace(/\./g, '').replace(',', '.'));
        if (valNum !== null && (isNaN(valNum) || valNum <= 0)) return alert('Valor inválido');
        try {
            const { error } = await sb.rpc('admin_definir_cobranca', { p_clube_id: clubeId, p_dia: diaNum, p_valor: valNum });
            if (error) throw error;
            toast(`✓ ${nome}: ${diaNum ? 'vence todo dia ' + diaNum : 'sem dia fixo'} · ${valNum ? money(valNum) + '/mês' : 'preço do plano'}`);
            await adminCarregarClubes();
        } catch (e) { alert('Erro: ' + (e.message || e)); }
    }

    // ---------- Ligações ----------
    function instalar() {
        if (typeof window.abrirModalPagamento === 'function' && !window.abrirModalPagamento.__pix) {
            window._abrirModalPagamentoAsaas = window.abrirModalPagamento;
            const f = function () { abrirPix(); };
            f.__pix = true;
            window.abrirModalPagamento = f;
            try { abrirModalPagamento = f; } catch (_) {}
        }
        if (typeof window.adminCarregarClubes === 'function' && !window.adminCarregarClubes.__pix) {
            const orig = window.adminCarregarClubes;
            const g = async function () { const r = await orig.apply(this, arguments); try { await adminPix(); } catch (e) { console.warn('[PIX] admin:', e); } return r; };
            g.__pix = true;
            window.adminCarregarClubes = g;
            try { adminCarregarClubes = g; } catch (_) {}
        }
    }
    instalar();
    setInterval(instalar, 2000);
    window.stackosPix = { brCode, abrirPix, adminPix, adminCobranca, _crc16: crc16 };
})();
