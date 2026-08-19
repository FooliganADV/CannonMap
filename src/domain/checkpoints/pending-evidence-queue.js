import {isAuthoritativeCheckpointArrivalSource} from './evidence.js';

export const PENDING_EVIDENCE_QUEUE_SCHEMA_VERSION=1;

export const PENDING_EVIDENCE_STATUS=Object.freeze({
  PENDING:'pending',
  RESOLVED:'resolved',
  FAILED:'failed',
  DEFERRED:'deferred',
  CONTINUED:'continued'
});

export const PENDING_EVIDENCE_ACTION=Object.freeze({
  RETRY:'RETRY',
  RESUME:'RESUME',
  FAIL:'FAIL',
  DEFER:'DEFER',
  CONTINUE:'CONTINUE'
});

const STATUSES=new Set(Object.values(PENDING_EVIDENCE_STATUS));
const ACTIONS=new Set(Object.values(PENDING_EVIDENCE_ACTION));
const TERMINAL_STATUSES=new Set([
  PENDING_EVIDENCE_STATUS.RESOLVED,
  PENDING_EVIDENCE_STATUS.FAILED,
  PENDING_EVIDENCE_STATUS.DEFERRED
]);
const ACTIVE_STATUSES=new Set([
  PENDING_EVIDENCE_STATUS.PENDING,
  PENDING_EVIDENCE_STATUS.CONTINUED
]);

const clone=value=>value===undefined?undefined:structuredClone(value);
const text=value=>String(value??'').trim();
const finite=value=>value===null||value===undefined||value===''?null:(Number.isFinite(Number(value))?Number(value):null);
const timestamp=value=>{
  if(value===null||value===undefined||value==='')return null;
  const date=new Date(value);
  return Number.isNaN(date.valueOf())?null:date.toISOString();
};
const requiredText=(value,name)=>{
  const normalized=text(value);
  if(!normalized)throw new TypeError(`${name} is required.`);
  return normalized;
};
const requiredTimestamp=(value,name)=>{
  const normalized=timestamp(value);
  if(!normalized)throw new TypeError(`${name} must be a valid timestamp.`);
  return normalized;
};
const encode=value=>encodeURIComponent(requiredText(value,'identity component'));
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object||{},key);

function freezeDeep(value,seen=new WeakSet()){
  if(value===null||typeof value!=='object'||seen.has(value))return value;
  seen.add(value);
  for(const item of Object.values(value))freezeDeep(item,seen);
  return Object.freeze(value);
}

const immutable=value=>freezeDeep(clone(value));
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
const orderedSides=value=>[...new Set((Array.isArray(value)?value:[]).map(text).filter(Boolean))]
  .sort((left,right)=>['front','rear'].indexOf(left)-['front','rear'].indexOf(right)||left.localeCompare(right));

/** Stable across reloads and distinct for the same checkpoint in another run. */
export function pendingEvidenceKey(sessionId,checkpointId){
  return `${encode(sessionId)}::${encode(checkpointId)}`;
}

/** A replayed action with the same timestamp receives the same durable identity. */
export function pendingEvidenceActionIdentity({sessionId,checkpointId,action,at}={}){
  const normalizedAction=text(action).toUpperCase();
  if(!ACTIONS.has(normalizedAction))throw new TypeError(`Unsupported pending-evidence action: ${action}`);
  const occurredAt=requiredTimestamp(at,'at');
  return `pending-evidence-action:${pendingEvidenceKey(sessionId,checkpointId)}:${normalizedAction.toLowerCase()}:${encode(occurredAt)}`;
}

function normalizedAction(value,entry){
  const action=text(value?.action).toUpperCase(),at=timestamp(value?.at);
  if(!ACTIONS.has(action)||!at)return null;
  const actionId=text(value?.actionId)||pendingEvidenceActionIdentity({sessionId:entry.sessionId,checkpointId:entry.checkpointId,action,at});
  return immutable({
    actionId,action,at,
    reasonCode:text(value?.reasonCode)||null,
    metadata:clone(value?.metadata||{})
  });
}

