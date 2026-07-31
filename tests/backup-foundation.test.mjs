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
  assert.deepEqual(result.archive.data.templateReference,{templateId:'template-1'});
  assert.deepEqual(result.archive.data.settings,{units:'miles'});
  assert.deepEqual(result.archive.data.mediaReferences.photos,[{id:'photo-1',uri:'media://photo-1'}]);
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
