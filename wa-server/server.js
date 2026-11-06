const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, prepareWAMessageMedia, generateWAMessageFromContent } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const pino = require('pino');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY || 'StackOS2024WPP';

// Limpa auth_sessions corrompidas ao iniciar (previne loop Bad MAC)
const authBaseDir = path.join(__dirname, 'auth_sessions');
try {
    if (fs.existsSync(authBaseDir)) {
        fs.rmSync(authBaseDir, { recursive: true, force: true });
        console.log('[Server] Limpou auth_sessions antigas no startup');
    }
} catch (e) {
    console.warn('[Server] Erro ao limpar auth_sessions:', e.message);
}

// Store sessions in memory
const sessions = {};

// Simple auth middleware
function auth(req, res, next) {
    const key = req.headers['x-api-key'] || req.query.key;
    if (key !== SECRET_KEY) {
        return res.status(401).json({ error: 'Invalid API key' });
    }
    next();
}

/**
 * Create (or reconnect) a Baileys socket for sessionId.
 * Handles QR generation, auto-reconnect on restartRequired, and creds saving.
 * @param {string} sessionId
 * @param {boolean} isReconnect - true if this is an auto-reconnect (skip auth cleanup)
 */
async function connectSocket(sessionId, isReconnect = false) {
    const authDir = path.join(__dirname, 'auth_sessions', sessionId);

    // Only clean auth on fresh start, never on reconnect (reconnect needs saved creds from QR scan)
    if (!isReconnect) {
        try {
            if (fs.existsSync(authDir)) {
                fs.rmSync(authDir, { recursive: true, force: true });
                console.log(`[${sessionId}] Cleaned auth state for fresh QR`);
            }
        } catch (e) {
            console.log(`[${sessionId}] Auth cleanup error:`, e.message);
        }
    }

    const { state, saveCreds } = await useMultiFileAuthState(`./auth_sessions/${sessionId}`);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['StackOS', 'Chrome', '10.0'],
        connectTimeoutMs: 90000,
        qrTimeout: 90000,
    });

    // Update session object
    sessions[sessionId].sock = sock;
    if (!isReconnect) {
        sessions[sessionId].qr = null;
        sessions[sessionId].qrDataUrl = null;
    }

    // Connection events
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log(`[${sessionId}] QR code generated`);
            sessions[sessionId].qr = qr;
            sessions[sessionId].status = 'QRCODE';
            try {
                sessions[sessionId].qrDataUrl = await QRCode.toDataURL(qr, { width: 300 });
            } catch (e) {
                console.error(`[${sessionId}] QR encode error:`, e.message);
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const reason = DisconnectReason[statusCode] || statusCode;
            console.log(`[${sessionId}] Connection closed: ${reason} (${statusCode})`);

            sessions[sessionId].connected = false;

            // loggedOut (401) = user disconnected intentionally
            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                console.log(`[${sessionId}] Logged out — cleaning auth state`);
                sessions[sessionId].status = 'DISCONNECTED';
                const authPath = path.join(__dirname, 'auth_sessions', sessionId);
                try { fs.rmSync(authPath, { recursive: true, force: true }); } catch(e) {}
                return;
            }

            // restartRequired (515) and other non-fatal disconnects → auto-reconnect
            // This is NORMAL after QR scan — Baileys needs one reconnect to complete the handshake
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 401;
            if (shouldReconnect) {
                const retryCount = (sessions[sessionId].retryCount || 0) + 1;
                sessions[sessionId].retryCount = retryCount;

                // Limit retries to prevent infinite loops
                if (retryCount <= 5) {
                    const delay = Math.min(retryCount * 1000, 5000);
                    console.log(`[${sessionId}] Auto-reconnecting in ${delay}ms (attempt ${retryCount})...`);
                    sessions[sessionId].status = 'RECONNECTING';

                    setTimeout(async () => {
                        try {
                            // Only reconnect if session still exists (wasn't manually disconnected)
                            if (sessions[sessionId] && !sessions[sessionId].connected) {
                                await connectSocket(sessionId, true);
                            }
                        } catch (e) {
                            console.error(`[${sessionId}] Reconnect error:`, e.message);
                            sessions[sessionId].status = 'ERROR';
                            sessions[sessionId].error = e.message;
                        }
                    }, delay);
                } else {
                    console.log(`[${sessionId}] Max retries reached, giving up`);
                    sessions[sessionId].status = 'CLOSED';
                    sessions[sessionId].retryCount = 0;
                }
            }
        }

        if (connection === 'open') {
            console.log(`[${sessionId}] Connected!`);
            sessions[sessionId].connected = true;
            sessions[sessionId].status = 'CONNECTED';
            sessions[sessionId].qr = null;
            sessions[sessionId].qrDataUrl = null;
            sessions[sessionId].retryCount = 0; // Reset on success
            sessions[sessionId].error = null;
        }
    });

    // Save credentials on update
    sock.ev.on('creds.update', saveCreds);

    // Captura erros de decrypt (Bad MAC) pra não travar o servidor
    sock.ev.on('messages.upsert', () => {}); // necessário pra Baileys não crashar
    process.removeAllListeners('uncaughtException'); // limpa listeners anteriores
    process.on('uncaughtException', (err) => {
        if (err.message?.includes('Bad MAC') || err.message?.includes('decrypt')) {
            console.warn(`[${sessionId}] Ignorando erro de decrypt:`, err.message);
            // Limpa auth corrompida e fecha socket
            const authPath = path.join(__dirname, 'auth_sessions', sessionId);
            try { fs.rmSync(authPath, { recursive: true, force: true }); } catch(e) {}
            try { sock.end(); } catch(e) {}
            sessions[sessionId] = { status: 'DISCONNECTED', connected: false, sock: null, error: 'Sessão corrompida — reconecte escaneando o QR novamente' };
        } else {
            console.error('[Server] Uncaught exception:', err);
        }
    });
}

