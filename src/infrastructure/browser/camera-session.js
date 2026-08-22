const FACING=Object.freeze({rear:'environment',front:'user'});

// Keep the legacy constant available to older callers, but report the actual
// production ownership contract: every platform is exclusive and sequential.
export const CAMERA_RETENTION_POLICY=Object.freeze({RETAIN_ALL:'retain-all',SINGLE_ACTIVE:'single-active'});

export function cameraRetentionPolicyForPlatform({
  userAgent=globalThis.navigator?.userAgent||'',platform=globalThis.navigator?.platform||'',maxTouchPoints=globalThis.navigator?.maxTouchPoints||0
}={}){
  void userAgent;void platform;void maxTouchPoints;
  return CAMERA_RETENTION_POLICY.SINGLE_ACTIVE;
}

const roleFromFacing=value=>String(value||'').toLowerCase()==='user'?'front':String(value||'').toLowerCase()==='environment'?'rear':'unknown';
const videoTrack=stream=>stream?.getVideoTracks?.()[0]||stream?.getTracks?.().find(item=>item?.kind==='video')||null;
const finitePositive=value=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):null;
const positiveMs=(value,fallback)=>finitePositive(value)||fallback;
const scopeError=()=>Object.assign(new Error('Camera acquisition belongs to a stale Rally scope.'),{name:'AbortError',code:'CAMERA_SCOPE_CHANGED'});
const abortError=()=>typeof DOMException==='function'?new DOMException('Camera operation canceled.','AbortError'):Object.assign(new Error('Camera operation canceled.'),{name:'AbortError'});
const timeoutError=(message,code)=>Object.assign(new Error(message),{name:'TimeoutError',code});
const stopStream=stream=>{try{for(const track of stream?.getTracks?.()||[])track?.stop?.();}catch{/* Cleanup cannot conceal capture state. */}};

function usable(stream,track=videoTrack(stream)){
  return Boolean(stream&&stream.active!==false&&track&&track.readyState==='live'&&track.enabled!==false&&track.muted!==true);
}

function boundedValue(value,depth=0){
  if(value===null||value===undefined||typeof value==='boolean')return value;
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  if(typeof value==='string')return value.slice(0,240);
  if(depth>=2)return '[bounded]';
  if(Array.isArray(value))return value.slice(0,8).map(item=>boundedValue(item,depth+1));
  if(typeof value==='object'){
    const safe={};
    for(const [key,item] of Object.entries(value).slice(0,16))safe[String(key).slice(0,80)]=boundedValue(item,depth+1);
    return safe;
  }
  return String(value).slice(0,240);
}

async function bounded(operation,{timeoutMs,signal,timeoutCode,timeoutMessage,onLateResolve=()=>{}}){
  if(signal?.aborted)throw abortError();
  let finished=false,timer=null,abortListener=null,started;
  try{started=operation();}catch(error){throw error;}
  const task=Promise.resolve(started).then(value=>{
    if(finished){try{onLateResolve(value);}catch{}return {late:true};}
    return {value};
  },error=>{if(finished)return {late:true};throw error;});
  const guard=new Promise((_,reject)=>{
    timer=setTimeout(()=>{finished=true;reject(timeoutError(timeoutMessage,timeoutCode));},positiveMs(timeoutMs,5000));
    if(signal){abortListener=()=>{finished=true;reject(abortError());};signal.addEventListener?.('abort',abortListener,{once:true});}
  });
  try{
    const result=await Promise.race([task,guard]);
    if(result?.late)throw abortError();
    return result.value;
  }finally{
    finished=true;if(timer!==null)clearTimeout(timer);if(abortListener)signal?.removeEventListener?.('abort',abortListener);
  }
}

const waitFor=(ms,signal)=>bounded(
  ()=>new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(ms)||0))),
  {timeoutMs:Math.max(25,(Number(ms)||0)+100),signal,timeoutCode:'CAMERA_RECOVERY_WAIT_TIMEOUT',timeoutMessage:'Camera recovery wait timed out.'}
);

function highestResolutionSettings(capabilities={}){
  const width=finitePositive(capabilities.imageWidth?.max),height=finitePositive(capabilities.imageHeight?.max),settings={};
  if(width)settings.imageWidth=width;if(height)settings.imageHeight=height;return settings;
}

