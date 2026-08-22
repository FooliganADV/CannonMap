const CAMERA_ROLE_TO_FACING=Object.freeze({front:'user',rear:'environment',user:'user',environment:'environment'});

const abortError=()=>{
  if(typeof DOMException==='function')return new DOMException('Capture canceled.','AbortError');
  const error=new Error('Capture canceled.');error.name='AbortError';return error;
};
const finitePositive=value=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):null;
const positiveMs=(value,fallback)=>finitePositive(value)||fallback;
const cameraRole=facing=>facing==='user'?'front':facing==='environment'?'rear':'unknown';
const videoTrack=stream=>stream?.getVideoTracks?.()[0]||stream?.getTracks?.().find(item=>item?.kind==='video')||null;
const trackUsable=(stream,track)=>Boolean(stream&&stream.active!==false&&track&&track.readyState==='live'&&track.enabled!==false&&track.muted!==true);

export class NativeStillUnavailableError extends Error{
  constructor(message='Native still capture is unavailable in this browser.',{cause,code='NATIVE_STILL_UNAVAILABLE'}={}){
    super(message,{cause});this.name='NativeStillUnavailableError';this.code=code;
  }
}

export function stopMediaStream(stream){
  try{for(const track of stream?.getTracks?.()||[])track.stop?.();}catch{/* Cleanup must never conceal capture state. */}
}

const waitFor=(ms,signal)=>new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(abortError());return;}
  const timer=setTimeout(done,Math.max(0,Number(ms)||0));
  function done(){signal?.removeEventListener?.('abort',aborted);resolve();}
  function aborted(){clearTimeout(timer);signal?.removeEventListener?.('abort',aborted);reject(abortError());}
  signal?.addEventListener?.('abort',aborted,{once:true});
});

function boundedValue(value,depth=0){
  if(value===null||value===undefined||typeof value==='boolean')return value;
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  if(typeof value==='string')return value.slice(0,240);
  if(depth>=2)return '[bounded]';
  if(Array.isArray(value))return value.slice(0,8).map(item=>boundedValue(item,depth+1));
  if(typeof value==='object'){
    const safe={};for(const [key,item] of Object.entries(value).slice(0,16))safe[String(key).slice(0,80)]=boundedValue(item,depth+1);return safe;
  }
  return String(value).slice(0,240);
}

async function bounded(operation,{timeoutMs,signal,code,message,onLateResolve=()=>{}}){
  if(signal?.aborted)throw abortError();
  let finished=false,timer=null,abortListener=null,started;
  try{started=operation();}catch(error){throw error;}
  const task=Promise.resolve(started).then(value=>{
    if(finished){try{onLateResolve(value);}catch{}return {late:true};}return {value};
  },error=>{if(finished)return {late:true};throw error;});
  const guard=new Promise((_,reject)=>{
    timer=setTimeout(()=>{finished=true;reject(new NativeStillUnavailableError(message,{code}));},positiveMs(timeoutMs,10000));
    if(signal){abortListener=()=>{finished=true;reject(abortError());};signal.addEventListener?.('abort',abortListener,{once:true});}
  });
  try{
    const result=await Promise.race([task,guard]);if(result?.late)throw abortError();return result.value;
  }finally{finished=true;if(timer!==null)clearTimeout(timer);if(abortListener)signal?.removeEventListener?.('abort',abortListener);}
}

async function decodedDimensions(blob,{createBitmap=globalThis.createImageBitmap,imageFactory=()=>new globalThis.Image(),urlApi=globalThis.URL}={}){
  if(typeof createBitmap==='function'){
    try{const image=await createBitmap(blob);try{return {width:finitePositive(image.width),height:finitePositive(image.height)};}finally{image.close?.();}}catch{/* Safari can reject camera-backed blobs. */}
  }
  if(typeof globalThis.Image!=='function'||!urlApi?.createObjectURL)return {width:null,height:null};
  const url=urlApi.createObjectURL(blob),image=imageFactory();
  try{
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('Native still dimensions could not be read.'));image.src=url;});
    return {width:finitePositive(image.naturalWidth||image.width),height:finitePositive(image.naturalHeight||image.height)};
  }catch{return {width:null,height:null};}finally{urlApi.revokeObjectURL?.(url);}
}

