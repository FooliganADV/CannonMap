# Checkpoint Paired Photo Capture

## Scope

Adds offline-first front + rear photo capture for the active checkpoint in Rally Mode, optimized for iPhone Safari / installed iOS PWA field use.

## Architecture fit

- Media blobs live only in the `mediaRecords` IndexedDB store.
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
| Camera helper | `src/application/camera-capture.js` |
| UI | `src/ui/rally/controller.js`, `presenter.js`, `index.html` |

## Field capture flow (production)

1. Rider has an active checkpoint in Rally Mode.
2. Opens More sheet → taps **CAPTURE PAIR** once.
3. App sequentially captures:
   - front (`facingMode: user`)
   - rear (`facingMode: environment`)
4. Both JPEG blobs are persisted to `mediaRecords`.
5. One `photo_added` journal event is appended with mediaId references only.
6. Brief “Pair saved” confirmation, then UI returns to normal Rally Mode.

iPhone Safari does **not** support reliable concurrent front + rear streams. Capture is therefore **rapid sequential**, with tracks stopped after each frame.

## Debug path

Append `?debugPhotos=1` (or set `globalThis.__CANNONMAP_PHOTO_DEBUG__ = true`) to reveal the original FRONT / REAR / SAVE PAIR file-input controls for desktop or fallback testing.

## Constraints preserved

- No parallel architecture.
- No embedded media in journal events.
- Offline-first (IndexedDB).
- Journal service remains the sole writer of journal events.
- Partial failure never produces a successful pair (both frames must succeed before `capturePair` is called).
- Camera tracks are released after capture, on abort, and when the PWA is backgrounded (`visibilitychange` / `pagehide`).

## Enabling in test

```js
globalThis.__CANNONMAP_FEATURE_FLAGS__ = {
  ...(globalThis.__CANNONMAP_FEATURE_FLAGS__ || {}),
  'architecture.journal.checkpoint-photos': true
};
```

Reload the page (or re-run `startApplication`) after setting the flag.
