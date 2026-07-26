# CannonMap Implementation Baseline

Recorded: 2026-07-26  
Milestone: M0  
Branch: `agent/architecture-baseline-m0`  
Commit at inspection: `61a9e885c20bfb18537d1d25550abfc917247c7b`  
Upstream: `origin/main` at the same commit  
Working tree at inspection: clean

This baseline is the behavior and repository checkpoint for evolutionary
implementation of the approved CannonMap Software Architecture Specification
Version 1.0 and Implementation Roadmap Version 2.0. M0 adds documentation and
engineering enforcement only. It does not change production behavior.

## Repository structure

```text
/
  app.js                         1,409-line composition root
  index.html                     application shell and DOM
  app.css                        application and responsive styling
  gps-checkpoints-feed.js        optional GPS Checkpoints integration
  stationary-events.js           stationary-event domain/geometry module
  sw.js                          service worker
  manifest.webmanifest           PWA manifest
  vendor/                        pinned browser runtime assets
  scripts/
    vendor-dependencies.mjs      generates committed vendor assets
    validate-vendor.mjs          validates assets and CDN independence
  tests/
    *.test.mjs                   Node/unit tests
    browser/*.spec.mjs           Playwright browser tests
    fixtures/                    test projects
  docs/                          requirements, architecture, QA, decisions
```

The expected Version 2.0 `src/`, `shared/`, `functions/`, and expanded test
layout does not exist yet. It must be introduced incrementally after M0.

## Existing production modules

- `app.js`: composition, state, startup, DOM wiring, Leaflet map, project
  persistence, imports/exports, Rally Mode, competitor display, weather,
  radar, traffic, and external integration orchestration.
- `gps-checkpoints-feed.js`: GPS Checkpoints REST metadata, Firebase listener
  ownership, normalization, standings, listener cleanup, and error events.
- `stationary-events.js`: stationary-cluster detection, event persistence
  merge, signature icon specification, nearby marker spreading, and zoom.
- `sw.js`: application-shell installation, old-cache deletion, network-first
  navigation/static fetch with cached fallback.

## `app.js` responsibility inventory

- Runtime dependency checks, startup readiness, and service-worker registration.
- Global application/project/settings/UI state.
- Leaflet and Leaflet-Geoman initialization and layer ownership.
- Map-feature rendering, geometry editing, selection, filtering, and statistics.
- IndexedDB project load/save and local snapshot history.
- GPX and CannonMap project import, sanitization, deduplication, and export.
- Competitor normalization, merge, rendering, freshness, and follow behavior.
- Stationary-event orchestration and rendering.
- GPS Checkpoints feed lifecycle and fallback polling.
- Weather, radar, traffic, Waze, TomTom, and map-tile integrations.
- Rally checkpoint state, scoring, arrival, defer/restore/skip, and hotel flow.
- DOM rendering, event-handler wiring, dialogs, and responsive panel behavior.
- Browser test compatibility exports through `window.CannonMapTest`.

`app.js` contains 1,409 physical lines at the recorded commit.

## Persistence baseline

### IndexedDB

- Database: `CannonMapDB`
- Version: `1`
- Object stores: `projects`
- Store key used by the application: `current`
- Indexes: none

Additional local persistence:

- `localStorage`: `cannonmap.settings.v6`
- `localStorage`: `cannonmap.snapshots.v1`

No IndexedDB migration, outbox, observation store, or sync metadata store is
present at M0.

## Firebase baseline

The optional GPS Checkpoints adapter owns two Realtime Database roots:

- `events/{eventId}`: one `value` listener for achievements/scores.
- `locations/{eventId}`: `child_added`, `child_changed`, and `child_removed`
  listeners for live locations.

`stop()` removes every registered handler. UI panels do not own listeners.
REST remains responsible for:

- `/events/{eventId}`
- `/events/{eventId}/checkpoints`
- `/events/{eventId}/competitors`

No CannonMap Cloud Functions, Firebase Rules, authentication subsystem, or
server-authoritative intelligence schema is present.

## Service-worker baseline

- Cache: `cannonmap-v0.7.1-20260725-03`
- Installation calls `cache.addAll(APP_SHELL)` and then `skipWaiting()`.
- Activation deletes every cache except the current named cache and claims
  clients.
- Navigations are network first, update cached `index.html`, and fall back to
  cached `index.html`.
- Other GET requests are network first, update their request cache entry, and
  fall back to a matching cached response.
- The shell includes HTML/CSS/JS, manifest, Leaflet images, and locally
  vendored Leaflet, Leaflet-Geoman, SheetJS, and Firebase assets.
- Runtime Firebase data, weather, traffic, and map tiles are not guaranteed
  offline.

## Runtime dependencies

| Dependency | Locked version | Runtime role |
| --- | ---: | --- |
| Leaflet | 1.9.4 | Required map runtime |
| Leaflet-Geoman | 2.18.3 | Required planner/map editing |
| SheetJS | 0.18.5 | Optional Excel export |
| Firebase | 8.10.0 | Optional GPS Checkpoints live feed |
| Playwright | 1.61.1 | Development/browser testing |

All required browser runtime assets are committed under `vendor/`.

## Test commands and pre-M0 results

```powershell
pnpm install --frozen-lockfile
node scripts/validate-vendor.mjs
node --test tests/*.test.mjs
node node_modules/@playwright/test/cli.js test --workers=1 --reporter=line
```

| Suite | Total | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Node/unit | 21 | 21 | 0 | 0 |
| Playwright authoritative serial | 50 | 48 | 0 | 2 |
| Combined executed assertions | 71 | 69 | 0 | 2 |
| Vendor assets | 12 | 12 | 0 | 0 |

The two Playwright skips are intentional desktop exclusions for mobile-only
tests.

### Existing environment issue

The locked pnpm installation resolved and populated all 129 packages, but pnpm
exited non-zero with `ERR_PNPM_IGNORED_BUILDS` because build scripts for
`core-js@3.6.5`, `protobufjs@6.11.6`, and `protobufjs@7.6.5` are not approved
by the current pnpm execution policy. No dependency versions were changed.
Vendor validation, Node tests, and the full Playwright suite passed afterward.

## Baseline invariants

- Planner Mode and Rally Mode start successfully.
- Imports/exports and checkpoint workflow remain available.
- Required runtime dependencies load locally.
- Missing optional Firebase does not block the base shell.
- Offline shell startup works after service-worker installation.
- GPS Checkpoints listener ownership remains isolated.
- Stationary-event behavior remains unchanged.
- M0 production-file diff is empty.

## Post-M0 validation

M0 adds eight architecture tests and no production-runtime tests or behavior.

| Suite | Total | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Node/unit plus architecture | 29 | 29 | 0 | 0 |
| Architecture subset | 8 | 8 | 0 | 0 |
| Playwright authoritative serial | 50 | 48 | 0 | 2 |
| Combined executed assertions | 79 | 77 | 0 | 2 |
| Vendor assets | 12 | 12 | 0 | 0 |
| Boundary violations | 0 | 0 | 0 | 0 |

Post-M0 commands:

```powershell
node --check scripts/check-boundaries.mjs
node --test tests/*.test.mjs tests/architecture/*.test.mjs
node scripts/check-boundaries.mjs
node scripts/validate-vendor.mjs
node node_modules/@playwright/test/cli.js test --workers=1 --reporter=line
git diff --check
```
