# Project Template Foundation

## Scope

Project Template Foundation defines reusable defaults for future Project
creation without adding a picker, editor, creation-flow integration, or other
visible behavior. Templates contain configuration only. They never contain
route datasets, active Project state, Journal events, Analytics records, media,
GPS/breadcrumb evidence, lifecycle state, or Search indexes.

## Template model

Schema version 1 includes:

- `templateId`, name, description, `templateType`, and source
- schema version and created/updated timestamps
- mutually exclusive `isBuiltIn` and `isUserDefined` ownership flags
- settings and layer defaults
- Journal and Analytics configuration defaults
- weather and hazard defaults
- checklist and offline-map defaults
- Rally Mode defaults
- extensible metadata

Known type names are `adv_cannonball`, `america_250`, `bdr`, `tat`,
`adventure_ride`, `weekend_ride`, `day_ride`, and `custom`. Type names use a
stable lowercase identifier contract; unknown valid identifiers are preserved
instead of coerced or discarded.

Validation requires every defaults section to be an object and recursively
rejects prohibited runtime/source-record fields. Domain-specific errors expose
stable `TEMPLATE_*` codes for identity, schema, ownership, defaults, immutable
built-ins, duplicates, and missing records.

## Built-in versus user-defined Templates

Built-ins are compact, deeply frozen code assets. The initial registry provides
ADV Cannonball and Day Ride behavior defaults only; it contains no route or
checkpoint content. Repository reads return clones, so consumers cannot mutate
the registry.

IndexedDB stores only user-defined Templates. Creating a built-in identity,
updating a built-in, or deleting a built-in fails deterministically. User
creation uses IndexedDB `add`, so concurrent duplicate identities produce one
winner without overwriting data. Update remains explicit, clone always creates
a new user-owned identity, and delete affects only the requested user Template.

## Project instantiation

`createProjectTemplateService` produces a normalized, isolated Project draft:

1. Validate the Template.
2. Generate a new Project identity and timestamps.
3. Deep-copy Template configuration defaults.
4. Apply caller-provided Project settings and metadata overrides.
5. Store a compact `templateReference` for provenance.
6. Initialize features, Journal, Analytics, competitors, notes, and media as
   empty Project collections.

The draft is returned only. The service has no repository dependency, creates
no lifecycle state, does not activate the Project, and performs no persistence.
A future caller must explicitly pass the draft to Project Lifecycle creation.
Template identity is never reused as Project identity.

## Storage and migration

IndexedDB v8 additively creates `projectTemplates` with key path `templateId`
and indexes on `name`, `templateType`, `updatedAt`, and `isBuiltIn`. Migration
does not modify existing stores or records, does not persist built-ins, and does
not synthesize Templates from existing Projects. Reopening v8 is idempotent.

## Backup compatibility

No `.cmap` format change is required. Backup Foundation already preserves the
Project's compact `templateReference`, which is provenance metadata rather than
the Template record. Built-ins are stable application assets and must not be
exported redundantly. A future archive extension can export user-defined
Template records as a separate, versioned collection without changing Project
restore semantics.

## Search compatibility

Template names, descriptions, types, and metadata are suitable future Search
sources, but Template results are not naturally Project-scoped. This increment
does not add a Search source type or index records. A future Search integration
must define an explicit Template scope and store compact source references,
never full Template duplicates.

## Invariants

- Built-ins are immutable and never persisted as user data.
- User Template creation is create-only and versioned.
- Unknown valid Template types survive round trips.
- Templates contain configuration defaults, not Project execution state.
- Every Project draft receives a new identity and independent deep copies.
- Draft creation cannot persist or activate a Project.
- Existing Project creation behavior remains untouched.

## Deferred work

Template picker/editor UI, Project creation integration, import/export UI,
cloud Templates, sharing, marketplaces, route content, Search indexing,
automatic selection, and Backup collection extensions are explicitly deferred.
