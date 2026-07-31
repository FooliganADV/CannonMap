import {requestResult,transactionDone} from './request.js';

export function createLegacyCurrentProjectRepository({database}={}){
  if(!database)throw new TypeError('database is required.');
  return Object.freeze({
    async get(){
      const transaction=database.transaction('projects','readonly'),done=transactionDone(transaction);
      const value=await requestResult(transaction.objectStore('projects').get('current'));
      await done;return value||null;
    },
    async save(project){
      const transaction=database.transaction('projects','readwrite'),done=transactionDone(transaction);
      await requestResult(transaction.objectStore('projects').put(structuredClone(project),'current'));
      await done;return project;
    },
    async clear(){
      const transaction=database.transaction('projects','readwrite'),done=transactionDone(transaction);
      await requestResult(transaction.objectStore('projects').delete('current'));
      await done;
    }
  });
}
