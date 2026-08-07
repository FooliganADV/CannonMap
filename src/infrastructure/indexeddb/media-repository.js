import {requestResult, transactionDone} from './request.js';

const STORE = 'mediaRecords';
const clone = (value) => structuredClone(value);

/**
 * Stores media metadata + Blob. Journal events hold only mediaId references.
 */
export function createMediaRepository({database} = {}) {
  if (!database) throw new TypeError('database is required.');

  const read = async (requestFactory) => {
    const transaction = database.transaction(STORE, 'readonly');
    const done = transactionDone(transaction);
    const result = await requestResult(requestFactory(transaction.objectStore(STORE)));
    await done;
    return result;
  };

  return Object.freeze({
    async put(record) {
      if (!record?.mediaId) throw new TypeError('mediaId is required.');
      if (!(record.blob instanceof Blob) && record.blob !== undefined) {
        throw new TypeError('blob must be a Blob when provided.');
      }
      const transaction = database.transaction(STORE, 'readwrite');
      const done = transactionDone(transaction);
      await requestResult(transaction.objectStore(STORE).put(clone(record)));
      await done;
      return clone(record);
    },

    async putMany(records) {
      if (!Array.isArray(records) || records.length === 0) {
        throw new TypeError('records must be a non-empty array.');
      }
      const transaction = database.transaction(STORE, 'readwrite');
      const done = transactionDone(transaction);
      const store = transaction.objectStore(STORE);
      for (const record of records) {
        if (!record?.mediaId) throw new TypeError('mediaId is required.');
        store.put(clone(record));
      }
      await done;
      return records.map(clone);
    },

    async get(mediaId) {
      const value = await read((store) => store.get(String(mediaId)));
      return value || null;
    },

    async getByProject(projectId) {
      return read((store) => store.index('projectId').getAll(String(projectId)));
    },

    async getByPair(pairId) {
      return read((store) => store.index('pairId').getAll(String(pairId)));
    },

    async getByCheckpoint(checkpointId) {
      return read((store) => store.index('checkpointId').getAll(String(checkpointId)));
    },

    async deleteProjectMedia(projectId) {
      const transaction = database.transaction(STORE, 'readwrite');
      const done = transactionDone(transaction);
      const store = transaction.objectStore(STORE);
      const keys = await requestResult(store.index('projectId').getAllKeys(String(projectId)));
      for (const key of keys) store.delete(key);
      await done;
      return keys.length;
    }
  });
}
