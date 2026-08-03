import assert from 'node:assert/strict';import test from 'node:test';import {evaluateArrivalSample} from '../src/domain/checkpoints/arrival.js';
const base={checkpointId:'cp',distanceFeet:100,accuracyFeet:20,radiusFeet:500,maxAccuracyFeet:200,now:1000};

test('valid active checkpoint accepts after bounded dwell and cannot infer duplicate state',()=>{
  const first=evaluateArrivalSample(base);assert.equal(first.decision,'candidate');
  const accepted=evaluateArrivalSample({...base,candidate:first.candidate,now:3001});assert.equal(accepted.decision,'accepted');assert.equal(accepted.candidate,null);
});

test('poor GPS accuracy requests retry without destroying a valid arrival candidate',()=>{
  const candidate={checkpointId:'cp',enteredAt:1000},poor=evaluateArrivalSample({...base,accuracyFeet:500,candidate,now:2000});
  assert.equal(poor.decision,'retry');assert.deepEqual(poor.candidate,candidate);
  const recovered=evaluateArrivalSample({...base,candidate:poor.candidate,now:3001});assert.equal(recovered.decision,'accepted');
});

test('leaving the accuracy-adjusted radius clears the candidate',()=>{
  const result=evaluateArrivalSample({...base,distanceFeet:600,candidate:{checkpointId:'cp',enteredAt:1}});assert.equal(result.reason,'outside-radius');assert.equal(result.candidate,null);
});
