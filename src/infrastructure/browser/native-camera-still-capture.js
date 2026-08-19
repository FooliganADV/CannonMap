const CAMERA_ROLE_TO_FACING=Object.freeze({front:'user',rear:'environment',user:'user',environment:'environment'});

const abortError=()=>{
  if(typeof DOMException==='function')return new DOMException('Capture canceled.','AbortError');
  const error=new Error('Capture canceled.');error.name='AbortError';return error;
};

const waitFor=(ms,signal)=>new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(abortError());return;}
  const timer=setTimeout(done,Math.max(0,Number(ms)||0));
  function done(){signal?.removeEventListener?.('abort',aborted);resolve();}
  function aborted(){clearTimeout(timer);signal?.removeEventListener?.('abort',aborted);reject(abortError());}
  signal?.addEventListener?.('abort',aborted,{once:true});
});

const finitePositive=value=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):null;
const positiveMs=(value,fallback)=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):fallback;
const cameraRole=facing=>facing==='user'?'front':facing==='environment'?'rear':'unknown';
const trackUsable=(stream,track)=>Boolean(stream&&stream.active!==false&&track&&track.readyState==='live'&&track.enabled!==false&&track.muted!==true);

export class NativeStillUnavailableError extends Error{
  constructor(message='Native still capture is unavailable in this browser.',{cause,code='NATIVE_STILL_UNAVAILABLE'}={}){
    super(message,{cause});this.name='NativeStillUnavailableError';this.code=code;
  }
}

export function stopMediaStream(stream){
  try{for(const track of stream?.getTracks?.()||[])track.stop?.();}catch(_){/* Cleanup must never conceal the capture result. */}
}

async function bounded(operation,{timeoutMs,signal,code,message,onLateResolve=()=>{}}){
  if(signal?.aborted)throw abortError();
  let finished=false,timer=null,abortListener=null;
  let started;
  try{started=operation();}catch(error){throw error;}
  const task=Promise.resolve(started).then(value=>{
    if(finished){try{onLateResolve(value);}catch{}return {late:true};}
    return {value};
  },error=>{if(finished)return {late:true};throw error;});
  const guard=new Promise((_,reject)=>{
    timer=setTimeout(()=>{finished=true;reject(new NativeStillUnavailableError(message,{code}));},positiveMs(timeoutMs,2500));
    if(signal){abortListener=()=>{finished=true;reject(abortError());};signal.addEventListener?.('abort',abortListener,{once:true});}
  });
  try{
    const result=await Promise.race([task,guard]);
    if(result?.late)throw abortError();
    return result.value;
  }finally{
    finished=true;
    if(timer!==null)clearTimeout(timer);
    if(abortListener)signal?.removeEventListener?.('abort',abortListener);
  }
}

async function decodedDimensions(blob,{createBitmap=globalThis.createImageBitmap,imageFactory=()=>new globalThis.Image(),urlApi=globalThis.URL}={}){
  if(typeof createBitmap==='function'){
    try{const image=await createBitmap(blob);try{return {width:finitePositive(image.width),height:finitePositive(image.height)};}finally{image.close?.();}}catch(_){/* Safari can reject camera-backed blobs. */}
  }
  if(typeof globalThis.Image!=='function'||!urlApi?.createObjectURL)return {width:null,height:null};
  const url=urlApi.createObjectURL(blob),image=imageFactory();
  try{
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('Native still dimensions could not be read.'));image.src=url;});
    return {width:finitePositive(image.naturalWidth||image.width),height:finitePositive(image.naturalHeight||image.height)};
  }catch(_){return {width:null,height:null};}finally{urlApi.revokeObjectURL?.(url);}
}

function highestResolutionSettings(capabilities={}){
  const width=finitePositive(capabilities.imageWidth?.max),height=finitePositive(capabilities.imageHeight?.max),settings={};
  if(width)settings.imageWidth=width;
  if(height)settings.imageHeight=height;
  return settings;
}

/**
 * Captures the browser's native still Blob. A video/canvas frame is deliberately never
 * returned as an Original: callers must use manual file-input fallback when ImageCapture
 * is unavailable or rejected by the device.
 */
