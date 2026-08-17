import test from 'node:test';
import assert from 'node:assert/strict';
import {createCameraSession} from '../src/infrastructure/browser/camera-session.js';
import {captureNativeCameraStill} from '../src/infrastructure/browser/native-camera-still-capture.js';

const photo=()=>new Blob([new Uint8Array(200_000)],{type:'image/jpeg'});
function platform({deferred=false}={}){
  const calls=[],tracks=[],resolvers=[];let scope='project-a:1';
  const create=constraints=>{const facingMode=constraints.video.facingMode.ideal,listeners=new Map();let readyState='live';const track={kind:'video',get readyState(){return readyState;},stop(){readyState='ended';track.stops++;listeners.get('ended')?.();},stops:0,getSettings:()=>({facingMode,width:1920,height:1080,deviceId:`${facingMode}-camera`}),addEventListener(type,listener){listeners.set(type,listener);}};tracks.push(track);return {getVideoTracks:()=>[track],getTracks:()=>[track]};};
  const mediaDevices={getUserMedia(constraints){calls.push(constraints.video.facingMode.ideal);if(!deferred)return Promise.resolve(create(constraints));return new Promise(resolve=>resolvers.push(()=>resolve(create(constraints))));}};
  const events=[],session=createCameraSession({mediaDevices,imageCaptureFactory:track=>({track,takePhoto:async()=>photo()}),scopeProvider:()=>scope,onDiagnostic:event=>events.push(event)});
  return {calls,tracks,resolvers,events,session,setScope:value=>{scope=value;}};
}

test('preflight authorization is reused by sequential front/rear checkpoint pairs',async()=>{
  const {calls,tracks,session}=platform();await session.initialize();
  for(let checkpoint=0;checkpoint<2;checkpoint++)for(const role of ['rear','front'])await captureNativeCameraStill(role,{cameraSession:session,scopeToken:'project-a:1',inspect:async()=>({width:4032,height:3024}),wait:async()=>{}});
  assert.deepEqual(calls,['environment','user']);assert.equal(session.state().getUserMediaCallCount,2);assert.ok(tracks.every(track=>track.stops===0));
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
