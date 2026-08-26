import assert from 'node:assert/strict';
import test from 'node:test';
import {assertDeliberateSessionMediaIdentity,createPhotoExportService} from '../src/application/photo-export-service.js';
import {readStoredZip} from '../src/application/portable-zip.js';

const arrival=(sessionId,timestamp)=>({
  state:'confirmed',trustworthy:true,arrivalId:`arrival-${sessionId}`,timestamp,
  latitude:41,longitude:-87,gpsAccuracyFeet:12,source:'gps-radius-dwell'
});
const evidence=(sessionId,timestamp,photoState='partial')=>({
  schemaVersion:1,arrival:arrival(sessionId,timestamp),
  photo:{required:true,state:photoState,pairId:`pair-${sessionId}`,pairJournalEventId:`pair-event-${sessionId}`,reasonCode:photoState==='complete'?null:'camera-failed',failureReason:null,missingSides:photoState==='complete'?[]:['front'],mediaReferences:{},updatedAt:timestamp},
  completion:{state:photoState==='complete'?'completed':'pending',completedAt:photoState==='complete'?timestamp:null,pointsAwarded:photoState==='complete'?10:0,legacyCompletionWithoutRequiredPhoto:false}
});
const checkpointProjection=(sessionId,timestamp,photoState)=>({
  status:photoState==='complete'?'collected':'photo_required',arrivedAt:timestamp,arrivalState:'confirmed',
  arrivalEvidence:arrival(sessionId,timestamp),checkpointEvidence:evidence(sessionId,timestamp,photoState),
  photoEvidenceState:photoState,finalCompletionState:photoState==='complete'?'completed':'pending',
  scoreAwarded:photoState==='complete'?10:0,
  ...(photoState==='complete'?{completedAt:timestamp,photoPair:{pairId:`pair-${sessionId}`,status:'complete'}}:{pendingPhotoPair:{pairId:`pair-${sessionId}`,status:'partial'}})
});
const session=(sessionId,{calendarDate,runNumber,status='suspended',photoState='partial'}={})=>({
  schemaVersion:2,sessionId,projectId:'project',rallyId:'america-250',dayId:'america-250-day-1',dayNumber:1,
  calendarDate,runNumber,status,startedAt:`${calendarDate}T13:00:00.000Z`,completedAt:photoState==='complete'?`${calendarDate}T20:00:00.000Z`:null,
  nextDay:photoState==='complete'?2:0,summary:photoState==='complete'?{score:10}:null,
  checkpointStates:{'cp-1':checkpointProjection(sessionId,`${calendarDate}T14:00:00.000Z`,photoState)},
  pendingEvidence:{schemaVersion:1,entries:[]},legacy:false,origin:'deliberate-start'
});
const sessionA=session('session-a',{calendarDate:'2026-08-17',runNumber:1,photoState:'partial'});
const sessionB=session('session-b',{calendarDate:'2026-08-18',runNumber:2,status:'active',photoState:'complete'});
const liveFeature={
  id:'cp-1',type:'checkpoint',day:1,name:'1.1 I-12',points:10,photoRequired:true,
  ...checkpointProjection('session-b','2026-08-18T14:00:00.000Z','complete')
};
const project={
  projectId:'project',tripId:'month-trip',rallyId:'america-250',name:'America 250',features:[liveFeature,{id:'cp-2.1',type:'checkpoint',day:2,name:'2.1 Historic',status:'collected',scoreAwarded:21,completedAt:'2026-08-19T14:00:00.000Z'},{id:'cp-3.1',type:'checkpoint',day:3,name:'3.1 Closed',status:'unavailable'}],
  rallyExecution:{schemaVersion:2,activeSessionId:'session-b',sessions:{'session-a':sessionA,'session-b':sessionB},daySessions:{1:['session-a','session-b']},days:{1:{sessionId:'session-b',status:'active'}}}
};
const media=(mediaId,sessionId,role)=>({
  mediaId,projectId:'project',sessionId,checkpointId:'cp-1',journalEventId:`pair-event-${sessionId}`,
  pairId:`pair-${sessionId}`,pairStatus:'complete',cameraRole:'rear',role,
  name:`${sessionId}_${role}.jpg`,mimeType:'image/jpeg',blob:new Blob([`${sessionId}-${role}`],{type:'image/jpeg'}),
  metadata:{dayNumber:1,sessionId,objectiveType:'checkpoint',pairId:`pair-${sessionId}`,cameraRole:'rear'}
});
const rows=[
  media('a-original','session-a','original'),media('a-evidence','session-a','evidence'),
  media('b-original','session-b','original'),media('b-evidence','session-b','evidence'),
  {...media('legacy-unscoped',null,'original'),sessionId:null,metadata:{dayNumber:1,objectiveType:'checkpoint'}}
];
const journalEvent=(eventId,sessionId,eventType)=>({
  eventId,projectId:'project',sessionId,eventType,timestamp:'2026-08-17T14:00:00.000Z',
  references:{checkpointId:'cp-1',sessionId},metadata:{dayNumber:1,sessionId,objectiveCompletion:eventType==='checkpoint_completed'}
});
const journal=[
  journalEvent('arrival-a','session-a','checkpoint_arrival'),journalEvent('incomplete-a','session-a','checkpoint_photo_evidence_incomplete'),
  journalEvent('arrival-b','session-b','checkpoint_arrival'),journalEvent('complete-b','session-b','checkpoint_completed'),
  {eventId:'legacy',projectId:'project',eventType:'checkpoint_arrival',timestamp:'2026-08-16T14:00:00.000Z',metadata:{dayNumber:1}}
];
const exporter=createPhotoExportService({repository:{listProjectPhotos:async()=>rows}});
const buildIdentity={applicationVersion:'0.7.11',buildId:'2026.08.18.session-recovery-1',serviceWorkerCacheId:'cannonmap-v78'};
const exportMoment=milliseconds=>new Date(2026,7,18,17,37,42,milliseconds);

