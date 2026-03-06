// C2: Service Worker for caching trends.json
const CACHE_NAME = 'vth-cache-v1';
const CACHE_URLS = [
    './',
    './index.html',
    './index.css',
    './index.js',
    './data/trends.json'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(CACHE_URLS))
    );
    self.skipWaiting();
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
    const url = new URL(event.request.url);

    // For trends.json: network-first strategy (always try fresh data, fallback to cache)
    if (url.pathname.endsWith('trends.json')) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // For everything else: cache-first strategy
    event.respondWith(
        caches.match(event.request).then(cached => cached || fetch(event.request))
    );
});
