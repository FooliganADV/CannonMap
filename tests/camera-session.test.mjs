import test from 'node:test';
import assert from 'node:assert/strict';
import {CAMERA_RETENTION_POLICY,cameraRetentionPolicyForPlatform,createCameraSession} from '../src/infrastructure/browser/camera-session.js';
import {captureNativeCameraStill} from '../src/infrastructure/browser/native-camera-still-capture.js';

const photo=()=>new Blob([new Uint8Array(200_000)],{type:'image/jpeg'});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function platform({deferred=false,imageCaptureFactory=null,acquisitionTimeoutMs=5000,photoProbeTimeoutMs=10000,actualFacingMode=null}={}){
  const calls=[],tracks=[],streams=[],resolvers=[],photoCalls=[],photoSettings=[],events=[];let scope='project-a:1',live=0,maxLive=0;
  const create=constraints=>{
    const requestedFacingMode=constraints.video.facingMode.ideal,facingMode=actualFacingMode||requestedFacingMode,listeners=new Map();let readyState='live',muted=false,active=true,counted=true;
    live+=1;maxLive=Math.max(maxLive,live);
    const dispatch=type=>{for(const listener of [...(listeners.get(type)||[])])listener();};
    const track={
      kind:'video',enabled:true,get muted(){return muted;},get readyState(){return readyState;},stops:0,
      stop(){if(readyState==='ended')return;readyState='ended';track.stops+=1;if(counted){counted=false;live-=1;}dispatch('ended');},
      mute(){muted=true;dispatch('mute');},getSettings:()=>({facingMode,width:1920,height:1080,deviceId:`${facingMode}-camera`}),
      addEventListener(type,listener){const set=listeners.get(type)||new Set();set.add(listener);listeners.set(type,set);},removeEventListener(type,listener){listeners.get(type)?.delete(listener);}
    };
    const stream={
      get active(){return active&&readyState==='live';},getVideoTracks:()=>[track],getTracks:()=>[track],
      addEventListener(type,listener){const set=listeners.get(`stream:${type}`)||new Set();set.add(listener);listeners.set(`stream:${type}`,set);},
      removeEventListener(type,listener){listeners.get(`stream:${type}`)?.delete(listener);},
      inactivate(){active=false;if(counted){counted=false;live-=1;}for(const listener of [...(listeners.get('stream:inactive')||[])])listener();}
    };
    tracks.push(track);streams.push(stream);return stream;
  };
  const mediaDevices={getUserMedia(constraints){calls.push(constraints.video.facingMode.ideal);if(!deferred)return Promise.resolve(create(constraints));return new Promise(resolve=>resolvers.push(()=>resolve(create(constraints))));}};
  const session=createCameraSession({
    mediaDevices,imageCaptureFactory:imageCaptureFactory||(track=>({
      getPhotoCapabilities:async()=>({imageWidth:{max:4032},imageHeight:{max:3024}}),
      takePhoto:async settings=>{photoCalls.push(track.getSettings().facingMode);photoSettings.push(settings);return photo();}
    })),scopeProvider:()=>scope,acquisitionTimeoutMs,photoProbeTimeoutMs,cameraSwitchCooldownMs:1,failureBackoffMs:1,maximumFailureBackoffMs:2,onDiagnostic:event=>events.push(event)
  });
  return {calls,tracks,streams,resolvers,photoCalls,photoSettings,events,session,setScope:value=>{scope=value;},live:()=>live,maxLive:()=>maxLive};
}

test('platform metadata truthfully reports exclusive ownership on every platform',()=>{
  assert.equal(cameraRetentionPolicyForPlatform({userAgent:'Mozilla/5.0 (iPhone)',platform:'iPhone',maxTouchPoints:5}),CAMERA_RETENTION_POLICY.SINGLE_ACTIVE);
  assert.equal(cameraRetentionPolicyForPlatform({userAgent:'Mozilla/5.0 (Linux; Android 13; SM-G781U)',platform:'Linux armv8l',maxTouchPoints:5}),CAMERA_RETENTION_POLICY.SINGLE_ACTIVE);
});

test('preflight probes rear then closes, cools down, probes front, and finishes READY with no stream',async()=>{
  const target=platform();const initialized=await target.session.initialize();
  assert.equal(initialized.verifiedNativeStill,true);assert.deepEqual(target.calls,['environment','user']);
  assert.deepEqual(target.photoCalls,['environment','user']);
  assert.deepEqual(target.photoSettings,[{imageWidth:4032,imageHeight:3024},{imageWidth:4032,imageHeight:3024}]);
  assert.equal(target.maxLive(),1);assert.equal(target.live(),0);assert.ok(target.tracks.every(track=>track.stops===1));
  assert.deepEqual(target.session.state().verifiedRoles,['rear','front']);
  assert.equal(target.session.state().ready,true);assert.equal(target.session.state().retainedStreamCount,0);
  assert.equal(target.session.state().readinessBasis,'verified-native-still-capability');assert.equal(target.session.state().ownershipPolicy,'exclusive-sequential');
  const rearStop=target.events.findIndex(event=>event.eventType==='camera_stream_stopped'&&event.cameraRole==='rear');
  const frontOpen=target.events.findIndex(event=>event.eventType==='camera_stream_created'&&event.requestedCamera==='front');assert.ok(rearStop>=0&&frontOpen>rearStop);
});

