import assert from 'node:assert/strict';
import test from 'node:test';
import {AutomaticCameraNotReadyError,createCameraReadinessService} from '../src/application/camera-readiness-service.js';

function fakeAdapter({permission='prompt',capabilities={},probeError=null,sessionReady=true}={}){
  let permissionListener=null,probeCalls=0,queryCalls=0;const callOrder=[];
  const adapter={
    capabilities:{permissionQuerySupported:true,getUserMediaSupported:true,imageCaptureSupported:true,...capabilities},
    async queryPermission(){queryCalls++;callOrder.push('query');return {state:permission};},
    async probeCameras(){probeCalls++;callOrder.push('probe');if(probeError)throw probeError;sessionReady=true;return {ready:true,probes:[{cameraRole:'rear'},{cameraRole:'front'}]};},
    cameraSessionReady(){return sessionReady;},
    classifyError(error){return error.classification||{code:error.code||'CAMERA_STREAM_INTERRUPTED',capabilityState:'interrupted',retryable:true};},
    subscribePermissionChange(listener){permissionListener=listener;return ()=>{permissionListener=null;};},
    setPermission(value){permission=value;permissionListener?.(value);},setSessionReady(value){sessionReady=value;},
    calls(){return {probeCalls,queryCalls,callOrder:[...callOrder]};}
  };
  return adapter;
}

const clock=()=>{let tick=0;return {iso:()=>`2026-08-13T12:00:0${tick++}.000Z`};};

test('fresh prompt state requires setup and inspection never opens a camera stream',async()=>{
  const adapter=fakeAdapter({permission:'prompt'}),events=[];
  const service=createCameraReadinessService({adapter,clock:clock(),onDiagnostic:event=>events.push(event)});
  const state=await service.inspect();
  assert.equal(state.permission,'prompt');
  assert.equal(state.capability,'setup-required');
  assert.equal(state.automaticCaptureEligible,false);
  assert.equal(state.reasonCode,'permission-setup-required');
  assert.deepEqual(Object.keys(state).sort(),[
    'automaticCaptureEligible','capability','getUserMediaSupported','imageCaptureSupported','lastVerifiedAt','permission',
    'permissionQuerySupported','priorSetupSucceeded','reasonCode','setupAttemptedThisSession'
  ].sort());
  assert.deepEqual(adapter.calls(),{probeCalls:0,queryCalls:1,callOrder:['query']});
  assert.throws(()=>service.assertAutomaticCaptureEligible(),AutomaticCameraNotReadyError);
  assert.ok(events.some(event=>event.eventType==='camera_permission_state'));
});

test('unknown permission without prior grant hint also waits for a user gesture',async()=>{
  const adapter=fakeAdapter({permission:'unknown'});
  const service=createCameraReadinessService({adapter});
  const state=await service.inspect();
  assert.equal(state.capability,'setup-required');
  assert.equal(state.reasonCode,'permission-unknown-setup-required');
  assert.equal(adapter.calls().probeCalls,0);
});

test('explicit user-gesture setup verifies both cameras and makes automatic capture eligible',async()=>{
  const adapter=fakeAdapter({permission:'prompt'}),persisted=[];
  const service=createCameraReadinessService({adapter,clock:clock(),persistSetupSucceeded:value=>persisted.push(value)});
  await service.inspect();
  const state=await service.setupFromUserGesture();
  assert.equal(state.setupAttemptedThisSession,true);
  assert.equal(state.permission,'granted');
  assert.equal(state.capability,'ready');
  assert.equal(state.automaticCaptureEligible,true);
  assert.equal(service.assertAutomaticCaptureEligible().capability,'ready');
  assert.equal(adapter.calls().probeCalls,1);
  assert.deepEqual(adapter.calls().callOrder,['query','probe','query'],'the explicit setup tap reaches getUserMedia before another permission query');
  assert.deepEqual(persisted,[true]);
});

test('a previous grant hint permits controlled verification when permission query is unknown',async()=>{
  const adapter=fakeAdapter({permission:'unknown'});
  const service=createCameraReadinessService({adapter,priorSetupSucceeded:true});
  const state=await service.inspect();
  assert.equal(state.automaticCaptureEligible,true);
  assert.equal(adapter.calls().probeCalls,1);
});

