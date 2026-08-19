import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const functionBody=name=>source.slice(source.indexOf(`function ${name}`),source.indexOf('\n}',source.indexOf(`function ${name}`))+2);

test('checkpoint and hotel pair startup emits no legacy single-photo request',()=>{
  assert.doesNotMatch(functionBody('beginPhotoWorkflow'),/photo_requested/);assert.match(functionBody('captureAutomaticPair'),/pairedMediaCapture\.capturePair/);
});

test('Journey Photo uses the paired automatic media workflow',()=>{
  const body=functionBody('requestJourneyPhoto');assert.match(body,/captureAutomaticPair/);assert.match(body,/captureKind:'journey'/);assert.doesNotMatch(body,/triggerCameraCapture/);
});

test('Journey Photo manual fallback always exposes a durable cancel-and-return action',()=>{
  const render=functionBody('renderCheckpointCameraState'),cancel=functionBody('continuePendingPhotoRoute');
  assert.match(render,/CANCEL JOURNEY PHOTO/);assert.doesNotMatch(render,/rallyCameraContinueRoute'\)\.hidden=checkpoint\?\.type==='journey'/);
  assert.match(cancel,/journey_photo_canceled/);assert.match(cancel,/checkpointCamera\?\.abandon\(\)/);assert.match(cancel,/resolveManualFallback\(\{status:'canceled'\}\)/);
});

test('day-complete arrival evaluation is terminal without repeated failure logging',()=>{
  const body=functionBody('evaluateCheckpointArrival');assert.match(body,/status==='complete'/);assert.doesNotMatch(body,/reason:.*day-complete/);
});

test('successful automatic pair capture does not start a second hidden photo workflow',()=>{
  const body=functionBody('completeCurrentCheckpoint');
  assert.doesNotMatch(body,/!checkpoint\.photoRequired\s*&&\s*automatic[^;]*beginPhotoWorkflow/);
});

test('automatic finalization propagates both completed sides to fallback without completing the pair twice',()=>{
  const body=functionBody('captureAutomaticPair');
  assert.match(body,/finalizeRestoredPair/);
  assert.match(body,/partial:\{road:result\.road,rider:result\.rider\}/);
  assert.doesNotMatch(body,/markPairComplete/);
});

test('camera-failure journaling preserves incomplete evidence without bypassing the completion gate',()=>{
  const helper=functionBody('appendFailureJournalBestEffort'),arrival=functionBody('processDetectedCheckpointArrival'),expiry=functionBody('expireManualFallback'),completion=functionBody('completeCurrentCheckpoint');
  const highSpeedStart=arrival.indexOf("if(disposition==='camera_unavailable_high_speed')"),highSpeedEnd=arrival.indexOf('}else{',highSpeedStart),highSpeedBranch=arrival.slice(highSpeedStart,highSpeedEnd);
  assert.match(helper,/try\{return await appendRallyJournalEvent/);assert.match(helper,/catch\(error\)/);assert.match(helper,/return null/);
  assert.match(arrival,/await appendFailureJournalBestEffort\('camera_failure'/);assert.match(highSpeedBranch,/preserveIncompletePhotoEvidence/);assert.doesNotMatch(highSpeedBranch,/completeCurrentCheckpoint/);
  assert.match(expiry,/await appendFailureJournalBestEffort\('camera_failure'/);assert.match(expiry,/preserveIncompletePhotoEvidence/);assert.match(expiry,/resolveManualFallback\(\{status:'expired'\}\)/);
  assert.match(completion,/checkpointCompletionInFlight/);assert.match(completion,/photoComplete/);assert.doesNotMatch(completion,/acceptedPhotoFailure/);
});

test('unsafe Evidence cleanup starts a fresh pair before manual fallback',()=>{
  const arrival=functionBody('processDetectedCheckpointArrival'),journey=functionBody('requestJourneyPhoto');
  assert.match(arrival,/error\?\.requiresNewPair/);assert.match(arrival,/restartUnsafeCapturePair/);assert.match(arrival,/partial=\{\}/);
  assert.match(journey,/error\?\.requiresNewPair/);assert.match(journey,/restartUnsafeCapturePair/);assert.match(journey,/partial=\{\}/);
});

test('out-of-order objective failure explicitly restores its prior active target',()=>{
  const body=functionBody('failPendingPhotoObjective');assert.match(body,/pendingPhotoCheckpointId===checkpoint\.id\?pendingMediaObjective\?\.priorTargetId/);assert.match(body,/preserveActiveTarget:true/);assert.match(body,/state\.selectedId=priorTarget\.id/);
});
