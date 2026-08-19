const decoder=new TextDecoder();
import {readStoredZipBinary} from './portable-zip.js';
import {normalizeMediaExportRecord} from './photo-export-service.js';
import {checkpointEvidenceState} from '../domain/checkpoints/evidence.js';
const json=(files,name)=>{const bytes=files.get(name);if(!bytes)throw new Error(`Project package is missing ${name}.`);try{return JSON.parse(decoder.decode(bytes));}catch{throw new Error(`Project package contains invalid ${name}.`);}};
const completePair=records=>records.length===4&&['front','rear'].every(cameraRole=>['original','evidence'].every(role=>records.some(record=>record.cameraRole===cameraRole&&record.role===role)));
const validPairGroup=records=>{
  if(!records.length||records.length>4)return false;
  const slots=records.map(record=>`${record.cameraRole}:${record.role}`),validSlots=new Set(['front:original','front:evidence','rear:original','rear:evidence']);
  if(slots.some(slot=>!validSlots.has(slot))||new Set(slots).size!==slots.length)return false;
  // A group that claims completion must be structurally complete. Pending/failed
  // groups are valid recovery evidence and must survive backup without fabrication.
  return !records.some(record=>record.pairStatus==='complete')||completePair(records);
};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=value=>String(value??'').trim();
const sessionIdsFor=value=>[value?.sessionId,value?.metadata?.sessionId,value?.references?.sessionId].map(text).filter(Boolean);
function recordSessionId(value){const ids=new Set(sessionIdsFor(value));if(ids.size>1)throw new Error('Day package record contains conflicting session identities.');return [...ids][0]||null;}
const packageSession=payload=>{
  const sessionId=text(payload?.manifest?.sessionId||payload?.projectMetadata?.sessionId);if(!sessionId)return null;
  const session=payload?.projectMetadata?.project?.rallyExecution?.sessions?.[sessionId];
  if(!object(session))throw new Error('Day package session graph is missing the selected session.');
  return {sessionId,session,legacy:session.legacy===true||session.origin==='schema-v1-day-execution'};
};
const matchesSession=(value,identity)=>{const id=recordSessionId(value);return id?id===identity.sessionId:identity.legacy;};
function rewriteProjectIdentity(value,projectId,seen=new WeakMap()){
  if(value===null||typeof value!=='object')return value;
  if(typeof Blob!=='undefined'&&value instanceof Blob)return value;
  if(seen.has(value))return seen.get(value);
  const copy=Array.isArray(value)?[]:{};seen.set(value,copy);
  for(const [key,item] of Object.entries(value))copy[key]=key==='projectId'?projectId:rewriteProjectIdentity(item,projectId,seen);
  return copy;
}
function recoveryCopyPayload(payload,projectId,projectName){
  const originalProjectId=payload.manifest.projectId,rewritten=rewriteProjectIdentity(payload,projectId),project=rewritten.projectMetadata.project;
  project.projectId=projectId;project.id=projectId;project.name=projectName;project.lifecycleStatus='active';
  return {...rewritten,recoveryCopy:true,originalProjectId,
    manifest:{...rewritten.manifest,projectId,projectName,recoveryCopy:true,originalProjectId},
    projectMetadata:{...rewritten.projectMetadata,projectId,projectName,recoveryCopy:true,originalProjectId,project}};
}
function readScope(payload){const identity=packageSession(payload);return identity?{sessionId:identity.sessionId,includeLegacyUnscoped:identity.legacy}:{};}

