import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PREFLIGHT_CAPABILITY,
  PREFLIGHT_STATUS,
  PreflightUserGestureRequiredError,
  createRallyDayPreflightService
} from '../src/application/rally-day-preflight-service.js';

function harness({gps={},camera={},storage={},offline={}}={}){
  const calls=[];
  const raw={
    gps:{supported:true,permission:'granted',active:true,fixReceived:true,...gps},
    camera:{permission:'granted',capability:'ready',automaticCaptureEligible:true,...camera},
    storage:{durableReady:true,persistenceStatus:'granted',persistenceRequestSupported:true,...storage},
    offline:{online:true,serviceWorkerSupported:true,cacheStorageSupported:true,registrationActive:true,verificationAvailable:true,cacheVerified:true,shellReady:true,cacheName:'current',...offline}
  };
  const adapter={
    inspectGps:async()=>structuredClone(raw.gps),
    inspectStorage:async()=>structuredClone(raw.storage),
    inspectOffline:async()=>structuredClone(raw.offline),
    requestGpsFromUserGesture(){calls.push('gps-action');raw.gps={...raw.gps,permission:'granted',active:true,fixReceived:true};return Promise.resolve();},
    requestStoragePersistenceFromUserGesture(){calls.push('storage-action');raw.storage={...raw.storage,persistenceStatus:'granted'};return Promise.resolve();},
    prepareOfflineFromUserGesture(){calls.push('offline-action');raw.offline={...raw.offline,registrationActive:true,cacheVerified:true,shellReady:true};return Promise.resolve();}
  };
  const cameraReadiness={
    state:()=>structuredClone(raw.camera),
    async inspect(){calls.push('camera-inspect');return raw.camera;},
    setupFromUserGesture(){calls.push('camera-action');raw.camera={...raw.camera,permission:'granted',capability:'ready',automaticCaptureEligible:true};return Promise.resolve(raw.camera);}
  };
  let tick=0;
  const service=createRallyDayPreflightService({adapter,cameraReadiness,clock:{iso:()=>`2026-08-17T12:00:0${tick++}.000Z`}});
  return {service,calls,raw};
}

test('all four verified capabilities produce READY without degraded acknowledgement',async()=>{
  const {service}=harness();
  const result=await service.inspect({projectId:'america-250',dayNumber:1,mode:'start'});
  assert.equal(result.status,PREFLIGHT_STATUS.READY);
  assert.equal(result.ready,true);
  assert.equal(result.proceedAllowed,true);
  assert.equal(result.canContinueDegraded,false);
  assert.deepEqual(Object.fromEntries(Object.entries(result.capabilities).map(([key,value])=>[key,value.status])),{gps:'READY',camera:'READY',storage:'READY',offline:'READY'});
});

test('fresh permission states require gestures and inspection never invokes actions',async()=>{
  const {service,calls}=harness({
    gps:{permission:'prompt',active:false,fixReceived:false},
    camera:{permission:'prompt',capability:'setup-required',automaticCaptureEligible:false}
  });
  const result=await service.inspect({projectId:'america-250',dayNumber:1});
  assert.equal(result.status,PREFLIGHT_STATUS.USER_GESTURE);
  assert.equal(result.proceedAllowed,false);
  assert.equal(result.capabilities.gps.action,'ENABLE_GPS');
  assert.equal(result.capabilities.camera.action,'ENABLE_CAMERA');
  assert.deepEqual(calls,['camera-inspect'],'camera inspection is non-interactive and no setup action ran');
});

test('denied camera and GPS states are BLOCKED and never reported READY',async()=>{
  const {service}=harness({
    gps:{permission:'denied',active:false,fixReceived:false,errorCode:1},
    camera:{permission:'denied',capability:'manual-only',automaticCaptureEligible:false,reasonCode:'permission-denied'}
  });
  const result=await service.inspect({projectId:'america-250',dayNumber:1});
  assert.equal(result.status,PREFLIGHT_STATUS.BLOCKED);
  assert.equal(result.ready,false);
  assert.equal(result.proceedAllowed,false);
  assert.equal(result.capabilities.gps.status,PREFLIGHT_STATUS.BLOCKED);
  assert.equal(result.capabilities.camera.status,PREFLIGHT_STATUS.BLOCKED);
});

test('manual-only camera is an explicit platform gesture mode rather than false readiness',async()=>{
  const {service}=harness({camera:{permission:'unknown',capability:'manual-only',automaticCaptureEligible:false,reasonCode:'image-capture-unsupported'}});
  const result=await service.inspect({projectId:'america-250',dayNumber:1});
  assert.equal(result.status,PREFLIGHT_STATUS.USER_GESTURE);
  assert.equal(result.capabilities.camera.status,PREFLIGHT_STATUS.USER_GESTURE);
  assert.equal(result.capabilities.camera.manualOnly,true);
  assert.equal(result.capabilities.camera.action,null);
});

