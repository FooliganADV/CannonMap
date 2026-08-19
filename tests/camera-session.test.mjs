import test from 'node:test';
import assert from 'node:assert/strict';
import {CAMERA_RETENTION_POLICY,cameraRetentionPolicyForPlatform,createCameraSession} from '../src/infrastructure/browser/camera-session.js';
import {captureNativeCameraStill} from '../src/infrastructure/browser/native-camera-still-capture.js';

const photo=()=>new Blob([new Uint8Array(200_000)],{type:'image/jpeg'});
function platform({deferred=false,retentionPolicy=CAMERA_RETENTION_POLICY.RETAIN_ALL,imageCaptureFactory=null,acquisitionTimeoutMs=5000,photoProbeTimeoutMs=3000}={}){
  const calls=[],tracks=[],streams=[],resolvers=[],photoCalls=[];let scope='project-a:1';
  const create=constraints=>{const facingMode=constraints.video.facingMode.ideal,listeners=new Map();let readyState='live',muted=false,active=true;const dispatch=type=>{for(const listener of listeners.get(type)||[])listener();};const track={kind:'video',enabled:true,get muted(){return muted;},get readyState(){return readyState;},stop(){if(readyState==='ended')return;readyState='ended';track.stops++;dispatch('ended');},mute(){muted=true;dispatch('mute');},stops:0,getSettings:()=>({facingMode,width:1920,height:1080,deviceId:`${facingMode}-camera`}),addEventListener(type,listener){const set=listeners.get(type)||new Set();set.add(listener);listeners.set(type,set);},removeEventListener(type,listener){listeners.get(type)?.delete(listener);}};tracks.push(track);const stream={get active(){return active;},getVideoTracks:()=>[track],getTracks:()=>[track],addEventListener(type,listener){const set=listeners.get(`stream:${type}`)||new Set();set.add(listener);listeners.set(`stream:${type}`,set);},removeEventListener(type,listener){listeners.get(`stream:${type}`)?.delete(listener);},inactivate(){active=false;for(const listener of listeners.get('stream:inactive')||[])listener();}};streams.push(stream);return stream;};
  const mediaDevices={getUserMedia(constraints){calls.push(constraints.video.facingMode.ideal);if(!deferred)return Promise.resolve(create(constraints));return new Promise(resolve=>resolvers.push(()=>resolve(create(constraints))));}};
  const events=[],session=createCameraSession({mediaDevices,imageCaptureFactory:imageCaptureFactory||(track=>({track,takePhoto:async()=>{photoCalls.push(track.getSettings().facingMode);return photo();}})),scopeProvider:()=>scope,retentionPolicy,acquisitionTimeoutMs,photoProbeTimeoutMs,onDiagnostic:event=>events.push(event)});
  return {calls,tracks,streams,resolvers,photoCalls,events,session,setScope:value=>{scope=value;}};
}

test('preflight authorization is reused by sequential front/rear checkpoint pairs',async()=>{
  const {calls,tracks,photoCalls,session}=platform();const initialized=await session.initialize();
  assert.equal(initialized.verifiedNativeStill,true);assert.deepEqual(photoCalls,['environment','user']);
  for(let checkpoint=0;checkpoint<2;checkpoint++)for(const role of ['rear','front'])await captureNativeCameraStill(role,{cameraSession:session,scopeToken:'project-a:1',inspect:async()=>({width:4032,height:3024}),wait:async()=>{}});
  assert.deepEqual(calls,['environment','user']);assert.equal(session.state().getUserMediaCallCount,2);assert.ok(tracks.every(track=>track.stops===0));
});

