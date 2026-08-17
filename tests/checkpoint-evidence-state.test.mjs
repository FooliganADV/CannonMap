import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHECKPOINT_ARRIVAL_STATE,CHECKPOINT_FINAL_COMPLETION_STATE,CHECKPOINT_PHOTO_EVIDENCE_STATE,
  checkpointCompletionDecision,checkpointEvidenceState,reconcileCheckpointEvidenceState,
  recordCheckpointArrivalEvidence,recordCheckpointFinalCompletion,transitionCheckpointPhotoEvidence
} from '../src/domain/checkpoints/evidence.js';

const requiredCheckpoint=overrides=>({
  id:'cp-1.4',name:'1.4 Blvd',type:'checkpoint',day:1,status:'photo_required',points:10,
  photoRequired:true,...overrides
});

const gpsArrival=overrides=>({
  timestamp:'2026-08-17T15:04:05.000Z',latitude:41.12345,longitude:-87.54321,gpsAccuracyFeet:18,
  speedMph:31.5,motionState:'moving',heading:94,sampleTimestamp:'2026-08-17T15:04:04.800Z',sampleAgeMs:200,
  source:'gps-radius-dwell',offline:true,background:false,interruptionContext:{network:'offline'},...overrides
});

test('GPS arrival is an idempotent fact independent from photo and completion state',()=>{
  const checkpoint=requiredCheckpoint();
  const first=recordCheckpointArrivalEvidence(checkpoint,gpsArrival());
  const replay=recordCheckpointArrivalEvidence(checkpoint,gpsArrival({latitude:42,longitude:-88,timestamp:'2026-08-17T15:05:00Z'}));

  assert.equal(first.changed,true);
  assert.equal(replay.changed,false);
  assert.equal(checkpoint.arrivalState,CHECKPOINT_ARRIVAL_STATE.CONFIRMED);
  assert.equal(checkpoint.arrivedAt,'2026-08-17T15:04:05.000Z');
  assert.equal(checkpoint.arrivalEvidence.latitude,41.12345,'first authoritative coordinates are preserved');
  assert.equal(checkpoint.checkpointEvidence.arrival.offline,true);
  assert.deepEqual(checkpoint.checkpointEvidence.arrival.interruptionContext,{network:'offline'});
  assert.equal(checkpoint.photoEvidenceState,CHECKPOINT_PHOTO_EVIDENCE_STATE.NOT_ATTEMPTED);
  assert.equal(checkpoint.finalCompletionState,CHECKPOINT_FINAL_COMPLETION_STATE.PENDING);
  assert.equal(checkpoint.scoreAwarded,0);
});

test('confirmed arrival rejects missing authoritative GPS fields instead of fabricating a crossing',()=>{
  const checkpoint=requiredCheckpoint();
  assert.throws(()=>recordCheckpointArrivalEvidence(checkpoint,gpsArrival({latitude:null})),/requires timestamp, coordinates, and GPS accuracy/);
  assert.equal(checkpointEvidenceState(checkpoint).arrival.state,CHECKPOINT_ARRIVAL_STATE.NOT_CONFIRMED);
});

test('a trustworthy GPS observation upgrades an incomplete legacy arrival projection once',()=>{
  const checkpoint=requiredCheckpoint({arrivedAt:'2026-08-17T15:00:00Z',arrivalEvidence:{source:'legacy'}});
  assert.equal(checkpointEvidenceState(checkpoint).arrival.trustworthy,false);
  const result=recordCheckpointArrivalEvidence(checkpoint,gpsArrival());
  assert.equal(result.changed,true);
  assert.equal(result.arrival.trustworthy,true);
  assert.equal(result.arrival.latitude,41.12345);
});

test('legacy manual fallback coordinates never masquerade as authoritative GPS arrival',()=>{
  const checkpoint=requiredCheckpoint({
    arrivedAt:'2026-08-17T15:00:00Z',
    arrivalEvidence:{timestamp:'2026-08-17T15:00:00Z',latitude:41,longitude:-87,gpsAccuracyFeet:18,source:'manual_fallback'}
  });
  const state=reconcileCheckpointEvidenceState(checkpoint);
  assert.equal(state.arrival.state,CHECKPOINT_ARRIVAL_STATE.NOT_CONFIRMED);
  assert.equal(state.arrival.trustworthy,false);
  assert.equal(checkpoint.arrivalState,CHECKPOINT_ARRIVAL_STATE.NOT_CONFIRMED);
});

