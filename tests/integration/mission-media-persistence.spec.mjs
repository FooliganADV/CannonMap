import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>page.goto('/'));

test('v9 media storage is additive, durable, and project scoped',async({page},testInfo)=>{
  const result=await page.evaluate(async name=>{
    const module=await import('/src/infrastructure/indexeddb/index.js');
    const open=()=>module.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name});
    let database=await open(),number=0;
    let repository=module.createMissionMediaRepository({database,createId:()=>`00000000-0000-4000-8000-${String(++number).padStart(12,'0')}`,clock:{iso:()=> '2026-07-31T12:00:00.000Z'}});
    const reference=await repository.addPhoto({projectId:'project-1',checkpointId:'cp-1',journalEventId:'event-1',file:new File(['photo'],'checkpoint.jpg',{type:'image/jpeg'})});
    database.close();database=await open();repository=module.createMissionMediaRepository({database,createId:()=>'',clock:{iso:()=>''}});
    const own=await repository.listCheckpointPhotos('project-1','cp-1'),other=await repository.listCheckpointPhotos('project-2','cp-1');
    const answer={version:database.version,reference,own:own.map(item=>({projectId:item.projectId,name:item.name,size:item.size,type:item.blob.type})),other};database.close();return answer;
  },`CannonMapDB-media-${testInfo.project.name}-${Date.now()}`);
  expect(result.version).toBe(10);expect(result.reference.uri).toMatch(/^media:\/\//);
  expect(result.own).toEqual([{projectId:'project-1',name:'checkpoint.jpg',size:5,type:'image/jpeg'}]);expect(result.other).toEqual([]);
});

test('original and evidence images persist as one atomic reference pair',async({page},testInfo)=>{
  const result=await page.evaluate(async name=>{
    const module=await import('/src/infrastructure/indexeddb/index.js'),database=await module.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name});let number=0;
    const repository=module.createMissionMediaRepository({database,createId:()=>`00000000-0000-4000-8000-${String(++number).padStart(12,'0')}`,clock:{iso:()=> '2026-08-03T17:00:00.000Z'}}),original=new File(['camera-original'],'camera.jpg',{type:'image/jpeg'});
    const pair=await repository.addEvidencePair({projectId:'project',checkpointId:'1.1',journalEventId:'journal',originalFile:original,evidenceBlob:new Blob(['evidence-copy'],{type:'image/jpeg'}),metadata:{dayNumber:1},filenames:{original:'Day01_CP1.1_Original.jpg',evidence:'Day01_CP1.1_Evidence.jpg'}});
    const rows=await repository.listCheckpointPhotos('project','1.1'),originalRow=rows.find(row=>row.role==='original'),evidenceRow=rows.find(row=>row.role==='evidence');
    const answer={pair,roles:rows.map(row=>row.role).sort(),originalText:await originalRow.blob.text(),evidenceText:await evidenceRow.blob.text(),shared:originalRow.mediaGroupId===evidenceRow.mediaGroupId};database.close();return answer;
  },`CannonMapDB-evidence-${testInfo.project.name}-${Date.now()}`);
  expect(result.roles).toEqual(['evidence','original']);expect(result.originalText).toBe('camera-original');expect(result.evidenceText).toBe('evidence-copy');expect(result.shared).toBeTruthy();expect(result.pair.original.name).toBe('Day01_CP1.1_Original.jpg');
});

test('camera File and Evidence Blob persist as exact byte buffers without Blob/File structured cloning',async({page},testInfo)=>{
  const result=await page.evaluate(async name=>{
    const module=await import('/src/infrastructure/indexeddb/index.js');let database=await module.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name}),number=0;
    let repository=module.createMissionMediaRepository({database,createId:()=>`safe-${++number}`,clock:{iso:()=> '2026-08-04T17:01:31.085Z'}});
    const originalBytes=new Uint8Array([255,216,255,224,1,2,3,255,217]),evidenceBytes=new Uint8Array([255,216,255,225,9,8,7,255,217]),file=new File([originalBytes],'IMG_0001.JPG',{type:'image/jpeg',lastModified:1770000000000});
    await repository.addEvidencePair({projectId:'iphone-project',checkpointId:'cp-1',journalEventId:'arrival-1',originalFile:file,evidenceBlob:new Blob([evidenceBytes],{type:'image/jpeg'}),metadata:{dayNumber:1},identities:{mediaGroupId:'group',originalMediaId:'original',evidenceMediaId:'evidence'}});
    const transaction=database.transaction('missionMedia','readonly'),rawRequest=transaction.objectStore('missionMedia').getAll(),raw=await new Promise((resolve,reject)=>{rawRequest.onsuccess=()=>resolve(rawRequest.result);rawRequest.onerror=()=>reject(rawRequest.error);});
    const rawShape=raw.map(row=>({role:row.role,hasBlob:'blob'in row,binaryConstructor:row.binaryData.constructor.name,size:row.binaryData.byteLength,name:row.name,sourceName:row.sourceName,mimeType:row.mimeType,lastModified:row.lastModified}));database.close();
    database=await module.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name});repository=module.createMissionMediaRepository({database,createId:()=>'',clock:{iso:()=>''}});const rows=await repository.listCheckpointPhotos('iphone-project','cp-1'),bytes=await Promise.all(rows.sort((a,b)=>a.role.localeCompare(b.role)).map(async row=>[row.role,[...new Uint8Array(await row.blob.arrayBuffer())]]));database.close();return {rawShape,bytes};
  },`CannonMapDB-safari-bytes-${testInfo.project.name}-${Date.now()}`);
  expect(result.rawShape.every(row=>!row.hasBlob&&row.binaryConstructor==='ArrayBuffer')).toBeTruthy();
  expect(result.rawShape.find(row=>row.role==='original')).toMatchObject({size:9,name:'IMG_0001.JPG',sourceName:'IMG_0001.JPG',mimeType:'image/jpeg',lastModified:1770000000000});
  expect(result.bytes).toEqual([['evidence',[255,216,255,225,9,8,7,255,217]],['original',[255,216,255,224,1,2,3,255,217]]]);
});

