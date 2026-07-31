import {requestResult,transactionDone} from './request.js';

const STORE='projectLifecycleState';
const ACTIVE='activeProject';
const TRANSITION='activeProjectTransition';

export function createProjectLifecycleRepository({database}={}){
  if(!database)throw new TypeError('database is required.');
  const read=async key=>{
    const transaction=database.transaction(STORE,'readonly'),done=transactionDone(transaction);
    const value=await requestResult(transaction.objectStore(STORE).get(key));
    await done;return value||null;
  };
  const write=async records=>{
    const transaction=database.transaction(STORE,'readwrite'),done=transactionDone(transaction);
    const store=transaction.objectStore(STORE);
    for(const record of records)record===null?store.delete(TRANSITION):store.put(record);
    await done;
  };
  return Object.freeze({
    async getActiveProjectId(){return (await read(ACTIVE))?.projectId||null;},
    async getTransition(){return read(TRANSITION);},
    async beginTransition(transition){
      await write([{key:TRANSITION,...structuredClone(transition)}]);
      return transition;
    },
    async updateTransition(transition){
      await write([{key:TRANSITION,...structuredClone(transition)}]);
      return transition;
    },
    async completeTransition(projectId,completedAt){
      const transaction=database.transaction(STORE,'readwrite'),done=transactionDone(transaction);
      const store=transaction.objectStore(STORE);
      if(projectId)store.put({key:ACTIVE,projectId:String(projectId),updatedAt:completedAt});
      else store.delete(ACTIVE);
      store.delete(TRANSITION);
      await done;
    },
    async clearActiveProject(){
      const transaction=database.transaction([STORE,'projects'],'readwrite'),done=transactionDone(transaction);
      const store=transaction.objectStore(STORE);
      store.delete(ACTIVE);store.delete(TRANSITION);
      transaction.objectStore('projects').delete('current');
      await done;
    },
    async clearTransition(){await write([null]);}
  });
}