test('unknown GPS-like provenance is rejected rather than trusted by prefix',()=>{
  const checkpoint=requiredCheckpoint({
    arrivedAt:'2026-08-17T15:00:00Z',
    arrivalEvidence:{timestamp:'2026-08-17T15:00:00Z',latitude:41,longitude:-87,gpsAccuracyFeet:18,source:'gps_fabricated'}
  });
  assert.equal(checkpointEvidenceState(checkpoint).arrival.state,CHECKPOINT_ARRIVAL_STATE.NOT_CONFIRMED);
  assert.throws(()=>recordCheckpointArrivalEvidence(requiredCheckpoint(),gpsArrival({source:'gps_fabricated'})),/authoritative GPS provenance/);
});

test('photo evidence transitions retain pair recovery data and cannot regress after completion',()=>{
  const checkpoint=requiredCheckpoint();
  transitionCheckpointPhotoEvidence(checkpoint,'permission_blocked',{reasonCode:'camera-permission-denied',updatedAt:'2026-08-17T15:00:00Z'});
  transitionCheckpointPhotoEvidence(checkpoint,'capture_started',{pairId:'pair-1',pairJournalEventId:'pair-event-1',updatedAt:'2026-08-17T15:01:00Z'});
  transitionCheckpointPhotoEvidence(checkpoint,'partial',{missingSides:['rear'],mediaReferences:{frontOriginalMediaId:'front-o',frontEvidenceMediaId:'front-e'},updatedAt:'2026-08-17T15:02:00Z'});
  const completed=transitionCheckpointPhotoEvidence(checkpoint,'complete',{missingSides:[],mediaReferences:{frontOriginalMediaId:'front-o',frontEvidenceMediaId:'front-e',rearOriginalMediaId:'rear-o',rearEvidenceMediaId:'rear-e'},updatedAt:'2026-08-17T15:03:00Z'});

  assert.equal(completed.photo.state,CHECKPOINT_PHOTO_EVIDENCE_STATE.COMPLETE);
  assert.equal(completed.photo.pairId,'pair-1');
  assert.equal(checkpoint.photoStatus,'recorded');
  assert.throws(()=>transitionCheckpointPhotoEvidence(checkpoint,'failed'),/Invalid photo evidence transition/);
});

test('every required degraded photo state remains explicit rather than collapsing to a boolean',()=>{
  for(const photoState of ['permission_blocked','capture_started','partial','interrupted','failed']){
    const checkpoint=requiredCheckpoint();
    transitionCheckpointPhotoEvidence(checkpoint,photoState,{reasonCode:`test-${photoState}`});
    assert.equal(checkpoint.photoEvidenceState,photoState);
    assert.equal(checkpoint.checkpointEvidence.photo.reasonCode,`test-${photoState}`);
    assert.equal(checkpointCompletionDecision(checkpoint).allowed,false);
  }
});

test('photo-required GPS arrival alone cannot collect or award points',()=>{
  const checkpoint=requiredCheckpoint();
  recordCheckpointArrivalEvidence(checkpoint,gpsArrival());
  const decision=checkpointCompletionDecision(checkpoint);
  const completion=recordCheckpointFinalCompletion(checkpoint);

  assert.deepEqual({allowed:decision.allowed,reason:decision.reason,pointsAwarded:decision.pointsAwarded},{allowed:false,reason:'required-photo-evidence-incomplete',pointsAwarded:0});
  assert.equal(completion.changed,false);
  assert.equal(checkpoint.status,'photo_required');
  assert.equal(checkpoint.finalCompletionState,CHECKPOINT_FINAL_COMPLETION_STATE.PENDING);
  assert.equal(checkpoint.scoreAwarded,0);
});

test('complete required pair opens the normal completion and scoring gate exactly once',()=>{
  const checkpoint=requiredCheckpoint();
  recordCheckpointArrivalEvidence(checkpoint,gpsArrival());
  transitionCheckpointPhotoEvidence(checkpoint,'capture_started',{pairId:'pair-1'});
  transitionCheckpointPhotoEvidence(checkpoint,'complete',{pairId:'pair-1'});
  const completed=recordCheckpointFinalCompletion(checkpoint,{completedAt:'2026-08-17T15:06:00Z'});
  const replay=recordCheckpointFinalCompletion(checkpoint,{completedAt:'2026-08-17T15:07:00Z'});

  assert.equal(completed.changed,true);
  assert.equal(completed.pointsAwarded,10);
  assert.equal(checkpoint.status,'collected');
  assert.equal(checkpoint.completedAt,'2026-08-17T15:06:00.000Z');
  assert.equal(checkpoint.scoreAwarded,10);
  assert.equal(replay.changed,false);
  assert.equal(replay.reason,'already-completed');
  assert.equal(checkpoint.completedAt,'2026-08-17T15:06:00.000Z');
});

