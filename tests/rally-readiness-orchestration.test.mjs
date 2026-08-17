import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

import {createCheckpointEvidenceReconciliationService} from '../src/application/checkpoint-evidence-reconciliation-service.js';
import {
  CHECKPOINT_ARRIVAL_STATE,
  checkpointEvidenceState,
  recordCheckpointFinalCompletion,
  transitionCheckpointPhotoEvidence
} from '../src/domain/checkpoints/evidence.js';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');

function functionSource(name){
  const start=app.indexOf(`function ${name}(`);
  assert.notEqual(start,-1,`${name} must exist`);
  const parameters=app.indexOf('(',start);
  let parameterDepth=0,parameterQuote=null,parameterEscaped=false,opening=-1;
  for(let index=parameters;index<app.length;index++){
    const character=app[index];
    if(parameterQuote){
      if(parameterEscaped)parameterEscaped=false;
      else if(character==='\\')parameterEscaped=true;
      else if(character===parameterQuote)parameterQuote=null;
      continue;
    }
    if(character==='\''||character==='"'||character==='`'){parameterQuote=character;continue;}
    if(character==='(')parameterDepth++;
    if(character===')'&&--parameterDepth===0){opening=app.indexOf('{',index);break;}
  }
  assert.notEqual(opening,-1,`${name} must have a function body`);
  let depth=0,quote=null,escaped=false;
  for(let index=opening;index<app.length;index++){
    const character=app[index];
    if(quote){
      if(escaped)escaped=false;
      else if(character==='\\')escaped=true;
      else if(character===quote)quote=null;
      continue;
    }
    if(character==='\''||character==='"'||character==='`'){quote=character;continue;}
    if(character==='{')depth++;
    if(character==='}'&&--depth===0)return app.slice(start,index+1);
  }
  throw new Error(`${name} has no closing brace`);
}

function assertScopeTransition(source,mutationPattern,label){
  const suspendAt=source.indexOf('suspendPendingEvidenceRuntime('),mutationAt=source.search(mutationPattern),resumeAt=source.indexOf('resumeRallyScopeRuntime(');
  assert.ok(suspendAt>=0,`${label} must suspend the prior Rally scope`);
  assert.ok(mutationAt>suspendAt,`${label} must suspend before replacing project/day state`);
  assert.ok(resumeAt>mutationAt,`${label} must reset/resume only after replacing project/day state`);
}

const gpsArrival=(checkpointId='cp-1')=>({
  eventId:`arrival-${checkpointId}`,
  eventType:'checkpoint_arrival',
  timestamp:'2026-08-17T12:00:00.000Z',
  references:{checkpointId},
  metadata:{
    checkpointId,source:'gps_capture',
    arrivalEvidence:{
      state:'confirmed',trustworthy:true,timestamp:'2026-08-17T12:00:00.000Z',
      latitude:41.1234,longitude:-87.5432,gpsAccuracyFeet:14
    }
  }
});

function media(role,cameraRole){
  return {
    mediaId:`${cameraRole}-${role}`,projectId:'project',checkpointId:'cp-1',pairId:'pair-1',pairStatus:'complete',
    cameraRole,role,capturedAt:'2026-08-17T12:00:01.000Z',mediaGroupId:`${cameraRole}-group`,
    pairedMediaId:`${cameraRole}-${role==='original'?'evidence':'original'}`,
    ...(role==='evidence'?{derivedFromMediaId:`${cameraRole}-original`}:{evidenceStatus:'complete'})
  };
}

function repository(records=[]){
  return {
    async listCheckpointPhotos(projectId,checkpointId){return records.filter(item=>item.projectId===projectId&&item.checkpointId===checkpointId);},
    async getMedia(mediaId){return records.find(item=>item.mediaId===mediaId)||null;}
  };
}