test('same Day 1 sessions export only their own Journal, media, and checkpoint projection',async()=>{
  const archive=await exporter.dayBackup('project',1,{
    project,journal,session:sessionA,buildIdentity,exportedAt:exportMoment(123),settings:{dayFilter:'1',rallyDays:{1:{sessionId:'session-b'}},mediaBackups:{'session-b':{completedAt:'2026-08-18T22:00:00.000Z'}},mediaBackupProgress:{'session-b':{package:'2026-08-18T22:00:00.000Z'}},restoredDayReview:{sessionId:'session-b'},rallyEventId:'america-250'}
  }),files=await readStoredZip(archive.blob),manifest=JSON.parse(files['manifest/day-manifest.json']),exportedJournal=JSON.parse(files['journal/Daily_Journal.json']),mediaIndex=JSON.parse(files['manifest/media-index.json']),metadata=JSON.parse(files['manifest/project-metadata.json']);

  assert.equal(archive.filename,'CannonMap_America250_D01_Run01_2026-08-18_173742-123_Backup.cmapday.zip');
  assert.deepEqual(exportedJournal.map(event=>event.eventId),['arrival-a','incomplete-a']);
  assert.deepEqual(mediaIndex.map(item=>item.mediaId).sort(),['a-evidence','a-original']);
  assert.ok(mediaIndex.every(item=>item.sessionId==='session-a'||item.metadata?.sessionId==='session-a'));
  assert.deepEqual({sessionId:manifest.sessionId,run:manifest.sessionRunNumber,media:manifest.mediaCount,journal:manifest.journalEventCount,pairs:manifest.pairCount},
    {sessionId:'session-a',run:1,media:2,journal:2,pairs:1});
  assert.deepEqual(manifest.journalEvidenceCounts,{arrival:1,photoIncomplete:1,photoRecovered:0,completed:0});
  assert.equal(manifest.checkpointStates[0].photoEvidenceState,'partial','historical Session A projection overrides live Session B');
  assert.equal(metadata.project.rallyExecution.activeSessionId,'session-a');
  assert.equal(metadata.project.rallyExecution.days['1'].sessionId,'session-a');
  assert.deepEqual(Object.keys(metadata.project.rallyExecution.sessions),['session-a']);
  assert.deepEqual(metadata.project.rallyExecution.daySessions,{'1':['session-a']});
  assert.deepEqual(Object.keys(metadata.project.rallyExecution.days),['1']);
  assert.equal(metadata.project.features[0].photoEvidenceState,'partial');
  assert.deepEqual(metadata.project.features[1],{id:'cp-2.1',type:'checkpoint',day:2,name:'2.1 Historic',status:'upcoming'},'nonselected execution projections are neutralized while static plan data remains');
  assert.deepEqual(metadata.project.features[2],{id:'cp-3.1',type:'checkpoint',day:3,name:'3.1 Closed',status:'unavailable'},'planning-unavailable objectives remain unavailable');
  assert.equal(metadata.settings.rallyEventId,'america-250');
  for(const key of ['rallyDays','mediaBackups','mediaBackupProgress','restoredDayReview'])assert.equal(Object.hasOwn(metadata.settings,key),false,`${key} must not leak another run into the package`);
});

