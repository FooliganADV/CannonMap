import {
  createPendingEvidenceQueue,reconcilePendingEvidenceQueue
} from '../checkpoints/pending-evidence-queue.js';

export const RALLY_EXECUTION_SCHEMA_VERSION=2;

export const RALLY_SESSION_STATUS=Object.freeze({
  ACTIVE:'active',SUSPENDED:'suspended',COMPLETED:'completed'
});

/** Mutable checkpoint fields owned by one physical rally-day run. */
export const CHECKPOINT_EXECUTION_FIELDS=Object.freeze([
  'status',
  'arrivedAt','arrivalState','arrivalEvidence','arrivalPriorState','checkpointEvidence',
  'photoStatus','photoEvidenceState','photoPair','photoPairId','pendingPhotoPair',
  'photoFailureDisposition','manualPhotoStartedAt','manualCompletionRequestedAt',
  'finalCompletionState','completionEvidence','completedAt','collectedAt','scoreAwarded',
  'deferredAt','deferReason','restoredAt','failedAt','failReason','failureReason'
]);

const executionFieldSet=new Set(CHECKPOINT_EXECUTION_FIELDS);
const objectiveTypes=new Set(['checkpoint','hotel']);
const completedStatuses=new Set(['complete','completed']);
const resumableStatuses=new Set([RALLY_SESSION_STATUS.ACTIVE,RALLY_SESSION_STATUS.SUSPENDED]);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const clone=value=>value===undefined?undefined:structuredClone(value);
const positiveInteger=(value,name)=>{
  const number=Number(value);
  if(!Number.isInteger(number)||number<1)throw new TypeError(`${name} must be a positive integer.`);
  return number;
};
const text=(value,name)=>{
  const normalized=String(value??'').trim();
  if(!normalized)throw new TypeError(`${name} is required.`);
  return normalized;
};
const isoTimestamp=(value,name)=>{
  const timestamp=new Date(value);
  if(Number.isNaN(timestamp.valueOf()))throw new TypeError(`${name} must be a valid timestamp.`);
  return timestamp.toISOString();
};
const localCalendarDate=value=>{
  const date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.valueOf()))throw new TypeError('calendarDate requires a valid timestamp.');
  return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
};
const calendarDate=(value,fallback)=>{
  const normalized=String(value??'').trim();
  if(!normalized)return localCalendarDate(fallback);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(normalized)||Number.isNaN(Date.parse(`${normalized}T00:00:00`)))throw new TypeError('calendarDate must use YYYY-MM-DD.');
  return normalized;
};
const deepFreeze=value=>{
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    Object.freeze(value);for(const child of Object.values(value))deepFreeze(child);
  }
  return value;
};
const immutableCopy=value=>value===null?null:deepFreeze(clone(value));
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);

function stableUuid(value){
  let a=0x811c9dc5,b=0x9e3779b9;
  for(const character of String(value)){
    a=Math.imul(a^character.charCodeAt(0),0x01000193);
    b=Math.imul(b+character.charCodeAt(0),0x85ebca6b);
  }
  const hex=(number,length=8)=>(number>>>0).toString(16).padStart(length,'0').slice(-length);
  return `${hex(a)}-${hex(b,4)}-4${hex(a^b,3)}-8${hex(Math.imul(a,b),3)}-${hex(b^0xa5a5a5a5)}${hex(a^0x5a5a5a5a,4)}`;
}

function projectIdentity(project){return text(project?.projectId||project?.id,'projectId');}
function rallyIdentity(project){return String(project?.rallyId||project?.rally?.id||project?.tripId||projectIdentity(project));}
function dayFeatures(project,dayNumber){
  return (project?.features||[]).filter(feature=>objectiveTypes.has(feature?.type)&&Number(feature.day)===dayNumber);
}
function activeObjective(features){return features.find(feature=>String(feature.status).toLowerCase()==='active')?.id||null;}

function featureProjection(feature){
  const projection={};
  for(const key of CHECKPOINT_EXECUTION_FIELDS)if(own(feature,key))projection[key]=clone(feature[key]);
  return projection;
}

