import assert from 'node:assert/strict';
import test from 'node:test';
import {BrowserCameraReadinessError,classifyCameraReadinessError,createBrowserCameraReadinessAdapter} from '../src/infrastructure/browser/camera-readiness-adapter.js';

class FakePermissionStatus{
  constructor(state){this.state=state;this.listener=null;}
  addEventListener(name,listener){if(name==='change')this.listener=listener;}
  removeEventListener(name,listener){if(name==='change'&&this.listener===listener)this.listener=null;}
  change(state){this.state=state;this.listener?.();}
}

function fakeStream(role,{live=true,muted=false,enabled=true,active=true}={}){
  const track={
    kind:'video',readyState:live?'live':'ended',muted,enabled,stopped:false,
    stop(){this.stopped=true;},
    getSettings(){return {facingMode:role==='rear'?'environment':'user',width:1920,height:1080};}
  };
  return {active,track,getVideoTracks:()=>[track],getTracks:()=>[track]};
}

test('permission query normalizes state and reports later changes',async()=>{
  const status=new FakePermissionStatus('prompt'),changes=[];
  const adapter=createBrowserCameraReadinessAdapter({
    permissions:{async query(input){assert.deepEqual(input,{name:'camera'});return status;}},
    mediaDevices:{async getUserMedia(){throw new Error('not used');}},
    imageCaptureFactory:()=>({takePhoto(){}})
  });
  assert.deepEqual(await adapter.queryPermission(),{state:'prompt',querySupported:true,reasonCode:null});
  const unsubscribe=adapter.subscribePermissionChange(state=>changes.push(state));
  status.change('granted');
  assert.deepEqual(changes,['granted']);
  unsubscribe();adapter.destroy();
  assert.equal(status.listener,null);
});

test('camera setup probes rear then front and stops each stream immediately',async()=>{
  const requested=[],streams=[];
  const adapter=createBrowserCameraReadinessAdapter({
    permissions:{async query(){return new FakePermissionStatus('granted');}},
    mediaDevices:{async getUserMedia(constraints){
      const facing=constraints.video.facingMode.ideal,role=facing==='environment'?'rear':'front';
      requested.push(role);const stream=fakeStream(role);streams.push(stream);return stream;
    }},
    imageCaptureFactory:track=>({track,takePhoto:async()=>new Blob(['probe'],{type:'image/jpeg'})})
  });
  const result=await adapter.probeCameras();
  assert.equal(result.ready,true);
  assert.equal(result.verifiedNativeStill,true);
  assert.deepEqual(result.verifiedRoles,['rear','front']);
  assert.deepEqual(requested,['rear','front']);
  assert.deepEqual(result.probes.map(item=>item.cameraRole),['rear','front']);
  assert.ok(streams.every(stream=>stream.track.stopped));
});

test('a failed probe still stops acquired tracks and does not attempt the second camera',async()=>{
  const stream=fakeStream('rear',{live:false});let calls=0;
  const adapter=createBrowserCameraReadinessAdapter({
    permissions:null,
    mediaDevices:{async getUserMedia(){calls++;return stream;}},
    imageCaptureFactory:()=>({takePhoto(){}})
  });
  await assert.rejects(adapter.probeCameras(),error=>{
    assert.equal(error instanceof BrowserCameraReadinessError,true);
    assert.equal(error.code,'CAMERA_STREAM_INTERRUPTED');return true;
  });
  assert.equal(calls,1);
  assert.equal(stream.track.stopped,true);
});

test('ImageCapture must expose takePhoto and streams are cleaned up on failure',async()=>{
  const stream=fakeStream('rear');
  const adapter=createBrowserCameraReadinessAdapter({mediaDevices:{async getUserMedia(){return stream;}},permissions:null,imageCaptureFactory:()=>({})});
  await assert.rejects(adapter.probeCameras(),error=>error.code==='IMAGE_CAPTURE_INVALID');
  assert.equal(stream.track.stopped,true);
  const classification=classifyCameraReadinessError(new BrowserCameraReadinessError('missing',{code:'IMAGE_CAPTURE_INVALID'}));
  assert.equal(classification.capabilityState,'manual-only');
  assert.equal(classification.platformLimitation,true);
});

test('permission, unavailable, and interrupted browser errors receive stable classifications',()=>{
  for(const [name,code,state] of [
    ['NotAllowedError','CAMERA_PERMISSION_UNVERIFIED','setup-required'],
    ['NotFoundError','CAMERA_UNAVAILABLE','unavailable'],
    ['NotReadableError','CAMERA_STREAM_INTERRUPTED','interrupted'],
    ['OverconstrainedError','CAMERA_CONSTRAINT_UNSUPPORTED','unavailable']
  ]){
    const error=new Error(name);error.name=name;
    const result=classifyCameraReadinessError(error);
    assert.equal(result.code,code);assert.equal(result.capabilityState,state);
    assert.doesNotThrow(()=>JSON.stringify(result));
  }
});

test('unsupported browser capabilities are exposed without touching media APIs',async()=>{
  const adapter=createBrowserCameraReadinessAdapter({mediaDevices:null,permissions:null,imageCaptureFactory:null});
  assert.deepEqual(adapter.capabilities,{permissionQuerySupported:false,getUserMediaSupported:false,imageCaptureSupported:false,secureContext:true});
  await assert.rejects(adapter.probeCameras(),error=>error.code==='GET_USER_MEDIA_UNAVAILABLE');
});