test('Day Photos manifest is session scoped and repeated exports have distinct filenames',async()=>{
  const base={project,journal,sessionIdentity:sessionB,buildIdentity},first=await exporter.day('project',1,{...base,exportedAt:exportMoment(123)}),second=await exporter.day('project',1,{...base,exportedAt:exportMoment(124)}),files=await readStoredZip(first.blob),manifest=JSON.parse(files['manifest/photo-media-index.json']);
  assert.notEqual(first.filename,second.filename);
  assert.equal(first.filename,'CannonMap_America250_D01_Run02_2026-08-18_173742-123_Photos.zip');
  assert.deepEqual({sessionId:first.manifest.sessionId,media:first.manifest.mediaCount,pairs:first.manifest.pairCount},{sessionId:'session-b',media:2,pairs:1});
  assert.equal(manifest.sessionId,'session-b');assert.equal(manifest.applicationVersion,'0.7.11');assert.equal(manifest.buildId,buildIdentity.buildId);assert.equal(manifest.serviceWorkerCacheId,'cannonmap-v78');
  assert.ok(manifest.entries.every(item=>item.sessionId==='session-b'));
});

test('legacy session compatibility admits unscoped rows but never another known session',async()=>{
  const legacy={...sessionA,sessionId:'legacy-session',runNumber:3,legacy:true,origin:'schema-v1-day-execution'},legacyRows=[
    {...media('legacy-exact','legacy-session','original')},
    {...media('new-exact','session-b','original')},
    {...media('legacy-unscoped-2',null,'evidence'),sessionId:null,metadata:{dayNumber:1,objectiveType:'checkpoint'}}
  ],service=createPhotoExportService({repository:{listProjectPhotos:async()=>legacyRows}}),archive=await service.day('project',1,{project,journal:[],session:legacy,buildIdentity,exportedAt:exportMoment(123)}),files=await readStoredZip(archive.blob),manifest=JSON.parse(files['manifest/photo-media-index.json']);
  assert.equal(archive.manifest.mediaCount,2);
  assert.deepEqual(manifest.entries.map(item=>item.mediaId).sort(),['legacy-exact','legacy-unscoped-2']);
});

test('another session\'s stored photos do not block a valid zero-media session backup',async()=>{
  const sessionC=session('session-c',{calendarDate:'2026-08-19',runNumber:3,status:'active',photoState:'partial'}),event=journalEvent('arrival-c','session-c','checkpoint_arrival'),archive=await exporter.dayBackup('project',1,{project,journal:[event],session:sessionC,buildIdentity,exportedAt:exportMoment(125)});
  assert.equal(archive.manifest.mediaCount,0);
  assert.equal(archive.manifest.journalEventCount,1);
  assert.equal(archive.manifest.sessionId,'session-c');
});

