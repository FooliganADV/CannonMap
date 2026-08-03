export const CHECKPOINT_STATE=Object.freeze({
  UNAVAILABLE:'unavailable',UPCOMING:'upcoming',ACTIVE:'active',DEFERRED:'deferred',COLLECTED:'collected',FAILED:'failed',PHOTO_REQUIRED:'photo_required'
});
export const CHECKPOINT_STATUSES=Object.freeze(new Set(Object.values(CHECKPOINT_STATE)));

const LEGACY_STATE=Object.freeze({
  planned:CHECKPOINT_STATE.UPCOMING,next:CHECKPOINT_STATE.ACTIVE,completed:CHECKPOINT_STATE.COLLECTED,
  deferred:CHECKPOINT_STATE.DEFERRED,skipped:CHECKPOINT_STATE.FAILED,unreachable:CHECKPOINT_STATE.UNAVAILABLE
});

export const CHECKPOINT_COLOR=Object.freeze({
  [CHECKPOINT_STATE.UNAVAILABLE]:'#64748b',
  [CHECKPOINT_STATE.UPCOMING]:'#38bdf8',
  [CHECKPOINT_STATE.ACTIVE]:'#22c55e',
  [CHECKPOINT_STATE.PHOTO_REQUIRED]:'#a855f7',
  [CHECKPOINT_STATE.DEFERRED]:'#f59e0b',
  [CHECKPOINT_STATE.COLLECTED]:'#475569',
  [CHECKPOINT_STATE.FAILED]:'#ef4444'
});

const terminal=state=>[CHECKPOINT_STATE.COLLECTED,CHECKPOINT_STATE.FAILED,CHECKPOINT_STATE.UNAVAILABLE].includes(state);

export function checkpointState(value){
  const normalized=String(value||'').toLowerCase();
  return CHECKPOINT_STATUSES.has(normalized)?normalized:(LEGACY_STATE[normalized]||CHECKPOINT_STATE.UPCOMING);
}

export function rallyCheckpointNumber(value){
  const match=String(value||'').trim().match(/^(?:day\s*)?([1-8])\s*[.\-_]\s*(\d{1,3})\b/i);
  return match?{day:Number(match[1]),sequence:Number(match[2])}:null;
}

export function normalizeCheckpoint(feature,index=0){
  if(!['checkpoint','hotel'].includes(feature?.type))return feature;
  feature.extreme=feature.extreme===true||/\bextreme\b/i.test(`${feature.name||''} ${feature.notes||''}`);
  feature.points=feature.type==='hotel'?0:(Number.isFinite(Number(feature.points))?Number(feature.points):(feature.extreme?21:10));
  feature.status=checkpointState(feature.status);
  feature.sequence=Number.isFinite(Number(feature.sequence))?Number(feature.sequence):(Number(feature.sourceOrder)||index)+1;
  feature.originalSequence=Number.isFinite(Number(feature.originalSequence))?Number(feature.originalSequence):feature.sequence;
  feature.photoRequired=feature.photoRequired===true||feature.requiresPhoto===true||String(feature.photoRequirement||'').toLowerCase()==='required';
  feature.photoStatus=feature.photoStatus||'not_requested';
  for(const key of ['arrivedAt','completedAt','deferredAt','deferReason','restoredAt'])feature[key]=feature[key]??null;
  return feature;
}

export function activeRallyDay(settings){
  const value=Number(settings?.dayFilter);
  return value>=1&&value<=8?value:0;
}

export function dayCheckpoints(project,settings){
  const day=activeRallyDay(settings);
  return (project?.features||[])
    .filter(feature=>['checkpoint','hotel'].includes(feature.type)&&(!day||Number(feature.day)===day))
    .map(normalizeCheckpoint)
    .sort((a,b)=>(a.type==='hotel')-(b.type==='hotel')||(Number(a.sequence)||9999)-(Number(b.sequence)||9999));
}

export function currentCheckpoint(project,settings){
  const rows=dayCheckpoints(project,settings);
  return rows.find(feature=>[CHECKPOINT_STATE.ACTIVE,CHECKPOINT_STATE.PHOTO_REQUIRED].includes(feature.status))||
    rows.find(feature=>feature.type!=='hotel'&&feature.status===CHECKPOINT_STATE.UPCOMING)||
    (!rows.some(feature=>feature.type!=='hotel'&&feature.status===CHECKPOINT_STATE.DEFERRED)?
      rows.find(feature=>feature.type==='hotel'&&feature.status===CHECKPOINT_STATE.UPCOMING):null)||null;
}

export function currentHotel(project,settings){
  const day=activeRallyDay(settings);
  return (project?.features||[]).find(feature=>feature.type==='hotel'&&(!day||Number(feature.day)===day))||null;
}

export function rallyScore(project){
  return (project?.features||[]).filter(feature=>feature.type==='checkpoint'&&checkpointState(feature.status)===CHECKPOINT_STATE.COLLECTED)
    .reduce((score,feature)=>score+(Number(feature.points)||(feature.extreme?21:10)),0);
}

