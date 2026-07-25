# Playwright startup fails when CDN access is unavailable

Severity: High
Root Cause: `index.html` loads Leaflet, Leaflet-Geoman, SheetJS, and Firebase from external CDNs. The current Playwright environment rejects those requests with `net::ERR_NETWORK_ACCESS_DENIED`; `app.js` then throws `L is not defined` during map initialization and never reaches UI wiring, the readiness marker, or service-worker registration. This one cause produces 19 failures across project import, the Rally Mode checkpoint workflow, GPX import/export, and offline startup.
Affected Files: `index.html`, `app.js`, `sw.js`, `playwright.config.mjs`, `tests/browser/rally-mode.spec.mjs`
Affected Features: Application startup, map rendering, project import, Rally Mode checkpoint workflow, GPX import/export, offline application shell
Recommended Fix: Make pinned third-party dependencies available from the local application/test server, add explicit startup dependency diagnostics, and ensure service-worker installation is not blocked by optional application initialization. Rerun all five Playwright projects under restricted-network conditions.
Dependencies: Decision on bundled or vendored assets and the production service-worker caching policy.
Status: Open. GitHub issue creation was attempted on 2026-07-25 but the repository integration returned HTTP 403, so this local issue record is the authoritative fallback.
