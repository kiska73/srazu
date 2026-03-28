const CACHE_NAME = "srazu-v8";

self.addEventListener("install", event => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {

  // HTML sempre fresco
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request));
    return;
  }

  // JS sempre aggiornato
  if (event.request.url.includes("app.js")) {
    event.respondWith(fetch(event.request));
    return;
  }

  // CSS sempre aggiornato
  if (event.request.url.includes("style.css")) {
    event.respondWith(fetch(event.request));
    return;
  }

  // tutto il resto usa cache
  event.respondWith(
    caches.match(event.request).then(r => r || fetch(event.request))
  );

});
