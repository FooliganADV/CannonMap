import {expect,test} from '@playwright/test';

const androidProjectNames=new Set(['Android portrait','Android landscape']);
const pngBase64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const projectPayload={
  format:'CannonMap Project',
  project:{
    projectId:'camera-readiness-browser',
    name:'Camera Readiness Browser',
    features:[
      {id:'cp-1',name:'1.1 First Target',type:'checkpoint',day:1,sequence:1,status:'upcoming',photoRequirement:'required',visible:true,geometry:{kind:'point',coordinates:[{lat:30,lon:-90}]}},
      {id:'cp-2',name:'1.2 Second Target',type:'checkpoint',day:1,sequence:2,status:'upcoming',photoRequirement:'required',visible:true,geometry:{kind:'point',coordinates:[{lat:30.0001,lon:-90}]}},
      {id:'hotel-1',name:'1.99 Hotel',type:'hotel',day:1,sequence:99,status:'upcoming',photoRequirement:'required',visible:true,geometry:{kind:'point',coordinates:[{lat:30.1,lon:-90.1}]}}
    ],
    competitors:[]
  }
};

async function installCameraPlatform(page,{
  permission='prompt',
  permissionQuerySupported=true,
  imageCaptureSupported=true,
  grantOnAcquire=true,
  mutedFacings=[],
  hangNextAcquisition=false
}={}){
  await page.addInitScript(({initialPermission,querySupported,imageCaptureSupported,grantOnAcquire,initialMutedFacings,initialHangNextAcquisition,png})=>{
    let permissionState=initialPermission;
    const permissionListeners=new Set();
    const permissionStatus={
      get state(){return permissionState;},
      addEventListener(type,listener){if(type==='change')permissionListeners.add(listener);},
      removeEventListener(type,listener){if(type==='change')permissionListeners.delete(listener);},
      onchange:null,
      dispatchEvent(event){
        for(const listener of permissionListeners)listener.call(permissionStatus,event);
        if(typeof permissionStatus.onchange==='function')permissionStatus.onchange.call(permissionStatus,event);
        return true;
      }
    };
    const telemetry={queryCalls:0,getUserMediaCalls:[],trackStops:[],takePhotoCalls:[],imageCaptureInstances:0};
    const failures={next:null,facings:new Set(),mutedFacings:new Set(initialMutedFacings),hangNextAcquisition:initialHangNextAcquisition,hangNextPhoto:false},tracksByFacing=new Map();
    const setPermission=next=>{
      permissionState=next;
      permissionStatus.dispatchEvent(new Event('change'));
    };
    const requestedFacing=constraints=>{
      const value=constraints?.video?.facingMode;
      return String(value?.exact||value?.ideal||value||'environment');
    };
    const mediaDevices={
      async getUserMedia(constraints){
        const facingMode=requestedFacing(constraints);
        const userActivation=Boolean(navigator.userActivation?.isActive);
        telemetry.getUserMediaCalls.push({facingMode,constraints:structuredClone(constraints),permissionAtCall:permissionState,userActivation});
        if(permissionState==='denied')throw new DOMException('Camera permission denied.','NotAllowedError');
        if(permissionState==='prompt'&&!userActivation)throw new DOMException('Camera acquisition requires user activation.','NotAllowedError');
        if(permissionState==='prompt'&&grantOnAcquire)setPermission('granted');
        if(permissionState==='prompt'){
          setPermission('denied');
          throw new DOMException('Camera permission denied by the rider.','NotAllowedError');
        }
        if(failures.hangNextAcquisition){failures.hangNextAcquisition=false;return new Promise(()=>{});}
        if(failures.next){const next=failures.next;failures.next=null;throw new DOMException(next.message||'Camera reopen failed.',next.name||'NotReadableError');}
        if(failures.facings.has(facingMode))throw new DOMException(`Camera ${facingMode} unavailable.`,'NotReadableError');
        let readyState='live',muted=failures.mutedFacings.has(facingMode),active=true;
        const trackListeners=new Map(),streamListeners=new Map();
        const dispatch=(listeners,type)=>{for(const listener of listeners.get(type)||[])listener.call(track,new Event(type));};
        const track={
          kind:'video',enabled:true,
          get readyState(){return readyState;},
          get muted(){return muted;},
          stop(){if(readyState==='ended')return;readyState='ended';telemetry.trackStops.push({facingMode});dispatch(trackListeners,'ended');},
          addEventListener(type,listener){const listeners=trackListeners.get(type)||new Set();listeners.add(listener);trackListeners.set(type,listeners);},
          removeEventListener(type,listener){trackListeners.get(type)?.delete(listener);},
          getSettings(){return {facingMode,width:1920,height:1080,deviceId:`mock-${facingMode}`};}
        };
        const stream={
          get active(){return active;},getTracks:()=>[track],getVideoTracks:()=>[track],
          addEventListener(type,listener){const listeners=streamListeners.get(type)||new Set();listeners.add(listener);streamListeners.set(type,listeners);},
          removeEventListener(type,listener){streamListeners.get(type)?.delete(listener);}
        };
        tracksByFacing.set(facingMode,{track,stream,end:()=>{readyState='ended';dispatch(trackListeners,'ended');},mute:()=>{muted=true;dispatch(trackListeners,'mute');},inactivate:()=>{active=false;for(const listener of streamListeners.get('inactive')||[])listener.call(stream,new Event('inactive'));}});
        return stream;
      }
    };
    const permissions={
      async query(descriptor){
        telemetry.queryCalls++;
        if(descriptor?.name!=='camera')throw new TypeError(`Unexpected permission query: ${descriptor?.name}`);
        return permissionStatus;
      }
    };
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:mediaDevices});
    Object.defineProperty(navigator,'permissions',{configurable:true,value:querySupported?permissions:undefined});
    if(imageCaptureSupported){
      const imageBytes=Uint8Array.from(atob(png),character=>character.charCodeAt(0));
      class MockImageCapture{
        constructor(track){this.track=track;telemetry.imageCaptureInstances++;}
        async getPhotoCapabilities(){return {imageWidth:{max:1920},imageHeight:{max:1080}};}
        async takePhoto(settings){
          telemetry.takePhotoCalls.push({facingMode:this.track.getSettings().facingMode,settings:settings?structuredClone(settings):null});
          if(failures.hangNextPhoto){failures.hangNextPhoto=false;return new Promise(()=>{});}
          return new Blob([imageBytes],{type:'image/png'});
        }
      }
      Object.defineProperty(globalThis,'ImageCapture',{configurable:true,value:MockImageCapture});
    }else Object.defineProperty(globalThis,'ImageCapture',{configurable:true,value:undefined});

    globalThis.__cameraPlatform={
      snapshot:()=>({
        permission:permissionState,
        queryCalls:telemetry.queryCalls,
        getUserMediaCalls:structuredClone(telemetry.getUserMediaCalls),
        trackStops:structuredClone(telemetry.trackStops),
        takePhotoCalls:structuredClone(telemetry.takePhotoCalls),
        imageCaptureInstances:telemetry.imageCaptureInstances
      }),
      setPermission,
      failNext:(name='NotReadableError',message='Camera reopen failed.')=>{failures.next={name,message};},
      hangNextAcquisition:()=>{failures.hangNextAcquisition=true;},
      hangNextPhoto:()=>{failures.hangNextPhoto=true;},
      endFacing:facingMode=>tracksByFacing.get(facingMode)?.end(),
      muteFacing:facingMode=>tracksByFacing.get(facingMode)?.mute(),
      inactivateFacing:facingMode=>tracksByFacing.get(facingMode)?.inactivate(),
      failFacing:facingMode=>failures.facings.add(facingMode),
      clearFailures:()=>{failures.next=null;failures.facings.clear();}
    };
  },{initialPermission:permission,querySupported:permissionQuerySupported,imageCaptureSupported,grantOnAcquire,initialMutedFacings:mutedFacings,initialHangNextAcquisition:hangNextAcquisition,png:pngBase64});
}

