import {test,expect} from '@playwright/test';

test('verified Day Backup round-trips Project, state, Journal, pair identity, filenames, and exact bytes into clean IndexedDB',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='iPhone 13 portrait');await page.goto('/');
  const result=await page.evaluate(async suffix=>{
    const infra=await import('/src/infrastructure/indexeddb/index.js'),exports=await import('/src/application/photo-export-service.js'),restoreModule=await import('/src/application/journey-package-restore.js'),open=name=>infra.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name}),sourceDb=await open(`source-${suffix}`),sourceRestore=infra.createJourneyRestoreRepository({database:sourceDb}),bytes=['front-original','front-evidence','rear-original','rear-evidence'],roles=[['front','original'],['front','evidence'],['rear','original'],['rear','evidence']],media=roles.map(([cameraRole,role],index)=>({mediaId:`m${index}`,projectId:'project',checkpointId:'hotel',journalEventId:'photo',pairId:'pair-1',pairStatus:'complete',cameraRole,role,name:`${cameraRole}-${role}.jpg`,mimeType:'image/jpeg',size:bytes[index].length,metadata:{dayNumber:9,objectiveType:'hotel',pairId:'pair-1',cameraRole},blob:new Blob([bytes[index]],{type:'image/jpeg'})})),project={projectId:'project',id:'project',name:'America 250 – 2026',features:[{id:'hotel',type:'hotel',day:9,status:'collected',points:50,photoPairId:'pair-1'}],rallyExecution:{days:{9:{dayNumber:9,status:'complete',score:50}}}},journal=[{eventId:'arrival',projectId:'project',eventType:'hotel_arrival',metadata:{dayNumber:9}},{eventId:'photo',projectId:'project',eventType:'photo_added',metadata:{dayNumber:9,objectiveType:'hotel'},references:{pairId:'pair-1'}},{eventId:'finished',projectId:'project',eventType:'day_finished',metadata:{dayNumber:9}}];
    await sourceRestore.restoreNew({project,journal,media});const sourceMedia=infra.createMissionMediaRepository({database:sourceDb,createId:()=>'',clock:{iso:()=>''}}),service=exports.createPhotoExportService({repository:sourceMedia}),archive=await service.dayBackup('project',9,{project,journal,settings:{rallyDays:{9:{status:'complete',score:50}}},applicationVersion:'test',buildId:'roundtrip'});sourceDb.close();
    const targetDb=await open(`target-${suffix}`),restore=restoreModule.createJourneyPackageRestoreService({repository:infra.createJourneyRestoreRepository({database:targetDb})}),payload=await restore.restoreDay(archive.blob),targetMedia=infra.createMissionMediaRepository({database:targetDb,createId:()=>'',clock:{iso:()=>''}}),restoredMedia=await targetMedia.listProjectPhotos('project'),tx=targetDb.transaction(['projectRecords','journalEvents'],'readonly'),request=(store,key)=>new Promise((resolve,reject)=>{const r=key?tx.objectStore(store).get(key):tx.objectStore(store).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);}),restoredProject=await request('projectRecords','project'),restoredJournal=await request('journalEvents'),restoredBytes=await Promise.all(restoredMedia.sort((a,b)=>a.mediaId.localeCompare(b.mediaId)).map(async row=>await row.blob.text()));targetDb.close();return {filename:archive.filename,verified:archive.verified,project:restoredProject,journal:restoredJournal,media:restoredMedia.map(({blob,binaryData,...row})=>row),bytes:restoredBytes,manifest:payload.manifest};
  },`${testInfo.project.name}-${Date.now()}`);
  expect(result.filename).toBe('Day09_Backup.cmapday.zip');expect(result.verified).toBeTruthy();expect(result.project.features[0]).toMatchObject({id:'hotel',status:'collected',photoPairId:'pair-1'});expect(result.project.rallyExecution.days['9']).toMatchObject({status:'complete',score:50});expect(result.journal).toHaveLength(3);expect(result.media).toHaveLength(4);expect(new Set(result.media.map(item=>item.pairId))).toEqual(new Set(['pair-1']));expect(result.bytes).toEqual(['front-original','front-evidence','rear-original','rear-evidence']);expect(result.manifest.mediaCount).toBe(4);
});

