const CACHE = 'cannonmap-v0.7.1-20260727-m11d';
const APP_SHELL = [
  './',
  './index.html',
  './app.css',
  './gps-checkpoints-feed.js?v=20260725-02',
  './stationary-events.js?v=20260725-01',
  './app.js?v=20260727-m11d',
  './src/core/clock.js',
  './src/core/compatibility.js',
  './src/core/errors.js',
  './src/core/feature-flags.js',
  './src/core/ids.js',
  './src/domain/geo/geometry.js',
  './src/domain/checkpoints/workflow.js',
  './src/application/project-workflows.js',
  './src/application/observation-capture.js',
  './src/application/secure-observation-upload.js',
  './src/infrastructure/indexeddb/index.js',
  './src/infrastructure/firebase/authentication.js',
  './src/infrastructure/firebase/observation-ingress-client.js',
  './src/ui/map/map-engine.js',
  './src/ui/project/controller.js',
  './src/ui/rally/controller.js',
  './src/ui/rally/presenter.js',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet-geoman/leaflet-geoman.css',
  './vendor/leaflet-geoman/leaflet-geoman.min.js',
  './vendor/xlsx/xlsx.full.min.js',
  './vendor/firebase/firebase-app.js',
  './vendor/firebase/firebase-database.js',
  './vendor/firebase/firebase-auth.js',
  './vendor/firebase/firebase-app-check.js',
  './manifest.webmanifest'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      const clone = response.clone();
      if (response.ok && event.request.url.startsWith(self.location.origin)) {
        caches.open(CACHE).then(cache => cache.put(event.request, clone));
      }
      return response;
    }).catch(() => cached))
  );
});
