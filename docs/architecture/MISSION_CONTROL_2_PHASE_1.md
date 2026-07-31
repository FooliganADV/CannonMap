# Mission Control 2.0 — Phase 1

## Scope

Phase 1 delivers one operational slice: executing the Current Objective. It
does not add route editing, Search, Backup, Template, Analytics, or Journal UI.
Planner and GPX workflows remain intact.

## Current Objective

The mobile map remains the primary surface. Its objective overlay shows only
the checkpoint name, distance, rider notes, CannonRoute intelligence, and
operational warnings. Point value, checkpoint metadata, and the `NEXT` label
are removed. A 48-pixel defer control sits at the top right and advances the
objective immediately. `COMPLETE` remains a manual fallback; GPS arrival is the
normal completion path. `NEXT` is hidden whenever an objective is available.

Warnings are derived from current connectivity, GPS failure, loaded weather,
and traffic state. CannonRoute text accepts checkpoint intelligence when
present and otherwise states that the backbone remains active. It does not
invent route confidence.

## Foundation integration

- Project Lifecycle resolves the durable active Project during startup and
  owns saves for that Project while continuing to mirror `projects/current`.
- Journal Foundation records immutable `checkpoint_completed` or
  `hotel_arrival` events for automatic and manual completion.
- Rally Analytics continues receiving checkpoint events and GPS telemetry
  through its existing service. When an active Project scope is available,
  Analytics persistence is project-scoped.
- Search, Backup, and Templates remain dormant and have no UI.

## Day progression

The official `type="hotel"` record participates in the execution sequence
after regular checkpoints. Completing it advances to the next available rally
day, activates that day's first objective, fits the route, and persists the day
selection. Hotel bailout never defers the hotel itself.

## Compatibility

Legacy projects still load through `projects/current`; Project Lifecycle
promotes that record additively. Imports without an active Project identity
continue through the legacy-compatible save path and are promoted on restart.
No database schema change is introduced.

## Deferred

Additional floating map controls, richer CannonRoute generation, camera
capture, visible Journal and Analytics surfaces, Search UI, project switching,
and Backup/Template UI are deferred to later Mission Control phases.
