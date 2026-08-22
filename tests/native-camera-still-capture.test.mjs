import test from 'node:test';
import assert from 'node:assert/strict';
import {createCameraSession} from '../src/infrastructure/browser/camera-session.js';
import {captureNativeCameraStill,captureVideoFrameFallback,NativeStillUnavailableError} from '../src/infrastructure/browser/native-camera-still-capture.js';

const nativeBlob=()=>new Blob([new Uint8Array(240_000)],{type:'image/jpeg'});
const fallbackBlob=()=>new Blob([new Uint8Array(90_000)],{type:'image/jpeg'});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function cameraHardware({facing='environment',actualFacing=null}={}){
  const requests=[],tracks=[];let live=0,maxLive=0;
  const mediaDevices={async getUserMedia(constraints){
    requests.push(constraints);const selected=actualFacing||constraints.video.facingMode.ideal||facing;let state='live',counted=true;live+=1;maxLive=Math.max(maxLive,live);
    const track={
      kind:'video',enabled:true,muted:false,get readyState(){return state;},stops:0,
      stop(){if(state==='ended')return;state='ended';track.stops+=1;if(counted){counted=false;live-=1;}},
      getSettings:()=>({facingMode:selected,width:1920,height:1080,frameRate:30,deviceId:`private-${selected}-camera-id`})
    };
    const stream={get active(){return state==='live';},getVideoTracks:()=>[track],getTracks:()=>[track]};tracks.push(track);return stream;
  }};
  return {mediaDevices,requests,tracks,live:()=>live,maxLive:()=>maxLive};
}

test('first native attempt requests maximum still capability, returns bytes unchanged, and fully closes',async()=>{
  const hardware=cameraHardware(),photoCalls=[],waits=[],bytes=new Uint8Array([255,216,1,2,3,255,217]),blob=new Blob([bytes],{type:'image/jpeg'});
  const result=await captureNativeCameraStill('rear',{
    mediaDevices:hardware.mediaDevices,
    imageCaptureFactory:()=>({getPhotoCapabilities:async()=>({imageWidth:{min:640,max:4032},imageHeight:{min:480,max:3024}}),takePhoto:async settings=>{photoCalls.push(settings);return blob;}}),
    inspect:async()=>({width:4032,height:3024}),wait:async ms=>waits.push(ms)
  });
  assert.deepEqual(photoCalls,[{imageWidth:4032,imageHeight:3024}]);assert.deepEqual(waits,[180]);
  assert.deepEqual([...new Uint8Array(await result.blob.arrayBuffer())],[...bytes]);assert.equal(hardware.maxLive(),1);assert.equal(hardware.live(),0);assert.equal(hardware.tracks[0].stops,1);
  assert.equal(result.tracksStopped,true);assert.equal(result.streamReused,false);
  assert.deepEqual(result.provenance,{sourceKind:'image-capture-photo',nativeStill:true,derivedFromVideoFrame:false,upscaled:false,requestedCamera:'rear',actualCamera:'rear',cameraSelectionHonored:true,captureMethod:'getUserMedia-imagecapture',mimeType:'image/jpeg',byteLength:7,width:4032,height:3024,photoSettings:{imageWidth:4032,imageHeight:3024},trackSettings:{deviceIdHash:'fnv1a-b596a216',facingMode:'environment',width:1920,height:1080},recoveryPath:'none',nativeRetryCount:0,nativeAttemptCount:1});
});

test('first failure performs full teardown and exactly one native retry on a new stream and ImageCapture',async()=>{
  const hardware=cameraHardware(),photoTracks=[];let factoryCalls=0;
  const result=await captureNativeCameraStill('rear',{
    mediaDevices:hardware.mediaDevices,recoveryCooldownMs:1,wait:async()=>{},inspect:async()=>({width:4032,height:3024}),
    imageCaptureFactory:track=>{factoryCalls+=1;return {getPhotoCapabilities:async()=>({imageWidth:{max:4032},imageHeight:{max:3024}}),takePhoto:async settings=>{photoTracks.push({track,settings,priorStopped:hardware.tracks[0]?.stops||0});if(factoryCalls===1)throw Object.assign(new Error('driver failed'),{code:'DRIVER_FAILED'});return nativeBlob();}};}
  });
  assert.equal(factoryCalls,2);assert.equal(photoTracks.length,2);assert.notEqual(photoTracks[0].track,photoTracks[1].track);
  assert.equal(photoTracks[1].priorStopped,1);assert.equal(hardware.requests.length,2);assert.equal(hardware.maxLive(),1);assert.equal(hardware.live(),0);assert.ok(hardware.tracks.every(track=>track.stops===1));
  assert.equal(result.provenance.recoveryPath,'native-retry-success');assert.equal(result.provenance.nativeRetryCount,1);assert.equal(result.provenance.nativeAttemptCount,2);
});

