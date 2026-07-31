import {normalizeProject} from '../../domain/projects/model.js';
import {requestResult,transactionDone} from './request.js';

export function createProjectRepository({database,createId,now}={}){
  if(!database)throw new TypeError('database is required.');
  const normalize=project=>normalizeProject(project,{createId,now});
  return Object.freeze({
    async save(project){
      const record=normalize(project);
      const transaction=database.transaction('projectRecords','readwrite');
      const done=transactionDone(transaction);
      await requestResult(transaction.objectStore('projectRecords').put(record));
      await done;
      return record;
    },
    async get(projectId){
      const transaction=database.transaction('projectRecords','readonly');
      const done=transactionDone(transaction);
      const result=await requestResult(transaction.objectStore('projectRecords').get(String(projectId)));
      await done;
      return result||null;
    },
    async list(){
      const transaction=database.transaction('projectRecords','readonly');
      const done=transactionDone(transaction);
      const result=await requestResult(transaction.objectStore('projectRecords').index('updatedAt').getAll());
      await done;
      return result.reverse();
    }
  });
}
