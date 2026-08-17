import assert from 'node:assert/strict';
import test from 'node:test';
import {createCheckpointEvidenceReconciliationService} from '../src/application/checkpoint-evidence-reconciliation-service.js';
import {createPhotoEvidenceService} from '../src/application/photo-evidence-service.js';

const arrival=(checkpointId='cp-1')=>({eventId:'arrival-1',eventType:'checkpoint_arrival',timestamp:'2026-08-17T12:00:00.000Z',references:{checkpointId},metadata:{checkpointId,source:'gps_capture',arrivalEvidence:{state:'confirmed',timestamp:'2026-08-17T12:00:00.000Z',latitude:41.1,longitude:-87.5,gpsAccuracyFeet:18,trustworthy:true}}});
const media=(role,cameraRole,{pairId='pair-1',checkpointId='cp-1',suffix='',...extra}={})=>({
  mediaId:`${cameraRole}-${role}${suffix}`,projectId:'project',checkpointId,pairId,pairStatus:'pending',cameraRole,role,
  capturedAt:'2026-08-17T12:00:01.000Z',mediaGroupId:`${cameraRole}-group${suffix}`,pairedMediaId:`${cameraRole}-${role==='original'?'evidence':'original'}${suffix}`,
  ...(role==='evidence'?{derivedFromMediaId:`${cameraRole}-original${suffix}`}:{evidenceStatus:'complete'}),...extra
});
const checkpoint=(extra={})=>({id:'cp-1',type:'checkpoint',day:1,status:'photo_required',photoRequired:true,arrivedAt:'2026-08-17T12:00:00.000Z',arrivalState:'confirmed',photoEvidenceState:'capture_started',pendingPhotoPair:{pairId:'pair-1',pairJournalEventId:'pair-journal-1',status:'pending'},...extra});

function repository(records){
  return {
    records,
    async listCheckpointPhotos(projectId,checkpointId){return records.filter(item=>item.projectId===projectId&&item.checkpointId===checkpointId);},
    async getMedia(mediaId){return records.find(item=>item.mediaId===mediaId)||null;}
  };
}

function workflowHarness(){
  let state={status:'idle',sides:{front:null,rear:null}},starts=0,restores=0,finalizes=0;
  return {
    get starts(){return starts;},get restores(){return restores;},get finalizes(){return finalizes;},
    start(input){starts++;state={...input,pairId:input.pairId||'generated-pair',pairJournalEventId:input.pairJournalEventId||'generated-pair-journal',status:'awaiting_pair',sides:{front:null,rear:null}};return state;},
    restoreSide(role,pair){if(!state.sides[role]){restores++;state.sides[role]=pair;}state.status=state.sides.front&&state.sides.rear?'pair_captured':state.sides.front?'rear_required':'awaiting_pair';return state;},
    async finalizeRestoredPair(){finalizes++;state.status='ready';return state;},
    getState(){return state;}
  };
}

test('durable media remains recoverable without fabricating an arrival',async()=>{
  const records=['front','rear'].flatMap(role=>[media('original',role),media('evidence',role)]),service=createCheckpointEvidenceReconciliationService({mediaRepository:repository(records)});
  const result=await service.inspect({projectId:'project',checkpoint:checkpoint({arrivedAt:null,arrivalState:'none',arrivalEvidence:{}}),journalEvents:[]});
  assert.equal(result.action,'finalize_pair');assert.equal(result.arrivalConfirmed,false);assert.equal(result.projectionPatch.arrivalState,'not_confirmed');
});

test('legacy manual-fallback arrival event is never upgraded to GPS proof',async()=>{
  const service=createCheckpointEvidenceReconciliationService({mediaRepository:repository([])}),item=checkpoint({arrivedAt:null,arrivalState:'none',arrivalEvidence:{}}),event=arrival();
  event.metadata.source='manual_fallback';
  const result=await service.inspect({projectId:'project',checkpoint:item,journalEvents:[event]});
  assert.equal(result.arrivalConfirmed,false);
  assert.equal(result.trustworthyArrivalEvent,null);
  assert.equal(result.action,'resume_pair','durable manual photo recovery remains available without GPS proof');
});

