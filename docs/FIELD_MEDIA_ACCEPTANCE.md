# Field Media Acceptance

These checks validate a branch preview on real hardware. They do not declare field readiness until the motorcycle test is completed. Keep production untouched and record the preview URL, build ID, device, OS, browser, and test time with each result.

## Browser limitations to record

- iPhone Safari may not expose `ImageCapture.takePhoto()`. In that case CannonMap must use the manual file-input fallback; iOS owns the native shutter, `Use Photo`, and `Retake` controls and the web app cannot bypass them.
- A camera `facingMode` or file-input `capture` value is a request, not a guarantee. Record the actual lens where the browser reports it and mark the selection unknown when it does not.
- Browsers can deny camera, persistent storage, or Screen Wake Lock because of permission, security context, power state, or lifecycle rules. None of these denials may fabricate evidence, discard Originals, or prevent truthful checkpoint credit under the documented speed policy.
- Background camera capture is not promised. Automatic capture is accepted only when verified on that exact phone/browser in the foreground Rally Mode flow.

## Android home test

Use a Samsung or comparable Android phone in Chrome. Install/open the branch preview, grant camera and location only when prompted, load a disposable two-checkpoint project, and select its active day.

1. **Automatic paired checkpoint capture**
   - Start GPS and approach/simulate the first checkpoint.
   - Verify CannonMap attempts rear/road then front/rider capture without a shutter tap when `ImageCapture.takePhoto()` is supported.
   - Verify successful capture stays on the Rally map, is silent, credits the checkpoint, and shows no success dialog.
   - In Journal, verify detection, stabilization, primary capture, selection, Original ID, Evidence ID, and completion events for both sides.
2. **Camera selection and image integrity**
   - Verify the road image came from the rear camera and the rider image came from the front camera.
   - Export Day Photos. Record pixel dimensions, byte size, and MIME type for both Originals and Evidence files.
   - Verify each Original is the highest-resolution native still provided, is not upscaled, and is byte-independent from its Evidence derivative.
3. **Automatic quality retry**
   - If a clearly poor primary can be produced, verify CannonMap makes at most one automatic backup attempt and records which image it retained.
   - If quality is indeterminate, verify the primary is retained rather than destructively guessed away.
4. **Manual fallback**
   - Deny or disable automatic still capture while stationary.
   - Verify the full CannonMap capture surface opens, has no visible countdown or review screen, and taps near the top-left, center, and bottom-right each start the missing capture.
   - Complete the rear/front pair and verify success returns directly to the Rally map with the checkpoint credited. Verify the native Android shutter/confirmation remains only where the browser requires it.
5. **Journey Photo**
   - Verify there is one `Journey Photo` action and no separate Journey Selfie/Forward actions.
   - Trigger it and verify one logical rear/front pair is stored and visible in the Journey gallery/export.
6. **Portrait and landscape**
   - Repeat checkpoint fallback and Journey Photo in both orientations.
   - Verify the map and required actions remain usable with no clipping, overlap, or off-screen shutter surface.
7. **Storage and Wake Lock**
   - Open storage diagnostics. Verify the preferred 10 GB mission-media budget is labeled as a planning target, separate from actual browser usage/quota and persistence status.
   - Verify the remaining estimate is expressed in paired captures. Confirm quota/persistence denial does not delete media or block Rally Mode.
   - Where Wake Lock is supported, verify it is requested only while active Rally Mode/GPS is operating, returns after tab visibility is restored when allowed, and releases when Rally Mode/GPS stops.

Record each item as Pass, Fail, Unsupported, or Not exercised. `Unsupported` is acceptable for automatic native still capture only when CannonMap enters the documented manual fallback without losing checkpoint credit or fabricating media.

## Motorcycle test

Use the rally phone mounted as intended. Conduct the test on a safe route with a passenger/test assistant or closed-course conditions; do not operate diagnostic controls while riding.

1. **Moving checkpoint trigger**
   - Start GPS and approach a test checkpoint at normal riding speed.
   - Verify GPS follow remains smooth and the checkpoint triggers inside its configured radius.
   - Verify supported automatic paired capture is silent, causes no screen takeover on success, credits the checkpoint, and keeps the Rally map usable.
2. **Out-of-order collection**
   - Set CP 37 as the active target, then enter CP 42's radius first.
   - Verify CP 42 is captured/credited, closely spaced arrivals are queued rather than lost, and CP 37 returns as the active target if still uncollected and not deferred.
3. **Failure policy**
   - At more than 10 mph, force complete camera failure. Verify no interruption or visible error, GPS evidence is retained, the checkpoint is credited, and Journal truthfully records unavailable photo evidence and speed.
   - At 10 mph or less, force complete camera failure. Verify the full-screen manual fallback appears with no countdown. Tap anywhere to capture; verify success returns to the map.
   - Repeat without tapping for 60 seconds. Verify CannonMap records expiration, credits that exact checkpoint, restores the prior active target, keeps the active day in Rally Mode, and creates no fake photo.
4. **Adaptive map focus**
   - With GPS follow active, approach a significant route turn and a checkpoint at different distances.
   - Verify the nearer actionable event receives useful map context without constant zoom animation.
   - Pan manually and verify automatic focus pauses temporarily, then resumes sensibly when explicitly recentered.
5. **Landscape mounting**
   - Repeat checkpoint trigger, failure fallback, and primary Rally actions in landscape.
   - Verify no clipping or overlap and that the entire fallback view remains tappable with gloves.
6. **End-to-end evidence**
   - Capture a checkpoint, Journey Photo, and hotel pair; finish and back up the day.
   - Export Day Photos, Journal, and `.cmapday`; verify front/rear pairing, Original/Evidence identity, image quality, failure truthfulness, and Journal linkage survive export/restore.
   - Interrupt one capture after only the road side is durable. Back up and restore the day; verify the partial pair and pending objective survive without inventing the missing rider side.

Field acceptance requires the exported evidence and Journal to agree with what happened on the motorcycle. Automatic capture must be reported as supported only on the exact device/browser combination that completes this test without rider interaction.
