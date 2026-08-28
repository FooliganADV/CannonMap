# Trail Intel real-field forensics — 2026-08-28

## Scope and privacy

This report compares the 0.7.19 Trail Intel pipeline before and after the narrow real-field correction. The evidence is three untouched physical-device competitor-trail exports spanning CannonMap 0.7.17, 0.7.18, and 0.7.19. Source coordinates are deliberately excluded. Rider names and numbers are also excluded except for Rider 496, the explicitly designated dirty-feed case.

The raw exports remain authoritative and unchanged outside the repository. Checked-in replay fixtures are privacy-translated derivatives; they are not the source evidence summarized here.

Target intelligence was not present in these exports or in this replay. Target events, closest approach, target dwell, and target-derived calculations are therefore **not applicable**. No target-intelligence conclusion is inferred from these data.

## Evidence identity

All source hashes were recomputed from the untouched files with SHA-256.

| Source | App version | Exported at (UTC) | Bytes | SHA-256 | Raw observations | Roster entries | Zero-point entries | Single-point entries |
|---|---|---:|---:|---|---:|---:|---:|---:|
| A | 0.7.17 | 2026-08-26T21:41:07.224Z | 227,225 | `7cdeba50f489dfade306c5e607e89e31be93a1bc75361c156b59a71b5572a412` | 895 | 14 | 12 | 1 |
| B | 0.7.18 | 2026-08-27T18:24:52.227Z | 942,404 | `b7c5e4a82736538f4d58f535cebe6e656413894ea032772ac608b72464d91e52` | 3,930 | 14 | 11 | 2 |
| C | 0.7.19 | 2026-08-27T18:32:57.438Z | 18,133 | `01a4079c8af45a2f27924de91a8801c4313ba8123b053c36ddbbe265982f7252` | 69 | 14 | 13 | 0 |

Every recorded observation has a valid coordinate and monotonically ordered timestamp. Every observation also has null provider speed, null provider heading, an empty session ID, and an empty observation ID. There are no repeated full observation tuples and no duplicate timestamps. Same-position observations with distinct timestamps are therefore separate durable records and cannot be deduplicated by an upstream observation ID.

The preserved replay reports are:

| Replay | Generated at (UTC) | Bytes | SHA-256 |
|---|---:|---:|---|
| Pre-fix current-pipeline replay | 2026-08-28T14:10:00.516Z | 12,009,400 | `88a1a039e8f108f146be51f1930e59947dc8c2fbd2871e1605974542ad67a838` |
| Post-fix current-pipeline replay | 2026-08-28T14:28:10.696Z | 11,954,860 | `39147bf507386b634a1e50ea556f3368c8f8f143f7002056fd84c9a134940629` |

Both replays use the same public pipeline limits: a two-minute telemetry gap, 130 mph maximum transition speed, 25 km maximum jump, 10 m equal-time tolerance, eight-hour runtime history, 12,000 durable observations per rider, and 720 rendered points per rider. The forensic near-duplicate label is at most five seconds and three metres; that label is diagnostic and is not itself an acceptance decision.

“Runtime eligible” below is the replay's normalized durable count: observations remaining after validity checks, exact-key normalization, the eight-hour runtime window, and the durable bound. It is not a destructive rewrite of the source export.

## Before/after pipeline results

| Source | Raw received | Runtime eligible | Accepted before | Quarantined before | Segments before | Rendered before | Accepted after | Quarantined after | Segments after | Rendered after |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A | 895 | 895 | 895 | 0 | 3 | 721 | 895 | 0 | 3 | 721 |
| B | 3,930 | 3,928 | 3,583 | 345 | 158 | 720 | 3,361 | 567 | 1 | 720 |
| C | 69 | 69 | 63 | 6 | 6 | 63 | 58 | 11 | 1 | 58 |

Source B's two non-eligible rows are old single-point roster histories outside the eight-hour replay window. They were not deduplicated or quarantined. For every source, post-fix accepted plus quarantined equals runtime eligible.

The post-fix quarantine reasons for Rider 496 are:

| Source | Implausible jump | Near-duplicate corroboration | Corroborated trajectory spike | Isolated spike | Total |
|---|---:|---:|---:|---:|---:|
| B | 416 | 80 | 58 | 13 | 567 |
| C | 8 | 3 | 0 | 0 | 11 |

Before the fix, all 345 Source B quarantines and all six Source C quarantines were classified as `implausible_jump`. More importantly, 157 Source B and five Source C false `corroborated_relocation` boundaries were accepted. After the fix there are no corroborated relocations in either source and each becomes one continuous validated segment.

