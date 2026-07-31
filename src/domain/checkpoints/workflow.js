export const CHECKPOINT_STATUSES=Object.freeze(new Set(['planned','next','completed','deferred','skipped','unreachable']));

export function rallyCheckpointNumber(value){
  const match=String(value||'').trim().match(/^(?:day\s*)?([1-8])\s*[.\-_]\s*(\d{1,3})\b/i);
  return match?{day:Number(match[1]),sequence:Number(match[2])}:null;
}

export function normalizeCheckpoint(feature,index=0){
  if(!['checkpoint','hotel'].includes(feature?.type))return feature;
  feature.extreme=feature.extreme===true||/\bextreme\b/i.test(`${feature.name||''} ${feature.notes||''}`);
  feature.points=feature.type==='hotel'?0:(Number.isFinite(Number(feature.points))?Number(feature.points):(feature.extreme?21:10));
  feature.status=CHECKPOINT_STATUSES.has(feature.status)?feature.status:'planned';
  feature.sequence=Number.isFinite(Number(feature.sequence))?Number(feature.sequence):(Number(feature.sourceOrder)||index)+1;
  feature.originalSequence=Number.isFinite(Number(feature.originalSequence))?Number(feature.originalSequence):feature.sequence;
  for(const key of ['completedAt','deferredAt','deferReason','restoredAt'])feature[key]=feature[key]??null;
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
  const current=rows.find(feature=>feature.status==='next');
  if(current)current.status='planned';
  const next=rows.find(feature=>feature.status==='planned')||null;
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

export function advanceDayAfterHotel(project,settings,checkpoint){
  const day=activeRallyDay(settings);
  if(checkpoint?.type!=='hotel'||checkpoint.status!=='completed'||Number(checkpoint.day)!==day)return 0;
  const nextDay=[...(project?.features||[])]
    .map(feature=>Number(feature.day)).filter(value=>value>day&&value<=8).sort((a,b)=>a-b)[0]||0;
  if(nextDay)settings.dayFilter=String(nextDay);
  return nextDay;
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
  const deferred=rows.filter(feature=>feature.type!=='hotel'&&['planned','next'].includes(feature.status));
  deferred.forEach(feature=>{
    feature.status='deferred';
    feature.deferredAt=now;
    feature.deferReason='Hotel bailout';
  });
  return deferred;
}
