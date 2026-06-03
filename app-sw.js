// =====================================================================
// StackOS APP — Service Worker (PWA Painel do Dono)
// =====================================================================
// ARQUIVO DEDICADO ao app.html. NÃO substitui /sw.js (StackClock).
// Escopo: /app.html (registrado com scope: '/app.html')
//
// Estratégia conservadora:
//   - Cache do app shell (HTML/ícones) para abrir offline
//   - Para Supabase API: NUNCA cacheia (sempre vai pra rede)
//   - Para imagens estáticas: cache + revalida em background
//   - Skip activate imediato pra atualizar versão sem F5
//
// IMPORTANTE: NÃO cacheia chamadas pro Supabase (dados sempre frescos)
//             NÃO cacheia POST/PUT/DELETE (não corrompe escritas)
// =====================================================================

const CACHE_NAME = 'stackos-app-v1';
const SHELL = [
    '/app.html',
    '/app-manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/apple-touch-icon.png',
];

// INSTALL: cacheia o app shell
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW StackOS] Caching app shell');
                return Promise.all(SHELL.map((url) => {
                    return cache.add(url).catch((err) => {
                        console.warn('[SW StackOS] Falha ao cachear', url, err);
                    });
                }));
            })
            .then(() => self.skipWaiting())
    );
});

// ACTIVATE: limpa caches antigos
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((k) => k !== CACHE_NAME && k.startsWith('stackos-app'))
                    .map((k) => caches.delete(k))
            );
        }).then(() => self.clients.claim())
    );
});

// FETCH: estratégia por tipo
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 1. NUNCA cachear chamadas pra Supabase / APIs externas
    if (url.hostname.includes('supabase') || url.pathname.startsWith('/api/')) {
        return; // deixa a rede tratar
    }

    // 2. NUNCA cachear POST/PUT/DELETE
    if (event.request.method !== 'GET') {
        return;
    }

    // 3. SÓ INTERCEPTAR recursos do app.html ou ícones/manifest
    //    (outros HTMLs como clock.html, bar.html, index.html: deixa passar)
    const ehDoApp =
        url.pathname === '/app.html' ||
        url.pathname.endsWith('/app.html') ||
        url.pathname === '/app-manifest.json' ||
        url.pathname.startsWith('/icons/');

    if (!ehDoApp) {
        return; // não intercepta — deixa o navegador (ou outro SW) cuidar
    }

    // 4. App shell: cache-first com background update
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            const fetchPromise = fetch(event.request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const respClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, respClone);
                    });
                }
                return networkResponse;
            }).catch(() => null);

            return cachedResponse || fetchPromise || new Response('Offline', {
                status: 503,
                statusText: 'Offline e sem cache desse recurso'
            });
        })
    );
});

// MESSAGE: permite o app pedir update
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
