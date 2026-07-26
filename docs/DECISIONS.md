# Decisions

## Stationary does not imply cause

Stationary events intentionally carry no cause classification. A stop can be
fuel, traffic, repairs, food, a checkpoint, an obstruction, or something else.

## Radius and hysteresis

The qualifying cluster uses a 150-meter radius. Exit uses a wider 190-meter
boundary plus two consecutive outside breadcrumbs. This prevents ordinary GPS
jitter from repeatedly opening and closing the same continuous stop.

## Stable identity and persistence

The event key is `rallyEventId:competitorId:startTime`. Reprocessing history
updates that record instead of creating another one. Completed records remain in
the local project even if the source breadcrumb window is later truncated.

## Nearby markers

Stationary events are not semantically clustered. Small deterministic display
offsets keep overlapping 48px signature markers independently tappable while
all calculations and zoom actions retain the true event center.

## Repository-managed browser dependencies

Leaflet 1.9.4, Leaflet-Geoman 2.18.3, SheetJS 0.18.5, and Firebase 8.10.0 are
exact pnpm dependencies. A reproducible vendoring script copies their browser
distributions to `vendor/`, which is committed so static hosting and offline
installation do not require a build server or CDN access.

Leaflet and Geoman are required because the current application shell always
creates a map and installs planner controls. SheetJS and Firebase are optional:
their feature entry points provide focused errors, while Planner Mode, Rally
Mode, imports, and the offline shell remain available.

Service-worker registration begins before optional integration checks. Readiness
is successful only after required dependency validation and application
initialization. A required failure is explicit and observable rather than a
timeout or an unhandled `L is not defined` exception.
# M6 — server-only ingress with local-first capture

**Decision:** Keep the M5 IndexedDB/outbox path authoritative and make secure upload a separate, default-off application adapter. Require all remote writes to cross an authenticated, App-Check-protected Cloud Function; Realtime Database clients receive no direct write permission.

**Reason:** This preserves offline Rally behavior, keeps Firebase state out of normalized evidence records, centralizes validation and abuse controls, and prevents a compromised client from writing validated or derived intelligence. Deterministic owner-scoped receipts provide idempotency without making observations mutable.
