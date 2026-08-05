import {canonicalJson,sha256} from '../backup/archive.js';

export const FINALIZED_PACKAGE_VERSION=1;
export const FINALIZED_EXPORT_TYPE='finalized-project';
const pointTypes=new Set(['checkpoint','hotel','waypoint','fuel','start','finish']);
const lineTypes=new Set(['route','track','backbone']);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const clone=value=>structuredClone(value);
const dayOf=feature=>Number(feature?.day);
const locationOf=feature=>feature?.geometry?.kind==='point'?feature.geometry.coordinates?.[0]:null;
const issue=(severity,code,message,featureId=null)=>Object.freeze({severity,code,message,featureId});

export function validateFinalizedProject(project,{settings=project?.settings||{}}={}){
  const errors=[],warnings=[],features=Array.isArray(project?.features)?project.features:[];
  const add=(severity,code,message,featureId)=> (severity==='error'?errors:warnings).push(issue(severity,code,message,featureId));
  if(!String(project?.projectId||'').trim())add('error','PROJECT_ID_REQUIRED','Project ID is required.');
  if(!String(project?.name||'').trim())add('error','PROJECT_NAME_REQUIRED','Project name is required.');
  const ids=new Set(),days=new Set(),sequenceByDay=new Map(),hotels=new Map();
  for(const feature of features){
    const id=String(feature?.id||'');
    if(!id)add('error','FEATURE_ID_REQUIRED',`Feature ${feature?.name||'Unnamed'} has no identity.`);
    else if(ids.has(id))add('error','DUPLICATE_FEATURE_ID',`Duplicate feature ID: ${id}`,id);else ids.add(id);
    const day=dayOf(feature);if(Number.isInteger(day)&&day>0)days.add(day);
    if(pointTypes.has(feature?.type)){
      const point=locationOf(feature);if(!point||!Number.isFinite(Number(point.lat))||!Number.isFinite(Number(point.lon))||Math.abs(Number(point.lat))>90||Math.abs(Number(point.lon))>180)add('error','POINT_COORDINATES_INVALID',`${feature?.name||id} has invalid coordinates.`,id);
    }
    if(lineTypes.has(feature?.type)&&(!Array.isArray(feature?.geometry?.coordinates)||feature.geometry.coordinates.length<2))add('error','LINE_GEOMETRY_INVALID',`${feature?.name||id} has incomplete geometry.`,id);
    if(['checkpoint','hotel'].includes(feature?.type)){
      if(!Number.isInteger(day)||day<1)add('error','CHECKPOINT_DAY_REQUIRED',`${feature?.name||id} is not assigned to a configured day.`,id);
      const sequence=Number(feature?.sequence);if(!Number.isFinite(sequence))add('error','CHECKPOINT_SEQUENCE_REQUIRED',`${feature?.name||id} has no deterministic sequence.`,id);
      else {const key=`${day}:${sequence}`;if(sequenceByDay.has(key))add('error','DUPLICATE_SEQUENCE',`Day ${day} has duplicate sequence ${sequence}.`,id);else sequenceByDay.set(key,id);}
      if(feature.type==='hotel')hotels.set(day,(hotels.get(day)||0)+1);
      if(feature.points!==undefined&&feature.points!==null&&!Number.isFinite(Number(feature.points)))add('error','POINTS_INVALID',`${feature?.name||id} has invalid points.`,id);
      if(feature.photoRequired!==undefined&&typeof feature.photoRequired!=='boolean')add('error','PHOTO_REQUIREMENT_INVALID',`${feature?.name||id} has a malformed photo requirement.`,id);
    }
  }
  if(!days.size)add('error','DAYS_REQUIRED','At least one configured project day is required.');
  for(const day of [...days].sort((a,b)=>a-b)){const count=hotels.get(day)||0;if(count>1)add('error','MULTIPLE_DAY_HOTELS',`Day ${day} has more than one official hotel.`);if(!count)add('warning','DAY_HOTEL_MISSING',`Day ${day} has no official hotel.`);}
  if(!object(settings))add('error','MISSION_SETTINGS_INVALID','Mission Control settings are invalid.');
  if(!String(settings?.rallyEventId||'').trim())add('warning','COMPETITOR_FEED_UNCONFIGURED','Competitor event ID is not configured.');
  const report={valid:errors.length===0,errors,warnings,counts:{days:days.size,features:features.length,checkpoints:features.filter(f=>f.type==='checkpoint').length,hotels:features.filter(f=>f.type==='hotel').length,routes:features.filter(f=>f.type==='route').length,tracks:features.filter(f=>f.type==='track'||f.type==='backbone').length}};
  return Object.freeze(clone(report));
}

