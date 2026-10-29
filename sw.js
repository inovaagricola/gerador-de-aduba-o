const VERSAO = 'ga-app-2026-10-28';
const CDN = 'ga-cdn-v1';
const SHELL = ['./', './index.html', './app.js', './config.js', './manifest.webmanifest', './logo0.png', './logo1.png', './logo2.png', './icon-192.png', './icon-512.png'];
const CDN_HOSTS = ['www.gstatic.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSAO).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('ga-app-') && k !== VERSAO).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (CDN_HOSTS.includes(url.hostname)) {           // bibliotecas e fontes: guarda a primeira vez
    e.respondWith(caches.open(CDN).then(async c => { const hit = await c.match(req); if (hit) return hit;
      const res = await fetch(req); if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }));
    return;
  }
  if (url.origin === location.origin) {             // arquivos do app: tenta a versão nova, senão usa a guardada
    e.respondWith(fetch(req).then(res => { if (res.ok) caches.open(VERSAO).then(c => c.put(req, res.clone())); return res; })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html'))));
  }
});