/** Owns camera hardware as one exclusive lease for one active Rally scope. */
export function createCameraSession({
  mediaDevices=globalThis.navigator?.mediaDevices,imageCaptureFactory=track=>new globalThis.ImageCapture(track),scopeProvider=()=>null,
  retentionPolicy=cameraRetentionPolicyForPlatform(),acquisitionTimeoutMs=5000,photoProbeTimeoutMs=10000,initializationTimeoutMs=30000,
  cameraSwitchCooldownMs=350,failureBackoffMs=500,maximumFailureBackoffMs=3000,capabilityTimeoutMs=1000,
  clock=()=>Date.now(),onDiagnostic=()=>{}
}={}){
  const policy=retentionPolicy===CAMERA_RETENTION_POLICY.SINGLE_ACTIVE?CAMERA_RETENTION_POLICY.SINGLE_ACTIVE:CAMERA_RETENTION_POLICY.RETAIN_ALL;
  const verifiedRoles=new Set(),waiters=[];
  let scopeToken=null,generation=0,getUserMediaCallCount=0,destroyed=false,visibilityState='visible';
  let activeEntry=null,acquiringRequest=null,leaseSequence=0,availableAt=0,failureCount=0,recoveryNotBefore=0;
  let takePhotoToken=null,lastFailureAt=null,lastSuccessfulVerificationAt=null,lastTeardownReason=null;

  const emit=(eventType,details={})=>{try{onDiagnostic(Object.freeze({eventType:String(eventType).slice(0,120),scopeToken,generation,getUserMediaCallCount,retentionPolicy:policy,ownershipPolicy:'exclusive-sequential',...boundedValue(details)}));}catch{/* Non-authoritative. */}};
  const normalizedScope=value=>String(value||scopeProvider?.()||'unscoped');
  const rejectOnce=(request,error)=>{if(request.settled)return;request.settled=true;request.reject(error);};
  const resolveOnce=(request,value)=>{if(request.settled)return;request.settled=true;request.resolve(value);};

  const applyFailureBackoff=(role,reason)=>{
    failureCount+=1;lastFailureAt=clock();verifiedRoles.delete(role);
    const delay=Math.min(positiveMs(maximumFailureBackoffMs,3000),positiveMs(failureBackoffMs,500)*(2**Math.min(failureCount-1,4)));
    recoveryNotBefore=Math.max(recoveryNotBefore,clock()+delay);
    emit('camera_recovery_backoff_scheduled',{cameraRole:role,reason,failureCount,delayMs:delay,recoveryNotBefore});
  };

  const releaseTurn=()=>queueMicrotask(()=>{void drainQueue();});
  const closeActive=(entry,reason,{preserveVerification=false,verifiedNativeStill=false,outcome='neutral',cooldownMs=cameraSwitchCooldownMs}={})=>{
    if(!entry||activeEntry?.leaseId!==entry.leaseId)return false;
    const owned=activeEntry;activeEntry=null;
    for(const cleanup of owned.cleanup||[]){try{cleanup();}catch{}}
    if(takePhotoToken?.leaseId===owned.leaseId)takePhotoToken=null;
    stopStream(owned.stream);
    if(verifiedNativeStill)verifiedRoles.add(owned.cameraRole);else if(!preserveVerification)verifiedRoles.delete(owned.cameraRole);
    if(outcome==='failure')applyFailureBackoff(owned.cameraRole,reason);else if(outcome==='success')failureCount=0;
    availableAt=Math.max(availableAt,clock()+Math.max(0,Number(cooldownMs)||0));
    emit('camera_stream_stopped',{cameraRole:owned.cameraRole,reason,preservedVerification:preserveVerification||verifiedNativeStill,verifiedNativeStill,outcome,leaseId:owned.leaseId});
    releaseTurn();return true;
  };

  const invalidate=(entry,reason)=>{
    if(activeEntry?.leaseId!==entry?.leaseId)return;
    closeActive(entry,reason,{outcome:'failure'});emit('camera_stream_invalidated',{cameraRole:entry.cameraRole,reason,leaseId:entry.leaseId});
  };
  const attachHealthListeners=entry=>{
    const cleanup=[];
    for(const [target,event,reason] of [[entry.track,'ended','track-ended'],[entry.track,'mute','track-muted'],[entry.stream,'inactive','stream-inactive']]){
      if(!target?.addEventListener)continue;
      const listener=()=>invalidate(entry,reason);target.addEventListener(event,listener,{once:true});cleanup.push(()=>target.removeEventListener?.(event,listener));
    }
    entry.cleanup=cleanup;
  };
  const guardedImageCapture=(raw,entry)=>Object.freeze({
    async getPhotoCapabilities(){if(activeEntry?.leaseId!==entry.leaseId)throw scopeError();return raw.getPhotoCapabilities?.()||{};},
    takePhoto(settings){
      if(activeEntry?.leaseId!==entry.leaseId)throw scopeError();
      if(takePhotoToken)throw Object.assign(new Error('A native still capture is already in flight.'),{code:'CAMERA_TAKE_PHOTO_BUSY'});
      const token={leaseId:entry.leaseId};takePhotoToken=token;let started;
      try{started=settings===undefined?raw.takePhoto():raw.takePhoto(settings);}catch(error){if(takePhotoToken===token)takePhotoToken=null;throw error;}
      return Promise.resolve(started).finally(()=>{if(takePhotoToken===token)takePhotoToken=null;});
    }
  });

  const teardown=(reason='scope-ended')=>{
    generation+=1;lastTeardownReason=String(reason||'scope-ended').slice(0,240);
    if(activeEntry)closeActive(activeEntry,reason,{cooldownMs:0});
    for(const request of waiters.splice(0))rejectOnce(request,scopeError());
    if(acquiringRequest){acquiringRequest.cancelled=true;rejectOnce(acquiringRequest,scopeError());}
    verifiedRoles.clear();scopeToken=null;takePhotoToken=null;failureCount=0;recoveryNotBefore=0;availableAt=0;
    emit('camera_session_destroyed',{reason:lastTeardownReason});
  };
  const bindScope=requested=>{const next=normalizedScope(requested);if(scopeToken&&scopeToken!==next)teardown('rally-scope-changed');scopeToken=next;return next;};

  async function fulfill(request){
    acquiringRequest=request;let stream=null;
    try{
      const delay=Math.max(availableAt,recoveryNotBefore)-clock();
      if(delay>0){emit('camera_acquisition_waiting',{requestedCamera:request.role,delayMs:delay});await waitFor(delay,request.signal);}
      if(request.cancelled||destroyed||generation!==request.generation||scopeToken!==request.boundScope||visibilityState!=='visible')throw scopeError();
      getUserMediaCallCount+=1;emit('camera_stream_creation_requested',{requestedCamera:request.role,reason:request.reason});
      stream=await bounded(
        ()=>mediaDevices?.getUserMedia?.({audio:false,video:{facingMode:{ideal:FACING[request.role]},width:{ideal:4096},height:{ideal:3072}}}),
        {timeoutMs:request.timeoutMs,signal:request.signal,timeoutCode:'CAMERA_ACQUISITION_TIMEOUT',timeoutMessage:`${request.role} camera acquisition timed out.`,onLateResolve:value=>{stopStream(value);emit('camera_late_stream_stopped',{requestedCamera:request.role,reason:'acquisition-timeout'});}}
      );
      if(request.cancelled||destroyed||generation!==request.generation||scopeToken!==request.boundScope||visibilityState!=='visible'){
        stopStream(stream);stream=null;emit('camera_late_stream_stopped',{requestedCamera:request.role,reason:'stale-rally-scope'});throw scopeError();
      }
      const track=videoTrack(stream);
      if(!usable(stream,track))throw Object.assign(new Error('Camera did not provide a usable live video track.'),{code:track?.muted?'CAMERA_TRACK_MUTED':'CAMERA_TRACK_UNAVAILABLE'});
      const settings=track.getSettings?.()||{},actualCamera=roleFromFacing(settings.facingMode);let rawImageCapture=null;
      if(request.requireImageCapture){
        try{rawImageCapture=imageCaptureFactory(track);}catch(error){throw error;}
        if(!rawImageCapture||typeof rawImageCapture.takePhoto!=='function')throw Object.assign(new Error('Native ImageCapture is unavailable.'),{code:'IMAGE_CAPTURE_INVALID'});
      }
      const entry={stream,track,rawImageCapture,actualCamera,boundScope:request.boundScope,cameraRole:request.role,cleanup:[],leaseId:++leaseSequence,reused:false};
      entry.imageCapture=rawImageCapture?guardedImageCapture(rawImageCapture,entry):null;activeEntry=entry;stream=null;attachHealthListeners(entry);
      emit('camera_stream_created',{requestedCamera:request.role,actualCamera,reason:request.reason,leaseId:entry.leaseId,imageCaptureRequired:request.requireImageCapture});
      resolveOnce(request,Object.freeze({stream:entry.stream,track:entry.track,imageCapture:entry.imageCapture,actualCamera:entry.actualCamera,boundScope:entry.boundScope,cameraRole:entry.cameraRole,leaseId:entry.leaseId,reused:false}));
    }catch(error){
      stopStream(stream);
      if(error?.name!=='AbortError'&&error?.code!=='CAMERA_SCOPE_CHANGED')applyFailureBackoff(request.role,`acquisition:${error?.code||error?.name||'unknown'}`);
      emit('camera_stream_creation_failed',{requestedCamera:request.role,reason:request.reason,errorName:error?.name||'Error',errorCode:error?.code||null});rejectOnce(request,error);
    }finally{if(acquiringRequest===request)acquiringRequest=null;if(!activeEntry)releaseTurn();}
  }
  async function drainQueue(){
    if(activeEntry||acquiringRequest||destroyed)return;let request;
    while((request=waiters.shift())){
      if(request.settled)continue;if(request.signal?.aborted){rejectOnce(request,abortError());continue;}
      if(request.generation!==generation||request.boundScope!==scopeToken){rejectOnce(request,scopeError());continue;}
      void fulfill(request);return;
    }
  }
  function acquire(role,{reason='capture',scopeToken:requestedScope=null,signal=null,timeoutMs=acquisitionTimeoutMs,requireImageCapture=true}={}){
    if(destroyed)return Promise.reject(Object.assign(new Error('Camera session is destroyed.'),{code:'CAMERA_SESSION_DESTROYED'}));
    if(!FACING[role])return Promise.reject(new TypeError(`Unsupported camera role: ${role}`));
    if(visibilityState!=='visible')return Promise.reject(Object.assign(new Error('Camera acquisition requires a visible document.'),{name:'AbortError',code:'CAMERA_DOCUMENT_HIDDEN'}));
    const boundScope=bindScope(requestedScope),requestGeneration=generation;
    return new Promise((resolve,reject)=>{
      const request={role,reason,boundScope,generation:requestGeneration,signal,timeoutMs:positiveMs(timeoutMs,acquisitionTimeoutMs),requireImageCapture:requireImageCapture!==false,resolve,reject,settled:false,cancelled:false};
      waiters.push(request);emit('camera_acquisition_queued',{requestedCamera:role,reason,queueDepth:waiters.length});void drainQueue();
    });
  }

  async function verifyNativeStill(role,entry,{signal=null,timeoutMs=photoProbeTimeoutMs}={}){
    if(!usable(entry?.stream,entry?.track))throw Object.assign(new Error(`${role} camera became unusable before native still verification.`),{code:'CAMERA_TRACK_UNAVAILABLE'});
    if(entry.actualCamera!=='unknown'&&entry.actualCamera!==role)throw Object.assign(new Error(`${role} camera request opened the ${entry.actualCamera} camera.`),{code:'CAMERA_ROLE_MISMATCH',requestedCamera:role,actualCamera:entry.actualCamera});
    emit('camera_native_still_probe_started',{cameraRole:role,leaseId:entry.leaseId});let capabilities={};
    if(typeof entry.imageCapture.getPhotoCapabilities==='function'){
      try{capabilities=await bounded(()=>entry.imageCapture.getPhotoCapabilities(),{timeoutMs:Math.min(positiveMs(timeoutMs,photoProbeTimeoutMs),positiveMs(capabilityTimeoutMs,1000)),signal,timeoutCode:'CAMERA_PHOTO_CAPABILITIES_TIMEOUT',timeoutMessage:`${role} native still capability lookup timed out.`})||{};}
      catch(error){if(error?.name==='AbortError')throw error;emit('camera_native_still_capabilities_unavailable',{cameraRole:role,errorCode:error?.code||null});}
    }
    const photoSettings=highestResolutionSettings(capabilities);
    const blob=await bounded(()=>Object.keys(photoSettings).length?entry.imageCapture.takePhoto(photoSettings):entry.imageCapture.takePhoto(),{
      timeoutMs,signal,timeoutCode:'CAMERA_NATIVE_STILL_PROBE_TIMEOUT',timeoutMessage:`${role} native still verification timed out.`,onLateResolve:()=>emit('camera_late_probe_photo_discarded',{cameraRole:role})
    });
    if(!blob?.arrayBuffer||!Number(blob.size))throw Object.assign(new Error(`${role} native still verification returned no image bytes.`),{code:'EMPTY_NATIVE_STILL'});
    verifiedRoles.add(role);lastSuccessfulVerificationAt=clock();
    emit('camera_native_still_probe_verified',{cameraRole:role,mimeType:String(blob.type||''),byteLength:Number(blob.size),photoSettings});
    return Object.freeze({cameraRole:role,requestedFacingMode:FACING[role],actualFacingMode:entry.track.getSettings?.().facingMode||null,readyState:entry.track.readyState,imageCaptureAvailable:true,nativeStillVerified:true,photoSettings:Object.freeze({...photoSettings})});
  }

  async function initialize({scopeToken:requestedScope=null,signal=null,timeoutMs=initializationTimeoutMs}={}){
    const boundScope=bindScope(requestedScope),started=clock(),total=positiveMs(timeoutMs,initializationTimeoutMs),probes=[];
    const remaining=limit=>{const value=total-(clock()-started);if(value<=0)throw timeoutError('Camera session initialization timed out.','CAMERA_SESSION_INITIALIZATION_TIMEOUT');return Math.max(1,Math.min(positiveMs(limit,value),value));};
    emit('camera_session_initializing',{permissionState:'requesting'});verifiedRoles.clear();
    try{
      for(const role of ['rear','front']){
        let entry=null,verified=false;
        try{entry=await acquire(role,{reason:'rally-day-preflight',scopeToken:boundScope,signal,timeoutMs:remaining(acquisitionTimeoutMs)});probes.push(await verifyNativeStill(role,entry,{signal,timeoutMs:remaining(photoProbeTimeoutMs)}));verified=true;}
        finally{if(entry)closeActive(entry,'preflight-probe-complete',{preserveVerification:verified,verifiedNativeStill:verified,outcome:verified?'success':'failure'});}
      }
      const verifiedNativeStill=['rear','front'].every(role=>verifiedRoles.has(role));
      if(!verifiedNativeStill)throw Object.assign(new Error('Both cameras were not verified for native still capture.'),{code:'NATIVE_STILL_VERIFICATION_INCOMPLETE'});
      emit('camera_session_initialized',{permissionState:'granted',retainedStreamCount:0,verifiedNativeStill});
      return Object.freeze({ready:true,verifiedNativeStill,verifiedRoles:Object.freeze([...verifiedRoles]),probes:Object.freeze(probes),retainedStreamCount:0,ownershipPolicy:'exclusive-sequential'});
    }catch(error){
      if(scopeToken===boundScope)teardown(error?.name==='NotAllowedError'?'permission-failed':'session-initialization-failed');
      emit('camera_session_initialization_failed',{permissionState:'unknown',errorName:error?.name||'Error',errorCode:error?.code||null});throw error;
    }
  }

  function state(){
    const live=activeEntry&&usable(activeEntry.stream,activeEntry.track)?1:0,verified=[...verifiedRoles],verifiedNativeStill=['rear','front'].every(role=>verifiedRoles.has(role));
    return Object.freeze({
      initialized:verified.length>0,scopeToken,retainedStreamCount:live,retainedEntryCount:activeEntry?1:0,
      roles:Object.freeze(activeEntry&&live?[activeEntry.cameraRole]:[]),activeCameraRole:activeEntry&&live?activeEntry.cameraRole:null,activeLeaseId:activeEntry&&live?activeEntry.leaseId:null,
      verifiedRoles:Object.freeze(verified),verifiedNativeStill,ready:visibilityState==='visible'&&verifiedNativeStill&&!destroyed,readinessBasis:'verified-native-still-capability',
      pendingAcquisitions:waiters.filter(item=>!item.settled).length+(acquiringRequest&&!acquiringRequest.settled?1:0),takePhotoInFlight:Boolean(takePhotoToken),
      takePhotoCameraRole:takePhotoToken&&activeEntry?.leaseId===takePhotoToken.leaseId?activeEntry.cameraRole:null,getUserMediaCallCount,
      retentionPolicy:policy,ownershipPolicy:'exclusive-sequential',destroyed,visibilityState,generation,failureCount,lastFailureAt,recoveryNotBefore,
      recoveryDelayRemainingMs:Math.max(0,recoveryNotBefore-clock()),lastSuccessfulVerificationAt,lastTeardownReason
    });
  }

  const release=(entryOrRole,reason='capture-complete',options={})=>{
    const entry=typeof entryOrRole==='object'?entryOrRole:activeEntry?.cameraRole===entryOrRole?activeEntry:null;return closeActive(entry,reason,options);
  };
  const setVisibility=(next,reason='document-visibility-changed')=>{
    visibilityState=String(next||'visible').toLowerCase()==='visible'?'visible':'hidden';if(visibilityState!=='visible')teardown(reason);
    emit('camera_visibility_changed',{visibilityState,reason});return state();
  };
  const teardownScope=(expectedScope,reason='rally-scope-ended')=>{
    if(expectedScope!==undefined&&expectedScope!==null&&scopeToken!==String(expectedScope))return false;teardown(reason);return true;
  };
  return Object.freeze({
    acquire,initialize,teardown,teardownScope,release,stop(role,reason='recovery-required',options={}){return release(role,reason,options);},
    setVisibility,visibilityChanged:setVisibility,state,destroy(reason='logout-or-page-destroyed'){if(destroyed)return;teardown(reason);destroyed=true;}
  });
}