function checkpointStates(project,dayNumber){
  const states={};
  for(const feature of dayFeatures(project,dayNumber)){
    const featureId=text(feature.id,'checkpoint feature id');
    states[featureId]=featureProjection(feature);
  }
  return states;
}

function pendingEvidenceFromFeatures(project,dayNumber,sessionId,at){
  return reconcilePendingEvidenceQueue(createPendingEvidenceQueue(),{
    sessionId,checkpoints:dayFeatures(project,dayNumber),at
  }).queue;
}

function normalizedPendingEvidence(value,sessionId){
  if(value===undefined)return undefined;
  const entries=Array.isArray(value)?value:(object(value)&&Array.isArray(value.entries)?value.entries:null);
  if(!entries)throw new TypeError('pendingEvidence must be a queue object or legacy array.');
  return createPendingEvidenceQueue({entries:clone(entries).map(item=>{
    if(!object(item))throw new TypeError('pendingEvidence entries must be objects.');
    return {...item,sessionId,enqueuedAt:item.enqueuedAt||item.queuedAt||null,updatedAt:item.updatedAt||item.queuedAt||null};
  })});
}

function resetFeatureExecution(feature){
  const priorStatus=String(feature.status||'').toLowerCase();
  for(const key of executionFieldSet)delete feature[key];
  // Unavailable is a route/rules constraint; every other status belongs to a run.
  feature.status=priorStatus==='unavailable'?'unavailable':'upcoming';
  return feature;
}

function resetDayExecution(project,dayNumber){
  for(const feature of dayFeatures(project,dayNumber))resetFeatureExecution(feature);
}

function applyCheckpointStates(project,session){
  resetDayExecution(project,session.dayNumber);
  const byId=new Map(dayFeatures(project,session.dayNumber).map(feature=>[String(feature.id),feature]));
  for(const [featureId,projection] of Object.entries(session.checkpointStates||{})){
    const feature=byId.get(String(featureId));if(!feature||!object(projection))continue;
    for(const [key,value] of Object.entries(projection))if(executionFieldSet.has(key))feature[key]=clone(value);
  }
}

function normalizedSessionStatus(value){
  return completedStatuses.has(String(value||'').toLowerCase())?RALLY_SESSION_STATUS.COMPLETED:RALLY_SESSION_STATUS.SUSPENDED;
}

function dayStateTimestamp(dayState,features,fallback){
  const candidates=[dayState?.startedAt,dayState?.dayStartTimestamp,
    ...features.flatMap(feature=>[feature.arrivedAt,feature.completedAt,feature.deferredAt,feature.failedAt])];
  const first=candidates.find(value=>value&&!Number.isNaN(Date.parse(value)));
  return isoTimestamp(first||fallback,'legacy session start');
}

function legacySession(project,dayNumber,dayState,{migratedAt}){
  const projectId=projectIdentity(project),features=dayFeatures(project,dayNumber);
  const startedAt=dayStateTimestamp(dayState,features,migratedAt);
  const dayId=String(dayState?.dayId||`day-${dayNumber}`);
  const sessionId=`legacy-${stableUuid(`${projectId}:${dayId}:${startedAt}`)}`;
  const status=normalizedSessionStatus(dayState?.status);
  const session={
    schemaVersion:RALLY_EXECUTION_SCHEMA_VERSION,sessionId,projectId,rallyId:rallyIdentity(project),
    dayId,dayNumber,calendarDate:calendarDate(dayState?.calendarDate,startedAt),runNumber:positiveInteger(dayState?.runNumber||1,'runNumber'),
    status,startedAt,resumedAt:null,completedAt:status===RALLY_SESSION_STATUS.COMPLETED?
      (dayState?.completedAt?isoTimestamp(dayState.completedAt,'completedAt'):null):null,
    activeObjectiveId:dayState?.activeObjectiveId||dayState?.currentObjectiveId||activeObjective(features),
    checkpointStates:checkpointStates(project,dayNumber),pendingEvidence:createPendingEvidenceQueue(),
    summary:clone(dayState?.summary??null),nextDay:Number(dayState?.nextDay)||0,
    legacy:true,origin:'schema-v1-day-execution'
  };
  const storedPending=normalizedPendingEvidence(dayState?.pendingEvidence,sessionId);
  session.pendingEvidence=storedPending??pendingEvidenceFromFeatures(project,dayNumber,sessionId,startedAt);
  return session;
}

