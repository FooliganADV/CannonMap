import test from 'node:test';
import assert from 'node:assert/strict';
import {assessNativeStillQuality,createPairedMediaCaptureService,selectBestNativeStill} from '../src/application/paired-media-capture-service.js';

const still=(camera,{width=4032,height=3024,size=300_000,label=camera}={})=>({blob:new Blob([new Uint8Array(size)],{type:'image/jpeg'}),tracksStopped:true,provenance:{sourceKind:'image-capture-photo',nativeStill:true,derivedFromVideoFrame:false,upscaled:false,requestedCamera:camera,actualCamera:camera,cameraSelectionHonored:true,captureMethod:'getUserMedia-imagecapture',mimeType:'image/jpeg',byteLength:size,width,height,label}});

test('paired service captures road then rider and leaves durable pair completion to the checkpoint workflow',async()=>{
  const captureOrder=[],persisted=[],events=[],completed=[];
  const captureStill=async camera=>{captureOrder.push(camera);return still(camera);};
  const photoEvidence={capture:async input=>{persisted.push(input);return {original:{mediaId:`${input.context.cameraRole}-original`},evidence:{mediaId:`${input.context.cameraRole}-evidence`}};}};
  const service=createPairedMediaCaptureService({captureStill,photoEvidence,mediaRepository:{markPairComplete:async(...args)=>completed.push(args)},createId:()=> 'pair-1',clock:{iso:()=> '2026-08-13T12:00:00Z'}});
  const result=await service.capturePair({projectId:'p',checkpointId:'cp',journalEventId:'j',onEvent:event=>events.push(event)});
  assert.deepEqual(captureOrder,['rear','front']);assert.deepEqual(completed,[],'the service must not race the checkpoint workflow for markPairComplete');assert.equal(result.status,'complete');
  assert.equal(persisted[0].file,persisted[0].source.blob);assert.equal(persisted[0].context.cameraRole,'rear');assert.equal(persisted[1].context.cameraRole,'front');
  assert.equal(persisted[0].context.originalSourceProvenance.nativeStill,true);
  assert.ok(events.some(event=>event.eventType==='automatic_primary_capture'));assert.ok(events.some(event=>event.eventType==='paired_capture_completed'));
  assert.ok(events.every(event=>!('blob'in event)));
});

test('quality retry occurs at most once and replaces only a clearly poor primary',async()=>{
  const responses={rear:[still('rear',{width:640,height:480,size:10_000,label:'poor'}),still('rear',{width:4032,height:3024,size:400_000,label:'good'})],front:[still('front')]},calls=[];
  const service=createPairedMediaCaptureService({captureStill:async camera=>{calls.push(camera);return responses[camera].shift();},createId:()=> 'pair'});
  const result=await service.capturePair();
  assert.deepEqual(calls,['rear','rear','front']);assert.equal(result.road.capture.provenance.label,'good');assert.equal(result.road.quality.backupAttempted,true);assert.equal(result.rider.quality.backupAttempted,false);
});

test('indeterminate quality retains the primary without destructive guessing',()=>{
  const first={blob:new Blob(['first']),provenance:{nativeStill:true,byteLength:5}},second={blob:new Blob(['second']),provenance:{nativeStill:true,byteLength:6}};
  assert.equal(assessNativeStillQuality(first).poor,false);
  assert.equal(selectBestNativeStill(first,second).selected,first);
});

test('synthetic video-frame captures cannot become automatic Originals',async()=>{
  const service=createPairedMediaCaptureService({captureStill:async camera=>({blob:new Blob(['frame']),provenance:{sourceKind:'video-frame',nativeStill:false,derivedFromVideoFrame:true,requestedCamera:camera}}),createId:()=> 'pair'});
  await assert.rejects(()=>service.capturePair(),error=>error.code==='PAIRED_MEDIA_CAPTURE_FAILED'&&error.failedSide==='road');
});

test('Evidence failure propagates a recoverable detached Original without treating it as a complete side',async()=>{
  const preserved={mediaId:'rear-original',pairId:null,pairStatus:'abandoned',evidenceStatus:'failed'};
  const evidenceError=Object.assign(new Error('Evidence render failed.'),{originalMedia:preserved,evidenceRetryable:true,originalPreserved:true});
  const service=createPairedMediaCaptureService({
    captureStill:async camera=>still(camera),
    photoEvidence:{capture:async()=>{throw evidenceError;}},
    createId:()=> 'pair-evidence-failure'
  });
  await assert.rejects(()=>service.capturePair(),error=>{
    assert.equal(error.code,'PAIRED_MEDIA_CAPTURE_FAILED');
    assert.equal(error.failedSide,'road');
    assert.deepEqual(error.partial,{},'an Original without Evidence is not a complete restorable side');
    assert.equal(error.cause.originalMedia,preserved);
    assert.equal(error.recoverableOriginal,preserved);
    assert.equal(error.evidenceRetryable,true);
    return true;
  });
});

test('cleanup uncertainty propagates a new-pair requirement to manual fallback',async()=>{
  const preserved={mediaId:'rear-original',pairId:null,pairedMediaId:null,pairStatus:'abandoned'};
  const evidenceError=Object.assign(new Error('Evidence cleanup failed.'),{originalMedia:preserved,evidenceRetryable:true,originalDurablyDetached:false,requiresNewPair:true,cleanupErrors:[{operation:'detach-original'}]});
  const service=createPairedMediaCaptureService({captureStill:async camera=>still(camera),photoEvidence:{capture:async()=>{throw evidenceError;}},createId:()=> 'unsafe-pair'});
  await assert.rejects(()=>service.capturePair(),error=>{
    assert.equal(error.requiresNewPair,true);assert.equal(error.originalDurablyDetached,false);assert.equal(error.recoverableOriginal,preserved);assert.deepEqual(error.cleanupErrors,[{operation:'detach-original'}]);return true;
  });
});
