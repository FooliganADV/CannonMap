import test from 'node:test';
import assert from 'node:assert/strict';
import {assessNativeStillQuality,createPairedMediaCaptureService,isNativeCameraCaptureFailure,selectBestNativeStill} from '../src/application/paired-media-capture-service.js';

const still=(camera,{width=4032,height=3024,size=300_000,label=camera}={})=>({blob:new Blob([new Uint8Array(size)],{type:'image/jpeg'}),tracksStopped:true,provenance:{sourceKind:'image-capture-photo',nativeStill:true,derivedFromVideoFrame:false,upscaled:false,requestedCamera:camera,actualCamera:camera,cameraSelectionHonored:true,captureMethod:'getUserMedia-imagecapture',mimeType:'image/jpeg',byteLength:size,width,height,label}});

test('paired service captures road then rider and leaves durable pair completion to the checkpoint workflow',async()=>{
  const captureOrder=[],captureTypes=[],persisted=[],events=[],completed=[];
  const captureStill=async(camera,options)=>{captureOrder.push(camera);captureTypes.push(options.captureType);return still(camera);};
  const photoEvidence={capture:async input=>{persisted.push(input);return {original:{mediaId:`${input.context.cameraRole}-original`},evidence:{mediaId:`${input.context.cameraRole}-evidence`}};}};
  const service=createPairedMediaCaptureService({captureStill,photoEvidence,mediaRepository:{markPairComplete:async(...args)=>completed.push(args)},createId:()=> 'pair-1',clock:{iso:()=> '2026-08-13T12:00:00Z'}});
  const result=await service.capturePair({projectId:'p',checkpointId:'cp',journalEventId:'j',onEvent:event=>events.push(event)});
  assert.deepEqual(captureOrder,['rear','front']);assert.deepEqual(captureTypes,['checkpoint_evidence','checkpoint_evidence']);assert.deepEqual(completed,[],'the service must not race the checkpoint workflow for markPairComplete');assert.equal(result.status,'complete');
  assert.equal(persisted[0].file,persisted[0].source.blob);assert.equal(persisted[0].context.cameraRole,'rear');assert.equal(persisted[1].context.cameraRole,'front');
  assert.equal(persisted[0].context.originalSourceProvenance.nativeStill,true);
  assert.ok(events.some(event=>event.eventType==='automatic_primary_capture'));assert.ok(events.some(event=>event.eventType==='paired_capture_completed'));
  assert.ok(events.every(event=>!('blob'in event)));
});

test('quality retry occurs at most once and replaces only a clearly poor primary',async()=>{
  const responses={rear:[still('rear',{width:640,height:480,size:10_000,label:'poor'}),still('rear',{width:4032,height:3024,size:400_000,label:'good'})],front:[still('front')]},calls=[],captureTypes=[];
  const service=createPairedMediaCaptureService({captureStill:async(camera,options)=>{calls.push(camera);captureTypes.push(options.captureType);return responses[camera].shift();},createId:()=> 'pair'});
  const result=await service.capturePair();
  assert.deepEqual(calls,['rear','rear','front']);assert.deepEqual(captureTypes,['checkpoint_evidence','checkpoint_evidence','checkpoint_evidence']);assert.equal(result.road.capture.provenance.label,'good');assert.equal(result.road.quality.backupAttempted,true);assert.equal(result.rider.quality.backupAttempted,false);
});

test('indeterminate quality retains the primary without destructive guessing',()=>{
  const first={blob:new Blob(['first']),provenance:{nativeStill:true,byteLength:5}},second={blob:new Blob(['second']),provenance:{nativeStill:true,byteLength:6}};
  assert.equal(assessNativeStillQuality(first).poor,false);
  assert.equal(selectBestNativeStill(first,second).selected,first);
});

