import test from 'node:test';import assert from 'node:assert/strict';
import {buildPhotoEvidenceMetadata,createPhotoEvidenceService,photoEvidenceOverlayEntries,readImageDimensions,renderEvidenceJpeg} from '../src/application/photo-evidence-service.js';
import {checkpointPhotoFilename,createStoredZip} from '../src/application/photo-export-service.js';

test('evidence metadata renders authoritative values and marks missing values unavailable',()=>{
  const metadata=buildPhotoEvidenceMetadata({eventName:'America 250 ADV Cannonball',objectiveType:'checkpoint',rallyName:'Mandeville',dayNumber:1,checkpointName:'Balcony',checkpointNumber:'1.1',points:10,capturedAt:'2026-08-03T17:00:00.000Z',latitude:30.401324,longitude:-90.120646,journalEventId:'event-1',mediaId:'media-1',requestedCamera:'front',actualCamera:'unknown',cameraSelectionHonored:'unknown'});
  assert.equal(metadata.latitude,'30.40132');assert.equal(metadata.longitude,'-90.12065');assert.equal(metadata.objectiveType,'checkpoint');assert.equal(metadata.elevation,'Unavailable');assert.equal(metadata.temperature,'Unavailable');assert.equal(metadata.gpsAccuracy,'Unavailable');assert.equal(metadata.journalEventId,'event-1');assert.equal(metadata.requestedCamera,'front');assert.equal(metadata.actualCamera,'unknown');assert.equal(metadata.cameraSelectionHonored,'unknown');assert.equal(metadata.captureMethod,'file-input');assert.equal(metadata.captureTimestamp,'2026-08-03T17:00:00.000Z');
  assert.deepEqual(photoEvidenceOverlayEntries(metadata).map(([label])=>label),['Rally','Day','Checkpoint','Camera Role','Points','Captured','Coordinates','Elevation','Temperature','Weather','Speed / Motion','GPS Accuracy','GPS Sample','Heading','Travel Direction','Pair ID','Media ID','Journal Event ID']);
});

test('capture preserves the original object and persists one generated evidence copy',async()=>{
  const calls=[],ids=['group','original','evidence'],repository={async addEvidencePair(input){calls.push(input);return input;}};
  const original={name:'camera.jpg',type:'image/jpeg',size:4},evidence=new Blob(['rendered'],{type:'image/jpeg'});
  const service=createPhotoEvidenceService({repository,createId:()=>ids.shift(),inspect:async()=>({width:1,height:1}),render:async(file,metadata)=>{assert.equal(file,original);assert.equal(metadata.mediaId,'group');return evidence;}});
  await service.capture({projectId:'project',checkpointId:'cp',journalEventId:'event',file:original,context:{dayNumber:1,checkpointNumber:'1.1',capturedAt:'2026-08-03T17:00:00.000Z'}});
  assert.equal(calls[0].originalFile,original);assert.equal(calls[0].evidenceBlob,evidence);assert.deepEqual(calls[0].identities,{mediaGroupId:'group',originalMediaId:'original',evidenceMediaId:'evidence'});assert.equal(calls[0].filenames.original,'Day01_1.1_cp_Original.jpg');
});

test('stored checkpoint media filenames identify the imported objective and stable checkpoint id',async()=>{const calls=[],ids=['group','original','evidence'],service=createPhotoEvidenceService({repository:{async addEvidencePair(input){calls.push(input);return input;}},createId:()=>ids.shift(),inspect:async()=>({width:1,height:1}),render:async()=>new Blob(['evidence'],{type:'image/jpeg'})});await service.capture({projectId:'p',checkpointId:'uuid-r02-dirt',journalEventId:'j',file:new Blob(['original'],{type:'image/jpeg'}),context:{dayNumber:1,checkpointName:'R02 DIRT',checkpointNumber:'2',cameraRole:'front',capturedAt:'2026-08-21T15:00:00Z'}});assert.equal(calls[0].filenames.original,'Day01_R02-DIRT_uid-r02-dirt_Front_Original.jpg');assert.equal(calls[0].filenames.evidence,'Day01_R02-DIRT_uid-r02-dirt_Front_Evidence.jpg');});