function normalizedEntry(value){
  const sessionId=text(value?.sessionId),checkpointId=text(value?.checkpointId);
  if(!sessionId||!checkpointId)return null;
  const key=pendingEvidenceKey(sessionId,checkpointId),entry={
    key,
    entryId:text(value?.entryId)||`pending-evidence:${key}`,
    sessionId,
    checkpointId,
    checkpointName:text(value?.checkpointName)||null,
    dayId:text(value?.dayId)||null,
    dayNumber:finite(value?.dayNumber),
    arrivalId:text(value?.arrivalId)||null,
    enqueuedAt:timestamp(value?.enqueuedAt),
    photoState:text(value?.photoState)||'not_attempted',
    pairId:text(value?.pairId)||null,
    pairJournalEventId:text(value?.pairJournalEventId)||null,
    missingSides:orderedSides(value?.missingSides),
    fallbackExpiresAt:timestamp(value?.fallbackExpiresAt),
    lastAction:ACTIONS.has(text(value?.lastAction).toUpperCase())?text(value.lastAction).toUpperCase():null,
    lastActionAt:timestamp(value?.lastActionAt),
    status:STATUSES.has(text(value?.status).toLowerCase())?text(value.status).toLowerCase():PENDING_EVIDENCE_STATUS.PENDING,
    resolvedAt:timestamp(value?.resolvedAt),
    resolutionReason:text(value?.resolutionReason)||null,
    resolutionId:text(value?.resolutionId)||null,
    updatedAt:timestamp(value?.updatedAt),
    actions:[]
  };
  const actions=new Map();
  for(const raw of Array.isArray(value?.actions)?value.actions:[]){
    const action=normalizedAction(raw,entry);
    if(action&&!actions.has(action.actionId))actions.set(action.actionId,action);
  }
  entry.actions=[...actions.values()].sort((left,right)=>Date.parse(left.at)-Date.parse(right.at)||left.actionId.localeCompare(right.actionId));
  return immutable(entry);
}

function orderedEntries(entries){
  return [...entries].sort((left,right)=>(Date.parse(left.enqueuedAt||'')||Number.MAX_SAFE_INTEGER)-(Date.parse(right.enqueuedAt||'')||Number.MAX_SAFE_INTEGER)||
    (left.dayNumber??Number.MAX_SAFE_INTEGER)-(right.dayNumber??Number.MAX_SAFE_INTEGER)||left.checkpointId.localeCompare(right.checkpointId,'en',{numeric:true})||left.sessionId.localeCompare(right.sessionId));
}

export function createPendingEvidenceQueue(value={}){
  const entries=new Map(),source=Array.isArray(value)?value:(Array.isArray(value?.entries)?value.entries:[]);
  for(const raw of source){
    const entry=normalizedEntry(raw);
    if(!entry)continue;
    const prior=entries.get(entry.key);
    if(!prior){entries.set(entry.key,entry);continue;}
    const actions=new Map([...prior.actions,...entry.actions].map(action=>[action.actionId,action]));
    const newest=(Date.parse(entry.updatedAt||'')||0)>=(Date.parse(prior.updatedAt||'')||0)?entry:prior;
    entries.set(entry.key,normalizedEntry({...newest,actions:[...actions.values()]}));
  }
  return immutable({schemaVersion:PENDING_EVIDENCE_QUEUE_SCHEMA_VERSION,entries:orderedEntries(entries.values())});
}

function result(queue,entry,changed,reason,extra={}){
  return immutable({queue,entry:entry||null,changed:Boolean(changed),reason,...extra});
}

function replaceEntry(queue,nextEntry){
  const current=createPendingEvidenceQueue(queue),entries=new Map(current.entries.map(entry=>[entry.key,entry]));
  entries.set(nextEntry.key,normalizedEntry(nextEntry));
  return createPendingEvidenceQueue({entries:[...entries.values()]});
}

export function pendingEvidenceEntry(queue,{sessionId,checkpointId}={}){
  const key=pendingEvidenceKey(sessionId,checkpointId);
  return createPendingEvidenceQueue(queue).entries.find(entry=>entry.key===key)||null;
}

function projection(input={}){
  const checkpoint=input.checkpoint||input.projection||{},evidence=checkpoint.checkpointEvidence||checkpoint.evidence||{};
  const arrival=input.arrival||evidence.arrival||checkpoint.arrivalEvidence||{},photo=input.photo||evidence.photo||{};
  const completion=input.completion||evidence.completion||{};
  const sessionId=input.sessionId||checkpoint.sessionId||evidence.sessionId;
  const checkpointId=input.checkpointId||checkpoint.checkpointId||checkpoint.id;
  const photoRequired=input.photoRequired??photo.required??checkpoint.photoRequired;
  const photoState=text(input.photoState||photo.state||checkpoint.photoEvidenceState||checkpoint.photoStatus||'not_attempted').toLowerCase();
  return {
    sessionId,checkpointId,
    checkpointName:input.checkpointName||checkpoint.name,
    dayId:input.dayId||checkpoint.dayId||arrival.dayId,
    dayNumber:input.dayNumber??checkpoint.dayNumber??checkpoint.day??arrival.dayNumber,
    arrival,
    photo,
    completion,
    photoRequired:photoRequired===true,
    photoState,
    pairId:input.pairId||photo.pairId||checkpoint.pendingPhotoPair?.pairId||checkpoint.photoPair?.pairId,
    pairJournalEventId:input.pairJournalEventId||photo.pairJournalEventId||checkpoint.pendingPhotoPair?.pairJournalEventId||checkpoint.photoPair?.journalEventId,
    missingSides:input.missingSides||photo.missingSides||checkpoint.pendingPhotoPair?.missingSides,
    fallbackExpiresAt:own(input,'fallbackExpiresAt')?input.fallbackExpiresAt:(photo.fallbackExpiresAt??checkpoint.pendingEvidence?.fallbackExpiresAt??checkpoint.manualFallbackExpiresAt),
    at:input.at||photo.updatedAt||arrival.timestamp,
    complete:photoState==='complete'||text(completion.state).toLowerCase()==='completed'
  };
}

