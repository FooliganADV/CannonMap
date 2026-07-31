import {normalizeProject} from '../../domain/projects/model.js';
import {requestResult,transactionDone} from './request.js';

export function createProjectRepository({database,createId,now}={}){
  if(!database)throw new TypeError('database is required.');
  const timestamp=()=>typeof now==='function'?now():new Date().toISOString();
  const normalize=project=>{
    const updatedAt=timestamp();
    return normalizeProject({...project,updatedAt},{createId,now:()=>updatedAt});
  };
  const get=async projectId=>{
    const transaction=database.transaction('projectRecords','readonly');
    const done=transactionDone(transaction);
    const result=await requestResult(transaction.objectStore('projectRecords').get(String(projectId)));
    await done;
    return result||null;
  };
  const save=async project=>{
    const record=normalize(project);
    const transaction=database.transaction('projectRecords','readwrite');
    const done=transactionDone(transaction);
    await requestResult(transaction.objectStore('projectRecords').put(record));
    await done;
    return record;
  };
  return Object.freeze({
    save,get,
    async list(){
      const transaction=database.transaction('projectRecords','readonly');
      const done=transactionDone(transaction);
      const result=await requestResult(transaction.objectStore('projectRecords').index('updatedAt').getAll());
      await done;
      return result.reverse();
    },
    async archive(projectId,archivedAt=timestamp()){
      const existing=await get(projectId);
      if(!existing)throw new Error(`Project not found: ${projectId}`);
      return save({...existing,lifecycleStatus:'archived',archivedAt});
    },
    async delete(projectId){
      const transaction=database.transaction('projectRecords','readwrite');
      const done=transactionDone(transaction),store=transaction.objectStore('projectRecords');
      const existing=await requestResult(store.get(String(projectId)));
      if(existing)store.delete(String(projectId));
      await done;
      return Boolean(existing);
    }
  });
}
