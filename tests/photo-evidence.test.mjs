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
  assert.equal(calls[0].originalFile,original);assert.equal(calls[0].evidenceBlob,evidence);assert.deepEqual(calls[0].identities,{mediaGroupId:'group',originalMediaId:'original',evidenceMediaId:'evidence'});assert.equal(calls[0].filenames.original,'Day01_CP1.1_Original.jpg');
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
  const original=new Blob(['untouched-camera-bytes'],{type:'image/jpeg'}),stored=[];
  const repository={listCheckpointPhotos:async()=>[],async addOriginal(input){stored.push(input.originalFile);return {mediaId:'original',mediaGroupId:'group',pairedMediaId:'evidence',role:'original',name:'Day01_CP1_Original.jpg',blob:input.originalFile,metadata:input.metadata};},async markEvidenceFailed(){},async getMedia(){return null;}};
  const service=createPhotoEvidenceService({repository,createId:(()=>{const ids=['group','original','evidence'];return()=>ids.shift();})(),inspect:async()=>({width:4032,height:3024}),render:async()=>{throw new Error('canvas memory pressure');}});
  await assert.rejects(()=>service.capture({projectId:'p',checkpointId:'c',journalEventId:'j',file:original,context:{dayNumber:1}}),error=>error.evidenceRetryable&&error.originalMedia.mediaId==='original');
  assert.equal(stored[0],original);assert.equal(await stored[0].text(),'untouched-camera-bytes');
});
