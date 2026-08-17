import test from 'node:test';
import assert from 'node:assert/strict';
import {captureNativeCameraStill,NativeStillUnavailableError} from '../src/infrastructure/browser/native-camera-still-capture.js';

const nativeBlob=()=>new Blob([new Uint8Array(240_000)],{type:'image/jpeg'});

test('native camera adapter requests the highest still capability and always stops tracks',async()=>{
  const requests=[],photoCalls=[],waits=[];let stopped=0;
  const track={kind:'video',readyState:'live',stop(){stopped++;},getSettings:()=>({facingMode:'environment',width:1920,height:1080,deviceId:'rear-camera'})};
  const mediaDevices={async getUserMedia(constraints){requests.push(constraints);return {getVideoTracks:()=>[track],getTracks:()=>[track]};}};
  const result=await captureNativeCameraStill('rear',{mediaDevices,imageCaptureFactory:()=>({getPhotoCapabilities:async()=>({imageWidth:{max:4032},imageHeight:{max:3024}}),takePhoto:async settings=>{photoCalls.push(settings);return nativeBlob();}}),inspect:async()=>({width:4032,height:3024}),wait:async ms=>waits.push(ms)});
  assert.deepEqual(requests[0].video.facingMode,{ideal:'environment'});
  assert.deepEqual(photoCalls,[{imageWidth:4032,imageHeight:3024}]);
  assert.deepEqual(waits,[180]);
  assert.equal(stopped,1);assert.equal(result.tracksStopped,true);
  assert.deepEqual(result.provenance,{sourceKind:'image-capture-photo',nativeStill:true,derivedFromVideoFrame:false,upscaled:false,requestedCamera:'rear',actualCamera:'rear',cameraSelectionHonored:true,captureMethod:'getUserMedia-imagecapture',mimeType:'image/jpeg',byteLength:240000,width:4032,height:3024,photoSettings:{imageWidth:4032,imageHeight:3024},trackSettings:{deviceId:'rear-camera',facingMode:'environment',width:1920,height:1080}});
});
test('ImageCapture absence fails explicitly and never creates a canvas Original',async()=>{
  let stopped=0;const track={kind:'video',readyState:'live',stop(){stopped++;}},mediaDevices={getUserMedia:async()=>({getVideoTracks:()=>[track],getTracks:()=>[track]})};
  await assert.rejects(()=>captureNativeCameraStill('front',{mediaDevices,imageCaptureFactory:()=>{throw new NativeStillUnavailableError();},wait:async()=>{}}),error=>error.code==='NATIVE_STILL_UNAVAILABLE');
  assert.equal(stopped,1);
});

test('native still bytes are returned unchanged',async()=>{
  const bytes=new Uint8Array([255,216,1,2,3,255,217]),blob=new Blob([bytes],{type:'image/jpeg'}),track={kind:'video',readyState:'live',stop(){},getSettings:()=>({facingMode:'user'})};
  const result=await captureNativeCameraStill('front',{mediaDevices:{getUserMedia:async()=>({getVideoTracks:()=>[track],getTracks:()=>[track]})},imageCaptureFactory:()=>({takePhoto:async()=>blob}),inspect:async()=>({width:3024,height:4032}),wait:async()=>{}});
  assert.deepEqual([...new Uint8Array(await result.blob.arrayBuffer())],[...bytes]);
  assert.equal(result.provenance.nativeStill,true);assert.equal(result.provenance.upscaled,false);
});

test('session-owned capture reuses and retains its authorized track',async()=>{
  let stopped=0;const track={kind:'video',readyState:'live',stop(){stopped++;},getSettings:()=>({facingMode:'environment'})},stream={getTracks:()=>[track]};
  const cameraSession={acquire:async()=>({stream,track,imageCapture:{takePhoto:async()=>nativeBlob()},actualCamera:'rear',reused:true})};
  const result=await captureNativeCameraStill('rear',{cameraSession,scopeToken:'project-a:1',inspect:async()=>({width:4032,height:3024}),wait:async()=>{}});
  assert.equal(stopped,0);assert.equal(result.tracksStopped,false);assert.equal(result.streamReused,true);
});