function workflowHarness(){
  let state={status:'idle',sides:{front:null,rear:null}},starts=0,restores=0,finalizes=0;
  return {
    get starts(){return starts;},get restores(){return restores;},get finalizes(){return finalizes;},
    start(input){starts++;state={...input,pairId:input.pairId||'generated-pair',pairJournalEventId:input.pairJournalEventId||'generated-journal',status:'awaiting_pair',sides:{front:null,rear:null}};return state;},
    restoreSide(role,pair){if(!state.sides[role]){restores++;state.sides[role]=pair;}state.status=state.sides.front&&state.sides.rear?'pair_captured':state.sides.front?'rear_required':'awaiting_pair';return state;},
    async finalizeRestoredPair(){finalizes++;state.status='ready';return state;},
    getState(){return state;}
  };
}

test('day preflight gates checkpoint arrival processing until the rider proceeds',()=>{
  const evaluate=functionSource('evaluateCheckpointArrival');
  assert.match(evaluate,/if\(showDayPreflight\(\)\)return;/);
  assert.ok(evaluate.indexOf('if(showDayPreflight())return;')<evaluate.indexOf('checkpointArrivalCoordinator.observe'),
    'the preflight gate must run before any checkpoint observation is submitted');
});

test('manual photo startup without trustworthy GPS never claims a confirmed arrival',()=>{
  const complete=functionSource('completeCurrentCheckpoint'),begin=functionSource('beginPhotoWorkflow');
  assert.doesNotMatch(complete,/appendRallyJournalEvent\('checkpoint_arrival'/,
    'the manual Complete control must not manufacture a GPS arrival Journal event');
  assert.match(begin,/checkpoint_photo_capture_started/);
  assert.match(begin,/No GPS arrival is claimed by this action\./);
});

test('manual pending pair remains recoverable after reload without inventing GPS arrival',async()=>{
  const checkpoint={
    id:'cp-1',type:'checkpoint',day:1,status:'photo_required',photoRequired:true,
    arrivalState:'not_confirmed',photoEvidenceState:'capture_started',
    pendingPhotoPair:{pairId:'pair-1',pairJournalEventId:'pair-journal-1',status:'capture_started'}
  };
  const manualEvent={
    eventId:'manual-photo-start',eventType:'checkpoint_photo_capture_started',timestamp:'2026-08-17T12:00:00.000Z',
    references:{checkpointId:'cp-1'},metadata:{checkpointId:'cp-1',photoRequired:true}
  };
  const workflow=workflowHarness(),service=createCheckpointEvidenceReconciliationService({mediaRepository:repository([])});
  const result=await service.reconcile({projectId:'project',checkpoint,journalEvents:[manualEvent],cameraWorkflow:workflow});
  assert.equal(result.arrivalConfirmed,false);
  assert.equal(result.action,'resume_pair');
  assert.equal(result.workflowRestored,true);
  assert.equal(workflow.starts,1);
  assert.equal(result.arrivalEvent.eventType,'checkpoint_photo_capture_started');

  const reconciliation=functionSource('reconcilePendingCheckpointEvidence');
  assert.match(reconciliation,/pendingPhotoPair|checkpoint_photo_capture_started/,
    'application recovery must scan durable manual workflows even when no GPS arrival projection exists');
  assert.doesNotMatch(reconciliation,/return evidence\.arrival\.state===checkpoints\.CHECKPOINT_ARRIVAL_STATE\.CONFIRMED&&evidence\.completion\.state!==/,
    'manual recovery candidates must not be excluded solely because GPS arrival is unconfirmed');
});

test('a complete durable pair can pass the evidence gate and complete exactly once',async()=>{
  const records=['front','rear'].flatMap(cameraRole=>[media('original',cameraRole),media('evidence',cameraRole)]),checkpoint={
    id:'cp-1',type:'checkpoint',day:1,status:'photo_required',points:10,photoRequired:true,
    arrivalState:'confirmed',arrivalEvidence:gpsArrival().metadata.arrivalEvidence,
    photoEvidenceState:'partial',pendingPhotoPair:{pairId:'pair-1',pairJournalEventId:'pair-journal-1',status:'partial'}
  };
  const workflow=workflowHarness(),service=createCheckpointEvidenceReconciliationService({mediaRepository:repository(records)});
  const recovered=await service.reconcile({projectId:'project',checkpoint,journalEvents:[gpsArrival()],cameraWorkflow:workflow});
  assert.equal(recovered.action,'finalize_pair');
  assert.equal(recovered.workflowState.status,'ready');
  transitionCheckpointPhotoEvidence(checkpoint,'complete',{pairId:recovered.pairId,missingSides:[]});
  const first=recordCheckpointFinalCompletion(checkpoint,{completedAt:'2026-08-17T12:00:02.000Z'}),second=recordCheckpointFinalCompletion(checkpoint,{completedAt:'2026-08-17T12:00:03.000Z'});
  assert.equal(first.changed,true);
  assert.equal(second.changed,false);
  assert.equal(checkpoint.status,'collected');
  assert.equal(checkpoint.scoreAwarded,10);

  const complete=functionSource('completeCurrentCheckpoint');
  const reconcileAt=complete.indexOf('await reconcilePendingCheckpointEvidence({checkpointId:checkpoint.id,interactive:true})');
  assert.ok(reconcileAt>=0,'the initiating action must invoke interactive durable recovery');
  assert.ok(complete.indexOf('checkpointEvidenceSnapshot(checkpoint)',reconcileAt)>reconcileAt,
    'the initiating action must re-check evidence after reconciliation and complete without a second rider tap');
});

test('day and project scope switches suspend only the in-memory evidence workflow',()=>{
  const suspend=functionSource('suspendPendingEvidenceRuntime'),switchProject=functionSource('switchProject');
  assert.match(suspend,/checkpointCamera\?\.abandon(?:\?\.)?\(\)/);
  assert.match(suspend,/pendingPhotoCheckpointId=null/);
  assert.match(suspend,/pendingMediaObjective=null/);
  assert.doesNotMatch(suspend,/delete|removeMedia|deleteMedia|removeCheckpointPhotos/,
    'scope suspension must not delete durable arrival or media evidence');
  assert.match(switchProject,/suspendPendingEvidenceRuntime\(/);
  const dayHandler=app.slice(app.indexOf("$('dayFilter')?.addEventListener('change'"),app.indexOf("$('featureForm')?.addEventListener('submit'"));
  assert.match(dayHandler,/suspendPendingEvidenceRuntime\(/);
});

test('scope suspension gates GPS arrival processing until the replacement scope is ready',()=>{
  const evaluate=functionSource('evaluateCheckpointArrival'),suspend=functionSource('suspendPendingEvidenceRuntime'),resume=functionSource('resumeRallyScopeRuntime');
  assert.match(suspend,/rallyScopeSuspended=true/);
  assert.match(resume,/resetCheckpointArrivalCoordinator\(/);
  assert.match(resume,/rallyScopeSuspended=false/);
  assert.ok(evaluate.indexOf('rallyScopeSuspended')<evaluate.indexOf('checkpointArrivalCoordinator.observe'),
    'GPS fixes must be rejected while a day/project transition is in progress');
});

test('failed evidence preservation cannot leave Rally scope permanently suspended',()=>{
  const suspend=functionSource('suspendPendingEvidenceRuntime');
  const preserveAt=suspend.indexOf('await preserveIncompletePhotoEvidence('),catchAt=suspend.indexOf('catch(',preserveAt);
  assert.ok(preserveAt>=0&&catchAt>preserveAt,
    'scope suspension must handle a durable-evidence preservation failure internally because callers await it before their recovery finally blocks');
  const recovery=suspend.slice(catchAt);
  assert.match(recovery,/resumeRallyScopeRuntime\(/,
    'a failed scope suspension must restore GPS arrival processing for the unchanged scope');
  assert.match(recovery,/throw\s+/,
    'the preservation failure must still reach the initiating project/day action');
});

test('completion and durable-pair finalization stop when their Rally scope changes',()=>{
  const finalize=functionSource('finalizePendingPhotoCheckpoint'),complete=functionSource('completeCurrentCheckpoint'),finalizeDay=functionSource('finalizeDay');
  assert.match(finalize,/scopeToken=rallyScopeSnapshot\(\)\.token/);
  assert.match(finalize,/if\(!rallyScopeMatches\(scopeToken\)\)return/);
  const journalAt=finalize.indexOf("await appendRallyJournalEvent('checkpoint_photo_evidence_recovered'");
  const saveAt=finalize.indexOf('await saveProject(false)');
  const completionAt=finalize.indexOf('await completeCurrentCheckpoint(');
  assert.ok(journalAt>=0&&finalize.indexOf('rallyScopeMatches(scopeToken)',journalAt)>journalAt,
    'photo recovery must stop after a scope change during its Journal write');
  assert.ok(saveAt>=0&&finalize.indexOf('rallyScopeMatches(scopeToken)',saveAt)>saveAt,
    'photo recovery must stop after a scope change during project persistence');
  assert.ok(completionAt>saveAt&&finalize.slice(completionAt).includes('scopeToken'),
    'photo finalization must pass its original scope into normal completion');

  assert.match(complete,/requestedScopeToken\|\|rallyScopeSnapshot\(\)\.token/);
  assert.match(complete,/checkpointCompletionInFlight\.scopeToken/);
  for(const awaited of ['await saveProject(false)','await reconcilePendingCheckpointEvidence(','await recordJournalCheckpoint(']){
    const at=complete.indexOf(awaited);
    assert.ok(at>=0&&complete.indexOf('rallyScopeMatches(scopeToken)',at)>at,
      `${awaited} must be followed by a scope guard before further global state work`);
  }

  assert.match(finalizeDay,/scopeToken/,'day finalization must retain the initiating Rally scope');
  const analyticsAt=finalizeDay.indexOf('await rallyAnalytics'),dayMutationAt=finalizeDay.indexOf("dayState.status='complete'"),dayJournalAt=finalizeDay.indexOf("await appendRallyJournalEvent('day_finished'"),daySaveAt=finalizeDay.indexOf('await saveProject(false)');
  assert.ok(analyticsAt>=0&&finalizeDay.indexOf('rallyScopeMatches(scopeToken)',analyticsAt)<dayMutationAt,
    'a scope change during analytics flush must abort before day state is finalized');
  assert.ok(dayJournalAt>=0&&daySaveAt>dayJournalAt&&finalizeDay.indexOf('rallyScopeMatches(scopeToken)',dayJournalAt)<daySaveAt,
    'a scope change during the day-finished Journal write must abort before global project persistence');
  assert.match(complete,/finalizeDay\(checkpoint,\{scopeToken\}\)/,
    'normal completion must pass its original scope into day finalization');
});

test('automatic camera failure handling stops at every asynchronous scope boundary',()=>{
  const process=functionSource('processDetectedCheckpointArrival'),catchAt=process.indexOf('catch(error){'),failure=process.slice(catchAt);
  assert.ok(catchAt>=0,'automatic arrival processing must retain its failure policy');
  const guardBetween=(startNeedle,endNeedle,message)=>{
    const start=failure.indexOf(startNeedle),end=failure.indexOf(endNeedle,start+startNeedle.length),guard=failure.indexOf('rallyScopeMatches(scopeToken)',start+startNeedle.length);
    assert.ok(start>=0&&end>start&&guard>start&&guard<end,message);
  };
  guardBetween('await cameraReadiness?.noteCaptureFailure?.',"const failure=cameraFailureDetails",'camera-readiness failure reporting must not cross Rally scopes');
  guardBetween("await appendFailureJournalBestEffort('camera_failure'","if(disposition==='camera_unavailable_high_speed')",'camera-failure Journal completion must be scope-checked');
  guardBetween('await preserveIncompletePhotoEvidence(checkpoint',"if(pendingPhotoCheckpointId===checkpoint.id)",'high-speed evidence preservation must be scope-checked');
  guardBetween('workflow=await restartUnsafeCapturePair','transitionPhotoEvidenceSafely(checkpoint','pair restart must not resume in a replacement scope');
  guardBetween('await saveProject(false)','await beginManualFallback(checkpoint','manual fallback must not open in a replacement scope');
});

test('every direct project and day replacement suspends then resets the arrival runtime',()=>{
  assertScopeTransition(functionSource('openProjectFile'),/state\.project\s*=/,'portable project open');
  assertScopeTransition(functionSource('restoreSnapshot'),/state\.project\s*=/,'snapshot restore');
  assertScopeTransition(functionSource('createActiveExecutionCopy'),/state\.project\s*=/,'execution-copy creation');
  assertScopeTransition(functionSource('newProject'),/state\.project\s*=/,'legacy new project');
  assertScopeTransition(functionSource('switchProject'),/state\.project\s*=/,'standard project switch');
  assertScopeTransition(functionSource('createIndependentProject'),/state\.project\s*=/,'independent project creation');
  assertScopeTransition(functionSource('startNextRallyDay'),/checkpoints\.startRallyDay\(/,'next-day start');

  const dayStart=app.indexOf("$('dayFilter')?.addEventListener('change'"),dayEnd=app.indexOf("$('featureForm')?.addEventListener('submit'",dayStart),dayHandler=app.slice(dayStart,dayEnd);
  assertScopeTransition(dayHandler,/state\.settings\.dayFilter\s*=/,'day filter change');
  const unassignedStart=app.indexOf("$('missionUnassignedButton')?.addEventListener"),unassignedEnd=app.indexOf("$('missionSnapshotButton')?.addEventListener",unassignedStart),unassignedHandler=app.slice(unassignedStart,unassignedEnd);
  assertScopeTransition(unassignedHandler,/state\.settings\.dayFilter\s*=/,'Unassigned-day selection');
});

test('every project/day scope suspension disposes the scoped camera session before async preservation',()=>{
  const source=functionSource('suspendPendingEvidenceRuntime'),teardown=source.indexOf('cameraSession?.teardown(reason)'),preservation=source.indexOf('await preserveIncompletePhotoEvidence');
  assert.ok(teardown>=0,'scope suspension must dispose retained camera streams');
  assert.ok(preservation<0||teardown<preservation,'camera teardown must invalidate late acquisitions before asynchronous evidence preservation');
});

test('trustworthy flag without the required GPS facts is never authoritative',async()=>{
  const malformed={
    id:'cp-1',type:'checkpoint',day:1,status:'photo_required',photoRequired:true,
    arrivedAt:'2026-08-17T12:00:00.000Z',arrivalEvidence:{state:'confirmed',trustworthy:true},
    photoEvidenceState:'failed'
  };
  const evidence=checkpointEvidenceState(malformed);
  assert.equal(evidence.arrival.state,CHECKPOINT_ARRIVAL_STATE.NOT_CONFIRMED);
  assert.notEqual(evidence.arrival.trustworthy,true);
  const service=createCheckpointEvidenceReconciliationService({mediaRepository:repository([])}),result=await service.inspect({projectId:'project',checkpoint:malformed,journalEvents:[]});
  assert.equal(result.arrivalConfirmed,false);
  assert.equal(result.action,'none');
  assert.equal(result.reason,'arrival-not-confirmed');
});

test('completed and read-only review days never enter the camera setup GPS gate',()=>{
  const source=functionSource('startGps');
  assert.match(source,/activeDayNeedsSetup=Boolean\(rallyDay&&rallyDayState\(rallyDay\)\.status!==['"]complete['"]&&!restoredDayReview\)/);
  assert.match(source,/if\(activeDayNeedsSetup&&cameraSetupRequired\(\)/);
});
