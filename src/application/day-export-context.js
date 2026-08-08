const positiveDay=value=>{const day=Number(value);return Number.isInteger(day)&&day>=1?day:null;};
const timestamp=value=>{const parsed=Date.parse(value||'');return Number.isFinite(parsed)?parsed:0;};

/** Resolve the rider-visible execution day without treating the "all" planner filter as Day 0. */
export function resolveRallyExportDay({settings={},project={}}={}){
  const explicit=positiveDay(settings.dayFilter);if(explicit)return explicit;
  const features=project.features||[],running=features.filter(feature=>['active','photo_required','deferred'].includes(String(feature.status||'').toLowerCase())&&positiveDay(feature.day));
  if(running.length)return positiveDay(running.sort((a,b)=>timestamp(b.arrivedAt||b.deferredAt)-timestamp(a.arrivedAt||a.deferredAt))[0].day);
  const completed=Object.values(project.rallyExecution?.days||{}).filter(day=>day?.status==='complete'&&positiveDay(day.dayNumber));
  if(completed.length)return positiveDay(completed.sort((a,b)=>timestamp(b.completedAt)-timestamp(a.completedAt)||Number(b.dayNumber)-Number(a.dayNumber))[0].dayNumber);
  const collected=features.filter(feature=>String(feature.status||'').toLowerCase()==='collected'&&positiveDay(feature.day));
  if(collected.length)return positiveDay(collected.sort((a,b)=>timestamp(b.completedAt)-timestamp(a.completedAt)||Number(b.day)-Number(a.day))[0].day);
  return features.map(feature=>positiveDay(feature.day)).filter(Boolean).sort((a,b)=>a-b)[0]||null;
}

export function journalEventDay(event){
  return positiveDay(event?.metadata?.dayNumber)||positiveDay(event?.references?.dayNumber)||positiveDay(String(event?.metadata?.dayId||event?.references?.dayId||'').match(/(?:^|-)day-(\d+)$/i)?.[1]);
}

export function journalEventsForDay(events,dayNumber){
  const day=positiveDay(dayNumber);if(!day)return [];
  return (events||[]).filter(event=>journalEventDay(event)===day);
}
