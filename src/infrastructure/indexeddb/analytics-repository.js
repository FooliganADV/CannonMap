import {requestResult,transactionDone} from './request.js';

const STORES=['telemetrySamples','telemetryEvents','analyticsSessions','analyticsDailyStats'];

/**
 * IndexedDB adapter for Rally Analytics. Raw evidence is append-only (`add`);
 * compact derived records are replaceable (`put`). Each ingestion transaction
 * commits evidence and its updated statistics atomically.
 */
export function createAnalyticsRepository(database){
  if(!database)throw new TypeError('database is required.');
  const write=async({sample,event,events=[],session,daily})=>{
    const transaction=database.transaction(STORES,'readwrite'),done=transactionDone(transaction);
    if(sample)transaction.objectStore('telemetrySamples').add(sample);
    if(event)transaction.objectStore('telemetryEvents').add(event);
    for(const item of events)transaction.objectStore('telemetryEvents').add(item);
    if(session)transaction.objectStore('analyticsSessions').put(session);
    if(daily)transaction.objectStore('analyticsDailyStats').put(daily);
    await done;
  };
  return Object.freeze({
    appendSampleAndStats:write,
    appendEventAndStats:write,
    async saveStats(records){await write(records);},
    async findActiveSession(rallyEventId,projectId){
      const transaction=database.transaction('analyticsSessions','readonly'),done=transactionDone(transaction);
      const rows=await requestResult(transaction.objectStore('analyticsSessions').index('eventStatus').getAll([rallyEventId,'active']));
      await done;
      const candidates=projectId===undefined?rows:rows.filter(row=>row.projectId===String(projectId));
      return candidates.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]||null;
    },
    async getDaily(sessionId,dayKey){
      const transaction=database.transaction('analyticsDailyStats','readonly'),done=transactionDone(transaction);
      const value=await requestResult(transaction.objectStore('analyticsDailyStats').get([sessionId,dayKey]));
      await done;
      return value||null;
    },
    async getSession(sessionId,rallyEventId){
      const transaction=database.transaction('analyticsSessions','readonly'),done=transactionDone(transaction);
      const value=await requestResult(transaction.objectStore('analyticsSessions').get([rallyEventId,sessionId]));
      await done;
      return value||null;
    },
    async listSamples(sessionId){
      const transaction=database.transaction('telemetrySamples','readonly'),done=transactionDone(transaction);
      const range=IDBKeyRange.bound([sessionId,''],[sessionId,'\uffff']);
      const rows=await requestResult(transaction.objectStore('telemetrySamples').index('sessionTime').getAll(range));
      await done;
      return rows;
    },
    async deleteProjectAnalytics(projectId){
      const transaction=database.transaction(STORES,'readwrite'),done=transactionDone(transaction);
      let count=0;
      for(const storeName of STORES){
        const store=transaction.objectStore(storeName);
        const keys=await requestResult(store.index('projectId').getAllKeys(String(projectId)));
        count+=keys.length;
        for(const key of keys)store.delete(key);
      }
      await done;
      return count;
    }
  });
}
