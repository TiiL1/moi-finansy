/* Офлайн-оболочка «Моих финансов»: страница открывается и без интернета, данные потом синхронизирует Firebase. */
const CACHE = 'moi-finansy-v6';
const SHELL = ['./', './index.html', './firebase-config.txt', './cloud.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  const sdk = u.origin === 'https://www.gstatic.com' && u.pathname.startsWith('/firebasejs/');
  if (u.origin !== self.location.origin && !sdk) return;   // запросы к базе и Google не трогаем
  // сначала сеть (чтобы обновления доходили сразу), без сети — сохранённая копия
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); } return r; })
    .catch(() => caches.match(e.request).then(m => m || caches.match('./index.html'))));
});
