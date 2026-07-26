# Release plan

## Current QA status

The Rider Manager branch expands the authoritative matrix to 85 cases: 83
passed, 0 failed, and 2 intentional desktop skips. Rider Manager coverage passed
35/35 across phone portrait, phone landscape, and desktop profiles; startup
passed 20/20 and offline-shell startup passed 5/5. Node/unit coverage is 33/33.

The authoritative 2026-07-25 Playwright run on
`agent/local-runtime-dependencies` executed 50 cases serially: 48 passed, 0
failed, 2 intentionally skipped, and 0 timed out. The original 19 CDN-blocking
failures are resolved.

The two skips remain the intentional desktop exclusions for the mobile-only
checkpoint workflow and mobile layout test. Node tests pass 21/21. Vendor
validation confirms all 12 required local assets exist and no Leaflet, Geoman,
SheetJS, or Firebase runtime CDN reference remains in `index.html`.

## Prioritized remediation

1. **Complete — deterministic dependencies.** Exact versions are managed by pnpm, copied to `vendor/`, loaded locally, and included in the application-shell cache.
2. **Complete — resilient startup.** Required failures expose deterministic diagnostics; optional Firebase failure does not block the shell or service-worker registration.
3. **Complete — browser regression coverage.** The suite covers local startup, required dependency failure, optional Firebase failure, and cached offline vendor assets in all profiles.
4. **Before promotion — release-environment smoke test.** Confirm the deployed static host serves every `vendor/` path with expected content types.
5. **Before rally use — field verification.** Exercise live Firebase subscriptions and map-tile connectivity with representative event data; those live network services are intentionally not cached as shell assets.

## Recommended fix order

Perform the static-host smoke test, then live-feed verification, then the normal
America 250 field checklist. The CDN startup blocker no longer gates feature QA.

## America 250 risks

- External map tiles, weather, traffic, REST metadata, and live Firebase data still require their respective networks; only the application shell is offline-capable.
- The committed vendor directory must be included unchanged by the production deployment.
- Five parallel local workers caused transient Chromium process closures; serial execution passed the complete matrix. CI worker capacity should be calibrated before making high parallelism a release gate.
- Live event credentials, Firebase availability, GPS accuracy, and field connectivity remain operational risks outside deterministic shell testing.
- Rider Manager preferences are device-local; they do not synchronize between
  phones or browsers.
- Breadcrumb visibility is ready for existing or feed-provided rider layers,
  but local breadcrumb recording remains intentionally deferred.

## Exit criteria

- [x] Third-party assets load without external network access during Playwright.
- [x] Missing required dependencies produce explicit diagnostics without an uncaught `L` error.
- [x] `data-cannonmap-ready` is set after successful initialization in every browser project.
- [x] Offline reload is controlled by the installed service worker.
- [x] Full result is 48 passed, 0 failed, 2 documented skips, 0 timed out.
- [ ] Verify the draft PR stack on the production-equivalent static host.
- [ ] Complete representative live Firebase and field-network smoke tests.
