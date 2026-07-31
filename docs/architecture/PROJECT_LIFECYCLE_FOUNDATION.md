# Project Lifecycle Foundation

## Scope

Project Lifecycle makes first-class Projects available through one authoritative
application service without adding Project Switching UI or changing current
Planner, Rally Mode, Mission Control, or import/export workflows.

The lifecycle manager owns:

- Project creation, opening, closing, renaming, archiving, and deletion
- Active Project identity
- Serialized active-Project transitions
- Project-scoped repository handles
- Durable crash-recovery markers
- Compatibility writes to `projects/current`
- Project lifecycle events

Existing application code is not wired to the manager in this increment.
`projects/current` therefore remains the compatibility source used by existing
workflows while new consumers can depend on `getActiveProject()`.

## Safe transition sequence

Opening another Project is serialized and performs:

1. Persist a transition marker.
2. Flush pending writes in the old Project scope.
3. Commit Journal work.
4. Commit Analytics work.
5. Commit Search work.
6. Close and invalidate the old repository scope.
7. Create the target Project scope.
8. Rebuild target caches.
9. Write the target to legacy `projects/current`.
10. Atomically persist the new active identity and clear the marker.
11. Publish lifecycle events.

Rapid switch requests run in call order. Event publication happens after the
corresponding durable operation. Closing a scope makes all later reads and
writes through that stale handle fail. Explicitly closing, archiving, or
deleting the active Project also clears the legacy `projects/current` mirror.

## Crash recovery

IndexedDB v7 adds `projectLifecycleState`, keyed by `key`. It stores:

- `activeProject`
- `activeProjectTransition`

Transition stages identify whether a restart should restore the former Project
or finish opening the target. During the ambiguous `committingLegacy` stage,
the manager compares `projects/current` with the target identity. No Project,
Journal, Analytics, or Search data is synthesized during migration.

## Repository scoping

`createProjectRepositoryScope` binds Journal, Analytics, and Search adapters to
one `projectId`. It:

- Injects or validates Project identity on writes.
- Forces project-scoped Journal and Search queries.
- Runs transition flush/commit/cache hooks.
- Invalidates the complete handle on close.
- Exposes a deletion hook for future per-Project cleanup.

The existing repositories retain their APIs for backwards compatibility. New
lifecycle-aware consumers receive repositories only through the active scope.

## Lifecycle API

`createProjectLifecycleManager(...)` exposes:

- `initialize()`
- `getActiveProject()`
- `getActiveRepositories()`
- `listProjects()`
- `createProject(input, {activate})`
- `openProject(projectId)`
- `setActiveProject(projectId)`
- `closeProject()`
- `renameProject(projectId, name)`
- `archiveProject(projectId)`
- `deleteProject(projectId)`
- `flush()`

## Events

The manager publishes the existing event-bus contract with these types:

- `projectCreated`
- `projectOpened`
- `projectClosed`
- `projectArchived`
- `projectDeleted`
- `activeProjectChanged`

## Deferred work

Project Switching UI, automatic integration into legacy screens, removal of
`projects/current`, Backup, Templates, Journal UI, and cross-device Project
synchronization are separate increments.