// Health check (also serves as keepalive ping from frontend)
app.get('/', (req, res) => {
    res.json({ status: 'ok', service: 'stackos-wa-server', sessions: Object.keys(sessions).length, ts: Date.now() });
});

// Start session — creates WhatsApp connection and generates QR
app.post('/api/:session/start', auth, async (req, res) => {
    const sessionId = req.params.session;

    // If session exists and is connected, return status
    if (sessions[sessionId]?.connected) {
        return res.json({ status: 'CONNECTED', message: 'Already connected' });
    }

    // Close existing socket if any
    if (sessions[sessionId]?.sock) {
        try { sessions[sessionId].sock.end(); } catch (e) {}
    }

    try {
        // Create session object
        sessions[sessionId] = {
            qr: null,
            qrDataUrl: null,
            connected: false,
            status: 'INITIALIZING',
            sock: null,
            error: null,
            retryCount: 0
        };

        await connectSocket(sessionId, false);

        res.json({ status: 'INITIALIZING', message: 'Session starting, poll /qr for QR code' });

    } catch (e) {
        console.error(`[${sessionId}] Start error:`, e.message);
        sessions[sessionId] = { status: 'ERROR', error: e.message, connected: false };
        res.status(500).json({ status: 'ERROR', error: e.message });
    }
});

// Get QR code
app.get('/api/:session/qr', auth, (req, res) => {
    const sessionId = req.params.session;
    const session = sessions[sessionId];

    if (!session) {
        return res.json({ status: 'NOT_STARTED', qr: null });
    }

    if (session.connected) {
        return res.json({ status: 'CONNECTED', qr: null });
    }

    res.json({
        status: session.status,
        qr: session.qrDataUrl || null,
        raw: session.qr || null
    });
});

// Check connection status
app.get('/api/:session/status', auth, (req, res) => {
    const sessionId = req.params.session;
    const session = sessions[sessionId];

    if (!session) {
        return res.json({ connected: false, status: 'NOT_STARTED' });
    }

    res.json({
        connected: session.connected,
        status: session.status,
        error: session.error
    });
});