test('synthetic video-frame captures cannot become automatic Originals',async()=>{
  const degraded={blob:new Blob(['frame']),provenance:{sourceKind:'fallback-video-frame',nativeStill:false,derivedFromVideoFrame:true,requestedCamera:'rear',recoveryPath:'fallback-video-frame-after-native-retry',nativeRetryCount:1}},persisted=[],events=[];
  const service=createPairedMediaCaptureService({captureStill:async()=>degraded,photoEvidence:{capture:async input=>persisted.push(input)},createId:()=> 'pair'});
  await assert.rejects(()=>service.capturePair({onEvent:event=>events.push(event)}),error=>{
    assert.equal(error.code,'PAIRED_MEDIA_CAPTURE_FAILED');assert.equal(error.failedSide,'road');assert.equal(error.failureStage,'camera-capture');
    assert.equal(error.degradedCapture,degraded);assert.equal(error.degradedCaptures.road,degraded);return true;
  });
  assert.equal(persisted.length,0,'fallback video frames must never enter checkpoint Evidence persistence');
  const event=events.find(item=>item.eventType==='automatic_degraded_capture_rejected');assert.deepEqual(event&&{side:event.side,sourceKind:event.sourceKind,nativeStill:event.nativeStill,recoveryPath:event.recoveryPath,nativeRetryCount:event.nativeRetryCount},{side:'road',sourceKind:'fallback-video-frame',nativeStill:false,recoveryPath:'fallback-video-frame-after-native-retry',nativeRetryCount:1});assert.ok(!('blob'in event));
});

test('an explicit wrong-camera native JPEG cannot enter automatic checkpoint Evidence',async()=>{
  const wrong=still('rear');Object.assign(wrong.provenance,{actualCamera:'front',cameraSelectionHonored:false});const persisted=[];
  const service=createPairedMediaCaptureService({captureStill:async()=>wrong,photoEvidence:{capture:async input=>persisted.push(input)},createId:()=> 'wrong-camera-pair'});
  await assert.rejects(()=>service.capturePair(),error=>error.code==='PAIRED_MEDIA_CAPTURE_FAILED'&&error.failureStage==='camera-capture');
  assert.equal(persisted.length,0);
});

test('front fallback preserves the durable native rear side but cannot complete checkpoint Evidence',async()=>{
  const fallback={blob:new Blob(['front-frame']),provenance:{sourceKind:'fallback-video-frame',nativeStill:false,derivedFromVideoFrame:true,requestedCamera:'front',actualCamera:'front',recoveryPath:'fallback-video-frame-after-native-retry',nativeRetryCount:1}},persisted=[];
  const service=createPairedMediaCaptureService({captureStill:async camera=>camera==='rear'?still('rear'):fallback,photoEvidence:{capture:async input=>{persisted.push(input);return {original:{mediaId:`${input.context.cameraRole}-original`},evidence:{mediaId:`${input.context.cameraRole}-evidence`}};}},createId:()=> 'pair-front-fallback'});
  await assert.rejects(()=>service.capturePair(),error=>{
    assert.equal(error.failedSide,'rider');assert.equal(error.degradedCaptures.rider,fallback);assert.equal(error.partial.road.media.original.mediaId,'rear-original');return true;
  });
  assert.deepEqual(persisted.map(item=>item.context.cameraRole),['rear'],'front fallback must not be persisted through photoEvidence');
});

test('a recovered native still suppresses the legacy poor-quality backup capture',async()=>{
  const recovered=still('rear',{width:640,height:480,size:10_000,label:'recovered-poor'});Object.assign(recovered.provenance,{recoveryPath:'native-retry-success',nativeRetryCount:1});
  const calls=[],events=[],service=createPairedMediaCaptureService({captureStill:async camera=>{calls.push(camera);return camera==='rear'?recovered:still('front');},createId:()=> 'pair-recovered'});
  const result=await service.capturePair({onEvent:event=>events.push(event)});
  assert.deepEqual(calls,['rear','front'],'the recovery retry already consumed the bounded second HAL attempt');assert.equal(result.road.quality.backupAttempted,false);
  assert.ok(events.some(event=>event.eventType==='automatic_quality_backup_suppressed'&&event.side==='road'&&event.nativeRetryCount===1&&event.recoveryPath==='native-retry-success'));
});

test('native camera errors are distinguished from media persistence errors',async()=>{
  const denied=new DOMException('Camera permission denied.','NotAllowedError');
  const captureService=createPairedMediaCaptureService({captureStill:async()=>{throw denied;},createId:()=> 'pair-camera'});
  await assert.rejects(()=>captureService.capturePair(),error=>isNativeCameraCaptureFailure(error)&&error.cause.cause===denied);

  const storageFailure=Object.assign(new Error('IndexedDB quota exceeded.'),{code:'MEDIA_STORAGE_FAILED'});
  const persistenceService=createPairedMediaCaptureService({captureStill:async camera=>still(camera),photoEvidence:{capture:async()=>{throw storageFailure;}},createId:()=> 'pair-storage'});
  await assert.rejects(()=>persistenceService.capturePair(),error=>!isNativeCameraCaptureFailure(error)&&error.failureStage==='media-persistence'&&error.cause.cause===storageFailure);
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
    assert.equal(error.failureStage,'media-persistence');
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