export function isAuthoritativePendingEvidenceArrival(value={}){
  const latitude=finite(value.latitude),longitude=finite(value.longitude),accuracy=finite(value.gpsAccuracyFeet??value.accuracyFeet);
  return value.state==='confirmed'&&value.trustworthy===true&&Boolean(timestamp(value.timestamp||value.confirmedAt))&&
    latitude!==null&&longitude!==null&&accuracy!==null&&accuracy>=0&&isAuthoritativeCheckpointArrivalSource(value.source);
}

/** Upserts only a confirmed arrival whose required photo evidence is incomplete. */
export function upsertPendingEvidence(queue,input={}){
  const current=createPendingEvidenceQueue(queue),facts=projection(input);
  const sessionId=requiredText(facts.sessionId,'sessionId'),checkpointId=requiredText(facts.checkpointId,'checkpointId');
  const existing=pendingEvidenceEntry(current,{sessionId,checkpointId});
  if(!isAuthoritativePendingEvidenceArrival(facts.arrival))return result(current,existing,false,'arrival-not-authoritative');
  if(!facts.photoRequired)return result(current,existing,false,'photo-not-required');
  if(facts.complete)return result(current,existing,false,'photo-already-complete');
  if(existing&&TERMINAL_STATUSES.has(existing.status))return result(current,existing,false,'entry-terminal');
  const enqueuedAt=existing?.enqueuedAt||requiredTimestamp(input.enqueuedAt||facts.arrival.timestamp,'enqueuedAt');
  const source={
    ...(existing||{}),
    key:pendingEvidenceKey(sessionId,checkpointId),
    entryId:existing?.entryId||`pending-evidence:${pendingEvidenceKey(sessionId,checkpointId)}`,
    sessionId,checkpointId,
    checkpointName:text(facts.checkpointName)||existing?.checkpointName||null,
    dayId:text(facts.dayId)||existing?.dayId||null,
    dayNumber:finite(facts.dayNumber)??existing?.dayNumber??null,
    arrivalId:existing?.arrivalId||text(facts.arrival.arrivalId)||`arrival:${pendingEvidenceKey(sessionId,checkpointId)}:${encode(enqueuedAt)}`,
    enqueuedAt,
    photoState:facts.photoState,
    pairId:text(facts.pairId)||existing?.pairId||null,
    pairJournalEventId:text(facts.pairJournalEventId)||existing?.pairJournalEventId||null,
    missingSides:Array.isArray(facts.missingSides)?orderedSides(facts.missingSides):(existing?.missingSides||[]),
    fallbackExpiresAt:facts.fallbackExpiresAt===undefined?(existing?.fallbackExpiresAt||null):timestamp(facts.fallbackExpiresAt),
    status:existing?.status||PENDING_EVIDENCE_STATUS.PENDING,
    actions:existing?.actions||[]
  };
  const comparable=normalizedEntry({...source,updatedAt:existing?.updatedAt||enqueuedAt});
  if(existing&&same(existing,comparable))return result(current,existing,false,'already-current');
  source.updatedAt=requiredTimestamp(facts.at||enqueuedAt,'updatedAt');
  const entry=normalizedEntry(source),next=replaceEntry(current,entry);
  return result(next,entry,true,existing?'updated':'enqueued');
}

export function listActivePendingEvidence(queue,{sessionId=null}={}){
  const filterSession=text(sessionId);
  return immutable(createPendingEvidenceQueue(queue).entries.filter(entry=>ACTIVE_STATUSES.has(entry.status)&&(!filterSession||entry.sessionId===filterSession)));
}

export function listExpiredPendingEvidence(queue,{sessionId=null,now}={}){
  const at=Date.parse(requiredTimestamp(now,'now'));
  return immutable(listActivePendingEvidence(queue,{sessionId}).filter(entry=>entry.fallbackExpiresAt&&Date.parse(entry.fallbackExpiresAt)<=at));
}