test('an explicit wrong camera is torn down, retried once, and can only return truthful degraded media',async()=>{
  const hardware=cameraHardware({actualFacing:'user'});let photoCalls=0;
  const result=await captureNativeCameraStill('rear',{
    mediaDevices:hardware.mediaDevices,recoveryCooldownMs:1,wait:async()=>{},
    imageCaptureFactory:()=>({takePhoto:async()=>{photoCalls+=1;return nativeBlob();}}),
    fallbackFrameCapture:async()=>({blob:fallbackBlob(),width:1920,height:1080})
  });
  assert.equal(photoCalls,0);assert.equal(hardware.requests.length,3);assert.equal(hardware.maxLive(),1);assert.equal(hardware.live(),0);assert.ok(hardware.tracks.every(track=>track.stops===1));
  assert.equal(result.provenance.sourceKind,'fallback-video-frame');assert.equal(result.provenance.nativeStill,false);assert.equal(result.provenance.requestedCamera,'rear');assert.equal(result.provenance.actualCamera,'front');assert.equal(result.provenance.cameraSelectionHonored,false);
  assert.deepEqual(result.provenance.nativeFailureCodes,['CAMERA_ROLE_MISMATCH','CAMERA_ROLE_MISMATCH']);
});

test('a hung 10-second-class takePhoto is bounded, abandoned by teardown, and retried only on a fresh track',async()=>{
  const hardware=cameraHardware();let photoCalls=0;
  const started=Date.now();const result=await captureNativeCameraStill('rear',{
    mediaDevices:hardware.mediaDevices,takePhotoTimeoutMs:5,totalTimeoutMs:200,recoveryCooldownMs:1,wait:async()=>{},inspect:async()=>({width:4032,height:3024}),
    imageCaptureFactory:()=>({takePhoto:()=>{photoCalls+=1;return photoCalls===1?new Promise(()=>{}):Promise.resolve(nativeBlob());}})
  });
  assert.ok(Date.now()-started<250);assert.equal(photoCalls,2);assert.equal(hardware.requests.length,2);assert.equal(hardware.maxLive(),1);assert.ok(hardware.tracks.every(track=>track.stops===1));
  assert.equal(result.provenance.recoveryPath,'native-retry-success');assert.equal(result.provenance.nativeRetryCount,1);
});

test('two native failures use a fresh exclusive session lease for truthful video-frame fallback',async()=>{
  const hardware=cameraHardware();let nativeCalls=0,fallbackSawLive=0;
  const session=createCameraSession({
    mediaDevices:hardware.mediaDevices,imageCaptureFactory:()=>({takePhoto:async()=>{nativeCalls+=1;throw Object.assign(new Error('native rejected'),{code:'NATIVE_REJECTED'});}}),
    cameraSwitchCooldownMs:1,failureBackoffMs:1,maximumFailureBackoffMs:2
  });
  const result=await captureNativeCameraStill('rear',{
    cameraSession:session,scopeToken:'project-a:1',mediaDevices:hardware.mediaDevices,recoveryCooldownMs:1,wait:async()=>{},
    fallbackFrameCapture:async({track})=>{fallbackSawLive=hardware.live();assert.equal(track.readyState,'live');return {blob:fallbackBlob(),width:1920,height:1080};}
  });
  assert.equal(nativeCalls,2);assert.equal(hardware.requests.length,3);assert.equal(fallbackSawLive,1);assert.equal(hardware.maxLive(),1);assert.equal(hardware.live(),0);assert.ok(hardware.tracks.every(track=>track.stops===1));
  assert.equal(session.state().retainedStreamCount,0);assert.equal(session.state().takePhotoInFlight,false);
  assert.equal(result.provenance.sourceKind,'fallback-video-frame');assert.equal(result.provenance.nativeStill,false);assert.equal(result.provenance.derivedFromVideoFrame,true);
  assert.equal(result.provenance.recoveryPath,'fallback-video-frame-after-native-retry');assert.equal(result.provenance.nativeRetryCount,1);assert.equal(result.provenance.nativeAttemptCount,2);
  assert.deepEqual(result.provenance.nativeFailureCodes,['NATIVE_REJECTED','NATIVE_REJECTED']);
});

