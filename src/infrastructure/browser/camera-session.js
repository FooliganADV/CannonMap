const FACING=Object.freeze({rear:'environment',front:'user'});
export const CAMERA_RETENTION_POLICY=Object.freeze({RETAIN_ALL:'retain-all',SINGLE_ACTIVE:'single-active'});

/**
 * iOS/iPadOS WebKit cannot reliably keep front and rear capture devices active
 * together. Android and other platforms retain both streams by default so the
 * established low-latency checkpoint path is unchanged.
 */
export function cameraRetentionPolicyForPlatform({
  userAgent=globalThis.navigator?.userAgent||'',
  platform=globalThis.navigator?.platform||'',
  maxTouchPoints=globalThis.navigator?.maxTouchPoints||0
}={}){
  const iosDevice=/iPhone|iPad|iPod/i.test(String(userAgent));
  const ipadDesktopMode=String(platform)==='MacIntel'&&Number(maxTouchPoints)>1;
  return iosDevice||ipadDesktopMode?CAMERA_RETENTION_POLICY.SINGLE_ACTIVE:CAMERA_RETENTION_POLICY.RETAIN_ALL;
}

const roleFromFacing=value=>String(value||'').toLowerCase()==='user'?'front':String(value||'').toLowerCase()==='environment'?'rear':'unknown';
const videoTrack=stream=>stream?.getVideoTracks?.()[0]||stream?.getTracks?.().find(item=>item?.kind==='video')||null;
const positiveMs=(value,fallback)=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):fallback;
const scopeError=()=>Object.assign(new Error('Camera acquisition belongs to a stale Rally scope.'),{name:'AbortError',code:'CAMERA_SCOPE_CHANGED'});
const abortError=()=>typeof DOMException==='function'?new DOMException('Camera operation canceled.','AbortError'):Object.assign(new Error('Camera operation canceled.'),{name:'AbortError'});
const timeoutError=(message,code)=>Object.assign(new Error(message),{name:'TimeoutError',code});
const stopStream=stream=>{try{for(const track of stream?.getTracks?.()||[])track?.stop?.();}catch{}};

function usable(stream,track=videoTrack(stream)){
  return Boolean(stream&&stream.active!==false&&track&&track.readyState==='live'&&track.enabled!==false&&track.muted!==true);
}