test('a throwing camera permission query is operationally unsupported for this session',async()=>{
  const adapter=createBrowserCameraReadinessAdapter({
    permissions:{async query(){throw new TypeError('camera permission descriptor unsupported');}},
    mediaDevices:{async getUserMedia(){throw new Error('not used');}},
    imageCaptureFactory:()=>({takePhoto(){}})
  });
  const result=await adapter.queryPermission();
  assert.equal(result.state,'unknown');
  assert.equal(result.querySupported,false);
  assert.equal(result.reasonCode,'PERMISSION_QUERY_FAILED');
  assert.equal(result.error.name,'TypeError');
});

test('an insecure context is explicitly ineligible for automatic capture',async()=>{
  let calls=0;
  const adapter=createBrowserCameraReadinessAdapter({
    secureContext:false,permissions:null,
    mediaDevices:{async getUserMedia(){calls++;}},imageCaptureFactory:()=>({takePhoto(){}})
  });
  assert.equal(adapter.capabilities.secureContext,false);
  assert.equal(adapter.capabilities.getUserMediaSupported,false);
  await assert.rejects(adapter.probeCameras(),error=>error.code==='INSECURE_CONTEXT');
  assert.equal(calls,0);
});

test('a hung getUserMedia readiness probe times out instead of blocking setup forever',async()=>{
  const adapter=createBrowserCameraReadinessAdapter({
    permissions:null,probeTimeoutMs:5,
    mediaDevices:{getUserMedia(){return new Promise(()=>{});}},
    imageCaptureFactory:()=>({takePhoto(){}})
  });
  const started=Date.now();
  await assert.rejects(adapter.probeCameras(),error=>error.code==='CAMERA_PROBE_TIMEOUT');
  assert.ok(Date.now()-started<250,'readiness timeout must remain bounded');
  const classified=classifyCameraReadinessError(new BrowserCameraReadinessError('timeout',{code:'CAMERA_PROBE_TIMEOUT'}));
  assert.equal(classified.capabilityState,'interrupted');
  assert.equal(classified.retryable,true);
});

test('a stream resolving after readiness timeout is stopped immediately',async()=>{
  let resolveStream;
  const lateStream=fakeStream('rear');
  const adapter=createBrowserCameraReadinessAdapter({
    permissions:null,probeTimeoutMs:5,
    mediaDevices:{getUserMedia(){return new Promise(resolve=>{resolveStream=resolve;});}},
    imageCaptureFactory:()=>({takePhoto(){}})
  });
  await assert.rejects(adapter.probeCameras(),error=>error.code==='CAMERA_PROBE_TIMEOUT');
  resolveStream(lateStream);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(lateStream.track.stopped,true);
});

test('a muted live probe track cannot produce false native-still readiness',async()=>{
  const stream=fakeStream('rear',{muted:true});let photoCalls=0;
  const adapter=createBrowserCameraReadinessAdapter({
    permissions:null,mediaDevices:{async getUserMedia(){return stream;}},
    imageCaptureFactory:()=>({takePhoto:async()=>{photoCalls++;return new Blob(['probe']);}})
  });
  await assert.rejects(adapter.probeCameras(),error=>error.code==='CAMERA_TRACK_MUTED');
  assert.equal(photoCalls,0);assert.equal(stream.track.stopped,true);
});

test('a hung native still readiness probe is bounded and its stream is stopped',async()=>{
  const stream=fakeStream('rear');
  const adapter=createBrowserCameraReadinessAdapter({
    permissions:null,probeTimeoutMs:5,
    mediaDevices:{async getUserMedia(){return stream;}},
    imageCaptureFactory:()=>({takePhoto(){return new Promise(()=>{});}})
  });
  const started=Date.now();
  await assert.rejects(adapter.probeCameras(),error=>error.code==='CAMERA_NATIVE_STILL_PROBE_TIMEOUT');
  assert.ok(Date.now()-started<250);
  assert.equal(stream.track.stopped,true);
  assert.equal(classifyCameraReadinessError(new BrowserCameraReadinessError('timeout',{code:'CAMERA_NATIVE_STILL_PROBE_TIMEOUT'})).capabilityState,'interrupted');
});

test('persistent session owns readiness probes and is disposed on revocation and adapter destroy',async()=>{
  const status=new FakePermissionStatus('granted'),reasons=[];let initialized=0,destroyed=0;
  const cameraSession={initialize:async input=>{initialized++;assert.deepEqual(input,{scopeToken:'project-a:1',timeoutMs:10000});return {ready:true,verifiedNativeStill:true,verifiedRoles:['rear','front'],probes:[]};},state:()=>({ready:true,retainedStreamCount:2}),teardown:reason=>reasons.push(reason),destroy:()=>{destroyed++;}};
  const adapter=createBrowserCameraReadinessAdapter({permissions:{async query(){return status;}},mediaDevices:{getUserMedia:async()=>{throw new Error('session owns acquisition');}},imageCaptureFactory:()=>({takePhoto(){}}),cameraSession,sessionScopeProvider:()=> 'project-a:1'});
  await adapter.queryPermission();await adapter.probeCameras();assert.equal(initialized,1);assert.equal(adapter.cameraSessionReady(),true);
  status.change('denied');assert.deepEqual(reasons,['camera-permission-denied']);adapter.destroy();assert.equal(destroyed,1);
});
