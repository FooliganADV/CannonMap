export const MEDIA_SCHEMA_VERSION = 1;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORIENTATIONS = new Set(['front', 'rear']);

const requiredString = (value, name) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${name} is required.`);
  return normalized;
};

const utc = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new TypeError('timestamp must be a valid date.');
  return date.toISOString();
};

/**
 * Pure metadata contract for media. Binary payloads stay in infrastructure.
 * Journal events reference these records by mediaId only.
 */
export function createMediaRecord(input = {}, { createId, clock } = {}) {
  if (typeof createId !== 'function') throw new TypeError('createId is required.');
  const mediaId = String(input.mediaId || createId());
  if (!UUID.test(mediaId)) throw new TypeError('mediaId must be a UUID.');
  const orientation = requiredString(input.orientation, 'orientation');
  if (!ORIENTATIONS.has(orientation)) throw new TypeError('orientation must be front or rear.');
  const capturedAt = utc(input.capturedAt ?? clock?.iso?.() ?? new Date().toISOString());
  const createdAt = utc(input.createdAt ?? clock?.iso?.() ?? capturedAt);
  return Object.freeze({
    mediaId,
    projectId: requiredString(input.projectId, 'projectId'),
    kind: requiredString(input.kind || 'photo', 'kind'),
    orientation,
    mimeType: requiredString(input.mimeType || 'image/jpeg', 'mimeType'),
    byteSize: Number.isFinite(input.byteSize) ? Math.max(0, Math.floor(input.byteSize)) : 0,
    capturedAt,
    createdAt,
    checkpointId: input.checkpointId ? String(input.checkpointId) : null,
    pairId: input.pairId ? String(input.pairId) : null,
    schemaVersion: Number(input.schemaVersion || MEDIA_SCHEMA_VERSION)
  });
}

export function createPhotoPairIds({ createId } = {}) {
  if (typeof createId !== 'function') throw new TypeError('createId is required.');
  return Object.freeze({
    pairId: createId(),
    frontMediaId: createId(),
    rearMediaId: createId()
  });
}
