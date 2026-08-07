import {canonicalJson,sha256} from '../backup/archive.js';

export const FINALIZED_PACKAGE_VERSION=1;
export const FINALIZED_EXPORT_TYPE='finalized-project';
const pointTypes=new Set(['checkpoint','hotel','waypoint','fuel','start','finish']);
const lineTypes=new Set(['route','track','backbone']);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const RUNTIME_PROJECT_KEYS=new Set(['journal','analytics','photos','videos','stationaryEvents','rallyState','executionState','activeDay','dayState','collectedAt','completedAt','competitors']);
const RUNTIME_FEATURE_KEYS=new Set(['_layer','status','collectedAt','completedAt','deferredAt','failedAt','photoStatus','arrivalEvidence','scoreAwarded','completionEvidence']);
const RUNTIME_SETTINGS_KEYS=new Set(['rallyDays','mediaBackups','lastMediaExportAt','mediaBackupReminderDay','activeDay','currentObjectiveId','rallyStartedAt']);

/** Safari-safe durable snapshot: strip runtime/Leaflet attachments then JSON-roundtrip. */
function durableSnapshot(value){
  return JSON.parse(JSON.stringify(value,(key,current)=>{
    if(key==='_layer')return undefined;
    if(typeof current==='function')return undefined;
    if(typeof current==='symbol')return undefined;
    return current;
  }));
}

function clone(value){
  try{return structuredClone(value);}
  catch{
    return durableSnapshot(value);
  }
}
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
      const sequence=Number(feature?.sequence);if(!Number.isFinite(sequence))add('error','CHECKPOINT_SEQUENCE_REQUIRED',`${feature?.name||id} is missing a deterministic sequence.`,id);
      else{
        const key=`${day}:${sequence}`;
        if(sequenceByDay.has(key))add('error','DUPLICATE_SEQUENCE',`Day ${day} sequence ${sequence} is duplicated.`,id);else sequenceByDay.set(key,id);
      }
    }
    if(feature?.type==='hotel'){
      if(hotels.has(day))add('warning','MULTIPLE_HOTELS',`Day ${day} has more than one hotel.`,id);else hotels.set(day,id);
    }
  }
  for(const day of days)if(!hotels.has(day))add('warning','HOTEL_MISSING',`Day ${day} has no hotel objective.`);
  const counts={days:days.size,checkpoints:features.filter(f=>f?.type==='checkpoint').length,hotels:features.filter(f=>f?.type==='hotel').length,routes:features.filter(f=>f?.type==='route').length,tracks:features.filter(f=>f?.type==='track').length,backbone:features.filter(f=>f?.type==='backbone').length,waypoints:features.filter(f=>f?.type==='waypoint').length};
  return Object.freeze({valid:errors.length===0,errors:Object.freeze(errors.slice()),warnings:Object.freeze(warnings.slice()),counts:Object.freeze(counts)});
}

export function executionCleanProject(project){
  // Build a plain durable graph BEFORE any structuredClone so Safari never sees Leaflet _layer
  // or other non-cloneable runtime attachments hanging off live feature objects.
  const source=project&&typeof project==='object'?project:{};
  const plainFeatures=[];
  for(const feature of Array.isArray(source.features)?source.features:[]){
    if(!feature||typeof feature!=='object')continue;
    const copy={};
    for(const [key,value] of Object.entries(feature)){
      if(RUNTIME_FEATURE_KEYS.has(key))continue;
      if(key==='_layer')continue;
      if(typeof value==='function')continue;
      copy[key]=value;
    }
    plainFeatures.push(copy);
  }
  const plain={};
  for(const [key,value] of Object.entries(source)){
    if(RUNTIME_PROJECT_KEYS.has(key))continue;
    if(key==='features')continue;
    if(typeof value==='function')continue;
    plain[key]=value;
  }
  plain.features=plainFeatures;
  if(object(source.settings)){
    const settings={};
    for(const [key,value] of Object.entries(source.settings)){
      if(RUNTIME_SETTINGS_KEYS.has(key))continue;
      if(typeof value==='function')continue;
      settings[key]=value;
    }
    plain.settings=settings;
  }
  plain.competitors=[];
  // Final JSON boundary guarantees no DOM/Leaflet/class instances survive into the master.
  return durableSnapshot(plain);
}

export async function createFinalizedEnvelope({project,settings,applicationVersion,buildId,finalizedAt,crypto=globalThis.crypto}={}){
  const validation=validateFinalizedProject(project,{settings});if(!validation.valid){const error=new Error('Project cannot be finalized until validation errors are resolved.');error.code='FINALIZATION_INVALID';error.report=validation;throw error;}
  let clean;
  try{
    const merged={...project,settings:settings||project?.settings||{}};
    clean=executionCleanProject(merged);
  }catch(cause){
    const error=new Error('Finalization serialization failed while building the durable project snapshot.');
    error.code='FINALIZATION_SERIALIZE';
    error.stage='executionCleanProject';
    error.projectId=project?.projectId||project?.id||null;
    error.cause=cause;
    throw error;
  }
  const projectJson=canonicalJson(clean),reportJson=canonicalJson(validation);
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