test('a durable front side restores once and resumes only the missing rear side',async()=>{
  const records=[media('original','front'),media('evidence','front')],service=createCheckpointEvidenceReconciliationService({mediaRepository:repository(records)}),workflow=workflowHarness(),input={projectId:'project',checkpoint:checkpoint(),journalEvents:[arrival()],cameraWorkflow:workflow};
  const first=await service.reconcile(input),second=await service.reconcile(input);
  assert.equal(first.action,'resume_pair');assert.deepEqual(first.completeSides,['front']);assert.deepEqual(first.missingSides,['rear']);assert.equal(first.workflowState.status,'rear_required');
  assert.equal(second.action,'resume_pair');assert.equal(workflow.starts,1);assert.equal(workflow.restores,1);assert.equal(workflow.finalizes,0);
});

test('a confirmed arrival with no pair starts one recovery workflow only once',async()=>{
  const service=createCheckpointEvidenceReconciliationService({mediaRepository:repository([])}),workflow=workflowHarness(),item=checkpoint({pendingPhotoPair:null,photoEvidenceState:'not_attempted'}),input={projectId:'project',checkpoint:item,journalEvents:[arrival()],cameraWorkflow:workflow};
  const first=await service.reconcile(input),second=await service.reconcile(input);
  assert.equal(first.action,'resume_pair');assert.equal(first.reason,'pair-not-started');assert.equal(first.pairId,'generated-pair');
  assert.equal(second.action,'resume_pair');assert.equal(workflow.starts,1,'repeated recovery must reuse the active generated pair');
});

test('a complete durable pair is recognized and prepared for normal completion idempotently',async()=>{
  const records=['front','rear'].flatMap(role=>[media('original',role),media('evidence',role)]),events=[arrival(),{eventId:'pair-journal-1',eventType:'photo_added',timestamp:'2026-08-17T12:00:02.000Z',references:{checkpointId:'cp-1',pairId:'pair-1'}}],service=createCheckpointEvidenceReconciliationService({mediaRepository:repository(records)}),workflow=workflowHarness(),input={projectId:'project',checkpoint:checkpoint(),journalEvents:events,cameraWorkflow:workflow};
  const first=await service.reconcile(input),second=await service.reconcile(input);
  assert.equal(first.action,'finalize_pair');assert.equal(first.photoEvidenceState,'complete');assert.deepEqual(first.missingSides,[]);assert.equal(first.workflowState.status,'ready');
  assert.equal(second.action,'finalize_pair');assert.equal(workflow.starts,1);assert.equal(workflow.restores,2);assert.equal(workflow.finalizes,1,'repeated reconciliation must not finalize or journal the same pair again');
  assert.equal(records.length,4,'reconciliation never duplicates media');assert.equal(events.filter(event=>event.eventType==='checkpoint_arrival').length,1,'reconciliation never duplicates arrival events');
});

test('an abandoned Original is identified, Evidence is retried once, and the same pair becomes finalizable',async()=>{
  const abandoned=media('original','front',{pairId:null,pairedMediaId:null,pairStatus:'abandoned',evidenceStatus:'failed',abandonedPairId:'pair-1',metadata:{abandonedPairId:'pair-1',cameraRole:'front'}}),records=[abandoned,media('original','rear'),media('evidence','rear')],repo=repository(records),retryCalls=[];
  const photoEvidence={async retryEvidence(originalMediaId,recovery){
    retryCalls.push({originalMediaId,recovery});const original=await repo.getMedia(originalMediaId),evidence=media('evidence','front');Object.assign(original,{pairId:recovery.pairId,pairStatus:'pending',pairedMediaId:evidence.mediaId,evidenceStatus:'complete'});records.push(evidence);return evidence;
  }};
  const service=createCheckpointEvidenceReconciliationService({mediaRepository:repo,photoEvidence});
  const before=await service.inspect({projectId:'project',checkpoint:checkpoint(),journalEvents:[arrival()]});
  assert.equal(before.action,'retry_evidence');assert.deepEqual(before.retryOriginalIds,['front-original']);
  const recovered=await service.reconcile({projectId:'project',checkpoint:checkpoint(),journalEvents:[arrival()],recoverEvidence:true});
  const repeated=await service.reconcile({projectId:'project',checkpoint:checkpoint(),journalEvents:[arrival()],recoverEvidence:true});
  assert.equal(recovered.action,'finalize_pair');assert.equal(repeated.action,'finalize_pair');assert.equal(retryCalls.length,1);assert.deepEqual(retryCalls[0].recovery,{pairId:'pair-1',cameraRole:'front',pairJournalEventId:'pair-journal-1'});
  assert.equal(new Set(records.map(item=>item.mediaId)).size,4);
});

