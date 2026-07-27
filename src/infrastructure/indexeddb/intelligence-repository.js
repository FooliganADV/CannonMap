import {requestResult,transactionDone} from './request.js';

const TYPES=new Set(['checkpoint','sequence','compatibility']);
const headKey=(type,eventId,subjectId)=>`m10:${type}:${eventId}:${subjectId}:head`;

export function createIntelligenceRepository({database}={}){
  if(!database)throw new TypeError('database is required.');
  async function appendProjection(type,record,{subjectId}={}){
    if(!TYPES.has(type)||!record?.eventId||!record?.revisionId||!subjectId)throw new TypeError('A valid immutable intelligence projection is required.');
    const transaction=database.transaction(['intelligenceItems','syncMeta'],'readwrite'),done=transactionDone(transaction);
    const items=transaction.objectStore('intelligenceItems'),meta=transaction.objectStore('syncMeta'),intelligenceId=`${type}:${record.revisionId}`;
    const existing=await requestResult(items.get([record.eventId,intelligenceId]));
    if(existing){
      transaction.abort(); try{await done;}catch{}
      if(JSON.stringify(existing.record)!==JSON.stringify(record))throw new Error(`Immutable projection collision: ${intelligenceId}`);
      return existing.record;
    }
    await requestResult(items.add({schemaVersion:1,createdAt:record.createdAt,updatedAt:record.updatedAt,eventId:record.eventId,intelligenceId,type,subjectId,revision:record.revision,record}));
    await requestResult(meta.put({key:headKey(type,record.eventId,subjectId),eventId:record.eventId,type,subjectId,revisionId:record.revisionId,revision:record.revision,updatedAt:record.updatedAt}));
    await done;
    return record;
  }
  async function readHead(type,eventId,subjectId){
    const transaction=database.transaction(['syncMeta','intelligenceItems'],'readonly'),done=transactionDone(transaction);
    const head=await requestResult(transaction.objectStore('syncMeta').get(headKey(type,eventId,subjectId)));
    const item=head?await requestResult(transaction.objectStore('intelligenceItems').get([eventId,`${type}:${head.revisionId}`])):null;
    await done;
    return item?.record||null;
  }
  async function reconcile(type,eventId,subjectId){
    const transaction=database.transaction('intelligenceItems','readonly'),done=transactionDone(transaction);
    const all=await requestResult(transaction.objectStore('intelligenceItems').getAll()); await done;
    const revisions=all.filter(item=>item.type===type&&item.eventId===eventId&&item.subjectId===subjectId).sort((a,b)=>a.revision-b.revision);
    const head=await readHead(type,eventId,subjectId);
    return Object.freeze({type,eventId,subjectId,revisionCount:revisions.length,headRevision:head?.revision||null,orphanedRevisions:revisions.filter(item=>item.revision>(head?.revision||0)).map(item=>item.record.revisionId)});
  }
  async function appendSuggestion(suggestion){
    const transaction=database.transaction('recommendations','readwrite'),done=transactionDone(transaction),store=transaction.objectStore('recommendations');
    const recommendationId=`suggestion:${suggestion.suggestionId}:${suggestion.revision||1}`;
    const record={schemaVersion:1,eventId:suggestion.eventId,recommendationId,status:suggestion.status,createdAt:suggestion.createdAt,updatedAt:suggestion.updatedAt||suggestion.createdAt,suggestion};
    const existing=await requestResult(store.get([suggestion.eventId,recommendationId]));
    if(existing){transaction.abort();try{await done;}catch{};if(JSON.stringify(existing.suggestion)!==JSON.stringify(suggestion))throw new Error(`Immutable suggestion collision: ${recommendationId}`);return existing.suggestion;}
    await requestResult(store.add(record)); await done; return suggestion;
  }
  return Object.freeze({appendProjection,readHead,reconcile,appendSuggestion});
}