test('non-photo-required checkpoint completion remains unchanged',()=>{
  const checkpoint=requiredCheckpoint({id:'cp-plain',status:'active',photoRequired:false});
  const decision=checkpointCompletionDecision(checkpoint);
  const completed=recordCheckpointFinalCompletion(checkpoint,{completedAt:'2026-08-17T15:08:00Z'});
  assert.equal(decision.allowed,true);
  assert.equal(completed.changed,true);
  assert.equal(checkpoint.status,'collected');
  assert.equal(checkpoint.scoreAwarded,10);
});

test('legacy arrival, pending pair, and completion fields migrate without being renamed or discarded',()=>{
  const checkpoint=requiredCheckpoint({
    arrivedAt:'2026-08-17T15:04:05Z',arrivalEvidence:{latitude:41,longitude:-87,gpsAccuracyFeet:22,source:'gps_capture'},
    photoStatus:'required_pending',pendingPhotoPair:{pairId:'legacy-pair',pairJournalEventId:'legacy-pair-event',status:'partial'},
    notes:'Keep this note',sequence:4
  });
  const state=reconcileCheckpointEvidenceState(checkpoint);

  assert.equal(state.arrival.state,CHECKPOINT_ARRIVAL_STATE.CONFIRMED);
  assert.equal(state.photo.state,CHECKPOINT_PHOTO_EVIDENCE_STATE.PARTIAL);
  assert.equal(state.photo.pairId,'legacy-pair');
  assert.equal(state.completion.state,CHECKPOINT_FINAL_COMPLETION_STATE.PENDING);
  assert.equal(checkpoint.notes,'Keep this note');
  assert.equal(checkpoint.sequence,4);
  assert.deepEqual(checkpoint.pendingPhotoPair,{pairId:'legacy-pair',pairJournalEventId:'legacy-pair-event',status:'partial'});
});

test('reload reconciliation preserves confirmed arrival and incomplete photo evidence without completion or score',()=>{
  const checkpoint=requiredCheckpoint();
  recordCheckpointArrivalEvidence(checkpoint,gpsArrival());
  transitionCheckpointPhotoEvidence(checkpoint,CHECKPOINT_PHOTO_EVIDENCE_STATE.CAPTURE_STARTED,{
    pairId:'pair-reload',pairJournalEventId:'pair-event-reload',updatedAt:'2026-08-17T15:05:00Z'
  });
  transitionCheckpointPhotoEvidence(checkpoint,CHECKPOINT_PHOTO_EVIDENCE_STATE.PARTIAL,{
    missingSides:['rear'],mediaReferences:{frontOriginalMediaId:'front-original'},updatedAt:'2026-08-17T15:05:30Z'
  });

  const restored=JSON.parse(JSON.stringify(checkpoint));
  const reconciled=reconcileCheckpointEvidenceState(restored);
  const completion=recordCheckpointFinalCompletion(restored,{completedAt:'2026-08-17T15:06:00Z'});

  assert.equal(reconciled.arrival.state,CHECKPOINT_ARRIVAL_STATE.CONFIRMED);
  assert.equal(reconciled.arrival.latitude,41.12345);
  assert.equal(reconciled.photo.state,CHECKPOINT_PHOTO_EVIDENCE_STATE.PARTIAL);
  assert.equal(reconciled.photo.pairId,'pair-reload');
  assert.deepEqual(reconciled.photo.missingSides,['rear']);
  assert.equal(reconciled.completion.state,CHECKPOINT_FINAL_COMPLETION_STATE.PENDING);
  assert.equal(completion.changed,false);
  assert.equal(restored.status,'photo_required');
  assert.equal(restored.scoreAwarded,0);
});

test('legacy camera-failure disposition migrates as missing photo evidence and stays outside the completion gate',()=>{
  const checkpoint=requiredCheckpoint({status:'collected',completedAt:'2026-08-17T15:05:00Z',scoreAwarded:10,photoStatus:'camera_unavailable_high_speed',photoFailureDisposition:'camera_unavailable_high_speed'});
  const state=reconcileCheckpointEvidenceState(checkpoint),decision=checkpointCompletionDecision(checkpoint);
  assert.equal(state.photo.state,CHECKPOINT_PHOTO_EVIDENCE_STATE.FAILED);
  assert.equal(state.photo.reasonCode,'camera_unavailable_high_speed');
  assert.equal(state.completion.state,CHECKPOINT_FINAL_COMPLETION_STATE.PENDING);
  assert.equal(state.completion.legacyCompletionWithoutRequiredPhoto,true);
  assert.equal(decision.allowed,false);
  assert.equal(decision.pointsAwarded,0);
  assert.equal(checkpoint.scoreAwarded,0);
});