// Send text message
app.post('/api/:session/send', auth, async (req, res) => {
    const sessionId = req.params.session;
    const session = sessions[sessionId];
    const { phone, message } = req.body;

    if (!session?.sock || !session.connected) {
        return res.status(400).json({ error: 'Session not connected', code: 'NOT_CONNECTED' });
    }

    if (!phone || !message) {
        return res.status(400).json({ error: 'phone and message are required' });
    }

    try {
        // Format phone number: remove non-digits, ensure @s.whatsapp.net
        const cleanPhone = phone.replace(/\D/g, '');
        const jid = cleanPhone + '@s.whatsapp.net';
        console.log(`[${sessionId}] Sending to: ${cleanPhone} → JID: ${jid}`);

        // Verifica se o número existe no WhatsApp
        try {
            const [exists] = await session.sock.onWhatsApp(jid);
            if (!exists || !exists.exists) {
                console.warn(`[${sessionId}] Número NÃO encontrado no WhatsApp: ${cleanPhone}`);
                return res.status(400).json({
                    error: `Número ${cleanPhone} não encontrado no WhatsApp`,
                    code: 'NOT_ON_WHATSAPP',
                    phone: cleanPhone,
                    jid
                });
            }
            // Usa o JID retornado pelo WhatsApp (pode ser diferente do formatado)
            const realJid = exists.jid;
            console.log(`[${sessionId}] Número verificado OK: ${cleanPhone} → ${realJid}`);

            const result = await session.sock.sendMessage(realJid, { text: message });
            console.log(`[${sessionId}] Mensagem enviada OK: key=${result?.key?.id}`);
            res.json({ status: 'sent', phone: cleanPhone, jid: realJid, messageId: result?.key?.id });
        } catch (checkErr) {
            // Se onWhatsApp falhar (ex: sem suporte), tenta enviar direto
            console.warn(`[${sessionId}] onWhatsApp falhou (${checkErr.message}), enviando direto...`);
            const result = await session.sock.sendMessage(jid, { text: message });
            console.log(`[${sessionId}] Mensagem enviada (sem verificação): key=${result?.key?.id}`);
            res.json({ status: 'sent', phone: cleanPhone, jid, messageId: result?.key?.id, verified: false });
        }
    } catch (e) {
        console.error(`[${sessionId}] Send error:`, e.message);
        res.status(500).json({ error: e.message });
    }
});

// Send image with caption
app.post('/api/:session/send-image', auth, async (req, res) => {
    const sessionId = req.params.session;
    const session = sessions[sessionId];
    const { phone, imageUrl, caption } = req.body;

    if (!session?.sock || !session.connected) {
        return res.status(400).json({ error: 'Session not connected', code: 'NOT_CONNECTED' });
    }

    if (!phone || !imageUrl) {
        return res.status(400).json({ error: 'phone and imageUrl are required' });
    }

    try {
        const cleanPhone = phone.replace(/\D/g, '');
        const jid = cleanPhone + '@s.whatsapp.net';
        console.log(`[${sessionId}] Sending image to: ${cleanPhone} → JID: ${jid}`);

        // Verifica se o número existe no WhatsApp
        let targetJid = jid;
        try {
            const [exists] = await session.sock.onWhatsApp(jid);
            if (!exists || !exists.exists) {
                console.warn(`[${sessionId}] Número NÃO encontrado no WhatsApp: ${cleanPhone}`);
                return res.status(400).json({
                    error: `Número ${cleanPhone} não encontrado no WhatsApp`,
                    code: 'NOT_ON_WHATSAPP',
                    phone: cleanPhone
                });
            }
            targetJid = exists.jid;
            console.log(`[${sessionId}] Número verificado OK: ${cleanPhone} → ${targetJid}`);
        } catch (checkErr) {
            console.warn(`[${sessionId}] onWhatsApp falhou (${checkErr.message}), enviando direto...`);
        }

        const result = await session.sock.sendMessage(targetJid, {
            image: { url: imageUrl },
            caption: caption || ''
        });
        console.log(`[${sessionId}] Imagem enviada OK: key=${result?.key?.id}`);
        res.json({ status: 'sent', phone: cleanPhone, jid: targetJid, messageId: result?.key?.id });
    } catch (e) {
        console.error(`[${sessionId}] Send image error:`, e.message);
        res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────────────
// ÁUDIO COMO MENSAGEM DE VOZ (PTT) — rota nova, não mexe nas de texto/imagem
// Baixa o áudio (URL pública), converte pra OGG/Opus mono (formato que o
// WhatsApp exige pra mensagem de voz), calcula duração e forma de onda,
// mostra "gravando áudio…" e envia com ptt:true (não aparece "Encaminhada").
// ─────────────────────────────────────────────────────────────────────
let _ffmpegPath = null;
try { _ffmpegPath = require('ffmpeg-static'); } catch (e) { console.warn('[Audio] ffmpeg-static indisponível:', e.message); }
const { spawn } = require('child_process');

function _baixarBuffer(url, max = 8 * 1024 * 1024, redirs = 3) {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https') ? require('https') : require('http');
        lib.get(url, (r) => {
            if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && redirs > 0) {
                r.resume();
                return resolve(_baixarBuffer(new URL(r.headers.location, url).toString(), max, redirs - 1));
            }
            if (r.statusCode !== 200) { r.resume(); return reject(new Error('download status ' + r.statusCode)); }
            const chunks = []; let tam = 0;
            r.on('data', (c) => { tam += c.length; if (tam > max) { r.destroy(); reject(new Error('áudio muito grande')); } else chunks.push(c); });
            r.on('end', () => resolve(Buffer.concat(chunks)));
            r.on('error', reject);
        }).on('error', reject);
    });
}