test('media transaction failures expose technical diagnostics without committing a duplicate',async({page},testInfo)=>{
  const result=await page.evaluate(async name=>{
    const module=await import('/src/infrastructure/indexeddb/index.js'),database=await module.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name}),repository=module.createMissionMediaRepository({database,createId:()=> 'same-id',clock:{iso:()=> '2026-08-04T17:01:31.085Z'}}),input={projectId:'p',checkpointId:'c',journalEventId:'j',file:new File(['camera'],'camera.jpg',{type:'image/jpeg'})};
    await repository.addPhoto(input);let failure=null;try{await repository.addPhoto(input);}catch(error){failure={name:error.name,code:error.code,message:error.message,diagnostics:error.diagnostics,causeName:error.cause?.name};}
    const rows=await repository.listProjectPhotos('p');database.close();return {failure,count:rows.length};
  },`CannonMapDB-media-failure-${testInfo.project.name}-${Date.now()}`);
  expect(result.count).toBe(1);expect(result.failure).toMatchObject({name:'MediaPersistenceError',code:'MEDIA_PERSISTENCE_FAILED',message:'Photo could not be saved.'});expect(result.failure.diagnostics).toMatchObject({exceptionName:'ConstraintError',objectConstructor:'File',objectType:'File',objectSize:6,mimeType:'image/jpeg',objectStore:'missionMedia'});expect(result.failure.diagnostics.stackTrace).toBeTruthy();expect(result.failure.diagnostics.transactionState).toBeTruthy();
});

test('native original survives an interrupted Evidence workflow and remains project isolated',async({page},testInfo)=>{
  const result=await page.evaluate(async name=>{
    const module=await import('/src/infrastructure/indexeddb/index.js');let database=await module.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name}),number=0;
    let repository=module.createMissionMediaRepository({database,createId:()=>`00000000-0000-4000-8000-${String(++number).padStart(12,'0')}`,clock:{iso:()=> '2026-09-05T12:00:00.000Z'}}),file=new File(['exact-native-camera-bytes'],'native.jpg',{type:'image/jpeg'});
    const original=await repository.addOriginal({projectId:'journey-a',checkpointId:'journey:1',journalEventId:'journal-1',originalFile:file,metadata:{dayNumber:31},identities:{mediaGroupId:'group',originalMediaId:'original',evidenceMediaId:'evidence'}});await repository.markEvidenceFailed(original.mediaId,'memory pressure');database.close();
    database=await module.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name});repository=module.createMissionMediaRepository({database,createId:()=>'',clock:{iso:()=>''}});const own=await repository.listProjectPhotos('journey-a'),other=await repository.listProjectPhotos('journey-b'),all=await repository.listAllPhotos(),text=await own[0].blob.text();database.close();return {text,status:own[0].evidenceStatus,other:other.length,all:all.length,day:own[0].metadata.dayNumber};
  },`CannonMapDB-native-${testInfo.project.name}-${Date.now()}`);
  expect(result).toEqual({text:'exact-native-camera-bytes',status:'failed',other:0,all:1,day:31});
});

test('Project media restore is atomic and duplicate failure leaves no partial Project',async({page},testInfo)=>{
  const result=await page.evaluate(async name=>{const module=await import('/src/infrastructure/indexeddb/index.js'),database=await module.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name}),restore=module.createJourneyRestoreRepository({database});
    await restore.restoreNew({project:{projectId:'p1',name:'One'},journal:[{eventId:'j1',projectId:'p1'}],media:[{mediaId:'m1',projectId:'p1',checkpointId:'c',journalEventId:'j1',blob:new Blob(['native'])}]});let error='';try{await restore.restoreNew({project:{projectId:'p2',name:'Two'},journal:[{eventId:'j2',projectId:'p2'}],media:[{mediaId:'m1',projectId:'p2',checkpointId:'c',journalEventId:'j2',blob:new Blob(['other'])}]});}catch(caught){error=caught.name||caught.code||caught.message;}
    const transaction=database.transaction(['projectRecords','journalEvents','missionMedia'],'readonly'),request=store=>new Promise((resolve,reject)=>{const value=transaction.objectStore(store).get(store==='projectRecords'?'p2':store==='journalEvents'?'j2':'m1');value.onsuccess=()=>resolve(value.result||null);value.onerror=()=>reject(value.error);}),[project,event,media]=await Promise.all([request('projectRecords'),request('journalEvents'),request('missionMedia')]);database.close();return {error,project,event,mediaProjectId:media.projectId};
  },`CannonMapDB-restore-${testInfo.project.name}-${Date.now()}`);expect(result.error).toBeTruthy();expect(result.project).toBeNull();expect(result.event).toBeNull();expect(result.mediaProjectId).toBe('p1');
});
