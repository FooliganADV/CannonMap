# Search Foundation

## Scope

Search is a backend-only, rebuildable projection over CannonMap source records.
This foundation adds no search UI and does not modify Planner, Rally Mode,
Mission Control, or existing workflows.

Indexed sources:

- Projects
- Routes and tracks
- Checkpoints, waypoints, hotels, and named locations
- Rally Journal events
- Rider notes
- Future media references found in Journal attachments

The source Project, feature, Journal, note, or future media record remains
authoritative. Search stores only normalized terms, compact ranking/display
fields, source identity, and source timestamps. It never copies a full source
record.

## Query semantics

Search is project-scoped unless the caller explicitly sets `allProjects`.
Queries are Unicode-normalized, case-insensitive, and support partial matches
within words. Bounded bigram/trigram postings keep index growth linear; full
query verification removes posting collisions. Multi-word queries require every
term to match the same source.

Ranking is deterministic:

1. Exact normalized title
2. Title phrase prefix
3. Title phrase containment
4. Exact or partial title tokens
5. Exact or partial content tokens
6. Stable source-type priority
7. Normalized title, project identity, and source identity tie breakers

The same index and query always return the same ordering.

## IndexedDB v6

Version 6 adds two stores without reading or changing existing data:

### `searchDocuments`

Key: (`projectId`, `sourceType`, `sourceId`)

Indexes:

- `projectId`
- `sourceType`
- `terms` (multi-entry, for explicit all-project search)
- `scopedTerms` (multi-entry, terms prefixed by Project identity)
- `sourceUpdatedAt`

### `searchIndexState`

Key: `projectId`

Tracks deterministic source revision, index schema version, status, document
count, and build time. No Project is indexed during migration.

## Rebuild and recovery

`rebuildProject` derives a complete Project projection in memory and replaces
that Project's old search documents and state in one IndexedDB transaction.
Successful rebuilds remove stale entries. An interrupted or invalid replacement
rolls back and leaves the last complete index readable.

`ensureProjectIndex` compares the deterministic source revision and index
version. It reuses a current index or rebuilds a stale/missing index. This makes
the index disposable and recoverable without source mutation.

## Service API

`createSearchService({repository, clock})` exposes:

- `rebuildProject({project, journalEvents})`
- `ensureProjectIndex({project, journalEvents})`
- `search(query, {projectId, allProjects, limit})`
- `getIndexState(projectId)`
- `listIndexStates()`
- `deleteProjectIndex(projectId)`

Results contain source references and compact projections. A future UI or
consumer must load full records from their authoritative repositories.

## Deferred work

Search UI, automatic indexing hooks, background scheduling, remote search,
semantic/vector ranking, media stores, Journal UI, AI, and Backup are separate
increments.