async function openProject(page,{query='camera-readiness'}={}){
  await page.goto(`/?e2e=${query}`);
  await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true'&&typeof window.CannonMapTest?.cameraReadinessState==='function');
  await page.locator('#projectInput').setInputFiles({name:'camera-readiness.cmap',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(projectPayload))});
  await expect(page.locator('#status')).toContainText('Opened camera-readiness.cmap');
  await page.evaluate(()=>{
    const day=document.getElementById('dayFilter');
    day.value='1';
    day.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.waitForFunction(()=>document.getElementById('rallyDay')?.textContent==='Day 1');
  await page.waitForFunction(()=>window.CannonMapTest.dayPreflightState()?.scope?.dayNumber===1);
}

async function readiness(page){return page.evaluate(()=>window.CannonMapTest.cameraReadinessState());}
async function platform(page){return page.evaluate(()=>globalThis.__cameraPlatform.snapshot());}
const warningRow=(page,id)=>page.locator(`#rallyWarnings [data-warning-id="${id}"]`);
const genericWarningActions=row=>row.locator('[data-warning-action="dismiss"], [data-warning-action="10"], [data-warning-action="30"], [data-warning-action="checkpoint"]');

async function expectDayPreflight(page){
  await expect(page.locator('#rallyDayPreflight')).toBeVisible();
  await expect(page.locator('#rallyDayPreflightOverall')).not.toHaveText('CHECKING');
}

async function enableCameraFromPreflight(page){
  await expectDayPreflight(page);
  const action=page.locator('#rallyPreflightCameraAction');
  await expect(action).toBeVisible();
  await expect(action).toHaveText('ENABLE CAMERA');
  await expect(page.locator('#rallyEnableCameraButton')).toBeHidden();
  await action.click();
}

async function continueDayPreflight(page){
  const preflight=page.locator('#rallyDayPreflight');
  if(!await preflight.isVisible())return;
  await expect(page.locator('#rallyDayPreflightDegraded')).toBeEnabled();
  await page.locator('#rallyDayPreflightDegraded').click();
  await expect(preflight).toBeHidden();
  await expect.poll(async()=>page.evaluate(async()=>{
    const events=await window.CannonMapTest.missionControlJournalEvents();
    return events.some(event=>event.eventType==='day_preflight_completed');
  })).toBe(true);
}

async function triggerCheckpoint(page,{checkpointId,latitude,observedAt=1000,speedMph=22,priorTargetId=null,awaitIdle=true}={}){
  const detection={checkpointId,distanceFeet:4,accuracyFeet:7,radiusFeet:100};
  const gpsEvidence={latitude,longitude:-90,accuracyFeet:7};
  await page.evaluate(input=>window.CannonMapTest.observeCheckpointDetectionsForTest(input),{observedAt,speedMph,priorTargetId,gpsEvidence,detections:[detection]});
  await page.evaluate(input=>window.CannonMapTest.observeCheckpointDetectionsForTest(input),{observedAt:observedAt+3000,speedMph,priorTargetId,gpsEvidence,detections:[{...detection,distanceFeet:2}]});
  if(awaitIdle)await page.evaluate(()=>window.CannonMapTest.awaitFieldMediaIdle());
  else await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.fieldMediaState()?.mode)).toBe('manual-fallback');
}

