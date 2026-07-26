# Rollback to the M0 Baseline

## Purpose

Restore CannonMap to the verified implementation baseline without rewriting
published history or destroying user work.

Baseline commit:

```text
61a9e885c20bfb18537d1d25550abfc917247c7b
```

## Preconditions

- Identify the exact failing commit and deployment.
- Preserve logs and non-sensitive diagnostics.
- Confirm whether local IndexedDB or service-worker schema changed.
- Do not run destructive Git commands in a dirty worktree.
- Use a clean worktree for diagnosis and rollback preparation.
- Never force-push `main`.

## Code rollback

For an unmerged branch:

1. Stop deployment of the branch.
2. Create a clean worktree from the branch base.
3. Revert the smallest offending commit with `git revert`.
4. Run the baseline suite below.
5. Push the normal revert commit and use the normal review process.

For changes already merged to `main`:

1. Fetch and verify current `origin/main`.
2. Create a rollback branch from `origin/main`.
3. Revert merge/feature commits in reverse dependency order.
4. Do not reset or rewrite `main`.
5. Validate and merge the rollback using a normal merge commit.

## Feature-flag rollback

New architecture and plugins default off. Prefer disabling the narrow feature
flag when:

- the legacy path remains intact,
- stored data is backward compatible,
- disabling does not strand an in-progress migration.

Record the flag, old/new values, time, operator, affected event, and reason.
Active-rally model/version flags remain frozen unless safety requires disabling
the entire new path.

## Persistence rollback

- Never downgrade an IndexedDB database version in place.
- Disable new reads/writes and return to the legacy authoritative store.
- For M2, disable `architecture.indexeddb.v2`; absence of the flag is also off.
- Preserve new stores for investigation; do not delete them during incident
  response.
- Resume from durable migration checkpoints only after the defect is fixed.
- For shadow writes, compare reconciliation reports before reenabling.
- Restore server projections from append-only source records, not client cache.

## Service-worker rollback

1. Deploy a new service-worker cache name containing the known-good shell.
2. Do not reuse a cache name whose content changed.
3. Verify install, activate, cached refresh, and offline startup.
4. Confirm old clients can update without a controller-change reload loop.
5. Keep required local vendor assets present.

## Validation commands

```powershell
pnpm install --frozen-lockfile
node scripts/validate-vendor.mjs
node --test tests/*.test.mjs tests/architecture/*.test.mjs
node node_modules/@playwright/test/cli.js test --workers=1 --reporter=line
node scripts/check-boundaries.mjs
git diff --check
```

Expected M0 production baseline:

- Node/unit: 21 passed, 0 failed.
- Playwright: 48 passed, 0 failed, 2 intentional skips.
- Vendor validation: 12 assets and zero required runtime CDN references.
- Boundary checker: zero violations.

Architecture tests added by M0 increase the post-M0 Node total; they do not
change production behavior.

## Operational verification

- Planner Mode starts.
- Rally Mode starts.
- Project and GPX imports/exports work.
- Checkpoint workflow works.
- Optional Firebase failure does not block the shell.
- GPS listener cleanup remains deterministic.
- Stationary-event behavior remains functional.
- Service worker installs and the cached shell starts offline.

## Completion record

Document:

- incident and affected release,
- reverted commits or disabled flags,
- data/schema impact,
- test results,
- deployment SHA,
- remaining follow-up,
- decision to resume or abandon the change.

