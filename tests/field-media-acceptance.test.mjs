import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PairedMediaCaptureError,
  createPairedMediaCaptureService
} from '../src/application/paired-media-capture-service.js';
import {createCheckpointArrivalCoordinator} from '../src/application/checkpoint-arrival-coordinator.js';
import * as checkpointWorkflow from '../src/domain/checkpoints/workflow.js';

const nativeStill=(camera,label=camera)=>({
  blob:new Blob([`${camera}:${label}:native-original`],{type:'image/jpeg'}),
  provenance:{
    sourceKind:'image-capture-photo',
    nativeStill:true,
    derivedFromVideoFrame:false,
    upscaled:false,
    requestedCamera:camera,
    actualCamera:camera,
    cameraSelectionHonored:true,
    captureMethod:'getUserMedia-imagecapture',
    mimeType:'image/jpeg',
    byteLength:409_600,
    width:4032,
    height:3024
  }
});

test('automatic paired capture is UI-neutral, silent, and never puts binary media in Journal events',async()=>{
  const events=[],persisted=[],calls=[];
  const service=createPairedMediaCaptureService({
    captureStill:async(camera,{onPhase})=>{calls.push(camera);await onPhase('camera_stabilization_started',{stabilizationMs:180});await onPhase('camera_stabilization_completed',{stabilizationMs:180});return nativeStill(camera);},
    photoEvidence:{
      async capture(input){
        persisted.push(input);
        const role=input.context.cameraRole;
        return {
          original:{mediaId:`${role}-original`,role:'original'},
          evidence:{mediaId:`${role}-evidence`,role:'evidence'}
        };
      }
    },
    mediaRepository:{markPairComplete:async()=>{}},
    createId:()=> 'pair-field',
    clock:{iso:()=> '2026-08-13T18:00:00.000Z'}
  });

  const result=await service.capturePair({
    projectId:'project',
    checkpointId:'cp-42',
    journalEventId:'arrival-42',
    onEvent:event=>events.push(event)
  });

  assert.deepEqual(calls,['rear','front'],'road/rear is captured before rider/front');
  assert.equal(result.status,'complete');
  assert.equal(persisted.length,2);
  for(const input of persisted){
    assert.equal(input.file,input.source.blob,'Original input must be the untouched native still Blob');
    assert.equal(input.context.originalSourceProvenance.nativeStill,true);
    assert.equal(input.context.originalSourceProvenance.upscaled,false);
  }
  assert.ok(events.some(event=>event.eventType==='paired_capture_completed'));
  assert.equal(events.filter(event=>event.eventType==='camera_stabilization_started').length,2);
  assert.equal(events.filter(event=>event.eventType==='camera_stabilization_completed').length,2);
  assert.equal(events.filter(event=>event.eventType==='automatic_media_persisted'&&event.originalMediaId&&event.evidenceMediaId).length,2);
  assert.ok(events.every(event=>!('blob' in event)&&!('file' in event)&&!('bytes' in event)),'Journal events contain references/metadata, never image bytes');
  assert.ok(events.every(event=>!/(?:popup|dialog|sound|audio|tone)/i.test(String(event.eventType))),'capture service does not request rider-facing success UI or audio');
});

test('second-side automatic failure preserves the completed road side for a narrow fallback',async()=>{
  const service=createPairedMediaCaptureService({
    captureStill:async camera=>{
      if(camera==='front')throw new Error('front camera denied');
      return nativeStill(camera);
    },
    createId:()=> 'pair-partial'
  });

  await assert.rejects(
    ()=>service.capturePair(),
    error=>{
      assert.ok(error instanceof PairedMediaCaptureError);
      assert.equal(error.failedSide,'rider');
      assert.equal(error.partial.road.cameraRole,'rear');
      assert.equal(error.partial.rider,undefined);
      return true;
    }
  );
});

test('closely spaced out-of-order arrivals are serialized and retain the original active target',async()=>{
  const processed=[];
  const coordinator=createCheckpointArrivalCoordinator({
    dwellMs:0,
    async processArrival(arrival){processed.push(arrival);}
  });

  coordinator.observe({
    observedAt:1_000,
    speedMph:24,
    priorTargetId:'cp-37',
    gpsEvidence:{latitude:38,longitude:-105,accuracyFeet:9},
    detections:[
      {checkpointId:'cp-42',distanceFeet:8,accuracyFeet:9,radiusFeet:100},
      {checkpointId:'cp-43',distanceFeet:12,accuracyFeet:9,radiusFeet:100}
    ]
  });
  await coordinator.whenIdle();

  assert.deepEqual(processed.map(event=>event.checkpointId),['cp-42','cp-43']);
  assert.ok(processed.every(event=>event.priorTargetId==='cp-37'&&event.outOfOrder));
  assert.ok(processed.every(event=>event.speedMph===24));
});

test('camera-unavailable policy credits truthfully and preserves a prior active target without fake media',()=>{
  for(const disposition of ['camera_unavailable_high_speed','manual_fallback_expired']){
    const prior=checkpointWorkflow.normalizeCheckpoint({id:'cp-37',name:'CP 37',type:'checkpoint',day:1,sequence:1,status:'active',photoRequired:true});
    const detected=checkpointWorkflow.normalizeCheckpoint({id:'cp-42',name:'CP 42',type:'checkpoint',day:1,sequence:2,status:'upcoming',photoRequired:true});
    const rows=[prior,detected];
    checkpointWorkflow.recordDetectedArrival(detected,'2026-08-13T18:00:00.000Z');
    const next=checkpointWorkflow.completeCheckpoint(rows,detected,'2026-08-13T18:00:02.000Z',{
      photoDisposition:disposition,
      preserveActiveTarget:true
    });
    assert.equal(detected.status,checkpointWorkflow.CHECKPOINT_STATE.COLLECTED);
    assert.equal(detected.photoStatus,disposition);
    assert.equal(detected.photoFailureDisposition,disposition);
    assert.equal(detected.photoPair,undefined,'failure policy must not fabricate a media pair');
    assert.equal(next,prior);
    assert.equal(prior.status,checkpointWorkflow.CHECKPOINT_STATE.ACTIVE);
  }
});