test('partial capture pair survives Day Backup restore without fabricating the missing camera side',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='iPhone 13 portrait');
  await page.goto('/');
  const result=await page.evaluate(async suffix=>{
    const infra=await import('/src/infrastructure/indexeddb/index.js');
    const exports=await import('/src/application/photo-export-service.js');
    const restoreModule=await import('/src/application/journey-package-restore.js');
    const open=name=>infra.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name});
    const projectId=`partial-${suffix}`,pairId='pair-rear-only',originalId='rear-original',evidenceId='rear-evidence';
    const media=[
      {mediaId:originalId,projectId,checkpointId:'cp-42',journalEventId:'photo-partial',pairId,pairStatus:'pending',cameraRole:'rear',role:'original',pairedMediaId:evidenceId,name:'rear-original.jpg',mimeType:'image/jpeg',size:20,metadata:{dayNumber:9,objectiveType:'checkpoint',pairId,cameraRole:'rear'},blob:new Blob(['partial-rear-original'],{type:'image/jpeg'})},
      {mediaId:evidenceId,projectId,checkpointId:'cp-42',journalEventId:'photo-partial',pairId,pairStatus:'pending',cameraRole:'rear',role:'evidence',pairedMediaId:originalId,name:'rear-evidence.jpg',mimeType:'image/jpeg',size:20,metadata:{dayNumber:9,objectiveType:'checkpoint',pairId,cameraRole:'rear'},blob:new Blob(['partial-rear-evidence'],{type:'image/jpeg'})}
    ];
    const project={projectId,id:projectId,name:'Interrupted Media Day',features:[{id:'cp-42',type:'checkpoint',day:9,status:'photo_required',points:10,pendingPhotoPair:{pairId,pairJournalEventId:'photo-partial',status:'pending'}}],rallyExecution:{days:{9:{dayNumber:9,status:'active',score:0}}}};
    const journal=[{eventId:'photo-partial',projectId,eventType:'photo_added',metadata:{dayNumber:9,objectiveType:'checkpoint',pairId},references:{checkpointId:'cp-42',pairId},attachments:{photos:[{mediaId:originalId},{mediaId:evidenceId}]}}];
    const sourceDb=await open(`partial-source-${suffix}`),sourceRestore=infra.createJourneyRestoreRepository({database:sourceDb});
    await sourceRestore.restoreNew({project,journal,media});
    const service=exports.createPhotoExportService({repository:infra.createMissionMediaRepository({database:sourceDb,createId:()=>'',clock:{iso:()=>''}})});
    const archive=await service.dayBackup(projectId,9,{project,journal,settings:{rallyDays:{9:{status:'active',score:0}}},applicationVersion:'test',buildId:'partial-roundtrip'});
    sourceDb.close();

    const targetDb=await open(`partial-target-${suffix}`),restore=restoreModule.createJourneyPackageRestoreService({repository:infra.createJourneyRestoreRepository({database:targetDb})});
    const restoredPackage=await restore.restoreDay(archive.blob);
    const targetMedia=infra.createMissionMediaRepository({database:targetDb,createId:()=>'',clock:{iso:()=>''}}),restoredMedia=(await targetMedia.listProjectPhotos(projectId)).sort((a,b)=>a.role.localeCompare(b.role));
    const tx=targetDb.transaction(['projectRecords'],'readonly'),request=tx.objectStore('projectRecords').get(projectId),restoredProject=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const bytes=await Promise.all(restoredMedia.map(row=>row.blob.text()));targetDb.close();
    return {manifest:archive.manifest,verification:restoredPackage.verification,feature:restoredProject.features[0],media:restoredMedia.map(({blob,binaryData,...row})=>row),bytes};
  },`${testInfo.project.name}-${Date.now()}`);

  expect(result.manifest).toMatchObject({mediaCount:2,originalCount:1,evidenceCount:1,pairCount:1});
  expect(result.verification).toMatchObject({verified:true,mediaCount:2,pairCount:1});
  expect(result.feature).toMatchObject({id:'cp-42',status:'photo_required',pendingPhotoPair:{pairId:'pair-rear-only',status:'pending'}});
  expect(result.media).toHaveLength(2);
  expect(result.media.every(item=>item.pairId==='pair-rear-only'&&item.pairStatus==='pending'&&item.cameraRole==='rear')).toBeTruthy();
  expect(result.media.some(item=>item.cameraRole==='front')).toBeFalsy();
  expect(result.bytes).toEqual(['partial-rear-evidence','partial-rear-original']);
});

