// Service Worker for VisualTrendHub — v2
// Strategy: Network-first for ALL requests (always fresh data)
// Falls back to cache only when offline

const CACHE_NAME = 'vth-cache-v2';

self.addEventListener('install', event => {
    self.skipWaiting(); // Activate immediately
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    event.respondWith(
        fetch(event.request)
            .then(response => {
                // Cache successful responses for offline fallback
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            })
            .catch(() => caches.match(event.request)) // Offline fallback
    );
});
