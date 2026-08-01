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

Empty notes, warnings, and route-intelligence sections collapse. Warnings are
derived from current connectivity, GPS failure, loaded weather, and traffic
state and may be dismissed or snoozed for 10 minutes, 30 minutes, or until the
next checkpoint. CannonRoute text is reduced to a concise operational state.
It does not invent route confidence. Navigation guidance is primary and exact
distance is secondary.

Automatic capture records Journal and Analytics evidence before opening a
60-second, no-cancel camera window. Each interaction resets the inactivity
timer; ignored windows close automatically. Photos are stored in a dedicated,
project-scoped IndexedDB store while Journal events retain only `media://`
references to the checkpoint completion event.

## Foundation integration

- Project Lifecycle resolves the durable active Project during startup and
  owns saves for that Project while continuing to mirror `projects/current`.
- Journal Foundation records immutable `checkpoint_completed` or
  `hotel_arrival` events for automatic and manual completion.
- Rally Analytics continues receiving checkpoint events and GPS telemetry
  through its existing service. When an active Project scope is available,
  Analytics persistence is project-scoped.
- Search, Backup, and Templates remain dormant and have no UI.
- A read-only export source composes existing Project, Journal, and Analytics
  APIs for future Ride, Journal, GPX, and CSV exporters without adding export UI.

## Day progression

The official `type="hotel"` record participates in the execution sequence
after regular checkpoints. Completing it advances to the next available rally
day, activates that day's first objective, fits the route, and persists the day
selection. The hotel is mandatory and cannot be deferred. When regular planned
objectives are exhausted, deferred checkpoints are presented as a queue with
only `Resume Deferred` and `Finish Day`; the latter activates the official
hotel. Hotel completion records a day-finished debrief event and never leaves
Mission Control with an undefined objective message.

## Compatibility

Legacy projects still load through `projects/current`; Project Lifecycle
promotes that record additively. Imports without an active Project identity
continue through the legacy-compatible save path and are promoted on restart.
IndexedDB v9 adds only the project-scoped `missionMedia` store. All existing
stores and records remain unchanged, and project deletion includes media in
the existing atomic deletion transaction.

## Deferred

Additional floating map controls, richer CannonRoute generation, visible
Journal and Analytics surfaces, Search UI, project switching, export UI, and
Backup/Template UI are deferred to later Mission Control phases.
