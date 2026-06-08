// =====================================================================
// StackOS · Wrapper de Preview do Flyer (v2 — com shortlinks)
// Endpoint: /api/flyer?s={SLUG}        ← modo principal (URL curta)
//           /api/flyer?img=URL&...     ← modo legado (retrocompat)
//
// Resolve a limitação do WhatsApp de não gerar preview-imagem em URLs
// diretas do Supabase Storage quando há texto junto na mensagem.
//
// Quando o WhatsApp acessa essa URL pra gerar preview, encontra meta tags
// Open Graph apontando pra imagem → renderiza miniatura grande no balão.
//
// Quando o usuário clica no link, faz redirect pra imagem direta.
// =====================================================================

const SUPABASE_URL = 'https://jvvgdkjohfomuafsafsx.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_W8TlRO__dGOD539G6-9oFQ_aavbH2MA';

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
        if (!u.hostname.endsWith('.supabase.co')) return false;
        return true;
    } catch (e) {
        return false;
    }
}

function isValidSlug(s) {
    return typeof s === 'string' && /^[a-z0-9]{4,16}$/i.test(s);
}

async function buscarFlyerPorSlug(slug) {
    if (!isValidSlug(slug)) return null;
    const url = SUPABASE_URL + '/rest/v1/convite_flyer_links?slug=eq.' + encodeURIComponent(slug) + '&select=flyer_url,clube_nome,torneio_nome&limit=1';
    try {
        const r = await fetch(url, {
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
                'Accept': 'application/json'
            }
        });
        if (!r.ok) return null;
        const arr = await r.json();
        if (!Array.isArray(arr) || arr.length === 0) return null;
        const row = arr[0];
        if (!isValidImageUrl(row.flyer_url)) return null;
        return {
            img: row.flyer_url,
            clube: row.clube_nome || 'Convite',
            torneio: row.torneio_nome || ''
        };
    } catch (e) {
        console.error('[api/flyer] lookup erro:', e);
        return null;
    }
}

function renderHtml(res, data) {
    const img = data.img;
    const clube = (data.clube || 'Convite').slice(0, 80);
    const torneio = (data.torneio || '').slice(0, 100);
    const titulo = torneio ? (torneio + ' · ' + clube) : clube;
    const desc = torneio
        ? 'Você foi convidado para ' + torneio + '. Confira o flyer e confirme presença!'
        : 'Você foi convidado por ' + clube + '. Confira o flyer!';

    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=86400');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send('<!DOCTYPE html>\n' +
'<html lang="pt-BR">\n' +
'<head>\n' +
'    <meta charset="UTF-8">\n' +
'    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
'    <title>' + escapeHtml(titulo) + '</title>\n' +
'\n' +
'    <!-- Open Graph (WhatsApp, Facebook, LinkedIn) -->\n' +
'    <meta property="og:type" content="website">\n' +
'    <meta property="og:url" content="' + escapeHtml(img) + '">\n' +
'    <meta property="og:title" content="' + escapeHtml(titulo) + '">\n' +
'    <meta property="og:description" content="' + escapeHtml(desc) + '">\n' +
'    <meta property="og:image" content="' + escapeHtml(img) + '">\n' +
'    <meta property="og:image:secure_url" content="' + escapeHtml(img) + '">\n' +
'    <meta property="og:image:type" content="image/jpeg">\n' +
'    <meta property="og:image:width" content="1200">\n' +
'    <meta property="og:image:height" content="1200">\n' +
'    <meta property="og:image:alt" content="Flyer do convite">\n' +
'    <meta property="og:site_name" content="' + escapeHtml(clube) + '">\n' +
'\n' +
'    <!-- Twitter Card -->\n' +
'    <meta name="twitter:card" content="summary_large_image">\n' +
'    <meta name="twitter:title" content="' + escapeHtml(titulo) + '">\n' +
'    <meta name="twitter:description" content="' + escapeHtml(desc) + '">\n' +
'    <meta name="twitter:image" content="' + escapeHtml(img) + '">\n' +
'\n' +
'    <meta http-equiv="refresh" content="0; url=' + escapeHtml(img) + '">\n' +
'\n' +
'    <style>\n' +
'        body { margin: 0; background: #0a0a0b; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #e4e4e7; }\n' +
'        img { max-width: 100vw; max-height: 100vh; object-fit: contain; }\n' +
'        .info { position: fixed; top: 1rem; left: 1rem; background: rgba(0,0,0,.6); backdrop-filter: blur(10px); padding: .5rem .85rem; border-radius: .5rem; font-size: .85rem; font-weight: 600; }\n' +
'    </style>\n' +
'</head>\n' +
'<body>\n' +
'    <div class="info">' + escapeHtml(titulo) + '</div>\n' +
'    <img src="' + escapeHtml(img) + '" alt="Flyer">\n' +
'    <script>setTimeout(function() { window.location.href = ' + JSON.stringify(img) + '; }, 100);</script>\n' +
'</body>\n' +
'</html>');
}

export default async function handler(req, res) {
    const slug = (req.query.s || req.query.slug || '').toString();
    if (slug) {
        const data = await buscarFlyerPorSlug(slug);
        if (!data) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.status(404).send('<h1>Flyer não encontrado</h1>');
            return;
        }
        renderHtml(res, data);
        return;
    }

    const img = (req.query.img || '').toString();
    if (!isValidImageUrl(img)) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.status(400).send('<h1>URL de imagem inválida</h1>');
        return;
    }
    renderHtml(res, {
        img,
        clube: (req.query.clube || 'Convite').toString(),
        torneio: (req.query.torneio || '').toString()
    });
}