test('default video-frame fallback draws native preview dimensions without upscaling and closes its stream',async()=>{
  const hardware=cameraHardware();let drawn=null,paused=0,sourceObject=null;
  const video={readyState:2,videoWidth:1280,videoHeight:720,muted:false,playsInline:false,autoplay:false,async play(){},pause(){paused+=1;},get srcObject(){return sourceObject;},set srcObject(value){sourceObject=value;}};
  const canvas={width:0,height:0,getContext:()=>({drawImage(...args){drawn=args;}}),toBlob(callback){callback(fallbackBlob());}};
  const result=await captureVideoFrameFallback('rear',{mediaDevices:hardware.mediaDevices,videoFactory:()=>video,canvasFactory:()=>canvas,wait:async()=>{}});
  assert.equal(canvas.width,1280);assert.equal(canvas.height,720);assert.deepEqual(drawn.slice(1),[0,0,1280,720]);
  assert.equal(result.width,1280);assert.equal(result.height,720);assert.equal(result.blob.size,90000);assert.equal(paused,1);assert.equal(sourceObject,null);
  assert.equal(hardware.maxLive(),1);assert.equal(hardware.live(),0);assert.equal(hardware.tracks[0].stops,1);
});

test('fallback failure preserves the two-attempt limit and reports native capture unavailable',async()=>{
  const hardware=cameraHardware();let factoryCalls=0;
  await assert.rejects(()=>captureNativeCameraStill('front',{
    mediaDevices:hardware.mediaDevices,recoveryCooldownMs:1,wait:async()=>{},totalTimeoutMs:250,
    imageCaptureFactory:()=>{factoryCalls+=1;throw new NativeStillUnavailableError('missing',{code:'NATIVE_STILL_UNAVAILABLE'});},
    fallbackFrameCapture:async()=>{throw Object.assign(new Error('no safe frame'),{code:'FALLBACK_FAILED'});}
  }),error=>error.code==='NATIVE_STILL_UNAVAILABLE');
  assert.equal(factoryCalls,2);assert.equal(hardware.requests.length,3);assert.equal(hardware.maxLive(),1);assert.equal(hardware.live(),0);assert.ok(hardware.tracks.every(track=>track.stops===1));
});

test('concurrent captures through one session serialize hardware and takePhoto ownership',async()=>{
  const hardware=cameraHardware();let resolveFirst,photoCalls=0;
  const session=createCameraSession({
    mediaDevices:hardware.mediaDevices,cameraSwitchCooldownMs:1,failureBackoffMs:1,
    imageCaptureFactory:()=>({takePhoto:()=>{photoCalls+=1;if(photoCalls===1)return new Promise(resolve=>{resolveFirst=resolve;});return Promise.resolve(nativeBlob());}})
  });
  const first=captureNativeCameraStill('rear',{cameraSession:session,scopeToken:'project-a:1',inspect:async()=>({width:4032,height:3024}),wait:async()=>{}});
  const second=captureNativeCameraStill('front',{cameraSession:session,scopeToken:'project-a:1',inspect:async()=>({width:3024,height:4032}),wait:async()=>{}});
  while(!resolveFirst)await tick();assert.equal(hardware.requests.length,1);assert.equal(hardware.live(),1);assert.equal(session.state().takePhotoInFlight,true);
  resolveFirst(nativeBlob());const [rear,front]=await Promise.all([first,second]);
  assert.equal(rear.provenance.actualCamera,'rear');assert.equal(front.provenance.actualCamera,'front');assert.equal(photoCalls,2);assert.equal(hardware.requests.length,2);assert.equal(hardware.maxLive(),1);assert.equal(hardware.live(),0);assert.ok(hardware.tracks.every(track=>track.stops===1));
});

