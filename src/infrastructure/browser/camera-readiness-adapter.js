const CAMERA_PROBES=Object.freeze([
  Object.freeze({cameraRole:'rear',facingMode:'environment'}),
  Object.freeze({cameraRole:'front',facingMode:'user'})
]);

const PERMISSION_STATES=new Set(['granted','prompt','denied']);

const serializableError=error=>Object.freeze({
  name:String(error?.name||'Error'),
  code:error?.code?String(error.code):null,
  message:String(error?.message||error||'Camera operation failed.')
});

export class BrowserCameraReadinessError extends Error{
  constructor(message,{cause,code='CAMERA_READINESS_FAILED',cameraRole=null,classification=null}={}){
    super(message,{cause});
    this.name='BrowserCameraReadinessError';
    this.code=code;
    this.cameraRole=cameraRole;
    this.classification=classification;
  }
}

/** Maps DOM camera errors to stable, non-binary diagnostic categories. */
export function classifyCameraReadinessError(error){
  if(error?.classification)return Object.freeze({...error.classification,error:serializableError(error)});
  const name=String(error?.name||''),explicit=String(error?.code||'');
  let code='CAMERA_STREAM_INTERRUPTED',permissionState=null,capabilityState='interrupted',retryable=true,platformLimitation=false;
  if(name==='NotAllowedError'||name==='SecurityError'||explicit==='CAMERA_PERMISSION_DENIED'){
    code='CAMERA_PERMISSION_DENIED';permissionState='denied';capabilityState='unavailable';retryable=false;
  }else if(name==='NotFoundError'||explicit==='CAMERA_TRACK_UNAVAILABLE'||explicit==='CAMERA_UNAVAILABLE'){
    code='CAMERA_UNAVAILABLE';capabilityState='unavailable';retryable=false;
  }else if(name==='OverconstrainedError'||name==='ConstraintNotSatisfiedError'){
    code='CAMERA_CONSTRAINT_UNSUPPORTED';capabilityState='unavailable';retryable=false;
  }else if(explicit==='IMAGE_CAPTURE_UNAVAILABLE'||explicit==='IMAGE_CAPTURE_INVALID'){
    code='IMAGE_CAPTURE_UNAVAILABLE';capabilityState='manual-only';retryable=false;platformLimitation=true;
  }else if(explicit==='GET_USER_MEDIA_UNAVAILABLE'){
    code='GET_USER_MEDIA_UNAVAILABLE';capabilityState='manual-only';retryable=false;platformLimitation=true;
  }else if(explicit==='INSECURE_CONTEXT'){
    code='INSECURE_CONTEXT';capabilityState='manual-only';retryable=false;platformLimitation=true;
  }else if(name==='AbortError'){
    code='CAMERA_STREAM_INTERRUPTED';capabilityState='interrupted';retryable=true;
  }else if(explicit==='CAMERA_PROBE_TIMEOUT'){
    code='CAMERA_PROBE_TIMEOUT';capabilityState='interrupted';retryable=true;
  }
  return Object.freeze({code,permissionState,capabilityState,retryable,platformLimitation,error:serializableError(error)});
}

const stopStream=stream=>{
  try{for(const track of stream?.getTracks?.()||[])track?.stop?.();}catch{/* Cleanup must not conceal the readiness result. */}
};

const normalizePermissionState=value=>PERMISSION_STATES.has(String(value))?String(value):'unknown';

/**
 * Browser-only camera readiness adapter. It owns DOM API interaction while the
 * application service owns lifecycle policy. Probe streams are always stopped;
 * this adapter never keeps the privacy indicator or camera hardware active.
 */
