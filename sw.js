const CACHE_VERSION = "korean-visual-vocab-v1.5.0";
const FSRS_MODULE = "https://cdn.jsdelivr.net/npm/ts-fsrs@5.4.1/+esm";

const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./bulk-import.js",
  "./bulk-template.csv",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./favicon.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(async cache => {
      await cache.addAll(APP_SHELL);
      // FSRS is optional during installation so a temporary CDN issue does not break the PWA install.
      try { await cache.add(FSRS_MODULE); } catch {}
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key.startsWith("korean-visual-vocab-") && key !== CACHE_VERSION).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Navigation: network first, app-shell fallback.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Pinned FSRS dependency: cache first for reliable offline use after first successful load.
  if (event.request.url === FSRS_MODULE) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(event.request, copy));
          return response;
        });
      })
    );
    return;
  }

  // Same-origin assets: cache first, refresh in background.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const network = fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(event.request, copy));
          }
          return response;
        }).catch(() => cached);

        return cached || network;
      })
    );
  }
});
