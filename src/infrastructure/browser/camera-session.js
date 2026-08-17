const FACING=Object.freeze({rear:'environment',front:'user'});
const roleFromFacing=value=>String(value||'').toLowerCase()==='user'?'front':String(value||'').toLowerCase()==='environment'?'rear':'unknown';
const videoTrack=stream=>stream?.getVideoTracks?.()[0]||stream?.getTracks?.().find(item=>item?.kind==='video')||null;
const isLive=track=>Boolean(track&&track.readyState!=='ended');
const scopeError=()=>Object.assign(new Error('Camera acquisition belongs to a stale Rally scope.'),{name:'AbortError',code:'CAMERA_SCOPE_CHANGED'});

/** Owns reusable camera streams for exactly one active Project/day Rally scope. */
export function createCameraSession({mediaDevices=globalThis.navigator?.mediaDevices,imageCaptureFactory=track=>new globalThis.ImageCapture(track),scopeProvider=()=>null,onDiagnostic=()=>{}}={}){
  const entries=new Map(),pending=new Map();let scopeToken=null,generation=0,getUserMediaCallCount=0,destroyed=false;
  const emit=(eventType,details={})=>{try{onDiagnostic(Object.freeze({eventType,scopeToken,generation,getUserMediaCallCount,...details}));}catch{}};
  const normalizedScope=value=>String(value||scopeProvider?.()||'unscoped');
  const stopEntry=(role,reason)=>{const entry=entries.get(role);if(!entry)return;entries.delete(role);try{for(const track of entry.stream?.getTracks?.()||[])track.stop?.();}catch{}emit('camera_stream_stopped',{cameraRole:role,reason});};
  const teardown=(reason='scope-ended')=>{generation+=1;for(const role of [...entries.keys()])stopEntry(role,reason);pending.clear();scopeToken=null;emit('camera_session_destroyed',{reason});};
  const bindScope=requested=>{const next=normalizedScope(requested);if(scopeToken&&scopeToken!==next)teardown('rally-scope-changed');scopeToken=next;return next;};
  async function acquire(role,{reason='capture',scopeToken:requestedScope=null}={}){
    if(destroyed)throw Object.assign(new Error('Camera session is destroyed.'),{code:'CAMERA_SESSION_DESTROYED'});if(!FACING[role])throw new TypeError(`Unsupported camera role: ${role}`);
    const boundScope=bindScope(requestedScope),cached=entries.get(role),cachedTrack=videoTrack(cached?.stream);
    if(isLive(cachedTrack)){emit('camera_stream_reused',{requestedCamera:role,actualCamera:cached.actualCamera});return {...cached,track:cachedTrack,reused:true};}
    if(cached)stopEntry(role,'track-ended');const pendingKey=`${boundScope}:${role}`;if(pending.has(pendingKey))return pending.get(pendingKey);
    const acquisitionGeneration=generation,otherRoles=[...entries.keys()].filter(item=>item!==role);
    const task=(async()=>{getUserMediaCallCount+=1;emit('camera_stream_creation_requested',{requestedCamera:role,reason});let stream=null;
      try{
        stream=await mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:FACING[role]},width:{ideal:4096},height:{ideal:3072}}});
        if(destroyed||generation!==acquisitionGeneration||scopeToken!==boundScope){try{for(const track of stream?.getTracks?.()||[])track.stop?.();}catch{}emit('camera_late_stream_stopped',{requestedCamera:role,reason:'stale-rally-scope'});throw scopeError();}
        const track=videoTrack(stream);if(!isLive(track))throw Object.assign(new Error('Camera did not provide a live video track.'),{code:'CAMERA_TRACK_UNAVAILABLE'});
        const settings=track.getSettings?.()||{},actualCamera=roleFromFacing(settings.facingMode);let imageCapture;
        try{imageCapture=imageCaptureFactory(track);}catch(error){try{for(const item of stream.getTracks?.()||[])item.stop?.();}catch{}throw error;}
        if(!imageCapture||typeof imageCapture.takePhoto!=='function'){try{for(const item of stream.getTracks?.()||[])item.stop?.();}catch{}throw Object.assign(new Error('Native ImageCapture is unavailable.'),{code:'IMAGE_CAPTURE_INVALID'});}
        const entry={stream,track,imageCapture,actualCamera,boundScope};entries.set(role,entry);
        track.addEventListener?.('ended',()=>{if(entries.get(role)?.stream===stream){entries.delete(role);emit('camera_stream_interrupted',{cameraRole:role,reason:'track-ended'});}},{once:true});
        emit('camera_stream_created',{requestedCamera:role,actualCamera,reason});if(otherRoles.length)emit('camera_stream_switched',{fromCamera:otherRoles.at(-1),requestedCamera:role,actualCamera,retainedPriorStreams:otherRoles.length});return {...entry,reused:false};
      }catch(error){if(stream&&!entries.has(role)&&error?.code!=='CAMERA_SCOPE_CHANGED'){try{for(const track of stream.getTracks?.()||[])track.stop?.();}catch{}}emit('camera_stream_creation_failed',{requestedCamera:role,reason,errorName:error?.name||'Error',errorCode:error?.code||null});throw error;}finally{pending.delete(pendingKey);}
    })();pending.set(pendingKey,task);return task;
  }
  async function initialize({scopeToken:requestedScope=null}={}){const boundScope=bindScope(requestedScope);emit('camera_session_initializing',{permissionState:'requesting'});const probes=[];
    try{for(const role of ['rear','front']){const entry=await acquire(role,{reason:'rally-day-preflight',scopeToken:boundScope});probes.push(Object.freeze({cameraRole:role,requestedFacingMode:FACING[role],actualFacingMode:entry.track.getSettings?.().facingMode||null,readyState:entry.track.readyState||'live',imageCaptureAvailable:true}));}emit('camera_session_initialized',{permissionState:'granted',retainedStreamCount:entries.size});return Object.freeze({ready:true,probes:Object.freeze(probes)});}
    catch(error){if(scopeToken===boundScope)teardown(error?.name==='NotAllowedError'?'permission-failed':'session-initialization-failed');emit('camera_session_initialization_failed',{permissionState:error?.name==='NotAllowedError'?'denied':'unknown',errorName:error?.name||'Error'});throw error;}}
  return Object.freeze({acquire,initialize,teardown,stop(role,reason='recovery-required'){stopEntry(role,reason);},state:()=>Object.freeze({initialized:entries.size>0,scopeToken,retainedStreamCount:entries.size,roles:Object.freeze([...entries.keys()]),pendingAcquisitions:pending.size,getUserMediaCallCount,destroyed}),destroy(reason='logout-or-page-destroyed'){if(destroyed)return;teardown(reason);destroyed=true;}});
}
