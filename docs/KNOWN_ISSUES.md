# Playwright startup fails when CDN access is unavailable

Severity: High
Root Cause: `index.html` loads Leaflet, Leaflet-Geoman, SheetJS, and Firebase from external CDNs. The current Playwright environment rejects those requests with `net::ERR_NETWORK_ACCESS_DENIED`; `app.js` then throws `L is not defined` during map initialization and never reaches UI wiring, the readiness marker, or service-worker registration. This one cause produces 19 failures across project import, the Rally Mode checkpoint workflow, GPX import/export, and offline startup.
Affected Files: `index.html`, `app.js`, `sw.js`, `playwright.config.mjs`, `tests/browser/rally-mode.spec.mjs`
Affected Features: Application startup, map rendering, project import, Rally Mode checkpoint workflow, GPX import/export, offline application shell
Recommended Fix: Make pinned third-party dependencies available from the local application/test server, add explicit startup dependency diagnostics, and ensure service-worker installation is not blocked by optional application initialization. Rerun all five Playwright projects under restricted-network conditions.
Dependencies: Decision on bundled or vendored assets and the production service-worker caching policy.
Status: Resolved on `agent/local-runtime-dependencies` on 2026-07-25. Leaflet 1.9.4, Leaflet-Geoman 2.18.3, SheetJS 0.18.5, and Firebase 8.10.0 are pinned, vendored, loaded locally, and cached by the service worker. The authoritative serial Playwright run completed with 48 passed, 0 failed, 2 skipped, and 0 timed out. A five-worker run exposed Chromium process closures under local resource pressure, but the same cases passed serially and no product assertion remained failing.