test('REPLACE changes only the selected day and CANCEL makes no writes',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='iPhone 13 portrait');await page.goto('/');const result=await page.evaluate(async suffix=>{const infra=await import('/src/infrastructure/indexeddb/index.js'),database=await infra.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:()=>true},databaseName:`replace-${suffix}`}),repository=infra.createJourneyRestoreRepository({database}),base={projectId:'p',id:'p',name:'Original',features:[{id:'d1',day:1,status:'collected'},{id:'old9',day:9,status:'deferred'},{id:'d31',day:31,status:'upcoming'}],rallyExecution:{days:{1:{status:'complete'},9:{status:'active'},31:{status:'ready'}}}},other={projectId:'other',id:'other',name:'Other',features:[{id:'other1',day:1,status:'collected'}]};await repository.restoreNew({project:base,journal:[{eventId:'keep',projectId:'p',metadata:{dayNumber:1}},{eventId:'old',projectId:'p',metadata:{dayNumber:9}}],media:[{mediaId:'keep',projectId:'p',checkpointId:'d1',journalEventId:'keep',metadata:{dayNumber:1},blob:new Blob(['keep'])},{mediaId:'old',projectId:'p',checkpointId:'old9',journalEventId:'old',metadata:{dayNumber:9},blob:new Blob(['old'])}]});await repository.restoreNew({project:other});const payload={manifest:{projectId:'p',dayNumber:9,dayState:{status:'complete'}},projectMetadata:{dayFeatures:[{id:'new9',day:9,status:'collected',scoreAwarded:20}],project:{...base,features:[{id:'new9',day:9,status:'collected',scoreAwarded:20}],rallyExecution:{days:{9:{status:'complete',score:20}}}}},journal:[{eventId:'new',projectId:'p',metadata:{dayNumber:9}}],media:[{mediaId:'new',projectId:'p',checkpointId:'new9',journalEventId:'new',metadata:{dayNumber:9},blob:new Blob(['new'])}]};let cancelError='';try{await repository.restoreDay(payload,{mode:'cancel'});}catch(error){cancelError=error.code;}const beforeReplace=await repository.readDay('p',9);await repository.restoreDay(payload,{mode:'replace'});const restored=await repository.readDay('p',9),tx=database.transaction(['projectRecords','journalEvents','missionMedia'],'readonly'),get=(store,key)=>new Promise((resolve,reject)=>{const request=key?tx.objectStore(store).get(key):tx.objectStore(store).getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);}),project=await get('projectRecords','p'),unrelated=await get('projectRecords','other'),allJournal=await get('journalEvents'),allMedia=await get('missionMedia');database.close();return {cancelError,beforeIds:beforeReplace.project.features.map(item=>item.id),featureIds:project.features.map(item=>item.id),day9:restored.project.rallyExecution.days['9'],journalIds:allJournal.map(item=>item.eventId),mediaIds:allMedia.map(item=>item.mediaId),unrelated:unrelated.features.map(item=>item.id)};},`${testInfo.project.name}-${Date.now()}`);expect(result.cancelError).toBe('DUPLICATE_PROJECT');expect(result.beforeIds).toContain('old9');expect(result.featureIds).toEqual(expect.arrayContaining(['d1','new9','d31']));expect(result.featureIds).not.toContain('old9');expect(result.day9).toMatchObject({status:'complete',score:20});expect(result.journalIds).toEqual(expect.arrayContaining(['keep','new']));expect(result.journalIds).not.toContain('old');expect(result.mediaIds).toEqual(expect.arrayContaining(['keep','new']));expect(result.mediaIds).not.toContain('old');expect(result.unrelated).toEqual(['other1']);
});

