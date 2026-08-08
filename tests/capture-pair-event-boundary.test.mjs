import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const functionBody=name=>source.slice(source.indexOf(`function ${name}`),source.indexOf('\n}',source.indexOf(`function ${name}`))+2);

test('checkpoint and hotel pair startup emits no legacy single-photo request',()=>{
  assert.doesNotMatch(functionBody('beginPhotoWorkflow'),/photo_requested/);assert.match(functionBody('captureCheckpointPair'),/photo_pair_requested/);
});

test('Journey Photos retain their single-camera request event',()=>{
  assert.match(functionBody('triggerCameraCapture'),/photo_requested/);assert.match(functionBody('addJourneyPhoto'),/objectiveType:'journey'/);
});

test('day-complete arrival evaluation is terminal without repeated failure logging',()=>{
  const body=functionBody('evaluateCheckpointArrival');assert.match(body,/status!=='complete'/);assert.doesNotMatch(body,/reason:.*day-complete/);
});