export function recordPendingEvidenceAction(queue,input={}){
  const current=createPendingEvidenceQueue(queue),sessionId=requiredText(input.sessionId,'sessionId'),checkpointId=requiredText(input.checkpointId,'checkpointId');
  const entry=pendingEvidenceEntry(current,{sessionId,checkpointId});
  if(!entry)return result(current,null,false,'entry-not-found');
  const action=text(input.action).toUpperCase();
  if(!ACTIONS.has(action))throw new TypeError(`Unsupported pending-evidence action: ${input.action}`);
  const at=requiredTimestamp(input.at,'at'),actionId=text(input.actionId)||pendingEvidenceActionIdentity({sessionId,checkpointId,action,at});
  const prior=entry.actions.find(item=>item.actionId===actionId);
  if(prior)return result(current,entry,false,'action-already-recorded',{action:prior});
  if(TERMINAL_STATUSES.has(entry.status))return result(current,entry,false,'entry-terminal');
  const actionRecord=immutable({actionId,action,at,reasonCode:text(input.reasonCode)||null,metadata:clone(input.metadata||{})});
  const status={
    RETRY:PENDING_EVIDENCE_STATUS.PENDING,
    RESUME:PENDING_EVIDENCE_STATUS.PENDING,
    FAIL:PENDING_EVIDENCE_STATUS.FAILED,
    DEFER:PENDING_EVIDENCE_STATUS.DEFERRED,
    CONTINUE:PENDING_EVIDENCE_STATUS.CONTINUED
  }[action];
  const nextEntry=normalizedEntry({...entry,status,lastAction:action,lastActionAt:at,updatedAt:at,actions:[...entry.actions,actionRecord]}),next=replaceEntry(current,nextEntry);
  return result(next,nextEntry,true,'action-recorded',{action:actionRecord});
}

/** Resolves exactly one queue entry; no checkpoint or scoring projection is mutated. */
export function resolvePendingEvidence(queue,{sessionId,checkpointId,at,reason='evidence-complete'}={}){
  const current=createPendingEvidenceQueue(queue),entry=pendingEvidenceEntry(current,{sessionId,checkpointId});
  if(!entry)return result(current,null,false,'entry-not-found');
  if(entry.status===PENDING_EVIDENCE_STATUS.RESOLVED)return result(current,entry,false,'already-resolved');
  if([PENDING_EVIDENCE_STATUS.FAILED,PENDING_EVIDENCE_STATUS.DEFERRED].includes(entry.status))return result(current,entry,false,'entry-terminal');
  const resolvedAt=requiredTimestamp(at,'at'),resolutionReason=text(reason)||'evidence-complete';
  const nextEntry=normalizedEntry({...entry,status:PENDING_EVIDENCE_STATUS.RESOLVED,photoState:'complete',resolvedAt,resolutionReason,
    resolutionId:`pending-evidence-resolution:${entry.key}:${encode(resolvedAt)}:${encode(resolutionReason)}`,updatedAt:resolvedAt});
  const next=replaceEntry(current,nextEntry);
  return result(next,nextEntry,true,'resolved');
}

/**
 * Rebuilds/upgrades the durable index from checkpoint evidence projections.
 * Omitted checkpoints and terminal history are retained; replay is idempotent.
 */
export function reconcilePendingEvidenceQueue(queue,{sessionId,checkpoints=[],at=new Date().toISOString()}={}){
  const normalizedSession=requiredText(sessionId,'sessionId'),started=createPendingEvidenceQueue(queue);let next=started,changed=false;
  for(const checkpoint of Array.isArray(checkpoints)?checkpoints:[]){
    const facts=projection({sessionId:normalizedSession,checkpoint,at}),checkpointId=text(facts.checkpointId);
    if(!checkpointId||!isAuthoritativePendingEvidenceArrival(facts.arrival)||!facts.photoRequired)continue;
    const existing=pendingEvidenceEntry(next,{sessionId:normalizedSession,checkpointId});
    if(facts.complete){
      if(existing&&ACTIVE_STATUSES.has(existing.status)){
        const resolution=resolvePendingEvidence(next,{sessionId:normalizedSession,checkpointId,at:facts.photo.updatedAt||facts.completion.completedAt||at,reason:'projection-evidence-complete'});
        next=resolution.queue;changed=changed||resolution.changed;
      }
      continue;
    }
    const update=upsertPendingEvidence(next,{sessionId:normalizedSession,checkpoint,at});
    next=update.queue;changed=changed||update.changed;
  }
  return result(next,null,changed,changed?'reconciled':'already-current',{active:listActivePendingEvidence(next,{sessionId:normalizedSession})});
}
