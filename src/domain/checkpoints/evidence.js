export const CHECKPOINT_EVIDENCE_SCHEMA_VERSION=1;

export const CHECKPOINT_ARRIVAL_STATE=Object.freeze({
  NOT_CONFIRMED:'not_confirmed',
  CONFIRMED:'confirmed'
});

export const CHECKPOINT_PHOTO_EVIDENCE_STATE=Object.freeze({
  NOT_ATTEMPTED:'not_attempted',
  PERMISSION_BLOCKED:'permission_blocked',
  CAPTURE_STARTED:'capture_started',
  PARTIAL:'partial',
  INTERRUPTED:'interrupted',
  FAILED:'failed',
  COMPLETE:'complete'
});

export const CHECKPOINT_FINAL_COMPLETION_STATE=Object.freeze({
  PENDING:'pending',
  COMPLETED:'completed'
});

const ARRIVAL_STATES=new Set(Object.values(CHECKPOINT_ARRIVAL_STATE));
const PHOTO_STATES=new Set(Object.values(CHECKPOINT_PHOTO_EVIDENCE_STATE));
const COMPLETION_STATES=new Set(Object.values(CHECKPOINT_FINAL_COMPLETION_STATE));
const COMPLETE_STATUSES=new Set(['collected','completed']);

const clone=value=>value===undefined?undefined:structuredClone(value);
const finite=value=>value===null||value===undefined||value===''?null:(Number.isFinite(Number(value))?Number(value):null);
const stringOrNull=value=>value===null||value===undefined||String(value).trim()===''?null:String(value);
const timestampOrNull=value=>{
  if(value===null||value===undefined||value==='')return null;
  const date=new Date(value);
  return Number.isNaN(date.valueOf())?null:date.toISOString();
};
const booleanOrNull=value=>value===true?true:value===false?false:null;
const photoRequired=checkpoint=>checkpoint?.photoRequired===true;
const pointsFor=checkpoint=>checkpoint?.type==='hotel'?0:(Number.isFinite(Number(checkpoint?.points))?Number(checkpoint.points):(checkpoint?.extreme?21:10));

const AUTHORITATIVE_ARRIVAL_SOURCES=new Set(['gps_capture','gps-radius-dwell','checkpoint_arrival_coordinator','authoritative_gps']);

/** Only explicitly approved GPS-derived provenance may establish an encounter. */
export function isAuthoritativeCheckpointArrivalSource(value){
  const source=stringOrNull(value)?.toLowerCase();
  return Boolean(source&&AUTHORITATIVE_ARRIVAL_SOURCES.has(source));
}

function legacyPhotoState(checkpoint){
  if(checkpoint?.photoPair?.status==='complete'||checkpoint?.photoStatus==='recorded')return CHECKPOINT_PHOTO_EVIDENCE_STATE.COMPLETE;
  const pending=checkpoint?.pendingPhotoPair?.status;
  if(pending==='partial'||pending==='front_required'||pending==='rear_required')return CHECKPOINT_PHOTO_EVIDENCE_STATE.PARTIAL;
  if(['capture_started','capturing','pending','saving_pair'].includes(pending))return CHECKPOINT_PHOTO_EVIDENCE_STATE.CAPTURE_STARTED;
  if(pending==='interrupted')return CHECKPOINT_PHOTO_EVIDENCE_STATE.INTERRUPTED;
  const status=String(checkpoint?.photoStatus||'').toLowerCase();
  if(['permission_blocked','permission_denied','denied'].includes(status))return CHECKPOINT_PHOTO_EVIDENCE_STATE.PERMISSION_BLOCKED;
  if(['capture_started','capturing_front','capturing_rear','saving_front','saving_rear','saving_pair'].includes(status))return CHECKPOINT_PHOTO_EVIDENCE_STATE.CAPTURE_STARTED;
  if(['partial','front_required','rear_required'].includes(status))return CHECKPOINT_PHOTO_EVIDENCE_STATE.PARTIAL;
  if(['interrupted','canceled','cancelled'].includes(status))return CHECKPOINT_PHOTO_EVIDENCE_STATE.INTERRUPTED;
  if(['failed','camera_unavailable_high_speed','manual_fallback_expired'].includes(status))return CHECKPOINT_PHOTO_EVIDENCE_STATE.FAILED;
  return CHECKPOINT_PHOTO_EVIDENCE_STATE.NOT_ATTEMPTED;
}

