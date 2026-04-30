// Momentum Matrix — Service Worker
// Bump CACHE_NAME on every deploy to force cache refresh for returning users.
const CACHE_NAME = 'mm-v25.4.1';

const STATIC_FILES = [
  './',
  './index.html',
  './styles.css',
  './logic.js',
  './storage.js',
  './app.js',
  './copy.js',
  './manifest.json'
];

// Install: cache all static files
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_FILES))
  );
  self.skipWaiting();
});

// Activate: delete old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: try network first, fall back to cache (ensures fresh deploys load immediately)
self.addEventListener('fetch', event => {
  // Only handle same-origin requests (skip Google Fonts etc.)
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Update cache with fresh response
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
