import test from 'node:test';
import assert from 'node:assert/strict';
import {createMediaRecord, createPhotoPairIds, MEDIA_SCHEMA_VERSION} from '../src/domain/media/model.js';
import {createCheckpointPhotoService} from '../src/application/checkpoint-photo-service.js';

const ids = [
  '00000000-0000-4000-8000-0000000000a1',
  '00000000-0000-4000-8000-0000000000a2',
  '00000000-0000-4000-8000-0000000000a3',
  '00000000-0000-4000-8000-0000000000a4'
];

test('media record is pure metadata and rejects invalid orientation', () => {
  const record = createMediaRecord({
    mediaId: ids[0],
    projectId: 'p1',
    orientation: 'front',
    mimeType: 'image/jpeg',
    byteSize: 1024,
    checkpointId: 'cp-1',
    pairId: ids[1]
  }, {createId: () => ids[0], clock: {iso: () => '2026-08-07T12:00:00.000Z'}});
  assert.equal(record.schemaVersion, MEDIA_SCHEMA_VERSION);
  assert.equal(record.orientation, 'front');
  assert.throws(() => createMediaRecord({
    projectId: 'p1', orientation: 'side'
  }, {createId: () => ids[0]}), /front or rear/);
});

test('photo pair ids are distinct UUIDs', () => {
  let i = 0;
  const pair = createPhotoPairIds({createId: () => ids[i++]});
  assert.equal(pair.pairId, ids[0]);
  assert.equal(pair.frontMediaId, ids[1]);
  assert.equal(pair.rearMediaId, ids[2]);
});

test('checkpoint photo service stores media then appends reference-only journal event', async () => {
  const media = [];
  const events = [];
  let seq = 0;
  const mediaRepository = {
    async putMany(records) { media.push(...records); return records; },
    async get(id) { return media.find(m => m.mediaId === id) || null; },
    async getByPair(pairId) { return media.filter(m => m.pairId === pairId); },
    async getByCheckpoint(cp) { return media.filter(m => m.checkpointId === cp); }
  };
  const journalService = {
    async appendEvent(input) {
      const event = {eventId: ids[3], ...input};
      events.push(event);
      return event;
    }
  };
  const service = createCheckpointPhotoService({
    mediaRepository,
    journalService,
    createId: () => ids[seq++],
    clock: {iso: () => '2026-08-07T12:00:00.000Z'},
    featureFlags: {isEnabled: () => true}
  });

  const front = new Blob(['front'], {type: 'image/jpeg'});
  const rear = new Blob(['rear'], {type: 'image/jpeg'});
  const result = await service.capturePair({
    projectId: 'p1',
    checkpointId: 'cp-42',
    frontBlob: front,
    rearBlob: rear
  });

  assert.equal(result.status, 'captured');
  assert.equal(media.length, 2);
  assert.ok(media[0].blob instanceof Blob);
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, 'photo_added');
  assert.deepEqual(events[0].attachments.photoIds, [ids[1], ids[2]]);
  assert.equal(events[0].references.checkpointId, 'cp-42');
  assert.equal(events[0].metadata.pair, true);
});

test('disabled feature flag returns disabled status', async () => {
  const service = createCheckpointPhotoService({
    mediaRepository: {},
    journalService: {},
    createId: () => ids[0],
    featureFlags: {isEnabled: () => false}
  });
  const result = await service.capturePair({
    projectId: 'p1', checkpointId: 'cp-1',
    frontBlob: new Blob(), rearBlob: new Blob()
  });
  assert.equal(result.status, 'disabled');
});