The changed accepted counts are intentional. The old pipeline promoted paired bad fixes into executable tactical geometry. The corrected pipeline retains those raw records durably but excludes them from the validated stream.

## Rider 496 chronological reconstruction

### Source B — 0.7.18

Rider 496 contributes 3,928 observations from 15:46:33.121Z through 18:24:49.134Z. There are 1,998 distinct positions arranged as 2,236 consecutive-position runs: 741 one-record runs, 1,461 two-record runs, and 34 longer runs. Of the 3,927 transitions, 1,563 occur within 10 ms and 1,692 repeat the immediately prior position. This establishes that rapid same-fix redelivery is ordinary feed behavior.

The first spatial contradiction occurs only nine seconds after the stream starts. A point travels 1,664.6 m in 4.091 seconds, then returns 1,498.1 m toward the ongoing trajectory in 0.909 seconds. The worst raw transition occurs at 17:41:44Z: 3,799.0 m in 5 ms. Across the capture:

- 511 transitions exceed 1 km, including 36 over 10 km;
- 814 transitions imply more than 100 mph, 738 imply more than 200 mph, and 625 imply more than 500 mph;
- the unfiltered cumulative path is 1,692.49 miles although start-to-end displacement is 168.06 miles;
- a deterministic interior-spike audit finds 238 isolated spikes over 500 m and 198 over 1 km when the adjacent valid trajectory bypass is under 500 m within a 12-second span;
- impossible transitions occur in every 15-minute interval, while the maximum internal timestamp gap is only 10.003 seconds.

This is a continuously delivered but spatially contradictory feed. It is not explained by a telemetry outage or timestamp disorder.

Pre-fix, duplicate or near-duplicate copies of a divergent position appeared mutually plausible relative to one another. The pipeline promoted them to a new segment, then frequently repeated the process when the legitimate trajectory returned. Rider 496 consequently had 158 segments and a rider-facing gap count of 157 despite having no two-minute telemetry gap. Rolling and sustained pace were repeatedly reset.

Post-fix, the same source yields 3,361 accepted observations, 567 quarantines, one segment, no false gap, and a 720-point rendered projection. Divergent observations never become marker truth or rendered geometry. Because the valid route remains a single segment, there is no fabricated chord across a relocation and no detached false-relocation fragment.

### Source C — 0.7.19

Rider 496 contributes 69 observations from 18:30:19.125Z through 18:32:54.124Z. It contains 37 distinct positions and 40 consecutive-position runs: 29 two-record runs and 11 single-record runs. All 29 transitions within 10 ms repeat the immediately prior position.

The first contradiction occurs about 11 seconds into the capture: 3,932.6 m in 0.898 seconds, followed by a 3,765.8 m return in 4.106 seconds. The divergent position reappears in three separate runs during the next minute. A later contradiction moves 931.1 m in 0.392 seconds. Across this short capture:

- eight transitions exceed 1 km;
- sixteen transitions imply more than 100 mph and eleven imply more than 500 mph;
- the unfiltered cumulative path is 17.07 miles versus 3.221 miles start-to-end displacement;
- the maximum internal timestamp gap is 5.010 seconds.

Pre-fix, five rapid duplicate pairs falsely corroborated relocation, producing six segments and five displayed trail gaps. Post-fix, 58 observations are accepted, 11 are quarantined, and all accepted points remain in one segment. All 58 fit beneath the render bound and are rendered.

### Cross-export boundary

The last Source B observation and first Source C observation are separated by 329.991 seconds and 10,786.3 m, an implied 73.12 mph. That boundary is physically plausible, unlike the millisecond-to-four-second internal contradictions. The exports are independently replayed, so the analysis does not fabricate a chord between them. Source C's absence of older Source B history may reflect isolated preview-origin storage and is not treated as a persistence defect without origin context.

## Exact defect mechanism and correction

The original candidate-relocation rule required two mutually plausible points at the divergent location. The real feed often emits the same physical fix twice only 1–100 ms apart. A single bad fix delivered twice therefore looked like corroboration:

1. The first divergent row became a pending `implausible_jump` candidate.
2. Its near-identical redelivery was plausible relative to the pending row.
3. The pipeline treated the pair as an independently corroborated relocation and started a new segment.
4. The next valid route row looked impossible relative to that false segment; another pair could then corroborate a relocation back.
5. Repetition produced many tiny false segments, false trail-gap counts, detached geometry, and insufficient pace coverage.

The correction makes the smallest evidence-based distinction needed by the physical feed:

