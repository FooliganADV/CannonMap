# Trail Intel 0.7.20 post-hardening field validation — 2026-08-29

## Scope and privacy

This validation replays one untouched physical-Samsung competitor export through the exact Trail Intel pipeline at commit `2b889340ac04ae6be7a062c122d48b962d161655`. The raw export remains outside the repository. No raw coordinates, upstream rider identity, or unsanitized observation payload is checked in.

The checked-in 0.7.20 fixture is a privacy-translated derivative. It uses a rigid projected rotation/translation, stable pseudonymous roster entries, and a constant timestamp shift. Timing, relative geometry, null provider fields, stop/restart behavior, and the telemetry gap are preserved.

Target intelligence is intentionally absent from this pipeline and was not evaluated or added.

## Evidence identity

| Field | Value |
|---|---:|
| Source format | CannonMap Competitor Trails |
| Source app version | 0.7.20 |
| Source event | 60 |
| Source export time | 2026-08-29T00:11:51.867Z |
| Source bytes | 478,833 |
| Source SHA-256 | `76c0fb85a608d60e3653b90232546b3e1f8aa003573eecc6630cd3c5af81fa62` |
| Roster entries | 14 |
| Active histories | 1 |
| Zero-point histories | 13 |
| Observations | 1,892 |

Every observation has null provider speed, null provider heading, an empty session ID, and an empty observation ID. There are no duplicate timestamps or identical full-record duplicates.

## Exact unchanged-pipeline result

| Received | Runtime durable | Accepted | Quarantined | Pending | Segments | Rendered |
|---:|---:|---:|---:|---:|---:|---:|
| 1,892 | 1,892 | 1,892 | 0 | 0 | 2 | 720 |

All observations are accepted. The 1,325 forensic near-duplicate labels describe observations participating in a pair within five seconds and three metres; they are not duplicate or quarantine dispositions. Replaying the identical export adds zero durable observations.

The first segment contains 688 observations over 15 minutes 7 seconds and 8.522 observed miles. It contains multiple sustained stationary→moving and moving→stationary transitions. Its maximum accepted transition is 67.596 mph, below the 130 mph field ceiling.

The second segment contains 1,204 observations over 20 minutes 16 seconds and is stationary apart from 2.687 metres of total jitter. Two identical-coordinate runs contain 412 and 790 observations. These remain distinct durable evidence because their timestamps are distinct.

## Gap and geometry

The only telemetry gap is 56 minutes 2.994 seconds. Its endpoints are 9,342.413 metres apart, an implied endpoint speed of 6.214 mph. The pipeline classifies it as a telemetry gap—not an outlier, relocation, or connected movement interval.

Rendered output remains two independent segments allocated 183 and 537 source points. No rendered line crosses the gap, no point is synthesized, and the latest tactical marker exactly matches the latest accepted source fix. There is no fan, crisscross, or teleport geometry.

## Speed, heading, and pace truth

At the reconnect point, immediate speed, heading, rolling pace, and sustained pace are all unknown with zero coverage. No pre-gap metric leaks into the new segment.

After sufficient post-gap stationary observations:

- immediate speed becomes 0 mph from the existing five-transition positional median;
- heading remains unknown;
- three-minute rolling pace becomes 0 mph after its 15-second minimum and reaches full 180-second coverage;
- 15-minute sustained pace remains unknown before the 10-minute minimum, becomes 0 mph at the coverage threshold, and reaches full 900-second coverage;
- the final trail gap count is one.

At the end of the moving segment, the same null-provider feed truthfully derives positional speed, a cardinal heading, and same-segment rolling and sustained pace. Provider telemetry is never invented.

## Comparison with prior sanitized field fixtures

- **0.7.17** proves repeated stationary fixes and a genuine gap, but its post-gap segment is too short to exercise sustained-pace recovery.
- **0.7.18** proves dirty-feed quarantine, false-relocation prevention, and bounded projection under 3,930 observations.
- **0.7.19** proves the same outlier rule on a short continuation export.
- **0.7.20** adds the first post-hardening physical case that combines repeated stop/restart transitions, a long gap, immediate metric reset, and more than 20 minutes of post-gap stationary coverage through both pace thresholds.

## Change decision

The evidence confirms the current 0.7.20 implementation. It does not support a production-code change. The only repository additions are the privacy-sanitized fixture, focused regression coverage, and this report. Version, build, service-worker/cache identity, Rally Mode, camera, backup, and Trail Intel production code remain byte-for-byte unchanged.

No deployment is warranted because runtime code did not change.

**Recommendation: 0.7.20 BASE TRAIL PIPELINE VALIDATED — READY FOR TARGET INTELLIGENCE.**
