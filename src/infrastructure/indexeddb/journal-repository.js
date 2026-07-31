import {compareJournalEvents} from '../../domain/journal/model.js';
import {requestResult,transactionDone} from './request.js';

const STORE='journalEvents';
const clone=value=>structuredClone(value);

/**
 * Append-only IndexedDB adapter. `add` is intentional: an existing event ID
 * aborts the transaction instead of replacing historical evidence.
 */
export function createJournalRepository({database,keyRange=globalThis.IDBKeyRange}={}){
  if(!database)throw new TypeError('database is required.');
  if(!keyRange)throw new TypeError('IDBKeyRange is required.');

  const read=async requestFactory=>{
    const transaction=database.transaction(STORE,'readonly');
    const done=transactionDone(transaction);
    const result=await requestResult(requestFactory(transaction.objectStore(STORE)));
    await done;
    return result;
  };
  const append=async events=>{
    const transaction=database.transaction(STORE,'readwrite');
    const done=transactionDone(transaction);
    const store=transaction.objectStore(STORE);
    for(const event of events)store.add(clone(event));
    await done;
    return events.map(clone);
  };
  const ordered=events=>events.sort(compareJournalEvents);
  const getAllEvents=async()=>ordered(await read(store=>store.getAll()));
  const getEventsByProject=async projectId=>
    ordered(await read(store=>store.index('projectId').getAll(String(projectId))));
  const getEventsByType=async(eventType,{projectId}={})=>{
    if(projectId){
      const range=keyRange.bound(
        [String(projectId),String(eventType),''],
        [String(projectId),String(eventType),'\uffff']
      );
      return ordered(await read(store=>store.index('projectTypeTimestamp').getAll(range)));
    }
    return ordered(await read(store=>store.index('eventType').getAll(String(eventType))));
  };
  const getEventsByTimeRange=async({
    projectId,from='0000-01-01T00:00:00.000Z',to='9999-12-31T23:59:59.999Z'
  }={})=>{
    const normalizedProjectId=String(projectId??'');
    if(!normalizedProjectId)throw new TypeError('projectId is required.');
    const range=keyRange.bound([normalizedProjectId,String(from)],[normalizedProjectId,String(to)]);
    return ordered(await read(store=>store.index('projectTimestamp').getAll(range)));
  };
  const transact=async operation=>{
    if(typeof operation!=='function')throw new TypeError('operation must be a function.');
    const transaction=database.transaction(STORE,'readwrite');
    const done=transactionDone(transaction);
    const store=transaction.objectStore(STORE);
    const scope=Object.freeze({
      appendEvent:event=>requestResult(store.add(clone(event))),
      appendEvents:events=>Promise.all(events.map(event=>requestResult(store.add(clone(event))))),
      getEvent:eventId=>requestResult(store.get(String(eventId))),
      abort:()=>transaction.abort()
    });
    try{
      const result=await operation(scope);
      await done;
      return result;
    }catch(error){
      try{transaction.abort();}catch(_){}
      try{await done;}catch(_){}
      throw error;
    }
  };

  return Object.freeze({
    async appendEvent(event){return (await append([event]))[0];},
    async appendEvents(events){
      if(!Array.isArray(events)||events.length===0)throw new TypeError('events must be a non-empty array.');
      return append(events);
    },
    async getEvent(eventId){
      const value=await read(store=>store.get(String(eventId)));
      return value||null;
    },
    getAllEvents,
    getEventsByProject,
    getEventsByType,
    getEventsByTimeRange,
    transact,
    async queryEvents({projectId,eventType,from,to}={}){
      if(eventType)return getEventsByType(eventType,{projectId});
      if(from||to)return getEventsByTimeRange({projectId,from,to});
      if(projectId)return getEventsByProject(projectId);
      return getAllEvents();
    },
    async deleteProjectJournal(projectId){
      const transaction=database.transaction(STORE,'readwrite');
      const done=transactionDone(transaction);
      const store=transaction.objectStore(STORE);
      const keys=await requestResult(store.index('projectId').getAllKeys(String(projectId)));
      for(const key of keys)store.delete(key);
      await done;
      return keys.length;
    }
  });
}