function normalizedArrival(checkpoint,stored={}){
  const legacy=checkpoint?.arrivalEvidence&&typeof checkpoint.arrivalEvidence==='object'?checkpoint.arrivalEvidence:{};
  const source={...legacy,...(stored&&typeof stored==='object'?stored:{})};
  const timestamp=timestampOrNull(source.timestamp||source.confirmedAt||checkpoint?.arrivedAt);
  const latitude=finite(source.latitude),longitude=finite(source.longitude),gpsAccuracyFeet=finite(source.gpsAccuracyFeet??source.accuracyFeet);
  const requestedState=ARRIVAL_STATES.has(source.state)?source.state:(timestamp||Object.keys(legacy).length?CHECKPOINT_ARRIVAL_STATE.CONFIRMED:CHECKPOINT_ARRIVAL_STATE.NOT_CONFIRMED);
  const structurallyTrustworthy=timestamp!==null&&latitude!==null&&longitude!==null&&gpsAccuracyFeet!==null&&gpsAccuracyFeet>=0&&isAuthoritativeCheckpointArrivalSource(source.source);
  const state=requestedState===CHECKPOINT_ARRIVAL_STATE.CONFIRMED&&structurallyTrustworthy?CHECKPOINT_ARRIVAL_STATE.CONFIRMED:CHECKPOINT_ARRIVAL_STATE.NOT_CONFIRMED;
  if(state!==CHECKPOINT_ARRIVAL_STATE.CONFIRMED)return Object.freeze({state:CHECKPOINT_ARRIVAL_STATE.NOT_CONFIRMED,trustworthy:false});
  return Object.freeze({
    state,
    arrivalId:stringOrNull(source.arrivalId),
    journalEventId:stringOrNull(source.journalEventId),
    checkpointId:stringOrNull(source.checkpointId||checkpoint?.id),
    objectiveId:stringOrNull(source.objectiveId||checkpoint?.id),
    objectiveType:stringOrNull(source.objectiveType||checkpoint?.type),
    dayId:stringOrNull(source.dayId),
    dayNumber:finite(source.dayNumber??checkpoint?.day),
    timestamp,
    latitude,
    longitude,
    gpsAccuracyFeet,
    speedMph:finite(source.speedMph),
    motionState:stringOrNull(source.motionState||source.motion),
    heading:finite(source.heading),
    sampleTimestamp:timestampOrNull(source.sampleTimestamp),
    sampleAgeMs:finite(source.sampleAgeMs),
    source:stringOrNull(source.source)||'legacy',
    offline:booleanOrNull(source.offline),
    background:booleanOrNull(source.background),
    interruptionContext:clone(source.interruptionContext??null),
    trustworthy:true
  });
}

function normalizedPhoto(checkpoint,stored={}){
  const source=stored&&typeof stored==='object'?stored:{};
  const state=PHOTO_STATES.has(source.state)?source.state:legacyPhotoState(checkpoint);
  return Object.freeze({
    required:photoRequired(checkpoint),
    state,
    pairId:stringOrNull(source.pairId||checkpoint?.photoPair?.pairId||checkpoint?.pendingPhotoPair?.pairId),
    pairJournalEventId:stringOrNull(source.pairJournalEventId||checkpoint?.photoPair?.journalEventId||checkpoint?.pendingPhotoPair?.pairJournalEventId),
    reasonCode:stringOrNull(source.reasonCode||checkpoint?.photoFailureDisposition),
    failureReason:stringOrNull(source.failureReason),
    missingSides:Object.freeze(Array.isArray(source.missingSides)?[...new Set(source.missingSides.map(String))]:[]),
    mediaReferences:Object.freeze(clone(source.mediaReferences||{})),
    updatedAt:timestampOrNull(source.updatedAt)
  });
}

