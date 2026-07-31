import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import test from 'node:test';
import {
  BACKUP_ARCHIVE_VERSION,createProjectArchive,validateProjectArchive
} from '../src/domain/backup/archive.js';
import {createProjectBackupService} from '../src/application/project-backup-service.js';

const PROJECT_ID='project-1';
const sampleSnapshot=()=>({
  project:{projectId:PROJECT_ID,name:'Rally',schemaVersion:1},
  data:{
    project:{projectId:PROJECT_ID,id:PROJECT_ID,name:'Rally',schemaVersion:1,createdAt:'2026-01-01T00:00:00.000Z'},
    lifecycle:{status:'active',archivedAt:null,wasActive:true},
    routes:[{id:'r1',type:'route'}],tracks:[{id:'t1',type:'track'}],
    waypoints:[{id:'w1',type:'waypoint'}],checkpoints:[{id:'c1',type:'checkpoint'}],
    additionalFeatures:[],featureOrder:[
      {collection:'routes',index:0},{collection:'tracks',index:0},
      {collection:'waypoints',index:0},{collection:'checkpoints',index:0}
    ],
    journal:{embedded:[{id:'embedded'}],events:[{
      eventId:'event-1',projectId:PROJECT_ID,timestamp:'2026-01-01T00:00:00.000Z'
    }]},
    analytics:{embedded:{total:1},telemetrySamples:[{
      projectId:PROJECT_ID,sessionId:'s1',sampleId:'a1'
    }],telemetryEvents:[],sessions:[],dailyStats:[]},
    settings:{units:'miles'},templateReference:{templateId:'template-1'},
    offlineMapMetadata:{regions:['north']},
    searchRebuildMetadata:{required:true,indexVersion:1,sourceRevision:'revision-1',lastBuiltAt:null},
    mediaReferences:{photos:[{id:'photo-1',uri:'media://photo-1'}],videos:[]}
  }
});

const makeArchive=(overrides={})=>createProjectArchive({
  snapshot:sampleSnapshot(),applicationVersion:'0.7.0',schemaVersion:7,
  exportedAt:'2026-07-31T12:00:00.000Z',crypto:webcrypto,...overrides
});

test('exports and validates a complete versioned deterministic archive',async()=>{
  const first=await makeArchive(),second=await makeArchive();
  assert.equal(first,second);
  const result=await validateProjectArchive(first,{crypto:webcrypto,maxSchemaVersion:7});
  assert.equal(result.valid,true);
  assert.equal(result.archive.manifest.archiveVersion,BACKUP_ARCHIVE_VERSION);
  assert.equal(result.archive.manifest.generator.format,'cmap');
  assert.equal(first.startsWith('{"manifest":'),true);
  assert.equal(result.archive.manifest.projectType,'project');
  assert.deepEqual(result.archive.manifest.contains,{
    routes:1,tracks:1,waypoints:1,checkpoints:1,journalEvents:2,
    analyticsRecords:1,photos:1,videos:0,voiceNotes:0,notes:0
  });
  assert.deepEqual(result.archive.manifest.schemaVersions,{project:1,journal:1,analytics:1});
  assert.deepEqual(result.archive.data.templateReference,{templateId:'template-1'});
  assert.deepEqual(result.archive.data.settings,{units:'miles'});
  assert.deepEqual(result.archive.data.mediaReferences.photos,[{id:'photo-1',uri:'media://photo-1'}]);
});

test('exports deterministic inventory manifests for empty and large Projects',async()=>{
  const empty=sampleSnapshot();
  for(const name of ['routes','tracks','waypoints','checkpoints'])empty.data[name]=[];
  empty.data.featureOrder=[];empty.data.journal={embedded:[],events:[]};
  empty.data.analytics={embedded:{},telemetrySamples:[],telemetryEvents:[],sessions:[],dailyStats:[]};
  empty.data.mediaReferences={photos:[],videos:[]};
  const emptyArchive=JSON.parse(await makeArchive({snapshot:empty}));
  assert.deepEqual(Object.values(emptyArchive.manifest.contains),Array(10).fill(0));

  const large=sampleSnapshot(),size=2000;
  large.data.routes=Array.from({length:size},(_,index)=>({id:`route-${index}`,type:'route'}));
  large.data.tracks=[];large.data.waypoints=[];large.data.checkpoints=[];
  large.data.featureOrder=large.data.routes.map((_,index)=>({collection:'routes',index}));
  large.data.journal={embedded:[],events:Array.from({length:size},(_,index)=>({
    eventId:`event-${index}`,projectId:PROJECT_ID,eventType:index%10===0?'voice_note':'rider_note',schemaVersion:1
  }))};
  large.data.analytics.telemetrySamples=Array.from({length:size},(_,index)=>({
    projectId:PROJECT_ID,sessionId:'large-session',sampleId:`sample-${index}`,schemaVersion:1
  }));
  const first=await makeArchive({snapshot:large}),second=await makeArchive({snapshot:large});
  assert.equal(first,second);
  const manifest=JSON.parse(first).manifest;
  assert.equal(manifest.contains.routes,size);
  assert.equal(manifest.contains.journalEvents,size);
  assert.equal(manifest.contains.analyticsRecords,size);
  assert.equal(manifest.contains.voiceNotes,size/10);
});