test('platform policy uses one active camera on iOS while preserving retained Android streams',()=>{
  assert.equal(cameraRetentionPolicyForPlatform({userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',platform:'iPhone',maxTouchPoints:5}),CAMERA_RETENTION_POLICY.SINGLE_ACTIVE);
  assert.equal(cameraRetentionPolicyForPlatform({userAgent:'Mozilla/5.0 (Linux; Android 13; SM-G781U)',platform:'Linux armv8l',maxTouchPoints:5}),CAMERA_RETENTION_POLICY.RETAIN_ALL);
  assert.equal(cameraRetentionPolicyForPlatform({userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X)',platform:'MacIntel',maxTouchPoints:5}),CAMERA_RETENTION_POLICY.SINGLE_ACTIVE);
});

test('single-active policy verifies both cameras without retaining incompatible simultaneous iOS streams',async()=>{
  const {calls,tracks,session}=platform({retentionPolicy:CAMERA_RETENTION_POLICY.SINGLE_ACTIVE});
  const initialized=await session.initialize();
  assert.equal(initialized.verifiedNativeStill,true);assert.deepEqual(calls,['environment','user']);
  assert.equal(tracks[0].stops,1);assert.equal(tracks[1].stops,0);
  assert.equal(session.state().retainedStreamCount,1);assert.equal(session.state().retainedEntryCount,1);assert.deepEqual(session.state().roles,['front']);assert.deepEqual(session.state().verifiedRoles,['rear','front']);assert.equal(session.state().verifiedNativeStill,true);assert.equal(session.state().ready,true);assert.equal(session.state().retentionPolicy,'single-active');
  await captureNativeCameraStill('rear',{cameraSession:session,scopeToken:'project-a:1',inspect:async()=>({width:4032,height:3024}),wait:async()=>{}});
  assert.deepEqual(calls,['environment','user','environment']);assert.equal(tracks[1].stops,1);assert.deepEqual(session.state().roles,['rear']);
});

test('a muted live track is invalidated and cannot satisfy retained-session readiness',async()=>{
  const {tracks,session,events}=platform();await session.initialize();
  tracks[0].mute();
  assert.equal(session.state().ready,false);assert.deepEqual(session.state().roles,['front']);assert.equal(session.state().verifiedNativeStill,false);
  assert.ok(events.some(event=>event.eventType==='camera_stream_invalidated'&&event.reason==='track-muted'));
});

test('interrupted side recovery recreates only that side without leaking streams',async()=>{
  const {calls,tracks,session}=platform();await session.initialize();tracks[0].stop();
  await captureNativeCameraStill('rear',{cameraSession:session,scopeToken:'project-a:1',inspect:async()=>({width:4032,height:3024}),wait:async()=>{}});
  await captureNativeCameraStill('front',{cameraSession:session,scopeToken:'project-a:1',inspect:async()=>({width:3024,height:4032}),wait:async()=>{}});
  assert.deepEqual(calls,['environment','user','environment']);assert.equal(session.state().retainedStreamCount,2);assert.equal(tracks[1].stops,0);
});

test('scope change stops retained and late streams and never attaches stale acquisition',async()=>{
  const {resolvers,tracks,session,setScope}=platform({deferred:true});const setup=session.initialize();resolvers.shift()();await new Promise(resolve=>setImmediate(resolve));setScope('project-b:2');session.teardown('project-switch');resolvers.shift()();
  await assert.rejects(setup,error=>error.code==='CAMERA_SCOPE_CHANGED');assert.ok(tracks.every(track=>track.stops===1));assert.equal(session.state().retainedStreamCount,0);
});

test('permission revocation and destroy dispose all retained streams idempotently',async()=>{
  const first=platform();await first.session.initialize();first.session.teardown('camera-permission-denied');assert.ok(first.tracks.every(track=>track.stops===1));first.session.teardown('again');assert.ok(first.tracks.every(track=>track.stops===1));
  const second=platform();await second.session.initialize();second.session.destroy('logout');assert.ok(second.tracks.every(track=>track.stops===1));await assert.rejects(()=>second.session.acquire('rear'),error=>error.code==='CAMERA_SESSION_DESTROYED');
});

test('concurrent acquisition for one side is deduplicated',async()=>{
  const {calls,resolvers,session}=platform({deferred:true});const first=session.acquire('rear'),second=session.acquire('rear');assert.equal(calls.length,1);resolvers.shift()();const [a,b]=await Promise.all([first,second]);assert.equal(a.stream,b.stream);assert.equal(session.state().retainedStreamCount,1);
});

test('hung getUserMedia is bounded and a late stream is stopped',async()=>{
  const target=platform({deferred:true,acquisitionTimeoutMs:5});
  await assert.rejects(target.session.acquire('rear'),error=>error.code==='CAMERA_ACQUISITION_TIMEOUT');
  target.resolvers.shift()();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(target.tracks[0].stops,1);assert.equal(target.session.state().retainedStreamCount,0);
});

test('hung native still verification prevents READY and tears down acquired streams',async()=>{
  const target=platform({photoProbeTimeoutMs:5,imageCaptureFactory:()=>({takePhoto:()=>new Promise(()=>{})})});
  const started=Date.now();await assert.rejects(target.session.initialize(),error=>error.code==='CAMERA_NATIVE_STILL_PROBE_TIMEOUT');
  assert.ok(Date.now()-started<250);assert.ok(target.tracks.every(track=>track.stops===1));assert.equal(target.session.state().verifiedNativeStill,false);
});
