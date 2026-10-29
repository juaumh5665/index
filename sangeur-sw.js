// StackSangeur — service worker próprio (escopo /sangeur).
// Rede primeiro: sempre a versão nova; cache só se a internet cair.
// Não intercepta nada do Supabase (pedidos sempre vão direto ao servidor).
const CACHE = 'stacksangeur-v2';
const PAGINAS = ['/sangeur.html', '/sangeur-manifest.json', '/icons/icon-sangeur-192.png', '/icons/icon-sangeur-512.png', '/icons/apple-touch-icon-sangeur.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(PAGINAS)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('stacksangeur-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!(url.pathname.startsWith('/sangeur') || url.pathname.startsWith('/icons/icon-sangeur') || url.pathname.startsWith('/icons/apple-touch-icon-sangeur'))) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(url.pathname === '/sangeur' ? '/sangeur.html' : req, cp)).catch(() => {}); }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('/sangeur.html')))
  );
});
