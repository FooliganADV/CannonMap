# CannonMap Planner — Beta 0.7.20 Trail Intel Field Hardening

Build: `2026.08.28.trail-intel-field-hardening-1`

This build targets long, powered, screen-on Samsung Chrome/PWA rides in landscape. It preserves the physically accepted Rally, camera, Ride Memory, backup, lifecycle, route-membership, tactical presentation, and compact landscape UI, then hardens the validated competitor stream against millisecond duplicate relocation evidence and short-lived divergent field fixes without changing durable source history.

Rally Mode creates an immutable session for every deliberate run, asks riders to **Resume Existing** or **Start New**, and keeps unresolved photo evidence separate from GPS navigation. Camera preflight verifies rear and front native-still capability, closes both streams, and reports READY with zero retained streams. Every checkpoint and Ride Memory side then opens, captures, persists, and fully closes before the next camera opens.

## Purpose

CannonMap is a rally decision system. The primary live-rally function is displaying and preserving competitor trails from the official GPS Checkpoint leaderboard feed. The backbone is only an optional sightseeing/reference layer; it is not an official route.

## New in this release

- Current Project/day membership is authoritative by stable checkpoint ID; removed checkpoints cannot remain active, prior, pending, scoreable, or restorable execution targets
- Session resume reconciles stale checkpoint states and pending evidence, chooses one current-route target, and retains historical Journal/media without matching by display name
- GPX application, checkpoint deletion, and planning-snapshot restoration fence active Rally work before reconciling route membership; GPX Merge is explicitly additive, while Replace owns removal
- Named snapshots no longer reinsert absent checkpoints merely because those checkpoints have historical execution fields
- Manual Day Backup hydrates only the active session's media when the repository supports session indexes, avoiding unrelated multi-day JPEG pressure
- Backup diagnostics now identify attempt, stage, duration, visibility, activation, storage, capture, scheduler, and output route while remaining bounded
- Verified external bytes and verified browser-download packages are no longer mislabeled as verification failures when later Journal/status bookkeeping fails; browser downloads explicitly require confirmation in Samsung Downloads
- Three-minute rolling pace and 15-minute sustained pace are derived once from the current validated same-segment trail; quarantined points, reconnect gaps, and session boundaries cannot contaminate either value
- The 15-minute pace remains unknown until at least 10 minutes of trustworthy same-segment coverage exists; the three-minute value requires 15 seconds
- Upstream rider numbers, deterministic distinct field colors, selected-rider emphasis, nonselected dimming, **ALL RIDERS**, and deterministic overlap fan-out restore tactical identity without changing ingestion
- Compact Samsung-landscape rows and rider popups show LIVE/STALE/OFFLINE, STOPPED/MOVING/UNKNOWN, median immediate speed, both pace windows, numeric/cardinal heading, directional arrow, and trail-gap count
- Popup dismissal is explicit: a polling refresh preserves an open popup but never reopens one the rider closed
- Low-zoom clusters remain an overview tool; individual tactical markers return at riding zoom and cluster rider buttons preserve normal selection semantics
- A sanitized replay derived from a real event-60 export exercises approximately 1 Hz updates, null upstream speed/heading/IDs, real stops, gaps, and reconnects
- Samsung Android Chromium at 915×412 landscape is the sole pre-rally browser release gate; retained iOS/WebKit tests are informational and nonblocking unless they expose shared logic
- Semantic target activity remains intentionally deferred until its older freshness and dwell assumptions can be made truthful against the hardened stream
- Foreground resume invalidates stale operational camera readiness while preserving the browser permission state, closes every old track, and performs one fresh bounded rear/front probe with zero retained streams
- A GPS arrival during that probe is persisted immediately; checkpoint capture fences the lower-priority probe and directly invokes the existing exclusive fresh-stream capture/recovery path
- Pending evidence no longer turns the next sequential arrival into an out-of-order objective when its radius dwell began under an earlier target
- A prior target is restored only when the exact recorded target still owns live navigation, so late evidence recovery cannot move the route backward
- Ride Memory archive coverage now explicitly proves two Originals and zero Evidence derivatives per successful rear/front slot
- Exclusive one-stream camera ownership with a 10-second native-still deadline, full teardown, one fresh-stream retry, truthful frame fallback, and bounded recovery backoff
- Checkpoint fallback frames are retained only as diagnostic Originals and are fenced from Evidence generation and scoring, including after reload reconciliation
- Scalable external backup writes and SHA-256 verifies one immutable media file at a time, then commits a unique verified generation manifest last
- Interrupted external generations resume from verified media; revoked permission leaves internal recovery and prior verified external files untouched
- Manual **Back Up Day** waits for its own requested generation and labels external folder output separately from legacy restorable `.cmapday.zip` packages
- Verified compact internal recovery after session start and checkpoint completion, plus a two-hour/day-complete schedule that never blocks rally execution
- Optional File System Access folder grant with persisted-handle reuse, permission rechecks, unique session folders/manifests, reopened byte verification, and partial-write isolation
- Default-hourly Samsung Ride Memory capture with GPS metadata, checkpoint-camera priority, five-minute checkpoint coverage suppression, and durable missed/deferred state
- Single-owner GPS, polling, reliability-health, Wake Lock, camera, timer, and listener lifecycles with foreground restart/reconnect behavior
- Bounded incremental competitor history, coalesced persistence, one-second official-feed rendering batches, and compacted map geometry for long sessions
- Session-scoped checkpoint, score, Journal, media, recovery, and backup state for repeated runs of the same itinerary day
- A durable Pending Evidence queue: an unresolved photo at one checkpoint cannot block later GPS arrivals
- Immediate, idempotent Journal persistence for retry, resume, fail, defer, and continue-route decisions
- Unique Day artifact filenames plus manifest identity for Project, rally, day, run, build, cache, Journal, media, and checkpoint evidence
- Truthful separation of permission, verified native-still capability, current stream ownership, and automatic-capture eligibility
- Trip/day selectors and execution storage tested through at least 60 sequential days
- Dedicated phone-first Rally Mode while preserving the desktop Planner
- Checkpoint states, 10/21 point scoring, completion, defer, restore, skip, and sequence preservation
- One-action hotel bailout that defers unfinished checkpoints and offers an immediate undo
- Fuel planning foundation with explicitly conservative, configurable estimates
- Central event-data protection that removes and logs `Old Coast Road` at every import/restore boundary
- Geometry-based route/track mileage deduplication, including reversed and differently spaced representations
- Android Chromium Playwright release tests at the mounted Samsung landscape geometry; desktop Chromium remains available for shared-domain diagnostics
- Deployment parity audit in `DEPLOYMENT_AUDIT.md`

