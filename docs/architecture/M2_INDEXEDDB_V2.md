# Milestone M2: IndexedDB v2 foundation

## Scope

M2 adds an opt-in, additive IndexedDB schema registry, domain repositories,
atomic observation/outbox persistence, and durable migration checkpoints.
It does not enable observation capture, synchronization, map extraction, or any
later milestone behavior.

The `projects` store is retained without a key path and remains authoritative.
The v2 path opens only when the injected feature-flag reader returns `true` for
`architecture.indexeddb.v2`. A missing, malformed, or false flag leaves the
legacy version 1 path untouched.

## Migration safety

- Version upgrades create stores and indexes only. Large record transformation
  is prohibited inside `onupgradeneeded`.
- Batch migrations persist their cursor and processed count in `syncMeta`.
- A batch is responsible for committing its copied records before returning its
  next cursor. If execution is interrupted, the last durable cursor is reused.
- Observations are append-only. The observation and its retryable outbox command
  are added in one transaction so neither can survive alone.
- Every new domain record is schema-versioned and timestamped.

## Rollback

Disable `architecture.indexeddb.v2`. Do not downgrade or delete the database.
The legacy `projects/current` record remains authoritative and readable.
Preserve v2 stores and migration checkpoints for diagnosis and later resumption.

## Acceptance evidence

Integration tests exercise additive upgrade with a legacy project, disabled-flag
rollback, atomic crash behavior, offline durability, append-only observations,
and interruption/resume from a durable migration checkpoint.
