import test from 'node:test';
import assert from 'node:assert/strict';
import {createFeatureFlags} from '../src/core/feature-flags.js';
import {createObservationCapture,OBSERVATION_CAPTURE_FEATURE_FLAG} from '../src/application/observation-capture.js';
import {normalizePositionSample,stableObservationId,OBSERVATION_SCHEMA_VERSION,OBSERVATION_ALGORITHM_VERSION} from '../src/domain/observations/contract.js';
import {assessObservationQuality} from '../src/domain/observations/quality.js';
import {shouldSuppressSample} from '../src/domain/observations/sampling.js';
import {transitionCaptureState} from '../src/domain/observations/state-machine.js';

const clock={now:()=>10_000,iso:()=>new Date(10_000).toISOString()};
const context={eventId:'15',riderId:'rider-1',deviceSessionId:'device-1',sequence:7,captureSource:'test'};
const sample={timestamp:9_500,coords:{latitude:40,longitude:-105,accuracy:12,altitude:1500,heading:90,speed:4}};

function harness({enabled=true,append}={}){
  const records=[],items=[];
  const persistence={
    append:append||(async value=>{records.push(value.observation);items.push(value.outboxItem);return {};}),
    pending:async()=>items.filter(item=>item.state==='pending'),
    acknowledge:async key=>{items.find(item=>item.idempotencyKey===key).state='acknowledged';}
  };
  const featureFlags=createFeatureFlags({read:key=>enabled&&key===OBSERVATION_CAPTURE_FEATURE_FLAG});
  return {capture:createObservationCapture({clock,featureFlags,persistence}),records,items};
}

test('normalizes browser geolocation without mixing derived fields into observed evidence',()=>{
  const normalized=normalizePositionSample(sample);
  assert.deepEqual(normalized.location,{lat:40,lon:-105});
  assert.equal(normalized.accuracyMeters,12);
  assert.equal(normalized.headingDegrees,90);
  assert.equal('quality' in normalized,false);
});

test('quality assessment accepts, degrades, and rejects deterministic samples',()=>{
  assert.equal(assessObservationQuality(normalizePositionSample(sample),{nowMs:10_000}).classification,'accepted');
  assert.equal(assessObservationQuality(normalizePositionSample({...sample,coords:{...sample.coords,accuracy:75}}),{nowMs:10_000}).classification,'degraded');
  assert.deepEqual(assessObservationQuality(normalizePositionSample({...sample,timestamp:0}),{nowMs:20_000}).reasons,['stale']);
});

test('stable IDs derive from capture identity and timestamp',()=>{
  const first=stableObservationId({...context,timestampMs:9_500});
  assert.equal(first,stableObservationId({...context,timestampMs:9_500}));
  assert.notEqual(first,stableObservationId({...context,sequence:8,timestampMs:9_500}));
});

test('capture flag defaults off and performs no persistence',async()=>{
  const {capture,records}=harness({enabled:false});
  assert.deepEqual(await capture.capture(sample,context),{status:'disabled'});
  assert.equal(records.length,0);
});

test('capture persists a versioned append-only record and matching atomic outbox item',async()=>{
  const {capture,records,items}=harness();
  const result=await capture.capture(sample,context);
  assert.equal(result.status,'persisted');
  assert.equal(records.length,1);
  assert.equal(items.length,1);
  assert.equal(records[0].schemaVersion,OBSERVATION_SCHEMA_VERSION);
  assert.equal(records[0].algorithmVersion,OBSERVATION_ALGORITHM_VERSION);
  assert.equal(records[0].occurredAt,9_500);
  assert.equal(records[0].derived.quality.classification,'accepted');
  assert.equal('inference' in records[0],false);
  assert.equal(items[0].idempotencyKey,`observation:15:${records[0].observationId}`);
});

test('invalid and stale samples are rejected with structured bounded diagnostics',async()=>{
  const {capture,records}=harness();
  const result=await capture.capture({timestamp:0,coords:{latitude:200,longitude:0,accuracy:10}},context);
  assert.equal(result.status,'rejected');
  assert.equal(records.length,0);
  assert.equal(capture.diagnostics()[0].code,'sample-rejected');
});

test('missing geolocation is rejected without persistence or an exception',async()=>{
  const {capture,records}=harness();
  const result=await capture.capture(undefined,context);
  assert.equal(result.status,'rejected');
  assert.equal(records.length,0);
  assert.deepEqual(result.quality.reasons,['invalid-location','missing-timestamp','invalid-accuracy']);
});

test('sampling suppresses only close samples inside the minimum interval',()=>{
  const first=normalizePositionSample(sample);
  assert.equal(shouldSuppressSample(first,normalizePositionSample({...sample,timestamp:10_500}),{minimumIntervalMs:2000,duplicateRadiusMeters:5}),true);
  assert.equal(shouldSuppressSample(first,normalizePositionSample({...sample,timestamp:12_000}),{minimumIntervalMs:2000,duplicateRadiusMeters:5}),false);
});

test('duplicate persistence is reported as an idempotent success',async()=>{
  const {capture}=harness({append:async()=>({duplicate:true})});
  const result=await capture.capture(sample,context);
  assert.equal(result.status,'persisted');
  assert.equal(result.duplicate,true);
});

test('persistence failures are contained and do not retry without a caller decision',async()=>{
  let attempts=0;
  const {capture}=harness({append:async()=>{attempts++;throw new Error('offline failure');}});
  const result=await capture.capture(sample,context);
  assert.equal(result.status,'failed');
  assert.equal(attempts,1);
  assert.equal(capture.diagnostics().at(-1).code,'capture-persistence-failed');
});

test('recovery counts durable pending work and replay acknowledges bounded deliveries',async()=>{
  const {capture,items}=harness();
  await capture.capture(sample,context);
  assert.deepEqual(await capture.recover(),{status:'ready',pending:1});
  const delivered=[];
  const replayed=await capture.replay({deliver:async item=>{delivered.push(item.idempotencyKey);return {accepted:true};},maxItems:1});
  assert.equal(replayed.delivered,1);
  assert.equal(items[0].state,'acknowledged');
});

test('capture lifecycle accepts only explicit transitions',()=>{
  assert.equal(transitionCaptureState('idle','assessing'),'assessing');
  assert.equal(transitionCaptureState('assessing','persisting'),'persisting');
  assert.equal(transitionCaptureState('persisting','persisted'),'persisted');
  assert.throws(()=>transitionCaptureState('idle','persisted'),/Invalid observation capture transition/);
});