function rebuildDaySessions(execution){
  const index={};
  for(const session of Object.values(execution.sessions||{})){
    if(!object(session)||!session.sessionId)continue;
    const day=positiveInteger(session.dayNumber,'session dayNumber'),key=String(day);
    (index[key]||=[]).push(session.sessionId);
  }
  for(const ids of Object.values(index))ids.sort((leftId,rightId)=>{
    const left=execution.sessions[leftId],right=execution.sessions[rightId];
    return Number(left.runNumber)-Number(right.runNumber)||String(left.startedAt).localeCompare(String(right.startedAt))||leftId.localeCompare(rightId);
  });
  execution.daySessions=index;
}

function hasSubstantiveExecution(feature){
  const status=String(feature.status||'').toLowerCase();
  if(!['','planned','upcoming','unavailable'].includes(status))return true;
  if(['arrivedAt','completedAt','collectedAt','deferredAt','restoredAt','failedAt','manualPhotoStartedAt','manualCompletionRequestedAt']
    .some(key=>Boolean(feature[key])))return true;
  if(Number(feature.scoreAwarded)>0||feature.photoPair||feature.pendingPhotoPair||feature.photoFailureDisposition)return true;
  const evidence=feature.checkpointEvidence||{};
  return feature.arrivalState==='confirmed'||evidence.arrival?.state==='confirmed'||
    ![undefined,null,'not_attempted'].includes(feature.photoEvidenceState)||
    ![undefined,null,'not_attempted'].includes(evidence.photo?.state)||
    feature.finalCompletionState==='completed'||evidence.completion?.state==='completed';
}

function runtimeDaysWithoutDayState(project){
  const days=new Set();
  for(const feature of project?.features||[]){
    if(!objectiveTypes.has(feature?.type))continue;
    if(hasSubstantiveExecution(feature)){
      const day=Number(feature.day);if(Number.isInteger(day)&&day>0)days.add(day);
    }
  }
  return days;
}

/** Additively migrates the legacy day-number execution record. */
export function migrateRallyExecution(project,{migratedAt=new Date().toISOString()}={}){
  if(!object(project))throw new TypeError('A project is required.');
  projectIdentity(project);
  const prior=object(project.rallyExecution)?project.rallyExecution:{};
  if(Number(prior.schemaVersion)>=RALLY_EXECUTION_SCHEMA_VERSION&&object(prior.sessions)){
    prior.schemaVersion=RALLY_EXECUTION_SCHEMA_VERSION;
    prior.days=object(prior.days)?prior.days:{};
    for(const [sessionId,stored] of Object.entries(prior.sessions)){
      if(!object(stored))continue;
      if(String(stored.sessionId||sessionId)!==sessionId)throw new Error(`Rally session identity does not match its key: ${sessionId}`);
      stored.sessionId=sessionId;stored.schemaVersion=RALLY_EXECUTION_SCHEMA_VERSION;
      stored.status=stored.status==='complete'?RALLY_SESSION_STATUS.COMPLETED:stored.status;
      stored.checkpointStates=object(stored.checkpointStates)?stored.checkpointStates:{};
      stored.pendingEvidence=normalizedPendingEvidence(stored.pendingEvidence??[],sessionId);
      stored.nextDay=Number(stored.nextDay)||0;
    }
    rebuildDaySessions(prior);
    if(prior.activeSessionId&&!prior.sessions[prior.activeSessionId])prior.activeSessionId=null;
    project.rallyExecution=prior;return prior;
  }
  const migrationTimestamp=isoTimestamp(migratedAt,'migratedAt');
  const execution={...prior,schemaVersion:RALLY_EXECUTION_SCHEMA_VERSION,days:object(prior.days)?prior.days:{},sessions:{},daySessions:{},activeSessionId:null,
    migration:{fromSchemaVersion:Number(prior.schemaVersion)||1,migratedAt:migrationTimestamp}};
  const dayNumbers=new Set(Object.keys(execution.days).map(Number).filter(day=>Number.isInteger(day)&&day>0));
  for(const day of runtimeDaysWithoutDayState(project))dayNumbers.add(day);
  const candidates=[];
  for(const dayNumber of [...dayNumbers].sort((a,b)=>a-b)){
    const session=legacySession(project,dayNumber,execution.days[String(dayNumber)]||{}, {migratedAt:migrationTimestamp});
    execution.sessions[session.sessionId]=session;candidates.push(session);
  }
  const activeCandidates=candidates.filter(session=>String(execution.days[String(session.dayNumber)]?.status||'').toLowerCase()==='active')
    .sort((left,right)=>String(left.startedAt).localeCompare(String(right.startedAt))||left.dayNumber-right.dayNumber);
  const selected=activeCandidates.at(-1)||null;
  if(selected){selected.status=RALLY_SESSION_STATUS.ACTIVE;execution.activeSessionId=selected.sessionId;}
  rebuildDaySessions(execution);project.rallyExecution=execution;return execution;
}

