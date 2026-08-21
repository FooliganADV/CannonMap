import {requestResult,transactionDone} from './request.js';

const SNAPSHOTS='recoverySnapshots',HANDLES='backupDirectoryHandles';
const clone=value=>value==null?value:structuredClone(value);

export function createRecoverySnapshotRepository({database}={}){
  if(!database)throw new TypeError('database is required.');
  return Object.freeze({
    async save(record){
      if(!record?.snapshotId||!record?.sessionId||record.verified!==true||!record.recovery||Object.hasOwn(record,'blob'))throw new TypeError('A compact verified recovery snapshot is required.');
      const transaction=database.transaction(SNAPSHOTS,'readwrite'),done=transactionDone(transaction);
      await requestResult(transaction.objectStore(SNAPSHOTS).add(clone(record)));await done;return clone(record);
    },
    async get(snapshotId){
      const transaction=database.transaction(SNAPSHOTS,'readonly'),done=transactionDone(transaction),row=await requestResult(transaction.objectStore(SNAPSHOTS).get(String(snapshotId)));await done;return clone(row||null);
    },
    async findByFingerprint(sessionId,fingerprint){
      const transaction=database.transaction(SNAPSHOTS,'readonly'),done=transactionDone(transaction),row=await requestResult(transaction.objectStore(SNAPSHOTS).index('sessionFingerprint').get([String(sessionId),String(fingerprint)]));await done;return clone(row||null);
    },
    async listSession(sessionId){
      const transaction=database.transaction(SNAPSHOTS,'readonly'),done=transactionDone(transaction),rows=await requestResult(transaction.objectStore(SNAPSHOTS).index('sessionId').getAll(String(sessionId)));await done;return rows.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).map(clone);
    },
    async latest(sessionId){const rows=await this.listSession(sessionId);return rows[0]||null;},
    async updateExternal(snapshotId,external,lastExternal=null){
      const transaction=database.transaction(SNAPSHOTS,'readwrite'),done=transactionDone(transaction),store=transaction.objectStore(SNAPSHOTS),row=await requestResult(store.get(String(snapshotId)));
      if(row)await requestResult(store.put({...row,external:clone(external),lastExternal:clone(lastExternal||row.lastExternal||null)}));await done;return row?clone({...row,external,lastExternal:lastExternal||row.lastExternal||null}):null;
    },
    async delete(snapshotId){const transaction=database.transaction(SNAPSHOTS,'readwrite'),done=transactionDone(transaction);await requestResult(transaction.objectStore(SNAPSHOTS).delete(String(snapshotId)));await done;},
    async prune(sessionId,retain=1,{keepSnapshotId=null}={}){
      const rows=await this.listSession(sessionId),keep=String(keepSnapshotId||''),ordered=keep?[...rows.filter(row=>String(row.snapshotId)===keep),...rows.filter(row=>String(row.snapshotId)!==keep)]:rows,stale=ordered.slice(Math.max(1,Number(retain)||1));
      if(!stale.length)return 0;
      const transaction=database.transaction(SNAPSHOTS,'readwrite'),done=transactionDone(transaction),store=transaction.objectStore(SNAPSHOTS);
      for(const row of stale)store.delete(row.snapshotId);await done;return stale.length;
    },
    async pruneGlobal(limit=90){
      const transaction=database.transaction(SNAPSHOTS,'readonly'),readDone=transactionDone(transaction),rows=await requestResult(transaction.objectStore(SNAPSHOTS).getAll());await readDone;
      const stale=rows.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(Math.max(60,Number(limit)||90));if(!stale.length)return 0;
      const write=database.transaction(SNAPSHOTS,'readwrite'),done=transactionDone(write),store=write.objectStore(SNAPSHOTS);for(const row of stale)store.delete(row.snapshotId);await done;return stale.length;
    }
  });
}

export function createBackupDirectoryHandleRepository({database}={}){
  if(!database)throw new TypeError('database is required.');
  return Object.freeze({
    async get(key){const transaction=database.transaction(HANDLES,'readonly'),done=transactionDone(transaction),row=await requestResult(transaction.objectStore(HANDLES).get(String(key)));await done;return row||null;},
    async save(record){if(!record?.key||!record?.handle)throw new TypeError('A backup directory handle record is required.');const transaction=database.transaction(HANDLES,'readwrite'),done=transactionDone(transaction);await requestResult(transaction.objectStore(HANDLES).put(record));await done;return record;},
    async clear(key){const transaction=database.transaction(HANDLES,'readwrite'),done=transactionDone(transaction);await requestResult(transaction.objectStore(HANDLES).delete(String(key)));await done;}
  });
}
