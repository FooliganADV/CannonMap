import test from 'node:test';
import assert from 'node:assert/strict';
import {validateObservationIngress,expectedIdempotencyKey} from '../src/domain/observations/ingestion-contract.js';
import {createIngestObservation} from '../functions/src/ingest-observation.js';
import {createSecureObservationUploader} from '../src/application/secure-observation-upload.js';

const NOW=1_800_000_000_000;
const observation=(overrides={})=>({
  schemaVersion:1,algorithmVersion:'capture-v1',eventId:'event-250',observationId:'obs-1',
  riderId:'local-rider',checkpointId:null,deviceSessionId:'device-1',sequence:1,
  occurredAt:NOW-1000,createdAt:new Date(NOW-1000).toISOString(),updatedAt:new Date(NOW-1000).toISOString(),
  captureSource:'browser.geolocation',lifecycleState:'captured',syncState:'pending',
  nextAttemptAt:new Date(NOW).toISOString(),
  observed:{timestampMs:NOW-1000,location:{lat:35.2,lon:-82.1},accuracyMeters:8,
    altitudeMeters:null,altitudeAccuracyMeters:null,headingDegrees:null,speedMetersPerSecond:0},
  derived:{quality:{classification:'accepted',score:0.992,reasons:[],inputs:{ageMs:1000,accuracyMeters:8}}},evidenceRefs:['observation:event-250:obs-1'],
  ...overrides
});
const key='observation:event-250:obs-1';

function repository(){
  const receipts=new Map(),observations=new Map(),quota=new Map();
  return {
    receipts,observations,
    async getReceipt(uid,id){return receipts.get(`${uid}:${id}`)||null;},
    async reserve(record){
      const entryKey=`${record.uid}:${record.receiptId}`;
      if(receipts.has(entryKey))return {acquired:false,receipt:receipts.get(entryKey)};
      const receipt={...record,status:'processing'};receipts.set(entryKey,receipt);
      return {acquired:true,receipt};
    },
    async consumeQuota({uid,eventId,bucket,limit}){
      const quotaKey=`${uid}:${eventId}:${bucket}`,count=quota.get(quotaKey)||0;
      if(count>=limit)return false;
      quota.set(quotaKey,count+1);return true;
    },
    async reject({uid,receiptId,reason}){receipts.set(`${uid}:${receiptId}`,{...receipts.get(`${uid}:${receiptId}`),status:'rejected',reason});},
    async commitImmutable({uid,observation:record,receipt}){
      const observationKey=`${record.eventId}:${uid}:${record.observationId}`;
      if(observations.has(observationKey))return {created:false,receipt};
      observations.set(observationKey,record);receipts.set(`${uid}:${receipt.receiptId}`,receipt);
      return {created:true,receipt};
    }
  };
}

test('ingestion contract accepts the M5 observation schema',()=>{
  assert.deepEqual(validateObservationIngress(observation(),{nowMs:NOW,idempotencyKey:key}),{valid:true,errors:[]});
  assert.equal(expectedIdempotencyKey(observation()),key);
});

for(const [name,mutate,expected] of [
  ['schema version',record=>({...record,schemaVersion:2}),'unsupported schemaVersion'],
  ['allowed keys',record=>({...record,admin:true}),'unsupported keys'],
  ['future timestamp',record=>({...record,occurredAt:NOW+6*60*1000,observed:{...record.observed,timestampMs:NOW+6*60*1000}}),'accepted window'],
  ['latitude bounds',record=>({...record,observed:{...record.observed,location:{lat:91,lon:0}}}),'latitude'],
  ['speed bounds',record=>({...record,observed:{...record.observed,speedMetersPerSecond:201}}),'speed'],
  ['idempotency mismatch',record=>record,'idempotency key']
]){
  test(`ingestion contract rejects invalid ${name}`,()=>{
    const result=validateObservationIngress(mutate(observation()),{nowMs:NOW,idempotencyKey:name==='idempotency mismatch'?'wrong':key});
    assert.equal(result.valid,false);assert.match(result.errors.join(' '),new RegExp(expected));
  });
}

