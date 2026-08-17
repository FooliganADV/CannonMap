import {expect,test} from '@playwright/test';

const androidProjectNames=new Set(['Android portrait','Android landscape']);
const pngBase64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const projectPayload={
  format:'CannonMap Project',
  project:{
    projectId:'camera-readiness-browser',
    name:'Camera Readiness Browser',
    features:[
      {id:'cp-1',name:'1.1 First Target',type:'checkpoint',day:1,sequence:1,status:'active',photoRequirement:'required',visible:true,geometry:{kind:'point',coordinates:[{lat:30,lon:-90}]}},
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
  grantOnAcquire=true
}={}){
  await page.addInitScript(({initialPermission,querySupported,imageCaptureSupported,grantOnAcquire,png})=>{
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
    const failures={next:null,facings:new Set()},tracksByFacing=new Map();
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
        if(failures.next){const next=failures.next;failures.next=null;throw new DOMException(next.message||'Camera reopen failed.',next.name||'NotReadableError');}
        if(failures.facings.has(facingMode))throw new DOMException(`Camera ${facingMode} unavailable.`,'NotReadableError');
        let readyState='live';
        const track={
          kind:'video',
          get readyState(){return readyState;},
          stop(){readyState='ended';telemetry.trackStops.push({facingMode});},
          getSettings(){return {facingMode,width:1920,height:1080,deviceId:`mock-${facingMode}`};}
        };
        tracksByFacing.set(facingMode,{track,end:()=>{readyState='ended';}});
        return {getTracks:()=>[track],getVideoTracks:()=>[track]};
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
      endFacing:facingMode=>tracksByFacing.get(facingMode)?.end(),
      failFacing:facingMode=>failures.facings.add(facingMode),
      clearFailures:()=>{failures.next=null;failures.facings.clear();}
    };
  },{initialPermission:permission,querySupported:permissionQuerySupported,imageCaptureSupported,grantOnAcquire,png:pngBase64});
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
  expect(afterSetup.trackStops).toHaveLength(0);
  expect(afterSetup.takePhotoCalls).toHaveLength(0);
  await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.cameraSessionState())).toMatchObject({retainedStreamCount:2,getUserMediaCallCount:2});
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
  expect((await platform(page)).getUserMediaCalls).toHaveLength(callsBeforeSecond);
  expect((await platform(page)).getUserMediaCalls).toHaveLength(2);
  await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.cameraSessionState())).toMatchObject({retainedStreamCount:2,getUserMediaCallCount:2});
  expect(await readiness(page)).toMatchObject({permission:'granted',capability:'ready',automaticCaptureEligible:true,setupAttemptedThisSession:true,priorSetupSucceeded:true});
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
  await continueDayPreflight(page);
  await expect(page.locator('#rallyCameraSetup')).toBeHidden();
  await expect(warningRow(page,'camera')).toHaveCount(0);
  const state=await platform(page);
  expect(state.getUserMediaCalls.map(call=>call.facingMode)).toEqual(['environment','user']);
  expect(state.trackStops.map(call=>call.facingMode)).toEqual(['environment','user']);
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
  expect(debug.some(entry=>['camera_setup_denied','camera_readiness_probe_failed'].includes(entry.type)&&entry.permission==='denied')).toBeTruthy();
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

test('a granted stream reopen failure preserves high-speed continuation and the next checkpoint performs one bounded recovery',async({page},testInfo)=>{
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
  await expect.poll(()=>readiness(page)).toMatchObject({permission:'granted',capability:'interrupted',automaticCaptureEligible:false});
  let result=await page.evaluate(async()=>({media:await window.CannonMapTest.missionMediaRecords(),events:await window.CannonMapTest.missionControlJournalEvents(),debug:window.CannonMapTest.rallyDebugEntries(),evidence:window.CannonMapTest.checkpointEvidenceStateForTest('cp-1')}));
  expect(result.media).toHaveLength(0);
  expect(result.events.some(event=>event.eventType==='camera_failure'&&Number(event.metadata.speedAtFailureMph)>10)).toBeTruthy();
  expect(result.events.some(event=>event.eventType==='checkpoint_photo_evidence_incomplete'&&event.references.checkpointId==='cp-1')).toBeTruthy();
  expect(result.events.some(event=>event.eventType==='checkpoint_completed'&&event.references.checkpointId==='cp-1')).toBe(false);
  expect(result.evidence).toMatchObject({arrival:{state:'confirmed',trustworthy:true},completion:{state:'pending',pointsAwarded:0}});
  expect(result.evidence.photo.state).not.toBe('complete');
  expect(result.debug.some(entry=>['camera_capture_failure_revoked_readiness','camera_stream_acquisition_failed'].includes(entry.type))).toBeTruthy();
  const callsBeforeRecovery=(await platform(page)).getUserMediaCalls.length;
  await triggerCheckpoint(page,{checkpointId:'cp-2',latitude:30.0001,observedAt:9000,speedMph:22,priorTargetId:'cp-1'});
  await expect.poll(()=>readiness(page)).toMatchObject({permission:'granted',capability:'ready',automaticCaptureEligible:true});
  result=await page.evaluate(async()=>({media:await window.CannonMapTest.missionMediaRecords(),events:await window.CannonMapTest.missionControlJournalEvents()}));
  expect(result.media).toHaveLength(4);
  expect(result.events.some(event=>event.eventType==='checkpoint_completed'&&event.references.checkpointId==='cp-2')).toBeTruthy();
  expect((await platform(page)).getUserMediaCalls).toHaveLength(callsBeforeRecovery+1);
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