test('an explicit wrong-camera preflight result cannot make automatic capture READY',async()=>{
  const target=platform({actualFacingMode:'user'});
  await assert.rejects(target.session.initialize(),error=>error.code==='CAMERA_ROLE_MISMATCH'&&error.requestedCamera==='rear'&&error.actualCamera==='front');
  assert.deepEqual(target.calls,['environment']);assert.equal(target.photoCalls.length,0);assert.equal(target.live(),0);assert.ok(target.tracks.every(track=>track.stops===1));
  assert.equal(target.session.state().verifiedNativeStill,false);assert.equal(target.session.state().ready,false);
});

test('checkpoint captures reopen sequential leases and always fully close',async()=>{
  const target=platform();await target.session.initialize();
  for(const role of ['rear','front','rear','front']){
    const result=await captureNativeCameraStill(role,{cameraSession:target.session,scopeToken:'project-a:1',inspect:async()=>({width:4032,height:3024}),wait:async()=>{},recoveryCooldownMs:1});
    assert.equal(result.tracksStopped,true);assert.equal(result.streamReused,false);assert.equal(target.session.state().retainedStreamCount,0);
  }
  assert.deepEqual(target.calls,['environment','user','environment','user','environment','user']);assert.equal(target.maxLive(),1);assert.equal(target.live(),0);
  assert.ok(target.tracks.every(track=>track.stops===1));assert.equal(target.session.state().ready,true);
});

test('concurrent acquisitions queue globally and never overlap front and rear streams',async()=>{
  const target=platform();const rear=await target.session.acquire('rear',{scopeToken:'project-a:1'});let frontResolved=false;
  const frontPromise=target.session.acquire('front',{scopeToken:'project-a:1'}).then(value=>{frontResolved=true;return value;});
  await tick();assert.equal(frontResolved,false);assert.deepEqual(target.calls,['environment']);assert.equal(target.live(),1);
  assert.equal(target.session.release(rear,'rear-complete',{outcome:'success'}),true);
  const front=await frontPromise;assert.equal(frontResolved,true);assert.deepEqual(target.calls,['environment','user']);assert.equal(target.maxLive(),1);
  target.session.release(front,'front-complete',{outcome:'success'});assert.equal(target.live(),0);
});

test('one lease permits only one logical takePhoto in flight and release clears the guard',async()=>{
  let resolvePhoto;
  const target=platform({imageCaptureFactory:()=>({takePhoto:()=>new Promise(resolve=>{resolvePhoto=resolve;})})});
  const entry=await target.session.acquire('rear',{scopeToken:'project-a:1'}),first=entry.imageCapture.takePhoto();
  assert.equal(entry.rawImageCapture,undefined);
  assert.equal(target.session.state().takePhotoInFlight,true);
  assert.throws(()=>entry.imageCapture.takePhoto(),error=>error.code==='CAMERA_TAKE_PHOTO_BUSY');
  target.session.release(entry,'hung-photo-teardown',{outcome:'failure',cooldownMs:0});
  assert.equal(target.session.state().takePhotoInFlight,false);assert.equal(target.live(),0);
  const next=await target.session.acquire('front',{scopeToken:'project-a:1'});assert.notEqual(next.leaseId,entry.leaseId);target.session.release(next,'next-complete',{cooldownMs:0});
  resolvePhoto(photo());await first;
});

test('scope teardown rejects an acquisition and stops its late stream before a new scope can open',async()=>{
  const target=platform({deferred:true});const pending=target.session.acquire('rear',{scopeToken:'project-a:1'});await tick();
  target.setScope('project-b:2');target.session.teardown('project-switch');
  await assert.rejects(pending,error=>error.code==='CAMERA_SCOPE_CHANGED');target.resolvers.shift()();await tick();await tick();
  assert.equal(target.live(),0);assert.equal(target.tracks[0].stops,1);assert.equal(target.session.state().retainedStreamCount,0);
});

test('visibility teardown clears verified readiness and blocks hidden acquisition without opening hardware',async()=>{
  const target=platform();await target.session.initialize();target.session.setVisibility('hidden','screen-hidden');
  assert.equal(target.session.state().visibilityState,'hidden');assert.equal(target.session.state().ready,false);assert.equal(target.session.state().retainedStreamCount,0);
  await assert.rejects(target.session.acquire('rear'),error=>error.code==='CAMERA_DOCUMENT_HIDDEN');assert.equal(target.calls.length,2);
  target.session.setVisibility('visible');assert.equal(target.session.state().ready,false);assert.equal(target.session.state().lastTeardownReason,'screen-hidden');
});

test('hung getUserMedia is bounded and its late stream is stopped',async()=>{
  const target=platform({deferred:true,acquisitionTimeoutMs:5});
  await assert.rejects(target.session.acquire('rear'),error=>error.code==='CAMERA_ACQUISITION_TIMEOUT');
  target.resolvers.shift()();await tick();assert.equal(target.tracks[0].stops,1);assert.equal(target.live(),0);assert.equal(target.session.state().retainedStreamCount,0);
});

test('hung native preflight probe prevents READY and fully tears down',async()=>{
  const target=platform({photoProbeTimeoutMs:5,imageCaptureFactory:()=>({takePhoto:()=>new Promise(()=>{})})});
  const started=Date.now();await assert.rejects(target.session.initialize(),error=>error.code==='CAMERA_NATIVE_STILL_PROBE_TIMEOUT');
  assert.ok(Date.now()-started<250);assert.ok(target.tracks.every(track=>track.stops===1));assert.equal(target.live(),0);assert.equal(target.session.state().verifiedNativeStill,false);assert.equal(target.session.state().ready,false);
});
