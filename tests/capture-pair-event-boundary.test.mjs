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

test('camera-failure journaling is best effort and cannot block high-speed credit or fallback expiry',()=>{
  const helper=functionBody('appendFailureJournalBestEffort'),arrival=functionBody('processDetectedCheckpointArrival'),expiry=functionBody('expireManualFallback');
  assert.match(helper,/try\{return await appendRallyJournalEvent/);assert.match(helper,/catch\(error\)/);assert.match(helper,/return null/);
  assert.match(arrival,/await appendFailureJournalBestEffort\('camera_failure'/);assert.match(arrival,/camera_unavailable_high_speed/);assert.match(arrival,/completeCurrentCheckpoint/);
  assert.match(expiry,/await appendFailureJournalBestEffort\('camera_failure'/);assert.match(expiry,/resolveManualFallback\(\{status:'expired'\}\)/);
});

test('unsafe Evidence cleanup starts a fresh pair before manual fallback',()=>{
  const arrival=functionBody('processDetectedCheckpointArrival'),journey=functionBody('requestJourneyPhoto');
  assert.match(arrival,/error\?\.requiresNewPair/);assert.match(arrival,/restartUnsafeCapturePair/);assert.match(arrival,/partial=\{\}/);
  assert.match(journey,/error\?\.requiresNewPair/);assert.match(journey,/restartUnsafeCapturePair/);assert.match(journey,/partial=\{\}/);
});

test('out-of-order objective failure explicitly restores its prior active target',()=>{
  const body=functionBody('failPendingPhotoObjective');assert.match(body,/priorTargetId=pendingMediaObjective\?\.priorTargetId/);assert.match(body,/preserveActiveTarget:Boolean\(priorTarget\)/);assert.match(body,/state\.selectedId=priorTarget\.id/);
});
