const CACHE_NAME = 'srazu-v7';

const CORE_ASSETS = [
  '/', '/index.html', '/style.css', '/app.js', '/site.webmanifest',
  '/apple-touch-icon.png', '/favicon-32x32.png', '/favicon-16x16.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(r => r || fetch(event.request))
      .catch(() => caches.match('/index.html'))
  );
});
