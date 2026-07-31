# Backup Foundation

## Scope

Backup Foundation provides dormant application and infrastructure ports for
exporting, validating, and restoring one CannonMap Project. It does not add UI,
commands, reminders, scheduling, cloud storage, or automatic behavior. Existing
Planner, Rally Mode, Mission Control, Journal, and Search workflows are not
wired to these services.

The application-facing `createProjectBackupService` requires and coordinates lifecycle
serialization, archive validation, deterministic export, dry-run validation,
and create/replace import. The IndexedDB adapter owns the cross-store snapshot
and transaction mechanics. Domain code owns format versioning, canonical JSON,
SHA-256 integrity, and validation errors.

## `.cmap` archive format

Archive version 1 is canonical JSON with two top-level members:

```text
{
  "manifest": {
    "archiveVersion": 1,
    "applicationVersion": "0.7.0",
    "schemaVersion": 7,
    "exportedAt": "ISO-8601 timestamp",
    "projectId": "...",
    "projectName": "...",
    "exportType": "project",
    "generator": { "name": "CannonMap", "format": "cmap" },
    "checksum": { "algorithm": "SHA-256", "value": "..." }
  },
  "data": { ... }
}
```

`data` contains Project and lifecycle metadata; route, track, waypoint, and
checkpoint collections; embedded and append-only Journal data; embedded and
persistent Analytics data; settings; template reference; offline-map metadata;
Search rebuild metadata; and photo/video media references.

An explicit feature-order map and `additionalFeatures` collection preserve
mixed ordering and feature types introduced by future or optional modules
without duplicating the complete feature array.

Search documents are deliberately excluded because they are derived,
rebuildable projections rather than source records. Import deletes any replaced
Project's old Search documents and writes a `stale` index-state marker with
`rebuildRequired: true`. This avoids archive growth and prevents an index built
under an older tokenizer or ranking version from becoming authoritative.

Media references are included, but media bytes are not. The versioned data
envelope can add an optional media payload in a future archive version.

## Deterministic export pipeline

1. Wait for queued Project lifecycle operations.
2. Open one read-only IndexedDB transaction across the Project and all
   Project-owned source stores.
3. Read a transactionally consistent snapshot.
4. Split feature collections and sort unordered records canonically.
5. Canonically order every object key.
6. Calculate SHA-256 over the manifest and data, excluding `exportedAt` and the
   checksum field itself.
7. Serialize canonical JSON.

For identical source data, the checksum and all archive content remain
identical; only `exportedAt` changes. No runtime state, transient Analytics
session buffer, Search documents, cache, service-worker data, or map tiles are
exported.

## Validation and import pipeline

Validation parses without mutation, verifies the supported archive and schema
versions, checks every required collection and Project identity, validates
Journal/Analytics project scoping and Settings shape, and verifies SHA-256.
Failures use domain-specific `BACKUP_*` error codes. Dry-run also performs a
read-only create/replace identity check, then returns the validated identity and
selected mode without opening a write transaction. The write transaction
repeats that check atomically to prevent a check-then-write race.

After validation and lifecycle serialization, import opens one read-write
transaction spanning Project records and lifecycle state,
Journal, all Analytics stores, Search documents, and Search state.

- `create` uses IndexedDB `add` semantics and rejects an existing identity.
- `replace` requires an existing identity, deletes only that Project's owned
  records, then restores the archive in the same transaction.
- Replace targets must be inactive. Future restore workflows must close or
  switch away through Project Lifecycle before replacement, preventing stale
  in-memory repository scopes.
- Imported Projects are not automatically made active.

Any validation, uniqueness, delete, or write failure aborts the transaction.
No partially created or partially replaced Project can remain.

## Versioning strategy

Readers explicitly enumerate supported `archiveVersion` values and reject
unknown future versions. `schemaVersion` prevents importing data that requires
a newer local persistence model. New optional members can be added compatibly;
breaking semantic or required-collection changes require a new archive version
and a dedicated reader/migrator.

## Invariants

- Archives contain source records and rebuild instructions, never derived
  Search documents.
- Export observes one consistent Project snapshot.
- Create import cannot overwrite an existing Project.
- Replace import cannot create a missing Project.
- Replace import cannot mutate the currently active Project.
- Restore is all-or-nothing across every Project-owned store.
- Records in Journal and Analytics must match the manifest Project identity.
- Imported Projects do not change the active Project unless replacing that
  same active identity.
- Archive validation is read-only and idempotent.

## Future extension ports

The versioned envelope and application/repository boundary allow later codecs
for compression and encryption, full or incremental/differential export
strategies, cloud-provider transports, sharing, templates, scheduled backup,
conflict resolution, and embedded media. Google Drive, Dropbox, OneDrive,
iCloud, automatic backup, scheduling, encryption UI, and merge import are all
explicitly deferred.