function normalizedCompletion(checkpoint,stored={},photo=normalizedPhoto(checkpoint)){
  const source=stored&&typeof stored==='object'?stored:{},legacyCompleted=COMPLETE_STATUSES.has(String(checkpoint?.status||'').toLowerCase());
  const requestedState=COMPLETION_STATES.has(source.state)?source.state:(legacyCompleted?CHECKPOINT_FINAL_COMPLETION_STATE.COMPLETED:CHECKPOINT_FINAL_COMPLETION_STATE.PENDING);
  const evidenceGateSatisfied=!photoRequired(checkpoint)||photo.state===CHECKPOINT_PHOTO_EVIDENCE_STATE.COMPLETE;
  const legacyCompletionWithoutRequiredPhoto=Boolean(requestedState===CHECKPOINT_FINAL_COMPLETION_STATE.COMPLETED&&!evidenceGateSatisfied);
  const state=legacyCompletionWithoutRequiredPhoto?CHECKPOINT_FINAL_COMPLETION_STATE.PENDING:requestedState;
  const pointsAwarded=state===CHECKPOINT_FINAL_COMPLETION_STATE.COMPLETED?
    (Number.isFinite(Number(source.pointsAwarded))?Number(source.pointsAwarded):(Number.isFinite(Number(checkpoint?.scoreAwarded))?Number(checkpoint.scoreAwarded):pointsFor(checkpoint))):0;
  return Object.freeze({
    state,
    completedAt:state===CHECKPOINT_FINAL_COMPLETION_STATE.COMPLETED?timestampOrNull(source.completedAt||checkpoint?.completedAt):null,
    pointsAwarded,
    legacyCompletionWithoutRequiredPhoto
  });
}

function normalizedState(checkpoint){
  const stored=checkpoint?.checkpointEvidence&&typeof checkpoint.checkpointEvidence==='object'?checkpoint.checkpointEvidence:{};
  const photo=normalizedPhoto(checkpoint,stored.photo);
  return Object.freeze({
    schemaVersion:CHECKPOINT_EVIDENCE_SCHEMA_VERSION,
    arrival:normalizedArrival(checkpoint,stored.arrival),
    photo,
    completion:normalizedCompletion(checkpoint,stored.completion,photo)
  });
}

function legacyPhotoStatus(photo){
  if(photo.state===CHECKPOINT_PHOTO_EVIDENCE_STATE.COMPLETE)return 'recorded';
  if(photo.state===CHECKPOINT_PHOTO_EVIDENCE_STATE.NOT_ATTEMPTED)return photo.required?'required_pending':'not_requested';
  return photo.state;
}

function applyState(checkpoint,state){
  checkpoint.checkpointEvidence=clone(state);
  checkpoint.arrivalState=state.arrival.state;
  if(state.arrival.state===CHECKPOINT_ARRIVAL_STATE.CONFIRMED){
    checkpoint.arrivedAt=state.arrival.timestamp||checkpoint.arrivedAt||null;
    const {state:discarded,...legacyArrival}=state.arrival;
    checkpoint.arrivalEvidence=clone(legacyArrival);
  }
  checkpoint.photoEvidenceState=state.photo.state;
  checkpoint.photoStatus=legacyPhotoStatus(state.photo);
  checkpoint.finalCompletionState=state.completion.state;
  checkpoint.scoreAwarded=state.completion.pointsAwarded;
  return state;
}

/** Returns a normalized immutable snapshot without changing the checkpoint. */
export function checkpointEvidenceState(checkpoint){
  if(!checkpoint||typeof checkpoint!=='object')throw new TypeError('A checkpoint is required.');
  return normalizedState(checkpoint);
}

/** Migrates legacy arrival/photo/completion fields into the explicit state model. */
export function reconcileCheckpointEvidenceState(checkpoint){
  if(!checkpoint||typeof checkpoint!=='object')throw new TypeError('A checkpoint is required.');
  return applyState(checkpoint,normalizedState(checkpoint));
}

/** Records the first authoritative arrival only; later replay is idempotent. */
export function recordCheckpointArrivalEvidence(checkpoint,input={}){
  if(!checkpoint||typeof checkpoint!=='object')throw new TypeError('A checkpoint is required.');
  const current=normalizedState(checkpoint);
  if(current.arrival.state===CHECKPOINT_ARRIVAL_STATE.CONFIRMED&&current.arrival.trustworthy){
    applyState(checkpoint,current);
    return Object.freeze({changed:false,arrival:current.arrival,state:current});
  }
  const timestamp=timestampOrNull(input.timestamp||input.detectedAtIso||input.sampleTimestamp);
  const latitude=finite(input.latitude),longitude=finite(input.longitude),gpsAccuracyFeet=finite(input.gpsAccuracyFeet??input.accuracyFeet);
  if(!timestamp||latitude===null||longitude===null||gpsAccuracyFeet===null||gpsAccuracyFeet<0)throw new TypeError('Confirmed arrival requires timestamp, coordinates, and GPS accuracy.');
  if(!isAuthoritativeCheckpointArrivalSource(input.source))throw new TypeError('Confirmed arrival requires authoritative GPS provenance.');
  const arrival=normalizedArrival(checkpoint,{
    ...input,state:CHECKPOINT_ARRIVAL_STATE.CONFIRMED,timestamp,latitude,longitude,gpsAccuracyFeet,
    checkpointId:checkpoint.id,objectiveId:checkpoint.id,objectiveType:checkpoint.type,dayNumber:checkpoint.day,
    trustworthy:true
  });
  const next=Object.freeze({...current,arrival});
  applyState(checkpoint,next);
  return Object.freeze({changed:true,arrival,state:next});
}

