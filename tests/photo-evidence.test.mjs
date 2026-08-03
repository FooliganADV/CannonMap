import test from 'node:test';import assert from 'node:assert/strict';
import {buildPhotoEvidenceMetadata,createPhotoEvidenceService,photoEvidenceOverlayEntries} from '../src/application/photo-evidence-service.js';
import {checkpointPhotoFilename,createStoredZip} from '../src/application/photo-export-service.js';

test('evidence metadata renders authoritative values and marks missing values unavailable',()=>{
  const metadata=buildPhotoEvidenceMetadata({eventName:'America 250 ADV Cannonball',rallyName:'Mandeville',dayNumber:1,checkpointName:'Balcony',checkpointNumber:'1.1',points:10,capturedAt:'2026-08-03T17:00:00.000Z',latitude:30.401324,longitude:-90.120646,journalEventId:'event-1',mediaId:'media-1'});
  assert.equal(metadata.latitude,'30.40132');assert.equal(metadata.longitude,'-90.12065');assert.equal(metadata.elevation,'Unavailable');assert.equal(metadata.temperature,'Unavailable');assert.equal(metadata.gpsAccuracy,'Unavailable');assert.equal(metadata.journalEventId,'event-1');
  assert.deepEqual(photoEvidenceOverlayEntries(metadata).map(([label])=>label),['Rally','Day','Checkpoint','Points','Captured','Coordinates','Elevation','Temperature','GPS Accuracy','Heading','Travel Direction','Media ID','Journal Event ID']);
});

test('capture preserves the original object and persists one generated evidence copy',async()=>{
  const calls=[],ids=['group','original','evidence'],repository={async addEvidencePair(input){calls.push(input);return input;}};
  const original={name:'camera.jpg',type:'image/jpeg',size:4},evidence=new Blob(['rendered'],{type:'image/jpeg'});
  const service=createPhotoEvidenceService({repository,createId:()=>ids.shift(),render:async(file,metadata)=>{assert.equal(file,original);assert.equal(metadata.mediaId,'group');return evidence;}});
  await service.capture({projectId:'project',checkpointId:'cp',journalEventId:'event',file:original,context:{dayNumber:1,checkpointNumber:'1.1',capturedAt:'2026-08-03T17:00:00.000Z'}});
  assert.equal(calls[0].originalFile,original);assert.equal(calls[0].evidenceBlob,evidence);assert.deepEqual(calls[0].identities,{mediaGroupId:'group',originalMediaId:'original',evidenceMediaId:'evidence'});assert.equal(calls[0].filenames.original,'Day01_CP1.1_Original.jpg');
});

test('photo export names are stable and generated archives are valid ZIP containers',async()=>{
  assert.equal(checkpointPhotoFilename({dayNumber:1,checkpointNumber:'1.1',role:'original'}),'Day01_CP1.1_Original.jpg');
  const zip=await createStoredZip([{name:'Day01_CP1.1_Original.jpg',blob:new Blob(['original'])},{name:'Day01_CP1.1_Evidence.jpg',blob:new Blob(['evidence'])}]);
  const bytes=new Uint8Array(await zip.arrayBuffer());assert.deepEqual([...bytes.slice(0,4)],[0x50,0x4b,0x03,0x04]);assert.equal(zip.type,'application/zip');
});
