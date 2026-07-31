import {normalizeProject} from '../../domain/projects/model.js';
import {DuplicateProjectError} from '../../domain/projects/errors.js';
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
  const create=async project=>{
    const record=normalize(project);
    const transaction=database.transaction('projectRecords','readwrite');
    const done=transactionDone(transaction);
    try{
      await requestResult(transaction.objectStore('projectRecords').add(record));
      await done;
      return record;
    }catch(error){
      try{transaction.abort();}catch(_){ }
      try{await done;}catch(_){ }
      if(error?.name==='ConstraintError'||transaction.error?.name==='ConstraintError'){
        throw new DuplicateProjectError(record.projectId,{cause:error});
      }
      throw error;
    }
  };
  return Object.freeze({
    create,save,get,
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
    }
  });
}
