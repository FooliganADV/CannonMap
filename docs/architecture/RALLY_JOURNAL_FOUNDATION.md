# Rally Journal Foundation

## Scope

The Rally Journal is the permanent, project-scoped event history for future
CannonMap capabilities. This foundation adds domain contracts, an IndexedDB
repository, and a reusable application service. It does not connect producers,
change project workflows, or add UI.

Every Project owns exactly one logical Journal, identified by `projectId`.
Journal events live in the dedicated `journalEvents` store rather than inside
the Project record. `projects/current` remains authoritative for existing
workflows, and the compatibility `journal` field in `projectRecords` is not
rewritten by this increment.

## Event contract

Each immutable event contains:

```text
eventId       UUID
projectId     owning Project identity
timestamp     event time normalized to UTC
eventType     built-in, plugin-defined, or unknown string
source        attributable producer
title         short display-ready label
summary       plain-language detail
metadata      extensible event-specific values
references    IDs of related domain records
attachments   IDs of separately stored media records
createdAt     UTC persistence-creation time
schemaVersion event contract version
```

Images, video, audio, and binary payloads are rejected from `attachments`.
Events reference future media through IDs such as `photoIds`, `videoIds`, and
`noteIds`. Schema migrations are the only permitted mechanism for rewriting an
existing event.

Built-in event types are defined in `src/domain/journal/model.js`. A
composition-scoped registry accepts plugin event types without global state.
Unknown event types remain valid and readable for forward compatibility.

## IndexedDB v5 migration

Version 5 adds only `journalEvents`, keyed by `eventId`. It creates no records
and does not inspect, rewrite, or delete existing Project or telemetry data.
Existing projects therefore begin with empty journals.

Indexes:

- `projectId`
- `timestamp`
- `eventType`
- `createdAt`
- `projectTimestamp` (`projectId`, `timestamp`)
- `projectTypeTimestamp` (`projectId`, `eventType`, `timestamp`)
- `projectCreatedAt` (`projectId`, `createdAt`)

The compound indexes support chronological project and typed-event reads
without scanning unrelated projects. Stable event and reference IDs allow
future search, attachment lookup, and AI projections to use separate indexes
or stores without changing journal event identity.

## Repository API

`createJournalRepository({database})` exposes:

- `appendEvent(event)`
- `appendEvents(events)` — one atomic batch transaction
- `getEvent(eventId)`
- `getAllEvents()`
- `getEventsByProject(projectId)`
- `getEventsByType(eventType, {projectId})`
- `getEventsByTimeRange({projectId, from, to})`
- `queryEvents(query)`
- `transact(operation)` — explicit scoped transaction
- `deleteProjectJournal(projectId)`

All appends use IndexedDB `add`; duplicate IDs abort instead of overwriting
history. Batch failure and explicit abort roll back the complete transaction.
Consumers handling very large histories should use project/type/time queries
instead of loading all projects with `getAllEvents`.

## Service API

`createRallyJournalService(...)` validates and creates events before delegating
to the repository:

- `appendEvent(input)`
- `appendEvents(inputs)`
- `getEvent(eventId)`
- `getProjectJournal(projectId)`
- `queryEvents(query)`
- `deleteProjectJournal(projectId)`
- `registerEventType(eventType)`

The service is intentionally not imported by `app.js`. Automatic journal event
generation, Journal UI, debriefs, search, backup, AI, media capture, analytics
visualization, and ride replay remain deferred.

## Extension points

- Increment `JOURNAL_EVENT_SCHEMA_VERSION` only with an explicit migration.
- Add producer-specific data under `metadata`; keep domain identity in
  `references`.
- Store media separately and place only its IDs in `attachments`.
- Register plugin event types in the composition scope that owns the plugin.
- Build full-text, attachment, and AI projections from immutable event IDs in
  separate stores rather than mutating Journal history.