function _ffmpeg(args, input) {
    return new Promise((resolve, reject) => {
        if (!_ffmpegPath) return reject(new Error('ffmpeg indisponível no servidor'));
        const p = spawn(_ffmpegPath, args);
        const out = []; let err = '';
        p.stdout.on('data', (c) => out.push(c));
        p.stderr.on('data', (c) => { err += c.toString(); if (err.length > 20000) err = err.slice(-20000); });
        p.on('error', reject);
        p.on('close', (code) => code === 0 ? resolve(Buffer.concat(out)) : reject(new Error('ffmpeg falhou: ' + err.slice(-300))));
        p.stdin.on('error', () => {});
        p.stdin.end(input);
    });
}

async function _prepararVoz(buf) {
    const ogg = await _ffmpeg(['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-ac', '1', '-ar', '48000',
        '-c:a', 'libopus', '-b:a', '32k', '-application', 'voip', '-f', 'ogg', 'pipe:1'], buf);
    // PCM 8 kHz pra duração e forma de onda (64 barras, 0–100)
    let seconds, waveform;
    try {
        const pcm = await _ffmpeg(['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'], ogg);
        const n = Math.floor(pcm.length / 2);
        seconds = Math.max(1, Math.round(n / 8000));
        const barras = 64, passo = Math.max(1, Math.floor(n / barras)), vals = [];
        for (let b = 0; b < barras; b++) {
            let soma = 0, cont = 0;
            for (let i = b * passo; i < Math.min(n, (b + 1) * passo); i += 4) { soma += Math.abs(pcm.readInt16LE(i * 2)); cont++; }
            vals.push(cont ? soma / cont : 0);
        }
        const mx = Math.max(...vals, 1);
        waveform = new Uint8Array(vals.map(v => Math.round((v / mx) * 100)));
    } catch (e) { console.warn('[Audio] waveform:', e.message); }
    return { ogg, seconds, waveform };
}

