// ====================== SRAZU SERVICE WORKER v3 (MARZO 2026) ======================

const CACHE_NAME = 'srazu-v8';   // cambio versione per forzare update

const CORE_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/site.webmanifest',
  '/apple-touch-icon.png',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  '/android-chrome-192x192.png',
  '/android-chrome-512x512.png',
  '/favicon.ico'
];


// ====================== INSTALL ======================

self.addEventListener('install', event => {

  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('✅ SRAZU SW: Cache creata');
      return cache.addAll(CORE_ASSETS);
    })
  );

  self.skipWaiting();

});


// ====================== ACTIVATE ======================

self.addEventListener('activate', event => {

  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      );
    })
  );

  self.clients.claim();

});


// ====================== FETCH ======================

self.addEventListener('fetch', event => {

  const request = event.request;

  // ⚠️ Ignora richieste non http/https (chrome-extension ecc)
  if (!request.url.startsWith('http')) {
    return;
  }

  event.respondWith(

    fetch(request)
      .then(networkResponse => {

        if (!networkResponse || networkResponse.status !== 200) {
          return networkResponse;
        }

        const responseClone = networkResponse.clone();

        caches.open(CACHE_NAME).then(cache => {
          cache.put(request, responseClone);
        });

        return networkResponse;

      })

      .catch(() => {

        return caches.match(request).then(cached => {

          if (cached) return cached;

          return caches.match('/index.html');

        });

      })

  );

});
