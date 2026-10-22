// Service worker: makes the app open fast and work offline.
// Strategy: network first (so a new deploy shows up on the very next open), falling back to
// the cache if the network is slow (>2.5 s) or offline. Requests to other origins (the Apps
// Script) are never touched.
const CACHE = 'eh-shell-v7';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/app.js', 'js/model.js', 'js/store.js', 'js/api.js', 'js/mock-data.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const network = fetch(e.request).then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; });
    const cached = await cache.match(e.request, { ignoreSearch: true });
    if (!cached) return network;
    const timeout = new Promise((r) => setTimeout(() => r(cached), 2500));
    return Promise.race([network.catch(() => cached), timeout]);
  })());
});