/** Parses CannonMap's stored (uncompressed) ZIP without inflating all media. */
export async function readStoredProjectPackage(file){
  const bytes=new Uint8Array(await file.arrayBuffer()),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),files=new Map();let offset=0;
  while(offset+30<=bytes.length&&view.getUint32(offset,true)===0x04034b50){const method=view.getUint16(offset+8,true),size=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extraLength=view.getUint16(offset+28,true);if(method!==0)throw new Error('Compressed project packages are not supported by this version.');const start=offset+30+nameLength+extraLength,end=start+size;if(end>bytes.length)throw new Error('Project package is truncated.');files.set(decoder.decode(bytes.slice(offset+30,offset+30+nameLength)),bytes.slice(start,end));offset=end;}
  const project=json(files,'Project.json'),journal=json(files,'Journal.json'),settings=json(files,'Settings.json'),manifest=json(files,'project-manifest.json'),mediaIndex=json(files,'media-index.json');
  if(manifest.format!=='cannonmap-project-media-backup'||![1,2].includes(Number(manifest.version)))throw new Error('Unsupported CannonMap project package.');if(String(project.projectId)!==String(manifest.projectId))throw new Error('Project package identity mismatch.');if(mediaIndex.length!==manifest.mediaCount)throw new Error('Project package media manifest mismatch.');
  const media=[];for(const raw of mediaIndex){const record=normalizeMediaExportRecord(raw),archivePath=record.archivePath||`media/${record.name}`,data=files.get(archivePath);if(!data)throw new Error(`Project package is missing ${archivePath}.`);if(Number.isFinite(Number(record.size))&&Number(record.size)!==data.length)throw new Error(`Project package media size mismatch: ${record.name}.`);if(manifest.version===2&&(record.checksum?.algorithm!=='SHA-256'||await digest(data)!==record.checksum.value))throw new Error(`Project package checksum failed: ${record.name}.`);media.push({...record,blob:new Blob([data],{type:record.mimeType||'application/octet-stream'})});}
  return Object.freeze({project,journal,settings,manifest,media});
}

export function createJourneyPackageRestoreService({repository,projectLifecycle=null}={}){
  if(!repository)throw new TypeError('repository is required.');
  return Object.freeze({
    async inspectDay(file){return readStoredDayPackage(file);},
    async verifyExistingDay(file){
      const payload=await readStoredDayPackage(file),dayNumber=Number(payload.manifest.dayNumber),restored=await repository.readDay(payload.manifest.projectId,dayNumber,readScope(payload)),verification=await verifyRestoredDayPayload(payload,restored);
      return Object.freeze({...payload,verification,existingVerified:true});
    },
    async restoreDay(file,{mode='cancel',recoveryProjectId=null,onProgress=()=>{}}={}){
      let payload=await readStoredDayPackage(file);
      if(mode==='recovery-copy'){
        const originalProjectId=payload.manifest.projectId,projectId=String(recoveryProjectId||`${originalProjectId}-recovery-${Date.now()}`),projectName=`${payload.projectMetadata.projectName||'CannonMap'} Recovery Copy`;
        payload=recoveryCopyPayload(payload,projectId,projectName);
        onProgress('restore_copy_identity_created',{recoveryProjectId:projectId,recoveryProjectName:projectName});
        mode='cancel';
      }
      const dayNumber=Number(payload.manifest.dayNumber),objectiveCount=(payload.projectMetadata.dayFeatures||[]).length,pairCount=new Set(payload.media.map(item=>item.pairId).filter(Boolean)).size,rollbackSupported=typeof repository.restoreDaySnapshot==='function';let prior=null;
      const restoreAndVerify=async()=>{
        prior=rollbackSupported?await repository.readDay(payload.manifest.projectId,dayNumber):null;
        await repository.restoreDay(payload,{mode});
        onProgress('restore_project_written',{projectId:payload.manifest.projectId});onProgress('restore_day_written',{dayNumber,objectiveCount});onProgress('restore_journal_written',{eventCount:payload.journal.length});onProgress('restore_media_written',{mediaCount:payload.media.length,pairCount});onProgress('restore_postwrite_verification_started',{projectId:payload.manifest.projectId,dayNumber});
        try{const restored=await repository.readDay(payload.manifest.projectId,dayNumber,readScope(payload)),verification=await verifyRestoredDayPayload(payload,restored);onProgress('restore_postwrite_verification_passed',{projectId:verification.projectId,dayNumber,mediaCount:verification.mediaCount,journalCount:verification.journalEventCount,pairCount:verification.pairCount,sessionId:verification.sessionId||null});return verification;}
        catch(error){if(!rollbackSupported)throw error;try{await repository.restoreDaySnapshot(prior,{projectId:payload.manifest.projectId,dayNumber});onProgress('restore_postwrite_verification_rolled_back',{projectId:payload.manifest.projectId,dayNumber});}catch(rollbackError){const failure=new Error(`Restore verification failed and rollback could not restore the prior records: ${rollbackError.message}`,{cause:error});failure.code='RESTORE_ROLLBACK_FAILED';failure.rollbackError=rollbackError;throw failure;}error.code||='RESTORE_POSTWRITE_VERIFICATION_FAILED';error.rolledBack=true;throw error;}
      };
      const rollbackOnReopenFailure=rollbackSupported?async()=>{await repository.restoreDaySnapshot(prior,{projectId:payload.manifest.projectId,dayNumber});onProgress('restore_active_scope_reopen_rolled_back',{projectId:payload.manifest.projectId,dayNumber});}:null;
      const verification=typeof projectLifecycle?.withExternalProjectMutation==='function'?await projectLifecycle.withExternalProjectMutation(payload.manifest.projectId,restoreAndVerify,{rollbackOnReopenFailure}):await restoreAndVerify();
      return Object.freeze({...payload,verification});
    },
    async restore(file){const payload=await readStoredProjectPackage(file);await repository.restoreNew(payload);return payload;}
  });
}

