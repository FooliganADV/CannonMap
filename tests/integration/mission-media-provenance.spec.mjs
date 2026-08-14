import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>page.goto('/'));

test('native Original provenance and bytes remain independent from Evidence',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop');
  const result=await page.evaluate(async name=>{
    const module=await import('/src/infrastructure/indexeddb/index.js'),database=await module.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name});let id=0;
    const repository=module.createMissionMediaRepository({database,createId:()=>`media-${++id}`,clock:{iso:()=> '2026-08-13T12:00:00Z'}}),nativeBytes=new Uint8Array([255,216,10,20,30,255,217]),evidenceBytes=new Uint8Array([255,216,90,80,70,255,217]);
    const originalFile=new File([nativeBytes],'native-camera.jpg',{type:'image/jpeg'}),provenance={sourceKind:'image-capture-photo',nativeStill:true,derivedFromVideoFrame:false,upscaled:false,width:4032,height:3024,mimeType:'image/jpeg',byteLength:nativeBytes.length};
    const original=await repository.addOriginal({projectId:'p',checkpointId:'cp',journalEventId:'j',originalFile,metadata:{imageWidth:4032,imageHeight:3024,originalSourceProvenance:provenance},identities:{mediaGroupId:'group',originalMediaId:'original',evidenceMediaId:'evidence'},sourceProvenance:provenance});
    await repository.addEvidence({original,evidenceBlob:new Blob([evidenceBytes],{type:'image/jpeg'}),filename:'Evidence.jpg',evidenceMediaId:'evidence'});
    const rows=await repository.listCheckpointPhotos('p','cp'),source=rows.find(row=>row.role==='original'),derived=rows.find(row=>row.role==='evidence'),answer={originalBytes:[...new Uint8Array(await source.blob.arrayBuffer())],evidenceBytes:[...new Uint8Array(await derived.blob.arrayBuffer())],originalProvenance:source.sourceProvenance,evidenceProvenance:derived.sourceProvenance,derivedFromMediaId:derived.derivedFromMediaId};database.close();return answer;
  },`CannonMapDB-provenance-${Date.now()}`);
  expect(result.originalBytes).toEqual([255,216,10,20,30,255,217]);expect(result.evidenceBytes).toEqual([255,216,90,80,70,255,217]);
  expect(result.originalProvenance).toMatchObject({sourceKind:'image-capture-photo',nativeStill:true,upscaled:false,width:4032,height:3024});
  expect(result.evidenceProvenance).toMatchObject({sourceKind:'evidence-derivative',nativeStill:false,derivedFromMediaId:'original'});expect(result.derivedFromMediaId).toBe('original');
});
