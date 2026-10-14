const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const pino = require('pino');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY || 'StackOS2024WPP';

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

// Health check
app.get('/', (req, res) => {
    res.json({ status: 'ok', service: 'stackos-wa-server', sessions: Object.keys(sessions).length });
});

// Start session — creates WhatsApp connection and generates QR
app.post('/api/:session/start', auth, async (req, res) => {
    const sessionId = req.params.session;

    // If session exists and is connected, return status
    if (sessions[sessionId]?.connected) {
        return res.json({ status: 'CONNECTED', message: 'Already connected' });
    }

    // Close existing session if any
    if (sessions[sessionId]?.sock) {
        try { sessions[sessionId].sock.end(); } catch (e) {}
    }

    // Clean auth state if previous session was CLOSED/ERROR (forces new QR)
    const authDir = path.join(__dirname, 'auth_sessions', sessionId);
    if (sessions[sessionId]?.status === 'CLOSED' || sessions[sessionId]?.status === 'ERROR' || req.query.clean === '1') {
        try {
            if (fs.existsSync(authDir)) {
                fs.rmSync(authDir, { recursive: true, force: true });
                console.log(`[${sessionId}] Cleaned auth state for fresh QR`);
            }
        } catch (e) {
            console.log(`[${sessionId}] Auth cleanup error:`, e.message);
        }
    }

    try {
        // Create session object
        sessions[sessionId] = {
            qr: null,
            qrDataUrl: null,
            connected: false,
            status: 'INITIALIZING',
            sock: null,
            error: null
        };

        const { state, saveCreds } = await useMultiFileAuthState(`./auth_sessions/${sessionId}`);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: true,
            logger: pino({ level: 'silent' }),
            browser: ['StackOS', 'Chrome', '10.0'],
            connectTimeoutMs: 60000,
            qrTimeout: 60000,
        });

        sessions[sessionId].sock = sock;

        // QR code event
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

                // loggedOut (401) = user disconnected intentionally, don't reconnect
                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    sessions[sessionId].status = 'DISCONNECTED';
                    // Clean auth so next start gets fresh QR
                    const authPath = path.join(__dirname, 'auth_sessions', sessionId);
                    try { fs.rmSync(authPath, { recursive: true, force: true }); } catch(e) {}
                } else {
                    sessions[sessionId].status = 'CLOSED';
                }
            }

            if (connection === 'open') {
                console.log(`[${sessionId}] Connected!`);
                sessions[sessionId].connected = true;
                sessions[sessionId].status = 'CONNECTED';
                sessions[sessionId].qr = null;
                sessions[sessionId].qrDataUrl = null;
            }
        });

        // Save credentials on update
        sock.ev.on('creds.update', saveCreds);

        // Return immediately — QR will be available via /qr endpoint
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

// Send message
app.post('/api/:session/send', auth, async (req, res) => {
    const sessionId = req.params.session;
    const session = sessions[sessionId];
    const { phone, message } = req.body;

    if (!session?.sock || !session.connected) {
        return res.status(400).json({ error: 'Session not connected' });
    }

    if (!phone || !message) {
        return res.status(400).json({ error: 'phone and message are required' });
    }

    try {
        // Format phone number: remove non-digits, ensure @s.whatsapp.net
        const jid = phone.replace(/\D/g, '') + '@s.whatsapp.net';
        await session.sock.sendMessage(jid, { text: message });
        res.json({ status: 'sent', phone, jid });
    } catch (e) {
        console.error(`[${sessionId}] Send error:`, e.message);
        res.status(500).json({ error: e.message });
    }
});

// Disconnect session
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
});
