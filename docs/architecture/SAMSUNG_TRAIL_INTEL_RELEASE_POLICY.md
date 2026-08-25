# Samsung Trail Intel pre-rally release policy

## Production target and release gate

CannonMap's sole pre-rally production target is Samsung Android, current
Chrome/Chromium PWA, mounted landscape at approximately 915 x 412 CSS pixels,
foregrounded with the screen awake, continuous power and GPS, and intermittent
network service. `npm run test:browser` and `npm run test:browser:samsung` run
that primary profile. Desktop Chromium remains a deterministic shared-domain
aid. Existing iPhone and WebKit projects remain available as informational
compatibility checks, but a failure isolated to those platforms does not block
Samsung deployment.

The accepted 0.7.16 rally, camera, Ride Memory, backup, lifecycle, and polling
behavior remains authoritative. Trail Intel additions may consume its state but
must not own or block those systems.

## Historical source audit

The full tactical reference `784db68776e9b7a62b438852a5020eb6bc5210fe`
genuinely implemented three-minute rolling pace, fifteen-minute sustained pace
with a ten-minute coverage floor, deterministic color/number presentation,
rider isolation, ALL RIDERS, overlap fan-out, compact rows, cardinal heading,
gap display, low-zoom clusters, and cluster selection.

The later reference `6a294ea31cb9e5e6e8e0b93005b8c4ba6c909b10`
genuinely added target-state projections, closest approach, speed at closest
approach, dwell, bounded latest target activity, and objective highlighting.
Those calculations used the older validation pipeline and had material hazards:
approach was not freshness-gated, dwell could span filtered-out excursions,
and the stopped radius did not match the target vicinity. The older UI also
reopened a selected popup during every live render and therefore did not safely
respect dismissal.

Neither historical implementation replaces the 0.7.16 validated trail stream.
The current quarantine, corroborated relocation, equal-time handling,
same-segment median immediate speed, gap segmentation, segment-first geometry,
12,000-point durable bound, 720-point render bound, polling recovery, and cached
projection remain authoritative.

## Ranked restore list

### A - restore before rally

- Three-minute rolling and fifteen-minute sustained pace over the current
  validated latest segment, with explicit coverage and unknown values until
  sufficient.
- Stable upstream rider number, deterministic stable color, selection/dimming,
  ALL RIDERS, deterministic overlap fan-out, and selection persistence.
- Compact landscape rows and popups showing freshness, motion, median immediate
  speed, rolling pace, sustained pace, numeric/cardinal heading, arrow, and
  confirmed gap count.
- Explicit popup dismissal state; live refresh may update a popup that remains
  open but may not reopen one the rider closed.
- Low-zoom-only clusters and deliberate rider selection from a cluster.

### B - useful, deliberately deferred for this release

- Configurable segmentation threshold and separately durable gap-event history.
  The current two-minute hardened threshold is not changed before the rally.
- Semantic target activity, closest approach, speed, dwell, bounded target
  persistence, and checkpoint halo. These require a new excursion-safe,
  freshness-gated implementation on current validated segments rather than a
  port of the older code.

### C - post-rally

- Fastest/pace rankings, closing or pulling-away detection, catch ETA, rider-ahead
  prediction, Kalman filtering, multiresolution history architecture, native
  Android/background-camera work, and server-side redesign.

## Pace contract

Pace is distance divided by covered time, with boundary intervals clipped to
the requested window. Only accepted observations from the latest validated
segment participate. The three-minute window requires at least 15 seconds of
coverage. The fifteen-minute window requires at least 10 minutes. A telemetry
gap, confirmed relocation, or explicit source-session change starts a new
segment and therefore a new pace window. A transition between a known and a
missing source-session ID is fenced conservatively as well, so intermittent
metadata cannot bridge two known sessions. Quarantined observations never enter
pace. Provider speed and heading are optional; the current bounded median
immediate speed and positional bearing remain available when they are absent.
Positional heading remains unknown until movement exceeds the existing jitter
floor; stationary fixes do not fabricate a northbound heading.

## Event-60 evidence fixture

`tests/fixtures/trail-intel/event-60-sanitized.json` is derived from the real
August 22 event-60 CannonMap export made by 0.7.14. It retains genuine timing,
roughly one-second active sampling before repository downsampling, null provider
speed/heading/session/observation IDs, stops, gaps, and reconnect geometry. The
absolute coordinates are translated and rotated and the rider name is replaced.
The public upstream metadata maps competitor ID 492 to rider number 88. The
fixture records the complete source SHA-256 so its provenance remains auditable
without committing the original location trace.

## Performance boundary

The app's existing per-points-array tactical cache remains the UI entry point.
Pace is derived once from that current tactical object and reused through a
WeakMap projection cache. Rendering continues to consume compacted validated
segments, so multiple rows/popups do not rescan raw history independently.
Low-zoom cluster reconciliation uses a bounded presentation projection and
fingerprint that excludes each rider's breadcrumb array.
