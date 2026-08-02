/* Network-first, cache-fallback.
   Cache-first with a fixed cache name would pin the phone to whatever it downloaded
   the first time — every redeploy would be invisible. This way: online gets the
   latest, offline still works from the last good copy. */
const C = 'plate-v12';

// NOT 'index.html': vercel.json cleanUrls 308-redirects it, and cache.put()
// throws TypeError on a redirected response, which would fail the whole install.
const FILES = ['./', 'data.js', 'app.js', 'manifest.json', 'icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(C).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Cache API rejects chrome-extension:, data:, blob: — browser extensions fire these
  // through the SW and every one of them threw before this guard.
  const scheme = new URL(e.request.url).protocol;
  if (scheme !== 'http:' && scheme !== 'https:') return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.ok && !res.redirected) {
          const copy = res.clone();
          caches.open(C).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./')))
  );
});
