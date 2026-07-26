# Milestone M4: Project and Rally extraction

## Scope

M4 moves existing project/import/export workflows, checkpoint rules, Rally
presentation, and Rally DOM event wiring out of `app.js` without changing
behavior. `app.js` remains the composition root and compatibility boundary.

## Ownership

- `src/application/project-workflows.js` owns day assignment, GPX parsing and
  generation, duplicate detection, merge/add/replace behavior, portable project
  validation/serialization, feature duplication, and manifest rows.
- `src/domain/checkpoints/workflow.js` owns checkpoint normalization, ordering,
  current selection, score calculation, lifecycle transitions, and hotel
  bailout mutation rules.
- `src/ui/project/controller.js` owns project file/import/export DOM event
  wiring.
- `src/ui/rally/presenter.js` renders Rally view models and checkpoint order.
- `src/ui/rally/controller.js` owns Rally control DOM event wiring.
- `app.js` injects clocks, IDs, XML parsing, prohibited-feature filtering,
  state, persistence, map/navigation, status, and rendering callbacks.

The compatibility functions published through `window.CannonMapTest` retain
their existing names and semantics.

## Dependency direction

Project application workflows depend only on domain geometry and injected
ports. Checkpoint rules are pure domain functions. UI controllers and
presenters receive data and callbacks from composition; they do not import
`app.js`, infrastructure, Firebase, IndexedDB, or map implementations.

## Behavior and authority

Legacy `app.js` orchestration remains authoritative. Project persistence stays
on the existing IndexedDB path. M2 flags, M3 map ownership, Firebase listeners,
service-worker runtime behavior, and all Rally UI behavior are unchanged.

## Rollback

Revert the single M4 commit. This restores the in-file project and Rally
implementations and the prior service-worker cache manifest. No database,
Firebase, project-file, GPX, or checkpoint schema migration is involved.
Deploy the restored shell with its prior cache name; user projects remain
compatible and require no data rollback.

## Known deferrals

Observation Collector, observation capture, quality scoring, sensor sampling,
durable observation queues, and observation state machines remain Milestone M5.
Commitment, Route Family, Confidence Evolution, publication, Co-Driver, and
server intelligence remain later milestones.

## Acceptance evidence

Domain/application tests cover checkpoint transitions and scoring, hotel
bailout, project duplication and portable load/save, duplicate-aware import,
and GPX semantic output. The complete Rally browser matrix verifies imports,
exports, checkpoint workflow, hotel bailout/undo, controls, and offline startup.