export async function captureNativeCameraStill(requestedCamera,{
  signal,
  mediaDevices=globalThis.navigator?.mediaDevices,
  imageCaptureFactory=track=>{
    if(typeof globalThis.ImageCapture!=='function')throw new NativeStillUnavailableError();
    return new globalThis.ImageCapture(track);
  },
  cameraSession=null,
  scopeToken=null,
  inspect=decodedDimensions,
  wait=waitFor,
  stabilizationMs=180,
  readinessTimeoutMs=1500,
  acquisitionTimeoutMs=2500,
  capabilityTimeoutMs=500,
  takePhotoTimeoutMs=2500,
  inspectionTimeoutMs=750,
  totalTimeoutMs=4500,
  phaseTimeoutMs=250,
  clock=()=>Date.now(),
  onPhase=()=>{}
}={}){
  const facingMode=CAMERA_ROLE_TO_FACING[requestedCamera];
  if(!facingMode)throw new TypeError(`Unsupported camera role: ${requestedCamera}`);
  if(!cameraSession&&!mediaDevices?.getUserMedia)throw new NativeStillUnavailableError('Camera media access is unavailable.',{code:'GET_USER_MEDIA_UNAVAILABLE'});
  if(signal?.aborted)throw abortError();

  const requestedRole=cameraRole(facingMode),started=clock(),total=positiveMs(totalTimeoutMs,4500);
  const remaining=(limit,code='NATIVE_STILL_TIMEOUT')=>{
    const value=total-(clock()-started);
    if(value<=0)throw new NativeStillUnavailableError('Native still capture exceeded its total deadline.',{code});
    return Math.max(1,Math.min(positiveMs(limit,value),value));
  };
  const emitPhase=async(phase,details={})=>{
    try{
      await bounded(()=>onPhase(phase,details),{
        timeoutMs:remaining(phaseTimeoutMs),signal,code:'CAMERA_PHASE_TIMEOUT',message:'Camera diagnostic phase reporting timed out.'
      });
    }catch(error){
      // Diagnostics must never add unbounded latency to a checkpoint capture.
      // Cancellation remains authoritative; a total-deadline error will be
      // enforced by the next capture operation's remaining-time check.
      if(error?.name==='AbortError')throw error;
    }
  };
  let stream=null,track=null,result=null,sessionOwned=false,streamWasReused=false,imageCapture=null;
  try{
    if(cameraSession){
      const acquired=await cameraSession.acquire(requestedRole,{reason:'native-still-capture',scopeToken,signal,timeoutMs:remaining(acquisitionTimeoutMs,'CAMERA_ACQUISITION_TIMEOUT')});
      stream=acquired.stream;track=acquired.track;imageCapture=acquired.imageCapture;sessionOwned=true;streamWasReused=acquired.reused;
      await emitPhase(acquired.reused?'stream-reused':'stream-created',{requestedCamera:requestedRole,actualCamera:acquired.actualCamera});
    }else{
      await emitPhase('permission-requested',{requestedCamera:requestedRole});
      stream=await bounded(
        ()=>mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facingMode},width:{ideal:4096},height:{ideal:3072}}}),
        {timeoutMs:remaining(acquisitionTimeoutMs,'CAMERA_ACQUISITION_TIMEOUT'),signal,code:'CAMERA_ACQUISITION_TIMEOUT',message:'Camera stream acquisition timed out.',onLateResolve:stopMediaStream}
      );
    }
    track=track||stream?.getVideoTracks?.()[0]||stream?.getTracks?.().find(item=>item.kind==='video');
    if(!track)throw new NativeStillUnavailableError('The selected camera did not provide a video track.',{code:'CAMERA_TRACK_UNAVAILABLE'});
    if(!trackUsable(stream,track))throw new NativeStillUnavailableError('The selected camera track is not currently usable.',{code:track.muted?'CAMERA_TRACK_MUTED':'CAMERA_NOT_READY'});
    if(signal?.aborted)throw abortError();

    try{imageCapture=imageCapture||imageCaptureFactory(track);}catch(error){
      if(error instanceof NativeStillUnavailableError)throw error;
      throw new NativeStillUnavailableError('Native ImageCapture is unavailable.',{cause:error,code:error?.name==='NotSupportedError'?'NATIVE_STILL_UNSUPPORTED':'NATIVE_STILL_UNAVAILABLE'});
    }
    if(!imageCapture||typeof imageCapture.takePhoto!=='function')throw new NativeStillUnavailableError();

    const readinessStarted=clock();
    while(track.readyState!=='live'&&clock()-readinessStarted<readinessTimeoutMs)await bounded(()=>wait(25,signal),{timeoutMs:remaining(50),signal,code:'CAMERA_NOT_READY',message:'Camera readiness wait timed out.'});
    if(!trackUsable(stream,track))throw new NativeStillUnavailableError('Camera did not become ready for a native still.',{code:track.muted?'CAMERA_TRACK_MUTED':'CAMERA_NOT_READY'});
    await emitPhase('stabilization-started',{requestedCamera:requestedRole,stabilizationMs});
    await bounded(()=>wait(stabilizationMs,signal),{timeoutMs:remaining(Math.max(50,stabilizationMs+100)),signal,code:'NATIVE_STILL_TIMEOUT',message:'Camera stabilization timed out.'});
    await emitPhase('stabilization-completed',{requestedCamera:requestedRole,stabilizationMs});

    let capabilities={};
    if(typeof imageCapture.getPhotoCapabilities==='function'){
      try{
        capabilities=await bounded(()=>imageCapture.getPhotoCapabilities(),{timeoutMs:remaining(capabilityTimeoutMs),signal,code:'PHOTO_CAPABILITIES_TIMEOUT',message:'Native photo capability lookup timed out.'})||{};
      }catch(error){
        if(error?.name==='AbortError')throw error;
        await emitPhase('photo-capabilities-unavailable',{requestedCamera:requestedRole,errorCode:error?.code||null});
      }
    }
    const photoSettings=highestResolutionSettings(capabilities);
    const takePhoto=settings=>bounded(()=>settings?imageCapture.takePhoto(settings):imageCapture.takePhoto(),{
      timeoutMs:remaining(takePhotoTimeoutMs),signal,code:'NATIVE_STILL_TIMEOUT',message:'Native still capture timed out.',
      onLateResolve:()=>{void emitPhase('late-native-still-discarded',{requestedCamera:requestedRole});}
    });
    let blob;
    try{blob=await takePhoto(Object.keys(photoSettings).length?photoSettings:null);}
    catch(firstError){
      if(firstError?.name==='AbortError'||firstError?.code==='NATIVE_STILL_TIMEOUT'||!Object.keys(photoSettings).length)throw new NativeStillUnavailableError('Native still capture failed.',{cause:firstError,code:firstError?.code||'NATIVE_STILL_FAILED'});
      try{blob=await takePhoto(null);}catch(error){throw new NativeStillUnavailableError('Native still capture failed.',{cause:error,code:error?.code||'NATIVE_STILL_FAILED'});}
    }
    if(signal?.aborted)throw abortError();
    if(!blob?.arrayBuffer||!Number(blob.size))throw new NativeStillUnavailableError('Native still capture returned no image bytes.',{code:'EMPTY_NATIVE_STILL'});

    let dimensions={width:null,height:null};
    try{dimensions=await bounded(()=>inspect(blob),{timeoutMs:remaining(inspectionTimeoutMs),signal,code:'NATIVE_STILL_INSPECTION_TIMEOUT',message:'Native still dimension inspection timed out.'})||dimensions;}
    catch(error){if(error?.name==='AbortError')throw error;await emitPhase('native-still-inspection-unavailable',{requestedCamera:requestedRole,errorCode:error?.code||null});}
    const settings=track.getSettings?.()||{},actualFacing=String(settings.facingMode||'').toLowerCase(),actualCamera=cameraRole(actualFacing);
    result={
      blob,
      provenance:Object.freeze({
        sourceKind:'image-capture-photo',nativeStill:true,derivedFromVideoFrame:false,upscaled:false,
        requestedCamera:requestedRole,actualCamera,cameraSelectionHonored:actualCamera==='unknown'?'unknown':actualCamera===requestedRole,
        captureMethod:'getUserMedia-imagecapture',mimeType:String(blob.type||'application/octet-stream'),byteLength:Number(blob.size),
        width:finitePositive(dimensions?.width),height:finitePositive(dimensions?.height),photoSettings:Object.freeze({...photoSettings}),
        trackSettings:Object.freeze({deviceId:settings.deviceId||null,facingMode:settings.facingMode||null,width:finitePositive(settings.width),height:finitePositive(settings.height)})
      })
    };
  }catch(error){
    if(sessionOwned)cameraSession.stop?.(requestedRole,`native-still-failure:${error?.code||error?.name||'unknown'}`);
    throw error;
  }finally{
    if(!sessionOwned)stopMediaStream(stream);
  }
  return Object.freeze({...result,tracksStopped:!sessionOwned,streamReused:streamWasReused});
}