export function createBrowserCameraReadinessAdapter({
  mediaDevices=globalThis.navigator?.mediaDevices??null,
  permissions=globalThis.navigator?.permissions??null,
  imageCaptureFactory=typeof globalThis.ImageCapture==='function'?track=>new globalThis.ImageCapture(track):null,
  secureContext=globalThis.isSecureContext!==false,
  probeTimeoutMs=5000,
  setTimer=globalThis.setTimeout,
  clearTimer=globalThis.clearTimeout,
  onDiagnostic=null
}={}){
  let permissionStatus=null,destroyed=false;
  const permissionListeners=new Set();
  const permissionQuerySupported=Boolean(permissions&&typeof permissions.query==='function');
  const getUserMediaSupported=Boolean(secureContext&&mediaDevices&&typeof mediaDevices.getUserMedia==='function');
  const imageCaptureSupported=typeof imageCaptureFactory==='function';

  const diagnostic=(eventType,details={})=>{
    try{onDiagnostic?.(Object.freeze({eventType,...details}));}catch{/* Diagnostics must never break camera setup. */}
  };

  const notifyPermissionChange=()=>{
    const state=normalizePermissionState(permissionStatus?.state);
    diagnostic('camera_permission_changed',{permissionState:state});
    for(const listener of [...permissionListeners]){
      try{listener(state);}catch{/* One observer must not block the others. */}
    }
  };

  const detachPermissionStatus=()=>{
    if(!permissionStatus)return;
    try{permissionStatus.removeEventListener?.('change',notifyPermissionChange);}catch{}
    if(permissionStatus.onchange===notifyPermissionChange)permissionStatus.onchange=null;
    permissionStatus=null;
  };

  async function queryPermission(){
    if(destroyed)return Object.freeze({state:'unknown',querySupported:permissionQuerySupported,reasonCode:'ADAPTER_DESTROYED'});
    if(!permissionQuerySupported)return Object.freeze({state:'unknown',querySupported:false,reasonCode:'PERMISSION_QUERY_UNSUPPORTED'});
    try{
      const status=await permissions.query({name:'camera'});
      if(status!==permissionStatus){
        detachPermissionStatus();
        permissionStatus=status||null;
        if(permissionStatus?.addEventListener)permissionStatus.addEventListener('change',notifyPermissionChange);
        else if(permissionStatus)permissionStatus.onchange=notifyPermissionChange;
      }
      const state=normalizePermissionState(status?.state);
      diagnostic('camera_permission_queried',{permissionState:state});
      return Object.freeze({state,querySupported:true,reasonCode:state==='unknown'?'PERMISSION_QUERY_UNKNOWN':null});
    }catch(error){
      const summary=serializableError(error);
      diagnostic('camera_permission_query_failed',{error:summary});
      return Object.freeze({state:'unknown',querySupported:false,reasonCode:'PERMISSION_QUERY_FAILED',error:summary});
    }
  }

  async function probeOne({cameraRole,facingMode}){
    let stream=null;
    try{
      diagnostic('camera_stream_acquisition_requested',{cameraRole});
      const constraints={audio:false,video:{facingMode:{ideal:facingMode},width:{ideal:4096},height:{ideal:3072}}};
      let timedOut=false,timer=null;
      const acquisition=Promise.resolve().then(()=>mediaDevices.getUserMedia(constraints)).then(value=>{
        if(timedOut){stopStream(value);diagnostic('camera_late_probe_stream_stopped',{cameraRole});return null;}
        return value;
      },error=>{
        if(timedOut)return null;
        throw error;
      });
      const timeout=new Promise((_,reject)=>{
        timer=setTimer(()=>{
          timedOut=true;
          reject(new BrowserCameraReadinessError(`${cameraRole} camera readiness probe timed out.`,{code:'CAMERA_PROBE_TIMEOUT',cameraRole}));
        },Math.max(1,Number(probeTimeoutMs)||5000));
      });
      try{stream=await Promise.race([acquisition,timeout]);}
      finally{if(timer!==null)clearTimer(timer);}
      if(!stream)throw new BrowserCameraReadinessError(`${cameraRole} camera readiness probe timed out.`,{code:'CAMERA_PROBE_TIMEOUT',cameraRole});
      const track=stream?.getVideoTracks?.()[0]||stream?.getTracks?.().find(item=>item?.kind==='video');
      if(!track)throw new BrowserCameraReadinessError(`The ${cameraRole} camera did not provide a video track.`,{code:'CAMERA_TRACK_UNAVAILABLE',cameraRole});
      if(track.readyState!=='live')throw new BrowserCameraReadinessError(`The ${cameraRole} camera track is not live.`,{code:'CAMERA_STREAM_INTERRUPTED',cameraRole});
      let imageCapture;
      try{imageCapture=imageCaptureFactory(track);}catch(error){
        throw new BrowserCameraReadinessError('Native ImageCapture could not be created.',{cause:error,code:'IMAGE_CAPTURE_UNAVAILABLE',cameraRole});
      }
      if(!imageCapture||typeof imageCapture.takePhoto!=='function')throw new BrowserCameraReadinessError('Native ImageCapture.takePhoto is unavailable.',{code:'IMAGE_CAPTURE_INVALID',cameraRole});
      const settings=track.getSettings?.()||{};
      diagnostic('camera_stream_acquired',{cameraRole,readyState:track.readyState,actualFacingMode:settings.facingMode||null,imageCaptureAvailable:true});
      return Object.freeze({cameraRole,requestedFacingMode:facingMode,actualFacingMode:settings.facingMode||null,readyState:'live',imageCaptureAvailable:true});
    }catch(error){
      const classification=classifyCameraReadinessError(error),wrapped=error instanceof BrowserCameraReadinessError?error:new BrowserCameraReadinessError(`${cameraRole} camera readiness probe failed.`,{cause:error,code:classification.code,cameraRole,classification});
      diagnostic('camera_stream_acquisition_failed',{cameraRole,classification});
      throw wrapped;
    }finally{
      stopStream(stream);
      diagnostic('camera_probe_stream_stopped',{cameraRole});
    }
  }

  async function probeCameras(){
    if(destroyed)throw new BrowserCameraReadinessError('Camera adapter is destroyed.',{code:'ADAPTER_DESTROYED'});
    if(!secureContext)throw new BrowserCameraReadinessError('Camera access requires a secure context.',{code:'INSECURE_CONTEXT'});
    if(!getUserMediaSupported)throw new BrowserCameraReadinessError('Camera media access is unavailable.',{code:'GET_USER_MEDIA_UNAVAILABLE'});
    if(!imageCaptureSupported)throw new BrowserCameraReadinessError('Native ImageCapture is unavailable.',{code:'IMAGE_CAPTURE_UNAVAILABLE'});
    const probes=[];
    for(const camera of CAMERA_PROBES)probes.push(await probeOne(camera));
    return Object.freeze({ready:true,probes:Object.freeze(probes)});
  }

  return Object.freeze({
    capabilities:Object.freeze({permissionQuerySupported,getUserMediaSupported,imageCaptureSupported,secureContext:Boolean(secureContext)}),
    queryPermission,
    probeCameras,
    classifyError:classifyCameraReadinessError,
    subscribePermissionChange(listener){
      if(typeof listener!=='function')throw new TypeError('Permission listener must be a function.');
      permissionListeners.add(listener);
      return ()=>permissionListeners.delete(listener);
    },
    destroy(){
      if(destroyed)return;
      destroyed=true;permissionListeners.clear();detachPermissionStatus();
    }
  });
}
