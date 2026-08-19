import {requestResult,transactionDone} from './request.js';
import {prepareMissionMediaRecord} from './mission-media-repository.js';
import {hydrateMissionMediaRecord} from './mission-media-repository.js';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=value=>String(value??'').trim();
const sessionIdsFor=value=>[value?.sessionId,value?.metadata?.sessionId,value?.references?.sessionId].map(text).filter(Boolean);
function recordSessionId(value){
  const identities=new Set(sessionIdsFor(value));
  if(identities.size>1)throw new Error('Restored day record contains conflicting session identities.');
  return [...identities][0]||null;
}
const recordDay=value=>Number(value?.metadata?.dayNumber||value?.references?.dayNumber);
const belongsToSession=(value,sessionId,{includeLegacyUnscoped=false}={})=>{
  const identity=recordSessionId(value);return identity?identity===sessionId:Boolean(includeLegacyUnscoped);
};
const replaceJournalRecord=(value,identity,dayNumber)=>{
  const sessionId=recordSessionId(value);
  return sessionId?sessionId===identity.sessionId:identity.legacy&&recordDay(value)===dayNumber;
};
const replaceMediaRecord=(value,identity,dayNumber)=>{
  const sessionId=recordSessionId(value);
  return sessionId?sessionId===identity.sessionId:identity.legacy&&Number(value?.metadata?.dayNumber)===dayNumber;
};
const sessionRecord=(project,sessionId)=>project?.rallyExecution?.sessions?.[sessionId]||null;
function validateSessionPackage({manifest,projectMetadata,journal,media},projectId,dayNumber){
  const sessionId=text(manifest?.sessionId||projectMetadata?.sessionId);if(!sessionId)return null;
  if(text(manifest?.sessionId)!==sessionId||text(projectMetadata?.sessionId)!==sessionId)throw new Error('Restored day session identity mismatch.');
  const session=sessionRecord(projectMetadata?.project,sessionId);
  if(!object(session)||text(session.sessionId)!==sessionId||text(session.projectId)!==projectId||Number(session.dayNumber)!==dayNumber)throw new Error('Restored day session graph is invalid.');
  const legacy=session.legacy===true||session.origin==='schema-v1-day-execution';
  if(journal.some(event=>recordDay(event)!==dayNumber||!belongsToSession(event,sessionId,{includeLegacyUnscoped:legacy})))throw new Error('Restored Journal records do not match the package session.');
  if(media.some(record=>Number(record?.metadata?.dayNumber)!==dayNumber||!belongsToSession(record,sessionId,{includeLegacyUnscoped:legacy})))throw new Error('Restored media records do not match the package session.');
  return {sessionId,session,legacy};
}
function neutralFeature(feature){
  const copy=structuredClone(feature);
  for(const key of ['arrivedAt','arrivalState','arrivalEvidence','arrivalPriorState','checkpointEvidence','photoStatus','photoEvidenceState','photoPair','photoPairId','pendingPhotoPair','photoFailureDisposition','manualPhotoStartedAt','manualCompletionRequestedAt','finalCompletionState','completionEvidence','completedAt','collectedAt','scoreAwarded','deferredAt','deferReason','restoredAt','failedAt','failReason','failureReason'])delete copy[key];
  if(['checkpoint','hotel'].includes(copy.type)&&copy.status!=='unavailable')copy.status='upcoming';
  return copy;
}
function mergeSessionDay(existing,incoming,projectMetadata,manifest,identity,projectId,dayNumber){
  const existingExecution=structuredClone(existing.rallyExecution||{}),incomingExecution=incoming.rallyExecution||{},existingActiveId=text(existingExecution.activeSessionId),preserveActive=Boolean(existingActiveId&&existingActiveId!==identity.sessionId&&existingExecution.sessions?.[existingActiveId]);
  const restoredSession=structuredClone(identity.session);if(preserveActive&&restoredSession.status==='active')restoredSession.status='suspended';
  const sessions={...(existingExecution.sessions||{}),[identity.sessionId]:restoredSession},dayKey=String(dayNumber),daySessions=new Set(existingExecution.daySessions?.[dayKey]||[]);daySessions.add(identity.sessionId);
  const incomingDayState=incomingExecution.days?.[dayKey]||manifest.dayState||null,days={...(existingExecution.days||{})};
  if(!preserveActive)days[dayKey]=structuredClone(incomingDayState);
  const rallyExecution={...existingExecution,schemaVersion:Math.max(2,Number(existingExecution.schemaVersion)||0),sessions,daySessions:{...(existingExecution.daySessions||{}),[dayKey]:[...daySessions]},days,activeSessionId:preserveActive?existingActiveId:identity.sessionId};
  const restoredDayFeatures=projectMetadata.dayFeatures||(incoming.features||[]).filter(feature=>Number(feature.day)===dayNumber);
  let features;
  if(preserveActive){
    features=[...(existing.features||[])];const ids=new Set(features.map(feature=>String(feature.id)));
    for(const feature of restoredDayFeatures)if(!ids.has(String(feature.id))){features.push(neutralFeature(feature));ids.add(String(feature.id));}
  }else features=[...(existing.features||[]).filter(feature=>Number(feature.day)!==dayNumber),...structuredClone(restoredDayFeatures)];
  return {...existing,projectId,id:projectId,features,rallyExecution};
}

