const settle=(ms,signal)=>new Promise((resolve,reject)=>{const timer=setTimeout(resolve,ms);signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Capture canceled.','AbortError'));},{once:true});});

export function stopCameraStream(stream){
  try{for(const track of stream?.getTracks?.()||[])track.stop();}catch(_){ }
}

export async function captureCameraFrame(facingMode,{signal,quality=.95,settleMs=450,mediaDevices=globalThis.navigator?.mediaDevices,documentTarget=globalThis.document}={}){
  if(!mediaDevices?.getUserMedia)throw new Error('Camera capture is unavailable in this browser.');
  if(signal?.aborted)throw new DOMException('Capture canceled.','AbortError');
  let stream=null,video=null;
  try{
    stream=await mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facingMode},width:{ideal:1920},height:{ideal:1080}}});
    if(signal?.aborted)throw new DOMException('Capture canceled.','AbortError');
    video=documentTarget.createElement('video');video.muted=true;video.playsInline=true;video.setAttribute('playsinline','');video.srcObject=stream;
    await new Promise((resolve,reject)=>{const ready=()=>{cleanup();resolve();},failed=()=>{cleanup();reject(new Error('Camera preview failed to start.'));},cleanup=()=>{video.removeEventListener('loadeddata',ready);video.removeEventListener('error',failed);};video.addEventListener('loadeddata',ready,{once:true});video.addEventListener('error',failed,{once:true});video.play().catch(failed);});
    await settle(settleMs,signal);
    const width=Number(video.videoWidth),height=Number(video.videoHeight);if(width<16||height<16)throw new Error('Camera returned an empty frame.');
    const canvas=documentTarget.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d',{alpha:false});if(!context)throw new Error('Camera canvas is unavailable.');context.drawImage(video,0,0,width,height);
    return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Camera frame encoding failed.')),'image/jpeg',quality));
  }finally{
    try{video?.pause?.();if(video)video.srcObject=null;}catch(_){ }
    stopCameraStream(stream);
  }
}

export function createSequentialPairCapture({captureFrame=captureCameraFrame,switchDelayMs=350}={}){
  let controller=null;
  const cancel=()=>{controller?.abort();controller=null;};
  return Object.freeze({
    cancel,
    async capture({frontBlob=null,onSide=async()=>{},onPhase=()=>{}}={}){
      cancel();controller=new AbortController();const signal=controller.signal;
      try{
        let front=frontBlob;
        if(!front){onPhase('front');front=await captureFrame('user',{signal});await onSide('front',front);}
        await settle(switchDelayMs,signal);onPhase('rear');const rear=await captureFrame('environment',{signal});await onSide('rear',rear);onPhase('done');return {frontBlob:front,rearBlob:rear};
      }finally{controller=null;}
    }
  });
}