test('storage and offline setup remain explicit actions',async()=>{
  const {service}=harness({
    storage:{persistenceStatus:'not-granted'},
    offline:{registrationActive:false,cacheVerified:false,shellReady:false}
  });
  const result=await service.inspect({projectId:'america-250',dayNumber:1});
  assert.equal(result.status,PREFLIGHT_STATUS.ACTION_REQUIRED);
  assert.equal(result.capabilities.storage.status,PREFLIGHT_STATUS.READY);
  assert.equal(result.capabilities.storage.operationalReady,true);
  assert.equal(result.capabilities.storage.persistenceProtected,false);
  assert.equal(result.capabilities.storage.action,'PROTECT_STORAGE');
  assert.equal(result.capabilities.offline.action,'PREPARE_OFFLINE');
});

test('capability actions require an explicit user gesture and re-inspect after direct invocation',async()=>{
  const {service,calls}=harness({gps:{permission:'prompt',active:false,fixReceived:false}});
  const scope={projectId:'america-250',dayNumber:1};
  await service.inspect(scope);
  await assert.rejects(service.act(PREFLIGHT_CAPABILITY.GPS,{scope}),PreflightUserGestureRequiredError);
  assert.equal(calls.includes('gps-action'),false);
  const result=await service.act(PREFLIGHT_CAPABILITY.GPS,{scope,userGesture:true});
  assert.equal(calls.includes('gps-action'),true);
  assert.equal(result.capabilities.gps.status,PREFLIGHT_STATUS.READY);
});

test('camera setup is invoked directly from the gesture action and becomes READY',async()=>{
  const {service,calls}=harness({camera:{permission:'prompt',capability:'setup-required',automaticCaptureEligible:false}});
  const scope={projectId:'america-250',dayNumber:1};
  await service.inspect(scope);
  calls.length=0;
  const result=await service.act(PREFLIGHT_CAPABILITY.CAMERA,{scope,userGesture:true});
  assert.equal(calls[0],'camera-action','camera setup must start before the follow-up inspection');
  assert.deepEqual(calls,['camera-action'],'a completed camera action must not immediately reopen the cameras for another probe');
  assert.equal(result.capabilities.camera.status,PREFLIGHT_STATUS.READY);
});

test('deliberate degraded continuation does not trap the rider and is scoped to one day',async()=>{
  const {service}=harness({camera:{permission:'denied',capability:'manual-only',automaticCaptureEligible:false,reasonCode:'permission-denied'}});
  const day1={projectId:'america-250',dayNumber:1,mode:'start'};
  await service.inspect(day1);
  assert.throws(()=>service.continueDegraded({scope:day1}),PreflightUserGestureRequiredError);
  const accepted=service.continueDegraded({scope:day1,userGesture:true});
  assert.equal(accepted.proceedAllowed,true);
  assert.equal(accepted.degradedAcknowledged,true);
  assert.match(accepted.degradedAcknowledgedAt,/2026-08-17/);
  const day2=await service.inspect({projectId:'america-250',dayNumber:2,mode:'start'});
  assert.equal(day2.proceedAllowed,false);
  assert.equal(day2.degradedAcknowledged,false);
});

test('concurrent inspection cannot return a stale day scope after a fast day change',async()=>{
  const {service}=harness();
  const day1=service.inspect({projectId:'america-250',dayNumber:1});
  const day2=service.inspect({projectId:'america-250',dayNumber:2});
  assert.equal((await day1).scope.dayNumber,1);
  assert.equal((await day2).scope.dayNumber,2);
  assert.equal(service.state().scope.dayNumber,2);
});

test('inspection failures are UNKNOWN and can still be acknowledged deliberately',async()=>{
  const {service}=harness();
  const broken={inspectGps:async()=>{throw new Error('GPS inspection failed');},inspectStorage:async()=>{throw new Error('storage failed');},inspectOffline:async()=>{throw new Error('cache failed');}};
  const fallback=createRallyDayPreflightService({adapter:broken,cameraReadiness:{state:()=>({}),inspect:async()=>{throw new Error('camera failed');}}});
  const result=await fallback.inspect({projectId:'america-250',dayNumber:1});
  assert.equal(result.status,PREFLIGHT_STATUS.UNKNOWN);
  assert.ok(Object.values(result.capabilities).every(item=>item.status===PREFLIGHT_STATUS.UNKNOWN));
  assert.equal(fallback.continueDegraded({scope:result.scope,userGesture:true}).proceedAllowed,true);
  assert.equal(service.state(),null);
});
