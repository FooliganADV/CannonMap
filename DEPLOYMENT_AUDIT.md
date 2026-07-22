# CannonMap deployment parity audit

Audit date: 2026-07-21

- Production deployment branch: `main`
- Production deployment commit: `c119a15` (`Merge pull request #3 from FooliganADV/fix/radar-animation-route-coverage`)
- Cloudflare Pages configuration: static files served from the repository root; no framework preset, build command, or generated output directory
- GitHub `main` version: Beta `0.6.2`, build `2026.07.21.02`
- Public deployment version: Beta `0.6.2`, build `2026.07.21.02`
- Service-worker cache: `cannonmap-v0.6.2-20260721-02`

## Finding

Cloudflare and GitHub were already in parity when tested with uncached requests. The reported Beta 0.5.0 display was caused by an older browser/PWA service worker continuing to serve its installed application shell until the updated worker activated and the page was reopened. It was not caused by Cloudflare deploying the wrong branch or commit.

Every release must update all four version markers together: `APP_VERSION`, `BUILD_ID`, the visible version in `index.html`, and the cache name in `sw.js`.
