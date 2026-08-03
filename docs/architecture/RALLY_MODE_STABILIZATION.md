# Rally Mode Stabilization

## Authoritative runtime state

High-frequency GPS observations are inputs. Checkpoint, photo, deferred, and
day transitions are controlled domain events. Project `rallyExecution` state is
serializable and persisted with the Project; Journal events remain append-only
audit evidence in IndexedDB.

Day completion is durable. Completing the hotel finalizes the active day and
records its summary, but does not mutate the active day. Only the rider's
explicit **Start Day N** action activates a later day.

## Checkpoint state and color contract

Each color has exactly one meaning:

| State | Color | Meaning |
| --- | --- | --- |
| `unavailable` | gray `#64748b` | Objective cannot currently be attempted |
| `upcoming` | blue `#38bdf8` | Planned but not active |
| `active` | green `#22c55e` | Current collection objective |
| `photo_required` | purple `#a855f7` | Arrival recorded; required photo pending |
| `deferred` | amber `#f59e0b` | Explicitly postponed and still uncollected |
| `collected` | slate `#475569` | Successfully completed |
| `failed` | red `#ef4444` | Explicitly failed or skipped |

Legacy `planned`, `next`, `completed`, `skipped`, and `unreachable` values are
normalized at the boundary. Yellow/amber is reserved exclusively for deferred
checkpoints.

## GPS follow invariant

Follow intent is owned by `gps-follow-controller`, not by map rendering. GPS
updates place the rider at 62% of viewport height (38% above the bottom), with
moderate coordinate/heading smoothing. Only manual dragging suspends follow.
The GPS control, orientation changes, objective changes, and route rerenders do
not destroy the follow state.

## Capture decisions

Capture uses explicit active state, configured radius, measured distance, and
GPS accuracy. Poor samples are logged and ignored without clearing an existing
arrival candidate. A usable position must remain within the accuracy-adjusted
radius for the configured dwell period. Duplicate completion is rejected by
the collected state and the completion guard.

## Photo gate

Every rally bonus checkpoint creates a blocking `photo_required` transition by
default, including legacy GPX and portable Project imports that have no photo
field. `photoRequired`, `requiresPhoto`, `requirePhoto`, or
`photoRequirement="required"` remains accepted explicit metadata. The documented
exemption is `photoRequirement="optional"` (or `photoExempt=true`). Official
day-finish hotels are exempt by default unless explicitly required. Arrival is
persisted before opening the browser camera. Required checkpoints cannot enter
`collected` until durable media storage and its Journal reference both succeed.
Cancellation, denial/timeout, storage failure, and retry retain the pending
checkpoint. Optional photos never block completion and record whether media was
added.

### Court-quality evidence pairs

Each successful capture is persisted atomically as one untouched camera JPEG
(`role="original"`) and one generated JPEG (`role="evidence"`) sharing a stable
`mediaGroupId`. The evidence footer is rendered entirely offline from the
capture-time GPS, Journal, checkpoint, Project, and already-loaded weather
snapshot; missing values are labeled `Unavailable` and are never estimated.
Journal photo events reference both media identities and the export filename.
Blobs remain project-scoped in `missionMedia`, while Journal records contain
references only. This reference-based contract is also the future cloud-sync
boundary: a provider can transfer media records without changing Project or
Journal schemas.

## Field diagnostics

The bounded Rally Debug Log retains the latest 400 structured entries in local
storage and excludes image content. Mission Control's existing More sheet can
export the log and the project Journal as JSON for field-test inspection.