function executionOf(project){return migrateRallyExecution(project);}

export function activeSession(project){
  const execution=executionOf(project),session=execution.activeSessionId?execution.sessions[execution.activeSessionId]:null;
  return immutableCopy(session||null);
}

export function listDaySessions(project,dayNumber){
  const day=positiveInteger(dayNumber,'dayNumber'),execution=executionOf(project);
  return deepFreeze((execution.daySessions[String(day)]||[]).map(id=>clone(execution.sessions[id])).filter(Boolean));
}

export function inspectRallySessions(project,{dayNumber}={}){
  const execution=executionOf(project),day=dayNumber===undefined?(execution.activeSessionId?execution.sessions[execution.activeSessionId]?.dayNumber:null):positiveInteger(dayNumber,'dayNumber');
  const sessions=day?listDaySessions(project,day):[];
  const unfinished=sessions.filter(session=>resumableStatuses.has(session.status));
  return deepFreeze({
    schemaVersion:execution.schemaVersion,activeSession:activeSession(project),dayNumber:day,
    daySessions:sessions,unfinishedSessions:unfinished,
    requiresStartChoice:unfinished.length>0,canStartNew:true,canResume:unfinished.length>0
  });
}

function sessionById(execution,sessionId){
  const id=text(sessionId,'sessionId'),session=execution.sessions[id];
  if(!session)throw new Error(`Unknown rally session: ${id}`);
  return session;
}

function compatibilityDayState(session){
  return {
    dayNumber:session.dayNumber,dayId:session.dayId,sessionId:session.sessionId,
    status:session.status===RALLY_SESSION_STATUS.COMPLETED?'complete':session.status,
    startedAt:session.startedAt,completedAt:session.completedAt||null,
    nextDay:Number(session.nextDay)||0,summary:clone(session.summary??null)
  };
}

/** Captures the live feature projection into the active session. */
export function syncActiveSession(project,{
  activeObjectiveId,pendingEvidence,status,completedAt,summary,nextDay,syncedAt=new Date().toISOString()
}={}){
  const execution=executionOf(project);
  if(!execution.activeSessionId)return null;
  const session=sessionById(execution,execution.activeSessionId),features=dayFeatures(project,session.dayNumber);
  const nextStatus=status===undefined?session.status:String(status);
  if(!Object.values(RALLY_SESSION_STATUS).includes(nextStatus))throw new TypeError(`Unsupported rally session status: ${nextStatus}`);
  const next={...session,
    status:nextStatus,
    completedAt:nextStatus===RALLY_SESSION_STATUS.COMPLETED?isoTimestamp(completedAt||session.completedAt||syncedAt,'completedAt'):null,
    summary:summary===undefined?clone(session.summary??null):clone(summary),
    nextDay:nextDay===undefined?(Number(session.nextDay)||0):(Number(nextDay)||0),
    activeObjectiveId:activeObjectiveId===undefined?activeObjective(features):(activeObjectiveId===null?null:String(activeObjectiveId)),
    checkpointStates:checkpointStates(project,session.dayNumber),
    pendingEvidence:pendingEvidence===undefined?clone(session.pendingEvidence||createPendingEvidenceQueue()):normalizedPendingEvidence(pendingEvidence,session.sessionId)
  };
  if(same(session,next))return immutableCopy(session);
  next.updatedAt=isoTimestamp(syncedAt,'syncedAt');execution.sessions[session.sessionId]=next;
  execution.days[String(next.dayNumber)]=compatibilityDayState(next);
  return immutableCopy(next);
}