test('checkpoint filename suffixes apply only to a real same-session camera-role collision',async()=>{const stored=[],ids=['g1','o1','e1','g2','o2','e2','g3','o3','e3'],repository={async listCheckpointPhotos(){return stored;},async addEvidencePair(input){stored.push({role:'original',cameraRole:input.metadata.cameraRole,sessionId:input.metadata.sessionId,name:input.filenames.original});return input;}},service=createPhotoEvidenceService({repository,createId:()=>ids.shift(),inspect:async()=>({width:1,height:1}),render:async()=>new Blob(['evidence'],{type:'image/jpeg'})}),capture=cameraRole=>service.capture({projectId:'p',checkpointId:'r02-dirt',journalEventId:`j-${cameraRole}`,file:new Blob(['original'],{type:'image/jpeg'}),context:{dayNumber:1,checkpointName:'R02 DIRT',cameraRole,sessionId:'run-1'}});const front=await capture('front'),rear=await capture('rear'),frontRetry=await capture('front');assert.equal(front.filenames.original,'Day01_R02-DIRT_r02-dirt_Front_Original.jpg');assert.equal(rear.filenames.original,'Day01_R02-DIRT_r02-dirt_Rear_Original.jpg');assert.equal(frontRetry.filenames.original,'Day01_R02-DIRT_r02-dirt_Front_02_Original.jpg');});

test('capture preserves immutable rally session identity in persisted Original and Evidence metadata',async()=>{
  const calls=[],ids=['group','original','evidence'],repository={async addEvidencePair(input){calls.push(input);return input;}};
  const service=createPhotoEvidenceService({repository,createId:()=>ids.shift(),inspect:async()=>({width:1,height:1}),render:async()=>new Blob(['evidence'],{type:'image/jpeg'})});
  await service.capture({projectId:'project',checkpointId:'cp',journalEventId:'event',file:new Blob(['original'],{type:'image/jpeg'}),context:{
    dayNumber:1,checkpointNumber:'1.1',capturedAt:'2026-08-18T17:37:42.123Z',sessionId:'session-aug18-run2',sessionRunNumber:2,sessionCalendarDate:'2026-08-18',sessionStartedAt:'2026-08-18T13:00:00.000Z'
  }});
  assert.deepEqual({sessionId:calls[0].metadata.sessionId,run:calls[0].metadata.sessionRunNumber,date:calls[0].metadata.sessionCalendarDate,started:calls[0].metadata.sessionStartTimestamp},{
    sessionId:'session-aug18-run2',run:2,date:'2026-08-18',started:'2026-08-18T13:00:00.000Z'
  });
});

test('photo export names are stable and generated archives are valid ZIP containers',async()=>{
  assert.equal(checkpointPhotoFilename({dayNumber:1,checkpointNumber:'1.1',role:'original'}),'Day01_CP1.1_Original.jpg');
  const zip=await createStoredZip([{name:'Day01_CP1.1_Original.jpg',blob:new Blob(['original'])},{name:'Day01_CP1.1_Evidence.jpg',blob:new Blob(['evidence'])}]);
  const bytes=new Uint8Array(await zip.arrayBuffer());assert.deepEqual([...bytes.slice(0,4)],[0x50,0x4b,0x03,0x04]);assert.equal(zip.type,'application/zip');
});

test('native-resolution evidence keeps source dimensions',async()=>{
  const previous=globalThis.createImageBitmap;globalThis.createImageBitmap=async()=>({width:4032,height:3024,close(){}});let dimensions=null;
  const canvas={width:0,height:0,getContext:()=>({drawImage(){},fillRect(){},fillText(){},set fillStyle(_){},set textBaseline(_){},set font(_){},set textAlign(_){}}),toBlob(callback){dimensions={width:this.width,height:this.height};callback(new Blob(['jpeg'],{type:'image/jpeg'}));}};
  try{await renderEvidenceJpeg(new Blob(['native']),buildPhotoEvidenceMetadata({}),{canvasFactory:()=>canvas});assert.deepEqual(dimensions,{width:4032,height:3024});}finally{globalThis.createImageBitmap=previous;}
});