test('rejects corrupt or inconsistent manifests and includes manifest metadata in checksum',async()=>{
  const corrupt=JSON.parse(await makeArchive());corrupt.manifest.contains=null;
  await assert.rejects(()=>validateProjectArchive(corrupt,{crypto:webcrypto,maxSchemaVersion:7}),
    error=>error.code==='BACKUP_MANIFEST_INVALID');
  const mismatch=JSON.parse(await makeArchive());mismatch.manifest.contains.routes=99;
  await assert.rejects(()=>validateProjectArchive(mismatch,{crypto:webcrypto,maxSchemaVersion:7}),
    error=>error.code==='BACKUP_MANIFEST_COUNT_MISMATCH'&&error.details.field==='routes');
  const schema=JSON.parse(await makeArchive());schema.manifest.schemaVersions.journal=99;
  await assert.rejects(()=>validateProjectArchive(schema,{crypto:webcrypto,maxSchemaVersion:7}),
    error=>error.code==='BACKUP_MANIFEST_SCHEMA_MISMATCH');
  const checksum=JSON.parse(await makeArchive());checksum.manifest.contains.futureRecords=1;
  await assert.rejects(()=>validateProjectArchive(checksum,{crypto:webcrypto,maxSchemaVersion:7}),
    error=>error.code==='BACKUP_CHECKSUM_INVALID');
});

test('identical data changes only exportedAt while retaining the content checksum',async()=>{
  const first=JSON.parse(await makeArchive());
  const second=JSON.parse(await makeArchive({exportedAt:'2026-08-01T12:00:00.000Z'}));
  assert.equal(first.manifest.checksum.value,second.manifest.checksum.value);
  delete first.manifest.exportedAt;delete second.manifest.exportedAt;
  assert.deepEqual(first,second);
});

test('rejects corrupt JSON, unknown versions, missing collections, and checksum changes',async()=>{
  await assert.rejects(()=>validateProjectArchive('{',{crypto:webcrypto,maxSchemaVersion:7}),
    error=>error.code==='BACKUP_CORRUPT');
  const version=JSON.parse(await makeArchive());version.manifest.archiveVersion=99;
  await assert.rejects(()=>validateProjectArchive(version,{crypto:webcrypto,maxSchemaVersion:7}),
    error=>error.code==='BACKUP_ARCHIVE_VERSION_UNSUPPORTED');
  const schema=JSON.parse(await makeArchive());schema.manifest.schemaVersion=8;
  await assert.rejects(()=>validateProjectArchive(schema,{crypto:webcrypto,maxSchemaVersion:7}),
    error=>error.code==='BACKUP_SCHEMA_VERSION_UNSUPPORTED');
  const missing=JSON.parse(await makeArchive());delete missing.data.settings;
  await assert.rejects(()=>validateProjectArchive(missing,{crypto:webcrypto,maxSchemaVersion:7}),
    error=>error.code==='BACKUP_COLLECTION_MISSING'&&error.details.collection==='settings');
  const changed=JSON.parse(await makeArchive());changed.data.project.name='Tampered';
  await assert.rejects(()=>validateProjectArchive(changed,{crypto:webcrypto,maxSchemaVersion:7}),
    error=>error.code==='BACKUP_CHECKSUM_INVALID');
});

test('validates Project, Journal, Analytics, and Settings integrity idempotently',async()=>{
  const archive=await makeArchive();
  const first=await validateProjectArchive(archive,{crypto:webcrypto,maxSchemaVersion:7});
  const second=await validateProjectArchive(archive,{crypto:webcrypto,maxSchemaVersion:7});
  assert.deepEqual(first,second);
  for(const [mutate,code] of [
    [value=>{value.data.journal.events[0].projectId='other';},'BACKUP_PROJECT_SCOPE_INVALID'],
    [value=>{value.data.analytics.telemetrySamples[0].projectId='other';},'BACKUP_PROJECT_SCOPE_INVALID'],
    [value=>{value.data.settings=[];},'BACKUP_SETTINGS_INVALID']
  ]){
    const invalid=JSON.parse(archive);mutate(invalid);
    await assert.rejects(()=>validateProjectArchive(invalid,{crypto:webcrypto,maxSchemaVersion:7}),
      error=>error.code===code);
  }
});

test('Backup service supports dry-run and delegates create/replace only after validation',async()=>{
  const calls=[];
  const repository={
    readProjectSnapshot:async()=>sampleSnapshot(),
    inspectProjectImport:async(_projectId,options)=>calls.push({inspect:options.mode}),
    importProjectArchive:async(_archive,options)=>{calls.push(options);return {projectId:PROJECT_ID,...options};}
  };
  const lifecycle={flush:async()=>calls.push('flush')};
  const service=createProjectBackupService({
    backupRepository:repository,projectLifecycle:lifecycle,
    clock:{iso:()=> '2026-07-31T12:00:00.000Z'},applicationVersion:'0.7.0',schemaVersion:7,crypto:webcrypto
  });
  const archive=await service.exportProject(PROJECT_ID);
  assert.equal(calls.shift(),'flush');
  const dryRun=await service.importProject(archive,{mode:'replace',dryRun:true});
  assert.deepEqual(dryRun,{valid:true,dryRun:true,mode:'replace',projectId:PROJECT_ID});
  assert.deepEqual(calls.splice(0),['flush',{inspect:'replace'}]);
  const replaced=await service.importProject(archive,{mode:'replace'});
  assert.equal(calls.shift(),'flush');
  assert.deepEqual(calls.shift(),{inspect:'replace'});
  assert.equal(calls[0].mode,'replace');
  assert.equal(replaced.projectId,PROJECT_ID);
});
