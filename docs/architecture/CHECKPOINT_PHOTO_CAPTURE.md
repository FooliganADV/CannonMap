# Checkpoint Paired Photo Capture

## Scope

Adds offline-first front + rear photo capture for the active checkpoint in Rally Mode.

## Architecture fit

- Media blobs live only in the new `mediaRecords` IndexedDB store.
- Journal events remain append-only and immutable.
- `attachments` hold mediaId references only (never embedded binary).
- Uses existing `photo_added` event type + `metadata.pair` / `references.checkpointId`.
- Feature flag: `architecture.journal.checkpoint-photos` (defaults off).

## Components

| Layer | File |
|-------|------|
| Domain | `src/domain/media/model.js` |
| Persistence | `src/infrastructure/indexeddb/media-repository.js` + schema v9 |
| Application | `src/application/checkpoint-photo-service.js` |
| UI | `src/ui/rally/controller.js`, `presenter.js`, `index.html` |

## Capture flow

1. Rider selects active checkpoint in Rally Mode.
2. Captures front photo → pending blob.
3. Captures rear photo → pending blob.
4. Submits pair → two `mediaRecords` + one `photo_added` journal event.

## Constraints preserved

- No parallel architecture.
- No embedded media in journal events.
- Offline-first (IndexedDB).
- Journal service remains the sole writer of journal events.
