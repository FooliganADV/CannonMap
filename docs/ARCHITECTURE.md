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
# M6 secure-ingestion boundary

M6 adds an optional upload path without changing IndexedDB authority. `observation-capture` continues to append the normalized M5 record and outbox item locally. When both capture and `architecture.auth.secure-ingestion` are enabled, `secure-observation-upload` reads that record through the existing observation repository, validates it, obtains Firebase Authentication/App Check credentials through an infrastructure adapter, and sends it through the HTTP ingress adapter. A successful server receipt is then acknowledged by the existing outbox replay seam.

The Cloud Function authenticates the caller, verifies App Check, validates the complete observation, reserves the deterministic idempotency receipt, consumes a per-user/event quota, and performs an immutable server-side ingress write. Realtime Database rules default-deny all unspecified paths. Clients may read only their own ingress and receipts; Admin SDK code is the sole writer. No M7 commitment, route-family, compatibility, crowd, checkpoint-intelligence, publication, recommendation, or evaluation component is present.
# M7 Commitment Engine

`src/domain/commitment` is a deterministic domain service over validated recent observations, checkpoint geometry, and a caller-provided clock. It creates immutable ledger records for the observed inputs and a separate `assertionKind: inferred` commitment record. Confidence remains dimensional (`evidenceStrength`, `spatialConsistency`, and `temporalConsistency`); M7 does not introduce the M9 Confidence Evolution model or an aggregate score.

The `inferCommitment` Realtime Database create trigger reads validated observations and checkpoint geometry through a server repository, evaluates all relevant checkpoints, persists the strongest explainable inference and immutable evidence, and records a shadow diagnostic. Deterministic trace, evidence, and inference IDs make trigger replay idempotent. A head pointer and `supersededBy`/`supersedes` links preserve revision history without rewriting evidence.

The browser application, Rally presenters, routes, publications, and notification paths do not import or read commitment output. The Cloud Functions deployment packages an exact validated copy of the canonical domain modules so the deployed source remains self-contained.