function highestResolutionSettings(capabilities={}){
  const width=finitePositive(capabilities.imageWidth?.max),height=finitePositive(capabilities.imageHeight?.max),settings={};
  if(width)settings.imageWidth=width;if(height)settings.imageHeight=height;return settings;
}
function nativeError(error,message='Native still capture failed.'){
  if(error?.name==='AbortError')return error;
  if(error instanceof NativeStillUnavailableError)return error;
  return new NativeStillUnavailableError(message,{cause:error,code:error?.code||(error?.name==='NotSupportedError'?'NATIVE_STILL_UNSUPPORTED':'NATIVE_STILL_FAILED')});
}
function safeDeviceIdHash(value){
  const text=String(value||'');if(!text)return null;let hash=0x811c9dc5;
  for(let index=0;index<text.length;index+=1){hash^=text.charCodeAt(index);hash=Math.imul(hash,0x01000193)>>>0;}
  return `fnv1a-${hash.toString(16).padStart(8,'0')}`;
}
function trackProvenance(track){
  const settings=track?.getSettings?.()||{};
  return Object.freeze({deviceIdHash:safeDeviceIdHash(settings.deviceId),facingMode:settings.facingMode||null,width:finitePositive(settings.width),height:finitePositive(settings.height)});
}
function diagnosticTrack(track){
  const settings=track?.getSettings?.()||{};
  return Object.freeze({
    deviceIdHash:safeDeviceIdHash(settings.deviceId),readyState:track?.readyState||null,muted:track?.muted===true,enabled:track?.enabled!==false,
    width:finitePositive(settings.width),height:finitePositive(settings.height),frameRate:finitePositive(settings.frameRate),facingMode:settings.facingMode||null
  });
}
function diagnosticCapabilities(capabilities={}){
  return Object.freeze({
    widthMin:finitePositive(capabilities.imageWidth?.min),widthMax:finitePositive(capabilities.imageWidth?.max),
    heightMin:finitePositive(capabilities.imageHeight?.min),heightMax:finitePositive(capabilities.imageHeight?.max)
  });
}
const diagnosticHistory={scopeToken:null,lastStillAt:null,stillCount:0,recoveries:[]};
function ensureDiagnosticScope(scopeToken){
  const next=String(scopeToken||'unscoped');if(diagnosticHistory.scopeToken===next)return;
  diagnosticHistory.scopeToken=next;diagnosticHistory.lastStillAt=null;diagnosticHistory.stillCount=0;diagnosticHistory.recoveries=[];
}
function noteRecovery(now){diagnosticHistory.recoveries=diagnosticHistory.recoveries.filter(value=>now-value<=15*60_000).slice(-19);diagnosticHistory.recoveries.push(now);}
function noteStill(now){diagnosticHistory.lastStillAt=now;diagnosticHistory.stillCount+=1;diagnosticHistory.recoveries=diagnosticHistory.recoveries.filter(value=>now-value<=15*60_000).slice(-20);}
function diagnosticContext(cameraSession,now,{ownsCurrentStream=false}={}){
  const session=cameraSession?.state?.()||{};
  const liveCount=Number(session.retainedStreamCount)||0;
  return Object.freeze({
    cameraSessionLiveCount:liveCount,otherCameraStreamLive:liveCount>(ownsCurrentStream?1:0),cameraSessionTakePhotoInFlight:session.takePhotoInFlight===true,
    timeSincePriorStillMs:diagnosticHistory.lastStillAt===null?null:Math.max(0,now-diagnosticHistory.lastStillAt),stillCount:diagnosticHistory.stillCount,
    recentRecoveryCount:diagnosticHistory.recoveries.filter(value=>now-value<=15*60_000).length,recoveryBackoffMs:Number(session.recoveryDelayRemainingMs)||0
  });
}

