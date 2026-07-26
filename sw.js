const CACHE = 'cannonmap-v0.7.1-20260726-02';
const APP_SHELL = [
  './',
  './index.html',
  './app.css',
  './gps-checkpoints-feed.js?v=20260725-02',
  './stationary-events.js?v=20260725-01',
  './app.js?v=20260726-01',
  './src/core/clock.js',
  './src/core/compatibility.js',
  './src/core/errors.js',
  './src/core/event-bus.js',
  './src/core/ids.js',
  './src/core/state-store.js',
  './src/domain/geo/geometry.js',
  './src/infrastructure/indexeddb/index.js',
  './src/infrastructure/indexeddb/migration-runner.js',
  './src/infrastructure/indexeddb/observation-outbox.js',
  './src/infrastructure/indexeddb/repositories.js',
  './src/infrastructure/indexeddb/request.js',
  './src/infrastructure/indexeddb/schema.js',
  './manifest.webmanifest',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/layers-2x.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-shadow.png',
  './vendor/leaflet-geoman/leaflet-geoman.min.js',
  './vendor/leaflet-geoman/leaflet-geoman.css',
  './vendor/xlsx/xlsx.full.min.js',
  './vendor/firebase/firebase-app.js',
  './vendor/firebase/firebase-database.js'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => {
      const copy=response.clone();caches.open(CACHE).then(cache=>cache.put('./index.html',copy));return response;
    }).catch(()=>caches.match('./index.html')));
    return;
  }
  event.respondWith(fetch(event.request).then(response => {
    const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response;
  }).catch(()=>caches.match(event.request)));
});