test('session-aware REPLACE restores one Day 1 run without erasing the active Day 1 run',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='iPhone 13 portrait');
  await page.goto('/');
  const result=await page.evaluate(async suffix=>{
    const infra=await import('/src/infrastructure/indexeddb/index.js');
    const exportModule=await import('/src/application/photo-export-service.js');
    const restoreModule=await import('/src/application/journey-package-restore.js');
    const open=name=>infra.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name});
    const checkpointState=(status,sessionId,at)=>({status,arrivedAt:at,arrivalState:'confirmed',scoreAwarded:status==='collected'?10:0,
      checkpointEvidence:{schemaVersion:1,arrival:{state:'confirmed',trustworthy:true,arrivalId:`arrival-${sessionId}`,timestamp:at,latitude:41,longitude:-87,gpsAccuracyFeet:12,source:'gps-radius-dwell'},photo:{required:true,state:status==='collected'?'complete':'failed',pairId:null,pairJournalEventId:null,reasonCode:status==='collected'?null:'camera-failed',failureReason:null,missingSides:status==='collected'?[]:['front','rear'],mediaReferences:{},updatedAt:at},completion:{state:status==='collected'?'completed':'pending',completedAt:status==='collected'?at:null,pointsAwarded:status==='collected'?10:0,legacyCompletionWithoutRequiredPhoto:false}}});
    const session=(sessionId,runNumber,calendarDate,status,checkpointStatus)=>({schemaVersion:2,sessionId,projectId:'project',rallyId:'america-250',dayId:'america-250-day-1',dayNumber:1,calendarDate,runNumber,status,startedAt:`${calendarDate}T13:00:00.000Z`,completedAt:null,activeObjectiveId:'cp-1',checkpointStates:{'cp-1':checkpointState(checkpointStatus,sessionId,`${calendarDate}T14:00:00.000Z`)},pendingEvidence:{schemaVersion:1,entries:checkpointStatus==='collected'?[]:[{sessionId,checkpointId:'cp-1',state:'failed',enqueuedAt:`${calendarDate}T14:00:00.000Z`,updatedAt:`${calendarDate}T14:00:00.000Z`}]},summary:null,nextDay:0,legacy:false,origin:'deliberate-start'});
    const runA=session('run-a',1,'2026-08-17','suspended','photo_required'),runB=session('run-b',2,'2026-08-18','active','collected');
    const feature={id:'cp-1',type:'checkpoint',day:1,name:'1.1 I-12',points:10,photoRequired:true,...runB.checkpointStates['cp-1']};
    const project={projectId:'project',id:'project',tripId:'month-trip',rallyId:'america-250',name:'America 250',features:[feature],rallyExecution:{schemaVersion:2,activeSessionId:'run-b',sessions:{'run-a':runA,'run-b':runB},daySessions:{1:['run-a','run-b']},days:{1:{dayNumber:1,sessionId:'run-b',status:'active'}}}};
    const journal=(eventId,sessionId,eventType,calendarDate)=>({eventId,projectId:'project',sessionId,eventType,timestamp:`${calendarDate}T14:00:00.000Z`,metadata:{dayNumber:1,sessionId},references:{checkpointId:'cp-1',sessionId}});
    const media=(mediaId,sessionId,contents)=>({mediaId,projectId:'project',sessionId,checkpointId:'cp-1',journalEventId:`arrival-${sessionId}`,pairId:null,pairStatus:'pending',cameraRole:'rear',role:'original',name:`${mediaId}.jpg`,mimeType:'image/jpeg',metadata:{dayNumber:1,sessionId,objectiveType:'checkpoint',cameraRole:'rear'},blob:new Blob([contents],{type:'image/jpeg'})});
    const exportedJournal=[journal('arrival-a','run-a','checkpoint_arrival','2026-08-17')],exportedMedia=[media('media-a','run-a','restored-run-a')];
    const exporter=exportModule.createPhotoExportService({repository:{listProjectPhotos:async()=>exportedMedia}}),archive=await exporter.dayBackup('project',1,{project,journal:exportedJournal,session:runA,buildIdentity:{applicationVersion:'0.7.11',buildId:'restore-isolation',serviceWorkerCacheId:'cache-restore'},exportedAt:new Date('2026-08-18T22:00:00.123Z')});
    const database=await open(`session-replace-${suffix}`),repository=infra.createJourneyRestoreRepository({database});
    const staleRunA={...runA,checkpointStates:{'cp-1':{status:'failed',failedAt:'2026-08-17T15:00:00.000Z'}},pendingEvidence:{schemaVersion:1,entries:[]}};
    const targetProject=structuredClone(project);targetProject.rallyExecution.sessions['run-a']=staleRunA;
    await repository.restoreNew({project:targetProject,journal:[journal('stale-a','run-a','checkpoint_failed','2026-08-17'),journal('arrival-b','run-b','checkpoint_arrival','2026-08-18')],media:[media('stale-media-a','run-a','stale-run-a'),media('media-b','run-b','preserve-run-b')]});
    const restore=restoreModule.createJourneyPackageRestoreService({repository}),restoredPackage=await restore.restoreDay(archive.blob,{mode:'replace'}),stored=await repository.readDay('project',1);
    const storedProject=stored.project,runAMedia=stored.media.find(item=>item.mediaId==='media-a'),runBMedia=stored.media.find(item=>item.mediaId==='media-b'),runABytes=await runAMedia.blob.text(),runBBytes=await runBMedia.blob.text();database.close();
    return {verification:restoredPackage.verification,activeSessionId:storedProject.rallyExecution.activeSessionId,dayState:storedProject.rallyExecution.days['1'],daySessions:storedProject.rallyExecution.daySessions['1'],runA:storedProject.rallyExecution.sessions['run-a'],runB:storedProject.rallyExecution.sessions['run-b'],liveFeature:storedProject.features.find(item=>item.id==='cp-1'),journalIds:stored.journal.map(item=>item.eventId).sort(),mediaIds:stored.media.map(item=>item.mediaId).sort(),runABytes,runBBytes};
  },`${testInfo.project.name}-${Date.now()}`);

  expect(result.verification).toMatchObject({verified:true,sessionId:'run-a',journalEventCount:1,mediaCount:1});
  expect(result.activeSessionId).toBe('run-b');
  expect(result.dayState).toMatchObject({sessionId:'run-b',status:'active'});
  expect(result.daySessions.filter(id=>id==='run-a')).toHaveLength(1);
  expect(result.daySessions.filter(id=>id==='run-b')).toHaveLength(1);
  expect(result.runA.checkpointStates['cp-1']).toMatchObject({status:'photo_required',arrivalState:'confirmed'});
  expect(result.runB.checkpointStates['cp-1']).toMatchObject({status:'collected',scoreAwarded:10});
  expect(result.liveFeature).toMatchObject({id:'cp-1',status:'collected',scoreAwarded:10});
  expect(result.journalIds).toEqual(['arrival-a','arrival-b']);
  expect(result.mediaIds).toEqual(['media-a','media-b']);
  expect(result.runABytes).toBe('restored-run-a');
  expect(result.runBBytes).toBe('preserve-run-b');
});