test('secure ingest requires authentication and App Check',async()=>{
  const ingest=createIngestObservation({repository:repository(),clock:()=>NOW});
  assert.equal((await ingest({observation:observation(),idempotencyKey:key})).status,401);
  assert.equal((await ingest({auth:{uid:'u1'},observation:observation(),idempotencyKey:key})).status,401);
});

test('secure ingest sets server ownership and returns a receipt',async()=>{
  const store=repository(),ingest=createIngestObservation({repository:store,clock:()=>NOW});
  const result=await ingest({auth:{uid:'u1'},appCheck:{appId:'app'},observation:observation(),idempotencyKey:key});
  assert.equal(result.status,200);assert.equal(result.replayed,false);assert.equal(result.receipt.status,'accepted');
  assert.equal([...store.observations.values()][0].ownerUid,'u1');
});

test('replay returns the same receipt without a duplicate observation',async()=>{
  const store=repository(),ingest=createIngestObservation({repository:store,clock:()=>NOW});
  const request={auth:{uid:'u1'},appCheck:{appId:'app'},observation:observation(),idempotencyKey:key};
  const first=await ingest(request),second=await ingest(request);
  assert.equal(second.status,200);assert.equal(second.replayed,true);
  assert.equal(second.receipt.receiptId,first.receipt.receiptId);assert.equal(store.observations.size,1);
});

test('immutable observation identifiers cannot replace accepted data',async()=>{
  const store=repository(),ingest=createIngestObservation({repository:store,clock:()=>NOW});
  const request={auth:{uid:'u1'},appCheck:{appId:'app'},observation:observation(),idempotencyKey:key};
  await ingest(request);
  const changed=await ingest({...request,observation:observation({observed:{...observation().observed,location:{lat:1,lon:1}}})});
  assert.equal(changed.replayed,true);assert.equal([...store.observations.values()][0].observed.location.lat,35.2);
});

test('per-user event quota rejects abuse independently by owner',async()=>{
  const store=repository(),ingest=createIngestObservation({repository:store,clock:()=>NOW,quota:1});
  const first={auth:{uid:'u1'},appCheck:{appId:'app'},observation:observation(),idempotencyKey:key};
  assert.equal((await ingest(first)).status,200);
  const secondObservation=observation({observationId:'obs-2',sequence:2,evidenceRefs:['observation:event-250:obs-2']});
  assert.equal((await ingest({...first,observation:secondObservation,idempotencyKey:'observation:event-250:obs-2'})).status,429);
  assert.equal((await ingest({...first,auth:{uid:'u2'},observation:secondObservation,idempotencyKey:'observation:event-250:obs-2'})).status,200);
});

test('request size limit is enforced before persistence',async()=>{
  const ingest=createIngestObservation({repository:repository(),clock:()=>NOW});
  const result=await ingest({auth:{uid:'u1'},appCheck:{appId:'app'},observation:observation(),idempotencyKey:key,requestBytes:40000});
  assert.equal(result.status,413);
});

test('uploader stays disabled without touching authentication or local data',async()=>{
  let touched=false;
  const uploader=createSecureObservationUploader({
    featureFlags:{isEnabled:()=>false},clock:{now:()=>NOW},
    authentication:{initialize:async()=>{touched=true;},credentials:async()=>{touched=true;}},
    observations:{get:async()=>{touched=true;}},transport:{ingest:async()=>{touched=true;}}
  });
  assert.deepEqual(await uploader.initialize(),{status:'disabled'});assert.equal(touched,false);
});

test('uploader uses the existing observation adapter and preserves normalized records',async()=>{
  const record=observation(),before=structuredClone(record);
  const uploader=createSecureObservationUploader({
    featureFlags:{isEnabled:()=>true},clock:{now:()=>NOW},
    authentication:{initialize:async()=>{},credentials:async()=>({uid:'u1',authToken:'token',appCheckToken:'check'})},
    observations:{get:async()=>record},
    transport:{ingest:async request=>({receiptId:'receipt-1',sent:request.observation===record})}
  });
  await uploader.initialize();
  assert.deepEqual(await uploader.deliver({eventId:'event-250',observationId:'obs-1',idempotencyKey:key}),{receiptId:'receipt-1',sent:true});
  assert.deepEqual(record,before);
});
