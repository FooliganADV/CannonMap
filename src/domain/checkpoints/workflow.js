export const CHECKPOINT_STATUSES=Object.freeze(new Set(['planned','next','completed','deferred','skipped','unreachable']));

export function rallyCheckpointNumber(value){
  const match=String(value||'').trim().match(/^(?:day\s*)?([1-9]\d*)\s*[.\-_]\s*(\d+)\b/i);
  if(!match)return null;
  const day=Number(match[1]),sequence=Number(match[2]);
  return Number.isSafeInteger(day)&&day>0&&Number.isSafeInteger(sequence)&&sequence>0?{day,sequence}:null;
}

export function normalizeCheckpoint(feature,index=0){
  if(feature?.type!=='checkpoint'&&feature?.type!=='hotel'&&feature?.dayFinish!==true)return feature;
  const numbered=feature.type==='checkpoint'?rallyCheckpointNumber(feature.name):null;
  if(numbered){
    feature.day=numbered.day;
    feature.sequence=numbered.sequence;
    feature.originalSequence=numbered.sequence;
    feature.sequenceSource='name';
    feature.sequenceNeedsReview=false;
  }else if(feature.type==='checkpoint'){
    feature.sequence=Number.isFinite(Number(feature.sequence))&&Number(feature.sequence)>0?Number(feature.sequence):null;
    feature.originalSequence=Number.isFinite(Number(feature.originalSequence))&&Number(feature.originalSequence)>0?Number(feature.originalSequence):feature.sequence;
    feature.sequenceSource=feature.sequenceSource||'manual';
    feature.sequenceNeedsReview=true;
  }
  feature.extreme=feature.extreme===true||/\bextreme\b/i.test(`${feature.name||''} ${feature.notes||''}`);
  feature.points=Number.isFinite(Number(feature.points))?Number(feature.points):(feature.type==='hotel'?0:feature.extreme?21:10);
  feature.status=CHECKPOINT_STATUSES.has(feature.status)?feature.status:'planned';
  for(const key of ['completedAt','deferredAt','deferReason','restoredAt'])feature[key]=feature[key]??null;
  return feature;
}

export function activeRallyDay(settings){
  const value=Number(settings?.dayFilter);
  return Number.isSafeInteger(value)&&value>0?value:0;
}

export function dayCheckpoints(project,settings){
  const day=activeRallyDay(settings);
  return (project?.features||[])
    .filter(feature=>(feature.type==='checkpoint'||isDayFinish(feature))&&(!day||Number(feature.day)===day))
    .map(normalizeCheckpoint)
    .sort((a,b)=>{
      if(isDayFinish(a)!==isDayFinish(b))return isDayFinish(a)?1:-1;
      const aSequence=Number(a.sequence),bSequence=Number(b.sequence);
      if(Number.isFinite(aSequence)!==Number.isFinite(bSequence))return Number.isFinite(aSequence)?-1:1;
      if(Number.isFinite(aSequence)&&aSequence!==bSequence)return aSequence-bSequence;
      return String(a.name||a.id||'').localeCompare(String(b.name||b.id||''),undefined,{numeric:true});
    });
}

export function isDayFinish(feature){
  return feature?.type==='hotel'||feature?.dayFinish===true;
}

export function nextRallyDay(project,currentDay){
  const expected=Number(currentDay)+1;
  return (project?.features||[]).some(feature=>Number(feature.day)===expected)?expected:0;
}

export function currentCheckpoint(project,settings){
  const rows=dayCheckpoints(project,settings);
  return rows.find(feature=>feature.status==='next')||rows.find(feature=>feature.status==='planned')||null;
}

export function currentHotel(project,settings){
  const day=activeRallyDay(settings);
  return (project?.features||[]).find(feature=>feature.type==='hotel'&&(!day||Number(feature.day)===day))||null;
}

export function rallyScore(project){
  return (project?.features||[])
    .filter(feature=>feature.type==='checkpoint'&&feature.status==='completed')
    .reduce((score,feature)=>score+(Number(feature.points)||(feature.extreme?21:10)),0);
}

export function moveCheckpoint(rows,id,direction){
  const index=rows.findIndex(feature=>feature.id===id),target=index+direction;
  if(index<0||target<0||target>=rows.length)return null;
  [rows[index],rows[target]]=[rows[target],rows[index]];
  rows.forEach((feature,position)=>feature.sequence=position+1);
  return rows[target];
}

export function makeCheckpointNext(rows,id,now){
  const target=rows.find(feature=>feature.id===id);
  if(!target||['completed','skipped','unreachable'].includes(target.status))return null;
  rows.forEach(feature=>{if(feature.status==='next')feature.status='planned';});
  target.status='next';
  if(target.deferredAt){
    target.restoredAt=now;
    target.deferredAt=null;
    target.deferReason=null;
  }
  return target;
}

export function restoreImportedOrder(rows){
  rows.forEach(feature=>feature.sequence=Number(feature.originalSequence)||feature.sequence);
  return rows.length;
}

export function activateNextPlanned(rows){
  const next=rows.find(feature=>feature.status==='planned')||null;
  if(next)next.status='next';
  return next;
}

export function selectNext(rows){
  const currentIndex=rows.findIndex(feature=>feature.status==='next');
  const current=currentIndex>=0?rows[currentIndex]:null;
  if(current)current.status='planned';
  const next=rows.slice(currentIndex+1).find(feature=>feature.status==='planned')
    ||rows.slice(0,currentIndex+1).find(feature=>feature.status==='planned')
    ||null;
  if(next)next.status='next';
  return next;
}

export function completeCheckpoint(rows,checkpoint,now){
  checkpoint.status='completed';
  checkpoint.completedAt=now;
  checkpoint.deferredAt=null;
  checkpoint.deferReason=null;
  return activateNextPlanned(rows);
}

export function deferCheckpoint(rows,checkpoint,reason,now){
  checkpoint.status='deferred';
  checkpoint.deferredAt=now;
  checkpoint.deferReason=reason;
  return activateNextPlanned(rows);
}

export function restoreDeferred(rows,now){
  const checkpoint=rows.find(feature=>feature.status==='deferred');
  if(!checkpoint)return null;
  const current=rows.find(feature=>feature.status==='next');
  if(current)current.status='planned';
  checkpoint.status='next';
  checkpoint.restoredAt=now;
  return checkpoint;
}

export function skipCheckpoint(rows,checkpoint){
  checkpoint.status='skipped';
  return activateNextPlanned(rows);
}

export function deferForHotel(rows,now){
  const deferred=rows.filter(feature=>['planned','next'].includes(feature.status));
  deferred.forEach(feature=>{
    feature.status='deferred';
    feature.deferredAt=now;
    feature.deferReason='Hotel bailout';
  });
  return deferred;
}