test('session-aware recovery copy rewrites and verifies every nested Project identity',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='iPhone 13 portrait');
  await page.goto('/');
  const result=await page.evaluate(async suffix=>{
    const infra=await import('/src/infrastructure/indexeddb/index.js');
    const exportModule=await import('/src/application/photo-export-service.js');
    const restoreModule=await import('/src/application/journey-package-restore.js');
    const open=name=>infra.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name});
    const session=(sessionId,runNumber,calendarDate,status)=>({schemaVersion:2,sessionId,projectId:'project',rallyId:'america-250',dayId:'america-250-day-1',dayNumber:1,calendarDate,runNumber,status,startedAt:`${calendarDate}T13:00:00.000Z`,completedAt:null,activeObjectiveId:'cp-1',checkpointStates:{'cp-1':{status:'photo_required',scoreAwarded:0}},pendingEvidence:{schemaVersion:1,entries:[]},summary:null,nextDay:0,legacy:false,origin:'deliberate-start'});
    const runA=session('run-a',1,'2026-08-17','active'),runB=session('run-b',2,'2026-08-18','suspended'),project={projectId:'project',id:'project',tripId:'month-trip',rallyId:'america-250',name:'America 250',features:[{id:'cp-1',type:'checkpoint',day:1,status:'photo_required',points:10,photoRequired:true}],rallyExecution:{schemaVersion:2,activeSessionId:'run-a',sessions:{'run-a':runA,'run-b':runB},daySessions:{1:['run-a','run-b']},days:{1:{dayNumber:1,sessionId:'run-a',status:'active'}}}};
    const journal=[{eventId:'arrival-a',projectId:'project',sessionId:'run-a',eventType:'checkpoint_arrival',timestamp:'2026-08-17T14:00:00.000Z',metadata:{dayNumber:1,sessionId:'run-a'},references:{checkpointId:'cp-1',sessionId:'run-a'}}],media=[{mediaId:'media-a',projectId:'project',sessionId:'run-a',checkpointId:'cp-1',journalEventId:'arrival-a',pairId:null,pairStatus:'pending',cameraRole:'rear',role:'original',name:'media-a.jpg',mimeType:'image/jpeg',metadata:{dayNumber:1,sessionId:'run-a',objectiveType:'checkpoint',cameraRole:'rear'},blob:new Blob(['run-a-photo'],{type:'image/jpeg'})}];
    const exporter=exportModule.createPhotoExportService({repository:{listProjectPhotos:async()=>media}}),archive=await exporter.dayBackup('project',1,{project,journal,session:runA,buildIdentity:{applicationVersion:'0.7.11',buildId:'restore-copy',serviceWorkerCacheId:'cache-copy'},exportedAt:new Date('2026-08-18T22:01:00.456Z')});
    const database=await open(`session-copy-${suffix}`),repository=infra.createJourneyRestoreRepository({database}),restore=restoreModule.createJourneyPackageRestoreService({repository}),restoredPackage=await restore.restoreDay(archive.blob,{mode:'recovery-copy',recoveryProjectId:'project-recovery'}),stored=await repository.readDay('project-recovery',1),nestedProjectIds=Object.values(stored.project.rallyExecution.sessions).map(item=>item.projectId),mediaBytes=await stored.media[0].blob.text();database.close();
    return {manifestProjectId:restoredPackage.manifest.projectId,metadataProjectId:restoredPackage.projectMetadata.projectId,projectId:stored.project.projectId,id:stored.project.id,nestedProjectIds,sessionIds:Object.keys(stored.project.rallyExecution.sessions),daySessions:stored.project.rallyExecution.daySessions['1'],journalProjectIds:stored.journal.map(item=>item.projectId),mediaProjectIds:stored.media.map(item=>item.projectId),originalProjectId:restoredPackage.originalProjectId,verification:restoredPackage.verification,mediaBytes};
  },`${testInfo.project.name}-${Date.now()}`);

  expect(result).toMatchObject({manifestProjectId:'project-recovery',metadataProjectId:'project-recovery',projectId:'project-recovery',id:'project-recovery',originalProjectId:'project',mediaBytes:'run-a-photo'});
  expect(result.nestedProjectIds).toEqual(['project-recovery']);
  expect(result.sessionIds).toEqual(['run-a']);
  expect(result.daySessions).toEqual(['run-a']);
  expect(result.journalProjectIds).toEqual(['project-recovery']);
  expect(result.mediaProjectIds).toEqual(['project-recovery']);
  expect(result.verification).toMatchObject({verified:true,projectId:'project-recovery',sessionId:'run-a',journalEventCount:1,mediaCount:1});
});