test('forced inspection re-queries a ready permission without reopening camera streams',async()=>{
  const adapter=fakeAdapter({permission:'granted'});
  const service=createCameraReadinessService({adapter});
  await service.inspect();
  assert.equal(adapter.calls().probeCalls,1);
  const state=await service.inspect({force:true});
  assert.equal(state.automaticCaptureEligible,true);
  assert.equal(state.capability,'ready');
  assert.equal(adapter.calls().probeCalls,1);
  assert.equal(adapter.calls().queryCalls,3);
});

test('failed Permissions API query is exposed as operationally unsupported',async()=>{
  const base=fakeAdapter({permission:'unknown'});
  base.queryPermission=async()=>({state:'unknown',querySupported:false,reasonCode:'PERMISSION_QUERY_FAILED'});
  const service=createCameraReadinessService({adapter:base});
  const state=await service.inspect();
  assert.equal(state.permission,'unknown');
  assert.equal(state.permissionQuerySupported,false);
  assert.equal(state.capability,'setup-required');
});

test('a live prompt result overrides a prior successful setup hint',async()=>{
  const adapter=fakeAdapter({permission:'prompt'});
  const service=createCameraReadinessService({adapter,priorSetupSucceeded:true});
  const state=await service.inspect();
  assert.equal(state.permission,'prompt');
  assert.equal(state.capability,'setup-required');
  assert.equal(adapter.calls().probeCalls,0);
});

test('permission denial is explicit and is not repeatedly probed',async()=>{
  const adapter=fakeAdapter({permission:'denied'}),hints=[];
  const service=createCameraReadinessService({adapter,persistSetupSucceeded:value=>hints.push(value)});
  const inspected=await service.inspect();
  assert.equal(inspected.permission,'denied');
  assert.equal(inspected.capability,'manual-only');
  assert.equal(inspected.reasonCode,'permission-denied');
  assert.equal(adapter.calls().probeCalls,0);
  const setup=await service.setupFromUserGesture();
  assert.equal(setup.reasonCode,'permission-denied');
  assert.equal(adapter.calls().probeCalls,0);
  assert.deepEqual(hints,[]);
});

test('missing ImageCapture becomes intentional manual-only mode',async()=>{
  const adapter=fakeAdapter({permission:'prompt',capabilities:{imageCaptureSupported:false}});
  const service=createCameraReadinessService({adapter});
  const state=await service.inspect();
  assert.equal(state.capability,'manual-only');
  assert.equal(state.reasonCode,'image-capture-unsupported');
  assert.equal(adapter.calls().queryCalls,0);
  assert.equal(adapter.calls().probeCalls,0);
});

test('permission status change immediately revokes a previously ready state',async()=>{
  const adapter=fakeAdapter({permission:'granted'});
  const service=createCameraReadinessService({adapter});
  assert.equal((await service.inspect()).automaticCaptureEligible,true);
  adapter.setPermission('prompt');
  assert.equal(service.state().automaticCaptureEligible,false);
  assert.equal(service.state().capability,'setup-required');
  assert.equal(service.state().reasonCode,'permission-changed-reverify');
  adapter.setPermission('denied');
  assert.equal(service.state().permission,'denied');
  assert.equal(service.state().capability,'manual-only');
  assert.equal(service.state().reasonCode,'permission-denied');
});

test('capture failures revoke readiness and preserve a serializable diagnostic',async()=>{
  const adapter=fakeAdapter({permission:'granted'}),events=[];
  const service=createCameraReadinessService({adapter,onDiagnostic:event=>events.push(event)});
  await service.inspect();
  const failure=new Error('camera was suspended');
  failure.name='NotReadableError';
  const state=await service.noteCaptureFailure(failure,{requestedCamera:'rear'});
  assert.equal(state.automaticCaptureEligible,false);
  assert.equal(state.capability,'interrupted');
  assert.equal(state.reasonCode,'camera-stream-interrupted');
  assert.doesNotThrow(()=>JSON.stringify(events));
  assert.ok(events.some(event=>event.eventType==='camera_capture_failure_classified'&&event.requestedCamera==='rear'));
});

