const PERMISSION_STATES=new Set(['unknown','prompt','granted','denied']);
const CAPABILITY_STATES=new Set(['uninitialized','checking','setup-required','ready','manual-only','unavailable','interrupted']);

const frozenState=value=>Object.freeze({...value});
const normalize=(value,allowed,fallback)=>allowed.has(String(value))?String(value):fallback;
const isoNow=()=>new Date().toISOString();

const safeDetails=(value,seen=new WeakSet())=>{
  if(value===null||value===undefined||['string','number','boolean'].includes(typeof value))return value;
  if(Array.isArray(value))return value.map(item=>safeDetails(item,seen));
  if(typeof value==='object'){
    if(seen.has(value))return '[Circular]';
    seen.add(value);
    const result={};
    for(const [key,item] of Object.entries(value)){
      if(key==='blob'||key==='stream'||key==='track'||key==='imageCapture')continue;
      result[key]=safeDetails(item,seen);
    }
    return result;
  }
  return String(value);
};

export class AutomaticCameraNotReadyError extends Error{
  constructor(state){
    super(`Automatic camera capture is not ready: ${state.reasonCode||state.capability}.`);
    this.name='AutomaticCameraNotReadyError';
    this.code=state.reasonCode||'AUTOMATIC_CAMERA_NOT_READY';
    this.readinessState=state;
  }
}

/**
 * Policy service for one-time camera setup and checkpoint auto-capture eligibility.
 * The injected adapter is the only component allowed to touch browser media APIs.
 */