app.post('/api/:session/send-audio', auth, async (req, res) => {
    const sessionId = req.params.session;
    const session = sessions[sessionId];
    const { phone, audioUrl } = req.body;
    const gravandoMs = Math.max(0, Math.min(Number(req.body.gravandoMs) || 0, 8000));

    if (!session?.sock || !session.connected) {
        return res.status(400).json({ error: 'Session not connected', code: 'NOT_CONNECTED' });
    }
    if (!phone || !audioUrl) {
        return res.status(400).json({ error: 'phone and audioUrl are required' });
    }

    try {
        const cleanPhone = phone.replace(/\D/g, '');
        let targetJid = cleanPhone + '@s.whatsapp.net';
        try {
            const [exists] = await session.sock.onWhatsApp(targetJid);
            if (!exists || !exists.exists) {
                return res.status(400).json({ error: `Número ${cleanPhone} não encontrado no WhatsApp`, code: 'NOT_ON_WHATSAPP', phone: cleanPhone });
            }
            targetJid = exists.jid;
        } catch (checkErr) {
            console.warn(`[${sessionId}] onWhatsApp falhou (${checkErr.message}), enviando direto...`);
        }

        const original = await _baixarBuffer(audioUrl);
        const { ogg, seconds, waveform } = await _prepararVoz(original);

        if (gravandoMs > 0) {
            try {
                await session.sock.presenceSubscribe(targetJid);
                await session.sock.sendPresenceUpdate('recording', targetJid);
                await new Promise(r => setTimeout(r, gravandoMs));
                await session.sock.sendPresenceUpdate('paused', targetJid);
            } catch (pe) { console.warn(`[${sessionId}] presença gravando falhou:`, pe.message); }
        }

        const msg = { audio: ogg, mimetype: 'audio/ogg; codecs=opus', ptt: true };
        if (seconds) msg.seconds = seconds;
        let result;
        try {
            // Caminho com forma de onda: o Baileys sobrescreve a waveform ao montar a mídia,
            // então monta a mensagem, coloca a nossa waveform e envia (relay).
            const media = await prepareWAMessageMedia(msg, { upload: session.sock.waUploadToServer, logger: pino({ level: 'silent' }) });
            if (waveform && media.audioMessage) media.audioMessage.waveform = waveform;
            const full = generateWAMessageFromContent(targetJid, media, { userJid: session.sock.user && session.sock.user.id });
            await session.sock.relayMessage(targetJid, full.message, { messageId: full.key.id });
            result = full;
        } catch (relayErr) {
            console.warn(`[${sessionId}] áudio com waveform falhou (${relayErr.message}), enviando pelo caminho padrão`);
            result = await session.sock.sendMessage(targetJid, msg);
        }
        console.log(`[${sessionId}] Áudio (voz) enviado OK: ${cleanPhone} ${seconds || '?'}s key=${result?.key?.id}`);
        res.json({ status: 'sent', phone: cleanPhone, jid: targetJid, messageId: result?.key?.id, seconds });
    } catch (e) {
        console.error(`[${sessionId}] Send audio error:`, e.message);
        res.status(500).json({ error: e.message });
    }
});

// Disconnect session (logout — clears auth)
app.post('/api/:session/disconnect', auth, async (req, res) => {
    const sessionId = req.params.session;
    const session = sessions[sessionId];

    if (!session?.sock) {
        return res.json({ status: 'ok', message: 'No active session' });
    }

    try {
        await session.sock.logout();
    } catch (e) {
        console.log(`[${sessionId}] Logout error:`, e.message);
    }

    try { session.sock.end(); } catch (e) {}
    delete sessions[sessionId];

    res.json({ status: 'ok', message: 'Disconnected' });
});

// Close session (without logout — keeps auth for reconnect)
app.post('/api/:session/close', auth, async (req, res) => {
    const sessionId = req.params.session;
    const session = sessions[sessionId];

    if (session?.sock) {
        try { session.sock.end(); } catch (e) {}
    }
    delete sessions[sessionId];

    res.json({ status: 'ok', message: 'Session closed' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`StackOS WA Server running on port ${PORT}`);

    // Self-ping a cada 13 min pra manter Render free tier acordado
    // (Render dorme após 15 min sem requests)
    const KEEP_ALIVE_MS = 13 * 60 * 1000;
    setInterval(() => {
        const url = `http://localhost:${PORT}/`;
        require('http').get(url, (res) => {
            console.log(`[KeepAlive] Self-ping OK (${res.statusCode})`);
        }).on('error', (e) => {
            console.warn('[KeepAlive] Self-ping falhou:', e.message);
        });
    }, KEEP_ALIVE_MS);
    console.log('[KeepAlive] Self-ping ativo a cada 13min');
});