/** Atomic Project + Journal + full-resolution media restore. Active lifecycle state is intentionally untouched. */
export function createJourneyRestoreRepository({database}={}){
  if(!database)throw new TypeError('database is required.');
  return Object.freeze({
    async restoreDay({manifest,projectMetadata,journal=[],media=[]},{mode='cancel'}={}){
      const projectId=String(manifest?.projectId||''),dayNumber=Number(manifest?.dayNumber),incoming=projectMetadata?.project;if(!projectId||!Number.isInteger(dayNumber)||dayNumber<1||!incoming)throw new TypeError('Day restore identity is required.');
      if(journal.some(event=>String(event.projectId)!==projectId)||media.some(record=>String(record.projectId)!==projectId))throw new Error('Restored day records must belong to the package Project.');
      const sessionIdentity=validateSessionPackage({manifest,projectMetadata,journal,media},projectId,dayNumber);
      const preparedMedia=await Promise.all(media.map(prepareMissionMediaRecord)),transaction=database.transaction(['projectRecords','journalEvents','missionMedia'],'readwrite'),done=transactionDone(transaction),projects=transaction.objectStore('projectRecords'),journals=transaction.objectStore('journalEvents'),assets=transaction.objectStore('missionMedia');
      try{
        const existing=await requestResult(projects.get(projectId));if(existing&&mode==='cancel'){const duplicate=new Error(`Project already exists: ${projectId}`);duplicate.code='DUPLICATE_PROJECT';throw duplicate;}if(existing&&mode!=='replace')throw new Error(`Unsupported day restore mode: ${mode}`);
        if(existing){
          const priorJournal=await requestResult(journals.index('projectId').getAll(projectId));for(const event of priorJournal)if(sessionIdentity?replaceJournalRecord(event,sessionIdentity,dayNumber):recordDay(event)===dayNumber)journals.delete(event.eventId);
          const priorMedia=await requestResult(assets.index('projectId').getAll(projectId));for(const record of priorMedia)if(sessionIdentity?replaceMediaRecord(record,sessionIdentity,dayNumber):Number(record.metadata?.dayNumber)===dayNumber)assets.delete(record.mediaId);
          if(sessionIdentity)projects.put(mergeSessionDay(existing,incoming,projectMetadata,manifest,sessionIdentity,projectId,dayNumber));
          else{
            const restoredDayFeatures=projectMetadata.dayFeatures||(incoming.features||[]).filter(feature=>Number(feature.day)===dayNumber),features=[...(existing.features||[]).filter(feature=>Number(feature.day)!==dayNumber),...restoredDayFeatures],days={...(existing.rallyExecution?.days||{}),[dayNumber]:incoming.rallyExecution?.days?.[dayNumber]||manifest.dayState};projects.put({...existing,projectId,id:projectId,features,rallyExecution:{...(existing.rallyExecution||{}),days}});
          }
        }else projects.add({...incoming,projectId,id:projectId,lifecycleStatus:incoming.lifecycleStatus||'active',updatedAt:incoming.updatedAt||new Date().toISOString()});
        for(const event of journal)journals.add(structuredClone(event));for(const record of preparedMedia)assets.add(record);await done;
        return {projectId,dayNumber,mode,mediaCount:preparedMedia.length,journalEventCount:journal.length};
      }catch(error){try{transaction.abort();}catch(_){ }try{await done;}catch(_){ }throw error;}
    },
    async readDay(projectId,dayNumber,{sessionId=null,includeLegacyUnscoped=false}={}){
      const id=String(projectId),day=Number(dayNumber),session=text(sessionId),transaction=database.transaction(['projectRecords','journalEvents','missionMedia'],'readonly'),done=transactionDone(transaction),project=await requestResult(transaction.objectStore('projectRecords').get(id)),journal=(await requestResult(transaction.objectStore('journalEvents').index('projectId').getAll(id))).filter(event=>recordDay(event)===day&&(!session||belongsToSession(event,session,{includeLegacyUnscoped}))),media=(await requestResult(transaction.objectStore('missionMedia').index('projectId').getAll(id))).filter(record=>Number(record.metadata?.dayNumber)===day&&(!session||belongsToSession(record,session,{includeLegacyUnscoped}))).map(hydrateMissionMediaRecord);await done;return {project:project||null,journal,media};
    },
    /** Restores the exact pre-mutation Project and all records for one day after post-write verification fails. */
    async restoreDaySnapshot(snapshot,{projectId,dayNumber}={}){
      const id=String(projectId||snapshot?.project?.projectId||''),day=Number(dayNumber);if(!id||!Number.isInteger(day)||day<1)throw new TypeError('Day rollback identity is required.');
      const priorProject=snapshot?.project?structuredClone(snapshot.project):null,priorJournal=structuredClone(snapshot?.journal||[]),preparedMedia=await Promise.all((snapshot?.media||[]).map(prepareMissionMediaRecord)),transaction=database.transaction(['projectRecords','journalEvents','missionMedia'],'readwrite'),done=transactionDone(transaction),projects=transaction.objectStore('projectRecords'),journals=transaction.objectStore('journalEvents'),assets=transaction.objectStore('missionMedia');
      try{
        const currentJournal=await requestResult(journals.index('projectId').getAll(id));for(const event of currentJournal)if(!priorProject||recordDay(event)===day)journals.delete(event.eventId);
        const currentMedia=await requestResult(assets.index('projectId').getAll(id));for(const record of currentMedia)if(!priorProject||Number(record.metadata?.dayNumber)===day)assets.delete(record.mediaId);
        if(priorProject)projects.put(priorProject);else projects.delete(id);
        for(const event of priorJournal)journals.add(event);for(const record of preparedMedia)assets.add(record);await done;return {projectId:id,dayNumber:day,rolledBack:true};
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