async function bounded(operation,{timeoutMs,signal,timeoutCode,timeoutMessage,onLateResolve=()=>{}}){
  if(signal?.aborted)throw abortError();
  let finished=false,timer=null,abortListener=null;
  let started;
  try{started=operation();}catch(error){throw error;}
  const task=Promise.resolve(started).then(value=>{
    if(finished){try{onLateResolve(value);}catch{}return {late:true};}
    return {value};
  },error=>{
    if(finished)return {late:true};
    throw error;
  });
  const guard=new Promise((_,reject)=>{
    timer=setTimeout(()=>{finished=true;reject(timeoutError(timeoutMessage,timeoutCode));},positiveMs(timeoutMs,5000));
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

/** Owns reusable camera streams for exactly one active Project/day Rally scope. */
export function createCameraSession({
  mediaDevices=globalThis.navigator?.mediaDevices,
  imageCaptureFactory=track=>new globalThis.ImageCapture(track),
  scopeProvider=()=>null,
  retentionPolicy=cameraRetentionPolicyForPlatform(),
  acquisitionTimeoutMs=5000,
  photoProbeTimeoutMs=3000,
  initializationTimeoutMs=10000,
  clock=()=>Date.now(),
  onDiagnostic=()=>{}
}={}){
  const policy=retentionPolicy===CAMERA_RETENTION_POLICY.SINGLE_ACTIVE?CAMERA_RETENTION_POLICY.SINGLE_ACTIVE:CAMERA_RETENTION_POLICY.RETAIN_ALL;
  const entries=new Map(),pending=new Map(),verifiedRoles=new Set();
  let scopeToken=null,generation=0,getUserMediaCallCount=0,destroyed=false;
  const emit=(eventType,details={})=>{try{onDiagnostic(Object.freeze({eventType,scopeToken,generation,getUserMediaCallCount,retentionPolicy:policy,...details}));}catch{}};
  const normalizedScope=value=>String(value||scopeProvider?.()||'unscoped');

  const stopEntry=(role,reason,{preserveVerification=false}={})=>{
    const entry=entries.get(role);if(!entry)return;
    entries.delete(role);
    for(const cleanup of entry.cleanup||[]){try{cleanup();}catch{}}
    stopStream(entry.stream);
    if(!preserveVerification)verifiedRoles.delete(role);
    emit('camera_stream_stopped',{cameraRole:role,reason,preservedVerification:preserveVerification});
  };
  const teardown=(reason='scope-ended')=>{
    generation+=1;
    for(const role of [...entries.keys()])stopEntry(role,reason);
    pending.clear();verifiedRoles.clear();scopeToken=null;
    emit('camera_session_destroyed',{reason});
  };
  const bindScope=requested=>{const next=normalizedScope(requested);if(scopeToken&&scopeToken!==next)teardown('rally-scope-changed');scopeToken=next;return next;};
  const invalidate=(role,stream,reason)=>{
    if(entries.get(role)?.stream!==stream)return;
    stopEntry(role,reason);
    emit('camera_stream_invalidated',{cameraRole:role,reason});
  };
  const attachHealthListeners=(role,entry)=>{
    const cleanup=[];
    for(const [target,event,reason] of [[entry.track,'ended','track-ended'],[entry.track,'mute','track-muted'],[entry.stream,'inactive','stream-inactive']]){
      if(!target?.addEventListener)continue;
      const listener=()=>invalidate(role,entry.stream,reason);
      target.addEventListener(event,listener,{once:true});
      cleanup.push(()=>target.removeEventListener?.(event,listener));
    }
    entry.cleanup=cleanup;
  };

  async function acquire(role,{reason='capture',scopeToken:requestedScope=null,signal=null,timeoutMs=acquisitionTimeoutMs}={}){
    if(destroyed)throw Object.assign(new Error('Camera session is destroyed.'),{code:'CAMERA_SESSION_DESTROYED'});
    if(!FACING[role])throw new TypeError(`Unsupported camera role: ${role}`);
    const boundScope=bindScope(requestedScope),cached=entries.get(role),cachedTrack=videoTrack(cached?.stream);
    if(usable(cached?.stream,cachedTrack)){emit('camera_stream_reused',{requestedCamera:role,actualCamera:cached.actualCamera});return {...cached,track:cachedTrack,reused:true};}
    if(cached)stopEntry(role,cachedTrack?.muted?'track-muted':'track-unusable');
    if(policy===CAMERA_RETENTION_POLICY.SINGLE_ACTIVE){
      for(const otherRole of [...entries.keys()].filter(item=>item!==role))stopEntry(otherRole,'single-active-camera-switch',{preserveVerification:true});
    }
    const pendingKey=`${boundScope}:${role}`;if(pending.has(pendingKey))return pending.get(pendingKey);
    const acquisitionGeneration=generation,otherRoles=[...entries.keys()].filter(item=>item!==role);
    const task=(async()=>{
      getUserMediaCallCount+=1;emit('camera_stream_creation_requested',{requestedCamera:role,reason});let stream=null;
      try{
        stream=await bounded(
          ()=>mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:FACING[role]},width:{ideal:4096},height:{ideal:3072}}}),
          {timeoutMs,signal,timeoutCode:'CAMERA_ACQUISITION_TIMEOUT',timeoutMessage:`${role} camera acquisition timed out.`,onLateResolve:value=>{stopStream(value);emit('camera_late_stream_stopped',{requestedCamera:role,reason:'acquisition-timeout'});}}
        );
        if(destroyed||generation!==acquisitionGeneration||scopeToken!==boundScope){stopStream(stream);emit('camera_late_stream_stopped',{requestedCamera:role,reason:'stale-rally-scope'});throw scopeError();}
        const track=videoTrack(stream);
        if(!usable(stream,track))throw Object.assign(new Error('Camera did not provide a usable live video track.'),{code:track?.muted?'CAMERA_TRACK_MUTED':'CAMERA_TRACK_UNAVAILABLE'});
        const settings=track.getSettings?.()||{},actualCamera=roleFromFacing(settings.facingMode);let imageCapture;
        try{imageCapture=imageCaptureFactory(track);}catch(error){stopStream(stream);throw error;}
        if(!imageCapture||typeof imageCapture.takePhoto!=='function'){stopStream(stream);throw Object.assign(new Error('Native ImageCapture is unavailable.'),{code:'IMAGE_CAPTURE_INVALID'});}
        const entry={stream,track,imageCapture,actualCamera,boundScope,cleanup:[]};entries.set(role,entry);attachHealthListeners(role,entry);
        emit('camera_stream_created',{requestedCamera:role,actualCamera,reason});
        if(otherRoles.length)emit('camera_stream_switched',{fromCamera:otherRoles.at(-1),requestedCamera:role,actualCamera,retainedPriorStreams:otherRoles.length});
        return {...entry,reused:false};
      }catch(error){
        if(stream&&!entries.has(role)&&error?.code!=='CAMERA_SCOPE_CHANGED')stopStream(stream);
        emit('camera_stream_creation_failed',{requestedCamera:role,reason,errorName:error?.name||'Error',errorCode:error?.code||null});throw error;
      }finally{pending.delete(pendingKey);}
    })();
    pending.set(pendingKey,task);return task;
  }

  async function verifyNativeStill(role,entry,{signal=null,timeoutMs=photoProbeTimeoutMs}={}){
    if(!usable(entry?.stream,entry?.track))throw Object.assign(new Error(`${role} camera became unusable before native still verification.`),{code:'CAMERA_TRACK_UNAVAILABLE'});
    emit('camera_native_still_probe_started',{cameraRole:role});
    const blob=await bounded(()=>entry.imageCapture.takePhoto(),{
      timeoutMs,signal,timeoutCode:'CAMERA_NATIVE_STILL_PROBE_TIMEOUT',timeoutMessage:`${role} native still verification timed out.`,
      onLateResolve:()=>emit('camera_late_probe_photo_discarded',{cameraRole:role})
    });
    if(!blob?.arrayBuffer||!Number(blob.size))throw Object.assign(new Error(`${role} native still verification returned no image bytes.`),{code:'EMPTY_NATIVE_STILL'});
    verifiedRoles.add(role);
    emit('camera_native_still_probe_verified',{cameraRole:role,mimeType:String(blob.type||''),byteLength:Number(blob.size)});
    return Object.freeze({cameraRole:role,requestedFacingMode:FACING[role],actualFacingMode:entry.track.getSettings?.().facingMode||null,readyState:entry.track.readyState,imageCaptureAvailable:true,nativeStillVerified:true});
  }

  async function initialize({scopeToken:requestedScope=null,signal=null,timeoutMs=initializationTimeoutMs}={}){
    const boundScope=bindScope(requestedScope),started=clock(),total=positiveMs(timeoutMs,initializationTimeoutMs),probes=[];
    const remaining=limit=>{const value=total-(clock()-started);if(value<=0)throw timeoutError('Camera session initialization timed out.','CAMERA_SESSION_INITIALIZATION_TIMEOUT');return Math.max(1,Math.min(positiveMs(limit,value),value));};
    emit('camera_session_initializing',{permissionState:'requesting'});verifiedRoles.clear();
    try{
      for(const role of ['rear','front']){
        const entry=await acquire(role,{reason:'rally-day-preflight',scopeToken:boundScope,signal,timeoutMs:remaining(acquisitionTimeoutMs)});
        probes.push(await verifyNativeStill(role,entry,{signal,timeoutMs:remaining(photoProbeTimeoutMs)}));
      }
      const verifiedNativeStill=['rear','front'].every(role=>verifiedRoles.has(role));
      if(!verifiedNativeStill)throw Object.assign(new Error('Both cameras were not verified for native still capture.'),{code:'NATIVE_STILL_VERIFICATION_INCOMPLETE'});
      emit('camera_session_initialized',{permissionState:'granted',retainedStreamCount:entries.size,verifiedNativeStill});
      return Object.freeze({ready:true,verifiedNativeStill,verifiedRoles:Object.freeze([...verifiedRoles]),probes:Object.freeze(probes)});
    }catch(error){
      if(scopeToken===boundScope)teardown(error?.name==='NotAllowedError'?'permission-failed':'session-initialization-failed');
      emit('camera_session_initialization_failed',{permissionState:'unknown',errorName:error?.name||'Error',errorCode:error?.code||null});throw error;
    }
  }

  function state(){
    const usableRoles=[...entries].filter(([,entry])=>usable(entry.stream,entry.track)).map(([role])=>role);
    const verified=[...verifiedRoles];
    return Object.freeze({
      initialized:usableRoles.length>0,scopeToken,retainedStreamCount:usableRoles.length,retainedEntryCount:entries.size,
      roles:Object.freeze(usableRoles),verifiedRoles:Object.freeze(verified),verifiedNativeStill:['rear','front'].every(role=>verifiedRoles.has(role)),
      ready:['rear','front'].every(role=>verifiedRoles.has(role))&&(policy===CAMERA_RETENTION_POLICY.SINGLE_ACTIVE?usableRoles.length===1:usableRoles.length===2),
      pendingAcquisitions:pending.size,getUserMediaCallCount,retentionPolicy:policy,destroyed
    });
  }

  return Object.freeze({
    acquire,initialize,teardown,
    stop(role,reason='recovery-required'){stopEntry(role,reason);},
    state,
    destroy(reason='logout-or-page-destroyed'){if(destroyed)return;teardown(reason);destroyed=true;}
  });
}
