import {readStoredDayPackage} from './journey-package-restore.js';
import {assertDeliberateSessionMediaIdentity,createSessionProjectSnapshot} from './photo-export-service.js';

export const AUTOMATIC_BACKUP_TRIGGER=Object.freeze({SESSION_START:'session_start',CHECKPOINT_COMPLETED:'checkpoint_completed',SCHEDULED:'scheduled',DAY_COMPLETED:'day_completed',MANUAL:'manual'});
export const EXTERNAL_BACKUP_STATUS=Object.freeze({READY:'ready',NEEDS_PERMISSION:'needs-permission',UNSUPPORTED:'unsupported',FAILED:'failed',DISABLED:'disabled',DEFERRED:'deferred'});

const TRIGGERS=new Set(Object.values(AUTOMATIC_BACKUP_TRIGGER));
const clone=value=>value==null?value:structuredClone(value);
const text=value=>String(value??'').trim();
const errorText=error=>String(error?.message||error||'Unknown backup failure');
const positiveInteger=value=>Number.isInteger(Number(value))&&Number(value)>0?Number(value):null;
const sessionIds=value=>[value?.sessionId,value?.metadata?.sessionId,value?.references?.sessionId].map(text).filter(Boolean);
const legacySession=session=>session?.legacy===true||session?.origin==='schema-v1-day-execution';
const belongsToSession=(value,sessionId,{includeLegacyUnscoped=false}={})=>{const ids=sessionIds(value);return ids.includes(sessionId)||(includeLegacyUnscoped&&!ids.length);};
const recordDay=value=>Number(value?.dayNumber??value?.metadata?.dayNumber??value?.references?.dayNumber)||null;
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const fingerprintSource=manifest=>JSON.stringify(stable({sessionId:manifest.sessionId,dayNumber:manifest.dayNumber,journalFingerprint:manifest.journalFingerprint,mediaCount:manifest.mediaCount,checkpointStates:manifest.checkpointStates,dayState:manifest.dayState,projectChecksum:manifest.projectChecksum,settingsChecksum:manifest.settingsChecksum}));
const digest=async blob=>{const hash=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());return [...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,'0')).join('');};
const binaryValue=value=>globalThis.Blob&&value instanceof globalThis.Blob||value instanceof ArrayBuffer||ArrayBuffer.isView(value);
function withoutBinary(value,seen=new WeakMap()){
  if(value==null||typeof value!=='object')return value;
  if(binaryValue(value))return undefined;
  if(seen.has(value))return seen.get(value);
  const copy=Array.isArray(value)?[]:{};seen.set(value,copy);
  if(Array.isArray(value)){for(const item of value){const clean=withoutBinary(item,seen);if(clean!==undefined)copy.push(clean);}return copy;}
  for(const [key,item] of Object.entries(value)){const clean=withoutBinary(item,seen);if(clean!==undefined)copy[key]=clean;}
  return copy;
}
function containsBinary(value,seen=new WeakSet()){
  if(binaryValue(value))return true;
  if(value==null||typeof value!=='object'||seen.has(value))return false;
  seen.add(value);return Object.values(value).some(item=>containsBinary(item,seen));
}
const safePart=(value,fallback='CannonMap')=>text(value).normalize('NFKD').replace(/[^a-z0-9._-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,72)||fallback;
const safeStamp=value=>new Date(value).toISOString().replace(/[-:]/g,'').replace('T','_').replace('Z','Z');
const stableSessionStamp=value=>{const timestamp=Date.parse(value);return Number.isFinite(timestamp)?safeStamp(timestamp).replace(/\.\d{3}Z$/,'Z'):'Undated';};

function assertContext(value){
  const projectId=text(value?.projectId),session=value?.session,sessionId=text(session?.sessionId||value?.sessionId),dayNumber=positiveInteger(value?.dayNumber??session?.dayNumber);
  if(!projectId||!session||!sessionId||!dayNumber)throw new TypeError('Automatic recovery requires projectId, dayNumber, and an active session.');
  if(text(session.projectId)!==projectId||Number(session.dayNumber)!==dayNumber)throw new TypeError('Automatic recovery session scope does not match the active Project and day.');
  return {...value,projectId,dayNumber,sessionId,session};
}

async function verifyArchive(archive,verify){
  if(!archive?.verified||!(archive.blob instanceof Blob)||!archive.filename||!archive.manifest)throw new Error('Backup exporter did not return a verified archive.');
  const payload=await verify(archive.blob),manifest=payload?.manifest;
  if(!manifest||text(manifest.sessionId)!==text(archive.manifest.sessionId)||Number(manifest.dayNumber)!==Number(archive.manifest.dayNumber))throw new Error('Backup verification returned the wrong session identity.');
  if(Number(manifest.journalEventCount)!==Number(archive.manifest.journalEventCount)||Number(manifest.mediaCount)!==Number(archive.manifest.mediaCount))throw new Error('Backup verification returned inconsistent Journal or media counts.');
  return payload;
}

function checkpointSummary(session){
  return Object.entries(session.checkpointStates||{}).sort(([a],[b])=>a.localeCompare(b)).map(([checkpointId,state])=>({checkpointId,status:state.status||null,scoreAwarded:Number(state.scoreAwarded)||0,arrivalState:state.arrivalState||state.checkpointEvidence?.arrival?.state||null,photoEvidenceState:state.photoEvidenceState||state.checkpointEvidence?.photo?.state||null,finalCompletionState:state.finalCompletionState||state.checkpointEvidence?.completion?.state||null,pairId:state.photoPair?.pairId||state.pendingPhotoPair?.pairId||state.checkpointEvidence?.photo?.pairId||null}));
}

const mediaDescriptor=row=>withoutBinary(row);

/** Compact recovery references authoritative missionMedia bytes instead of duplicating JPEGs. */
async function captureCompactRecovery(context,{mediaRepository,hashCache,clock,hash=digest}){
  const includeLegacyUnscoped=legacySession(context.session);let descriptors,exactSessionQuery=false;
  if(includeLegacyUnscoped&&typeof mediaRepository.listProjectPhotoDescriptors==='function')descriptors=await mediaRepository.listProjectPhotoDescriptors(context.projectId);
  else if(includeLegacyUnscoped&&typeof mediaRepository.listProjectPhotos==='function')descriptors=await mediaRepository.listProjectPhotos(context.projectId);
  else if(typeof mediaRepository.listProjectSessionPhotoDescriptors==='function'){descriptors=await mediaRepository.listProjectSessionPhotoDescriptors(context.projectId,context.sessionId);exactSessionQuery=true;}
  else if(typeof mediaRepository.listProjectSessionPhotos==='function'){descriptors=await mediaRepository.listProjectSessionPhotos(context.projectId,context.sessionId);exactSessionQuery=true;}
  else if(typeof mediaRepository.listProjectPhotoDescriptors==='function')descriptors=await mediaRepository.listProjectPhotoDescriptors(context.projectId);
  else descriptors=await mediaRepository.listProjectPhotos(context.projectId);
  if(!includeLegacyUnscoped&&!exactSessionQuery)descriptors=descriptors.filter(row=>belongsToSession(row,context.sessionId));
  assertDeliberateSessionMediaIdentity(descriptors,{projectId:context.projectId,dayNumber:context.dayNumber,session:context.session});
  const mediaRows=descriptors.filter(row=>belongsToSession(row,context.sessionId,{includeLegacyUnscoped})&&recordDay(row)===context.dayNumber),mediaReferences=[];
  for(const descriptor of mediaRows){
    const mediaId=text(descriptor?.mediaId),declaredSize=Number(descriptor?.size)||Number(descriptor?.blob?.size)||0;if(!mediaId||declaredSize<1)throw new Error(`Recovery media is unreadable: ${mediaId||'unknown'}.`);
    const cacheKey=`${mediaId}:${declaredSize}:${descriptor.capturedAt||descriptor.metadata?.captureTimestamp||''}`;let checksum=hashCache.get(cacheKey);
    if(!checksum){const stored=await mediaRepository.getMedia(mediaId);if(!(stored?.blob instanceof Blob)||stored.blob.size!==declaredSize)throw new Error(`Recovery media is unreadable: ${mediaId}.`);checksum=await hash(stored.blob);hashCache.set(cacheKey,checksum);}
    mediaReferences.push({...mediaDescriptor(descriptor),size:declaredSize,checksum:{algorithm:'SHA-256',value:checksum}});
  }
  mediaReferences.sort((a,b)=>String(a.mediaId).localeCompare(String(b.mediaId)));
  const journal=(context.journal||[]).filter(event=>belongsToSession(event,context.sessionId,{includeLegacyUnscoped})&&[null,context.dayNumber].includes(recordDay(event))&&event?.source!=='automatic_backup'&&!String(event?.eventType||'').startsWith('automatic_backup')&&!String(event?.eventType||'').startsWith('automatic_recovery')).map(clone),createdAt=clock.iso();
  const project=context.project?createSessionProjectSnapshot(context.project,context.dayNumber,context.session):null,settings=clone(context.settings||{}),projectChecksum=project?await hash(new Blob([JSON.stringify(stable(project))])):null,settingsChecksum=await hash(new Blob([JSON.stringify(stable(settings))])),journalFingerprint=await hash(new Blob([JSON.stringify(stable(journal))]));
  const manifest={format:'cannonmap-internal-recovery-snapshot',version:1,projectId:context.projectId,projectName:project?.name||context.project?.name||null,tripId:context.tripId||project?.tripId||context.projectId,rallyId:context.rallyId||context.session.rallyId||null,dayNumber:context.dayNumber,sessionId:context.sessionId,sessionRunNumber:Number(context.session.runNumber)||null,sessionStartedAt:context.session.startedAt||null,calendarDate:context.session.calendarDate||null,createdAt,journalEventCount:journal.length,journalFingerprint,mediaCount:mediaReferences.length,checkpointStates:checkpointSummary(context.session),dayState:{status:context.session.status||null,completedAt:context.session.completedAt||null,nextDay:Number(context.session.nextDay)||0},projectChecksum,settingsChecksum,applicationVersion:context.buildIdentity?.applicationVersion||null,buildId:context.buildIdentity?.buildId||null,serviceWorkerCacheId:context.buildIdentity?.serviceWorkerCacheId||null};
  return {manifest,recovery:{project,settings,session:clone(context.session),journal,mediaReferences},createdAt};
}

async function verifyCompactRecovery(record,{mediaRepository,hash=digest}){
  const recovery=record?.recovery,manifest=record?.manifest;
  if(!record?.verified||!recovery||text(record.sessionId)!==text(manifest?.sessionId)||Object.hasOwn(record,'blob'))throw new Error('Stored recovery snapshot identity is invalid.');
  if(recovery.journal.length!==Number(manifest.journalEventCount)||recovery.mediaReferences.length!==Number(manifest.mediaCount))throw new Error('Stored recovery snapshot count verification failed.');
  if(await hash(new Blob([JSON.stringify(stable(recovery.journal))]))!==manifest.journalFingerprint)throw new Error('Stored recovery Journal verification failed.');
  if(!recovery.project||text(recovery.project.projectId)!==text(manifest.projectId)||!recovery.project.rallyExecution?.sessions?.[manifest.sessionId]||await hash(new Blob([JSON.stringify(stable(recovery.project))]))!==manifest.projectChecksum||await hash(new Blob([JSON.stringify(stable(recovery.settings||{}))]))!==manifest.settingsChecksum)throw new Error('Stored recovery Project or settings verification failed.');
  if(JSON.stringify(stable(checkpointSummary(recovery.session)))!==JSON.stringify(stable(manifest.checkpointStates)))throw new Error('Stored recovery checkpoint evidence verification failed.');
  for(const reference of recovery.mediaReferences){
    if(containsBinary(reference)){const error=new Error('Stored recovery snapshot contains legacy binary media payloads.');error.code='RECOVERY_SNAPSHOT_BINARY_PAYLOAD';throw error;}
    if(!reference.mediaId||reference.checksum?.algorithm!=='SHA-256'||!reference.checksum?.value)throw new Error('Stored recovery snapshot media references are not compact checksummed descriptors.');
    const stored=await mediaRepository.getMedia(reference.mediaId),includeLegacyUnscoped=legacySession(recovery.session);assertDeliberateSessionMediaIdentity([stored],{projectId:manifest.projectId,dayNumber:manifest.dayNumber,session:recovery.session});
    if(!(stored?.blob instanceof Blob)||stored.blob.size!==Number(reference.size)||!belongsToSession(stored,manifest.sessionId,{includeLegacyUnscoped})||recordDay(stored)!==Number(manifest.dayNumber)||await hash(stored.blob)!==reference.checksum.value)throw new Error(`Stored recovery media verification failed: ${reference.mediaId}.`);
  }
  return true;
}

const triggerPriority=trigger=>trigger===AUTOMATIC_BACKUP_TRIGGER.MANUAL?5:trigger===AUTOMATIC_BACKUP_TRIGGER.DAY_COMPLETED?4:trigger===AUTOMATIC_BACKUP_TRIGGER.SCHEDULED?3:trigger===AUTOMATIC_BACKUP_TRIGGER.SESSION_START?2:1;

export function createAutomaticBackupService({exporter,snapshotRepository,mediaRepository,externalBackup=null,journal=null,clock={now:()=>Date.now(),iso:()=>new Date().toISOString()},createId=()=>crypto.randomUUID(),verify=readStoredDayPackage,hash=digest,intervalMs=2*60*60*1000,checkpointExternalMinIntervalMs=60*60*1000,setIntervalFn=globalThis.setInterval?.bind(globalThis),clearIntervalFn=globalThis.clearInterval?.bind(globalThis),globalSnapshotLimit=90,onResult=()=>{},onHeartbeat=()=>{}}={}){
  if(!snapshotRepository||typeof snapshotRepository.save!=='function')throw new TypeError('A recovery snapshot repository is required.');
  if(!mediaRepository||typeof mediaRepository.getMedia!=='function'||typeof mediaRepository.listProjectSessionPhotos!=='function'&&typeof mediaRepository.listProjectPhotos!=='function')throw new TypeError('A mission-media repository is required.');
  if(externalBackup&&typeof externalBackup.writeVerifiedGeneration!=='function'&&(!exporter||typeof exporter.dayBackup!=='function'))throw new TypeError('External automatic backup requires an incremental writer or day-backup exporter.');
  const pending=new Map(),trailing=new Map(),exactQueues=new Map(),providerTasks=new Set(),hashCache=new Map();let timer=null,contextProvider=null,destroyed=false,lastResult=null;
  const publish=()=>{try{onResult(clone(lastResult));}catch{}return lastResult;};

  async function append(eventType,context,metadata={}){
    if(!journal?.appendEventIdempotent)return;
    const timestamp=clock.iso(),titles={automatic_recovery_snapshot_verified:'Internal recovery snapshot verified',automatic_backup_verified:'External backup verified',automatic_backup_failed:'Automatic recovery needs attention',automatic_backup_external_attention:'External backup needs attention'};
    try{await journal.appendEventIdempotent({eventId:`backup:${context.sessionId}:${eventType}:${metadata.snapshotId||metadata.trigger||timestamp}`,projectId:context.projectId,sessionId:context.sessionId,eventType,source:'automatic_backup',timestamp,title:titles[eventType],summary:metadata.error||titles[eventType],references:{sessionId:context.sessionId},metadata:{...metadata,sessionId:context.sessionId,dayNumber:context.dayNumber}});}catch{/* Diagnostics must not affect riding. */}
  }

  async function shouldWriteExternal(trigger,prior){
    if(!externalBackup)return {due:false,capability:{status:EXTERNAL_BACKUP_STATUS.DISABLED}};
    const capability=await externalBackup.inspect();if(capability.status!==EXTERNAL_BACKUP_STATUS.READY)return {due:false,capability};
    if(trigger!==AUTOMATIC_BACKUP_TRIGGER.CHECKPOINT_COMPLETED)return {due:true,capability};
    const last=Date.parse(prior?.lastExternal?.verifiedAt||'');return {due:!Number.isFinite(last)||clock.now()-last>=checkpointExternalMinIntervalMs,capability};
  }

  function generationIdentity(context){
    const generationId=text(createId()),createdAt=clock.iso(),runNumber=Math.max(1,Number(context.session.runNumber)||1),projectPart=safePart(context.rallyName||context.project?.name||context.projectId,'Project'),sessionPart=safePart(context.sessionId,'Session').slice(0,12),startedAt=context.session.startedAt||context.session.sessionStartedAt||context.session.calendarDate,startStamp=stableSessionStamp(startedAt);
    return {
      generationId,createdAt,
      sessionDirectoryName:`CannonMap_${projectPart}_D${String(context.dayNumber).padStart(2,'0')}_Run${String(runNumber).padStart(2,'0')}_${startStamp}_${sessionPart}`,
      generationFilename:`Generation_${safeStamp(createdAt)}_${safePart(generationId,'generation')}.cmapbackup.json`
    };
  }

  async function writeIncrementalExternal(context,compact){
    const identity=generationIdentity(context),references=compact.recovery.mediaReferences,includeLegacyUnscoped=legacySession(context.session),manifest={
      ...clone(compact.manifest),format:'cannonmap-incremental-session-backup',version:1,generationId:identity.generationId,createdAt:identity.createdAt,exportedAt:identity.createdAt,
      project:clone(compact.recovery.project),settings:clone(compact.recovery.settings),session:clone(compact.recovery.session),journal:clone(compact.recovery.journal),
      journalEventCount:compact.manifest.journalEventCount,mediaCount:references.length,checkpointStates:clone(compact.manifest.checkpointStates),
      checkpointEvidenceSummary:clone(compact.manifest.checkpointStates),mediaStorage:'individual-files',commitMarker:'generation-manifest-written-last'
    };
    const openMedia=async reference=>{
      const stored=await mediaRepository.getMedia(reference.mediaId);
      if(!(stored?.blob instanceof Blob)||stored.blob.size!==Number(reference.size)||!belongsToSession(stored,context.sessionId,{includeLegacyUnscoped})||recordDay(stored)!==context.dayNumber)throw new Error(`External backup media is unavailable or outside the active session: ${reference.mediaId}.`);
      return stored.blob;
    };
    return externalBackup.writeVerifiedGeneration({sessionDirectoryName:identity.sessionDirectoryName,generationFilename:identity.generationFilename,manifest,media:references,openMedia});
  }

  async function writeExternal(context,trigger,prior,compact){
    const policy=await shouldWriteExternal(trigger,prior);
    if(!policy.due)return policy.capability.status===EXTERNAL_BACKUP_STATUS.READY?{status:EXTERNAL_BACKUP_STATUS.DEFERRED,reason:'checkpoint-write-amplification-guard',lastVerifiedAt:prior?.lastExternal?.verifiedAt||null}:policy.capability;
    try{
      if(typeof externalBackup.writeVerifiedGeneration==='function'){
        const result=await writeIncrementalExternal(context,compact);
        return result.status===EXTERNAL_BACKUP_STATUS.READY?{...result,verifiedAt:clock.iso()}:result;
      }
      const archive=await exporter.dayBackup(context.projectId,context.dayNumber,{...context.options,project:context.project,journal:context.journal||[],settings:context.settings||{},session:context.session,sessionIdentity:context.sessionIdentity,exportedAt:new Date(clock.now()),buildIdentity:context.buildIdentity,rallyName:context.rallyName,tripId:context.tripId,rallyId:context.rallyId});
      await verifyArchive(archive,verify);
      const result=await externalBackup.writeVerified({filename:archive.filename,blob:archive.blob,verify:async blob=>verifyArchive({...archive,blob},verify)});
      return result.status===EXTERNAL_BACKUP_STATUS.READY?{...result,verifiedAt:clock.iso(),manifest:clone(archive.manifest)}:result;
    }catch(error){return {status:EXTERNAL_BACKUP_STATUS.FAILED,error:errorText(error),priorVerifiedPreserved:true};}
  }

  async function perform(rawContext,trigger){
    const context=assertContext(rawContext);if(destroyed)return {status:'stopped',trigger,sessionId:context.sessionId};
    const compact=await captureCompactRecovery(context,{mediaRepository,hashCache,clock,hash}),fingerprint=await hash(new Blob([fingerprintSource(compact.manifest)])),prior=await snapshotRepository.latest?.(context.sessionId);let existing=await snapshotRepository.findByFingerprint?.(context.sessionId,fingerprint);
    if(existing)try{await verifyCompactRecovery(existing,{mediaRepository,hash});}catch(error){if(error?.code!=='RECOVERY_SNAPSHOT_BINARY_PAYLOAD')throw error;await snapshotRepository.delete?.(existing.snapshotId);existing=null;}
    if(existing){
      const external=await writeExternal(context,trigger,existing,compact);
      if(external.status===EXTERNAL_BACKUP_STATUS.READY)await append('automatic_backup_verified',context,{snapshotId:existing.snapshotId,trigger,filename:external.filename,journalEventCount:external.manifest.journalEventCount,mediaCount:external.manifest.mediaCount});
      else if([EXTERNAL_BACKUP_STATUS.FAILED,EXTERNAL_BACKUP_STATUS.NEEDS_PERMISSION].includes(external.status))await append('automatic_backup_external_attention',context,{snapshotId:existing.snapshotId,trigger,externalStatus:external.status,error:external.error||null});
      try{await snapshotRepository.updateExternal?.(existing.snapshotId,external,external.status===EXTERNAL_BACKUP_STATUS.READY?{verifiedAt:external.verifiedAt,filename:external.filename,size:external.size}:existing.lastExternal||null);}catch{/* Internal recovery remains authoritative. */}
      lastResult={status:'unchanged',trigger,sessionId:context.sessionId,snapshotId:existing.snapshotId,external};publish();return clone(lastResult);
    }
    const snapshotId=text(createId()),record={snapshotId,projectId:context.projectId,dayNumber:context.dayNumber,sessionId:context.sessionId,trigger,fingerprint,createdAt:compact.createdAt,manifest:compact.manifest,recovery:compact.recovery,verified:true,external:null,lastExternal:clone(prior?.lastExternal||null)};
    await verifyCompactRecovery(record,{mediaRepository,hash});await snapshotRepository.save(record);
    try{const restored=await snapshotRepository.get?.(snapshotId);if(restored)await verifyCompactRecovery(restored,{mediaRepository,hash});}catch(error){await snapshotRepository.delete?.(snapshotId);throw error;}
    await append('automatic_recovery_snapshot_verified',context,{snapshotId,trigger,journalEventCount:record.manifest.journalEventCount,mediaCount:record.manifest.mediaCount});
    const external=await writeExternal(context,trigger,prior,compact);
    if(external.status===EXTERNAL_BACKUP_STATUS.READY){record.lastExternal={verifiedAt:external.verifiedAt,filename:external.filename,size:external.size};await append('automatic_backup_verified',context,{snapshotId,trigger,filename:external.filename,journalEventCount:external.manifest.journalEventCount,mediaCount:external.manifest.mediaCount});}
    else if([EXTERNAL_BACKUP_STATUS.FAILED,EXTERNAL_BACKUP_STATUS.NEEDS_PERMISSION].includes(external.status))await append('automatic_backup_external_attention',context,{snapshotId,trigger,externalStatus:external.status,error:external.error||null});
    try{await snapshotRepository.updateExternal?.(snapshotId,external,record.lastExternal);await snapshotRepository.prune?.(context.sessionId,1,{keepSnapshotId:snapshotId});await snapshotRepository.pruneGlobal?.(Math.max(60,Number(globalSnapshotLimit)||90));}catch{/* Cleanup/status persistence is best effort. */}
    lastResult={status:'recovery-verified',trigger,sessionId:context.sessionId,snapshotId,manifest:clone(record.manifest),external};publish();return clone(lastResult);
  }

  function launch(context,trigger){
    const task=perform(context,trigger).catch(async error=>{lastResult={status:'failed',trigger,sessionId:context.sessionId,error:errorText(error)};publish();await append('automatic_backup_failed',context,{trigger,error:lastResult.error});return clone(lastResult);}).finally(()=>{
      pending.delete(context.sessionId);const exact=exactQueues.get(context.sessionId);
      if(exact?.length){const next=exact.shift();if(!exact.length)exactQueues.delete(context.sessionId);const nextTask=launch(next.context,next.trigger);nextTask.then(next.resolve,next.reject);return;}
      const next=trailing.get(context.sessionId);if(next){trailing.delete(context.sessionId);void launch(next.context,next.trigger);}
    });pending.set(context.sessionId,task);return task;
  }

  function queueExact(context,trigger){
    const queue=exactQueues.get(context.sessionId)||[];exactQueues.set(context.sessionId,queue);
    return new Promise((resolve,reject)=>queue.push({context,trigger,resolve,reject}));
  }

  function run(rawContext,{trigger=AUTOMATIC_BACKUP_TRIGGER.SCHEDULED,waitForOwnRun=false}={}){
    if(!TRIGGERS.has(trigger))return Promise.reject(new TypeError(`Unknown automatic backup trigger: ${trigger}`));let context;try{context=assertContext(rawContext);}catch(error){return Promise.reject(error);}
    const active=pending.get(context.sessionId);if(active){if(waitForOwnRun)return queueExact(context,trigger);const queued=trailing.get(context.sessionId);if(!queued||triggerPriority(trigger)>=triggerPriority(queued.trigger))trailing.set(context.sessionId,{context,trigger});return active;}
    return launch(context,trigger);
  }

  function enqueue(context,options={}){const task=run(context,options);void task.catch(()=>{});return Object.freeze({accepted:true,task});}
  function enqueueFromProvider(trigger){
    const task=Promise.resolve().then(()=>contextProvider?.()).then(context=>{if(context&&!destroyed)return enqueue(context,{trigger}).task;return null;}).catch(()=>{/* Scheduled backup context failures are reported by the next rider-visible health check. */});providerTasks.add(task);void task.finally(()=>providerTasks.delete(task));
  }
  function heartbeat(trigger){try{onHeartbeat({trigger,occurredAt:clock.iso()});}catch{}}
  function start(provider,{runImmediately=false}={}){contextProvider=typeof provider==='function'?provider:()=>provider;if(timer!==null||typeof setIntervalFn!=='function')return false;timer=setIntervalFn(()=>{heartbeat(AUTOMATIC_BACKUP_TRIGGER.SCHEDULED);enqueueFromProvider(AUTOMATIC_BACKUP_TRIGGER.SCHEDULED);},Math.max(60_000,Number(intervalMs)||2*60*60*1000));if(runImmediately){heartbeat(AUTOMATIC_BACKUP_TRIGGER.SESSION_START);enqueueFromProvider(AUTOMATIC_BACKUP_TRIGGER.SESSION_START);}return true;}
  return Object.freeze({run,enqueue,start,
    async latestRecovery(sessionId){const record=await snapshotRepository.latest?.(text(sessionId));if(!record)return null;await verifyCompactRecovery(record,{mediaRepository,hash});return clone(record);},
    async externalState(){return externalBackup?externalBackup.inspect():Object.freeze({status:EXTERNAL_BACKUP_STATUS.DISABLED,supported:false,configured:false});},
    async chooseExternalDirectoryFromUserGesture(){if(!externalBackup?.chooseDirectoryFromUserGesture)throw new Error('External directory backup is unsupported.');return externalBackup.chooseDirectoryFromUserGesture();},
    stop(){if(timer!==null&&typeof clearIntervalFn==='function')clearIntervalFn(timer);timer=null;contextProvider=null;},async drain(){do{await Promise.all([...providerTasks,...pending.values()]);}while(providerTasks.size||pending.size||trailing.size||exactQueues.size);return clone(lastResult);},state(){return Object.freeze({running:timer!==null,pendingSessions:Object.freeze([...pending.keys()]),trailingSessions:Object.freeze([...trailing.keys()]),exactQueuedSessions:Object.freeze([...exactQueues.keys()]),providerPending:providerTasks.size,lastResult:clone(lastResult)});},destroy(){destroyed=true;if(timer!==null&&typeof clearIntervalFn==='function')clearIntervalFn(timer);timer=null;contextProvider=null;trailing.clear();for(const queue of exactQueues.values())for(const item of queue)item.resolve({status:'stopped',trigger:item.trigger,sessionId:item.context.sessionId});exactQueues.clear();}});
}