test('already-regenerated Evidence is reattached without rendering or duplicating it',async()=>{
  const original=media('original','front',{pairId:null,pairStatus:'abandoned',abandonedPairId:'pair-1',metadata:{abandonedPairId:'pair-1',cameraRole:'front'}}),evidence=media('evidence','front',{pairId:null,pairStatus:'abandoned',abandonedPairId:'pair-1',metadata:{abandonedPairId:'pair-1',cameraRole:'front'}}),records=[original,evidence,media('original','rear'),media('evidence','rear')],repo=repository(records),reattachCalls=[];
  repo.reattachRecoveredEvidencePair=async input=>{reattachCalls.push(input);for(const record of [original,evidence])Object.assign(record,{pairId:input.pairId,pairStatus:'pending',abandonedPairId:null});return {original,evidence};};
  const photoEvidence={async retryEvidence(){throw new Error('Existing Evidence must not be rendered again.');}},service=createCheckpointEvidenceReconciliationService({mediaRepository:repo,photoEvidence});
  const before=await service.inspect({projectId:'project',checkpoint:checkpoint(),journalEvents:[arrival()]});
  assert.equal(before.action,'retry_evidence');assert.equal(before.reason,'evidence-awaiting-pair-reattachment');assert.deepEqual(before.retryOriginalIds,[]);assert.deepEqual(before.reattachOriginalIds,['front-original']);
  const after=await service.reconcile({projectId:'project',checkpoint:checkpoint(),journalEvents:[arrival()],recoverEvidence:true});
  assert.equal(after.action,'finalize_pair');assert.equal(reattachCalls.length,1);assert.equal(records.length,4);
});

test('completed projections and completion Journal events never receive a second completion action',async()=>{
  const records=['front','rear'].flatMap(role=>[media('original',role),media('evidence',role)]),service=createCheckpointEvidenceReconciliationService({mediaRepository:repository(records)}),completed={eventId:'complete-1',eventType:'checkpoint_completed',timestamp:'2026-08-17T12:00:03.000Z',references:{checkpointId:'cp-1'},metadata:{checkpointId:'cp-1',objectiveCompletion:true,photoEvidenceState:'complete'}};
  for(const item of [checkpoint({status:'collected',completedAt:'2026-08-17T12:00:03.000Z',photoEvidenceState:'complete',photoStatus:'recorded'}),checkpoint({photoEvidenceState:'complete',photoStatus:'recorded'})]){
    const events=item.status==='collected'?[arrival()]:[arrival(),completed],result=await service.inspect({projectId:'project',checkpoint:item,journalEvents:events});
    assert.equal(result.action,'none');assert.equal(result.reason,'already-completed');
  }
});

test('photo evidence retry can reattach a regenerated derivative to its abandoned capture pair',async()=>{
  const original={mediaId:'original',mediaGroupId:'group',projectId:'project',checkpointId:'cp-1',role:'original',pairId:null,pairStatus:'abandoned',abandonedPairId:'pair-1',pairedMediaId:null,evidenceStatus:'failed',name:'Day01_CP1_Front_Original.jpg',blob:new Blob(['native-original'],{type:'image/jpeg'}),metadata:{abandonedPairId:'pair-1',cameraRole:'front'}},calls=[];
  const repo={
    async getMedia(){return original;},
    async addEvidence(input){return {...original,mediaId:input.evidenceMediaId,role:'evidence',name:input.filename,blob:input.evidenceBlob,derivedFromMediaId:original.mediaId,pairedMediaId:original.mediaId};},
    async reattachRecoveredEvidencePair(input){calls.push(input);return {original:{...original,pairId:input.pairId},evidence:{mediaId:input.evidenceMediaId,role:'evidence',pairId:input.pairId,blob:new Blob(['evidence'])}};}
  };
  const service=createPhotoEvidenceService({repository:repo,createId:()=> 'evidence-retry',inspect:async()=>({width:4032,height:3024}),render:async()=>new Blob(['evidence'],{type:'image/jpeg'})});
  const result=await service.retryEvidence('original',{pairId:'pair-1',cameraRole:'front',pairJournalEventId:'pair-journal-1'});
  assert.equal(result.pairId,'pair-1');assert.deepEqual(calls,[{originalMediaId:'original',evidenceMediaId:'evidence-retry',pairId:'pair-1',cameraRole:'front',pairJournalEventId:'pair-journal-1'}]);
});