test('session-aware exports validate descriptors before hydrating only the exact session set',async()=>{
  let fullProjectReads=0,sessionReads=0,mediaReads=0;
  const current=[media('current-original','session-b','original'),media('current-evidence','session-b','evidence')],byId=new Map(current.map(item=>[item.mediaId,item])),descriptors=current.map(({blob,...item})=>({...item,size:blob.size})),service=createPhotoExportService({repository:{
    async listProjectPhotos(){fullProjectReads+=1;throw new Error('full Project media must not be hydrated for a session export');},
    async listProjectSessionPhotoDescriptors(projectId,sessionId){sessionReads+=1;assert.equal(projectId,'project');assert.equal(sessionId,'session-b');return structuredClone(descriptors);},
    async getMedia(mediaId){mediaReads+=1;return byId.get(mediaId)||null;}
  }}),options={project,journal,session:sessionB,buildIdentity,exportedAt:exportMoment(126)},backup=await service.dayBackup('project',1,options),photos=await service.day('project',1,{...options,exportedAt:exportMoment(127)}),backupFiles=await readStoredZip(backup.blob),photoFiles=await readStoredZip(photos.blob),backupIndex=JSON.parse(backupFiles['manifest/media-index.json']),photoIndex=JSON.parse(photoFiles['manifest/photo-media-index.json']);

  assert.equal(fullProjectReads,0);
  assert.equal(sessionReads,2);
  assert.equal(mediaReads,4);
  assert.deepEqual(backupIndex.map(item=>item.mediaId).sort(),['current-evidence','current-original']);
  assert.deepEqual(photoIndex.entries.map(item=>item.mediaId).sort(),['current-evidence','current-original']);
  assert.equal(backup.manifest.mediaCount,2);
  assert.equal(photos.manifest.mediaCount,2);
});

test('mixed exact-session descriptors fail Day Backup and Photos before any JPEG hydration',async()=>{
  let mediaReads=0;
  const valid=Array.from({length:95},(_,index)=>{const row=media(`valid-${index}`,'session-b',index%2?'evidence':'original'),{blob,...descriptor}=row;return {...descriptor,size:blob.size};}),mismatch={...valid[0],mediaId:'wrong-day',name:'wrong-day.jpg',metadata:{...valid[0].metadata,dayNumber:2}},service=createPhotoExportService({repository:{
    async listProjectSessionPhotoDescriptors(){return structuredClone([...valid,mismatch]);},
    async getMedia(){mediaReads+=1;throw new Error('identity validation must happen before Blob hydration');}
  }}),options={project,journal,session:sessionB,buildIdentity,exportedAt:exportMoment(126)};
  for(const operation of [()=>service.dayBackup('project',1,options),()=>service.day('project',1,{...options,exportedAt:exportMoment(127)})]){
    await assert.rejects(operation,error=>error.code==='DAY_BACKUP_MEDIA_MISMATCH'&&error.mismatchCount===1&&error.mediaIds[0]==='wrong-day'&&/No partial backup/i.test(error.message));
  }
  assert.equal(mediaReads,0);
});

test('a validated exact-session descriptor disappearing during reopen cannot produce a partial package',async()=>{
  const stored=[media('present','session-b','original'),media('missing','session-b','evidence')],descriptors=stored.map(({blob,...item})=>({...item,size:blob.size})),service=createPhotoExportService({repository:{
    async listProjectSessionPhotoDescriptors(){return structuredClone(descriptors);},
    async getMedia(mediaId){return mediaId==='missing'?null:stored.find(item=>item.mediaId===mediaId);}
  }}),options={project,journal,session:sessionB,buildIdentity,exportedAt:exportMoment(127)};
  for(const operation of [()=>service.dayBackup('project',1,options),()=>service.day('project',1,options)])await assert.rejects(operation,error=>error.code==='DAY_BACKUP_MEDIA_MISMATCH'&&error.descriptorCount===2&&error.reopenedCount===1&&error.missingMediaIds.includes('missing')&&/No partial backup/i.test(error.message));
});

test('a reopened record whose scope changed after descriptor selection is rejected',async()=>{
  const stored=media('changed-after-index','session-b','original'),{blob,...descriptor}=stored,service=createPhotoExportService({repository:{async listProjectSessionPhotoDescriptors(){return [{...descriptor,size:blob.size}];},async getMedia(){return {...stored,metadata:{...stored.metadata,dayNumber:2}};}}}),options={project,journal,session:sessionB,buildIdentity,exportedAt:exportMoment(127)};
  for(const operation of [()=>service.dayBackup('project',1,options),()=>service.day('project',1,options)])await assert.rejects(operation,error=>error.code==='DAY_BACKUP_MEDIA_MISMATCH'&&error.mediaIds.includes('changed-after-index'));
});

