const CACHE = 'cannonmap-v0.8.2-20260722-10';
const APP_SHELL = ['./', './index.html', './app.css?v=20260722-10', './app.js?v=20260722-10', './planner.js?v=20260722-10', './manifest.webmanifest', './vendor/leaflet.css', './vendor/leaflet.js', './vendor/leaflet-geoman.css', './vendor/leaflet-geoman.min.js', './vendor/xlsx.full.min.js', './vendor/images/layers.png', './vendor/images/layers-2x.png', './vendor/images/marker-icon.png', './vendor/images/marker-icon-2x.png', './vendor/images/marker-shadow.png'];
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
