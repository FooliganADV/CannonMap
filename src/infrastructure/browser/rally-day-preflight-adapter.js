const permissionValue=value=>['granted','prompt','denied'].includes(String(value))?String(value):'unknown';
const finiteOrNull=value=>Number.isFinite(Number(value))?Number(value):null;
const errorText=error=>String(error?.message||error||'Unknown error');

async function permissionState(permissions,name){
  if(!permissions||typeof permissions.query!=='function')return {permission:'unknown',permissionQuerySupported:false,permissionReason:'permission-query-unsupported'};
  try{
    const status=await permissions.query({name});
    return {permission:permissionValue(status?.state),permissionQuerySupported:true,permissionReason:null};
  }catch(error){return {permission:'unknown',permissionQuerySupported:false,permissionReason:'permission-query-failed',permissionError:errorText(error)};}
}

async function safeCall(target,method){
  if(!target||typeof target[method]!=='function')return {supported:false,value:null,error:null};
  try{return {supported:true,value:await target[method].call(target),error:null};}
  catch(error){return {supported:true,value:null,error};}
}

const normalizeDurableProbe=result=>{
  if(result===true)return {durableReady:true,reasonCode:null};
  if(result===false)return {durableReady:false,reasonCode:'durable-storage-probe-failed'};
  if(result&&typeof result==='object')return {durableReady:result.ready===true?true:result.ready===false?false:null,reasonCode:result.reasonCode||null,durableError:result.error?errorText(result.error):null};
  return {durableReady:null,reasonCode:'durable-storage-not-probed'};
};

/**
 * Browser boundary for Rally day preflight. All inspect methods are read-only:
 * they never request permissions, start GPS, call storage.persist(), register a
 * service worker, or create a CacheStorage entry.
 */
export function createBrowserRallyDayPreflightAdapter({
  permissions=globalThis.navigator?.permissions??null,
  geolocation=globalThis.navigator?.geolocation??null,
  gpsStateProvider=()=>({active:false,fixReceived:false}),
  startGps=null,
  storageManager=globalThis.navigator?.storage??null,
  durableStorageProbe=async()=>({ready:null,reasonCode:'durable-storage-not-probed'}),
  serviceWorkerContainer=globalThis.navigator?.serviceWorker??null,
  cacheStorage=globalThis.caches??null,
  currentCacheName=null,
  requiredShellAssets=[],
  online=()=>globalThis.navigator?.onLine!==false,
  prepareOffline=null,
  serviceWorkerUrl='./sw.js'
}={}){
  let persistenceRequestAttempted=false;
  async function inspectGps(){
    const permission=await permissionState(permissions,'geolocation');
    let runtime={};
    try{runtime=gpsStateProvider?.()||{};}catch(error){runtime={stateError:errorText(error)};}
    return Object.freeze({
      supported:Boolean(geolocation&&typeof geolocation.watchPosition==='function'),
      ...permission,
      active:runtime.active===true,
      fixReceived:runtime.fixReceived===true,
      lastFixAt:runtime.lastFixAt||null,
      accuracyFeet:finiteOrNull(runtime.accuracyFeet),
      errorCode:finiteOrNull(runtime.errorCode),
      errorMessage:runtime.errorMessage?String(runtime.errorMessage):null,
      stateError:runtime.stateError||null
    });
  }

  async function inspectStorage(){
    let durable;
    try{durable=normalizeDurableProbe(await durableStorageProbe());}
    catch(error){durable={durableReady:false,reasonCode:'durable-storage-probe-failed',durableError:errorText(error)};}
    const [persisted,estimate]=await Promise.all([safeCall(storageManager,'persisted'),safeCall(storageManager,'estimate')]);
    let persistenceStatus='unsupported';
    if(persisted.error)persistenceStatus='error';
    else if(persisted.value===true)persistenceStatus='granted';
    else if(persisted.value===false)persistenceStatus='not-granted';
    return Object.freeze({
      ...durable,
      persistenceStatus,
      persistenceRequestSupported:Boolean(storageManager&&typeof storageManager.persist==='function'),
      persistenceRequestAttempted,
      persistenceError:persisted.error?errorText(persisted.error):null,
      quotaBytes:finiteOrNull(estimate.value?.quota),
      usageBytes:finiteOrNull(estimate.value?.usage),
      estimateSupported:estimate.supported,
      estimateError:estimate.error?errorText(estimate.error):null
    });
  }

  async function inspectOffline(){
    const isOnline=Boolean(online());
    const serviceWorkerSupported=Boolean(serviceWorkerContainer&&typeof serviceWorkerContainer.getRegistration==='function');
    const cacheStorageSupported=Boolean(cacheStorage&&typeof cacheStorage.keys==='function'&&typeof cacheStorage.open==='function');
    let registration=null,registrationError=null;
    if(serviceWorkerSupported){
      try{registration=await serviceWorkerContainer.getRegistration();}catch(error){registrationError=errorText(error);}
    }
    const workerState=registration?.active?.state||null;
    const registrationActive=Boolean(registration?.active&&(!workerState||workerState==='activated'));
    const cacheName=String(currentCacheName||'').trim()||null;
    const assets=[...new Set((requiredShellAssets||[]).map(String).filter(Boolean))];
    const verificationAvailable=Boolean(cacheStorageSupported&&cacheName&&assets.length);
    let cacheVerified=false,shellReady=false,missingAssets=[],cacheError=null;
    if(verificationAvailable){
      try{
        const keys=await cacheStorage.keys();
        cacheVerified=keys.includes(cacheName);
        if(cacheVerified){
          const cache=await cacheStorage.open(cacheName);
          const matches=await Promise.all(assets.map(asset=>cache.match(asset)));
          missingAssets=assets.filter((_,index)=>!matches[index]);
          shellReady=missingAssets.length===0;
        }else missingAssets=[...assets];
      }catch(error){cacheError=errorText(error);}
    }
    return Object.freeze({
      online:isOnline,
      serviceWorkerSupported,
      cacheStorageSupported,
      registrationActive,
      workerState,
      controlled:Boolean(serviceWorkerContainer?.controller),
      registrationError,
      cacheName,
      verificationAvailable,
      cacheVerified,
      shellReady,
      missingAssets:Object.freeze(missingAssets),
      cacheError
    });
  }

  return Object.freeze({
    inspectGps,
    inspectStorage,
    inspectOffline,
    requestGpsFromUserGesture(){
      if(typeof startGps!=='function')throw new Error('GPS startup is not wired to the preflight adapter.');
      return Promise.resolve(startGps());
    },
    requestStoragePersistenceFromUserGesture(){
      persistenceRequestAttempted=true;
      if(!storageManager||typeof storageManager.persist!=='function')throw new Error('Persistent storage requests are unavailable.');
      return Promise.resolve(storageManager.persist());
    },
    prepareOfflineFromUserGesture(){
      if(typeof prepareOffline==='function')return Promise.resolve(prepareOffline());
      if(!serviceWorkerContainer||typeof serviceWorkerContainer.register!=='function')throw new Error('Offline application setup is unavailable.');
      const registration=serviceWorkerContainer.register(serviceWorkerUrl);
      return Promise.resolve(registration).then(async value=>{await value?.update?.();return value;});
    }
  });
}