/**
 * Opens a fresh video stream, freezes one non-upscaled canvas frame, and closes
 * the stream. This is deliberately labelled as a video-frame fallback, never a
 * native still. Checkpoint evidence policy remains the caller's responsibility.
 */
export async function captureVideoFrameFallback(requestedCamera,{
  signal,mediaDevices=globalThis.navigator?.mediaDevices,cameraSession=null,scopeToken=null,frameCapture=null,
  videoFactory=()=>globalThis.document?.createElement?.('video'),
  canvasFactory=()=>globalThis.document?.createElement?.('canvas'),wait=waitFor,acquisitionTimeoutMs=5000,
  readinessTimeoutMs=2500,stabilizationMs=120,encodeTimeoutMs=1500,totalTimeoutMs=10000,clock=()=>Date.now()
}={}){
  const facingMode=CAMERA_ROLE_TO_FACING[requestedCamera];if(!facingMode)throw new TypeError(`Unsupported camera role: ${requestedCamera}`);
  if(!cameraSession&&!mediaDevices?.getUserMedia)throw new NativeStillUnavailableError('Video-frame fallback media access is unavailable.',{code:'VIDEO_FRAME_FALLBACK_UNAVAILABLE'});
  const video=typeof frameCapture==='function'?null:videoFactory?.(),canvas=typeof frameCapture==='function'?null:canvasFactory?.();
  if(typeof frameCapture!=='function'&&(!video||!canvas?.getContext))throw new NativeStillUnavailableError('A safe video-frame fallback surface is unavailable.',{code:'VIDEO_FRAME_FALLBACK_UNAVAILABLE'});
  const started=clock(),total=positiveMs(totalTimeoutMs,10000);
  const remaining=(limit,code='VIDEO_FRAME_FALLBACK_TIMEOUT')=>{
    const value=total-(clock()-started);if(value<=0)throw new NativeStillUnavailableError('Video-frame fallback exceeded its total deadline.',{code});
    return Math.max(1,Math.min(positiveMs(limit,value),value));
  };
  let acquired=null,stream=null,track=null,sessionOwned=false,succeeded=false;
  try{
    if(cameraSession){
      acquired=await cameraSession.acquire(cameraRole(facingMode),{reason:'video-frame-fallback',scopeToken,signal,timeoutMs:remaining(acquisitionTimeoutMs,'VIDEO_FRAME_FALLBACK_ACQUISITION_TIMEOUT'),requireImageCapture:false});
      stream=acquired.stream;track=acquired.track;sessionOwned=true;
    }else{
      stream=await bounded(
        ()=>mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facingMode},width:{ideal:4096},height:{ideal:3072}}}),
        {timeoutMs:remaining(acquisitionTimeoutMs,'VIDEO_FRAME_FALLBACK_ACQUISITION_TIMEOUT'),signal,code:'VIDEO_FRAME_FALLBACK_ACQUISITION_TIMEOUT',message:'Video-frame fallback acquisition timed out.',onLateResolve:stopMediaStream}
      );
      track=videoTrack(stream);
    }
    if(!trackUsable(stream,track))throw new NativeStillUnavailableError('Video-frame fallback camera track is unusable.',{code:track?.muted?'CAMERA_TRACK_MUTED':'CAMERA_TRACK_UNAVAILABLE'});
    if(typeof frameCapture==='function'){
      const captured=await bounded(()=>frameCapture({requestedCamera:cameraRole(facingMode),facingMode,signal,stream,track}),{
        timeoutMs:remaining(encodeTimeoutMs),signal,code:'VIDEO_FRAME_FALLBACK_ENCODE_TIMEOUT',message:'Video-frame fallback frame extraction timed out.'
      });
      const blob=captured?.blob;
      if(!blob?.arrayBuffer||!Number(blob.size))throw new NativeStillUnavailableError('Video-frame fallback returned no JPEG bytes.',{code:'EMPTY_VIDEO_FRAME_FALLBACK'});
      const settings=track.getSettings?.()||{},actualCamera=captured.actualCamera||cameraRole(String(settings.facingMode||'').toLowerCase());succeeded=true;
      return Object.freeze({blob,width:finitePositive(captured.width),height:finitePositive(captured.height),actualCamera,trackSettings:trackProvenance(track)});
    }
    video.muted=true;video.playsInline=true;video.autoplay=true;video.srcObject=stream;
    if(typeof video.play==='function')await bounded(()=>video.play(),{timeoutMs:remaining(readinessTimeoutMs),signal,code:'VIDEO_FRAME_FALLBACK_NOT_READY',message:'Video-frame fallback preview did not start.'});
    const readinessStarted=clock();
    while((Number(video.readyState)||0)<2||!finitePositive(video.videoWidth)||!finitePositive(video.videoHeight)){
      if(clock()-readinessStarted>=positiveMs(readinessTimeoutMs,2500))throw new NativeStillUnavailableError('Video-frame fallback did not produce a drawable frame.',{code:'VIDEO_FRAME_FALLBACK_NOT_READY'});
      await bounded(()=>wait(40,signal),{timeoutMs:remaining(100),signal,code:'VIDEO_FRAME_FALLBACK_NOT_READY',message:'Video-frame fallback readiness wait timed out.'});
    }
    await bounded(()=>wait(stabilizationMs,signal),{timeoutMs:remaining(Math.max(50,stabilizationMs+100)),signal,code:'VIDEO_FRAME_FALLBACK_TIMEOUT',message:'Video-frame fallback stabilization timed out.'});
    const width=finitePositive(video.videoWidth),height=finitePositive(video.videoHeight);canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d',{alpha:false});if(!context?.drawImage)throw new NativeStillUnavailableError('Video-frame fallback canvas is unavailable.',{code:'VIDEO_FRAME_FALLBACK_UNAVAILABLE'});
    context.drawImage(video,0,0,width,height);
    const blob=await bounded(()=>new Promise((resolve,reject)=>canvas.toBlob?.(value=>value?resolve(value):reject(new NativeStillUnavailableError('Video-frame fallback returned no JPEG bytes.',{code:'EMPTY_VIDEO_FRAME_FALLBACK'})),'image/jpeg',0.92)),{
      timeoutMs:remaining(encodeTimeoutMs),signal,code:'VIDEO_FRAME_FALLBACK_ENCODE_TIMEOUT',message:'Video-frame fallback JPEG encoding timed out.'
    });
    if(!blob?.arrayBuffer||!Number(blob.size))throw new NativeStillUnavailableError('Video-frame fallback returned no JPEG bytes.',{code:'EMPTY_VIDEO_FRAME_FALLBACK'});
    const settings=track.getSettings?.()||{},actualCamera=cameraRole(String(settings.facingMode||'').toLowerCase());
    succeeded=true;return Object.freeze({blob,width,height,actualCamera,trackSettings:trackProvenance(track)});
  }finally{
    try{video?.pause?.();}catch{}try{if(video)video.srcObject=null;}catch{}
    if(sessionOwned){
      const options=succeeded?{preserveVerification:true,outcome:'neutral'}:{outcome:'failure'};
      const released=cameraSession.release?.(acquired,`video-frame-fallback-${succeeded?'complete':'failed'}`,options);
      if(released!==true)cameraSession.stop?.(cameraRole(facingMode),`video-frame-fallback-${succeeded?'complete':'failed'}`,options);
    }else stopMediaStream(stream);
  }
}