- Buffered radar frame loading and crossfading remove the blank strobe between animation frames
- Radar can be restricted to the active day, selected route/track, or current map view
- Route/day radar uses a 30-mile buffer so approaching weather remains visible
- Optional animated recent-weather radar overlay with opacity control and timestamps
- Track-ahead weather scan with an estimated rain start time, distance, and rainfall exposure
- Route hazard warnings for wind gusts, snow, freezing precipitation, thunderstorms/hail, low visibility, dust, and poor air quality
- Configurable planning speed for arrival-time estimates along the track
- Trail Intelligence integration hub
- Generic live competitor-location JSON connector with configurable polling
- Breadcrumb history preservation when a feed only returns each rider's latest position
- Fresh/stale rider display and trail-age indicators
- Competitor trail export, clearing, and per-rider zoom
- Live Open-Meteo weather at GPS position, selected checkpoint, or map center
- TomTom Traffic incident support for the current map viewport
- Waze launch button plus optional Waze for Cities inbound data-feed support for approved partners
- Compact mobile Intel sheet instead of adding another full phone dashboard
- Backbone feature type with a gray dashed reference style
- Planning mileage no longer automatically adds route and track mileage together
- TomTom keys remain local to the browser and are excluded from portable `.cmap` exports
- Existing GPX, `.cmap`, search, editing, snapshots, layer controls, Excel/CSV, and manual competitor JSON features retained

## Upload

Extract the ZIP and upload every file to the GitHub repository root. Replace the existing files.

## Tests

Run the dependency-free regression suite with Node.js:

```text
node --test tests/*.test.mjs
```

Run the Samsung browser release gate with:

```text
npm run test:browser
```

Legacy iOS/WebKit projects remain in the repository but are not pre-rally release gates.

## First test

1. Confirm the status shows `v0.7.20 · 2026.08.28.trail-intel-field-hardening-1`.
2. Hold the Samsung in landscape and confirm the Rally map remains primary at approximately 915×412.
3. Load a live competitor event or the sanitized event-60 replay and confirm rider numbers and distinct colors remain stable across refreshes.
4. Select one rider, confirm other riders dim, dismiss its popup, refresh, and confirm the popup stays dismissed.
5. Confirm three-minute pace appears only with sufficient current-segment history and 15-minute pace remains unknown until 10 minutes of coverage.
6. Load a revised test route containing 1.1, 1.5, 1.6, and 1.7; confirm removed 1.2–1.4 never become targets and progression remains in order.
7. Run one clean numbered-day checkpoint sequence, including one offline arrival and automatic rear/front capture pair.
8. Create a Day Backup; for browser download output, confirm the verified package appears in Samsung Downloads.

## What is still needed from the user

### Official competitor trails

Use the configured official event ID or an explicitly supplied custom endpoint. The checked-in event-60 replay is sanitized test evidence, not a substitute for confirming the live rally event configuration before departure.

### Traffic

Choose one:

- TomTom developer API key; or
- Waze for Cities partner GeoRSS URL.

The normal consumer Waze application does not provide CannonMap a general-purpose public traffic feed. CannonMap can open Waze at the active map location; an in-app Waze overlay requires approved Waze for Cities data access.

## Current limitations

- Semantic target activity, catch/closing analytics, rider-ahead inference, and pace rankings are intentionally deferred.
- Browser CORS restrictions can still affect custom competitor endpoints. Offline core rally operation remains independent from Trail Intel polling.
- Radar requires internet access, shows recent observed precipitation rather than forecast nowcast frames, and has source resolution through zoom level 7.
- Track-ahead weather uses sampled forecast points and the selected planning speed. Timing, rainfall, dust, and hazard values are estimates—not safety guarantees.
- TomTom incident requests require the map viewport to be no larger than 10,000 km².
