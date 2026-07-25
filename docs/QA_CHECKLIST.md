# QA checklist

## Stationary-event acceptance

- [ ] No event appears at 2:59; one appears at 3:00.
- [ ] Breadcrumb clusters inside 150 meters qualify.
- [ ] Sustained movement outside the area does not qualify.
- [ ] One GPS outlier does not close an active event.
- [ ] Two meaningful exit breadcrumbs close the active event.
- [ ] Duration advances without creating duplicate markers.
- [ ] Completed events survive save/reload and later breadcrumb pruning.
- [ ] Events remain isolated by rally event and competitor.
- [ ] Marker shows the rider's Competitor Signature and is at least 44px.
- [ ] Nearby markers can each be tapped.
- [ ] Popup contains every required detail and action.
- [ ] Zoom centers the true event location at zoom 18.
- [ ] Satellite imagery remains selectable after zoom.
- [ ] No UI text labels an event as fuel or a gas station.
- [ ] Hiding a trail does not remove its stationary-event history.

## Playwright root-cause audit — 2026-07-25

Branch under test: `agent/stationary-event-detection` at `830d967`.

Command: `playwright test --workers=5 --reporter=line`

| Result | Count |
| --- | ---: |
| Total | 30 |
| Passed | 9 |
| Failed | 19 |
| Skipped | 2 |

The two skips are intentional desktop exclusions in `tests/browser/rally-mode.spec.mjs`: the checkpoint workflow and mobile-control layout test. The nine passes cover mileage deduplication in all five projects and mobile Rally Mode layout in all four mobile projects.

### Environment evidence

A separate headless-browser diagnostic captured failed requests to the pinned Leaflet, Leaflet-Geoman, SheetJS, and Firebase CDN assets with `net::ERR_NETWORK_ACCESS_DENIED`. The resulting page error was `ReferenceError: L is not defined`. At five seconds, `window.CannonMapTest` existed, but `window.L`, `window.firebase`, and `document.documentElement.dataset.cannonmapReady` did not. The map remained blank.

This establishes a single primary cause for all 19 failures: **C. test-environment/configuration issue**. The current local Playwright server does not provide the third-party runtime dependencies, while the execution environment denies their CDN requests. Initialization aborts in `initMap()` before `wireUi()`, the readiness marker, and service-worker registration. No assertion evidence identifies an outdated expectation, a feature-specific application regression, or a known pre-existing feature defect.

### Failure analysis

**`project import filters Old Coast Road and preserves nearby features` — 5 failures (all projects).** Affected feature: project import and sanitization. Classification: **C. test-environment/configuration issue**. Severity: **High**. Every profile times out at `tests/browser/rally-mode.spec.mjs:8` waiting for `data-cannonmap-ready`; the input and feature assertions are never reached. The blank-map screenshot and independent browser diagnostic show that the missing CDN-provided `L` global stops `app.js:1361-1372` during `initMap()` (`app.js:105`) before readiness is set. Involved sources: `index.html`, `app.js`, `playwright.config.mjs`, and `tests/browser/rally-mode.spec.mjs`.

**`checkpoint defer, restore, complete, scoring, hotel bailout and undo` — 4 failures (all mobile projects; desktop skipped).** Affected feature: Rally Mode checkpoint workflow, scoring, bailout, and undo. Classification: **C. test-environment/configuration issue**. Severity: **High**. These cases call the same `loadProject()` helper and fail at the identical readiness wait before any Rally Mode interaction or score assertion. The cross-profile consistency and shared `L is not defined` startup error are evidence against a stationary-event or checkpoint regression. Involved sources: `index.html`, `app.js`, `playwright.config.mjs`, and `tests/browser/rally-mode.spec.mjs`.

**`GPX import and export remain available` — 5 failures (all projects).** Affected feature: GPX import/export. Classification: **C. test-environment/configuration issue**. Severity: **Medium**. The test waits only for `window.CannonMapTest`, which is exported before asynchronous initialization completes. It then uploads the fixture, but the dialog stays hidden because the `gpxInput` change handler at `app.js:1309` is installed by `wireUi()` only after the failing map initialization. The parser/export assertions are never exercised. Involved sources: `index.html`, `app.js`, `playwright.config.mjs`, and `tests/browser/rally-mode.spec.mjs`.

**`application shell starts offline after installation` — 5 failures (all projects).** Affected feature: offline application-shell startup. Classification: **C. test-environment/configuration issue**. Severity: **High**. Each profile reaches the offline reload and receives `net::ERR_INTERNET_DISCONNECTED`. The service worker is registered only at `app.js:1372`, after initialization and the readiness marker; the earlier missing-Leaflet exception prevents registration, so no service worker controls the offline navigation. Involved sources: `index.html`, `app.js`, `sw.js`, `playwright.config.mjs`, and `tests/browser/rally-mode.spec.mjs`.

### Draft pull requests inspected

- Draft PR #4, `rally-mode-reset` into `main`: open and mergeable; establishes the Rally Mode base.
- Draft PR #5, `agent/gps-checkpoints-live-feed` into `rally-mode-reset`: open and mergeable; adds the GPS Checkpoints/Firebase integration.
- Draft PR #6, `agent/stationary-event-detection` into `agent/gps-checkpoints-live-feed`: open and mergeable; current QA baseline at `830d967`.

### Release gate

- [ ] Make third-party browser dependencies deterministic in local and CI Playwright runs.
- [ ] Confirm the application reports a clear startup dependency error instead of silently remaining unready.
- [ ] Confirm service-worker installation is not prevented by an optional runtime initialization failure.
- [ ] Rerun all 30 cases in the same restricted-network environment.
- [ ] Require 28 passes and only the two documented desktop skips before release approval.
