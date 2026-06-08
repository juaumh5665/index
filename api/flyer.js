// =====================================================================
// StackOS · Wrapper de Preview do Flyer
// Endpoint: /api/flyer?img={URL_ENCODED}&clube={NOME}&torneio={NOME}
//
// Resolve a limitação do WhatsApp de não gerar preview-imagem em URLs
// diretas do Supabase Storage quando há texto junto na mensagem.
//
// Quando o WhatsApp acessa essa URL pra gerar preview, encontra meta tags
// Open Graph apontando pra imagem → renderiza miniatura grande no balão.
//
// Quando o usuário clica no link, faz redirect pra imagem direta.
// =====================================================================

function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[c]));
}

function isValidImageUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (url.length > 2000) return false;
    try {
        const u = new URL(url);
        if (!['http:', 'https:'].includes(u.protocol)) return false;
        // Permite só domínios do Supabase Storage pra evitar abuso (open redirect / SSRF)
        if (!u.hostname.endsWith('.supabase.co')) return false;
        return true;
    } catch (e) {
        return false;
    }
}

export default function handler(req, res) {
    const img = (req.query.img || '').toString();
    const clube = (req.query.clube || 'Convite').toString().slice(0, 80);
    const torneio = (req.query.torneio || '').toString().slice(0, 100);

    // Validação anti-abuso: só aceita imagens do Supabase Storage
    if (!isValidImageUrl(img)) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.status(400).send('<h1>URL de imagem inválida</h1>');
        return;
    }

    const titulo = torneio ? `${torneio} · ${clube}` : clube;
    const desc = torneio
        ? `Você foi convidado para ${torneio}. Confira o flyer e confirme presença!`
        : `Você foi convidado por ${clube}. Confira o flyer!`;

    // Cache de 10 minutos no CDN do Vercel — evita re-renderizar pra preview do mesmo link
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=86400');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    res.status(200).send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(titulo)}</title>

    <!-- Open Graph (WhatsApp, Facebook, LinkedIn) -->
    <meta property="og:type" content="website">
    <meta property="og:url" content="${escapeHtml(img)}">
    <meta property="og:title" content="${escapeHtml(titulo)}">
    <meta property="og:description" content="${escapeHtml(desc)}">
    <meta property="og:image" content="${escapeHtml(img)}">
    <meta property="og:image:secure_url" content="${escapeHtml(img)}">
    <meta property="og:image:type" content="image/jpeg">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="1200">
    <meta property="og:image:alt" content="Flyer do convite">
    <meta property="og:site_name" content="${escapeHtml(clube)}">

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(titulo)}">
    <meta name="twitter:description" content="${escapeHtml(desc)}">
    <meta name="twitter:image" content="${escapeHtml(img)}">

    <!-- Fallback: redireciona pra imagem após carregar (usuário clica → vê imagem) -->
    <meta http-equiv="refresh" content="0; url=${escapeHtml(img)}">

    <style>
        body {
            margin: 0;
            background: #0a0a0b;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            color: #e4e4e7;
        }
        img {
            max-width: 100vw;
            max-height: 100vh;
            object-fit: contain;
        }
        .info {
            position: fixed;
            top: 1rem;
            left: 1rem;
            background: rgba(0,0,0,.6);
            backdrop-filter: blur(10px);
            padding: .5rem .85rem;
            border-radius: .5rem;
            font-size: .85rem;
            font-weight: 600;
        }
    </style>
</head>
<body>
    <div class="info">${escapeHtml(titulo)}</div>
    <img src="${escapeHtml(img)}" alt="Flyer">
    <script>
        // Redirect também via JS (caso meta refresh seja bloqueado)
        setTimeout(function() { window.location.href = ${JSON.stringify(img)}; }, 100);
    </script>
</body>
</html>`);
}
