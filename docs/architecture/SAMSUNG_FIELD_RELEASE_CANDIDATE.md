# Samsung Field Release Candidate

Build: `0.7.16 · 2026.08.24.samsung-field-rc-1`

Base: `bcac81f97854e0a239049fdbef5a509e2df0c9ef`

This correction is intentionally limited to the August 22 physical Samsung findings. It preserves the 0.7.15 exclusive camera leases, ten-second native-still deadline, one fresh native retry, truthful diagnostic fallback, incremental external backup, Rally session/evidence model, and Trail Intel pipeline.

## 0.7.15 lifecycle audit

1. On `visibilitychange` to hidden, the camera session tore down its active lease and cleared its verified roles. `pagehide` also tore the session down. The camera-readiness service itself was not invalidated synchronously.
2. During device sleep JavaScript is suspended. Its in-memory readiness projection could therefore remain the result of the earlier probe until a resume handler ran.
3. `permission`, `capability: ready`, `automaticCaptureEligible`, `verifiedNativeStill`, `verifiedCameraRoles`, `currentSessionVerified`, and `lastVerifiedAt` could remain in the readiness service after the camera session had been torn down.
4. Yes. UI code read that service projection, so it could briefly or indefinitely show historical READY if the lifecycle callback was delayed or missed.
5. Resume requested a forced inspection, but hidden did not first invalidate the service projection and there was no lifecycle generation.
6. Resume normally requested a rear/front probe, but it was an unfenced asynchronous operation and was not checkpoint-aware.
7. Yes. While the resume operation published `checking`, checkpoint capture only had special recovery for exactly `interrupted`; its readiness assertion could reject before invoking the proven 0.7.15 capture state machine.
8. Camera permission query, `getUserMedia`, `ImageCapture`, and local persistence are not network-dependent. Offline-shell inspection and live polling are separate tasks; they must not govern camera authorization.
9. GPS health, Wake Lock, camera inspection, storage/backup inspection, evidence reconciliation, and live polling were all started from the same resume events. They were asynchronous, but camera inspection had no priority fence against checkpoint capture.
10. Yes. The readiness service reused global inspection/probe promises without a lifecycle generation, so an older operation could publish after a newer lifecycle or capture result.

No camera stream is deliberately retained by the 0.7.15 or 0.7.16 readiness paths. The ownership defect was stale service state and unfenced asynchronous work, not retained dual-camera hardware.

## Foreground-resume barrier

Hidden/pagehide now aborts an active automatic capture, closes the camera session, and invalidates only operational readiness. Browser permission remains `granted`, `prompt`, `denied`, or `unknown` as reported; it is not fabricated or revoked.

Visible/pageshow now:

1. marks the camera session visible;
2. advances a lifecycle cycle and a camera operational generation;
3. clears historical READY, verified roles, and `lastVerifiedAt`;
4. starts one event-driven, bounded rear-then-front operational probe for an active Rally day;
5. leaves zero streams after the probe; and
6. discards any result whose lifecycle or readiness generation has been superseded.

GPS watchdog, Wake Lock reacquisition, storage/backup checks, and live polling remain independent. No network request participates in local camera revalidation.

If a checkpoint arrives during revalidation, the arrival and Journal record are persisted first. The checkpoint camera arbiter then advances the readiness generation, tears down the lower-priority probe, and directly invokes the existing exclusive rear/front production capture. It does not wait for a cosmetic READY projection and it does not add a retry loop. Prompt, denied, and unknown permissions are never discovered automatically.

## Pending-evidence progression

The arrival coordinator freezes target context when a radius dwell begins. In overlapping radii, CP2 could begin its dwell while CP1 was current; CP1 could then durably arrive and advance navigation to CP2 before CP2's dwell was accepted. Treating the frozen entry context as current route authority falsely marked CP2 out of order. Later completion code also inferred restoration from a Boolean instead of proving that the exact recorded prior target still owned navigation.

Durable arrival now canonicalizes route context against the live `ACTIVE` target at the moment the arrival transition begins. Frozen dwell context remains diagnostic only. Restoration requires all three facts: the durable arrival was canonically out of order, it named a prior target, and that exact target is still `ACTIVE` when completion occurs. Delayed CP1 evidence therefore cannot move navigation backward after CP2 completes.

## Ride Memory and backup audit

The current Ride Memory service writes one rear Original and one front Original per successful slot. It sets `captureType` and `objectiveType` to `ride_memory`, sets `evidenceRequired: false`, and never calls the Evidence derivative path. The export category is `Ride_Memories`; a new archive regression proves two Originals, zero Evidence records, and zero evidence pairs. No physical backup archive was available in this worktree, so the apparent field files cannot be attributed further without their manifest/media index.

The 0.7.15 incremental external backup implementation is unchanged. Media is copied and SHA-256 verified in bounded individual units, incomplete generations reconcile on resume, and a generation manifest is committed last. Permission revocation leaves internal recovery and prior verified external files untouched.
