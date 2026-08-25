import assert from 'node:assert/strict';
import test from 'node:test';
import {AutomaticCameraNotReadyError,createCameraReadinessService} from '../src/application/camera-readiness-service.js';

function fakeAdapter({permission='prompt',capabilities={},probeError=null,sessionReady=true}={}){
  let permissionListener=null,probeCalls=0,queryCalls=0,interruptCalls=0;const callOrder=[];
  const adapter={
    capabilities:{permissionQuerySupported:true,getUserMediaSupported:true,imageCaptureSupported:true,...capabilities},
    async queryPermission(){queryCalls++;callOrder.push('query');return {state:permission};},
    async probeCameras(){probeCalls++;callOrder.push('probe');if(probeError)throw probeError;sessionReady=true;return {ready:true,verifiedNativeStill:true,verifiedRoles:['rear','front'],probes:[{cameraRole:'rear',nativeStillVerified:true},{cameraRole:'front',nativeStillVerified:true}]};},
    cameraSessionReady(){return sessionReady;},
    interruptOperationalProbe(){interruptCalls++;sessionReady=false;},
    classifyError(error){return error.classification||{code:error.code||'CAMERA_STREAM_INTERRUPTED',capabilityState:'interrupted',retryable:true};},
    subscribePermissionChange(listener){permissionListener=listener;return ()=>{permissionListener=null;};},
    setPermission(value){permission=value;permissionListener?.(value);},setSessionReady(value){sessionReady=value;},
    calls(){return {probeCalls,queryCalls,callOrder:[...callOrder]};},interrupts(){return interruptCalls;}
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
    'automaticCaptureEligible','capability','currentSessionVerified','getUserMediaSupported','imageCaptureSupported','lastVerifiedAt','nativeStillCapability','permission',
    'permissionQuerySupported','priorSetupSucceeded','reasonCode','setupAttemptedThisSession','verifiedCameraRoles','verifiedNativeStill'
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

test('a previous grant hint cannot make an unknown current session ready',async()=>{
  const adapter=fakeAdapter({permission:'unknown'});
  const service=createCameraReadinessService({adapter,priorSetupSucceeded:true});
  const state=await service.inspect();
  assert.equal(state.automaticCaptureEligible,false);
  assert.equal(state.verifiedNativeStill,false);
  assert.equal(state.capability,'setup-required');
  assert.equal(adapter.calls().probeCalls,0);
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

test('cached permission denial allows one deliberate bounded recheck without an automatic loop',async()=>{
  const adapter=fakeAdapter({permission:'denied'}),hints=[];
  const service=createCameraReadinessService({adapter,persistSetupSucceeded:value=>hints.push(value)});
  const inspected=await service.inspect();
  assert.equal(inspected.permission,'denied');
  assert.equal(inspected.capability,'manual-only');
  assert.equal(inspected.reasonCode,'permission-denied');
  assert.equal(adapter.calls().probeCalls,0);
  const setup=await service.setupFromUserGesture();
  assert.equal(setup.reasonCode,'permission-denied');
  assert.equal(adapter.calls().probeCalls,1);
  assert.deepEqual(hints,[]);
});

test('NotAllowed during a setup tap is resolved against live denied permission',async()=>{
  const denial=new Error('camera blocked');denial.name='NotAllowedError';denial.classification={code:'CAMERA_PERMISSION_UNVERIFIED',permissionState:'unknown',capabilityState:'setup-required',retryable:true};
  const adapter=fakeAdapter({permission:'denied',probeError:denial});
  const service=createCameraReadinessService({adapter});
  const state=await service.setupFromUserGesture();
  assert.equal(state.permission,'denied');assert.equal(state.capability,'manual-only');assert.equal(state.reasonCode,'permission-denied');
  assert.deepEqual(adapter.calls(),{probeCalls:1,queryCalls:1,callOrder:['probe','query']});
});

test('stream acquisition without verified native stills never becomes automatic READY',async()=>{
  const adapter=fakeAdapter({permission:'granted'});
  adapter.probeCameras=async()=>({ready:true,verifiedNativeStill:false,verifiedRoles:[],probes:[{cameraRole:'rear'},{cameraRole:'front'}]});
  const service=createCameraReadinessService({adapter});
  const state=await service.inspect();
  assert.equal(state.permission,'granted');
  assert.equal(state.capability,'interrupted');
  assert.equal(state.verifiedNativeStill,false);
  assert.equal(state.automaticCaptureEligible,false);
  assert.throws(()=>service.assertAutomaticCaptureEligible(),AutomaticCameraNotReadyError);
});

test('a live permission change to granted triggers one controlled native-still re-verification',async()=>{
  const adapter=fakeAdapter({permission:'prompt'}),service=createCameraReadinessService({adapter});
  await service.inspect();adapter.setPermission('granted');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(service.state().permission,'granted');
  assert.equal(service.state().verifiedNativeStill,true);
  assert.equal(service.state().automaticCaptureEligible,true);
  assert.equal(adapter.calls().probeCalls,1);
});

test('prompt to granted during the deliberate probe does not tear down or duplicate that probe',async()=>{
  let listener=null,liveProbe=false,interruptsWhileLive=0,probeCalls=0;
  const adapter={
    capabilities:{permissionQuerySupported:true,getUserMediaSupported:true,imageCaptureSupported:true},
    queryPermission:async()=>({state:'granted'}),cameraSessionReady:()=>false,
    async probeCameras(){probeCalls++;liveProbe=true;listener?.('granted');liveProbe=false;return {ready:true,verifiedNativeStill:true,verifiedRoles:['rear','front']};},
    interruptOperationalProbe(){if(liveProbe)interruptsWhileLive++;},
    classifyError:error=>({code:error?.code||'CAMERA_STREAM_INTERRUPTED',capabilityState:'interrupted',retryable:true}),
    subscribePermissionChange(next){listener=next;return ()=>{listener=null;};}
  };
  const service=createCameraReadinessService({adapter}),state=await service.setupFromUserGesture();
  assert.equal(state.capability,'ready');assert.equal(state.automaticCaptureEligible,true);
  assert.equal(probeCalls,1);assert.equal(interruptsWhileLive,0);
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

test('foreground lifecycle invalidation preserves permission but revokes operational READY until a fresh rear/front probe completes',async()=>{
  const adapter=fakeAdapter({permission:'granted'}),events=[],service=createCameraReadinessService({adapter,onDiagnostic:event=>events.push(event)});
  const before=await service.inspect();
  assert.equal(before.permission,'granted');assert.equal(before.automaticCaptureEligible,true);assert.equal(adapter.calls().probeCalls,1);
  const stale=service.invalidateOperationalReadiness({reason:'foreground-resume-camera-stale'});
  assert.equal(stale.permission,'granted');assert.equal(stale.capability,'interrupted');assert.equal(stale.automaticCaptureEligible,false);assert.equal(stale.lastVerifiedAt,null);
  assert.equal(adapter.interrupts(),1);
  const current=await service.inspect({force:true,reason:'foreground-resume'});
  assert.equal(current.permission,'granted');assert.equal(current.capability,'ready');assert.equal(current.automaticCaptureEligible,true);
  assert.equal(adapter.calls().probeCalls,2);assert.ok(events.some(event=>event.eventType==='camera_operational_readiness_invalidated'));
});

test('checkpoint priority with a granted permission fences background revalidation and authorizes one fresh capture without another probe',async()=>{
  const adapter=fakeAdapter({permission:'granted'}),service=createCameraReadinessService({adapter});await service.inspect();
  service.invalidateOperationalReadiness({reason:'document-hidden'});const before=adapter.calls();
  const preparation=service.prepareCheckpointCapture();
  assert.equal(preparation.authorized,true);assert.equal(preparation.recoveryRequired,true);assert.equal(preparation.state.permission,'granted');
  assert.equal(preparation.state.reasonCode,'checkpoint-capture-recovery');assert.equal(adapter.calls().probeCalls,before.probeCalls,'checkpoint capture goes directly to the bounded capture state machine');
  service.noteCaptureSuccess();assert.equal(service.state().automaticCaptureEligible,true);assert.equal(service.state().capability,'ready');
});

test('checkpoint priority never discovers camera permission from prompt, denied, or unknown states',async()=>{
  for(const permission of ['prompt','denied','unknown']){
    const adapter=fakeAdapter({permission}),service=createCameraReadinessService({adapter});await service.inspect();const before=adapter.calls();
    const preparation=service.prepareCheckpointCapture();assert.equal(preparation.authorized,false);assert.equal(preparation.recoveryRequired,false);
    assert.deepEqual(adapter.calls(),before);
  }
});

test('a stale pre-sleep probe cannot overwrite a newer successful checkpoint generation',async()=>{
  const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
  const oldProbe=deferred(),events=[];let probes=0,sessionReady=false;
  const successful={ready:true,verifiedNativeStill:true,verifiedRoles:['rear','front'],probes:[{cameraRole:'rear',nativeStillVerified:true},{cameraRole:'front',nativeStillVerified:true}]};
  const adapter={
    capabilities:{permissionQuerySupported:true,getUserMediaSupported:true,imageCaptureSupported:true},queryPermission:async()=>({state:'granted'}),
    probeCameras(){probes++;return probes===1?oldProbe.promise:Promise.resolve(successful);},cameraSessionReady:()=>sessionReady,
    interruptOperationalProbe(){sessionReady=false;},classifyError:error=>({code:error?.code||'CAMERA_STREAM_INTERRUPTED',capabilityState:'interrupted',retryable:true}),subscribePermissionChange:()=>()=>{}
  };
  const service=createCameraReadinessService({adapter,onDiagnostic:event=>events.push(event)}),oldInspection=service.inspect();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(probes,1);
  service.invalidateOperationalReadiness({reason:'foreground-resume-camera-stale'});
  const priority=service.prepareCheckpointCapture();assert.equal(priority.authorized,true);service.noteCaptureSuccess();
  oldProbe.resolve(successful);await oldInspection;
  assert.equal(service.state().capability,'ready');assert.equal(service.state().automaticCaptureEligible,true);assert.equal(probes,1);
  assert.ok(events.some(event=>event.eventType==='camera_readiness_probe_result_discarded'));
});