test('fresh Android permission requires one setup gesture, then two checkpoints capture automatically',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='Android portrait');
  await installCameraPlatform(page,{permission:'prompt'});
  await page.addInitScript(()=>{
    const gps={watchCalls:0};
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
      watchPosition(){gps.watchCalls++;return 91;},
      clearWatch(){},getCurrentPosition(){}
    }});
    globalThis.__cameraReadinessGps=gps;
  });
  await openProject(page,{query:'camera-readiness-fresh'});

  await expect.poll(()=>readiness(page)).toMatchObject({permission:'prompt',capability:'setup-required',automaticCaptureEligible:false,permissionQuerySupported:true,getUserMediaSupported:true,imageCaptureSupported:true,setupAttemptedThisSession:false,priorSetupSucceeded:false});
  await expectDayPreflight(page);
  await expect(page.locator('#rallyPreflightCameraState')).toHaveText('USER GESTURE');
  await expect(page.locator('#rallyPreflightCameraAction')).toHaveText('ENABLE CAMERA');
  await expect(page.locator('#rallyCameraSetup')).toBeHidden();
  expect((await platform(page)).getUserMediaCalls).toHaveLength(0);
  expect(await page.evaluate(()=>globalThis.__cameraReadinessGps.watchCalls)).toBe(0);

  await enableCameraFromPreflight(page);
  await expect.poll(()=>readiness(page)).toMatchObject({permission:'granted',capability:'ready',automaticCaptureEligible:true,permissionQuerySupported:true,getUserMediaSupported:true,imageCaptureSupported:true,setupAttemptedThisSession:true,priorSetupSucceeded:true});
  const afterSetup=await platform(page);
  expect(afterSetup.getUserMediaCalls.map(call=>call.facingMode)).toEqual(['environment','user']);
  expect(afterSetup.getUserMediaCalls[0]).toMatchObject({permissionAtCall:'prompt',userActivation:true});
  expect(afterSetup.trackStops.map(item=>item.facingMode)).toEqual(['environment','user']);
  expect(afterSetup.takePhotoCalls).toEqual([
    {facingMode:'environment',settings:{imageWidth:1920,imageHeight:1080}},
    {facingMode:'user',settings:{imageWidth:1920,imageHeight:1080}}
  ]);
  await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.cameraSessionState())).toMatchObject({retainedStreamCount:0,getUserMediaCallCount:2,verifiedNativeStill:true,ready:true});
  await continueDayPreflight(page);
  await expect(page.locator('#rallyCameraSetup')).toBeHidden();
  await expect(warningRow(page,'camera')).toHaveCount(0);
  expect(await page.evaluate(()=>globalThis.__cameraReadinessGps.watchCalls)).toBe(1);

  await triggerCheckpoint(page,{checkpointId:'cp-2',latitude:30.0001,priorTargetId:'cp-1'});
  await expect(page.locator('#rallyCameraWorkflow')).toBeHidden();
  await expect(page.locator('#rallyNextName')).toContainText('First Target');
  let result=await page.evaluate(async()=>({media:await window.CannonMapTest.missionMediaRecords(),events:await window.CannonMapTest.missionControlJournalEvents()}));
  expect(result.media.map(item=>item.role).sort()).toEqual(['evidence','evidence','original','original']);
  expect(result.events.some(event=>event.eventType==='checkpoint_completed'&&event.references.checkpointId==='cp-2')).toBeTruthy();
  expect(result.events.some(event=>event.eventType==='paired_capture_completed')).toBeTruthy();

  const callsBeforeSecond=(await platform(page)).getUserMediaCalls.length;
  await triggerCheckpoint(page,{checkpointId:'cp-1',latitude:30,observedAt:8000,priorTargetId:'cp-1'});
  await expect(page.locator('#rallyCameraWorkflow')).toBeHidden();
  await expect(page.locator('#rallyCameraSetup')).toBeHidden();
  await expect(warningRow(page,'camera')).toHaveCount(0);
  result=await page.evaluate(async()=>({media:await window.CannonMapTest.missionMediaRecords(),events:await window.CannonMapTest.missionControlJournalEvents()}));
  expect(result.media).toHaveLength(8);
  expect(result.events.filter(event=>event.eventType==='checkpoint_completed').map(event=>event.references.checkpointId)).toEqual(expect.arrayContaining(['cp-1','cp-2']));
  expect((await platform(page)).getUserMediaCalls).toHaveLength(callsBeforeSecond+4);
  expect((await platform(page)).getUserMediaCalls).toHaveLength(10);
  await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.cameraSessionState())).toMatchObject({retainedStreamCount:0,getUserMediaCallCount:10,verifiedNativeStill:true,ready:true});
  expect(await readiness(page)).toMatchObject({permission:'granted',capability:'ready',automaticCaptureEligible:true,setupAttemptedThisSession:true,priorSetupSucceeded:true});
});

test('iOS setup verifies native stills and returns to zero retained cameras',async({page},testInfo)=>{
  test.skip(!testInfo.project.name.startsWith('iPhone 13'));
  await installCameraPlatform(page,{permission:'prompt'});
  await openProject(page,{query:'camera-readiness-ios-single-active'});
  await enableCameraFromPreflight(page);

  await expect.poll(()=>readiness(page)).toMatchObject({
    permission:'granted',capability:'ready',automaticCaptureEligible:true,
    verifiedNativeStill:true,currentSessionVerified:true,verifiedCameraRoles:['rear','front']
  });
  expect((await platform(page)).takePhotoCalls).toEqual([
    {facingMode:'environment',settings:{imageWidth:1920,imageHeight:1080}},
    {facingMode:'user',settings:{imageWidth:1920,imageHeight:1080}}
  ]);
  expect(await page.evaluate(async()=>window.CannonMapTest.missionMediaRecords())).toHaveLength(0);
  await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.cameraSessionState())).toMatchObject({
    retentionPolicy:'single-active',retainedStreamCount:0,roles:[],verifiedRoles:['rear','front'],verifiedNativeStill:true,ready:true
  });
  expect((await platform(page)).trackStops).toEqual([{facingMode:'environment'},{facingMode:'user'}]);
});

test('iOS live-but-muted camera track cannot produce false READY',async({page},testInfo)=>{
  test.skip(!testInfo.project.name.startsWith('iPhone 13'));
  await installCameraPlatform(page,{permission:'prompt',mutedFacings:['user']});
  await openProject(page,{query:'camera-readiness-ios-muted'});
  await enableCameraFromPreflight(page);

  await expect.poll(()=>readiness(page)).toMatchObject({
    permission:'granted',capability:'interrupted',automaticCaptureEligible:false,
    verifiedNativeStill:false,currentSessionVerified:false,reasonCode:'camera-track-muted'
  });
  const cameraState=await page.evaluate(()=>window.CannonMapTest.cameraSessionState());
  expect(cameraState.ready).toBe(false);expect(cameraState.retainedStreamCount).toBe(0);
  expect((await platform(page)).takePhotoCalls).toEqual([{facingMode:'environment',settings:{imageWidth:1920,imageHeight:1080}}]);
});

test('iOS permission change to granted re-verifies capture without reloading',async({page},testInfo)=>{
  test.skip(!testInfo.project.name.startsWith('iPhone 13'));
  await installCameraPlatform(page,{permission:'denied'});
  await openProject(page,{query:'camera-readiness-ios-permission-refresh'});
  await expect.poll(()=>readiness(page)).toMatchObject({permission:'denied',capability:'manual-only',automaticCaptureEligible:false,verifiedNativeStill:false});

  await page.evaluate(()=>globalThis.__cameraPlatform.setPermission('granted'));
  await expect.poll(()=>readiness(page),{timeout:10000}).toMatchObject({
    permission:'granted',capability:'ready',automaticCaptureEligible:true,
    verifiedNativeStill:true,currentSessionVerified:true,verifiedCameraRoles:['rear','front']
  });
  const snapshot=await platform(page);
  expect(snapshot.getUserMediaCalls.map(item=>item.facingMode)).toEqual(['environment','user']);
  expect(snapshot.takePhotoCalls.map(item=>item.facingMode)).toEqual(['environment','user']);
  await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.cameraSessionState())).toMatchObject({retentionPolicy:'single-active',retainedStreamCount:0,ready:true});
});