test('WebKit createImageBitmap rejection falls back to HTML image decoding',async()=>{
  const previousBitmap=globalThis.createImageBitmap,previousImage=globalThis.Image;
  globalThis.createImageBitmap=async()=>{throw new DOMException('An error occured reading the Blob argument to createImageBitmap','InvalidStateError');};
  globalThis.Image=class{constructor(){this.width=4032;this.height=3024;}set src(_){queueMicrotask(()=>this.onload?.());}};
  try{assert.deepEqual(await readImageDimensions(new Blob(['camera'],{type:'image/jpeg'})),{width:4032,height:3024});}finally{globalThis.createImageBitmap=previousBitmap;globalThis.Image=previousImage;}
});

test('evidence failure preserves the untouched original for later retry',async()=>{
  const original=new Blob(['untouched-camera-bytes'],{type:'image/jpeg'}),stored=[],abandoned=[];
  const detached={mediaId:'original',mediaGroupId:'group',pairId:null,pairStatus:'abandoned',pairedMediaId:null,evidenceStatus:'failed',role:'original',name:'Day01_CP1_Original.jpg',blob:original};
  const repository={listCheckpointPhotos:async()=>[],async addOriginal(input){stored.push(input.originalFile);return {mediaId:'original',mediaGroupId:'group',pairId:'pair-1',pairedMediaId:'evidence',role:'original',name:'Day01_CP1_Original.jpg',blob:input.originalFile,metadata:input.metadata};},async markEvidenceFailed(){},async abandonIncompleteOriginal(mediaId,error){abandoned.push({mediaId,error});return detached;},async getMedia(){return null;}};
  const service=createPhotoEvidenceService({repository,createId:(()=>{const ids=['group','original','evidence'];return()=>ids.shift();})(),inspect:async()=>({width:4032,height:3024}),render:async()=>{throw new Error('canvas memory pressure');}});
  await assert.rejects(()=>service.capture({projectId:'p',checkpointId:'c',journalEventId:'j',file:original,context:{dayNumber:1,pairId:'pair-1'}}),error=>error.evidenceRetryable&&error.originalMedia===detached&&error.originalMedia.pairId===null);
  assert.deepEqual(abandoned,[{mediaId:'original',error:'canvas memory pressure'}]);
  assert.equal(stored[0],original);assert.equal(await stored[0].text(),'untouched-camera-bytes');
});

test('cleanup write failures still expose a detached untouched Original and quarantine the pair',async()=>{
  const originalBlob=new Blob(['native-original'],{type:'image/jpeg'}),evidenceBlob=new Blob(['bad-evidence'],{type:'image/jpeg'}),calls=[];
  const original={mediaId:'original',mediaGroupId:'group',pairId:'capture-pair',pairedMediaId:'evidence',pairStatus:'pending',role:'original',name:'Original.jpg',blob:originalBlob,metadata:{pairId:'capture-pair'}};
  const repository={
    listCheckpointPhotos:async()=>[],async addOriginal(){return original;},async addEvidence(){return {...original,mediaId:'evidence',role:'evidence',blob:evidenceBlob,pairedMediaId:'original'};},
    async abandonIncompleteOriginal(){calls.push('detach');throw new Error('detach write failed');},async discardEvidence(){calls.push('discard');throw new Error('discard write failed');},async markEvidenceFailed(){calls.push('mark');throw new Error('mark write failed');}
  };
  const service=createPhotoEvidenceService({repository,createId:(()=>{const ids=['group','original','evidence'];return()=>ids.shift();})(),inspect:async blob=>{if(blob===evidenceBlob)throw new Error('evidence decode failed');return {width:4032,height:3024};},render:async()=>evidenceBlob});
  await assert.rejects(()=>service.capture({projectId:'p',checkpointId:'c',journalEventId:'j',file:originalBlob,context:{dayNumber:1,pairId:'capture-pair'}}),error=>{
    assert.equal(error.originalMedia.mediaId,'original');assert.equal(error.originalMedia.pairId,null);assert.equal(error.originalMedia.pairedMediaId,null);assert.equal(error.originalMedia.metadata.pairId,null);assert.equal(error.originalMedia.metadata.abandonedPairId,'capture-pair');
    assert.equal(error.originalDurablyDetached,false);assert.equal(error.originalPreserved,true);assert.equal(error.evidenceRetryable,true);assert.equal(error.requiresNewPair,true);
    assert.deepEqual(error.cleanupErrors.map(item=>item.operation),['detach-original','discard-evidence','mark-evidence-failed']);assert.equal(error.originalMedia.blob,originalBlob);return true;
  });
  assert.deepEqual(calls,['detach','discard','mark']);assert.equal(await originalBlob.text(),'native-original');
});

