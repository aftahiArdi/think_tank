const CACHE = 'tt-static-v1';
const FEED_CACHE = 'tt-feed-v1';

// Endpoints we want to serve stale-while-revalidate from. These are read-only
// GET calls whose payload is safe to show instantly from disk on cold opens,
// then refresh in the background. Writes still go straight to network.
const SWR_PATHS = [
  '/api/flask/ideas',          // main feed (+ cursor pages)
  '/api/flask/ideas/starred',  // starred tab
  '/api/flask/categories',     // category list
];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e =>
  e.waitUntil(
    (async () => {
      // Drop any old feed caches on SW update so a schema change doesn't serve
      // stale shapes forever.
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(n => n !== CACHE && n !== FEED_CACHE)
          .map(n => caches.delete(n)),
      );
      await clients.claim();
    })(),
  ),
);

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Only handle same-origin GET requests
  if (url.origin !== location.origin || e.request.method !== 'GET') return;

  // Stale-while-revalidate for whitelisted JSON endpoints. Serves the cached
  // copy instantly on cold opens, then updates the cache in the background so
  // the next open sees fresher data. Writes bypass this (method !== GET above).
  if (SWR_PATHS.some(p => url.pathname === p || url.pathname.startsWith(p + '?'))) {
    e.respondWith(
      caches.open(FEED_CACHE).then(async cache => {
        const cached = await cache.match(e.request);
        const network = fetch(e.request)
          .then(res => {
            // Only cache successful responses — 401/500 should not poison the cache.
            if (res.ok) cache.put(e.request, res.clone());
            return res;
          })
          .catch(() => cached); // offline fallback: keep showing the stale copy
        return cached || network;
      }),
    );
    return;
  }

  // Skip other API routes — always go to network
  if (url.pathname.startsWith('/api/')) return;

  // Cache-first for Next.js static chunks (content-hashed, safe to cache forever)
  if (url.pathname.startsWith('/_next/static/')) {
    e.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(e.request).then(res => {
            cache.put(e.request, res.clone());
            return res;
          });
        })
      )
    );
    return;
  }

  // Cache-first for icons and manifest
  if (
    url.pathname === '/manifest.json' ||
    url.pathname.startsWith('/icon') ||
    url.pathname === '/apple-touch-icon.png'
  ) {
    e.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(e.request).then(res => {
            cache.put(e.request, res.clone());
            return res;
          });
        })
      )
    );
    return;
  }

  // Everything else (HTML navigation) — network only, no caching
  // Auth middleware needs to run server-side on every navigation
});
