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

test('starts persistence for every accepted hit before serialized media processing finishes',async()=>{
  const persistenceStarted=[],processed=[];
  let releaseFirst;
  const firstBlocked=new Promise(resolve=>{releaseFirst=resolve;});
  let firstStarted;
  const processingStarted=new Promise(resolve=>{firstStarted=resolve;});
  const coordinator=createCheckpointArrivalCoordinator({
    dwellMs:0,
    persistArrival(arrival){
      persistenceStarted.push(arrival.checkpointId);
      return {arrivalRecordId:`arrival:${arrival.checkpointId}`};
    },
    async processArrival(arrival,persistenceResult){
      processed.push({checkpointId:arrival.checkpointId,persistenceResult});
      if(arrival.checkpointId==='cp-1'){firstStarted();await firstBlocked;}
    }
  });

  coordinator.observe({
    observedAt:6000,
    detections:[detection('cp-2',10),detection('cp-1',10),detection('cp-3',10)]
  });
  assert.deepEqual(persistenceStarted,['cp-2','cp-1','cp-3'],'all accepted arrivals begin persistence synchronously at enqueue time');
  await processingStarted;
  assert.deepEqual(processed.map(item=>item.checkpointId),['cp-1'],'media processing remains serialized while later persistence has already started');
  releaseFirst();
  await coordinator.whenIdle();
  assert.deepEqual(processed,[
    {checkpointId:'cp-1',persistenceResult:{arrivalRecordId:'arrival:cp-1'}},
    {checkpointId:'cp-2',persistenceResult:{arrivalRecordId:'arrival:cp-2'}},
    {checkpointId:'cp-3',persistenceResult:{arrivalRecordId:'arrival:cp-3'}}
  ]);
});

test('persistence failure reports the arrival and never enters its media processor',async()=>{
  const processed=[],errors=[];
  const coordinator=createCheckpointArrivalCoordinator({
    dwellMs:0,
    persistArrival(arrival){
      if(arrival.checkpointId==='cp-2')return Promise.reject(new Error('arrival storage unavailable'));
      return `persisted:${arrival.checkpointId}`;
    },
    async processArrival(arrival,persistenceResult){processed.push([arrival.checkpointId,persistenceResult]);},
    async onError(error,arrival){errors.push([arrival.checkpointId,error.message]);}
  });

  coordinator.observe({observedAt:7000,detections:[detection('cp-1',10),detection('cp-2',10),detection('cp-3',10)]});
  await coordinator.whenIdle();

  assert.deepEqual(processed,[['cp-1','persisted:cp-1'],['cp-3','persisted:cp-3']]);
  assert.deepEqual(errors,[['cp-2','arrival storage unavailable']]);
  assert.deepEqual(coordinator.state().handledCheckpointIds,['cp-1','cp-3'],'an unpersisted hit is not marked handled or credited');
});

test('destroy drains persistence already started for arrivals discarded behind an active processor',async()=>{
  let releaseProcessing,releaseSecondPersistence,processingStarted;
  const processingBlocked=new Promise(resolve=>{releaseProcessing=resolve;}),secondPersistenceBlocked=new Promise(resolve=>{releaseSecondPersistence=resolve;}),started=new Promise(resolve=>{processingStarted=resolve;});
  const coordinator=createCheckpointArrivalCoordinator({
    dwellMs:0,
    persistArrival(arrival){return arrival.checkpointId==='cp-2'?secondPersistenceBlocked:`stored:${arrival.checkpointId}`;},
    async processArrival(arrival){if(arrival.checkpointId==='cp-1'){processingStarted();await processingBlocked;}}
  });
  coordinator.observe({observedAt:8000,detections:[detection('cp-1',5),detection('cp-2',6)]});
  await started;coordinator.destroy();let idle=false;const waiting=coordinator.whenIdle().then(()=>{idle=true;});
  releaseProcessing();await Promise.resolve();await Promise.resolve();assert.equal(idle,false,'discarding cp-2 must not forget its in-flight durable arrival write');
  releaseSecondPersistence('stored:cp-2');await waiting;assert.equal(idle,true);
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
