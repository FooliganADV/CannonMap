import {requestResult,transactionDone} from './request.js';

/** Atomic Project + Journal + full-resolution media restore. Active lifecycle state is intentionally untouched. */
export function createJourneyRestoreRepository({database}={}){
  if(!database)throw new TypeError('database is required.');
  return Object.freeze({
    async restoreNew({project,journal=[],media=[]}){
      const projectId=String(project?.projectId||'');if(!projectId)throw new TypeError('Project identity is required.');
      if(journal.some(event=>String(event.projectId)!==projectId)||media.some(record=>String(record.projectId)!==projectId))throw new Error('Restored records must belong to the package Project.');
      const transaction=database.transaction(['projectRecords','journalEvents','missionMedia'],'readwrite'),done=transactionDone(transaction);
      try{
        await requestResult(transaction.objectStore('projectRecords').add(structuredClone(project)));
        for(const event of journal)await requestResult(transaction.objectStore('journalEvents').add(structuredClone(event)));
        for(const record of media)await requestResult(transaction.objectStore('missionMedia').add(record));
        await done;return project;
      }catch(error){try{transaction.abort();}catch(_){ }try{await done;}catch(_){ }if(error?.name==='ConstraintError'){const duplicate=new Error(`Project already exists: ${projectId}`);duplicate.code='DUPLICATE_PROJECT';throw duplicate;}throw error;}
    }
  });
}

