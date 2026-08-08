import {requestResult,transactionDone} from './request.js';
import {prepareMissionMediaRecord} from './mission-media-repository.js';

/** Atomic Project + Journal + full-resolution media restore. Active lifecycle state is intentionally untouched. */
export function createJourneyRestoreRepository({database}={}){
  if(!database)throw new TypeError('database is required.');
  return Object.freeze({
    async restoreDay({manifest,projectMetadata,journal=[],media=[]},{mode='cancel'}={}){
      const projectId=String(manifest?.projectId||''),dayNumber=Number(manifest?.dayNumber),incoming=projectMetadata?.project;if(!projectId||!Number.isInteger(dayNumber)||dayNumber<1||!incoming)throw new TypeError('Day restore identity is required.');
      if(journal.some(event=>String(event.projectId)!==projectId)||media.some(record=>String(record.projectId)!==projectId))throw new Error('Restored day records must belong to the package Project.');
      const preparedMedia=await Promise.all(media.map(prepareMissionMediaRecord)),transaction=database.transaction(['projectRecords','journalEvents','missionMedia'],'readwrite'),done=transactionDone(transaction),projects=transaction.objectStore('projectRecords'),journals=transaction.objectStore('journalEvents'),assets=transaction.objectStore('missionMedia');
      try{
        const existing=await requestResult(projects.get(projectId));if(existing&&mode==='cancel'){const duplicate=new Error(`Project already exists: ${projectId}`);duplicate.code='DUPLICATE_PROJECT';throw duplicate;}if(existing&&mode!=='replace')throw new Error(`Unsupported day restore mode: ${mode}`);
        if(existing){
          const priorJournal=await requestResult(journals.index('projectId').getAll(projectId));for(const event of priorJournal)if(Number(event.metadata?.dayNumber||event.references?.dayNumber)===dayNumber)journals.delete(event.eventId);
          const priorMedia=await requestResult(assets.index('projectId').getAll(projectId));for(const record of priorMedia)if(Number(record.metadata?.dayNumber)===dayNumber)assets.delete(record.mediaId);
          const features=[...(existing.features||[]).filter(feature=>Number(feature.day)!==dayNumber),...(incoming.features||[])],days={...(existing.rallyExecution?.days||{}),...(incoming.rallyExecution?.days||{})};projects.put({...existing,...incoming,projectId,id:projectId,features,rallyExecution:{...(existing.rallyExecution||{}),...(incoming.rallyExecution||{}),days}});
        }else projects.add({...incoming,projectId,id:projectId});
        for(const event of journal)journals.add(structuredClone(event));for(const record of preparedMedia)assets.add(record);await done;
        return {projectId,dayNumber,mode,mediaCount:preparedMedia.length,journalEventCount:journal.length};
      }catch(error){try{transaction.abort();}catch(_){ }try{await done;}catch(_){ }throw error;}
    },
    async restoreNew({project,journal=[],media=[]}){
      const projectId=String(project?.projectId||'');if(!projectId)throw new TypeError('Project identity is required.');
      if(journal.some(event=>String(event.projectId)!==projectId)||media.some(record=>String(record.projectId)!==projectId))throw new Error('Restored records must belong to the package Project.');
      const preparedMedia=await Promise.all(media.map(prepareMissionMediaRecord));
      const transaction=database.transaction(['projectRecords','journalEvents','missionMedia'],'readwrite'),done=transactionDone(transaction);
      try{
        await requestResult(transaction.objectStore('projectRecords').add(structuredClone(project)));
        for(const event of journal)await requestResult(transaction.objectStore('journalEvents').add(structuredClone(event)));
        for(const record of preparedMedia)await requestResult(transaction.objectStore('missionMedia').add(record));
        await done;return project;
      }catch(error){try{transaction.abort();}catch(_){ }try{await done;}catch(_){ }if(error?.name==='ConstraintError'){const duplicate=new Error(`Project already exists: ${projectId}`);duplicate.code='DUPLICATE_PROJECT';throw duplicate;}throw error;}
    }
  });
}
