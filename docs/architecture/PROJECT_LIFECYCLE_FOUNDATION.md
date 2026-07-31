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

Rapid switch requests run in call order. Before flushing, the old scope enters
`draining`; consumer reads and writes fail immediately while manager-owned
flush and commit capabilities remain available. A target scope remains
`opening` and inaccessible to consumers until the durable active identity is
committed. Closed references never become writable again.

Event publication happens after the corresponding durable operation.
Explicitly closing, archiving, or deleting the active Project also clears the
legacy `projects/current` mirror.

## Crash recovery

IndexedDB v7 adds `projectLifecycleState`, keyed by `key`. It stores:

- `activeProject`
- `activeProjectTransition`

Transition stages identify whether a restart should restore the former Project
or finish opening the target. During the ambiguous `committingLegacy` stage,
the manager compares `projects/current` with the target identity. No Project,
Journal, Analytics, or Search data is synthesized during migration.

Initialization validates the durable active identity. Missing or archived
Projects are never activated: lifecycle and legacy-current state are cleared
atomically, producing a deterministic no-active-Project result. Repeating
initialization does not recreate or reverse that repair.

## Repository scoping

`createProjectRepositoryScope` returns separate consumer repositories and a
manager-only lifecycle capability bound to one `projectId`. It:

- Injects or validates Project identity on writes.
- Forces project-scoped Journal and Search queries.
- Rejects consumer operations while `opening`, `draining`, or `closed`.
- Allows controlled transition flush/commit/cache hooks while draining.
- Invalidates the complete consumer handle on close.

The existing repositories retain their APIs for backwards compatibility. New
lifecycle-aware consumers receive repositories only through the active scope.

## Creation and deletion invariants

Project creation uses IndexedDB `add`, never `put`. A duplicate identity throws
`DuplicateProjectError` with code `PROJECT_ALREADY_EXISTS`; it cannot replace
existing metadata. `save` remains the explicit update/upsert operation.

Project deletion uses one IndexedDB transaction spanning `projectRecords`,
Journal, all project-attributed Analytics stores, Search documents and state,
the legacy current record, and lifecycle active state. Any request or boundary
failure aborts the transaction, leaving the complete Project intact. Deleting
one Project cannot affect records attributed to another Project.

The active scope is drained and closed before its atomic deletion begins. If
deletion aborts, the durable active identity remains intact and the manager
reopens a fresh scope before returning the failure.

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