function generatedSessionId(execution,createId){
  const factory=createId||(()=>globalThis.crypto?.randomUUID?.()||`session-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  for(let attempt=0;attempt<8;attempt++){
    const id=text(factory(),'sessionId');if(!execution.sessions[id])return id;
  }
  throw new Error('Unable to create a unique rally session identity.');
}

/** Starts a clean physical run while preserving every earlier session. */
export function startNewSession(project,{
  dayNumber,calendarDate:requestedCalendarDate,sessionId,startedAt=new Date().toISOString(),
  dayId,rallyId,createId,syncCurrent
}={}){
  const execution=executionOf(project),day=positiveInteger(dayNumber,'dayNumber'),timestamp=isoTimestamp(startedAt,'startedAt');
  const id=sessionId===undefined?generatedSessionId(execution,createId):text(sessionId,'sessionId');
  if(execution.sessions[id])throw new Error(`Rally session already exists: ${id}`);
  if(execution.activeSessionId){
    syncActiveSession(project,syncCurrent||{});
    const current=execution.sessions[execution.activeSessionId];
    if(current?.status===RALLY_SESSION_STATUS.ACTIVE){
      current.status=RALLY_SESSION_STATUS.SUSPENDED;
      execution.days[String(current.dayNumber)]=compatibilityDayState(current);
    }
  }
  const existing=listDaySessions(project,day),runNumber=Math.max(0,...existing.map(item=>Number(item.runNumber)||0))+1;
  resetDayExecution(project,day);
  const session={
    schemaVersion:RALLY_EXECUTION_SCHEMA_VERSION,sessionId:id,projectId:projectIdentity(project),
    rallyId:String(rallyId||rallyIdentity(project)),dayId:String(dayId||execution.days[String(day)]?.dayId||`day-${day}`),
    dayNumber:day,calendarDate:calendarDate(requestedCalendarDate,timestamp),runNumber,
    status:RALLY_SESSION_STATUS.ACTIVE,startedAt:timestamp,resumedAt:null,completedAt:null,
    activeObjectiveId:null,checkpointStates:checkpointStates(project,day),pendingEvidence:createPendingEvidenceQueue(),summary:null,nextDay:0,
    legacy:false,origin:'deliberate-start'
  };
  execution.sessions[id]=session;execution.activeSessionId=id;rebuildDaySessions(execution);
  execution.days[String(day)]=compatibilityDayState(session);
  return immutableCopy(session);
}

/** Restores one exact run projection; completed history cannot be resumed. */
export function resumeSession(project,sessionId,{resumedAt=new Date().toISOString(),syncCurrent}={}){
  const execution=executionOf(project),target=sessionById(execution,sessionId);
  if(target.status===RALLY_SESSION_STATUS.COMPLETED)throw new Error(`Completed rally session cannot be resumed: ${target.sessionId}`);
  if(execution.activeSessionId===target.sessionId&&target.status===RALLY_SESSION_STATUS.ACTIVE){
    applyCheckpointStates(project,target);execution.days[String(target.dayNumber)]=compatibilityDayState(target);
    return activeSession(project);
  }
  if(execution.activeSessionId){
    syncActiveSession(project,syncCurrent||{});
    const current=execution.sessions[execution.activeSessionId];
    if(current?.status===RALLY_SESSION_STATUS.ACTIVE){
      current.status=RALLY_SESSION_STATUS.SUSPENDED;
      execution.days[String(current.dayNumber)]=compatibilityDayState(current);
    }
  }
  const next={...target,status:RALLY_SESSION_STATUS.ACTIVE,resumedAt:isoTimestamp(resumedAt,'resumedAt')};
  execution.sessions[next.sessionId]=next;execution.activeSessionId=next.sessionId;
  applyCheckpointStates(project,next);execution.days[String(next.dayNumber)]=compatibilityDayState(next);
  return immutableCopy(next);
}