test('iOS hung camera acquisition fails within the bounded setup deadline',async({page},testInfo)=>{
  test.skip(!testInfo.project.name.startsWith('iPhone 13'));
  await installCameraPlatform(page,{permission:'prompt',hangNextAcquisition:true});
  await openProject(page,{query:'camera-readiness-ios-hung-acquisition'});
  const started=Date.now();
  await enableCameraFromPreflight(page);

  await expect.poll(()=>readiness(page),{timeout:10000}).toMatchObject({
    permission:'granted',capability:'interrupted',automaticCaptureEligible:false,
    verifiedNativeStill:false,currentSessionVerified:false,reasonCode:'camera-acquisition-timeout'
  });
  expect(Date.now()-started).toBeLessThan(8000);
  await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.cameraSessionState())).toMatchObject({pendingAcquisitions:0,retainedStreamCount:0,ready:false});
});

test('Android hung checkpoint takePhoto tears down and recovers on a fresh stream',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='Android landscape');
  await installCameraPlatform(page,{permission:'prompt'});
  await openProject(page,{query:'camera-readiness-ios-hung-photo'});
  await enableCameraFromPreflight(page);
  await expect.poll(()=>readiness(page)).toMatchObject({permission:'granted',capability:'ready',automaticCaptureEligible:true,verifiedNativeStill:true});
  const setupCalls=(await platform(page)).getUserMediaCalls.length;
  await continueDayPreflight(page);
  await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.cameraSessionState())).toMatchObject({retentionPolicy:'single-active',retainedStreamCount:0,ready:true});
  expect((await platform(page)).getUserMediaCalls).toHaveLength(setupCalls);
  await page.evaluate(()=>globalThis.__cameraPlatform.hangNextPhoto());

  const started=Date.now();
  await triggerCheckpoint(page,{checkpointId:'cp-1',latitude:30,speedMph:25,priorTargetId:'cp-1'});
  expect(Date.now()-started).toBeLessThan(18000);
  await expect.poll(()=>readiness(page)).toMatchObject({permission:'granted',capability:'ready',automaticCaptureEligible:true,verifiedNativeStill:true});
  const result=await page.evaluate(async()=>({
    media:await window.CannonMapTest.missionMediaRecords(),events:await window.CannonMapTest.missionControlJournalEvents(),
    evidence:window.CannonMapTest.checkpointEvidenceStateForTest('cp-1')
  }));
  expect(result.media).toHaveLength(4);
  expect(result.events.some(event=>event.eventType==='checkpoint_completed'&&event.references.checkpointId==='cp-1')).toBe(true);
  expect(result.events.some(event=>event.eventType==='native-still-retry-scheduled')).toBeTruthy();
  expect(result.evidence).toMatchObject({arrival:{state:'confirmed',trustworthy:true},completion:{state:'completed'}});
  const snapshot=await platform(page);
  expect(snapshot.getUserMediaCalls.slice(setupCalls).map(item=>item.facingMode)).toEqual(['environment','environment','user','user']);
  await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.cameraSessionState())).toMatchObject({retainedStreamCount:0,takePhotoInFlight:false,ready:true});
});

test('camera setup does not block GPS when no rally day is active',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='Android portrait');
  await installCameraPlatform(page,{permission:'prompt'});
  await page.addInitScript(()=>{
    const gps={watchCalls:0};
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
      watchPosition(){gps.watchCalls++;return 92;},
      clearWatch(){},getCurrentPosition(){}
    }});
    globalThis.__cameraReadinessPlannerGps=gps;
  });
  await openProject(page,{query:'camera-readiness-planner-gps'});
  await page.evaluate(()=>{
    const day=document.getElementById('dayFilter');
    day.value='all';
    day.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await expect.poll(()=>readiness(page)).toMatchObject({permission:'prompt',capability:'setup-required',automaticCaptureEligible:false});
  await page.evaluate(()=>document.getElementById('gpsButton').click());
  await expect.poll(()=>page.evaluate(()=>globalThis.__cameraReadinessPlannerGps.watchCalls)).toBe(1);
  await expect(page.locator('#rallyCameraSetup')).toBeHidden();
  expect((await platform(page)).getUserMediaCalls).toHaveLength(0);
});

test('an active GPS session exposes camera setup as a dedicated Mission action',async({page},testInfo)=>{
  test.skip(!androidProjectNames.has(testInfo.project.name));
  await installCameraPlatform(page,{permission:'prompt'});
  await page.addInitScript(()=>{
    const gps={watchCalls:0};
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
      watchPosition(){gps.watchCalls++;return 93;},
      clearWatch(){},getCurrentPosition(){}
    }});
    globalThis.__cameraReadinessMissionGps=gps;
  });
  const dialogs=[];page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.dismiss();});
  await openProject(page,{query:'camera-readiness-active-gps-warning'});
  await page.evaluate(()=>{
    const day=document.getElementById('dayFilter');
    day.value='all';day.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await expect(page.locator('#rallyDayPreflight')).toBeHidden();
  await page.evaluate(()=>document.getElementById('gpsButton').click());
  await expect.poll(()=>page.evaluate(()=>globalThis.__cameraReadinessMissionGps.watchCalls)).toBe(1);
  await page.evaluate(()=>{
    const day=document.getElementById('dayFilter');
    day.value='1';day.dispatchEvent(new Event('change',{bubbles:true}));
  });

  await expect.poll(()=>readiness(page)).toMatchObject({permission:'prompt',capability:'setup-required',automaticCaptureEligible:false});
  await expectDayPreflight(page);
  await expect(page.locator('#rallyPreflightCameraAction')).toHaveText('ENABLE CAMERA');
  await expect(page.locator('#rallyCameraSetup')).toBeHidden();
  await continueDayPreflight(page);
  const cameraWarning=warningRow(page,'camera');
  await expect(cameraWarning).toBeVisible();
  await expect(cameraWarning.locator('[data-camera-action="enable"]')).toHaveCount(1);
  await expect(cameraWarning.locator('[data-camera-action="manual"]')).toHaveCount(1);
  await expect(genericWarningActions(cameraWarning)).toHaveCount(0);
  const viewport=page.viewportSize(),enableBounds=await cameraWarning.locator('[data-camera-action="enable"]').boundingBox();
  expect(enableBounds).not.toBeNull();expect(enableBounds.width).toBeGreaterThanOrEqual(48);expect(enableBounds.height).toBeGreaterThanOrEqual(48);
  expect(enableBounds.x).toBeGreaterThanOrEqual(0);expect(enableBounds.y).toBeGreaterThanOrEqual(0);
  expect(enableBounds.x+enableBounds.width).toBeLessThanOrEqual(viewport.width);expect(enableBounds.y+enableBounds.height).toBeLessThanOrEqual(viewport.height);
  expect((await platform(page)).getUserMediaCalls).toHaveLength(0);

  await cameraWarning.locator('[data-camera-action="enable"]').click();
  await expect.poll(()=>readiness(page)).toMatchObject({permission:'granted',capability:'ready',automaticCaptureEligible:true,setupAttemptedThisSession:true,priorSetupSucceeded:true});
  const calls=(await platform(page)).getUserMediaCalls;
  expect(calls.map(call=>call.facingMode)).toEqual(['environment','user']);
  expect(calls[0]).toMatchObject({permissionAtCall:'prompt',userActivation:true});
  await expect(cameraWarning).toHaveCount(0);
  await expect(page.locator('#rallyCameraSetup')).toBeHidden();
  await expect(page.locator('#rallyCameraWorkflow')).toBeHidden();
  expect(dialogs).toEqual([]);
});