/**
 * Captures a full-resolution native still. Each native attempt owns a fresh
 * stream. The first failure/10-second timeout is followed by full teardown,
 * cooldown, and exactly one retry on a new stream and ImageCapture instance.
 */
export async function captureNativeCameraStill(requestedCamera,{
  signal,mediaDevices=globalThis.navigator?.mediaDevices,imageCaptureFactory=track=>{
    if(typeof globalThis.ImageCapture!=='function')throw new NativeStillUnavailableError();return new globalThis.ImageCapture(track);
  },
  cameraSession=null,scopeToken=null,inspect=decodedDimensions,fallbackFrameCapture=null,wait=waitFor,stabilizationMs=180,
  readinessTimeoutMs=1500,acquisitionTimeoutMs=5000,capabilityTimeoutMs=1000,takePhotoTimeoutMs=10000,
  inspectionTimeoutMs=1000,recoveryCooldownMs=500,fallbackTimeoutMs=10000,totalTimeoutMs=40000,phaseTimeoutMs=250,
  captureType='camera_still',clock=()=>Date.now(),monotonicClock=()=>globalThis.performance?.now?.()??Date.now(),diagnosticClock=()=>Date.now(),onPhase=()=>{}
}={}){
  const facingMode=CAMERA_ROLE_TO_FACING[requestedCamera];if(!facingMode)throw new TypeError(`Unsupported camera role: ${requestedCamera}`);
  if(!cameraSession&&!mediaDevices?.getUserMedia)throw new NativeStillUnavailableError('Camera media access is unavailable.',{code:'GET_USER_MEDIA_UNAVAILABLE'});
  if(signal?.aborted)throw abortError();
  ensureDiagnosticScope(scopeToken);
  const requestedRole=cameraRole(facingMode),started=clock(),total=positiveMs(totalTimeoutMs,40000),nativeFailures=[];
  const remaining=(limit,code='NATIVE_STILL_TIMEOUT')=>{
    const value=total-(clock()-started);if(value<=0)throw new NativeStillUnavailableError('Native still capture exceeded its total deadline.',{code});
    return Math.max(1,Math.min(positiveMs(limit,value),value));
  };
  const emitPhase=async(phase,details={})=>{
    const safe=boundedValue({diagnosticOnly:true,captureType:String(captureType||'camera_still').slice(0,80),...details});
    try{await bounded(()=>onPhase(String(phase).slice(0,120),safe),{timeoutMs:remaining(phaseTimeoutMs),signal,code:'CAMERA_PHASE_TIMEOUT',message:'Camera diagnostic phase reporting timed out.'});}
    catch(error){if(error?.name==='AbortError')throw error;}
  };

  async function nativeAttempt(attemptIndex){
    const attemptStartedAt=monotonicClock(),context=diagnosticContext(cameraSession,diagnosticClock());
    let acquired=null,stream=null,track=null,imageCapture=null,sessionOwned=false,succeeded=false,actualCamera='unknown';
    let trackDetails=null,capabilityDetails=diagnosticCapabilities(),requestedPhotoSettings={};
    try{
      await emitPhase('native-still-attempt-started',{attempt:attemptIndex,monotonicStartedAt:attemptStartedAt,requestedCamera:requestedRole,actualCamera,...context});
      if(cameraSession){
        acquired=await cameraSession.acquire(requestedRole,{reason:`native-still-attempt-${attemptIndex}`,scopeToken,signal,timeoutMs:remaining(acquisitionTimeoutMs,'CAMERA_ACQUISITION_TIMEOUT')});
        stream=acquired.stream;track=acquired.track;imageCapture=acquired.imageCapture;sessionOwned=true;
      }else{
        await emitPhase('permission-requested',{requestedCamera:requestedRole,attempt:attemptIndex});
        stream=await bounded(()=>mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facingMode},width:{ideal:4096},height:{ideal:3072}}}),{
          timeoutMs:remaining(acquisitionTimeoutMs,'CAMERA_ACQUISITION_TIMEOUT'),signal,code:'CAMERA_ACQUISITION_TIMEOUT',message:'Camera stream acquisition timed out.',onLateResolve:stopMediaStream
        });
      }
      await emitPhase('stream-created',{requestedCamera:requestedRole,actualCamera:acquired?.actualCamera||'unknown',attempt:attemptIndex});
      track=track||videoTrack(stream);
      if(!track)throw new NativeStillUnavailableError('The selected camera did not provide a video track.',{code:'CAMERA_TRACK_UNAVAILABLE'});
      if(!trackUsable(stream,track))throw new NativeStillUnavailableError('The selected camera track is not currently usable.',{code:track.muted?'CAMERA_TRACK_MUTED':'CAMERA_NOT_READY'});
      trackDetails=diagnosticTrack(track);actualCamera=cameraRole(String(track.getSettings?.().facingMode||'').toLowerCase());
      await emitPhase('native-still-track-ready',{attempt:attemptIndex,requestedCamera:requestedRole,actualCamera,track:trackDetails,...diagnosticContext(cameraSession,diagnosticClock(),{ownsCurrentStream:true})});
      if(actualCamera!=='unknown'&&actualCamera!==requestedRole)throw new NativeStillUnavailableError(`Requested ${requestedRole} camera opened the ${actualCamera} camera.`,{code:'CAMERA_ROLE_MISMATCH'});
      if(signal?.aborted)throw abortError();
      try{imageCapture=imageCapture||imageCaptureFactory(track);}catch(error){throw nativeError(error,'Native ImageCapture is unavailable.');}
      if(!imageCapture||typeof imageCapture.takePhoto!=='function')throw new NativeStillUnavailableError();
      const readinessStarted=clock();
      while(track.readyState!=='live'&&clock()-readinessStarted<readinessTimeoutMs)await bounded(()=>wait(25,signal),{timeoutMs:remaining(50),signal,code:'CAMERA_NOT_READY',message:'Camera readiness wait timed out.'});
      if(!trackUsable(stream,track))throw new NativeStillUnavailableError('Camera did not become ready for a native still.',{code:track.muted?'CAMERA_TRACK_MUTED':'CAMERA_NOT_READY'});
      await emitPhase('stabilization-started',{requestedCamera:requestedRole,stabilizationMs,attempt:attemptIndex});
      await bounded(()=>wait(stabilizationMs,signal),{timeoutMs:remaining(Math.max(50,stabilizationMs+100)),signal,code:'NATIVE_STILL_TIMEOUT',message:'Camera stabilization timed out.'});
      await emitPhase('stabilization-completed',{requestedCamera:requestedRole,stabilizationMs,attempt:attemptIndex});
      let capabilities={};
      if(typeof imageCapture.getPhotoCapabilities==='function'){
        try{capabilities=await bounded(()=>imageCapture.getPhotoCapabilities(),{timeoutMs:remaining(capabilityTimeoutMs),signal,code:'PHOTO_CAPABILITIES_TIMEOUT',message:'Native photo capability lookup timed out.'})||{};}
        catch(error){if(error?.name==='AbortError')throw error;await emitPhase('photo-capabilities-unavailable',{requestedCamera:requestedRole,attempt:attemptIndex,errorCode:error?.code||null});}
      }
      capabilityDetails=diagnosticCapabilities(capabilities);const photoSettings=highestResolutionSettings(capabilities);requestedPhotoSettings={...photoSettings};
      await emitPhase('native-still-capabilities-resolved',{attempt:attemptIndex,requestedCamera:requestedRole,actualCamera,track:trackDetails,photoCapabilities:capabilityDetails,requestedPhotoSettings});
      const blob=await bounded(()=>Object.keys(photoSettings).length?imageCapture.takePhoto(photoSettings):imageCapture.takePhoto(),{
        timeoutMs:remaining(takePhotoTimeoutMs),signal,code:'NATIVE_STILL_TIMEOUT',message:'Native still capture timed out.',
        onLateResolve:()=>{void emitPhase('late-native-still-discarded',{requestedCamera:requestedRole,attempt:attemptIndex}).catch(()=>{});}
      });
      if(signal?.aborted)throw abortError();
      if(!blob?.arrayBuffer||!Number(blob.size))throw new NativeStillUnavailableError('Native still capture returned no image bytes.',{code:'EMPTY_NATIVE_STILL'});
      let dimensions={width:null,height:null};
      try{dimensions=await bounded(()=>inspect(blob),{timeoutMs:remaining(inspectionTimeoutMs),signal,code:'NATIVE_STILL_INSPECTION_TIMEOUT',message:'Native still dimension inspection timed out.'})||dimensions;}
      catch(error){if(error?.name==='AbortError')throw error;await emitPhase('native-still-inspection-unavailable',{requestedCamera:requestedRole,attempt:attemptIndex,errorCode:error?.code||null});}
      const attemptEndedAt=monotonicClock();
      const attemptDiagnostic={
        attempt:attemptIndex,monotonicStartedAt:attemptStartedAt,monotonicEndedAt:attemptEndedAt,durationMs:Math.max(0,attemptEndedAt-attemptStartedAt),
        requestedCamera:requestedRole,actualCamera,track:trackDetails,photoCapabilities:capabilityDetails,requestedPhotoSettings,
        result:{byteLength:Number(blob.size),width:finitePositive(dimensions?.width),height:finitePositive(dimensions?.height),sourceKind:'image-capture-photo',nativeStill:true}
      };
      succeeded=true;
      return Object.freeze({blob,dimensions,photoSettings,trackSettings:trackProvenance(track),actualCamera,attemptDiagnostic:Object.freeze(attemptDiagnostic)});
    }catch(error){
      const normalized=nativeError(error),attemptEndedAt=monotonicClock();
      normalized.cameraAttemptDiagnostic=Object.freeze({
        attempt:attemptIndex,outcome:'failure',errorCode:normalized?.code||normalized?.name||null,monotonicStartedAt:attemptStartedAt,monotonicEndedAt:attemptEndedAt,
        durationMs:Math.max(0,attemptEndedAt-attemptStartedAt),requestedCamera:requestedRole,actualCamera,track:trackDetails,
        photoCapabilities:capabilityDetails,requestedPhotoSettings
      });
      throw normalized;
    }finally{
      if(sessionOwned){
        const options=succeeded?{preserveVerification:true,verifiedNativeStill:true,outcome:'success'}:{outcome:'failure'};
        const released=cameraSession.release?.(acquired,`native-still-attempt-${attemptIndex}-${succeeded?'complete':'failed'}`,options);
        if(released!==true)cameraSession.stop?.(requestedRole,`native-still-attempt-${attemptIndex}-${succeeded?'complete':'failed'}`,options);
      }else stopMediaStream(stream);
    }
  }

  for(let index=0;index<2;index+=1){
    const attempt=index+1;
    try{
      const captured=await nativeAttempt(attempt),recoveryPath=index===0?'none':'native-retry-success',nativeRetryCount=index;
      const blob=captured.blob;noteStill(diagnosticClock());
      await emitPhase('native-still-attempt-completed',{...captured.attemptDiagnostic,...diagnosticContext(cameraSession,diagnosticClock())});
      return Object.freeze({
        blob,tracksStopped:true,streamReused:false,
        provenance:Object.freeze({
          sourceKind:'image-capture-photo',nativeStill:true,derivedFromVideoFrame:false,upscaled:false,
          requestedCamera:requestedRole,actualCamera:captured.actualCamera,cameraSelectionHonored:captured.actualCamera==='unknown'?'unknown':captured.actualCamera===requestedRole,
          captureMethod:'getUserMedia-imagecapture',mimeType:String(blob.type||'application/octet-stream'),byteLength:Number(blob.size),
          width:finitePositive(captured.dimensions?.width),height:finitePositive(captured.dimensions?.height),photoSettings:Object.freeze({...captured.photoSettings}),
          trackSettings:captured.trackSettings,recoveryPath,nativeRetryCount,nativeAttemptCount:attempt
        })
      });
    }catch(error){
      const normalized=nativeError(error);if(normalized?.name==='AbortError')throw normalized;nativeFailures.push(normalized);
      await emitPhase('native-still-attempt-ended',{...(normalized.cameraAttemptDiagnostic||{requestedCamera:requestedRole,attempt,errorCode:normalized.code||null,outcome:'failure'}),...diagnosticContext(cameraSession,diagnosticClock())});
      await emitPhase('native-still-attempt-failed',{requestedCamera:requestedRole,attempt,errorCode:normalized.code||null});
      if(index===0){
        noteRecovery(diagnosticClock());
        await emitPhase('native-still-retry-scheduled',{requestedCamera:requestedRole,attempt:2,recoveryCooldownMs,errorCode:normalized.code||null,journalImportant:true});
        await bounded(()=>wait(recoveryCooldownMs,signal),{timeoutMs:remaining(Math.max(100,recoveryCooldownMs+100)),signal,code:'CAMERA_RECOVERY_TIMEOUT',message:'Camera recovery cooldown timed out.'});
      }
    }
  }

  const fallbackStartedAt=monotonicClock();
  try{
    await emitPhase('video-frame-fallback-started',{requestedCamera:requestedRole,monotonicStartedAt:fallbackStartedAt,nativeFailureCodes:nativeFailures.map(error=>error.code||error.name),journalImportant:true,...diagnosticContext(cameraSession,diagnosticClock())});
    const fallback=await captureVideoFrameFallback(requestedRole,{signal,mediaDevices,cameraSession,scopeToken,frameCapture:fallbackFrameCapture,wait,totalTimeoutMs:remaining(fallbackTimeoutMs)});
    const blob=fallback?.blob;
    if(!blob?.arrayBuffer||!Number(blob.size))throw new NativeStillUnavailableError('Video-frame fallback returned no JPEG bytes.',{code:'EMPTY_VIDEO_FRAME_FALLBACK'});
    const actualCamera=fallback.actualCamera||cameraRole(String(fallback.trackSettings?.facingMode||'').toLowerCase());
    const fallbackEndedAt=monotonicClock();noteStill(diagnosticClock());
    await emitPhase('video-frame-fallback-completed',{
      requestedCamera:requestedRole,actualCamera,monotonicStartedAt:fallbackStartedAt,monotonicEndedAt:fallbackEndedAt,durationMs:Math.max(0,fallbackEndedAt-fallbackStartedAt),
      result:{byteLength:Number(blob.size),width:finitePositive(fallback.width),height:finitePositive(fallback.height),sourceKind:'fallback-video-frame',nativeStill:false},
      journalImportant:true,...diagnosticContext(cameraSession,diagnosticClock())
    });
    return Object.freeze({
      blob,tracksStopped:true,streamReused:false,
      provenance:Object.freeze({
        sourceKind:'fallback-video-frame',nativeStill:false,derivedFromVideoFrame:true,upscaled:false,requestedCamera:requestedRole,actualCamera,
        cameraSelectionHonored:actualCamera==='unknown'?'unknown':actualCamera===requestedRole,captureMethod:'getUserMedia-video-frame-fallback',
        mimeType:String(blob.type||'application/octet-stream'),byteLength:Number(blob.size),width:finitePositive(fallback.width),height:finitePositive(fallback.height),
        photoSettings:Object.freeze({}),trackSettings:Object.freeze({...fallback.trackSettings}),recoveryPath:'fallback-video-frame-after-native-retry',
        nativeRetryCount:1,nativeAttemptCount:2,nativeFailureCodes:Object.freeze(nativeFailures.map(error=>String(error.code||error.name||'NATIVE_STILL_FAILED').slice(0,120)))
      })
    });
  }catch(error){
    if(error?.name==='AbortError')throw error;
    const fallbackEndedAt=monotonicClock();
    await emitPhase('video-frame-fallback-failed',{requestedCamera:requestedRole,errorCode:error?.code||error?.name||null,monotonicStartedAt:fallbackStartedAt,monotonicEndedAt:fallbackEndedAt,durationMs:Math.max(0,fallbackEndedAt-fallbackStartedAt),journalImportant:true,...diagnosticContext(cameraSession,diagnosticClock())});
    const last=nativeFailures.at(-1)||error;
    throw new NativeStillUnavailableError('Native still capture failed after one fresh-stream retry and no safe video-frame fallback was available.',{cause:last,code:last?.code||'NATIVE_STILL_FAILED'});
  }
}
