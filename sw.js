const CACHE_NAME = "srazu-static-v1";

/* install */
self.addEventListener("install", event => {
  self.skipWaiting();
});

/* activate - cancella cache vecchie */
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

/* fetch */
self.addEventListener("fetch", event => {

  const req = event.request;
  const url = new URL(req.url);

  /* HTML sempre aggiornato */
  if (req.mode === "navigate") {
    event.respondWith(fetch(req));
    return;
  }

  /* JS e CSS sempre aggiornati */
  if (
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css")
  ) {
    event.respondWith(fetch(req));
    return;
  }

  /* immagini e asset → cache */
  if (
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".jpg") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".woff2")
  ) {
    event.respondWith(
      caches.match(req).then(res => {
        return res || fetch(req).then(fetchRes => {
          const copy = fetchRes.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
          return fetchRes;
        });
      })
    );
    return;
  }

});
