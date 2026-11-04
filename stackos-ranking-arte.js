// ============================================================
// RANKING — Gerar arte (imagem pronta pra Instagram/WhatsApp)
// ------------------------------------------------------------
// Só LÊ os pontos do ranking (calcularPontuacoesRanking, a mesma conta da tela).
// Não altera ranking, torneio, pontos nem financeiro.
// Opção por clube (sbClube.config.ranking_arte), padrão DESLIGADA.
// Preferências da arte por ranking em sbClube.config.ranking_arte_cfg[rankingId].
// ============================================================
(function () {
    'use strict';

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const toast = (m) => { try { showToast(m); } catch (_) {} };
    const ehAdmin = () => { try { return currentUser && (currentUser.role === 'admin' || currentUser.papel === 'admin' || window._isSuperAdmin); } catch (_) { return false; } };
    const ativo = () => !!(window.sbClube && sbClube.config && sbClube.config.ranking_arte);
    const getRk = (id) => (typeof rankings !== 'undefined' ? rankings : []).find(x => String(x.id) === String(id));

    const TEMAS = {
        vermelho: { c1: '#3b0d0d', c2: '#140707', c3: '#060606', acc: '#f5d572', acc2: '#d4a64a' },
        dourado:  { c1: '#3d2f0c', c2: '#141006', c3: '#060504', acc: '#f5d572', acc2: '#d4a64a' },
        verde:    { c1: '#0f3d26', c2: '#07170f', c3: '#030806', acc: '#f5d572', acc2: '#d4a64a' },
        azul:     { c1: '#0c2a4d', c2: '#071324', c3: '#03070d', acc: '#f5d572', acc2: '#d4a64a' },
    };
    const FMT = { story: [1080, 1920], feed: [1080, 1350] };

    let st = null;          // estado do painel aberto
    let imgCache = {};      // url -> HTMLImageElement

    // ---------------- Dados (só leitura) ----------------
    function dadosRanking(r) {
        const atual = calcularPontuacoesRanking(r) || [];
        // Último torneio encerrado do ranking (para ↑↓ e subtítulo)
        const doRank = (typeof torneios !== 'undefined' ? torneios : []).filter(t => t.rankingId == r.id && t.status === 'finished');
        let ultimo = null;
        doRank.forEach(t => { const ts = Number(t.encerradoEm) || Number(t.iniciadoEm) || 0; if (!ultimo || ts > ultimo._ts) ultimo = { t, _ts: ts }; });
        let antes = null;
        if (ultimo) {
            // Mesma conta, sem o último torneio. Troca a lista só durante a chamada (síncrono).
            const original = torneios;
            try { torneios = original.filter(t => t !== ultimo.t); antes = calcularPontuacoesRanking(r) || []; }
            catch (_) { antes = null; }
            finally { torneios = original; }
        }
        const posAntes = {};
        if (antes) antes.forEach((p, i) => { posAntes[String(p.jogadorId)] = i + 1; });
        const lista = atual.map((p, i) => {
            const pa = posAntes[String(p.jogadorId)];
            return { pos: i + 1, nome: String(p.nome || 'Jogador'), pontos: Number(p.pontos) || 0, delta: antes ? (pa ? pa - (i + 1) : null) : undefined };
        });
        let dataUlt = '';
        if (ultimo) {
            const t = ultimo.t;
            const d = t.data ? new Date(t.data + 'T12:00:00') : (ultimo._ts ? new Date(ultimo._ts) : null);
            if (d && !isNaN(d)) dataUlt = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        }
        return { lista, dataUlt, temComparacao: !!antes };
    }

    // ---------------- Preferências ----------------
    function cfgPadrao(r) {
        return {
            fundo: 'tema', modelo: 'A', formato: 'story', top: 10, tema: 'vermelho',
            titulo: String(r.nome || 'RANKING').toUpperCase(), subtitulo: '',
            logo: true, pontos: true, setas: true, rodape: '',
            posicao: 'baixo', escurecer: 60, img: '',
        };
    }
    function cfgSalva(r) {
        const all = (window.sbClube && sbClube.config && sbClube.config.ranking_arte_cfg) || {};
        return Object.assign(cfgPadrao(r), all[r.id] || {});
    }
    async function salvarCfg(r, c) {
        if (!window.sbClube) return;
        const salvar = Object.assign({}, c); delete salvar._imgLocal;
        const all = Object.assign({}, (sbClube.config && sbClube.config.ranking_arte_cfg) || {}, { [r.id]: salvar });
        const novo = Object.assign({}, sbClube.config || {}, { ranking_arte_cfg: all });
        try {
            const { error } = await sb.from('clubes').update({ config: novo }).eq('id', sbClube.id);
            if (error) throw error;
            sbClube.config = novo;
        } catch (e) { console.warn('[RANKING-ARTE] salvar preferências:', e); }
    }

    // ---------------- Imagens ----------------
    function carregarImg(src) {
        if (!src) return Promise.resolve(null);
        if (imgCache[src] && imgCache[src].complete) return Promise.resolve(imgCache[src]);
        return new Promise(res => {
            const im = new Image();
            if (!/^data:|^blob:/.test(src)) im.crossOrigin = 'anonymous';
            im.onload = () => { imgCache[src] = im; res(im); };
            im.onerror = () => res(null);
            im.src = src;
        });
    }
    function logoSrc() {
        try { if (typeof _getClubeLogoUrl === 'function') { const u = _getClubeLogoUrl(); if (u) return u; } } catch (_) {}
        return (window.sbClube && sbClube.logo_url) || '';
    }
    async function enviarImagem(file) {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const safe = ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? ext : 'jpg';
        const path = sbClube.id + '/ranking-arte/' + st.r.id + '-' + Date.now().toString(36) + '.' + safe;
        const { error } = await sb.storage.from('convite-flyers').upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || 'image/jpeg' });
        if (error) throw error;
        return sb.storage.from('convite-flyers').getPublicUrl(path).data.publicUrl;
    }

    // ---------------- Desenho ----------------
    const FONT_T = '"Oswald", Impact, "Arial Narrow", sans-serif';
    const FONT_B = 'Inter, "Segoe UI", Arial, sans-serif';
    function cortar(ctx, txt, max) {
        if (ctx.measureText(txt).width <= max) return txt;
        let s = txt;
        while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1);
        return s + '…';
    }
    function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
    function fmt(n) { return Math.round(n).toLocaleString('pt-BR'); }

    function fundoTema(ctx, W, H, T) {
        const g = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, H * 0.95);
        g.addColorStop(0, T.c1); g.addColorStop(0.45, T.c2); g.addColorStop(1, T.c3);
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    function desenharCover(ctx, im, x, y, w, h) {
        const s = Math.max(w / im.width, h / im.height);
        const iw = im.width * s, ih = im.height * s;
        ctx.drawImage(im, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
    }

    function cabecalho(ctx, W, y, c, T, logo) {
        if (c.logo && logo) {
            const R = 62;
            ctx.save(); ctx.beginPath(); ctx.arc(W / 2, y + R, R, 0, Math.PI * 2); ctx.closePath();
            ctx.fillStyle = '#000'; ctx.fill(); ctx.clip();
            desenharCover(ctx, logo, W / 2 - R, y, R * 2, R * 2); ctx.restore();
            ctx.lineWidth = 5; ctx.strokeStyle = T.acc2; ctx.beginPath(); ctx.arc(W / 2, y + R, R, 0, Math.PI * 2); ctx.stroke();
            y += R * 2 + 26;
        }
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = T.acc; ctx.font = '700 84px ' + FONT_T;
        ctx.fillText(cortar(ctx, c.titulo || 'RANKING', W - 120), W / 2, y + 76); y += 76;
        if (c.subtitulo) {
            ctx.fillStyle = '#d4d4d8'; ctx.font = '600 28px ' + FONT_B;
            ctx.fillText(cortar(ctx, c.subtitulo.toUpperCase(), W - 120), W / 2, y + 48); y += 48;
        }
        return y + 30;
    }

    function linhas(ctx, W, x0, y, w, itens, c, T, rowH, fs) {
        itens.forEach((p, i) => {
            const yy = y + i * rowH;
            if (p.pos === 1) { const g = ctx.createLinearGradient(x0, 0, x0 + w, 0); g.addColorStop(0, 'rgba(212,166,74,.38)'); g.addColorStop(1, 'rgba(212,166,74,.04)'); ctx.fillStyle = g; rr(ctx, x0, yy + 3, w, rowH - 6, 12); ctx.fill(); }
            ctx.strokeStyle = 'rgba(245,213,114,.16)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, yy + rowH); ctx.lineTo(x0 + w, yy + rowH); ctx.stroke();
            const mid = yy + rowH / 2 + fs * 0.36;
            ctx.textAlign = 'left'; ctx.fillStyle = T.acc; ctx.font = '800 ' + fs + 'px ' + FONT_B;
            ctx.fillText(p.pos + 'º', x0 + 22, mid);
            let dir = x0 + w - 22;
            ctx.textAlign = 'right';
            if (c.setas && p.delta !== undefined) {
                ctx.font = '800 ' + Math.round(fs * 0.78) + 'px ' + FONT_B;
                let s = '=', cor = '#71717a';
                if (p.delta === null) { s = 'NOVO'; cor = '#60a5fa'; } else if (p.delta > 0) { s = '▲' + p.delta; cor = '#4ade80'; } else if (p.delta < 0) { s = '▼' + (-p.delta); cor = '#f87171'; }
                ctx.fillStyle = cor; ctx.fillText(s, dir, mid); dir -= Math.max(ctx.measureText('NOVO').width, 60) + 18;
            }
            if (c.pontos) { ctx.fillStyle = '#fff'; ctx.font = '800 ' + fs + 'px ' + FONT_B; ctx.fillText(fmt(p.pontos), dir, mid); dir -= ctx.measureText('00.000').width + 18; }
            ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = '600 ' + fs + 'px ' + FONT_B;
            const xn = x0 + 22 + fs * 2.4;
            ctx.fillText(cortar(ctx, (p.pos === 1 ? '👑 ' : '') + p.nome.toUpperCase(), dir - xn), xn, mid);
        });
        return y + itens.length * rowH;
    }

    function podio(ctx, W, y, top3, c, T) {
        const cols = [
            { p: top3[1], cx: W / 2 - 300, h: 150, cor: ['#a1a1aa', '#52525b'], borda: '#d4d4d8', fundo: '#27272a', txt: '#fff' },
            { p: top3[0], cx: W / 2, h: 210, cor: ['#d4a64a', '#7a5a1c'], borda: '#f5d572', fundo: '#3a2c08', txt: '#f5d572' },
            { p: top3[2], cx: W / 2 + 300, h: 110, cor: ['#b45309', '#5c2b05'], borda: '#d97706', fundo: '#3a1d05', txt: '#fdba74' },
        ];
        const base = y + 480;
        cols.forEach((k, i) => {
            if (!k.p) return;
            const topo = base - k.h;
            const g = ctx.createLinearGradient(0, topo, 0, base); g.addColorStop(0, k.cor[0]); g.addColorStop(1, k.cor[1]);
            ctx.fillStyle = g; rr(ctx, k.cx - 130, topo, 260, k.h + 14, 14); ctx.fill();
            ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = '700 64px ' + FONT_T; ctx.fillText(String(k.p.pos), k.cx, topo + 72);
            // avatar + nome + pontos
            const ay = topo - 250;
            ctx.beginPath(); ctx.arc(k.cx, ay + 62, 62, 0, Math.PI * 2); ctx.fillStyle = k.fundo; ctx.fill(); ctx.lineWidth = 6; ctx.strokeStyle = k.borda; ctx.stroke();
            ctx.fillStyle = k.txt; ctx.font = '700 56px ' + FONT_T; ctx.fillText(i === 1 ? '👑' : String(k.p.pos), k.cx, ay + 82);
            ctx.fillStyle = '#fff'; ctx.font = '600 30px ' + FONT_B;
            const partes = k.p.nome.toUpperCase().split(' ');
            const l1 = cortar(ctx, partes.slice(0, Math.ceil(partes.length / 2)).join(' '), 270);
            const l2 = cortar(ctx, partes.slice(Math.ceil(partes.length / 2)).join(' '), 270);
            ctx.fillText(l1, k.cx, ay + 166); if (l2) ctx.fillText(l2, k.cx, ay + 200);
            if (c.pontos) { ctx.fillStyle = T.acc; ctx.font = '800 32px ' + FONT_B; ctx.fillText(fmt(k.p.pontos) + ' pts', k.cx, ay + (l2 ? 238 : 204)); }
        });
        return base + 40;
    }

    function rodape(ctx, W, H, c) {
        if (!c.rodape) return;
        ctx.textAlign = 'center'; ctx.fillStyle = '#a1a1aa'; ctx.font = '600 24px ' + FONT_B;
        ctx.fillText(cortar(ctx, c.rodape.toUpperCase(), W - 80), W / 2, H - 40);
    }

    async function desenhar(canvas, c, dados) {
        const [W, H] = FMT[c.formato] || FMT.story;
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');
        const T = TEMAS[c.tema] || TEMAS.vermelho;
        try { await Promise.all([document.fonts.load('700 80px Oswald'), document.fonts.load('600 30px Inter'), document.fonts.load('800 30px Inter')]); } catch (_) {}
        const logo = c.logo ? await carregarImg(logoSrc()) : null;
        const img = (c.fundo !== 'tema') ? await carregarImg(c._imgLocal || c.img) : null;
        const itens = dados.lista.slice(0, c.top);
        const reservaRodape = c.rodape ? 90 : 40;
        ctx.clearRect(0, 0, W, H);

        // ---- Imagem no topo + ranking embaixo ----
        if (c.fundo === 'topo' && img) {
            ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, W, H);
            // A arte do clube aparece INTEIRA. Se ela for alta demais para caber o ranking embaixo,
            // diminui (centralizada) e as laterais ganham a própria imagem desfocada.
            const rowIdeal = 72;
            const altLista = 66 + (c.subtitulo ? 44 : 0) + 22 + itens.length * rowIdeal + reservaRodape;
            const ihFull = img.height * (W / img.width);
            const ih = Math.max(H * 0.42, Math.min(ihFull, H - altLista + 40));
            const iw = Math.min(W, img.width * (ih / img.height));
            if (iw < W - 2) {
                ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, ih); ctx.clip();
                try { ctx.filter = 'blur(28px)'; } catch (_) {}
                desenharCover(ctx, img, -40, -40, W + 80, ih + 80);
                try { ctx.filter = 'none'; } catch (_) {}
                ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(0, 0, W, ih);
                ctx.restore();
            }
            ctx.drawImage(img, (W - iw) / 2, 0, iw, ih);
            const g = ctx.createLinearGradient(0, ih * 0.82, 0, ih); g.addColorStop(0, 'rgba(5,5,5,0)'); g.addColorStop(1, '#050505');
            ctx.fillStyle = g; ctx.fillRect(0, ih * 0.82 - 1, W, ih * 0.18 + 2);
            let y = ih - 40;
            ctx.textAlign = 'center'; ctx.fillStyle = T.acc; ctx.font = '700 70px ' + FONT_T;
            ctx.fillText(cortar(ctx, c.titulo || 'RANKING', W - 100), W / 2, y + 62); y += 62;
            if (c.subtitulo) { ctx.fillStyle = '#d4d4d8'; ctx.font = '600 26px ' + FONT_B; ctx.fillText(cortar(ctx, c.subtitulo.toUpperCase(), W - 100), W / 2, y + 44); y += 44; }
            y += 22;
            const disp = H - reservaRodape - y;
            const rowH = Math.max(46, Math.min(96, Math.floor(disp / Math.max(1, itens.length))));
            const caben = Math.max(1, Math.floor(disp / rowH));
            linhas(ctx, W, 50, y, W - 100, itens.slice(0, caben), c, T, rowH, Math.round(rowH * 0.42));
            rodape(ctx, W, H, c);
            return { cortados: itens.length - Math.min(itens.length, caben) };
        }

        // ---- Imagem de fundo + quadro ----
        if (c.fundo === 'fundo' && img) {
            desenharCover(ctx, img, 0, 0, W, H);
            ctx.fillStyle = 'rgba(0,0,0,' + (Math.max(0, Math.min(90, Number(c.escurecer) || 0)) / 100) + ')'; ctx.fillRect(0, 0, W, H);
            const rowH = Math.max(46, Math.min(84, Math.floor((H - 420 - reservaRodape) / Math.max(1, itens.length))));
            const fs = Math.round(rowH * 0.42);
            const altTitulo = 76 + (c.subtitulo ? 44 : 0) + 34;
            const altQuadro = itens.length * rowH + 40;
            const total = altTitulo + altQuadro;
            let y = c.posicao === 'cima' ? 70 : c.posicao === 'centro' ? (H - total) / 2 : H - reservaRodape - total - 20;
            y = Math.max(40, y);
            ctx.textAlign = 'center'; ctx.fillStyle = T.acc; ctx.font = '700 76px ' + FONT_T;
            ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 18;
            ctx.fillText(cortar(ctx, c.titulo || 'RANKING', W - 100), W / 2, y + 68); y += 76;
            if (c.subtitulo) { ctx.fillStyle = '#e4e4e7'; ctx.font = '600 26px ' + FONT_B; ctx.fillText(cortar(ctx, c.subtitulo.toUpperCase(), W - 100), W / 2, y + 36); y += 44; }
            ctx.shadowBlur = 0; y += 26;
            ctx.fillStyle = 'rgba(0,0,0,.58)'; rr(ctx, 40, y, W - 80, altQuadro, 26); ctx.fill();
            ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(245,213,114,.4)'; ctx.stroke();
            linhas(ctx, W, 60, y + 20, W - 120, itens, c, T, rowH, fs);
            rodape(ctx, W, H, c);
            return { cortados: 0 };
        }

        // ---- Modelos com tema ----
        fundoTema(ctx, W, H, T);
        let y = cabecalho(ctx, W, 60, c, T, logo);
        if (c.modelo === 'A' && itens.length >= 3) {
            y = podio(ctx, W, y, itens.slice(0, 3), c, T);
            const resto = itens.slice(3);
            const rowH = Math.max(44, Math.min(110, Math.floor((H - reservaRodape - y) / Math.max(1, resto.length))));
            const caben = Math.floor((H - reservaRodape - y) / rowH);
            linhas(ctx, W, 50, y, W - 100, resto.slice(0, caben), c, T, rowH, Math.round(rowH * 0.42));
            rodape(ctx, W, H, c);
            return { cortados: resto.length - Math.min(resto.length, caben) };
        }
        if (c.modelo === 'C' && itens.length >= 1) {
            const lider = itens[0], seg = itens[1];
            ctx.fillStyle = 'rgba(212,166,74,.1)'; rr(ctx, 50, y, W - 100, 200, 22); ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = T.acc2; ctx.stroke();
            ctx.beginPath(); ctx.arc(160, y + 100, 66, 0, Math.PI * 2); ctx.fillStyle = '#2a1f05'; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = T.acc; ctx.stroke();
            ctx.textAlign = 'center'; ctx.font = '700 64px ' + FONT_T; ctx.fillStyle = T.acc; ctx.fillText('👑', 160, y + 122);
            ctx.textAlign = 'left'; ctx.fillStyle = T.acc2; ctx.font = '800 24px ' + FONT_B; ctx.fillText('LÍDER DO RANKING', 260, y + 62);
            ctx.fillStyle = '#fff'; ctx.font = '700 58px ' + FONT_T; ctx.fillText(cortar(ctx, lider.nome.toUpperCase(), W - 340), 260, y + 124);
            if (c.pontos) { ctx.fillStyle = T.acc; ctx.font = '800 32px ' + FONT_B; ctx.fillText(fmt(lider.pontos) + ' pts' + (seg ? ' · ' + fmt(lider.pontos - seg.pontos) + ' pts à frente' : ''), 260, y + 170); }
            y += 230;
            // Quem mais subiu
            let subiu = null;
            if (dados.temComparacao) dados.lista.forEach(p => { if (p.delta > 0 && (!subiu || p.delta > subiu.delta)) subiu = p; });
            const reservaSubiu = subiu ? 170 : 0;
            const resto = itens.slice(1);
            const rowH = Math.max(44, Math.min(110, Math.floor((H - reservaRodape - reservaSubiu - y) / Math.max(1, resto.length))));
            const caben = Math.floor((H - reservaRodape - reservaSubiu - y) / rowH);
            y = linhas(ctx, W, 50, y, W - 100, resto.slice(0, caben), c, T, rowH, Math.round(rowH * 0.42));
            if (subiu) {
                y += 26;
                ctx.fillStyle = 'rgba(34,197,94,.1)'; rr(ctx, 50, y, W - 100, 120, 22); ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#22c55e'; ctx.stroke();
                ctx.textAlign = 'left'; ctx.fillStyle = '#4ade80'; ctx.font = '800 22px ' + FONT_B; ctx.fillText('QUEM MAIS SUBIU NO ÚLTIMO TORNEIO', 90, y + 46);
                ctx.fillStyle = '#fff'; ctx.font = '700 40px ' + FONT_T; ctx.fillText(cortar(ctx, subiu.nome.toUpperCase() + ' · +' + subiu.delta + ' POSIÇÕES', W - 180), 90, y + 96);
            }
            rodape(ctx, W, H, c);
            return { cortados: resto.length - Math.min(resto.length, caben) };
        }
        // Modelo B (lista) — ou A/C com poucos jogadores
        const rowH = Math.max(46, Math.min(120, Math.floor((H - reservaRodape - y) / Math.max(1, itens.length))));
        const caben = Math.floor((H - reservaRodape - y) / rowH);
        linhas(ctx, W, 50, y, W - 100, itens.slice(0, caben), c, T, rowH, Math.round(rowH * 0.42));
        rodape(ctx, W, H, c);
        return { cortados: itens.length - Math.min(itens.length, caben) };
    }

    // ---------------- Painel ----------------
    function seg(nome, opcoes, atual) {
        return '<div style="display:flex;gap:6px;flex-wrap:wrap">' + opcoes.map(([v, t]) =>
            '<button type="button" data-k="' + nome + '" data-v="' + esc(v) + '" style="padding:6px 10px;border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit;' +
            (String(atual) === String(v) ? 'border:1px solid #a855f7;background:rgba(168,85,247,.18);color:#e9d5ff' : 'border:1px solid #3f3f46;background:#18181b;color:#d4d4d8') + '">' + t + '</button>').join('') + '</div>';
    }
    const lab = (t) => '<div style="font-size:11px;color:#a1a1aa;text-transform:uppercase;letter-spacing:.06em;margin:12px 0 6px;font-weight:700">' + t + '</div>';
    const inp = 'width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid #3f3f46;background:#0f0f12;color:#e4e4e7;font-family:inherit;font-size:13px';

    function renderPainel() {
        const c = st.c;
        const comImg = c.fundo !== 'tema';
        const temImg = !!(c._imgLocal || c.img);
        const html =
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><div style="font-weight:800;font-size:17px">🎨 Gerar arte — ' + esc(st.r.nome) + '</div><button id="rka-x" style="background:none;border:0;color:#a1a1aa;font-size:22px;cursor:pointer">✕</button></div>' +
            '<div style="font-size:12px;color:#a1a1aa;margin-bottom:10px">Só lê os pontos do ranking. Não altera nada.</div>' +
            '<div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start">' +
            '<div style="flex:1 1 300px;min-width:0;max-width:380px">' +
            lab('Fundo') + seg('fundo', [['tema', 'Cores (sem imagem)'], ['topo', 'Imagem no topo'], ['fundo', 'Imagem de fundo']], c.fundo) +
            (comImg ?
                lab('Imagem do clube') +
                '<label style="display:flex;gap:10px;align-items:center;border:1px dashed #a855f7;border-radius:10px;padding:10px;cursor:pointer;font-size:12px">' +
                (temImg ? '<span style="width:44px;height:55px;border-radius:4px;flex:none;background:#000 url(\'' + esc(c._imgLocal || c.img) + '\') center/cover"></span>' : '<span style="font-size:22px">🖼️</span>') +
                '<span>' + (temImg ? '<b>Imagem escolhida</b><br><span style="color:#a1a1aa">clique para trocar</span>' : '<b>Escolher imagem do computador</b><br><span style="color:#a1a1aa">JPG ou PNG</span>') + '</span>' +
                '<input id="rka-file" type="file" accept="image/png,image/jpeg,image/webp" style="display:none"></label>' +
                (c.fundo === 'fundo' ? lab('Onde vai o ranking') + seg('posicao', [['cima', 'Em cima'], ['centro', 'Centro'], ['baixo', 'Embaixo']], c.posicao) +
                    lab('Escurecer a imagem: ' + c.escurecer + '%') + '<input id="rka-esc" type="range" min="0" max="90" step="5" value="' + c.escurecer + '" style="width:100%;accent-color:#a855f7">' : '')
                : lab('Modelo') + seg('modelo', [['A', 'A · Pódio + lista'], ['B', 'B · Lista'], ['C', 'C · Líder']], c.modelo) +
                  lab('Tema') + seg('tema', [['vermelho', 'Vermelho'], ['dourado', 'Dourado'], ['verde', 'Verde'], ['azul', 'Azul']], c.tema)) +
            lab('Formato') + seg('formato', [['story', 'Story 9:16'], ['feed', 'Feed 4:5']], c.formato) +
            lab('Quantos jogadores') + seg('top', [[5, 'Top 5'], [10, 'Top 10'], [15, 'Top 15'], [20, 'Top 20']], c.top) +
            lab('Título') + '<input id="rka-tit" style="' + inp + '" maxlength="40" value="' + esc(c.titulo) + '">' +
            lab('Subtítulo') + '<input id="rka-sub" style="' + inp + '" maxlength="60" value="' + esc(c.subtitulo) + '">' +
            lab('Rodapé') + '<input id="rka-rod" style="' + inp + '" maxlength="70" value="' + esc(c.rodape) + '" placeholder="ex: Ranking completo no link da bio">' +
            lab('Mostrar') + '<div style="display:flex;gap:12px;flex-wrap:wrap;font-size:13px">' +
            (!comImg ? '<label><input type="checkbox" id="rka-logo"' + (c.logo ? ' checked' : '') + '> Logo</label>' : '') +
            '<label><input type="checkbox" id="rka-pts"' + (c.pontos ? ' checked' : '') + '> Pontos</label>' +
            '<label><input type="checkbox" id="rka-set"' + (c.setas ? ' checked' : '') + (st.dados.temComparacao ? '' : ' disabled') + '> ↑↓ posições' + (st.dados.temComparacao ? '' : ' <span style="color:#71717a">(sem torneio encerrado)</span>') + '</label></div>' +
            '<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">' +
            '<button id="rka-baixar" style="flex:1;padding:11px;border-radius:8px;border:0;background:#a855f7;color:#fff;font-weight:800;cursor:pointer;font-family:inherit">⬇ Baixar PNG</button>' +
            (navigator.canShare ? '<button id="rka-share" style="flex:1;padding:11px;border-radius:8px;border:1px solid #166534;background:rgba(34,197,94,.1);color:#86efac;font-weight:800;cursor:pointer;font-family:inherit">Compartilhar</button>' : '') +
            '</div><div id="rka-aviso" style="font-size:12px;color:#fbbf24;margin-top:8px"></div></div>' +
            '<div style="flex:1 1 280px;display:flex;justify-content:center"><canvas id="rka-cv" style="width:100%;max-width:' + (c.formato === 'story' ? 340 : 400) + 'px;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.6);background:#000"></canvas></div>' +
            '</div>';
        let ov = document.getElementById('rka-ov');
        if (!ov) {
            ov = document.createElement('div'); ov.id = 'rka-ov';
            ov.style.cssText = 'position:fixed;inset:0;background:rgba(9,9,11,.9);z-index:100003;overflow:auto;padding:16px;';
            ov.innerHTML = '<div id="rka-box" style="max-width:900px;margin:0 auto;background:#14141a;border:1px solid #27272a;border-radius:12px;padding:18px;color:#e4e4e7;font-family:inherit"></div>';
            document.body.appendChild(ov);
        }
        ov.querySelector('#rka-box').innerHTML = html;
        ligar(ov);
        redesenhar();
    }

    let _salvarTimer = null;
    function mudou(rerender) {
        if (rerender) renderPainel(); else redesenhar();
        clearTimeout(_salvarTimer);
        _salvarTimer = setTimeout(() => salvarCfg(st.r, st.c), 1200);
    }
    let _seq = 0;
    async function redesenhar() {
        const cv = document.getElementById('rka-cv'); if (!cv) return;
        const meu = ++_seq;
        const tmp = document.createElement('canvas');
        let info = { cortados: 0 };
        try { info = await desenhar(tmp, st.c, st.dados) || info; } catch (e) { console.warn('[RANKING-ARTE]', e); }
        if (meu !== _seq) return;
        cv.width = tmp.width; cv.height = tmp.height; cv.getContext('2d').drawImage(tmp, 0, 0);
        st.ultimoCanvas = tmp;
        const av = document.getElementById('rka-aviso');
        if (av) {
            const semImg = st.c.fundo !== 'tema' && !(st.c._imgLocal || st.c.img);
            av.textContent = semImg ? 'Escolha uma imagem para usar de fundo.' :
                info.cortados > 0 ? 'Não coube todo mundo: ' + info.cortados + ' jogador(es) ficaram de fora. Diminua o Top ou use outro formato.' : '';
        }
    }

    function ligar(ov) {
        ov.querySelector('#rka-x').onclick = () => ov.remove();
        ov.querySelectorAll('button[data-k]').forEach(b => b.onclick = () => {
            const k = b.dataset.k; let v = b.dataset.v; if (k === 'top') v = Number(v);
            st.c[k] = v; mudou(true);
        });
        const txt = (id, k) => { const el = ov.querySelector(id); if (el) el.oninput = () => { st.c[k] = el.value; mudou(false); }; };
        txt('#rka-tit', 'titulo'); txt('#rka-sub', 'subtitulo'); txt('#rka-rod', 'rodape');
        const chk = (id, k) => { const el = ov.querySelector(id); if (el) el.onchange = () => { st.c[k] = el.checked; mudou(false); }; };
        chk('#rka-logo', 'logo'); chk('#rka-pts', 'pontos'); chk('#rka-set', 'setas');
        const esc2 = ov.querySelector('#rka-esc');
        if (esc2) esc2.oninput = () => { st.c.escurecer = Number(esc2.value); const l = esc2.previousElementSibling; if (l) l.textContent = 'Escurecer a imagem: ' + esc2.value + '%'; mudou(false); };
        const f = ov.querySelector('#rka-file');
        if (f) f.onchange = async () => {
            const file = f.files && f.files[0]; if (!file) return;
            if (file.size > 8 * 1024 * 1024) { toast('⚠️ Imagem muito grande (máx. 8 MB)'); return; }
            st.c._imgLocal = URL.createObjectURL(file);
            renderPainel();
            try { st.c.img = await enviarImagem(file); salvarCfg(st.r, st.c); toast('🖼️ Imagem salva no clube'); }
            catch (e) { console.warn('[RANKING-ARTE] upload:', e); toast('⚠️ Imagem usada só agora (não foi possível salvar no clube)'); }
        };
        const nomeArq = () => 'ranking-' + String(st.r.nome || 'clube').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + (st.c.formato) + '.png';
        const blob = () => new Promise((res, rej) => {
            const cv = st.ultimoCanvas; if (!cv) return rej(new Error('sem arte'));
            try { cv.toBlob(b => b ? res(b) : rej(new Error('Não foi possível gerar a imagem')), 'image/png'); } catch (e) { rej(e); }
        });
        const erroImg = (e) => { console.warn('[RANKING-ARTE]', e); toast(/insecure|tainted|SecurityError/i.test(String(e && (e.name + e.message))) ? '⚠️ A imagem de fundo bloqueou a exportação. Escolha a imagem de novo.' : '⚠️ ' + (e.message || e)); };
        ov.querySelector('#rka-baixar').onclick = async () => {
            try { const b = await blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = nomeArq(); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
            catch (e) { erroImg(e); }
        };
        const sh = ov.querySelector('#rka-share');
        if (sh) sh.onclick = async () => {
            try {
                const b = await blob(); const file = new File([b], nomeArq(), { type: 'image/png' });
                if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: st.c.titulo });
                else toast('Compartilhamento não suportado aqui — use Baixar PNG');
            } catch (e) { if (e && e.name !== 'AbortError') erroImg(e); }
        };
    }

    function abrir(rid) {
        const r = getRk(rid);
        if (!r) return toast('Ranking não encontrado');
        if (!document.getElementById('rka-fontes')) {
            const l = document.createElement('link'); l.id = 'rka-fontes'; l.rel = 'stylesheet';
            l.href = 'https://fonts.googleapis.com/css2?family=Oswald:wght@500;700&family=Inter:wght@600;800&display=swap';
            document.head.appendChild(l);
        }
        const dados = dadosRanking(r);
        const c = cfgSalva(r);
        if (!c.subtitulo && dados.dataUlt) c.subtitulo = 'Atualizado após o torneio de ' + dados.dataUlt;
        if (!c.rodape && r.slug) c.rodape = 'Ranking completo: ' + window.location.host + '/r/' + r.slug;
        if (!dados.temComparacao) c.setas = false;
        st = { r, c, dados };
        if (!dados.lista.length) toast('Este ranking ainda não tem pontos');
        renderPainel();
    }

    // ---------------- Opção (Configurações › Torneios) ----------------
    function garantirOpcao() {
        const aba = document.getElementById('cfg-torneios');
        if (!aba || !ehAdmin() || document.getElementById('cfg-rk-arte-card')) return;
        const card = document.createElement('div');
        card.id = 'cfg-rk-arte-card';
        card.style.cssText = 'margin-bottom:1rem;padding:1rem;background:#14141a;border:1px solid #27272a;border-radius:.6rem;';
        card.innerHTML = '<label style="display:flex;gap:.6rem;align-items:flex-start;cursor:pointer">' +
            '<input type="checkbox" id="cfg-rk-arte" style="width:18px;height:18px;margin-top:2px;accent-color:#a855f7">' +
            '<span><b>🎨 Arte do ranking</b><br><span style="font-size:.78rem;color:#a1a1aa">Mostra o botão "Gerar arte" nos rankings: monta uma imagem pronta pra Instagram/WhatsApp com o top do ranking (com cores ou em cima de uma imagem do clube). Só lê os pontos.</span></span></label>';
        const ref = document.getElementById('cfg-tv-elim-card');
        if (ref && ref.parentNode === aba) ref.insertAdjacentElement('afterend', card); else aba.insertBefore(card, aba.firstChild);
        const cb = card.querySelector('#cfg-rk-arte');
        cb.checked = ativo();
        cb.addEventListener('change', async () => {
            if (!window.sbClube) return;
            const novo = Object.assign({}, sbClube.config || {}, { ranking_arte: cb.checked });
            try {
                const { error } = await sb.from('clubes').update({ config: novo }).eq('id', sbClube.id);
                if (error) throw error;
                sbClube.config = novo;
                toast(cb.checked ? '🎨 Arte do ranking ativada' : 'Arte do ranking desativada');
            } catch (e) { cb.checked = !cb.checked; toast('⚠️ Não foi possível salvar: ' + (e.message || e)); }
        });
    }

    // ---------------- Botão nos cards do ranking ----------------
    function injetar() {
        const ligado = ativo() && ehAdmin();
        document.querySelectorAll('button[onclick^="editarRanking("]').forEach(b => {
            const m = (b.getAttribute('onclick') || '').match(/editarRanking\('([^']+)'\)/);
            if (!m) return;
            const ja = b.parentNode && b.parentNode.querySelector('button[data-rk-arte="' + m[1] + '"]');
            if (!ligado) { if (ja) ja.remove(); return; }
            if (ja) return;
            const x = document.createElement('button'); x.className = 'btn-ghost'; x.type = 'button'; x.title = 'Gerar arte do ranking (Instagram/WhatsApp)';
            x.style.cssText = 'padding:.35rem .65rem;font-size:.75rem;'; x.textContent = '🎨 Arte'; x.dataset.rkArte = m[1];
            x.onclick = () => abrir(m[1]);
            b.insertAdjacentElement('beforebegin', x);
        });
    }
    setInterval(() => { try { garantirOpcao(); injetar(); } catch (_) {} }, 1000);
    window.stackosRankingArte = { abrir, _desenhar: desenhar, _dados: dadosRanking };
})();
