# Project Architecture Foundation

## Scope

This increment introduces a first-class, versioned Project model and additive
IndexedDB storage. It deliberately does not change Planner, Rally Mode, project
selection, imports, or the legacy active-project save path.

## Compatibility strategy

- `projects/current` remains untouched and authoritative for the existing app.
- IndexedDB v4 adds `projectRecords`, keyed by `projectId`.
- During the v4 schema upgrade, the legacy current project is copied once into
  `projectRecords`. The source record is neither rewritten nor deleted.
- Projects without an identity receive the deterministic `legacy-current`
  identity so migration is repeatable.
- Unknown legacy fields and the existing `features` collection are preserved.

## Ownership model

The Project model owns its current `features` and competitor data plus empty,
forward-compatible containers for journal, analytics, photos, videos, notes,
offline-map configuration, and project settings. Routes, tracks, checkpoints,
hotels, and waypoints remain represented in `features`; `projectCollections`
provides categorized views without duplicating data.

## Deferred integration

Active-project integration and project switching are not implemented in this
increment. The existing application does not use `projectRecords` yet. A later,
feature-flagged increment can add project selection and dual-write/backfill
behavior after migration has been validated in production. Journal, search,
backup, and template services remain separate future increments.
