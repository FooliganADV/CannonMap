# Rally Analytics Foundation

Status: foundation, no UI
Feature flag: `architecture.analytics.telemetry` (default off)

## Purpose

The Rally Analytics subsystem records durable ride telemetry and updates compact
statistics incrementally while the existing Rally Mode GPS lifecycle is active.
It does not change Planner, Mission Control, or existing workflows. Until a
persistent Rally Session becomes authoritative, the existing Start/Stop GPS
lifecycle is the compatibility adapter for starting and ending analytics
capture.

## Architecture

The subsystem has three layers:

- `src/domain/analytics/engine.js` normalizes GPS samples and incrementally
  derives motion, stops, fuel-stop candidates, riding segments, distance,
  speed, elevation, GPS quality, and event counters.
- `src/application/rally-analytics-service.js` provides the public service API,
  serializes concurrent samples, manages sessions and day boundaries, and
  coordinates raw and derived writes.
- `src/infrastructure/indexeddb/analytics-repository.js` atomically appends raw
  evidence and replaces its compact derived projection.

The engine retains only the previous sample and current segment accumulators.
Raw tracks are never accumulated in browser memory. This bounds working memory
for multi-day rallies while IndexedDB grows with the durable evidence stream.

## Persistence model

IndexedDB schema version 3 adds four stores without modifying existing records:

| Store | Authority | Mutation model |
| --- | --- | --- |
| `telemetrySamples` | Raw GPS, motion classification, and route progress | Append-only |
| `telemetryEvents` | Checkpoints, stops, movement, weather, session, and day events | Append-only |
| `analyticsSessions` | Whole-session incremental accumulator | Replaceable projection |
| `analyticsDailyStats` | Per-day incremental accumulator | Replaceable projection |

Raw records and derived projections are committed in the same transaction.
Observed evidence remains separate from inferred statistics. Every record has a
`schemaVersion`; accumulators also have an `algorithmVersion`. Each contract has
an `extensions` object so optional metrics and provider metadata can be added
without changing an IndexedDB key path or redesigning the schema.

## Service API

Create the service with:

```js
createRallyAnalyticsService({
  clock,
  createId,
  featureFlags,
  persistence,
  policy,
  timeZone
})
```

The returned frozen service exposes:

### `isEnabled()`

Returns whether `architecture.analytics.telemetry` is explicitly enabled.

### `recover({ rallyEventId })`

Loads the newest active session and its current daily accumulator. Recovery does
not replay the raw track.

### `startSession({ rallyEventId, riderId, startedAt, extensions })`

Starts a new session or resumes the existing active session for the rally.
Repeated calls are idempotent.

### `stopSession({ endedAt, reason })`

Records a session-ended event and marks the compact session projection complete.

### `recordGpsSample(position, { routeProgress, extensions })`

Normalizes and appends latitude, longitude, timestamp, accuracy, speed,
elevation, and heading. It incrementally updates distance, timing, motion,
stops, continuous riding, speed, elevation, route progress, and GPS quality.

Browser `GeolocationPosition`, normalized coordinate objects, and explicit
timestamps are accepted.

### `recordCheckpointEvent({ checkpointId, action, points, occurredAt, extensions })`

Records checkpoint completion, defer, skip, or future checkpoint actions.

### `recordWeatherSnapshot(weather, { occurredAt, location, extensions })`

Records an available weather observation. Provider units and provenance belong
in `extensions`; the service does not require a specific weather provider.

### `recordRouteProgress(progress, { occurredAt, extensions })`

Records route progress independently when it is not attached to a GPS sample.

### `flush()`

Waits for all serialized writes to finish. Use before controlled shutdowns,
exports, or diagnostics.

### `snapshot()`

Returns a cloned derived session snapshot. It never returns raw samples.

## Detection policy and extension points

The default policy classifies movement at 1.5 m/s, a complete stop after three
minutes, and a fuel-stop candidate after five minutes. Gaps longer than five
minutes are recorded as tracking gaps and excluded from distance/time
integration. All thresholds can be injected through `policy`.

Fuel-stop candidates are deliberately heuristic. A future fuel-location
provider can enrich event `extensions` or refine candidates without rewriting
raw telemetry. New derived metrics belong under accumulator `metrics` or
`extensions`; new observed inputs belong in raw record payloads. Changes to
derivation semantics require a new `algorithmVersion`.

## Rollback and compatibility

The feature is inert unless explicitly enabled. Disable
`architecture.analytics.telemetry` to return to the legacy execution path.
Do not delete or downgrade IndexedDB; additive analytics stores may remain for
diagnosis or later recovery. No UI reads these stores in this milestone.
