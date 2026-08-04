# Mission Control Journey Durability

Mission Control preserves camera originals exactly as supplied by the browser. The media repository stores the native `File` without pixel resizing, JPEG recompression, metadata removal, or quality reduction. Evidence generation uses a canvas with the source image's native pixel dimensions. The Evidence JPEG is a separate record and never replaces the original.

## Failure guarantees

The original is committed before Evidence rendering. If native-resolution Evidence rendering fails, the original remains durable with `evidenceStatus: failed`; Mission Control records a retryable Journal failure and does not complete a photo-required objective. Quota and persistence failures are visible and journaled. CannonMap never deletes media automatically.

Storage Diagnostics uses `navigator.storage.estimate()` when the browser exposes it. It reports browser usage and quota, project and total media sizes, original/evidence pair counts, unresolved failures, recent average original size, and an estimated remaining capture count. Warning thresholds are settings-driven and default to 75% and 90%.

## Journey and project scope

Configured project features are the authority for day numbers. Days are positive integers, may be nonconsecutive, and have no eight-day cap. Day completion resolves the next actual configured day and still requires explicit rider activation.

Project Lifecycle remains the authority for create, open, rename, and archive transitions. Journal events and media records retain `projectId`; switching projects does not move or copy either. Project settings receive a project-scoped compatibility snapshot in local storage.

The journey media index is a projection over media references across projects. It never copies blobs. General Journey Photos use the same original/evidence storage contract with a synthetic `journey:` objective reference and a durable Journal event.

## Exports and backup

Day backup packages contain native originals, native-dimension Evidence images, Daily Journal JSON, a day manifest, a media index, and checkpoint/hotel metadata. Successful backup initiation is journaled and unbacked completed days remain visible in Diagnostics.

ZIP creation has a conservative declared-size guard and rejects an unsafe archive before reading image bytes. Entire Journey export therefore emits one archive per project plus a small journey manifest instead of attempting one unbounded iPhone-memory allocation. It never silently emits a partial archive.

## Recovery

Startup/index reconciliation distinguishes missing Journal media, orphan media, original-without-Evidence, and Evidence-without-original. Evidence generation can be retried from the untouched stored original. Media recovery does not automatically complete a checkpoint; objective recovery remains an explicit, journaled workflow.

