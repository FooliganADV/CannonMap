# Post-M10 Internal Test Build

## Deployment

- Date: 2026-07-27
- Environment: Cloudflare Pages production deployment used for internal testing
- URL: https://cannonmap.pages.dev/
- Deployed commit: `cbf8c0cacbb06d9a4c240c07c204cf03350b87c4`
- Application version: `0.7.1`
- Build ID: `2026.07.26.07`
- Service-worker cache: `cannonmap-v0.7.1-20260726-07`
- Cloudflare deployment ID: Not exposed by the repository workflow or public deployment

The deployed commit is the merge of PR #22. It includes M10 and the offline-cache correction from `b73cb2697`.

## Validation

- Node tests: 151 passed, 0 failed
- Authoritative Playwright suite: 108 passed, 0 failed, 2 intentional skips (110 total)
- Firebase Security Rules emulator: 8 passed, 0 failed
- Architecture boundary validation: 0 violations
- Vendor validation: 14 assets present
- Required runtime CDN references: 0
- Deployed smoke tests: 4 passed, 0 failed

The deployed smoke matrix covered desktop and iPhone 13 portrait profiles. A fresh browser installed the service worker, loaded the corrected cache, and reloaded successfully offline. An existing browser profile retained its IndexedDB-backed project across the update, online refresh, and offline refresh. Required IndexedDB repository modules returned HTTP 200 and were present in the active application-shell cache.

## Scope and Limitations

- M11 has not started.
- M10 evaluation remains feature-flagged and does not publish visible intelligence by default.
- Secure observation upload remains unavailable without complete Firebase Authentication, App Check, and backend configuration; local observation capture remains available under its existing feature flag.
- Live GPS Checkpoints data, online map tiles, and other third-party network capabilities still require connectivity.
- The Cloudflare workflow did not expose a deployment identifier to repository tooling; the deployed SHA, build ID, and service-worker cache version provide the auditable release identity.

## Rollback

Use Cloudflare Pages deployment history to restore the immediately preceding successful deployment, or redeploy the prior main commit `a3a4e1bb1e86a0f57e27e9bfac618b2ba8146c5e`. Do not downgrade or clear IndexedDB. Keep secure upload and M10 publication-related feature flags disabled during rollback. After restoring, verify the served `app.js` build ID and `sw.js` cache name, then perform one online refresh followed by an offline reload.
