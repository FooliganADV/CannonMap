export const PREFLIGHT_STATUS=Object.freeze({
  READY:'READY',
  ACTION_REQUIRED:'ACTION_REQUIRED',
  BLOCKED:'BLOCKED',
  USER_GESTURE:'USER_GESTURE',
  UNKNOWN:'UNKNOWN'
});

export const PREFLIGHT_CAPABILITY=Object.freeze({
  GPS:'gps',
  CAMERA:'camera',
  STORAGE:'storage',
  OFFLINE:'offline'
});

const CAPABILITY_ORDER=Object.freeze(Object.values(PREFLIGHT_CAPABILITY));
const VALID_STATUS=new Set(Object.values(PREFLIGHT_STATUS));

const frozen=value=>Object.freeze(value);
const normalizeStatus=(value,fallback=PREFLIGHT_STATUS.UNKNOWN)=>VALID_STATUS.has(String(value))?String(value):fallback;
const text=(value,fallback='')=>String(value??fallback).trim();
const booleanOrNull=value=>value===true?true:value===false?false:null;
const finiteOrNull=value=>Number.isFinite(Number(value))?Number(value):null;
const isoNow=()=>new Date().toISOString();

export class PreflightUserGestureRequiredError extends Error{
  constructor(capability){
    super(`${capability} setup must be started by a deliberate rider gesture.`);
    this.name='PreflightUserGestureRequiredError';
    this.code='PREFLIGHT_USER_GESTURE_REQUIRED';
    this.capability=capability;
  }
}

const capability=(id,status,reasonCode,detail,action=null,extra={})=>frozen({
  id,
  status:normalizeStatus(status),
  reasonCode:text(reasonCode,'unknown'),
  detail:text(detail),
  action:action?text(action):null,
  ...extra
});

function gpsCapability(raw={}){
  const supported=raw.supported!==false;
  const permission=text(raw.permission,'unknown').toLowerCase();
  const active=raw.active===true;
  const fixReceived=raw.fixReceived===true;
  const errorCode=finiteOrNull(raw.errorCode);
  if(!supported)return capability('gps',PREFLIGHT_STATUS.BLOCKED,'gps-unavailable','GPS is unavailable in this browser.',null,{permission:'unknown',active:false,fixReceived:false});
  if(permission==='denied'||errorCode===1)return capability('gps',PREFLIGHT_STATUS.BLOCKED,'gps-permission-denied','GPS permission is blocked. Enable location access in site settings.',null,{permission:'denied',active,fixReceived});
  if(active&&fixReceived)return capability('gps',PREFLIGHT_STATUS.READY,'gps-fix-ready','GPS is active and has delivered a location fix.',null,{permission:permission==='unknown'?'granted-or-active':permission,active,fixReceived});
  if(active)return capability('gps',PREFLIGHT_STATUS.ACTION_REQUIRED,'gps-fix-pending','GPS is active and waiting for a location fix.',null,{permission,active,fixReceived});
  if(permission==='granted')return capability('gps',PREFLIGHT_STATUS.ACTION_REQUIRED,'gps-start-required','GPS permission is granted; start GPS before riding.','START_GPS',{permission,active,fixReceived});
  if(permission==='prompt')return capability('gps',PREFLIGHT_STATUS.USER_GESTURE,'gps-permission-gesture-required','Tap once to request GPS permission and start location tracking.','ENABLE_GPS',{permission,active,fixReceived});
  return capability('gps',PREFLIGHT_STATUS.USER_GESTURE,'gps-permission-unknown','This platform requires a rider gesture to verify GPS access.','ENABLE_GPS',{permission:'unknown',active,fixReceived});
}

