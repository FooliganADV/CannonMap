import {createMediaRecord, createPhotoPairIds} from '../domain/media/model.js';

export const CHECKPOINT_PHOTO_FEATURE_FLAG = 'architecture.journal.checkpoint-photos';

/**
 * Captures paired front + rear checkpoint photos.
 * Media blobs → mediaRecords store.
 * Journal event (photo_added) holds only mediaId references.
 */
export function createCheckpointPhotoService({
  mediaRepository,
  journalService,
  createId,
  clock,
  featureFlags
} = {}) {
  if (!mediaRepository || !journalService || typeof createId !== 'function') {
    throw new TypeError('mediaRepository, journalService, and createId are required.');
  }

  const enabled = () => featureFlags?.isEnabled?.(CHECKPOINT_PHOTO_FEATURE_FLAG) === true;

  return Object.freeze({
    isEnabled: enabled,

    /**
     * @param {object} input
     * @param {string} input.projectId
     * @param {string} input.checkpointId
     * @param {Blob} input.frontBlob
     * @param {Blob} input.rearBlob
     * @param {string} [input.source='rally-mode']
     */
    async capturePair(input = {}) {
      if (!enabled()) return Object.freeze({status: 'disabled'});

      const projectId = String(input.projectId || '').trim();
      const checkpointId = String(input.checkpointId || '').trim();
      if (!projectId || !checkpointId) {
        throw new TypeError('projectId and checkpointId are required.');
      }
      if (!(input.frontBlob instanceof Blob) || !(input.rearBlob instanceof Blob)) {
        throw new TypeError('frontBlob and rearBlob must be Blobs.');
      }

      const ids = createPhotoPairIds({createId});
      const now = clock?.iso?.() ?? new Date().toISOString();

      const frontMeta = createMediaRecord({
        mediaId: ids.frontMediaId,
        projectId,
        kind: 'photo',
        orientation: 'front',
        mimeType: input.frontBlob.type || 'image/jpeg',
        byteSize: input.frontBlob.size,
        capturedAt: now,
        checkpointId,
        pairId: ids.pairId
      }, {createId, clock});

      const rearMeta = createMediaRecord({
        mediaId: ids.rearMediaId,
        projectId,
        kind: 'photo',
        orientation: 'rear',
        mimeType: input.rearBlob.type || 'image/jpeg',
        byteSize: input.rearBlob.size,
        capturedAt: now,
        checkpointId,
        pairId: ids.pairId
      }, {createId, clock});

      // Persist media first (offline-first).
      await mediaRepository.putMany([
        {...frontMeta, blob: input.frontBlob},
        {...rearMeta, blob: input.rearBlob}
      ]);

      // Append immutable journal event with references only.
      const event = await journalService.appendEvent({
        projectId,
        eventType: 'photo_added',
        source: String(input.source || 'rally-mode'),
        title: 'Checkpoint photo pair',
        summary: `Front + rear photos for checkpoint ${checkpointId}`,
        metadata: {
          pair: true,
          pairId: ids.pairId,
          orientations: ['front', 'rear']
        },
        references: {
          checkpointId,
          pairId: ids.pairId
        },
        attachments: {
          photoIds: [ids.frontMediaId, ids.rearMediaId],
          frontMediaId: ids.frontMediaId,
          rearMediaId: ids.rearMediaId
        }
      });

      return Object.freeze({
        status: 'captured',
        pairId: ids.pairId,
        frontMediaId: ids.frontMediaId,
        rearMediaId: ids.rearMediaId,
        eventId: event.eventId,
        event
      });
    },

    getMedia: (mediaId) => mediaRepository.get(mediaId),
    getByPair: (pairId) => mediaRepository.getByPair(pairId),
    getByCheckpoint: (checkpointId) => mediaRepository.getByCheckpoint(checkpointId)
  });
}
