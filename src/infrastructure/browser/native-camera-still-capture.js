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
const cameraRole=facing=>facing==='user'?'front':facing==='environment'?'rear':'unknown';

export class NativeStillUnavailableError extends Error{
  constructor(message='Native still capture is unavailable in this browser.',{cause,code='NATIVE_STILL_UNAVAILABLE'}={}){
    super(message,{cause});this.name='NativeStillUnavailableError';this.code=code;
  }
}

export function stopMediaStream(stream){
  try{for(const track of stream?.getTracks?.()||[])track.stop?.();}catch(_){/* Cleanup must never conceal the capture result. */}
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
export async function captureNativeCameraStill(requestedCamera,{signal,mediaDevices=globalThis.navigator?.mediaDevices,imageCaptureFactory=track=>{
  if(typeof globalThis.ImageCapture!=='function')throw new NativeStillUnavailableError();
  return new globalThis.ImageCapture(track);
},cameraSession=null,scopeToken=null,inspect=decodedDimensions,wait=waitFor,stabilizationMs=180,readinessTimeoutMs=1500,onPhase=()=>{}}={}){
  const facingMode=CAMERA_ROLE_TO_FACING[requestedCamera];
  if(!facingMode)throw new TypeError(`Unsupported camera role: ${requestedCamera}`);
  if(!cameraSession&&!mediaDevices?.getUserMedia)throw new NativeStillUnavailableError('Camera media access is unavailable.',{code:'GET_USER_MEDIA_UNAVAILABLE'});
  if(signal?.aborted)throw abortError();

  let stream=null,track=null,result=null,sessionOwned=false,streamWasReused=false,imageCapture=null;
  try{
    if(cameraSession){const acquired=await cameraSession.acquire(cameraRole(facingMode),{reason:'native-still-capture',scopeToken});stream=acquired.stream;track=acquired.track;imageCapture=acquired.imageCapture;sessionOwned=true;streamWasReused=acquired.reused;await onPhase(acquired.reused?'stream-reused':'stream-created',{requestedCamera:cameraRole(facingMode),actualCamera:acquired.actualCamera});}
    else{await onPhase('permission-requested',{requestedCamera:cameraRole(facingMode)});stream=await mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facingMode},width:{ideal:4096},height:{ideal:3072}}});}
    track=track||stream?.getVideoTracks?.()[0]||stream?.getTracks?.().find(item=>item.kind==='video');
    if(!track)throw new NativeStillUnavailableError('The selected camera did not provide a video track.',{code:'CAMERA_TRACK_UNAVAILABLE'});
    if(signal?.aborted)throw abortError();

    try{imageCapture=imageCapture||imageCaptureFactory(track);}catch(error){
      if(error instanceof NativeStillUnavailableError)throw error;
      throw new NativeStillUnavailableError('Native ImageCapture is unavailable.',{cause:error});
    }
    if(!imageCapture||typeof imageCapture.takePhoto!=='function')throw new NativeStillUnavailableError();

    const started=Date.now();
    while(track.readyState&&track.readyState!=='live'&&Date.now()-started<readinessTimeoutMs)await wait(25,signal);
    if(track.readyState&&track.readyState!=='live')throw new NativeStillUnavailableError('Camera did not become ready for a native still.',{code:'CAMERA_NOT_READY'});
    await onPhase('stabilization-started',{requestedCamera:cameraRole(facingMode),stabilizationMs});
    await wait(stabilizationMs,signal);
    await onPhase('stabilization-completed',{requestedCamera:cameraRole(facingMode),stabilizationMs});

    let capabilities={};
    try{capabilities=await imageCapture.getPhotoCapabilities?.()||{};}catch(_){/* takePhoto without settings remains the native path. */}
    const photoSettings=highestResolutionSettings(capabilities);
    let blob;
    try{blob=Object.keys(photoSettings).length?await imageCapture.takePhoto(photoSettings):await imageCapture.takePhoto();}
    catch(firstError){
      if(!Object.keys(photoSettings).length)throw new NativeStillUnavailableError('Native still capture failed.',{cause:firstError,code:'NATIVE_STILL_FAILED'});
      try{blob=await imageCapture.takePhoto();}catch(error){throw new NativeStillUnavailableError('Native still capture failed.',{cause:error,code:'NATIVE_STILL_FAILED'});}
    }
    if(signal?.aborted)throw abortError();
    if(!blob?.arrayBuffer||!Number(blob.size))throw new NativeStillUnavailableError('Native still capture returned no image bytes.',{code:'EMPTY_NATIVE_STILL'});

    const dimensions=await inspect(blob),settings=track.getSettings?.()||{},actualFacing=String(settings.facingMode||'').toLowerCase(),actualCamera=cameraRole(actualFacing);
    const requestedRole=cameraRole(facingMode);
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
  }finally{
    if(!sessionOwned)stopMediaStream(stream);
  }
  return Object.freeze({...result,tracksStopped:!sessionOwned,streamReused:streamWasReused});
}
