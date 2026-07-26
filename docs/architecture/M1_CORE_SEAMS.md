# Milestone M1: Core seams

## Scope

M1 extracts behavior-preserving core seams for clocks, IDs, errors, geometry,
in-process events, and application state. `app.js` remains the composition root
and consumes the new modules through `src/core/compatibility.js`.

The compatibility facade deliberately returns the same mutable state shape used
by the legacy application. Reducer-driven state migration is deferred to later
extractions; M1 introduces the tested store interface without changing current
rendering, persistence, or UI behavior.

## Compatibility and rollback

- The facade owns creation of the legacy state object and ID generator.
- Existing geometry call sites retain their names and golden outputs.
- The event bus and reducer store have no production subscriptions or reducers
  in M1, so they cannot alter current behavior.
- The service-worker shell includes every imported module for offline startup.
- Rollback: restore the classic `app.js` script tag and legacy declarations,
  remove the M1 module paths from the service-worker shell, then remove `src/`.

## Acceptance evidence

- Core unit tests cover deterministic clocks and IDs, geometry vectors, event
  immutability and subscription identity, reducer mutation logs, and facade
  state defaults.
- Architecture dependency checks prohibit core/domain imports from higher
  layers and prohibit modules from importing `app.js`.
- The authoritative Node, vendor, browser, startup, and offline baselines must
  remain green before M1 is proposed for merge.