test('successful checkpoint capture refreshes readiness verification',async()=>{
  const adapter=fakeAdapter({permission:'granted'}),service=createCameraReadinessService({adapter,clock:clock()});
  await service.inspect();
  adapter.setPermission('granted');
  assert.equal(service.state().automaticCaptureEligible,false);
  const state=service.noteCaptureSuccess();
  assert.equal(state.automaticCaptureEligible,true);
  assert.equal(state.capability,'ready');
  assert.match(state.lastVerifiedAt,/2026-08-13/);
});

test('prepareAutomaticCapture returns an already-ready state without another permission query or probe',async()=>{
  const adapter=fakeAdapter({permission:'granted'}),service=createCameraReadinessService({adapter});
  await service.inspect();
  const before=adapter.calls(),state=await service.prepareAutomaticCapture();
  assert.equal(state.automaticCaptureEligible,true);
  assert.equal(state.capability,'ready');
  assert.deepEqual(adapter.calls(),before);
});

test('prepareAutomaticCapture performs one bounded reprobe after a transient interruption with explicit grant',async()=>{
  const adapter=fakeAdapter({permission:'granted'}),service=createCameraReadinessService({adapter});
  await service.inspect();
  const failure=new Error('camera temporarily busy');failure.name='NotReadableError';
  await service.noteCaptureFailure(failure,{requestedCamera:'rear'});
  assert.equal(service.state().permission,'granted');
  assert.equal(service.state().capability,'interrupted');
  const before=adapter.calls(),state=await service.prepareAutomaticCapture(),after=adapter.calls();
  assert.equal(state.automaticCaptureEligible,true);
  assert.equal(state.capability,'ready');
  assert.equal(after.probeCalls,before.probeCalls+1);
  assert.equal(after.queryCalls,before.queryCalls+2,'recovery queries before and after its single readiness probe');
});

test('ready permission with a disposed Rally camera session is re-probed before capture',async()=>{
  const adapter=fakeAdapter({permission:'granted'}),service=createCameraReadinessService({adapter});await service.inspect();adapter.setSessionReady(false);
  const before=adapter.calls(),state=await service.prepareAutomaticCapture(),after=adapter.calls();
  assert.equal(state.automaticCaptureEligible,true);assert.equal(after.probeCalls,before.probeCalls+1);assert.equal(state.reasonCode,null);
});

test('prepareAutomaticCapture never retries getUserMedia from prompt, denied, or unknown states',async()=>{
  for(const permission of ['prompt','denied','unknown']){
    const adapter=fakeAdapter({permission}),service=createCameraReadinessService({adapter});
    await service.inspect();
    const before=adapter.calls();
    await assert.rejects(service.prepareAutomaticCapture(),AutomaticCameraNotReadyError);
    assert.equal(adapter.calls().probeCalls,before.probeCalls,`${permission} must not probe cameras`);
    assert.equal(adapter.calls().queryCalls,before.queryCalls,`${permission} must not re-query at checkpoint`);
  }
});

test('a post-failure prompt or unknown permission result blocks bounded recovery',async()=>{
  for(const permissionAfterFailure of ['prompt','unknown']){
    const adapter=fakeAdapter({permission:'granted'}),service=createCameraReadinessService({adapter});
    await service.inspect();
    adapter.setPermission(permissionAfterFailure);
    // Restore an interrupted state through a capture failure; its permission
    // re-query must preserve prompt/unknown rather than assuming the old grant.
    const failure=new Error('stream lost');failure.name='NotReadableError';
    await service.noteCaptureFailure(failure);
    const before=adapter.calls();
    await assert.rejects(service.prepareAutomaticCapture(),AutomaticCameraNotReadyError);
    assert.equal(adapter.calls().probeCalls,before.probeCalls);
    assert.equal(service.state().permission,permissionAfterFailure);
  }
});

test('prepareAutomaticCapture does not probe an intentional manual-only platform',async()=>{
  const adapter=fakeAdapter({permission:'unknown',capabilities:{imageCaptureSupported:false}}),service=createCameraReadinessService({adapter});
  await service.inspect();
  const before=adapter.calls();
  await assert.rejects(service.prepareAutomaticCapture(),AutomaticCameraNotReadyError);
  assert.equal(service.state().capability,'manual-only');
  assert.deepEqual(adapter.calls(),before);
});