test('previously granted Android permission verifies both cameras without showing setup',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='Android landscape');
  await installCameraPlatform(page,{permission:'granted'});
  await openProject(page,{query:'camera-readiness-granted'});
  await expect.poll(()=>readiness(page)).toMatchObject({permission:'granted',capability:'ready',automaticCaptureEligible:true,permissionQuerySupported:true,getUserMediaSupported:true,imageCaptureSupported:true,setupAttemptedThisSession:false,priorSetupSucceeded:true});
  const verifiedBeforeStart=await platform(page);
  expect(verifiedBeforeStart.getUserMediaCalls.slice(-2).map(call=>call.facingMode)).toEqual(['environment','user']);
  await continueDayPreflight(page);
  await expect(page.locator('#rallyCameraSetup')).toBeHidden();
  await expect(warningRow(page,'camera')).toHaveCount(0);
  const state=await platform(page);
  expect(state.getUserMediaCalls).toEqual(verifiedBeforeStart.getUserMediaCalls);
  expect(state.trackStops.map(item=>item.facingMode)).toEqual(['environment','user']);
  await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.cameraSessionState())).toMatchObject({retentionPolicy:'single-active',retainedStreamCount:0,ready:true});
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('cannonmap.settings.v6')||'{}').cameraSetupSucceededAt)).toBeUndefined();
  expect(await page.evaluate(()=>Boolean(localStorage.getItem('cannonmap.camera-setup-succeeded.v1')))).toBe(true);
  await page.reload();
  await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  await expect(page.locator('#projectName')).toHaveValue('Camera Readiness Browser');
});

test('denied camera permission is explicit and refresh does not loop permission requests',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='Android portrait');
  await installCameraPlatform(page,{permission:'denied'});
  await openProject(page,{query:'camera-readiness-denied'});
  await expect.poll(()=>readiness(page)).toMatchObject({permission:'denied',capability:'manual-only',automaticCaptureEligible:false,reasonCode:'permission-denied',permissionQuerySupported:true,getUserMediaSupported:true,imageCaptureSupported:true});
  await expectDayPreflight(page);
  await expect(page.locator('#rallyPreflightCameraState')).toHaveText('BLOCKED');
  await expect(page.locator('#rallyPreflightCameraAction')).toBeHidden();
  await expect(page.locator('#rallyCameraSetup')).toBeHidden();
  await continueDayPreflight(page);
  await expect(genericWarningActions(warningRow(page,'camera'))).toHaveCount(0);
  await expect(warningRow(page,'camera').locator('[data-camera-action="enable"]')).toHaveCount(0);
  await expect(warningRow(page,'camera').locator('[data-camera-action="manual"]')).toHaveCount(1);
  const before=await platform(page);
  expect(before.getUserMediaCalls).toHaveLength(0);
  await page.evaluate(async()=>{await window.CannonMapTest.refreshCameraReadinessForTest();await window.CannonMapTest.refreshCameraReadinessForTest();});
  const after=await platform(page);
  expect(after.getUserMediaCalls).toHaveLength(0);
  expect(after.queryCalls).toBeGreaterThan(before.queryCalls);
  const debug=await page.evaluate(()=>window.CannonMapTest.rallyDebugEntries());
  expect(debug.some(entry=>entry.type==='camera_permission_state'&&entry.permission==='denied')).toBeTruthy();
  expect(debug.filter(entry=>entry.type==='camera_setup_requested')).toHaveLength(0);
});

test('denying the one-time setup prompt becomes intentional manual mode without another permission loop',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='Android portrait');
  await installCameraPlatform(page,{permission:'prompt',grantOnAcquire:false});
  await openProject(page,{query:'camera-readiness-prompt-denied'});
  await expect.poll(()=>readiness(page)).toMatchObject({permission:'prompt',capability:'setup-required',automaticCaptureEligible:false});
  expect((await platform(page)).getUserMediaCalls).toHaveLength(0);

  await enableCameraFromPreflight(page);
  await expect.poll(()=>readiness(page)).toMatchObject({permission:'denied',capability:'manual-only',automaticCaptureEligible:false,reasonCode:'permission-denied',setupAttemptedThisSession:true,priorSetupSucceeded:false});
  await expect(page.locator('#rallyPreflightCameraState')).toHaveText('BLOCKED');
  await expect(page.locator('#rallyPreflightCameraAction')).toBeHidden();
  await expect(page.locator('#rallyCameraSetup')).toBeHidden();
  await continueDayPreflight(page);
  await expect(genericWarningActions(warningRow(page,'camera'))).toHaveCount(0);
  await expect(warningRow(page,'camera').locator('[data-camera-action="enable"]')).toHaveCount(0);
  await expect(warningRow(page,'camera').locator('[data-camera-action="manual"]')).toHaveCount(1);
  const afterDenial=await platform(page);
  expect(afterDenial.getUserMediaCalls).toHaveLength(1);
  expect(afterDenial.getUserMediaCalls[0]).toMatchObject({permissionAtCall:'prompt',userActivation:true});

  await page.evaluate(async()=>{await window.CannonMapTest.refreshCameraReadinessForTest();await window.CannonMapTest.refreshCameraReadinessForTest();});
  const afterRefresh=await platform(page);
  expect(afterRefresh.getUserMediaCalls).toHaveLength(1);
  expect(afterRefresh.queryCalls).toBeGreaterThan(afterDenial.queryCalls);
  const debug=await page.evaluate(()=>window.CannonMapTest.rallyDebugEntries());
  expect(debug.some(entry=>entry.type==='camera_setup_requested')).toBeTruthy();
  expect(debug.some(entry=>['camera_setup_denied','camera_readiness_probe_failed','camera_permission_change_revoked_readiness'].includes(entry.type)&&entry.permission==='denied')).toBeTruthy();
});