export function moveCheckpoint(rows,id,direction){
  const index=rows.findIndex(feature=>feature.id===id),target=index+direction;
  if(index<0||target<0||target>=rows.length)return null;
  [rows[index],rows[target]]=[rows[target],rows[index]];rows.forEach((feature,position)=>feature.sequence=position+1);return rows[target];
}

export function makeCheckpointNext(rows,id,now){
  const target=rows.find(feature=>feature.id===id);
  if(!target||terminal(checkpointState(target.status)))return null;
  rows.forEach(feature=>{if(feature.status===CHECKPOINT_STATE.ACTIVE)feature.status=CHECKPOINT_STATE.UPCOMING;});
  target.status=CHECKPOINT_STATE.ACTIVE;
  if(target.deferredAt){target.restoredAt=now;target.deferredAt=null;target.deferReason=null;}
  return target;
}

export function restoreImportedOrder(rows){rows.forEach(feature=>feature.sequence=Number(feature.originalSequence)||feature.sequence);return rows.length;}

export function activateNextPlanned(rows){
  const next=rows.find(feature=>feature.type!=='hotel'&&feature.status===CHECKPOINT_STATE.UPCOMING)||
    (!rows.some(feature=>feature.type!=='hotel'&&feature.status===CHECKPOINT_STATE.DEFERRED)?rows.find(feature=>feature.type==='hotel'&&feature.status===CHECKPOINT_STATE.UPCOMING):null)||null;
  if(next)next.status=CHECKPOINT_STATE.ACTIVE;return next;
}

export function selectNext(rows){
  const current=rows.find(feature=>feature.status===CHECKPOINT_STATE.ACTIVE);if(current)current.status=CHECKPOINT_STATE.UPCOMING;
  return activateNextPlanned(rows);
}

export function recordArrival(checkpoint,now){
  if(!checkpoint||checkpoint.status!==CHECKPOINT_STATE.ACTIVE)return null;
  checkpoint.arrivedAt=checkpoint.arrivedAt||now;
  if(checkpoint.photoRequired){checkpoint.status=CHECKPOINT_STATE.PHOTO_REQUIRED;checkpoint.photoStatus='required_pending';}
  return checkpoint;
}

export function completeCheckpoint(rows,checkpoint,now,{photoRecorded=false}={}){
  if(!checkpoint||checkpoint.status===CHECKPOINT_STATE.COLLECTED)return null;
  if(checkpoint.photoRequired&&!photoRecorded)return null;
  checkpoint.status=CHECKPOINT_STATE.COLLECTED;checkpoint.completedAt=now;checkpoint.photoStatus=photoRecorded?'recorded':checkpoint.photoRequired?'required_pending':'not_taken';
  checkpoint.deferredAt=null;checkpoint.deferReason=null;return activateNextPlanned(rows);
}

export const resumeDeferred=(rows,now)=>restoreDeferred(rows,now);
export function finishDayWithHotel(rows,now){
  const hotel=rows.find(feature=>feature.type==='hotel'&&!terminal(feature.status));return hotel?makeCheckpointNext(rows,hotel.id,now):null;
}

/** Returns the next day but never activates it. Explicit rider action owns activation. */
export function nextRallyDay(project,day){
  return [...new Set((project?.features||[]).map(feature=>Number(feature.day)).filter(value=>value>day&&value<=8))].sort((a,b)=>a-b)[0]||0;
}

export function startRallyDay(project,settings,day){
  const value=Number(day);if(!value||!(project?.features||[]).some(feature=>Number(feature.day)===value))return null;
  settings.dayFilter=String(value);return activateNextPlanned(dayCheckpoints(project,settings))||currentCheckpoint(project,settings);
}

export function deferCheckpoint(rows,checkpoint,reason,now){
  if(checkpoint?.type==='hotel'||checkpoint?.status===CHECKPOINT_STATE.PHOTO_REQUIRED)return null;
  checkpoint.status=CHECKPOINT_STATE.DEFERRED;checkpoint.deferredAt=now;checkpoint.deferReason=reason;return activateNextPlanned(rows);
}

export function restoreDeferred(rows,now){
  const checkpoint=rows.filter(feature=>feature.status===CHECKPOINT_STATE.DEFERRED).sort((a,b)=>Number(a.sequence)-Number(b.sequence))[0];if(!checkpoint)return null;
  const current=rows.find(feature=>feature.status===CHECKPOINT_STATE.ACTIVE);if(current)current.status=CHECKPOINT_STATE.UPCOMING;
  checkpoint.status=CHECKPOINT_STATE.ACTIVE;checkpoint.restoredAt=now;return checkpoint;
}

export function skipCheckpoint(rows,checkpoint){checkpoint.status=CHECKPOINT_STATE.FAILED;return activateNextPlanned(rows);}

export function deferForHotel(rows,now){
  const deferred=rows.filter(feature=>feature.type!=='hotel'&&[CHECKPOINT_STATE.UPCOMING,CHECKPOINT_STATE.ACTIVE].includes(feature.status));
  deferred.forEach(feature=>{feature.status=CHECKPOINT_STATE.DEFERRED;feature.deferredAt=now;feature.deferReason='Hotel bailout';});return deferred;
}
