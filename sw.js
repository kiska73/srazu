const CACHE_NAME = 'srazu-v7';
self.addEventListener('fetch', event => {
  if (event.request.url.includes('app.js')) {
    event.respondWith(
      fetch(event.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, copy));
        return res;
      }).catch(() => caches.match(event.request))
    );
    return;
  }
  event.respondWith(caches.match(event.request).then(r => r || fetch(event.request)));
});