const TRANSITIONS=Object.freeze({
  [CHECKPOINT_PHOTO_EVIDENCE_STATE.NOT_ATTEMPTED]:new Set(Object.values(CHECKPOINT_PHOTO_EVIDENCE_STATE)),
  [CHECKPOINT_PHOTO_EVIDENCE_STATE.PERMISSION_BLOCKED]:new Set(['permission_blocked','capture_started','interrupted','failed','complete']),
  [CHECKPOINT_PHOTO_EVIDENCE_STATE.CAPTURE_STARTED]:new Set(['permission_blocked','capture_started','partial','interrupted','failed','complete']),
  [CHECKPOINT_PHOTO_EVIDENCE_STATE.PARTIAL]:new Set(['permission_blocked','capture_started','partial','interrupted','failed','complete']),
  [CHECKPOINT_PHOTO_EVIDENCE_STATE.INTERRUPTED]:new Set(['permission_blocked','capture_started','partial','interrupted','failed','complete']),
  [CHECKPOINT_PHOTO_EVIDENCE_STATE.FAILED]:new Set(['permission_blocked','capture_started','partial','interrupted','failed','complete']),
  [CHECKPOINT_PHOTO_EVIDENCE_STATE.COMPLETE]:new Set(['complete'])
});

export function transitionCheckpointPhotoEvidence(checkpoint,nextState,details={}){
  if(!PHOTO_STATES.has(String(nextState)))throw new TypeError(`Unsupported photo evidence state: ${nextState}`);
  const current=normalizedState(checkpoint),nextName=String(nextState);
  if(!TRANSITIONS[current.photo.state]?.has(nextName))throw new Error(`Invalid photo evidence transition: ${current.photo.state} -> ${nextName}`);
  const nextPhoto=normalizedPhoto(checkpoint,{
    ...current.photo,...details,state:nextName,
    updatedAt:details.updatedAt||new Date().toISOString()
  });
  const next=Object.freeze({...current,photo:nextPhoto});
  applyState(checkpoint,next);
  return Object.freeze({changed:current.photo.state!==nextName||JSON.stringify(current.photo)!==JSON.stringify(nextPhoto),photo:nextPhoto,state:next});
}

/** Strict evidence gate used before any normal completion or point award. */
export function checkpointCompletionDecision(checkpoint){
  const state=normalizedState(checkpoint);
  if(state.completion.state===CHECKPOINT_FINAL_COMPLETION_STATE.COMPLETED){
    return Object.freeze({allowed:true,reason:'already-completed',pointsAwarded:state.completion.pointsAwarded,state});
  }
  if(state.photo.required&&state.photo.state!==CHECKPOINT_PHOTO_EVIDENCE_STATE.COMPLETE){
    return Object.freeze({allowed:false,reason:'required-photo-evidence-incomplete',pointsAwarded:0,state});
  }
  return Object.freeze({allowed:true,reason:'evidence-gate-satisfied',pointsAwarded:pointsFor(checkpoint),state});
}

export function recordCheckpointFinalCompletion(checkpoint,{completedAt=new Date().toISOString()}={}){
  const decision=checkpointCompletionDecision(checkpoint);
  if(!decision.allowed||decision.reason==='already-completed')return Object.freeze({changed:false,...decision});
  const completion=Object.freeze({state:CHECKPOINT_FINAL_COMPLETION_STATE.COMPLETED,completedAt:timestampOrNull(completedAt),pointsAwarded:decision.pointsAwarded,legacyCompletionWithoutRequiredPhoto:false});
  if(!completion.completedAt)throw new TypeError('completedAt must be a valid timestamp.');
  const next=Object.freeze({...decision.state,completion});
  applyState(checkpoint,next);
  checkpoint.status='collected';
  checkpoint.completedAt=completion.completedAt;
  checkpoint.scoreAwarded=completion.pointsAwarded;
  return Object.freeze({changed:true,allowed:true,reason:'completed',pointsAwarded:completion.pointsAwarded,state:next});
}
