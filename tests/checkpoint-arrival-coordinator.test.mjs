import assert from 'node:assert/strict';
import test from 'node:test';
import {createCheckpointArrivalCoordinator} from '../src/application/checkpoint-arrival-coordinator.js';

const detection=(checkpointId,distanceFeet,extra={})=>({
  checkpointId,distanceFeet,accuracyFeet:12,radiusFeet:100,...extra
});

test('keeps independent dwell state and queues close checkpoint hits deterministically',()=>{
  const coordinator=createCheckpointArrivalCoordinator({dwellMs:1000});
  const gps={lat:40,lon:-90,accuracyFeet:12};
  const first=coordinator.observe({
    observedAt:1000,priorTargetId:'cp-37',speedMph:22,gpsEvidence:gps,
    detections:[detection('cp-42',30),detection('cp-41',20),detection('cp-41',10)]
  });
  gps.lat=99;
  assert.deepEqual(first.started,['cp-42','cp-41']);
  const second=coordinator.observe({
    observedAt:2001,priorTargetId:'changed-target',speedMph:24,
    gpsEvidence:{lat:40.0001,lon:-90},
    detections:[detection('cp-42',8),detection('cp-41',8)]
  });
  assert.equal(second.accepted.length,2);
  assert.deepEqual(second.accepted.map(item=>item.checkpointId),['cp-41','cp-42']);
  const cp41=coordinator.takeNext(),cp42=coordinator.takeNext();
  assert.equal(cp41.checkpointId,'cp-41');
  assert.equal(cp42.checkpointId,'cp-42');
  assert.equal(cp41.priorTargetId,'cp-37','prior target is frozen when dwell begins');
  assert.equal(cp41.outOfOrder,true);
  assert.equal(cp41.evidence.entry.lat,40,'source evidence mutation cannot alter the arrival');
  assert.equal(cp41.speedMph,24);
  assert.ok(Object.isFrozen(cp41));
  assert.ok(Object.isFrozen(cp41.evidence));
});

test('deduplicates accepted checkpoints and serializes asynchronous processing',async()=>{
  let active=0,maxActive=0;
  const processed=[];
  const coordinator=createCheckpointArrivalCoordinator({
    dwellMs:0,
    async processArrival(arrival){
      active++;
      maxActive=Math.max(maxActive,active);
      processed.push(arrival.checkpointId);
      await Promise.resolve();
      active--;
    }
  });
  coordinator.observe({
    observedAt:5000,
    detections:[detection('cp-2',10),detection('cp-10',10),detection('cp-1',10)]
  });
  coordinator.observe({observedAt:5001,detections:[detection('cp-1',5)]});
  await coordinator.whenIdle();
  assert.equal(maxActive,1);
  assert.deepEqual(processed,['cp-1','cp-2','cp-10']);
  assert.deepEqual(coordinator.state().handledCheckpointIds,['cp-1','cp-2','cp-10']);
});

test('poor accuracy preserves each candidate while leaving the radius clears only that checkpoint',()=>{
  const coordinator=createCheckpointArrivalCoordinator({dwellMs:1000,maxAccuracyFeet:100});
  coordinator.observe({observedAt:1000,detections:[detection('a',20),detection('b',20)]});
  const poor=coordinator.observe({
    observedAt:2200,
    detections:[detection('a',20,{accuracyFeet:300}),detection('b',250)]
  });
  assert.equal(poor.accepted.length,0);
  assert.equal(coordinator.state().candidates.length,1);
  assert.equal(coordinator.state().candidates[0].checkpointId,'a');
  const recovered=coordinator.observe({observedAt:2300,detections:[detection('a',15)]});
  assert.equal(recovered.accepted[0].checkpointId,'a');
});

test('explicit release permits a checkpoint to be detected again',()=>{
  const coordinator=createCheckpointArrivalCoordinator({dwellMs:0});
  coordinator.observe({observedAt:1000,detections:[detection('cp',5)]});
  assert.equal(coordinator.takeNext().checkpointId,'cp');
  assert.equal(coordinator.observe({observedAt:1001,detections:[detection('cp',5)]}).accepted.length,0);
  coordinator.release('cp');
  assert.equal(coordinator.observe({observedAt:1002,detections:[detection('cp',5)]}).accepted.length,1);
});
