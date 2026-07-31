import {PROJECT_SCHEMA_VERSION} from '../projects/model.js';
import {JOURNAL_SCHEMA_VERSION} from '../journal/model.js';
import {ANALYTICS_SCHEMA_VERSION} from '../analytics/engine.js';
import {
  BackupChecksumError,BackupValidationError,UnsupportedArchiveVersionError
} from './errors.js';

export const BACKUP_ARCHIVE_VERSION=1;
export const BACKUP_EXPORT_TYPE='project';
export const BACKUP_GENERATOR=Object.freeze({name:'CannonMap',format:'cmap'});
export const REQUIRED_BACKUP_COLLECTIONS=Object.freeze([
  'routes','tracks','waypoints','checkpoints','additionalFeatures','featureOrder',
  'journal','analytics','settings',
  'templateReference','offlineMapMetadata','searchRebuildMetadata','mediaReferences'
]);

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const clone=value=>structuredClone(value);

/** Canonical JSON makes collection order and object-key order deterministic. */
export function canonicalJson(value){
  const visit=input=>{
    if(Array.isArray(input))return input.map(visit);
    if(object(input)){
      return Object.fromEntries(Object.keys(input).sort().filter(key=>input[key]!==undefined)
        .map(key=>[key,visit(input[key])]));
    }
    if(typeof input==='number'&&!Number.isFinite(input))return null;
    return input;
  };
  return JSON.stringify(visit(value));
}

/** Keeps the lightweight manifest physically before the potentially large data payload. */
export function serializeProjectArchive(archive){
  return `{"manifest":${canonicalJson(archive.manifest)},"data":${canonicalJson(archive.data)}}`;
}

const count=value=>Array.isArray(value)?value.length:0;
const positiveVersion=(value,fallback)=>{
  const version=Number(value);
  return Number.isInteger(version)&&version>0?version:fallback;
};
const inventoryOf=(values,fallback)=>{
  let schemaVersion=fallback,voiceNotes=0;
  for(const value of values){
    schemaVersion=Math.max(schemaVersion,positiveVersion(value?.schemaVersion,fallback));
    if((value?.eventType||value?.type)==='voice_note')voiceNotes+=1;
  }
  return {count:values.length,schemaVersion,voiceNotes};
};

/** One traversal contract generates and validates the canonical archive inventory. */
export function createArchiveInventory(data){
  const embeddedJournal=Array.isArray(data?.journal?.embedded)?data.journal.embedded:[];
  const journalEvents=Array.isArray(data?.journal?.events)?data.journal.events:[];
  const analyticsGroups=['telemetrySamples','telemetryEvents','sessions','dailyStats']
    .map(name=>Array.isArray(data?.analytics?.[name])?data.analytics[name]:[]);
  const embeddedInventory=inventoryOf(embeddedJournal,JOURNAL_SCHEMA_VERSION);
  const journalInventory=inventoryOf(journalEvents,JOURNAL_SCHEMA_VERSION);
  let analyticsRecordCount=0,analyticsSchemaVersion=positiveVersion(
    data?.analytics?.embedded?.schemaVersion,ANALYTICS_SCHEMA_VERSION
  );
  for(const group of analyticsGroups){
    const inventory=inventoryOf(group,ANALYTICS_SCHEMA_VERSION);
    analyticsRecordCount+=inventory.count;
    analyticsSchemaVersion=Math.max(analyticsSchemaVersion,inventory.schemaVersion);
  }
  return Object.freeze({
    contains:Object.freeze({
      routes:count(data?.routes),tracks:count(data?.tracks),waypoints:count(data?.waypoints),
      checkpoints:count(data?.checkpoints),journalEvents:embeddedInventory.count+journalInventory.count,
      analyticsRecords:analyticsRecordCount,photos:count(data?.mediaReferences?.photos),
      videos:count(data?.mediaReferences?.videos),
      voiceNotes:embeddedInventory.voiceNotes+journalInventory.voiceNotes,
      notes:count(data?.project?.notes)
    }),
    schemaVersions:Object.freeze({
      project:positiveVersion(data?.project?.schemaVersion,PROJECT_SCHEMA_VERSION),
      journal:Math.max(embeddedInventory.schemaVersion,journalInventory.schemaVersion),
      analytics:analyticsSchemaVersion
    })
  });
}

