# Release plan

## Current QA status

The 2026-07-25 Playwright run on `agent/stationary-event-detection` (`830d967`) produced 30 total cases: 9 passed, 19 failed, and 2 intentionally skipped. The failures share one root cause: browser access to all externally hosted runtime dependencies is denied, so Leaflet is unavailable and application initialization aborts before UI wiring, readiness, and service-worker registration.

America 250 readiness is **blocked** until the complete Rally Mode, import/export, and offline paths can execute in the release-equivalent environment. The passing calculation and layout tests do not exercise complete application startup and therefore cannot offset this risk.

## Prioritized remediation

1. **High — provide deterministic runtime dependencies.** Bundle or locally serve the pinned Leaflet, Leaflet-Geoman, SheetJS, and Firebase assets used by `index.html`, and define whether production/service-worker caching must include them. This removes the common blocker affecting all 19 failures.
2. **High — make startup and offline installation resilient.** Ensure a missing optional dependency cannot prevent a clear startup status or service-worker registration. Preserve the existing application behavior while making installation order explicit.
3. **Medium — improve test preconditions and diagnostics.** After the runtime fix, have startup-dependent tests wait for the application readiness contract and surface captured page errors and failed requests immediately. This is a follow-up test-maintenance task, not the cause of the current failures.
4. **High — rerun the full matrix.** Execute all five Playwright projects under restricted-network conditions and require 28 passes with only the two intentional desktop skips.
5. **High — perform feature-focused release verification.** Revalidate project import/sanitization, checkpoint scoring and undo, GPX round-trip, offline reload, Firebase live feed, and stationary-event behavior before promoting the stacked draft PRs.

## Recommended fix order

Resolve dependency delivery first, then service-worker/startup ordering, then test diagnostics. Do not investigate the 19 failures as separate feature regressions until the shared startup blocker is removed; the current run never reaches most feature assertions.

## America 250 risks

- Rally Mode checkpoint completion, scoring, hotel bailout, and undo are not end-to-end validated on current mobile profiles.
- Project and GPX imports are not validated, risking inability to load or exchange rally data.
- Offline startup is not validated and currently fails in the restricted test environment.
- GPS Checkpoints and stationary-event changes are stacked on a baseline whose full browser startup cannot currently be proven.
- External CDN availability remains a single point of failure for map rendering and live operations unless dependency delivery is made deterministic.

## Exit criteria

- [ ] Third-party assets load without external network access during Playwright.
- [ ] No uncaught startup page errors occur.
- [ ] `data-cannonmap-ready` is set in every browser project.
- [ ] Offline reload is controlled by the installed service worker.
- [ ] Full result is 28 passed, 0 failed, 2 documented skips.
- [ ] Draft PRs #4, #5, and #6 are retested at their intended stacked revisions.
