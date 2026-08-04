const positiveDay=value=>{const day=Number(value);return Number.isInteger(day)&&day>0?day:0;};

/** Actual configured project days are authoritative; no fixed rally length exists. */
export function configuredProjectDays(project){
  return [...new Set((project?.features||[]).map(feature=>positiveDay(feature.day)).filter(Boolean))].sort((a,b)=>a-b);
}

export function nextConfiguredDay(project,currentDay){
  const current=positiveDay(currentDay);return configuredProjectDays(project).find(day=>day>current)||0;
}

export function projectHasDay(project,day){return configuredProjectDays(project).includes(positiveDay(day));}

