# Target intelligence final Samsung release candidate

## Scope and authority

Version 0.7.21 adds a read-only tactical projection over the validated 0.7.20
competitor stream. `src/domain/competitors/trails.js` remains authoritative for
acceptance, quarantine, relocation, gaps, speed, heading, pace, durable bounds,
and rendered geometry. Target intelligence accepts only that module's derived
tactical trail; it has no raw-observation entry point and does not mutate Rally,
checkpoint, evidence, scoring, camera, Ride Memory, backup, or GPS state.

The only public states are `UNKNOWN`, `APPROACHING`, `NEAR TARGET`,
`STOPPED NEAR TARGET`, and `DEPARTED`. They describe observed geometry, never
intent, completion, evidence, points, rank, route, or prediction.

## Candidate and continuity rules

Only point checkpoints and hotels from the active numbered project's current
day are candidates. All Days and unresolved days produce no executable target
catalog. Candidate identity is the stable feature ID; the label is presentation
only. The catalog is capped at 256 targets, the one-mile spatial candidate set
at eight, and equally plausible same-state targets within 200 feet resolve to
`UNKNOWN`.

Only independent fixes from the latest accepted segment participate. A
telemetry gap, confirmed relocation, source-session fence, pending relocation,
stale/offline status, missing target, inconsistent tactical trail, or inadequate
evidence resolves to `UNKNOWN`. The recent scan is five minutes and at most 360
accepted fixes. Sub-500 ms deliveries are not independent observations.

## Geometry thresholds

- Target vicinity: 500 feet (152.4 m).
- Exit hysteresis: 200 feet (60.96 m) beyond the vicinity.
- Stationary dwell jitter allowance: 50 feet (15.24 m).
- Candidate radius: one mile (1609.344 m).
- Current-evidence freshness ceiling: two minutes.

These target-observation thresholds are deliberately separate from CannonMap's
own checkpoint arrival radius. They cannot detect or complete a rider's Rally
checkpoint and do not change checkpoint semantics.

## State evidence

`APPROACHING` needs at least four independent, current, same-segment fixes over
at least 15 seconds, at least 100 feet of closure, a meaningful decreasing trend
(at least 70 percent of directional changes), and the current hardened motion
state `moving`. One closer fix is insufficient.

`NEAR TARGET` requires the latest accepted fix inside 500 feet and at least two
independent fixes overall. It does not imply a stop.

`STOPPED NEAR TARGET` additionally needs four independent fixes, at least 30
seconds of contiguous presence inside the vicinity plus the 50-foot jitter band,
no interval over 30 seconds, and hardened motion state `stationary`. Leaving the
band, changing segment, or changing target resets dwell.

`DEPARTED` needs prior accepted presence inside the vicinity followed by at
least three accepted outward fixes (four supporting fixes including the inside
fix), at least 15 seconds, at least 100 feet of increasing separation, at least
70 percent outward directional changes, a final position outside 700 feet, and
motion state `moving`. One jump, a gap, a relocation, or stale disappearance can
never establish departure.

Closest approach is emitted only with a proven non-`UNKNOWN` relationship. It
uses accepted fixes from the current segment and records target ID, distance,
timestamp, and provider or bounded derived speed. Quarantined fixes cannot
become closest approach.

## Runtime and presentation

The app creates one current-day catalog projection and one replaceable WeakMap
target projection per existing tactical trail. Popup, selected-rider summary,
objective text, and diagnostics reuse it. Cache invalidation follows tactical
history, current project/day/event catalog, pending state, status, and a bounded
freshness bucket. No target listener or timer is added.

The Samsung-landscape UI adds one compact target strip only for the selected
rider and one compact block inside the existing popup. It draws no speculative
line or predicted path. UNKNOWN is visibly explicit. The optional checkpoint
halo was deliberately omitted to avoid new map obstruction and lifecycle state.

## Bounds and release freeze

The domain benchmark exercises 20 riders with 12,000 durable observations each;
each target projection binary-searches the recent boundary and inspects no more
than 360 accepted points. Bounded recent target activity support retains at most
360 transition classes for five minutes, but the 0.7.21 app does not add a new
persistent activity store.

After this release candidate, pre-rally changes are frozen except for P0 data,
Rally, checkpoint, camera/evidence, score, session, backup, or startup failures,
and P1 severe false Trail Intel geometry or an operationally blocking UI fault.