test('unsupported Permissions query still offers one controlled setup and becomes ready',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='Android portrait');
  await installCameraPlatform(page,{permission:'prompt',permissionQuerySupported:false});
  await openProject(page,{query:'camera-readiness-query-unsupported'});
  await expect.poll(()=>readiness(page)).toMatchObject({permission:'unknown',capability:'setup-required',automaticCaptureEligible:false,permissionQuerySupported:false,getUserMediaSupported:true,imageCaptureSupported:true});
  expect((await platform(page)).getUserMediaCalls).toHaveLength(0);
  await enableCameraFromPreflight(page);
  await expect.poll(()=>readiness(page)).toMatchObject({permission:'granted',capability:'ready',automaticCaptureEligible:true,permissionQuerySupported:false,getUserMediaSupported:true,imageCaptureSupported:true,setupAttemptedThisSession:true,priorSetupSucceeded:true});
  expect((await platform(page)).getUserMediaCalls.map(call=>call.facingMode)).toEqual(['environment','user']);
  await continueDayPreflight(page);
});

test('permission revocation removes automatic eligibility without another acquisition attempt',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='Android portrait');
  await installCameraPlatform(page,{permission:'prompt'});
  await openProject(page,{query:'camera-readiness-revoked'});
  await enableCameraFromPreflight(page);
  await expect.poll(()=>readiness(page)).toMatchObject({permission:'granted',capability:'ready',automaticCaptureEligible:true});
  await continueDayPreflight(page);
  const before=(await platform(page)).getUserMediaCalls.length;
  await page.evaluate(()=>globalThis.__cameraPlatform.setPermission('denied'));
  await expect.poll(()=>readiness(page)).toMatchObject({permission:'denied',capability:'manual-only',automaticCaptureEligible:false,reasonCode:'permission-denied'});
  await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.cameraSessionState())).toMatchObject({retainedStreamCount:0});
  await page.evaluate(()=>window.CannonMapTest.refreshCameraReadinessForTest());
  expect((await platform(page)).getUserMediaCalls).toHaveLength(before);
  const debug=await page.evaluate(()=>window.CannonMapTest.rallyDebugEntries());
  expect(debug.some(entry=>entry.type==='camera_permission_state'&&entry.permission==='denied')).toBeTruthy();
});

test('a granted stream reopen failure performs one fresh-stream recovery and preserves later checkpoints',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='Android portrait');
  await installCameraPlatform(page,{permission:'prompt'});
  await openProject(page,{query:'camera-readiness-reopen-failure'});
  await enableCameraFromPreflight(page);
  await expect.poll(()=>readiness(page)).toMatchObject({permission:'granted',capability:'ready',automaticCaptureEligible:true});
  await continueDayPreflight(page);
  await page.evaluate(()=>globalThis.__cameraPlatform.endFacing('environment'));
  await page.evaluate(()=>globalThis.__cameraPlatform.failNext('NotReadableError','Camera is busy after setup.'));
  await triggerCheckpoint(page,{checkpointId:'cp-1',latitude:30,speedMph:25,priorTargetId:'cp-1'});
  await expect(page.locator('#rallyCameraWorkflow')).toBeHidden();
  await expect.poll(()=>readiness(page)).toMatchObject({permission:'granted',capability:'ready',automaticCaptureEligible:true});
  let result=await page.evaluate(async()=>({media:await window.CannonMapTest.missionMediaRecords(),events:await window.CannonMapTest.missionControlJournalEvents(),debug:window.CannonMapTest.rallyDebugEntries(),evidence:window.CannonMapTest.checkpointEvidenceStateForTest('cp-1')}));
  expect(result.media).toHaveLength(4);
  expect(result.events.some(event=>event.eventType==='native-still-retry-scheduled')).toBeTruthy();
  expect(result.events.some(event=>event.eventType==='checkpoint_completed'&&event.references.checkpointId==='cp-1')).toBe(true);
  expect(result.evidence).toMatchObject({arrival:{state:'confirmed',trustworthy:true},completion:{state:'completed'}});
  expect(result.debug.some(entry=>entry.type==='camera_stream_creation_failed')).toBeTruthy();
  const callsBeforeRecovery=(await platform(page)).getUserMediaCalls.length;
  await triggerCheckpoint(page,{checkpointId:'cp-2',latitude:30.0001,observedAt:9000,speedMph:22,priorTargetId:'cp-1'});
  await expect.poll(()=>readiness(page)).toMatchObject({permission:'granted',capability:'ready',automaticCaptureEligible:true});
  result=await page.evaluate(async()=>({media:await window.CannonMapTest.missionMediaRecords(),events:await window.CannonMapTest.missionControlJournalEvents()}));
  expect(result.media).toHaveLength(8);
  expect(result.events.some(event=>event.eventType==='checkpoint_completed'&&event.references.checkpointId==='cp-2')).toBeTruthy();
  expect((await platform(page)).getUserMediaCalls).toHaveLength(callsBeforeRecovery+4);
});