const digest=async bytes=>{const hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,'0')).join('');};
const stateCounts=features=>({checkpointCount:features.length,collected:features.filter(item=>item.status==='collected').length,deferred:features.filter(item=>item.status==='deferred').length,failed:features.filter(item=>item.status==='failed').length,score:features.reduce((sum,item)=>sum+Number(item.scoreAwarded??(item.status==='collected'?item.points:0))||sum,0),hotelState:features.find(item=>item.type==='hotel')?.status||null});
const projection=value=>JSON.stringify(checkpointEvidenceState(value));
const serial=value=>JSON.stringify(value??null);
function verifySessionGraph(payload,project,expectedFeatures){
  const identity=packageSession(payload);if(!identity)return null;
  const {manifest,projectMetadata}=payload,day=Number(manifest.dayNumber),sessionId=identity.sessionId,actual=project?.rallyExecution?.sessions?.[sessionId],expected=identity.session;
  if(text(manifest.sessionId)!==sessionId||text(projectMetadata.sessionId)!==sessionId)throw new Error('Restore verification failed: session identity mismatch.');
  if(!object(actual)||text(actual.sessionId)!==sessionId||text(actual.projectId)!==text(manifest.projectId)||Number(actual.dayNumber)!==day)throw new Error('Restore verification failed: selected session is missing from the Project graph.');
  for(const key of ['rallyId','dayId','calendarDate','startedAt'])if(text(actual[key])!==text(expected[key]))throw new Error(`Restore verification failed: session ${key} mismatch.`);
  if(Number(actual.runNumber)!==Number(expected.runNumber))throw new Error('Restore verification failed: session run number mismatch.');
  const execution=project.rallyExecution||{},sessions=execution.sessions||{},daySessions=execution.daySessions||{},indexed=daySessions[String(day)]||[];if(indexed.filter(id=>String(id)===sessionId).length!==1)throw new Error('Restore verification failed: selected session is not indexed exactly once.');
  const indexedCounts=new Map();for(const [dayKey,ids] of Object.entries(daySessions)){if(!Array.isArray(ids)||new Set(ids.map(String)).size!==ids.length)throw new Error(`Restore verification failed: Day ${dayKey} session index is invalid.`);for(const idValue of ids){const id=text(idValue),stored=sessions[id];if(!object(stored)||Number(stored.dayNumber)!==Number(dayKey))throw new Error(`Restore verification failed: indexed session ${id} is invalid.`);indexedCounts.set(id,(indexedCounts.get(id)||0)+1);}}
  for(const [id,stored] of Object.entries(sessions)){if(!object(stored)||text(stored.sessionId)!==id||text(stored.projectId)!==text(manifest.projectId)||indexedCounts.get(id)!==1)throw new Error(`Restore verification failed: rally session graph is invalid for ${id}.`);}
  if(execution.activeSessionId&&!sessions[execution.activeSessionId])throw new Error('Restore verification failed: active session identity is missing.');
  if(serial(actual.checkpointStates)!==serial(expected.checkpointStates)||serial(actual.pendingEvidence)!==serial(expected.pendingEvidence)||text(actual.activeObjectiveId)!==text(expected.activeObjectiveId)||serial(actual.summary)!==serial(expected.summary)||Number(actual.nextDay||0)!==Number(expected.nextDay||0))throw new Error('Restore verification failed: selected session execution projection mismatch.');
  const featureIds=new Set((project.features||[]).filter(item=>Number(item.day)===day).map(item=>String(item.id)));for(const feature of expectedFeatures)if(!featureIds.has(String(feature.id)))throw new Error(`Restore verification failed: static objective ${feature.id} is missing.`);
  const manifestByFeatureId=new Map((manifest.checkpointStates||[]).map(item=>[String(item.id),item]));for(const expectedFeature of expectedFeatures){const manifestFeature=manifestByFeatureId.get(String(expectedFeature.id));if(manifestFeature?.checkpointEvidence&&JSON.stringify(manifestFeature.checkpointEvidence)!==projection(expectedFeature))throw new Error(`Restore verification failed: checkpoint evidence manifest mismatch for ${expectedFeature.id}.`);}
  return {identity,session:actual};
}
export async function verifyRestoredDayPayload(payload,restored){
  const {manifest,projectMetadata}=payload,day=Number(manifest.dayNumber),project=restored?.project,features=(project?.features||[]).filter(item=>Number(item.day)===day),expectedFeatures=projectMetadata.dayFeatures||(projectMetadata.project?.features||[]).filter(item=>Number(item.day)===day),sessionGraph=project?verifySessionGraph(payload,project,expectedFeatures):null,expected=stateCounts(expectedFeatures),actual=sessionGraph?expected:stateCounts(features);
  if(!project||String(project.projectId)!==String(manifest.projectId))throw new Error('Restore verification failed: Project identity mismatch.');
  if(!sessionGraph){
    if(actual.checkpointCount!==expected.checkpointCount||actual.collected!==expected.collected||actual.deferred!==expected.deferred||actual.failed!==expected.failed||actual.score!==expected.score||actual.hotelState!==expected.hotelState)throw new Error('Restore verification failed: checkpoint, score, or hotel state mismatch.');
    const byFeatureId=new Map(features.map(item=>[String(item.id),item])),manifestByFeatureId=new Map((manifest.checkpointStates||[]).map(item=>[String(item.id),item]));for(const expectedFeature of expectedFeatures){const feature=byFeatureId.get(String(expectedFeature.id));if(!feature||feature.status!==expectedFeature.status||Number(feature.scoreAwarded||0)!==Number(expectedFeature.scoreAwarded||0)||feature.type!==expectedFeature.type)throw new Error(`Restore verification failed: objective state mismatch for ${expectedFeature.id}.`);if(projection(feature)!==projection(expectedFeature))throw new Error(`Restore verification failed: checkpoint evidence mismatch for ${expectedFeature.id}.`);const manifestFeature=manifestByFeatureId.get(String(expectedFeature.id));if(manifestFeature?.checkpointEvidence&&JSON.stringify(manifestFeature.checkpointEvidence)!==projection(expectedFeature))throw new Error(`Restore verification failed: checkpoint evidence manifest mismatch for ${expectedFeature.id}.`);}
  }
  const restoredJournal=sessionGraph?(restored.journal||[]).filter(event=>matchesSession(event,sessionGraph.identity)):(restored.journal||[]),restoredMedia=sessionGraph?(restored.media||[]).filter(record=>matchesSession(record,sessionGraph.identity)):(restored.media||[]);
  if(restoredJournal.length!==manifest.journalEventCount||restoredMedia.length!==manifest.mediaCount)throw new Error('Restore verification failed: Journal or media count mismatch.');
  const expectedEventIds=new Set(payload.journal.map(event=>String(event.eventId)));if(restoredJournal.some(event=>!expectedEventIds.delete(String(event.eventId)))||expectedEventIds.size)throw new Error('Restore verification failed: Journal identity mismatch.');
  const expectedById=new Map(payload.media.map(item=>[String(item.mediaId),normalizeMediaExportRecord(item)])),paths=new Set(),pairs=new Map();for(const rawRecord of restoredMedia){const record=normalizeMediaExportRecord(rawRecord),expectedRecord=expectedById.get(String(record.mediaId)),archiveIdentity=record.archivePath||record.name;if(!expectedRecord||record.name!==expectedRecord.name||record.role!==expectedRecord.role||record.cameraRole!==expectedRecord.cameraRole||record.logicalSide!==expectedRecord.logicalSide||record.pairId!==expectedRecord.pairId||record.pairedMediaId!==expectedRecord.pairedMediaId||paths.has(archiveIdentity))throw new Error('Restore verification failed: media identity, filename, or relationship mismatch.');paths.add(archiveIdentity);const bytes=new Uint8Array(await record.blob.arrayBuffer());if(!bytes.byteLength||await digest(bytes)!==expectedRecord.checksum.value)throw new Error(`Restore verification failed: checksum mismatch for ${record.name}.`);if(record.pairId){if(!pairs.has(record.pairId))pairs.set(record.pairId,[]);pairs.get(record.pairId).push(record);}}
  for(const [pairId,records] of pairs)if(!validPairGroup(records))throw new Error(`Restore verification failed: invalid Capture Pair ${pairId}.`);
  return Object.freeze({verified:true,projectId:project.projectId,projectName:project.name,dayNumber:day,sessionId:sessionGraph?.identity.sessionId||null,status:sessionGraph?.session.status||manifest.dayState?.status||project.rallyExecution?.days?.[day]?.status||null,...actual,journalEventCount:restoredJournal.length,pairCount:pairs.size,mediaCount:restoredMedia.length,filenames:restoredMedia.map(record=>record.name)});
}
export async function readStoredDayPackage(file){
  const files=await readStoredZipBinary(file),parse=name=>{const bytes=files.get(name);if(!bytes)throw new Error(`Day package is missing ${name}.`);try{return JSON.parse(decoder.decode(bytes));}catch{throw new Error(`Day package contains invalid ${name}.`);}},manifest=parse('manifest/day-manifest.json'),projectMetadata=parse('manifest/project-metadata.json'),mediaIndex=parse('manifest/media-index.json'),journal=parse('journal/Daily_Journal.json');
  if(manifest.format!=='cannonmap-day-backup'||manifest.version!==2)throw new Error('Unsupported CannonMap day package.');if(String(projectMetadata.projectId)!==String(manifest.projectId)||Number(projectMetadata.dayNumber)!==Number(manifest.dayNumber))throw new Error('Day package identity mismatch.');
  if(!Array.isArray(journal)||!Array.isArray(mediaIndex)||mediaIndex.length!==manifest.mediaCount||journal.length!==manifest.journalEventCount)throw new Error('Day package manifest count mismatch.');
  const names=new Set(),media=[];for(const raw of mediaIndex){const record=normalizeMediaExportRecord(raw);if(!record.mediaId||!record.archivePath||names.has(record.archivePath))throw new Error('Day package media index is invalid.');names.add(record.archivePath);const bytes=files.get(record.archivePath);if(!bytes?.byteLength)throw new Error(`Day package is missing media bytes: ${record.archivePath}.`);if(record.checksum?.algorithm!=='SHA-256'||await digest(bytes)!==record.checksum.value)throw new Error(`Day package checksum failed: ${record.archivePath}.`);media.push({...record,blob:new Blob([bytes],{type:record.mimeType||'application/octet-stream'})});}
  const pairGroups=new Map();for(const record of media.filter(item=>item.pairId)){if(!pairGroups.has(record.pairId))pairGroups.set(record.pairId,[]);pairGroups.get(record.pairId).push(record);}
  for(const [pairId,records] of pairGroups)if(!validPairGroup(records))throw new Error(`Day package pair relationship is invalid: ${pairId}.`);
  const payload={manifest,projectMetadata,journal,media},identity=packageSession(payload);
  if(identity){
    if(text(manifest.sessionId)!==identity.sessionId||text(projectMetadata.sessionId)!==identity.sessionId||text(identity.session.projectId)!==text(manifest.projectId)||Number(identity.session.dayNumber)!==Number(manifest.dayNumber))throw new Error('Day package session identity mismatch.');
    const execution=projectMetadata.project?.rallyExecution||{},sessionIds=Object.keys(execution.sessions||{}),dayKeys=Object.keys(execution.daySessions||{}),indexed=(execution.daySessions||{})[String(manifest.dayNumber)]||[],stateKeys=Object.keys(execution.days||{});
    if(sessionIds.length!==1||sessionIds[0]!==identity.sessionId||dayKeys.length!==1||dayKeys[0]!==String(manifest.dayNumber)||indexed.length!==1||String(indexed[0])!==identity.sessionId||stateKeys.length!==1||stateKeys[0]!==String(manifest.dayNumber)||String(execution.activeSessionId)!==identity.sessionId)throw new Error('Day package contains execution state outside the selected rally session.');
    if(journal.some(event=>!matchesSession(event,identity))||media.some(record=>!matchesSession(record,identity)))throw new Error('Day package contains records from another rally session.');
  }
  return Object.freeze(payload);
}

