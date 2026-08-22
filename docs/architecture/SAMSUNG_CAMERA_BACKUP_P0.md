# Samsung camera and backup P0

Base: `f16dd2744d31993cfd7b7fae2898523b99537964`

Build: `0.7.15 · 2026.08.22.samsung-camera-backup-p0-1`

This correction preserves the accepted 0.7.14 rally, session, evidence, Ride Memory, and Trail Intel behavior. It changes the Samsung camera hardware lifecycle and the automatic external-backup transport only.

## Pre-change camera audit

- Samsung used the `retain-all` policy. Preflight opened rear and front streams, proved one native still on each, and retained both streams.
- At most two application-owned `MediaStream`s and two video tracks could remain live. Both could remain live after preflight, a checkpoint pair, or a Ride Memory pair.
- Capture reused the retained stream, track, and `ImageCapture` across later checkpoints and Ride Memory slots.
- A `takePhoto()` timeout released CannonMap's wait after 2.5 seconds but could not cancel Chromium's underlying promise. Only the failed role was stopped; the other camera could remain live.
- The checkpoint/Ride Memory arbiter serialized normal work and gave checkpoints priority. Camera-readiness probing was outside that application arbiter.
- READY required an earlier real rear/front native-still probe and usable retained session. It did not prove that the next `takePhoto()` would resolve.
- A normal visibility interruption aborted the active workflow but intentionally retained camera streams. Page/scope teardown stopped them.
- Landscape constraints were advisory. Actual native JPEG dimensions were retained without rotation or resizing.

## Exclusive sequential ownership

Production ownership is now:

`IDLE → OPEN ROLE → SETTLE → TAKE NATIVE STILL → CLOSE ALL TRACKS → COOLDOWN → NEXT ROLE`

- One exclusive camera lease and one live physical stream maximum.
- One application-owned camera lease and one logical `takePhoto()` maximum in flight inside CannonMap. Chromium does not expose cancellation for a timed-out `takePhoto()` promise; CannonMap stops its track, discards any late result, and retries only on a fresh track/ImageCapture.
- Preflight probes rear, closes it, waits for handoff, probes front, and closes it. READY is a verified capability state with zero retained streams.
- Every checkpoint and Ride Memory role opens a fresh stream and `ImageCapture`, then stops all tracks and releases references before another role can open.
- Hidden/page/scope transitions abort work and tear down the lease. Returning visible requires readiness revalidation.
- Full native capability maxima remain requested; this branch does not reduce resolution.
- An explicitly wrong facing mode fails preflight and capture. A browser that omits facing metadata remains compatible, but a reported front-for-rear or rear-for-front result cannot satisfy checkpoint Evidence.

## Timeout and recovery

- Each native `takePhoto()` has a 10-second deadline. This is inside the requested 8–12 second field window while allowing the Samsung's demonstrated full-resolution JPEG work.
- The first native failure or timeout closes the entire lease, waits a bounded 500 ms handoff plus camera-session backoff, opens a new stream, creates a new `ImageCapture`, and permits exactly one native retry.
- A recovered native still records `recoveryPath: native-retry-success` and `nativeRetryCount: 1`.
- A second native failure closes the lease and tries one fresh, non-upscaled preview-frame JPEG. It is labelled `sourceKind: fallback-video-frame`, `nativeStill: false`, and `derivedFromVideoFrame: true`.
- If no safe frame exists, the capture fails truthfully. GPS arrival and the existing pending-evidence recovery path remain authoritative.
- Repeated failures apply bounded exponential camera-acquisition backoff; no retry loop owns GPS, Rally Mode, Trail Intel, or backup scheduling.

Checkpoint scoring still requires native checkpoint evidence. A fallback frame is stored as a diagnostic Original with no Evidence derivative, no evidence pair membership, and no score effect. Ride Memory may retain the same truthful fallback as a memory Original because Ride Memory is never checkpoint evidence.

## Pre-change backup audit

- `createStoredZip` rejected declared input above exactly 256 MiB (`268,435,456` bytes). ZIP headers were outside that declared-byte guard.
- Day backup included all session Originals, all checkpoint Evidence derivatives, Ride Memory Originals, and four JSON entries.
- A complete checkpoint pair contributes four assets. A normal Ride Memory slot contributes two Originals. A clean 96-record example could therefore be 18 checkpoint pairs plus 12 memory slots, but retries and abandoned media mean the physical manifest is required for an exact breakdown.
- IndexedDB `getAll()` hydrated all selected JPEG bytes. ZIP creation made another byte view for every Blob. Verification reopened the full ZIP, copied entries, and inspected it again. The manual UI also loaded project media before the exporter loaded it again.
- Peak transient backing was approximately five to six times selected payload, implementation-dependent. Raising the archive cap would increase crash risk.
- The supposedly compact recovery descriptor retained hydrated `binaryData`, unintentionally duplicating complete JPEG bytes into `recoverySnapshots`.
- File System Access already supported a persisted user-selected directory and verified single-file writes. OPFS was not in the architecture and is not introduced here.

## Incremental external backup

Authoritative JPEG bytes remain in `missionMedia` IndexedDB. Automatic external backup no longer builds a full-day ZIP when the folder adapter supports incremental generations.

- IndexedDB cursor queries return binary-free session media descriptors.
- Recovery references explicitly reject Blob, ArrayBuffer, and typed-array payloads.
- One media Blob is opened, checksummed, written, reopened, and verified at a time.
- The external directory contains a human-readable session folder, immutable content-addressed media files, and unique generation manifests.
- Each media file uses a temporary name, is reopened and SHA-256 verified, and is finalized before the next item.
- Existing files are skipped only after reopened size and SHA-256 match.
- A generation manifest containing Project/session/run/day/build/cache identity, checkpoint summary, Journal, media index, byte sizes, SHA-256 values, filenames, GPS, and provenance is written and verified last. It is the commit marker.
- Restart reconciliation scans verified content and does not recopy it. Stale `.partial` files are identified and cleaned when directory enumeration is supported.
- Permission is queried before unattended writes. Revocation returns NEEDS PERMISSION without changing internal recovery or prior external files.
- A failed or interrupted generation never overwrites a prior verified generation.

The legacy `.cmapday.zip` path remains available for bounded small manual downloads and existing restore compatibility. Large manual backups prefer the selected external folder and refuse a high-risk RAM ZIP when folder permission is missing.

## Bounded field diagnostics

The existing 400-entry Rally debug ring records camera ownership, monotonic duration, role verification, track/capability/settings summaries, native result dimensions/bytes, timeout/retry/fallback path, live-stream count, recent recovery/backoff state, visibility, Wake Lock, GPS age/accuracy/speed, storage estimate, viewport/orientation, and build identity. Image bytes and raw device identifiers are excluded. Verbose phases do not expand the durable Journal; recovery/degradation outcomes remain Journaled.