test('legacy bounded Project/day selection excludes other days but still fails if an eligible descriptor disappears',async()=>{
  const legacy={...sessionA,sessionId:'legacy-session',runNumber:3,legacy:true,origin:'schema-v1-day-execution'},eligible=media('legacy-present',null,'original'),missing=media('legacy-missing',null,'evidence'),otherDay={...media('legacy-day-2',null,'original'),metadata:{dayNumber:2,objectiveType:'checkpoint'}},rows=[eligible,missing,otherDay].map(({blob,...item})=>({...item,sessionId:null,metadata:{...item.metadata,sessionId:undefined},size:blob.size})),opened=[];
  const service=createPhotoExportService({repository:{async listProjectPhotoDescriptors(){return structuredClone(rows);},async getMedia(mediaId){opened.push(mediaId);return mediaId==='legacy-missing'?null:[eligible,otherDay].find(item=>item.mediaId===mediaId)||null;}}});
  await assert.rejects(()=>service.day('project',1,{project,journal:[],session:legacy,buildIdentity,exportedAt:exportMoment(127)}),error=>error.code==='DAY_BACKUP_MEDIA_MISMATCH'&&error.descriptorCount===2&&error.reopenedCount===1&&error.missingMediaIds.includes('legacy-missing'));
  assert.deepEqual(opened.sort(),['legacy-missing','legacy-present'],'legacy rows from other days are excluded before reopen and do not false-fail');
});

test('deliberate-session media scope rejects missing and conflicting Project, session, and day identities',()=>{
  const valid={...media('valid-scope','session-b','original'),dayNumber:1},cases=[
    {...valid,projectId:null,metadata:{...valid.metadata,projectId:null}},
    {...valid,metadata:{...valid.metadata,projectId:'other-project'}},
    {...valid,sessionId:null,metadata:{...valid.metadata,sessionId:null}},
    {...valid,metadata:{...valid.metadata,sessionId:'other-session'}},
    {...valid,dayNumber:null,metadata:{...valid.metadata,dayNumber:null}},
    {...valid,metadata:{...valid.metadata,dayNumber:2}}
  ];
  for(const descriptor of cases)assert.throws(()=>assertDeliberateSessionMediaIdentity([descriptor],{projectId:'project',dayNumber:1,session:sessionB}),error=>error.code==='DAY_BACKUP_MEDIA_MISMATCH'&&error.mismatchCount===1);
});

test('current-session media tagged to the wrong day fails instead of verifying a zero-media backup',async()=>{
  const wrongDay={...media('wrong-day','session-b','original'),metadata:{dayNumber:2,sessionId:'session-b',objectiveType:'checkpoint'}};
  Object.defineProperty(wrongDay,'blob',{enumerable:true,get(){throw new Error('wrong-day bytes must not be hydrated');}});
  const service=createPhotoExportService({repository:{
    async listProjectSessionPhotos(){return [wrongDay];},
    async listProjectPhotos(){throw new Error('session export must remain bounded');}
  }}),options={project,journal,session:sessionB,buildIdentity,exportedAt:exportMoment(128)};
  await assert.rejects(()=>service.dayBackup('project',1,options),error=>error.code==='DAY_BACKUP_MEDIA_MISMATCH'&&error.mismatchCount===1);
  await assert.rejects(()=>service.day('project',1,{...options,exportedAt:exportMoment(129)}),error=>error.code==='DAY_BACKUP_MEDIA_MISMATCH'&&error.mismatchCount===1);
});

test('legacy no-session callers retain established day filenames',async()=>{
  const oldRows=[{mediaId:'old',projectId:'project',role:'original',name:'Old.jpg',blob:new Blob(['old']),metadata:{dayNumber:1}}],service=createPhotoExportService({repository:{listProjectPhotos:async()=>oldRows}}),photos=await service.day('project',1),backup=await service.dayBackup('project',1,{project:{projectId:'project',name:'America 250',features:[{id:'cp-1',type:'checkpoint',day:1,status:'upcoming'}]}});
  assert.equal(photos.filename,'Day01_Photos.zip');
  assert.equal(backup.filename,'Day01_Backup.cmapday.zip');
});
