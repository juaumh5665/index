// StackFloor — service worker próprio (escopo /floor).
// Rede primeiro: sempre a versão nova; cache só se a internet cair.
// Não intercepta nada do Supabase (pedidos sempre vão direto ao servidor).
const CACHE = 'stackfloor-v1';
const PAGINAS = ['/floor.html', '/floor-manifest.json', '/icons/icon-floor-192.png', '/icons/icon-floor-512.png', '/icons/apple-touch-icon-floor.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(PAGINAS)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('stackfloor-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!(url.pathname.startsWith('/floor') || url.pathname.startsWith('/icons/icon-floor') || url.pathname.startsWith('/icons/apple-touch-icon-floor'))) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(url.pathname === '/floor' ? '/floor.html' : req, cp)).catch(() => {}); }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('/floor.html')))
  );
});