export function executionCleanProject(project){
  const clean=clone(project),runtimeKeys=['journal','analytics','photos','videos','stationaryEvents','rallyState','executionState','activeDay','dayState','collectedAt','completedAt'];
  for(const key of runtimeKeys)delete clean[key];
  clean.features=(clean.features||[]).map(feature=>{const copy={...feature};for(const key of ['status','collectedAt','completedAt','deferredAt','failedAt','photoStatus','arrivalEvidence','scoreAwarded','completionEvidence'])delete copy[key];return copy;});
  if(object(clean.settings))for(const key of ['rallyDays','mediaBackups','lastMediaExportAt','mediaBackupReminderDay','activeDay','currentObjectiveId','rallyStartedAt'])delete clean.settings[key];
  clean.competitors=[];return clean;
}

export async function createFinalizedEnvelope({project,settings,applicationVersion,buildId,finalizedAt,crypto=globalThis.crypto}={}){
  const validation=validateFinalizedProject(project,{settings});if(!validation.valid){const error=new Error('Project cannot be finalized until validation errors are resolved.');error.code='FINALIZATION_INVALID';error.report=validation;throw error;}
  const clean=executionCleanProject({...project,settings:clone(settings||{})}),projectJson=canonicalJson(clean),reportJson=canonicalJson(validation);
  const files={"project.json":projectJson,"validation-report.json":reportJson};
  const checksums={};for(const [name,value] of Object.entries(files))checksums[name]=await sha256(value,{crypto});
  const manifest={packageVersion:FINALIZED_PACKAGE_VERSION,exportType:FINALIZED_EXPORT_TYPE,projectId:String(clean.projectId),projectName:String(clean.name),projectSchemaVersion:Number(clean.schemaVersion||1),applicationVersion:String(applicationVersion),buildId:String(buildId),finalizedAt:new Date(finalizedAt).toISOString(),checksums,counts:validation.counts};
  files['manifest.json']=canonicalJson(manifest);return Object.freeze({manifest:Object.freeze(manifest),files:Object.freeze(files),master:Object.freeze(clean),validation});
}

export async function verifyFinalizedEnvelope(files,{crypto=globalThis.crypto,supportedVersion=FINALIZED_PACKAGE_VERSION}={}){
  for(const name of ['manifest.json','project.json','validation-report.json'])if(typeof files?.[name]!=='string'){const error=new Error(`Finalized package is missing ${name}.`);error.code='FINALIZED_FILE_MISSING';throw error;}
  let manifest,project,validation;try{manifest=JSON.parse(files['manifest.json']);project=JSON.parse(files['project.json']);validation=JSON.parse(files['validation-report.json']);}catch(cause){const error=new Error('Finalized package contains unreadable JSON.');error.code='FINALIZED_CORRUPT';error.cause=cause;throw error;}
  if(manifest.exportType!==FINALIZED_EXPORT_TYPE){const error=new Error('This file is not a Finalized Project Package.');error.code='PACKAGE_TYPE_MISMATCH';throw error;}
  if(Number(manifest.packageVersion)!==supportedVersion){const error=new Error('Finalized package version is not supported.');error.code='FINALIZED_VERSION_UNSUPPORTED';throw error;}
  for(const name of ['project.json','validation-report.json'])if(await sha256(files[name],{crypto})!==manifest.checksums?.[name]){const error=new Error(`Checksum verification failed for ${name}.`);error.code='FINALIZED_CHECKSUM_FAILED';throw error;}
  if(String(project.projectId)!==String(manifest.projectId)){const error=new Error('Finalized package Project identity does not match.');error.code='FINALIZED_IDENTITY_MISMATCH';throw error;}
  const current=validateFinalizedProject(project,{settings:project.settings});if(!current.valid){const error=new Error('Finalized package planning data is incomplete.');error.code='FINALIZED_CONTENT_INVALID';error.report=current;throw error;}
  return Object.freeze({valid:true,manifest:Object.freeze(manifest),project:Object.freeze(project),validation:Object.freeze(validation),currentValidation:current});
}
