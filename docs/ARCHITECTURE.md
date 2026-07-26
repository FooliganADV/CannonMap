# Architecture

## Stationary-event pipeline

`stationary-events.js` is a dependency-free detection and geometry module.
`app.js` invokes it after breadcrumb merges and stores results in
`project.stationaryEvents`.

The detector sorts timestamped breadcrumb history, grows a continuous cluster,
and verifies that every clustered point stays within 150 meters of the first
position in that cluster. An event becomes visible at 180 seconds. The stable event ID combines
rally event, competitor, and cluster start time, preventing duplicate records.

Exit handling uses hysteresis: a single outlier does not close the event. Two
consecutive points beyond 190 meters close it at the last in-cluster timestamp.
Completed events are merged back into local state even when their old
breadcrumbs later age out.

Leaflet renders stationary events in a separate overlay. Nearby icons receive
small deterministic display offsets while their event centers remain unchanged.
Popup zoom always uses the true center and does not alter the base-layer choice.

## Browser runtime dependencies

Browser-ready third-party assets are generated from exact pnpm dependencies by
`scripts/vendor-dependencies.mjs` and committed under `vendor/`. `index.html`
loads only these local copies:

| Dependency | Version | Runtime role |
| --- | --- | --- |
| Leaflet | 1.9.4 | Required for map creation and all map-backed modes |
| Leaflet-Geoman | 2.18.3 | Required for planner drawing and map initialization |
| SheetJS | 0.18.5 | Optional, used only for Excel manifest export |
| Firebase | 8.10.0 | Optional, used only when the GPS Checkpoints live feed starts |

The script order is Leaflet, Geoman, SheetJS, Firebase App, Firebase Database,
the live-feed adapter, stationary-event logic, and `app.js`. The vendored Geoman
wrapper does not execute if Leaflet is absent, allowing `app.js` to publish a
specific startup diagnostic instead of generating an unhandled global error.

`startApplication()` registers the service worker before checking integrations.
It then validates required dependencies, records optional omissions, initializes
the base application, and finally publishes
`data-cannonmap-startup-state="ready"` and `data-cannonmap-ready="true"`.
Required failures publish `failed`, `false`, and a comma-separated
`data-cannonmap-missing-dependencies` value.

The service-worker application shell includes every local dependency asset and
Leaflet image. Live Firebase database responses, map tiles, weather, and traffic
data are runtime network data and are not part of the static application shell.

## Rider visibility preferences

`rider-preferences.js` owns a versioned, event-scoped local preference document.
The UI asks the store for `{markerVisible, breadcrumbVisible, selected}` by
event ID and competitor ID. Defaults are marker on, breadcrumb off, and not
selected.

The preference store is separate from normalized Firebase/feed records,
Firebase listener lifecycle, Leaflet layer references, and stationary-event
state. `app.js` renders Rider Manager cards and projects preferences into a
short-lived `competitorLayers` map. Opening or closing the panel performs no
feed operation, so it cannot add Firebase subscriptions.

Removed riders remain in persisted preference state. `ensure()` adds defaults
for new IDs without replacing existing entries. Version 1 storage uses:

```json
{"version":1,"events":{"60":{"7":{"markerVisible":true,"breadcrumbVisible":false,"selected":false}}}}
```
