import assert from 'node:assert/strict';
import test from 'node:test';
import {createBrowserRallyDayPreflightAdapter} from '../src/infrastructure/browser/rally-day-preflight-adapter.js';

test('read-only GPS inspection queries permission without starting location tracking',async()=>{
  let queries=0,starts=0;
  const adapter=createBrowserRallyDayPreflightAdapter({
    permissions:{async query(descriptor){queries++;assert.deepEqual(descriptor,{name:'geolocation'});return {state:'prompt'};}},
    geolocation:{watchPosition(){}},
    gpsStateProvider:()=>({active:false,fixReceived:false}),
    startGps:()=>{starts++;}
  });
  const result=await adapter.inspectGps();
  assert.equal(result.permission,'prompt');
  assert.equal(result.supported,true);
  assert.equal(queries,1);
  assert.equal(starts,0);
});

test('unsupported or rejected geolocation permission queries remain non-prompting and explicit',async()=>{
  const unsupported=createBrowserRallyDayPreflightAdapter({permissions:null,geolocation:{watchPosition(){}},gpsStateProvider:()=>({})});
  assert.deepEqual((({permission,permissionQuerySupported})=>({permission,permissionQuerySupported}))(await unsupported.inspectGps()),{permission:'unknown',permissionQuerySupported:false});
  const rejected=createBrowserRallyDayPreflightAdapter({permissions:{query:async()=>{throw new TypeError('unsupported descriptor');}},geolocation:{watchPosition(){}},gpsStateProvider:()=>({})});
  const state=await rejected.inspectGps();
  assert.equal(state.permission,'unknown');
  assert.equal(state.permissionQuerySupported,false);
  assert.match(state.permissionError,/unsupported descriptor/);
});

test('GPS action delegates directly to the existing GPS lifecycle',async()=>{
  let calls=0;
  const adapter=createBrowserRallyDayPreflightAdapter({startGps:()=>{calls++;return 'watch-started';}});
  assert.equal(await adapter.requestGpsFromUserGesture(),'watch-started');
  assert.equal(calls,1);
});

test('storage inspection never requests persistence and reports quota separately',async()=>{
  let persistCalls=0,probeCalls=0;
  const adapter=createBrowserRallyDayPreflightAdapter({
    durableStorageProbe:async()=>{probeCalls++;return {ready:true};},
    storageManager:{persisted:async()=>false,estimate:async()=>({usage:125,quota:1000}),persist:async()=>{persistCalls++;return true;}}
  });
  const inspected=await adapter.inspectStorage();
  assert.equal(inspected.durableReady,true);
  assert.equal(inspected.persistenceStatus,'not-granted');
  assert.equal(inspected.persistenceRequestSupported,true);
  assert.equal(inspected.usageBytes,125);
  assert.equal(inspected.quotaBytes,1000);
  assert.equal(probeCalls,1);
  assert.equal(persistCalls,0);
  assert.equal(await adapter.requestStoragePersistenceFromUserGesture(),true);
  assert.equal(persistCalls,1);
});

test('storage API failures are returned as readiness facts instead of trapping startup',async()=>{
  const adapter=createBrowserRallyDayPreflightAdapter({
    durableStorageProbe:async()=>{throw new Error('IndexedDB write failed');},
    storageManager:{persisted:async()=>{throw new Error('persistence failed');},estimate:async()=>{throw new Error('estimate failed');}}
  });
  const result=await adapter.inspectStorage();
  assert.equal(result.durableReady,false);
  assert.equal(result.persistenceStatus,'error');
  assert.match(result.durableError,/IndexedDB write failed/);
  assert.match(result.persistenceError,/persistence failed/);
  assert.match(result.estimateError,/estimate failed/);
});

function cacheHarness({cacheName='current-shell',missing=[]}={}){
  let opens=0;
  return {
    storage:{
      async keys(){return [cacheName];},
      async open(name){opens++;assert.equal(name,cacheName);return {match:async asset=>missing.includes(asset)?undefined:{ok:true,url:asset}};}
    },
    opens:()=>opens
  };
}

test('offline inspection verifies the exact current shell without installing or mutating caches',async()=>{
  const cache=cacheHarness();let registrations=0;
  const adapter=createBrowserRallyDayPreflightAdapter({
    serviceWorkerContainer:{controller:{},getRegistration:async()=>({active:{state:'activated'}}),register:async()=>{registrations++;}},
    cacheStorage:cache.storage,
    currentCacheName:'current-shell',
    requiredShellAssets:['./index.html','./app.js?v=current'],
    online:()=>true
  });
  const result=await adapter.inspectOffline();
  assert.equal(result.registrationActive,true);
  assert.equal(result.controlled,true);
  assert.equal(result.cacheVerified,true);
  assert.equal(result.shellReady,true);
  assert.deepEqual(result.missingAssets,[]);
  assert.equal(cache.opens(),1);
  assert.equal(registrations,0);
});

test('missing or stale shell assets cannot be reported offline-ready',async()=>{
  const cache=cacheHarness({missing:['./app.js?v=current']});
  const adapter=createBrowserRallyDayPreflightAdapter({
    serviceWorkerContainer:{controller:null,getRegistration:async()=>({active:{state:'activated'}})},
    cacheStorage:cache.storage,
    currentCacheName:'current-shell',requiredShellAssets:['./index.html','./app.js?v=current'],online:()=>false
  });
  const result=await adapter.inspectOffline();
  assert.equal(result.cacheVerified,true);
  assert.equal(result.shellReady,false);
  assert.deepEqual(result.missingAssets,['./app.js?v=current']);
  assert.equal(result.online,false);
});

test('an installing worker is not misreported as an active offline shell',async()=>{
  const cache=cacheHarness();
  const adapter=createBrowserRallyDayPreflightAdapter({
    serviceWorkerContainer:{controller:null,getRegistration:async()=>({active:{state:'activating'}})},
    cacheStorage:cache.storage,currentCacheName:'current-shell',requiredShellAssets:['./index.html']
  });
  const result=await adapter.inspectOffline();
  assert.equal(result.workerState,'activating');
  assert.equal(result.registrationActive,false);
  assert.equal(result.shellReady,true,'cache verification remains an independent fact');
});

test('offline preparation is an explicit action and otherwise registration is untouched',async()=>{
  let registrations=0,updates=0;
  const adapter=createBrowserRallyDayPreflightAdapter({
    serviceWorkerContainer:{
      getRegistration:async()=>null,
      async register(url){registrations++;assert.equal(url,'./sw.js');return {update:async()=>{updates++;}};}
    },
    cacheStorage:{keys:async()=>[],open:async()=>{throw new Error('must not open absent cache');}},
    currentCacheName:'current-shell',requiredShellAssets:['./index.html']
  });
  await adapter.inspectOffline();
  assert.equal(registrations,0);
  await adapter.prepareOfflineFromUserGesture();
  assert.equal(registrations,1);
  assert.equal(updates,1);
});