export function createCameraReadinessService({
  adapter,
  priorSetupSucceeded=false,
  clock={iso:isoNow},
  onDiagnostic=null,
  onStateChange=null,
  persistSetupSucceeded=null
}={}){
  if(!adapter||typeof adapter.queryPermission!=='function'||typeof adapter.probeCameras!=='function')throw new TypeError('A camera readiness adapter is required.');
  const support=adapter.capabilities||{};
  let destroyed=false,inspectionPromise=null,probePromise=null;
  let current=frozenState({
    permission:'unknown',capability:'uninitialized',automaticCaptureEligible:false,reasonCode:'not-inspected',
    permissionQuerySupported:Boolean(support.permissionQuerySupported),getUserMediaSupported:Boolean(support.getUserMediaSupported),
    imageCaptureSupported:Boolean(support.imageCaptureSupported),lastVerifiedAt:null,setupAttemptedThisSession:false,
    priorSetupSucceeded:Boolean(priorSetupSucceeded),verifiedNativeStill:false,nativeStillCapability:support.imageCaptureSupported?'unverified':'unsupported',
    verifiedCameraRoles:Object.freeze([]),currentSessionVerified:false
  });

  const emit=(eventType,details={})=>{
    try{onDiagnostic?.(Object.freeze({eventType,occurredAt:clock.iso(),...safeDetails(details)}));}catch{/* Diagnostics are non-authoritative. */}
  };
  const publish=patch=>{
    current=frozenState({...current,...patch});
    try{onStateChange?.(current);}catch{/* UI observers are non-authoritative. */}
    return current;
  };
  const rememberSetupSucceeded=value=>{
    const normalized=Boolean(value);
    if(current.priorSetupSucceeded===normalized)return current;
    publish({priorSetupSucceeded:normalized});
    try{persistSetupSucceeded?.(normalized);}catch{/* Persistence failure does not change readiness. */}
    return current;
  };
  const publicReasonCode=code=>code==='CAMERA_PERMISSION_DENIED'?'permission-denied':String(code||'camera-readiness-failed').toLowerCase().replaceAll('_','-');
  const failFromClassification=(classification,{eventType='camera_readiness_failed'}={})=>{
    const permission=classification.permissionState||current.permission;
    let capability=normalize(classification.capabilityState,CAPABILITY_STATES,'interrupted');
    if(permission==='denied')capability='manual-only';
    const nativeStillCapability=classification.platformLimitation?'unsupported':String(classification.code||'').startsWith('CAMERA_PERMISSION')?'unverified':'failed';
    const state=publish({permission,capability,automaticCaptureEligible:false,reasonCode:publicReasonCode(classification.code),lastVerifiedAt:null,
      verifiedNativeStill:false,nativeStillCapability,verifiedCameraRoles:Object.freeze([]),currentSessionVerified:false});
    if(permission==='denied')rememberSetupSucceeded(false);
    emit(eventType,{permission:state.permission,capability:state.capability,reasonCode:state.reasonCode,classification});
    return current;
  };

  const unsubscribe=adapter.subscribePermissionChange?.(permissionState=>{
    if(destroyed)return;
    const normalized=normalize(permissionState,PERMISSION_STATES,'unknown');
    const capability=normalized==='denied'?'manual-only':normalized==='prompt'?'setup-required':'uninitialized';
    const reasonCode=normalized==='denied'?'permission-denied':'permission-changed-reverify';
    publish({permission:normalized,capability,automaticCaptureEligible:false,reasonCode,lastVerifiedAt:null,
      verifiedNativeStill:false,nativeStillCapability:current.imageCaptureSupported?'unverified':'unsupported',verifiedCameraRoles:Object.freeze([]),currentSessionVerified:false});
    if(normalized==='denied')rememberSetupSucceeded(false);
    emit('camera_permission_change_revoked_readiness',{permission:normalized,capability,reasonCode});
    if(normalized==='granted')queueMicrotask(()=>{if(!destroyed&&current.permission==='granted')void inspect({force:true});});
  })||(()=>{});

  const unsupportedState=()=>{
    if(support.secureContext===false)return publish({capability:'manual-only',automaticCaptureEligible:false,reasonCode:'insecure-context',verifiedNativeStill:false,nativeStillCapability:'unsupported',currentSessionVerified:false});
    if(!current.getUserMediaSupported)return publish({capability:'manual-only',automaticCaptureEligible:false,reasonCode:'get-user-media-unavailable',verifiedNativeStill:false,nativeStillCapability:'unsupported',currentSessionVerified:false});
    if(!current.imageCaptureSupported)return publish({capability:'manual-only',automaticCaptureEligible:false,reasonCode:'image-capture-unsupported',verifiedNativeStill:false,nativeStillCapability:'unsupported',currentSessionVerified:false});
    return null;
  };

  async function verifyWithProbe(reason){
    if(probePromise)return probePromise;
    probePromise=(async()=>{
      publish({capability:'checking',automaticCaptureEligible:false,reasonCode:'camera-readiness-checking',verifiedNativeStill:false,currentSessionVerified:false});
      emit('camera_readiness_probe_started',{reason});
      try{
        const result=await adapter.probeCameras();
        const roles=[...new Set((result?.verifiedRoles||result?.probes?.filter(item=>item?.nativeStillVerified===true).map(item=>item.cameraRole)||[]).map(String))];
        const verifiedNativeStill=result?.verifiedNativeStill===true&&['rear','front'].every(role=>roles.includes(role));
        if(!verifiedNativeStill)throw Object.assign(new Error('Camera streams opened, but native still capture was not verified for both cameras.'),{code:'NATIVE_STILL_VERIFICATION_INCOMPLETE'});
        const permission=await adapter.queryPermission();
        if(permission?.querySupported===false)publish({permissionQuerySupported:false});
        const permissionState=permission.state==='denied'?'denied':'granted';
        if(permissionState==='denied')return failFromClassification({code:'CAMERA_PERMISSION_DENIED',permissionState:'denied',capabilityState:'manual-only'},{eventType:'camera_readiness_probe_failed'});
        rememberSetupSucceeded(true);
        const state=publish({permission:'granted',capability:'ready',automaticCaptureEligible:true,reasonCode:null,lastVerifiedAt:clock.iso(),
          verifiedNativeStill:true,nativeStillCapability:'verified',verifiedCameraRoles:Object.freeze(roles),currentSessionVerified:true});
        emit('camera_readiness_verified',{reason,permission:state.permission,probeCount:Number(result?.probes?.length)||0,verifiedNativeStill:true,verifiedCameraRoles:roles});
        return state;
      }catch(error){
        let classification=adapter.classifyError?.(error)||{code:error?.code||'CAMERA_READINESS_FAILED',capabilityState:'interrupted'};
        // NotAllowedError is overloaded by browsers: it can mean a persisted
        // denial, a missing gesture, or another policy restriction. Resolve it
        // against the live Permissions API when available instead of caching a
        // false denial or pretending the permission is still granted.
        if(classification.code==='CAMERA_PERMISSION_UNVERIFIED'){
          const permission=await adapter.queryPermission();
          if(permission?.querySupported===false)publish({permissionQuerySupported:false});
          if(permission?.state==='denied')classification={...classification,code:'CAMERA_PERMISSION_DENIED',permissionState:'denied',capabilityState:'manual-only',retryable:false};
          else classification={...classification,permissionState:permission?.state==='prompt'?'prompt':'unknown',capabilityState:'setup-required'};
        }
        return failFromClassification(classification,{eventType:'camera_readiness_probe_failed'});
      }
    })().finally(()=>{probePromise=null;});
    return probePromise;
  }

  async function inspect({force=false}={}){
    if(destroyed)return current;
    const sessionReady=adapter.cameraSessionReady?.()!==false;
    if(current.automaticCaptureEligible&&current.verifiedNativeStill&&current.currentSessionVerified&&current.capability==='ready'&&!force&&sessionReady)return current;
    if(inspectionPromise)return inspectionPromise;
    inspectionPromise=(async()=>{
      const wasEligible=current.automaticCaptureEligible&&current.verifiedNativeStill&&current.currentSessionVerified&&current.capability==='ready';
      const unsupported=unsupportedState();
      if(unsupported){emit('camera_readiness_platform_manual_only',{reasonCode:unsupported.reasonCode});return unsupported;}
      publish({capability:'checking',automaticCaptureEligible:false,reasonCode:'camera-permission-checking'});
      const permission=await adapter.queryPermission();
      const permissionState=normalize(permission?.state,PERMISSION_STATES,'unknown');
      publish({permission:permissionState,permissionQuerySupported:permission?.querySupported!==false&&current.permissionQuerySupported});
      emit('camera_permission_state',{permission:permissionState,reasonCode:permission?.reasonCode||null,priorSetupSucceeded:current.priorSetupSucceeded});
      if(permissionState==='denied')return failFromClassification({code:'CAMERA_PERMISSION_DENIED',permissionState:'denied',capabilityState:'manual-only'},{eventType:'camera_readiness_permission_denied'});
      if(permissionState==='granted'){
        if(force&&wasEligible&&adapter.cameraSessionReady?.()!==false){
          const state=publish({permission:'granted',capability:'ready',automaticCaptureEligible:true,reasonCode:null});
          emit('camera_permission_reverified',{permission:'granted',cameraProbeSkipped:true});return state;
        }
        return verifyWithProbe('permission-granted');
      }
      // Browser permission prompts must be initiated by a deliberate rider gesture.
      // A persisted success hint is informational only; it is never proof that
      // this page/session can still acquire a camera or produce native stills.
      return publish({capability:'setup-required',automaticCaptureEligible:false,reasonCode:permissionState==='prompt'?'permission-setup-required':'permission-unknown-setup-required',lastVerifiedAt:null,
        verifiedNativeStill:false,nativeStillCapability:'unverified',verifiedCameraRoles:Object.freeze([]),currentSessionVerified:false});
    })().finally(()=>{inspectionPromise=null;});
    return inspectionPromise;
  }

  async function setupFromUserGesture(){
    if(destroyed)return current;
    publish({setupAttemptedThisSession:true});
    emit('camera_setup_requested',{permission:current.permission});
    const unsupported=unsupportedState();
    if(unsupported)return unsupported;
    // Do not place an awaited Permissions API query between the rider's tap and
    // getUserMedia: some browsers consume transient user activation narrowly.
    // Cached denial may be stale after the rider changes Safari/Chrome site
    // settings. Each deliberate tap is allowed exactly one bounded recheck;
    // there is no automatic retry loop.
    return verifyWithProbe('user-gesture-setup');
  }

  return Object.freeze({
    inspect,
    setupFromUserGesture,
    state:()=>current,
    assertAutomaticCaptureEligible(){if(!current.automaticCaptureEligible||!current.verifiedNativeStill||!current.currentSessionVerified)throw new AutomaticCameraNotReadyError(current);return current;},
    async prepareAutomaticCapture(){
      if(current.automaticCaptureEligible&&current.verifiedNativeStill&&current.currentSessionVerified&&current.capability==='ready'&&adapter.cameraSessionReady?.()!==false)return current;
      if(current.automaticCaptureEligible&&current.capability==='ready'&&adapter.cameraSessionReady?.()===false)publish({capability:'interrupted',automaticCaptureEligible:false,reasonCode:'camera-session-not-active',lastVerifiedAt:null,
        verifiedNativeStill:false,nativeStillCapability:'unverified',verifiedCameraRoles:Object.freeze([]),currentSessionVerified:false});
      // A transient stream interruption is the only automatic recovery case.
      // Permission prompt/unknown/denied and platform manual-only states must
      // never discover camera access by initiating getUserMedia at a checkpoint.
      if(current.capability==='interrupted'&&current.permission==='granted')await inspect({force:true});
      if(!current.automaticCaptureEligible||!current.verifiedNativeStill||!current.currentSessionVerified)throw new AutomaticCameraNotReadyError(current);
      return current;
    },
    noteCaptureSuccess(){
      if(destroyed)return current;
      rememberSetupSucceeded(true);
      const state=publish({permission:'granted',capability:'ready',automaticCaptureEligible:true,reasonCode:null,lastVerifiedAt:clock.iso(),
        verifiedNativeStill:true,nativeStillCapability:'verified',verifiedCameraRoles:Object.freeze(['rear','front']),currentSessionVerified:true});
      emit('camera_automatic_capture_verified',{lastVerifiedAt:state.lastVerifiedAt});return state;
    },
    async noteCaptureFailure(error,{requestedCamera=null}={}){
      if(destroyed)return current;
      const classification=adapter.classifyError?.(error)||{code:error?.code||'CAMERA_CAPTURE_FAILED',capabilityState:'interrupted'};
      emit('camera_capture_failure_classified',{requestedCamera,classification});
      failFromClassification(classification,{eventType:'camera_capture_failure_revoked_readiness'});
      const permission=await adapter.queryPermission();
      if(permission?.querySupported===false)publish({permissionQuerySupported:false});
      if(permission?.state==='denied')return failFromClassification({code:'CAMERA_PERMISSION_DENIED',permissionState:'denied',capabilityState:'manual-only'},{eventType:'camera_capture_permission_revoked'});
      if(permission?.state==='prompt')return publish({permission:'prompt',capability:'setup-required',automaticCaptureEligible:false,reasonCode:'permission-setup-required',lastVerifiedAt:null});
      if(permission?.state!=='granted')return publish({permission:'unknown',capability:'interrupted',automaticCaptureEligible:false,reasonCode:'permission-unknown-reverify',lastVerifiedAt:null});
      publish({permission:'granted'});
      return current;
    },
    async destroy(){
      if(destroyed)return;
      destroyed=true;unsubscribe();adapter.destroy?.();
    }
  });
}
