# Milestone M5: Observation Capture foundation

## Scope and authority

M5 adds a local, feature-flagged Observation Capture path for browser
geolocation samples. The canonical flag is `architecture.observation.capture`
and defaults off. Legacy GPS display, arrival evaluation, checkpoint behavior,
project persistence, and Rally orchestration remain authoritative whether
capture succeeds, fails, or is disabled.

The capture path normalizes observed sensor values, assesses sample quality,
applies bounded sampling and duplicate suppression, creates versioned
append-only observations, and atomically enqueues each new observation in the
M2 outbox. Observed values and derived quality metadata remain separate.
Stable observation and idempotency keys make retries safe. Recovery reports
durable pending work; bounded replay accepts an injected delivery port and
stops after the first delivery failure.

## Lifecycle, sampling, and quality

Each attempt follows the explicit local lifecycle `idle -> assessing`, then
ends as `rejected`, `suppressed`, or `persisting -> persisted/failed` before
returning to idle. A rejected or failed attempt never mutates Rally state.

Samples inside two seconds and five meters of the last persisted sample are
suppressed. Valid samples over 50 meters accuracy are retained as degraded;
missing/invalid coordinates, missing timestamps, samples older than 15
seconds, invalid accuracy, or accuracy over 1,000 meters are rejected. The
quality record includes the age and accuracy inputs used by algorithm
`capture-v1`; it is derived metadata and is not an inferred conclusion.

Every accepted record uses schema version 1, includes available motion and
checkpoint context, and stores raw normalized sensor facts under `observed`.
The record moves to the durable `pending` sync state only through the same
atomic M2 transaction that creates its outbox entry.

Duplicate IndexedDB constraints are considered idempotent success only when
both the expected observation and outbox item already exist. Partial writes
therefore remain failures. Reload recovery enumerates pending outbox work but
does not create an automatic retry loop.

## Boundaries and diagnostics

Pure observation contracts, quality rules, sampling, and lifecycle transitions
live in the domain layer. Application orchestration depends on injected clock,
feature flags, and persistence ports. IndexedDB owns the M2 atomic
observation/outbox adapter. Diagnostics are structured and bounded, contain no
credentials, and never replace the legacy GPS error surface.

M5 does not add authentication, server ingestion, commitment inference, route
families, confidence evolution, intelligence publication, or Co-Driver logic.

## Rollback

Disable `architecture.observation.capture` for immediate rollback; the legacy
path continues unchanged and no v2 database open is attempted. Reverting the
single M5 commit removes the capture modules and cache entries. Existing
append-only observation and outbox records may remain safely in IndexedDB and
require no migration or deletion.