test('legacy session replacement keeps unscoped Journal and media from every other day',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='iPhone 13 portrait');await page.goto('/');
  const result=await page.evaluate(async suffix=>{
    const infra=await import('/src/infrastructure/indexeddb/index.js'),database=await infra.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:()=>true},databaseName:`legacy-session-day-guard-${suffix}`}),repository=infra.createJourneyRestoreRepository({database}),session={schemaVersion:2,sessionId:'legacy-run',projectId:'legacy-project',rallyId:'rally',dayId:'day-1',dayNumber:1,calendarDate:'2026-08-17',runNumber:1,status:'suspended',startedAt:'2026-08-17T13:00:00.000Z',checkpointStates:{cp1:{status:'failed'}},pendingEvidence:{schemaVersion:1,entries:[]},legacy:true,origin:'schema-v1-day-execution'},project={projectId:'legacy-project',id:'legacy-project',features:[{id:'cp1',type:'checkpoint',day:1,status:'failed'},{id:'cp2',type:'checkpoint',day:2,status:'collected'}],rallyExecution:{schemaVersion:2,activeSessionId:'legacy-run',sessions:{'legacy-run':session},daySessions:{1:['legacy-run']},days:{1:{status:'suspended'},2:{status:'complete'}}}},record=(id,day)=>({mediaId:id,projectId:'legacy-project',checkpointId:`cp${day}`,journalEventId:`event-${id}`,name:`${id}.jpg`,role:'original',metadata:{dayNumber:day},blob:new Blob([id])});
    await repository.restoreNew({project,journal:[{eventId:'old-day-1',projectId:'legacy-project',metadata:{dayNumber:1}},{eventId:'keep-day-2',projectId:'legacy-project',metadata:{dayNumber:2}}],media:[record('old-media-day-1',1),record('keep-media-day-2',2)]});
    const restoredSession={...session,checkpointStates:{cp1:{status:'photo_required'}}},incoming={...project,features:[{id:'cp1',type:'checkpoint',day:1,status:'photo_required'}],rallyExecution:{schemaVersion:2,activeSessionId:'legacy-run',sessions:{'legacy-run':restoredSession},daySessions:{1:['legacy-run']},days:{1:{status:'suspended'}}}},payload={manifest:{projectId:'legacy-project',dayNumber:1,sessionId:'legacy-run',dayState:{status:'suspended'}},projectMetadata:{projectId:'legacy-project',dayNumber:1,sessionId:'legacy-run',dayFeatures:incoming.features,project:incoming},journal:[{eventId:'new-day-1',projectId:'legacy-project',metadata:{dayNumber:1}}],media:[record('new-media-day-1',1)]};
    await repository.restoreDay(payload,{mode:'replace'});const tx=database.transaction(['journalEvents','missionMedia'],'readonly'),read=store=>new Promise((resolve,reject)=>{const request=tx.objectStore(store).getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);}),journal=await read('journalEvents'),media=await read('missionMedia');database.close();return {journalIds:journal.map(item=>item.eventId).sort(),mediaIds:media.map(item=>item.mediaId).sort()};
  },`${testInfo.project.name}-${Date.now()}`);
  expect(result.journalIds).toEqual(['keep-day-2','new-day-1']);
  expect(result.mediaIds).toEqual(['keep-media-day-2','new-media-day-1']);
});