function cameraCapability(raw={}){
  const permission=text(raw.permission,'unknown').toLowerCase();
  const cameraState=text(raw.capability,'uninitialized').toLowerCase();
  const reasonCode=text(raw.reasonCode,'camera-not-inspected');
  if(raw.automaticCaptureEligible===true&&cameraState==='ready')return capability('camera',PREFLIGHT_STATUS.READY,'camera-ready','Camera access is verified for automatic capture.',null,{permission,cameraCapability:cameraState,automaticCaptureEligible:true});
  if(permission==='denied'||reasonCode==='permission-denied')return capability('camera',PREFLIGHT_STATUS.BLOCKED,'camera-permission-denied','Camera permission is blocked. Required photos will need recovery after site access is restored.',null,{permission:'denied',cameraCapability:cameraState,automaticCaptureEligible:false});
  if(cameraState==='unavailable')return capability('camera',PREFLIGHT_STATUS.BLOCKED,reasonCode,'The camera is unavailable on this device.',null,{permission,cameraCapability:cameraState,automaticCaptureEligible:false});
  if(cameraState==='manual-only')return capability('camera',PREFLIGHT_STATUS.USER_GESTURE,reasonCode,'This platform requires rider-initiated camera capture at a checkpoint.',null,{permission,cameraCapability:cameraState,automaticCaptureEligible:false,manualOnly:true});
  if(cameraState==='setup-required'||permission==='prompt'||(permission==='unknown'&&cameraState!=='checking'))return capability('camera',PREFLIGHT_STATUS.USER_GESTURE,reasonCode,'Tap once before riding to verify camera permission and capture support.','ENABLE_CAMERA',{permission,cameraCapability:cameraState,automaticCaptureEligible:false});
  if(cameraState==='interrupted')return capability('camera',PREFLIGHT_STATUS.ACTION_REQUIRED,reasonCode,'Camera readiness was interrupted and must be checked again.','RETRY_CAMERA',{permission,cameraCapability:cameraState,automaticCaptureEligible:false});
  if(cameraState==='checking')return capability('camera',PREFLIGHT_STATUS.ACTION_REQUIRED,'camera-checking','Camera readiness is being checked.',null,{permission,cameraCapability:cameraState,automaticCaptureEligible:false});
  return capability('camera',PREFLIGHT_STATUS.UNKNOWN,reasonCode,'Camera readiness could not be determined.',null,{permission,cameraCapability:cameraState,automaticCaptureEligible:false});
}

function storageCapability(raw={}){
  const durableReady=booleanOrNull(raw.durableReady);
  const persistence=text(raw.persistenceStatus,'unsupported').toLowerCase();
  const requestSupported=raw.persistenceRequestSupported===true;
  const quotaBytes=finiteOrNull(raw.quotaBytes);
  const usageBytes=finiteOrNull(raw.usageBytes);
  const extra={durableReady,persistenceStatus:persistence,persistenceRequestSupported:requestSupported,quotaBytes,usageBytes};
  if(durableReady===false)return capability('storage',PREFLIGHT_STATUS.BLOCKED,text(raw.reasonCode,'durable-storage-unavailable'),'Local durable storage is unavailable. Rally evidence may not survive restart.',null,extra);
  if(durableReady===true&&persistence==='granted')return capability('storage',PREFLIGHT_STATUS.READY,'durable-storage-ready','Local storage is writable and protected from routine browser eviction.',null,extra);
  if(durableReady===true&&persistence==='not-granted'&&requestSupported)return capability('storage',PREFLIGHT_STATUS.READY,'local-storage-ready-persistence-advisory','Local storage is writable. Browser eviction protection is not granted yet.','PROTECT_STORAGE',{...extra,operationalReady:true,persistenceProtected:false});
  if(durableReady===true&&persistence==='error')return capability('storage',PREFLIGHT_STATUS.READY,text(raw.reasonCode,'local-storage-ready-persistence-unknown'),'Local storage is writable. Browser eviction protection could not be verified.',requestSupported?'PROTECT_STORAGE':null,{...extra,operationalReady:true,persistenceProtected:null});
  if(durableReady===true)return capability('storage',PREFLIGHT_STATUS.READY,text(raw.reasonCode,'local-storage-ready-persistence-unsupported'),'Local storage is writable. This browser does not expose eviction-protection status.',null,{...extra,operationalReady:true,persistenceProtected:null});
  return capability('storage',PREFLIGHT_STATUS.UNKNOWN,text(raw.reasonCode,'durable-storage-not-verified'),'Local durable storage readiness has not been verified.',null,extra);
}