export async function sha256(value,{crypto=globalThis.crypto}={}){
  if(!crypto?.subtle)throw new BackupValidationError('SHA-256 is unavailable.',{code:'BACKUP_HASH_UNAVAILABLE'});
  const bytes=new TextEncoder().encode(typeof value==='string'?value:canonicalJson(value));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

function checksumSource(archive){
  return {manifest:{...archive.manifest,exportedAt:undefined,checksum:undefined},data:archive.data};
}

function validation(condition,message,code,details){
  if(!condition)throw new BackupValidationError(message,{code,details});
}

function validateJournal(value,projectId){
  validation(object(value)&&Array.isArray(value.embedded)&&Array.isArray(value.events),
    'Journal collection is invalid.','BACKUP_JOURNAL_INVALID');
  const ids=new Set();
  for(const event of value.events){
    validation(object(event)&&typeof event.eventId==='string'&&event.eventId,
      'Journal event identity is invalid.','BACKUP_JOURNAL_INVALID');
    validation(String(event.projectId)===projectId,'Journal event belongs to another Project.',
      'BACKUP_PROJECT_SCOPE_INVALID',{eventId:event.eventId});
    validation(!ids.has(event.eventId),'Duplicate Journal event identity.',
      'BACKUP_DUPLICATE_ID',{eventId:event.eventId});
    ids.add(event.eventId);
  }
}

const ANALYTICS_COLLECTIONS=Object.freeze([
  'embedded','telemetrySamples','telemetryEvents','sessions','dailyStats'
]);
function validateAnalytics(value,projectId){
  validation(object(value),'Analytics collection is invalid.','BACKUP_ANALYTICS_INVALID');
  for(const name of ANALYTICS_COLLECTIONS){
    const valid=name==='embedded'?object(value[name]):Array.isArray(value[name]);
    validation(valid,`Analytics ${name} collection is invalid.`,'BACKUP_ANALYTICS_INVALID',{collection:name});
  }
  const identity={
    telemetrySamples:record=>[record.sessionId,record.sampleId],
    telemetryEvents:record=>[record.sessionId,record.telemetryEventId],
    sessions:record=>[record.rallyEventId,record.sessionId],
    dailyStats:record=>[record.sessionId,record.dayKey]
  };
  for(const name of ANALYTICS_COLLECTIONS.slice(1)){
    const ids=new Set();
    for(const record of value[name]){
      validation(object(record)&&String(record.projectId)===projectId,
      `Analytics ${name} record belongs to another Project.`,
      'BACKUP_PROJECT_SCOPE_INVALID',{collection:name});
      const parts=identity[name](record).map(part=>String(part??''));
      validation(parts.every(Boolean),`Analytics ${name} identity is invalid.`,
        'BACKUP_ANALYTICS_INVALID',{collection:name});
      const id=parts.join('\u0000');
      validation(!ids.has(id),`Duplicate Analytics ${name} identity.`,
        'BACKUP_DUPLICATE_ID',{collection:name,id});
      ids.add(id);
    }
  }
}

export async function createProjectArchive({
  snapshot,applicationVersion,schemaVersion,exportedAt,generator=BACKUP_GENERATOR,crypto
}={}){
  validation(object(snapshot?.project),'Project snapshot is required.','BACKUP_PROJECT_REQUIRED');
  const projectId=String(snapshot.project.projectId||'');
  validation(projectId,'Project identity is required.','BACKUP_PROJECT_ID_INVALID');
  const data=clone(snapshot.data),inventory=createArchiveInventory(data);
  const archive={
    manifest:{
      archiveVersion:BACKUP_ARCHIVE_VERSION,
      applicationVersion:String(applicationVersion||'unknown'),
      schemaVersion:Number(schemaVersion),
      exportedAt:new Date(exportedAt).toISOString(),
      projectId,projectName:String(snapshot.project.name||'CannonMap Project'),
      projectType:String(snapshot.project.projectType||snapshot.project.type||'project'),
      exportType:BACKUP_EXPORT_TYPE,
      generator:{...BACKUP_GENERATOR,...generator},
      contains:inventory.contains,schemaVersions:inventory.schemaVersions,
      checksum:{algorithm:'SHA-256',value:''}
    },
    data
  };
  archive.manifest.checksum.value=await sha256(checksumSource(archive),{crypto});
  return serializeProjectArchive(archive);
}

function validateInventory(manifest,data){
  validation(object(manifest.contains)&&object(manifest.schemaVersions),
    'Archive inventory manifest is invalid.','BACKUP_MANIFEST_INVALID');
  const expected=createArchiveInventory(data);
  for(const [name,value] of Object.entries(expected.contains)){
    validation(Number.isInteger(manifest.contains[name])&&manifest.contains[name]>=0,
      `Archive manifest count is invalid: ${name}`,'BACKUP_MANIFEST_INVALID',{field:name});
    validation(manifest.contains[name]===value,
      `Archive manifest count does not match contents: ${name}`,
      'BACKUP_MANIFEST_COUNT_MISMATCH',{field:name,expected:value,actual:manifest.contains[name]});
  }
  for(const [name,value] of Object.entries(expected.schemaVersions)){
    validation(manifest.schemaVersions[name]===value,
      `Archive manifest schema version does not match contents: ${name}`,
      'BACKUP_MANIFEST_SCHEMA_MISMATCH',{field:name,expected:value,actual:manifest.schemaVersions[name]});
  }
}

export async function validateProjectArchive(input,{
  crypto,supportedArchiveVersions=[BACKUP_ARCHIVE_VERSION],maxSchemaVersion=PROJECT_SCHEMA_VERSION
}={}){
  let archive;
  try{archive=typeof input==='string'?JSON.parse(input):clone(input);}
  catch(cause){throw new BackupValidationError('CannonMap archive is not valid JSON.',{code:'BACKUP_CORRUPT',cause});}
  validation(object(archive)&&object(archive.manifest)&&object(archive.data),
    'CannonMap archive envelope is invalid.','BACKUP_CORRUPT');
  const manifest=archive.manifest,version=Number(manifest.archiveVersion);
  if(!supportedArchiveVersions.includes(version))throw new UnsupportedArchiveVersionError(manifest.archiveVersion);
  validation(manifest.exportType===BACKUP_EXPORT_TYPE,'Archive export type is invalid.','BACKUP_EXPORT_TYPE_INVALID');
  validation(typeof manifest.applicationVersion==='string'&&manifest.applicationVersion,
    'Archive application version is required.','BACKUP_APPLICATION_VERSION_INVALID');
  validation(object(manifest.generator)&&typeof manifest.generator.name==='string'&&manifest.generator.name&&
    typeof manifest.generator.format==='string'&&manifest.generator.format,
    'Archive generator metadata is invalid.','BACKUP_GENERATOR_INVALID');
  validation(Number.isInteger(Number(manifest.schemaVersion))&&Number(manifest.schemaVersion)>0,
    'Archive schema version is invalid.','BACKUP_SCHEMA_VERSION_INVALID');
  validation(Number(manifest.schemaVersion)<=Number(maxSchemaVersion),
    'Archive schema version is newer than this application.','BACKUP_SCHEMA_VERSION_UNSUPPORTED',
    {schemaVersion:manifest.schemaVersion,maxSchemaVersion});
  const projectId=String(manifest.projectId||'');
  validation(projectId&&String(archive.data.project?.projectId||'')===projectId,
    'Archive Project identity is invalid.','BACKUP_PROJECT_ID_INVALID');
  validation(typeof manifest.projectName==='string'&&manifest.projectName,
    'Archive Project name is required.','BACKUP_PROJECT_NAME_INVALID');
  validation(typeof manifest.projectType==='string'&&manifest.projectType,
    'Archive Project type is required.','BACKUP_PROJECT_TYPE_INVALID');
  validation(!Number.isNaN(Date.parse(manifest.exportedAt)),
    'Archive export timestamp is invalid.','BACKUP_TIMESTAMP_INVALID');
  validation(manifest.checksum?.algorithm==='SHA-256'&&/^[0-9a-f]{64}$/.test(manifest.checksum?.value||''),
    'Archive checksum metadata is invalid.','BACKUP_CHECKSUM_INVALID');
  for(const collection of REQUIRED_BACKUP_COLLECTIONS){
    validation(Object.hasOwn(archive.data,collection),`Required collection is missing: ${collection}`,
      'BACKUP_COLLECTION_MISSING',{collection});
  }
  for(const name of ['routes','tracks','waypoints','checkpoints','additionalFeatures','featureOrder']){
    validation(Array.isArray(archive.data[name]),`Collection is invalid: ${name}`,
      'BACKUP_COLLECTION_INVALID',{collection:name});
  }
  const featureCollections=new Set(['routes','tracks','waypoints','checkpoints','additionalFeatures']);
  for(const reference of archive.data.featureOrder){
    validation(object(reference)&&featureCollections.has(reference.collection)&&
      Number.isInteger(reference.index)&&reference.index>=0&&
      reference.index<archive.data[reference.collection].length,
    'Feature order metadata is invalid.','BACKUP_FEATURE_ORDER_INVALID');
  }
  validation(object(archive.data.project)&&object(archive.data.lifecycle),
    'Project or lifecycle metadata is invalid.','BACKUP_PROJECT_INVALID');
  validation(typeof archive.data.lifecycle.status==='string'&&archive.data.lifecycle.status,
    'Project lifecycle metadata is invalid.','BACKUP_LIFECYCLE_INVALID');
  validation(object(archive.data.settings),'Settings collection is invalid.','BACKUP_SETTINGS_INVALID');
  validation(object(archive.data.offlineMapMetadata),'Offline map metadata is invalid.','BACKUP_OFFLINE_MAP_INVALID');
  validation(object(archive.data.searchRebuildMetadata)&&archive.data.searchRebuildMetadata.required===true,
    'Search rebuild metadata is invalid.','BACKUP_SEARCH_METADATA_INVALID');
  validation(object(archive.data.mediaReferences)&&Array.isArray(archive.data.mediaReferences.photos)&&
    Array.isArray(archive.data.mediaReferences.videos),'Media references are invalid.','BACKUP_MEDIA_REFERENCES_INVALID');
  validateJournal(archive.data.journal,projectId);
  validateAnalytics(archive.data.analytics,projectId);
  validateInventory(manifest,archive.data);
  const expected=await sha256(checksumSource(archive),{crypto});
  if(expected!==manifest.checksum.value)throw new BackupChecksumError();
  return Object.freeze({archive:clone(archive),projectId,archiveVersion:version,valid:true});
}