test('Android long-sleep resume invalidates historical READY and revalidates both cameras while offline',async({page,context},testInfo)=>{
  test.skip(testInfo.project.name!=='Android landscape');
  await installCameraPlatform(page,{permission:'granted'});
  await openProject(page,{query:'camera-readiness-long-sleep-offline'});
  await expect.poll(()=>readiness(page)).toMatchObject({permission:'granted',capability:'ready',automaticCaptureEligible:true});
  await continueDayPreflight(page);
  const before=await platform(page);

  await context.setOffline(true);
  await page.evaluate(()=>window.CannonMapTest.backgroundCameraLifecycleForTest('test-one-hour-sleep'));
  await expect.poll(()=>readiness(page)).toMatchObject({permission:'granted',capability:'interrupted',automaticCaptureEligible:false,currentSessionVerified:false,lastVerifiedAt:null});
  await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.cameraSessionState())).toMatchObject({retainedStreamCount:0,ready:false});

  await page.evaluate(()=>window.CannonMapTest.resumeForegroundCameraLifecycleForTest('test-long-sleep-visible'));
  await expect.poll(()=>readiness(page)).toMatchObject({permission:'granted',capability:'ready',automaticCaptureEligible:true,currentSessionVerified:true,verifiedCameraRoles:['rear','front']});
  const after=await platform(page);
  expect(after.getUserMediaCalls.slice(before.getUserMediaCalls.length).map(item=>item.facingMode)).toEqual(['environment','user']);
  expect(after.takePhotoCalls.slice(before.takePhotoCalls.length).map(item=>item.facingMode)).toEqual(['environment','user']);
  await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.cameraSessionState())).toMatchObject({retainedStreamCount:0,ready:true});
  await expect(page.locator('#rallyDayPreflight')).toBeHidden();
  expect(await page.evaluate(()=>navigator.onLine)).toBe(false);
  await context.setOffline(false);
});

test('checkpoint immediately after wake preempts a hung readiness probe and completes exactly once',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='Android landscape');
  await installCameraPlatform(page,{permission:'granted'});
  await openProject(page,{query:'camera-readiness-wake-checkpoint-priority'});
  await expect.poll(()=>readiness(page)).toMatchObject({permission:'granted',capability:'ready',automaticCaptureEligible:true});
  await continueDayPreflight(page);
  const before=await platform(page);

  await page.evaluate(()=>{
    window.CannonMapTest.backgroundCameraLifecycleForTest('test-sleep');
    globalThis.__cameraPlatform.hangNextAcquisition();
    globalThis.__foregroundCameraResume=window.CannonMapTest.resumeForegroundCameraLifecycleForTest('test-wake');
  });
  await expect.poll(async()=>(await platform(page)).getUserMediaCalls.length).toBe(before.getUserMediaCalls.length+1);
  await triggerCheckpoint(page,{checkpointId:'cp-1',latitude:30,speedMph:63,priorTargetId:'cp-1'});
  await page.evaluate(()=>globalThis.__foregroundCameraResume?.catch?.(()=>{}));

  const result=await page.evaluate(async()=>({
    media:await window.CannonMapTest.missionMediaRecords(),events:await window.CannonMapTest.missionControlJournalEvents(),
    debug:window.CannonMapTest.rallyDebugEntries(),evidence:window.CannonMapTest.checkpointEvidenceStateForTest('cp-1')
  }));
  expect(result.evidence).toMatchObject({arrival:{state:'confirmed',trustworthy:true},photo:{state:'complete'},completion:{state:'completed'}});
  expect(result.media).toHaveLength(4);
  expect(result.events.filter(event=>event.eventType==='checkpoint_completed'&&event.references.checkpointId==='cp-1')).toHaveLength(1);
  expect(result.events.filter(event=>event.eventType==='prior_target_restored')).toHaveLength(0);
  expect(result.debug.some(entry=>entry.type==='checkpoint_detected'&&entry.checkpointId==='cp-1'&&entry.arrivalPersistedBeforeMedia===true)).toBe(true);
  expect(result.debug.some(entry=>entry.type==='camera_checkpoint_recovery_authorized')).toBe(true);
  expect(result.debug.filter(entry=>entry.type==='camera_readiness_probe_started')).toHaveLength(2);
  await expect(page.locator('#rallyNextName')).toContainText('Second Target');
  await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.cameraSessionState())).toMatchObject({retainedStreamCount:0,takePhotoInFlight:false,ready:true});
  await expect.poll(()=>readiness(page)).toMatchObject({permission:'granted',capability:'ready',automaticCaptureEligible:true});
  const after=await platform(page);
  expect(after.getUserMediaCalls.slice(before.getUserMediaCalls.length).map(item=>item.facingMode)).toEqual(['environment','environment','environment','user','user']);
});

test('interrupted CP1 evidence does not make successful CP2 out-of-order or move navigation backward',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='Android landscape');
  await installCameraPlatform(page,{permission:'granted'});
  await openProject(page,{query:'camera-readiness-pending-sequence'});
  await expect.poll(()=>readiness(page)).toMatchObject({permission:'granted',capability:'ready',automaticCaptureEligible:true});
  await continueDayPreflight(page);
  await page.evaluate(async()=>{
    window.CannonMapTest.backgroundCameraLifecycleForTest('test-sleep-before-cp1');
    await window.CannonMapTest.resumeForegroundCameraLifecycleForTest('test-wake-before-cp1');
    globalThis.__cameraPlatform.failFacing('environment');
  });

  await triggerCheckpoint(page,{checkpointId:'cp-1',latitude:30,speedMph:63,priorTargetId:'cp-1'});
  const afterFirst=await page.evaluate(()=>({evidence:window.CannonMapTest.checkpointEvidenceStateForTest('cp-1'),session:window.CannonMapTest.rallySessionStateForTest()}));
  expect(afterFirst.evidence.arrival).toMatchObject({state:'confirmed',trustworthy:true});
  expect(afterFirst.evidence.photo.state).not.toBe('complete');
  expect(afterFirst.evidence.completion.state).not.toBe('completed');
  expect(afterFirst.session.pendingEvidence.entries.some(item=>item.checkpointId==='cp-1')).toBe(true);
  await expect(page.locator('#rallyNextName')).toContainText('Second Target');

  await page.evaluate(()=>globalThis.__cameraPlatform.clearFailures());
  await triggerCheckpoint(page,{checkpointId:'cp-2',latitude:30.0001,observedAt:9000,speedMph:67,priorTargetId:'cp-2'});
  const result=await page.evaluate(async()=>({
    first:window.CannonMapTest.checkpointEvidenceStateForTest('cp-1'),second:window.CannonMapTest.checkpointEvidenceStateForTest('cp-2'),
    events:await window.CannonMapTest.missionControlJournalEvents(),debug:window.CannonMapTest.rallyDebugEntries()
  }));
  expect(result.first.arrival).toMatchObject({state:'confirmed',trustworthy:true});
  expect(result.first.photo.state).not.toBe('complete');
  expect(result.second).toMatchObject({arrival:{state:'confirmed',trustworthy:true},photo:{state:'complete'},completion:{state:'completed'}});
  expect(result.events.filter(event=>event.eventType==='checkpoint_completed'&&event.references.checkpointId==='cp-2')).toHaveLength(1);
  expect(result.events.filter(event=>event.eventType==='prior_target_restored')).toHaveLength(0);
  expect(result.debug.some(entry=>entry.type==='checkpoint_detected'&&entry.checkpointId==='cp-2'&&entry.outOfOrder===false)).toBe(true);
  await expect(page.locator('#rallyScore')).toHaveText('10');
  await expect(page.locator('#rallyNextName')).toContainText('Hotel');

  await page.evaluate(()=>window.CannonMapTest.pendingEvidenceActionForTest('cp-1','resume'));
  await expect(page.locator('#rallyCameraWorkflow')).toBeVisible();
  await page.locator('#rallyCameraInput').setInputFiles({name:'CP1_RECOVERY.png',mimeType:'image/png',buffer:Buffer.from(pngBase64,'base64')});
  await page.evaluate(()=>window.CannonMapTest.awaitFieldMediaIdle());
  await expect(page.locator('#rallyCameraWorkflow')).toBeHidden();
  const recovered=await page.evaluate(async()=>( {
    first:window.CannonMapTest.checkpointEvidenceStateForTest('cp-1'),second:window.CannonMapTest.checkpointEvidenceStateForTest('cp-2'),
    media:await window.CannonMapTest.missionMediaRecords(),events:await window.CannonMapTest.missionControlJournalEvents()
  }));
  expect(recovered.first).toMatchObject({arrival:{state:'confirmed',trustworthy:true},photo:{state:'complete'},completion:{state:'completed'}});
  expect(recovered.second).toMatchObject({arrival:{state:'confirmed',trustworthy:true},photo:{state:'complete'},completion:{state:'completed'}});
  expect(recovered.media).toHaveLength(8);
  expect(recovered.events.filter(event=>event.eventType==='checkpoint_completed'&&event.references.checkpointId==='cp-1')).toHaveLength(1);
  expect(recovered.events.filter(event=>event.eventType==='checkpoint_completed'&&event.references.checkpointId==='cp-2')).toHaveLength(1);
  expect(recovered.events.filter(event=>event.eventType==='prior_target_restored')).toHaveLength(0);
  await expect(page.locator('#rallyScore')).toHaveText('20');
  await expect(page.locator('#rallyNextName')).toContainText('Hotel');
});