function offlineCapability(raw={}){
  const online=raw.online!==false;
  const supported=raw.serviceWorkerSupported!==false&&raw.cacheStorageSupported!==false;
  const registrationActive=raw.registrationActive===true;
  const cacheVerified=raw.cacheVerified===true;
  const shellReady=raw.shellReady===true;
  const verificationAvailable=raw.verificationAvailable===true;
  const extra={online,registrationActive,cacheVerified,shellReady,verificationAvailable,cacheName:raw.cacheName||null};
  if(supported&&registrationActive&&cacheVerified&&shellReady)return capability('offline',PREFLIGHT_STATUS.READY,'offline-shell-ready','The current CannonMap application shell is cached for offline startup.',null,extra);
  if(!supported)return capability('offline',PREFLIGHT_STATUS.BLOCKED,'offline-shell-unsupported','This browser cannot provide a verified offline application shell.',null,extra);
  if(!verificationAvailable)return capability('offline',PREFLIGHT_STATUS.UNKNOWN,'offline-shell-not-verifiable','Offline application readiness cannot be verified on this build.',online?'PREPARE_OFFLINE':null,extra);
  if(!online)return capability('offline',PREFLIGHT_STATUS.BLOCKED,'offline-shell-missing-while-offline','The current application shell is not verified while the device is offline.',null,extra);
  return capability('offline',PREFLIGHT_STATUS.ACTION_REQUIRED,'offline-shell-preparation-required','Prepare the current CannonMap build for offline startup before riding.','PREPARE_OFFLINE',extra);
}

const inspectFailure=(id,error)=>capability(id,PREFLIGHT_STATUS.UNKNOWN,`${id}-inspection-failed`,`${id[0].toUpperCase()+id.slice(1)} readiness could not be inspected.`,null,{error:String(error?.message||error||'Unknown error')});

function overallStatus(capabilities){
  const statuses=Object.values(capabilities).map(item=>item.status);
  if(statuses.every(status=>status===PREFLIGHT_STATUS.READY))return PREFLIGHT_STATUS.READY;
  if(statuses.includes(PREFLIGHT_STATUS.BLOCKED))return PREFLIGHT_STATUS.BLOCKED;
  if(statuses.includes(PREFLIGHT_STATUS.USER_GESTURE))return PREFLIGHT_STATUS.USER_GESTURE;
  if(statuses.includes(PREFLIGHT_STATUS.ACTION_REQUIRED))return PREFLIGHT_STATUS.ACTION_REQUIRED;
  return PREFLIGHT_STATUS.UNKNOWN;
}

function scopeIdentity(scope={}){
  const projectId=text(scope.projectId,'unknown-project');
  const dayNumber=finiteOrNull(scope.dayNumber);
  const sessionId=text(scope.sessionId,'pending-new-session');
  const mode=scope.mode==='resume'?'resume':'start';
  return frozen({projectId,dayNumber,sessionId,mode,key:`${projectId}:${dayNumber??'none'}:${sessionId}`});
}

/**
 * Pure start/resume-day readiness policy. Browser APIs are confined to the
 * injected adapter and the existing camera-readiness service. Inspection is
 * non-interactive; sensitive actions require an explicit user-gesture token.
 */