- A relocation duplicate does not independently corroborate a move unless it is separated by at least 500 ms or supplies material displacement beyond the equal-position tolerance.
- A near-time, near-position repeat of a pending candidate is quarantined as `near_duplicate_corroboration`, not used as second-source proof.
- A short-lived divergent run can replace only a recent same-coordinate run when a direct bypass back to the validated trajectory is itself plausible; removed rows remain durable and are classified `isolated_spike`.
- Four recent coordinate runs can identify a trajectory spike only when the trajectory before and after it is mutually plausible, heading and speed remain stable, and the spike has material residual and path excess. Those rows are classified `corroborated_trajectory_spike`.
- True telemetry and session boundaries still use the existing break behavior.

These rules are deterministic and leave the durable source history untouched.

## Tactical metrics after quarantine

Provider speed and heading are null throughout all three sources. The reported values below are therefore derived only from accepted same-segment positions.

| Source / case | Immediate speed | Heading | 3-minute rolling pace | Rolling coverage | 15-minute sustained pace | Sustained coverage |
|---|---:|---|---:|---:|---:|---:|
| B Rider 496, pre-fix | 74.68 mph | 38.64° / NE | 74.81 mph | 85.015 s | Unknown | 85.015 s |
| B Rider 496, post-fix | 74.68 mph | 38.64° / NE | 74.84 mph | 180.000 s | 74.00 mph | 900.000 s |
| C Rider 496, pre-fix | 74.86 mph | 358.01° / N | 74.91 mph | 19.990 s | Unknown | 19.990 s |
| C Rider 496, post-fix | 74.86 mph | 358.01° / N | 74.82 mph | 154.999 s | Unknown | 154.999 s |

Immediate speed remains the five-sample position median. The small before/after rolling-pace differences reflect removal of bad points from the accepted segment. Source B now fills the complete three-minute and 15-minute windows. Source C is only about 155 seconds long, so rolling pace is available after its 15-second minimum but sustained pace truthfully remains unknown because it cannot satisfy the existing ten-minute minimum coverage rule.

Quarantined rows do not enter speed, heading, pace, segment geometry, the live marker, or rendered trails. Target calculations are N/A because target intelligence is intentionally absent.

## Gap, stationary, single-point, and zero-point behavior

Source A supplies the preservation controls:

- Its 894-point active stationary stream contains 881 forensic near-duplicates, all accepted as durable stationary evidence.
- One real 287.003-second telemetry gap produces exactly two segments and one trail gap before and after the fix. No chord is rendered across the gap.
- Current motion is `stationary`, derived immediate speed is 0 mph, and three-minute rolling pace is 0 mph with 23.004 seconds of post-gap coverage.
- Heading is unknown while stationary. Sustained pace remains unknown because the current segment has only 23.004 seconds of coverage, far below ten minutes.
- The stream renders at the per-rider maximum of 720 points while all 894 accepted observations remain durable.

Rider 496's single Source A point is accepted and rendered as one one-point segment. Motion, speed, heading, rolling pace, and sustained pace all remain unknown because no transition exists.

The two raw single-point entries in Source B are older than the eight-hour runtime window and are omitted during normalization without being classified as duplicates or outliers. Empty roster entries produce zero accepted points, zero segments, zero rendered geometry, and offline/unknown status without error. Zero-point counts are 12, 11, and 13 for Sources A, B, and C respectively.

## Geometry and capacity conclusions

- **Fan/crisscross:** the pre-fix defect created false relocation fragments. Post-fix Rider 496 has one validated segment in Sources B and C; divergent rows are not rendered, so they cannot create fan, crisscross, or teleport geometry.
- **Telemetry gaps:** Source A's genuine gap remains split into two segments. No fabricated chord spans it.
- **Relocation:** rapid duplicate delivery is no longer accepted as independent relocation proof. No field relocation is corroborated in Sources B or C after correction.
- **Stationary evidence:** repeated positions and bounded jitter remain accepted; filtering was not raised indiscriminately.
- **Durability:** quarantine is projection-only. Source rows remain durable and auditable.
- **Render bounds:** the largest source renders exactly 720 Rider 496 points; the 894-point stationary stream independently renders 720. Smaller accepted streams render all points.
- **Durable bound:** all physical streams are below the 12,000-observation per-rider limit. This evidence confirms no physical-source truncation, while the existing 12,000 bound remains the governing synthetic capacity test.

## Remaining evidentiary limits

- Empty session and observation IDs prevent upstream identity-based deduplication and direct session-boundary proof.
- All provider speed and heading values are absent, so only position-derived fallbacks are exercised.
- Sources B and C have no true two-minute internal outage; true-gap preservation is demonstrated by Source A.
- The physical sources do not establish whether Source C should have inherited Source B history because preview origins may isolate storage.
- Target intelligence is absent by design and remains N/A.