test('a detached preserved Original can regenerate Evidence without rejoining the failed capture pair',async()=>{
  const original={mediaId:'original',mediaGroupId:'group',pairId:null,pairStatus:'abandoned',pairedMediaId:null,evidenceStatus:'failed',role:'original',name:'Day01_CP1_Original.jpg',blob:new Blob(['untouched-camera-bytes'],{type:'image/jpeg'}),metadata:{pairId:null,pairStatus:'abandoned',abandonedPairId:'failed-pair'}};
  let added=null;
  const repository={async getMedia(){return original;},async addEvidence(input){added=input;return {...original,mediaId:input.evidenceMediaId,role:'evidence',name:input.filename,blob:input.evidenceBlob,pairedMediaId:original.mediaId,evidenceStatus:'complete'};}};
  const service=createPhotoEvidenceService({repository,createId:()=> 'retry-evidence',inspect:async()=>({width:4032,height:3024}),render:async()=>new Blob(['regenerated-evidence'],{type:'image/jpeg'})});
  const evidence=await service.retryEvidence('original');
  assert.equal(added.original,original);assert.equal(added.evidenceMediaId,'retry-evidence');assert.equal(added.original.pairId,null);assert.equal(evidence.role,'evidence');
});

test('native source provenance follows the untouched Original and Evidence remains independent',async()=>{
  const original=new Blob(['native-high-resolution'],{type:'image/jpeg'}),evidence=new Blob(['derived-evidence'],{type:'image/jpeg'}),calls=[];
  const repository={listCheckpointPhotos:async()=>[],async addOriginal(input){calls.push(['original',input]);return {mediaId:'o',mediaGroupId:'g',pairedMediaId:'e',role:'original',name:input.filenames.original,blob:input.originalFile,sourceProvenance:input.sourceProvenance};},async addEvidence({original:evidenceOriginal,evidenceBlob}){calls.push(['evidence',evidenceOriginal,evidenceBlob]);return {mediaId:'e',mediaGroupId:'g',pairedMediaId:'o',role:'evidence',name:'Evidence.jpg',blob:evidenceBlob,sourceProvenance:{sourceKind:'evidence-derivative'}};}};
  const provenance={sourceKind:'image-capture-photo',nativeStill:true,derivedFromVideoFrame:false,upscaled:false,mimeType:'image/jpeg',byteLength:original.size,width:4032,height:3024};
  const service=createPhotoEvidenceService({repository,createId:(()=>{const ids=['g','o','e'];return()=>ids.shift();})(),inspect:async blob=>blob===original?{width:4032,height:3024}:{width:1920,height:1440},render:async()=>evidence});
  const result=await service.capture({projectId:'p',checkpointId:'c',journalEventId:'j',source:{blob:original,provenance},context:{dayNumber:1}});
  assert.equal(calls[0][1].originalFile,original);assert.equal(calls[1][2],evidence);assert.notEqual(calls[1][2],original);
  assert.deepEqual(result.original.sourceProvenance,provenance);assert.equal(result.evidence.sourceProvenance.sourceKind,'evidence-derivative');
});

test('canvas or video frames are rejected as Original media',async()=>{
  const service=createPhotoEvidenceService({repository:{},createId:()=> 'id',inspect:async()=>({width:1,height:1})});
  await assert.rejects(()=>service.capture({projectId:'p',checkpointId:'c',journalEventId:'j',source:{blob:new Blob(['frame'],{type:'image/jpeg'}),provenance:{sourceKind:'video-frame',derivedFromVideoFrame:true}},context:{}}),/cannot be stored as Original/);
});
