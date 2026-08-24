// Service worker: installable app shell + offline caching.
// Deliberately never intercepts /api/* (auth, data, and audio streaming with
// Range requests) — those always go straight to the network.
const CACHE = 'gaanasudha-v6';
const SHELL = [
  '/',
  '/index.html',
  '/login.html',
  '/practice.html',
  '/css/style.css',
  '/js/app.js',
  '/js/cms-client.js',
  '/js/login.js',
  '/js/practice-tools.js',
  '/js/pitch-shift-worklet.js',
  '/js/studio.js',
  '/js/denoise-worklet.js',
  '/manifest.json',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // never cache API / streams / auth
  // /cms/theme.css is the live CMS theme — always fetch fresh so branding/colour
  // changes take effect immediately instead of one page-load late.
  if (url.pathname.startsWith('/cms/')) return;

  // Stale-while-revalidate for same-origin static assets.
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
