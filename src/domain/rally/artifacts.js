const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const deepFreeze=value=>{
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    Object.freeze(value);for(const child of Object.values(value))deepFreeze(child);
  }
  return value;
};
const required=(value,name)=>{
  const normalized=String(value??'').trim();
  if(!normalized)throw new TypeError(`${name} is required.`);
  return normalized;
};
const positiveInteger=(value,name)=>{
  const number=Number(value);
  if(!Number.isInteger(number)||number<1)throw new TypeError(`${name} must be a positive integer.`);
  return number;
};
const timestamp=(value,name)=>{
  const date=value instanceof Date?new Date(value.valueOf()):new Date(value);
  if(Number.isNaN(date.valueOf()))throw new TypeError(`${name} must be a valid timestamp.`);
  return date;
};
const pad=(value,width)=>String(value).padStart(width,'0');

/** Converts a human rally name into a portable, readable filename component. */
export function filesystemSafeRallySlug(value,{fallback='Rally'}={}){
  const words=String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .split(/[^A-Za-z0-9]+/).filter(Boolean);
  const slug=words.map(word=>word.charAt(0).toUpperCase()+word.slice(1)).join('');
  return slug||required(fallback,'fallback slug').replace(/[^A-Za-z0-9]/g,'')||'Rally';
}

const artifactLabel=value=>filesystemSafeRallySlug(value,{fallback:'Artifact'})||'Artifact';
const extension=value=>{
  const normalized=required(value,'extension').replace(/^\.+/,'');
  if(!/^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*$/.test(normalized))throw new TypeError('extension must be filesystem-safe.');
  return normalized.toLowerCase();
};

/** Builds a human-readable name while retaining opaque identity in the manifest. */
export function createSessionArtifactFilename({
  rallyName,rallySlug,dayNumber,runNumber,exportedAt=new Date(),artifactType,extension:requestedExtension
}={}){
  const date=timestamp(exportedAt,'exportedAt');
  const datePart=[date.getFullYear(),pad(date.getMonth()+1,2),pad(date.getDate(),2)].join('-');
  const timePart=`${pad(date.getHours(),2)}${pad(date.getMinutes(),2)}${pad(date.getSeconds(),2)}-${pad(date.getMilliseconds(),3)}`;
  return `CannonMap_${filesystemSafeRallySlug(rallySlug||rallyName)}_D${pad(positiveInteger(dayNumber,'dayNumber'),2)}_Run${pad(positiveInteger(runNumber,'runNumber'),2)}_${datePart}_${timePart}_${artifactLabel(artifactType)}.${extension(requestedExtension)}`;
}

/** Stable identity block shared by Backup, Journal, and Photos manifests. */
export function createSessionManifestIdentity({
  session,projectId,tripId,rallyId,dayId,dayNumber,calendarDate,sessionId,runNumber,
  sessionStartedAt,exportedAt=new Date(),applicationVersion,buildId,serviceWorkerCacheId
}={}){
  if(!object(session))session={};
  const exportDate=timestamp(exportedAt,'exportedAt').toISOString();
  const started=timestamp(sessionStartedAt||session.startedAt,'sessionStartedAt').toISOString();
  const date=required(calendarDate||session.calendarDate,'calendarDate');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(`${date}T00:00:00`)))throw new TypeError('calendarDate must use YYYY-MM-DD.');
  const resolvedProjectId=required(projectId||session.projectId,'projectId');
  return deepFreeze({
    projectId:resolvedProjectId,tripId:required(tripId||resolvedProjectId,'tripId'),
    rallyId:required(rallyId||session.rallyId,'rallyId'),dayId:required(dayId||session.dayId,'dayId'),
    dayNumber:positiveInteger(dayNumber??session.dayNumber,'dayNumber'),calendarDate:date,
    sessionId:required(sessionId||session.sessionId,'sessionId'),
    sessionRunNumber:positiveInteger(runNumber??session.runNumber,'runNumber'),sessionStartedAt:started,
    exportedAt:exportDate,applicationVersion:required(applicationVersion,'applicationVersion'),
    buildId:required(buildId,'buildId'),serviceWorkerCacheId:required(serviceWorkerCacheId,'serviceWorkerCacheId')
  });
}