export function createRallyDayPreflightService({adapter,cameraReadiness,clock={iso:isoNow}}={}){
  if(!adapter||typeof adapter.inspectGps!=='function'||typeof adapter.inspectStorage!=='function'||typeof adapter.inspectOffline!=='function')throw new TypeError('A rally-day preflight adapter is required.');
  const cameraState=()=>typeof cameraReadiness==='function'?cameraReadiness():cameraReadiness?.state?.()||{};
  let current=null,acknowledgedScopeKey=null,acknowledgedAt=null,inspectionPromise=null;

  async function safelyInspect(id,reader,mapper){
    try{return mapper(await reader());}catch(error){return inspectFailure(id,error);}
  }

  async function inspect(scope={},options={}){
    const normalizedScope=scopeIdentity(scope);
    if(inspectionPromise){
      const pending=await inspectionPromise;
      return pending.scope.key===normalizedScope.key?pending:inspect(normalizedScope);
    }
    inspectionPromise=(async()=>{
      const cameraInspection=options.skipCameraInspection===true||typeof cameraReadiness?.inspect!=='function'?Promise.resolve(cameraState()):cameraReadiness.inspect();
      const [gps,camera,storage,offline]=await Promise.all([
        safelyInspect('gps',()=>adapter.inspectGps(),gpsCapability),
        safelyInspect('camera',async()=>{await cameraInspection;return cameraState();},cameraCapability),
        safelyInspect('storage',()=>adapter.inspectStorage(),storageCapability),
        safelyInspect('offline',()=>adapter.inspectOffline(),offlineCapability)
      ]);
      const capabilities=frozen({gps,camera,storage,offline});
      const status=overallStatus(capabilities);
      const degradedAcknowledged=acknowledgedScopeKey===normalizedScope.key;
      current=frozen({
        scope:normalizedScope,
        status,
        ready:status===PREFLIGHT_STATUS.READY,
        degraded:status!==PREFLIGHT_STATUS.READY,
        degradedAcknowledged,
        degradedAcknowledgedAt:degradedAcknowledged?acknowledgedAt:null,
        proceedAllowed:status===PREFLIGHT_STATUS.READY||degradedAcknowledged,
        canContinueDegraded:status!==PREFLIGHT_STATUS.READY,
        inspectedAt:clock.iso(),
        capabilities
      });
      return current;
    })().finally(()=>{inspectionPromise=null;});
    return inspectionPromise;
  }

  const requireGesture=(id,userGesture)=>{if(userGesture!==true)throw new PreflightUserGestureRequiredError(id);};
  async function act(id,{userGesture=false,scope=current?.scope||{}}={}){
    if(!CAPABILITY_ORDER.includes(id))throw new TypeError(`Unknown preflight capability: ${id}`);
    requireGesture(id,userGesture);
    let pending;
    // Start the permission-producing call synchronously from the event handler;
    // do not place an awaited inspection between the tap and browser API.
    if(id==='gps')pending=adapter.requestGpsFromUserGesture?.();
    else if(id==='camera')pending=cameraReadiness?.setupFromUserGesture?.();
    else if(id==='storage')pending=adapter.requestStoragePersistenceFromUserGesture?.();
    else pending=adapter.prepareOfflineFromUserGesture?.();
    if(!pending)throw new Error(`No ${id} preflight action is available.`);
    try{await pending;}catch{/* The following inspection publishes the actionable state. */}
    // The deliberate camera action already performed the bounded operational
    // probe. Re-read its authoritative result without immediately reopening
    // the cameras after an interrupted/failed role.
    return inspect(scope,{skipCameraInspection:id===PREFLIGHT_CAPABILITY.CAMERA});
  }

  function continueDegraded({userGesture=false,scope=current?.scope||{}}={}){
    requireGesture('degraded-continuation',userGesture);
    const normalizedScope=scopeIdentity(scope);
    acknowledgedScopeKey=normalizedScope.key;
    acknowledgedAt=clock.iso();
    if(current&&current.scope.key===normalizedScope.key){
      current=frozen({...current,degradedAcknowledged:true,degradedAcknowledgedAt:acknowledgedAt,proceedAllowed:true});
    }
    return current;
  }

  return frozen({
    inspect,
    state:()=>current,
    act,
    continueDegraded,
    clearAcknowledgement(){acknowledgedScopeKey=null;acknowledgedAt=null;if(current)current=frozen({...current,degradedAcknowledged:false,degradedAcknowledgedAt:null,proceedAllowed:current.ready});return current;}
  });
}