test('muted tracks fail twice without calling takePhoto and cannot leave a live stream',async()=>{
  const hardware=cameraHardware();let photoCalls=0;
  const original=hardware.mediaDevices.getUserMedia;hardware.mediaDevices.getUserMedia=async constraints=>{const stream=await original(constraints);stream.getVideoTracks()[0].muted=true;return stream;};
  await assert.rejects(()=>captureNativeCameraStill('front',{
    mediaDevices:hardware.mediaDevices,recoveryCooldownMs:1,wait:async()=>{},fallbackFrameCapture:async()=>{throw new Error('fallback unavailable');},
    imageCaptureFactory:()=>({takePhoto:async()=>{photoCalls+=1;return nativeBlob();}})
  }),error=>error.code==='CAMERA_TRACK_MUTED');
  assert.equal(photoCalls,0);assert.equal(hardware.requests.length,3);assert.equal(hardware.live(),0);assert.ok(hardware.tracks.every(track=>track.stops===1));
});

test('diagnostic phases are bounded, diagnostic-only, hashed, and include retry timing/capability/result data',async()=>{
  const hardware=cameraHardware(),phases=[];let photoCalls=0,mono=100;
  const result=await captureNativeCameraStill('rear',{
    mediaDevices:hardware.mediaDevices,captureType:'ride_memory',recoveryCooldownMs:1,wait:async()=>{},inspect:async()=>({width:4032,height:3024}),monotonicClock:()=>mono+=5,
    imageCaptureFactory:()=>({getPhotoCapabilities:async()=>({imageWidth:{min:640,max:4032},imageHeight:{min:480,max:3024}}),takePhoto:async()=>{photoCalls+=1;if(photoCalls===1)throw Object.assign(new Error('once'),{code:'ONCE'});return nativeBlob();}}),
    onPhase:(phase,details)=>phases.push({phase,details})
  });
  assert.equal(result.provenance.recoveryPath,'native-retry-success');assert.ok(phases.length>0);assert.ok(phases.every(item=>item.details.diagnosticOnly===true&&item.details.captureType==='ride_memory'));
  const trackPhase=phases.find(item=>item.phase==='native-still-track-ready');assert.match(trackPhase.details.track.deviceIdHash,/^fnv1a-[0-9a-f]{8}$/);assert.equal(JSON.stringify(trackPhase).includes('private-environment-camera-id'),false);assert.equal(trackPhase.details.otherCameraStreamLive,false);
  const capabilityPhase=phases.find(item=>item.phase==='native-still-capabilities-resolved'&&item.details.attempt===2);assert.equal(capabilityPhase.details.photoCapabilities.widthMax,4032);assert.deepEqual(capabilityPhase.details.requestedPhotoSettings,{imageWidth:4032,imageHeight:3024});
  const completed=phases.find(item=>item.phase==='native-still-attempt-completed');assert.equal(completed.details.result.sourceKind,'image-capture-photo');assert.equal(completed.details.result.nativeStill,true);assert.equal(completed.details.result.byteLength,240000);assert.ok(completed.details.durationMs>=0);
  const retry=phases.find(item=>item.phase==='native-still-retry-scheduled');assert.equal(retry.details.journalImportant,true);assert.equal(retry.details.attempt,2);
});

test('field still diagnostics reset their counter at a Rally session boundary',async()=>{
  const counts=[];
  for(const scopeToken of ['session-a','session-a','session-b']){
    const hardware=cameraHardware();
    await captureNativeCameraStill('rear',{
      scopeToken,mediaDevices:hardware.mediaDevices,stabilizationMs:1,wait:async()=>{},inspect:async()=>({width:4032,height:3024}),
      imageCaptureFactory:()=>({takePhoto:async()=>nativeBlob()}),
      onPhase:(phase,details)=>{if(phase==='native-still-attempt-started')counts.push(details.stillCount);}
    });
  }
  assert.deepEqual(counts,[0,1,0]);
});

test('a stalled diagnostic callback never adds unbounded capture latency',async()=>{
  const hardware=cameraHardware(),started=Date.now();
  const result=await captureNativeCameraStill('rear',{
    mediaDevices:hardware.mediaDevices,stabilizationMs:1,phaseTimeoutMs:5,totalTimeoutMs:250,takePhotoTimeoutMs:20,inspectionTimeoutMs:20,
    imageCaptureFactory:()=>({takePhoto:async()=>nativeBlob()}),inspect:async()=>({width:4032,height:3024}),wait:async()=>{},onPhase:()=>new Promise(()=>{})
  });
  assert.ok(Date.now()-started<250);assert.equal(result.blob.size,nativeBlob().size);assert.equal(hardware.live(),0);
});
