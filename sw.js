const CACHE = 'cannonmap-v0.7.1-20260803-rally-stabilization-01';
const APP_SHELL = [
  './',
  './index.html',
  './app.css',
  './gps-checkpoints-feed.js?v=20260725-02',
  './stationary-events.js?v=20260725-01',
  './app.js?v=20260727-m11g',
  './src/core/clock.js',
  './src/core/compatibility.js',
  './src/core/errors.js',
  './src/core/event-bus.js',
  './src/core/feature-flags.js',
  './src/core/ids.js',
  './src/core/state-store.js',
  './src/domain/geo/geometry.js',
  './src/domain/projects/model.js',
  './src/domain/projects/lifecycle.js',
  './src/domain/projects/errors.js',
  './src/domain/templates/model.js',
  './src/domain/templates/errors.js',
  './src/domain/templates/built-ins.js',
  './src/domain/backup/archive.js',
  './src/domain/backup/errors.js',
  './src/domain/journal/model.js',
  './src/domain/search/index.js',
  './src/domain/checkpoints/workflow.js',
  './src/domain/checkpoints/arrival.js',
  './src/domain/observations/contract.js',
  './src/domain/observations/ingestion-contract.js',
  './src/domain/observations/quality.js',
  './src/domain/observations/sampling.js',
  './src/domain/observations/state-machine.js',
  './src/domain/analytics/engine.js',
  './src/application/project-workflows.js',
  './src/application/observation-capture.js',
  './src/application/rally-analytics-service.js',
  './src/application/rally-journal-service.js',
  './src/application/search-service.js',
  './src/application/project-repository-scope.js',
  './src/application/project-lifecycle-manager.js',
  './src/application/project-backup-service.js',
  './src/application/project-template-service.js',
  './src/application/checkpoint-camera-workflow.js',
  './src/application/gps-follow-controller.js',
  './src/application/rally-debug-log.js',
  './src/application/ride-export-source.js',
  './src/application/secure-observation-upload.js',
  './src/infrastructure/indexeddb/index.js',
  './src/infrastructure/indexeddb/analytics-repository.js',
  './src/infrastructure/indexeddb/confidence-vector-repository.js',
  './src/infrastructure/indexeddb/intelligence-repository.js',
  './src/infrastructure/indexeddb/journal-repository.js',
  './src/infrastructure/indexeddb/search-repository.js',
  './src/infrastructure/indexeddb/project-lifecycle-repository.js',
  './src/infrastructure/indexeddb/legacy-current-project-repository.js',
  './src/infrastructure/indexeddb/project-deletion-repository.js',
  './src/infrastructure/indexeddb/backup-repository.js',
  './src/infrastructure/indexeddb/template-repository.js',
  './src/infrastructure/indexeddb/mission-media-repository.js',
  './src/infrastructure/indexeddb/migration-runner.js',
  './src/infrastructure/indexeddb/observation-capture-repository.js',
  './src/infrastructure/indexeddb/observation-outbox.js',
  './src/infrastructure/indexeddb/project-repository.js',
  './src/infrastructure/indexeddb/repositories.js',
  './src/infrastructure/indexeddb/request.js',
  './src/infrastructure/indexeddb/schema.js',
  './src/infrastructure/firebase/authentication.js',
  './src/infrastructure/firebase/observation-ingress-client.js',
  './shared/contracts/confidence-vector.js',
  './src/ui/map/map-engine.js',
  './src/ui/map/layer-registry.js',
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