test('unsupported ImageCapture is declared manual-only instead of falsely attempting automatic capture',async({page},testInfo)=>{
  test.skip(!testInfo.project.name.startsWith('iPhone'));
  await installCameraPlatform(page,{permission:'granted',imageCaptureSupported:false});
  await openProject(page,{query:'camera-readiness-imagecapture-unsupported'});
  await expect.poll(()=>readiness(page)).toMatchObject({capability:'manual-only',automaticCaptureEligible:false,imageCaptureSupported:false,reasonCode:'image-capture-unsupported'});
  expect((await platform(page)).getUserMediaCalls).toHaveLength(0);
  await expectDayPreflight(page);
  await expect(page.locator('#rallyPreflightCameraAction')).toBeHidden();
  await continueDayPreflight(page);
  await expect(genericWarningActions(warningRow(page,'camera'))).toHaveCount(0);
  await expect(warningRow(page,'camera').locator('[data-camera-action="enable"]')).toHaveCount(0);
  await expect(warningRow(page,'camera').locator('[data-camera-action="manual"]')).toHaveCount(1);
  await triggerCheckpoint(page,{checkpointId:'cp-1',latitude:30,speedMph:5,priorTargetId:'cp-1',awaitIdle:false});
  await expect(page.locator('#rallyCameraWorkflow')).toBeVisible();
  await expect(page.locator('#rallyCameraTapSurface')).toBeVisible();
  await expect(page.locator('#rallyCameraPhotoCount')).toContainText(/tap|manual|photo|required/i);
  const debug=await page.evaluate(()=>window.CannonMapTest.rallyDebugEntries());
  expect(debug.some(entry=>entry.type==='camera_fallback_selected'&&entry.reason==='image-capture-unsupported')).toBeTruthy();
});

test('camera preflight setup stays inside Android portrait and landscape safe areas',async({page},testInfo)=>{
  test.skip(!androidProjectNames.has(testInfo.project.name));
  await installCameraPlatform(page,{permission:'prompt'});
  await openProject(page,{query:'camera-readiness-layout'});
  await expectDayPreflight(page);
  await expect(page.locator('#rallyCameraSetup')).toBeHidden();
  const viewport=page.viewportSize();
  const setup=await page.locator('#rallyDayPreflight').boundingBox();
  const enable=await page.locator('#rallyPreflightCameraAction').boundingBox();
  const manual=await page.locator('#rallyDayPreflightDegraded').boundingBox();
  expect(setup).not.toBeNull();expect(enable).not.toBeNull();expect(manual).not.toBeNull();
  expect(setup.x).toBeGreaterThanOrEqual(0);expect(setup.y).toBeGreaterThanOrEqual(0);
  expect(setup.x+setup.width).toBeLessThanOrEqual(viewport.width);expect(setup.y+setup.height).toBeLessThanOrEqual(viewport.height);
  expect(enable.width).toBeGreaterThanOrEqual(48);expect(enable.height).toBeGreaterThanOrEqual(48);
  expect(enable.x).toBeGreaterThanOrEqual(setup.x);expect(enable.y).toBeGreaterThanOrEqual(setup.y);
  expect(enable.x+enable.width).toBeLessThanOrEqual(setup.x+setup.width);expect(enable.y+enable.height).toBeLessThanOrEqual(setup.y+setup.height);
  expect(manual.width).toBeGreaterThanOrEqual(48);expect(manual.height).toBeGreaterThanOrEqual(48);
  expect(manual.x).toBeGreaterThanOrEqual(setup.x);expect(manual.y).toBeGreaterThanOrEqual(setup.y);
  expect(manual.x+manual.width).toBeLessThanOrEqual(setup.x+setup.width);expect(manual.y+manual.height).toBeLessThanOrEqual(setup.y+setup.height);
  const horizontalOverlap=Math.min(enable.x+enable.width,manual.x+manual.width)-Math.max(enable.x,manual.x);
  const verticalOverlap=Math.min(enable.y+enable.height,manual.y+manual.height)-Math.max(enable.y,manual.y);
  expect(horizontalOverlap>0&&verticalOverlap>0).toBe(false);
});
