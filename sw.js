// StackClock — Service Worker
// Versão mínima: existência satisfaz o critério do Chrome pra "Add to Home Screen"
// e cacheia recursos críticos pra abrir mais rápido.

const CACHE_NAME = 'stackclock-v1';
const PRECACHE = [
  '/clock.html',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // estratégia: network-first com fallback pra cache
  // (assim sempre puxa versão nova quando online; offline usa cache)
  const req = event.request;

  // não interceptar requisições para Supabase (precisam ser sempre online)
  if (req.url.includes('supabase.co') || req.url.includes('supabase.io')) {
    return; // deixa o navegador resolver normalmente
  }

  // só GET
  if (req.method !== 'GET') return;

  event.respondWith(
    fetch(req)
      .then(resp => {
        // se OK, salva no cache
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const respClone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, respClone)).catch(() => {});
        }
        return resp;
      })
      .catch(() => caches.match(req).then(c => c || new Response('Offline', { status: 503 })))
  );
});
