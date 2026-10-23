/* Service worker: cache tampilan aplikasi supaya cepat dibuka & bisa di-install.
   Data tidak pernah di-cache: permintaan ke Apps Script selalu langsung ke server. */
const VERSION = 'dbrek-v1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'assets/css/app.css', 'assets/js/config.js', 'assets/js/parser.js', 'assets/js/app.js',
  'assets/img/hero.webp', 'assets/img/hero.jpg',
  'assets/fonts/lexend-latin-wght-normal.woff2', 'assets/fonts/lexend-latin-ext-wght-normal.woff2',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'
];
const CDN = ['https://cdnjs.cloudflare.com/'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // POST ke Apps Script tidak disentuh
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const cdn = CDN.some(p => req.url.startsWith(p));
  if (!sameOrigin && !cdn) return;
  if (sameOrigin && (req.mode === 'navigate' || url.pathname.endsWith('.js') || url.pathname.endsWith('.css'))) {
    // network-first untuk kode: perubahan langsung terpakai, offline pakai cache
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return res; })
      .catch(() => caches.match(req).then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
    return;
  }
  // cache-first untuk gambar, ikon, font, pdf.js
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return res;
  })));
});
