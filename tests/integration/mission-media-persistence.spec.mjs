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
  expect(result.version).toBe(9);expect(result.reference.uri).toMatch(/^media:\/\//);
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
