import {expect,test} from '@playwright/test';

const phoneLayouts=new Set(['iPhone 13 portrait','iPhone 13 landscape','Android portrait','Android landscape']);

const projectPayload={
  format:'CannonMap Project',
  settings:{dayFilter:'all'},
  project:{
    projectId:'rally-day-preflight-browser',
    name:'Rally Day Preflight Browser',
    features:[
      {id:'cp-1',name:'1.1 Camera Target',type:'checkpoint',day:1,sequence:1,status:'active',photoRequirement:'required',visible:true,geometry:{kind:'point',coordinates:[{lat:30,lon:-90}]}},
      {id:'hotel-1',name:'1.99 Hotel',type:'hotel',day:1,sequence:99,status:'upcoming',photoRequirement:'required',visible:true,geometry:{kind:'point',coordinates:[{lat:30.1,lon:-90.1}]}}
    ],
    competitors:[]
  }
};

async function installPreflightPlatform(page,{
  cameraPermission='prompt',
  gpsPermission='prompt',
  geolocationSupported=true,
  persisted=true,
  shellReady=true
}={}){
  await page.addInitScript(config=>{
    let cameraPermission=config.cameraPermission;
    let gpsPermission=config.gpsPermission;
    let persisted=config.persisted;
    let shellReady=config.shellReady;
    const telemetry={cameraQueries:0,gpsQueries:0,getUserMediaCalls:0,gpsWatchCalls:0,persistCalls:0,registerCalls:0};
    const status=name=>({
      get state(){return name==='camera'?cameraPermission:gpsPermission;},
      addEventListener(){},removeEventListener(){}
    });
    Object.defineProperty(navigator,'permissions',{configurable:true,value:{
      async query(descriptor){
        if(descriptor?.name==='camera'){telemetry.cameraQueries++;return status('camera');}
        if(descriptor?.name==='geolocation'){telemetry.gpsQueries++;return status('geolocation');}
        throw new TypeError(`Unsupported permission descriptor: ${descriptor?.name}`);
      }
    }});

    if(config.geolocationSupported){
      Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
        watchPosition(success,error){
          telemetry.gpsWatchCalls++;
          if(gpsPermission==='denied'){queueMicrotask(()=>error?.({code:1,message:'Location permission denied.'}));return 41;}
          gpsPermission='granted';
          queueMicrotask(()=>success?.({timestamp:Date.now(),coords:{latitude:30,longitude:-90,accuracy:3,speed:0,heading:0,altitude:100}}));
          return 41;
        },
        clearWatch(){},getCurrentPosition(){}
      }});
    }else Object.defineProperty(navigator,'geolocation',{configurable:true,value:undefined});

    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{
      async getUserMedia(constraints){
        telemetry.getUserMediaCalls++;
        if(cameraPermission==='denied')throw new DOMException('Camera permission denied.','NotAllowedError');
        cameraPermission='granted';
        const facing=String(constraints?.video?.facingMode?.ideal||'environment');
        let readyState='live';
        const track={kind:'video',get readyState(){return readyState;},stop(){readyState='ended';},getSettings(){return {facingMode:facing,width:1920,height:1080};}};
        return {getTracks:()=>[track],getVideoTracks:()=>[track]};
      }
    }});
    class MockImageCapture{constructor(track){this.track=track;}async takePhoto(){return new Blob(['photo'],{type:'image/jpeg'});}}
    Object.defineProperty(globalThis,'ImageCapture',{configurable:true,value:MockImageCapture});

    Object.defineProperty(navigator,'storage',{configurable:true,value:{
      async persisted(){return persisted;},
      async persist(){telemetry.persistCalls++;persisted=true;return true;},
      async estimate(){return {usage:2_000_000,quota:2_000_000_000};}
    }});

    const registration={active:{state:'activated'},async update(){}};
    const serviceWorker={
      controller:{state:'activated'},
      ready:Promise.resolve(registration),
      async register(){telemetry.registerCalls++;if(telemetry.registerCalls>1)shellReady=true;return registration;},
      async getRegistration(){return registration;}
    };
    Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:serviceWorker});
    Object.defineProperty(globalThis,'caches',{configurable:true,value:{
      async keys(){return {includes(){return shellReady;}};},
      async open(){return {async match(){return shellReady?new Response('cached',{status:200}):undefined;}};}
    }});

    globalThis.__preflightPlatform={
      snapshot:()=>({cameraPermission,gpsPermission,persisted,shellReady,...telemetry}),
      setCameraPermission:value=>{cameraPermission=value;},
      setGpsPermission:value=>{gpsPermission=value;}
    };
  },{cameraPermission,gpsPermission,geolocationSupported,persisted,shellReady});
}

async function openDay(page,suffix){
  await page.goto(`/?e2e=rally-day-preflight-${suffix}`);
  await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  await page.locator('#projectInput').setInputFiles({name:'preflight.cmap',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(projectPayload))});
  await expect(page.locator('#status')).toContainText('Opened preflight.cmap');
  await page.evaluate(()=>{
    const select=document.getElementById('dayFilter');
    select.value='1';
    select.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await expect(page.locator('#rallyDayPreflight')).toBeVisible();
  await expect(page.locator('#rallyDayPreflightOverall')).not.toHaveText('CHECKING');
}

test('fresh camera permission is handled before the first checkpoint',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='Android portrait');
  await installPreflightPlatform(page,{cameraPermission:'prompt'});
  await openDay(page,'camera-prompt');
  await expect(page.locator('#rallyPreflightCameraState')).toHaveText('USER GESTURE');
  await expect(page.locator('#rallyPreflightCameraAction')).toBeVisible();
  await expect(page.locator('#rallyPreflightCameraAction')).toHaveText('ENABLE CAMERA');
  expect((await page.evaluate(()=>globalThis.__preflightPlatform.snapshot())).getUserMediaCalls).toBe(0);
  await page.locator('#rallyPreflightCameraAction').click();
  await expect(page.locator('#rallyPreflightCameraState')).toHaveText('READY');
  const result=await page.evaluate(()=>globalThis.__preflightPlatform.snapshot());
  expect(result.cameraPermission).toBe('granted');
  expect(result.getUserMediaCalls).toBe(2);
  await expect(page.locator('#rallyCameraWorkflow')).toBeHidden();
});

test('denied camera is explicit and deliberate degraded continuation does not reprompt',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='Android portrait');
  await installPreflightPlatform(page,{cameraPermission:'denied'});
  await openDay(page,'camera-denied');
  await expect(page.locator('#rallyPreflightCameraState')).toHaveText('BLOCKED');
  await expect(page.locator('#rallyPreflightCameraDetail')).toContainText(/blocked/i);
  await expect(page.locator('#rallyPreflightCameraAction')).toBeHidden();
  await expect(page.locator('#rallyDayPreflightStart')).toBeDisabled();
  await page.locator('#rallyDayPreflightDegraded').click();
  await expect(page.locator('#rallyDayPreflight')).toBeHidden();
  expect((await page.evaluate(()=>globalThis.__preflightPlatform.snapshot())).getUserMediaCalls).toBe(0);
});

test('unavailable GPS is blocked rather than falsely reported ready',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='Android portrait');
  await installPreflightPlatform(page,{geolocationSupported:false,gpsPermission:'unknown'});
  await openDay(page,'gps-unavailable');
  await expect(page.locator('#rallyPreflightGpsState')).toHaveText('BLOCKED');
  await expect(page.locator('#rallyPreflightGpsDetail')).toContainText(/unavailable/i);
  await expect(page.locator('#rallyPreflightGpsAction')).toBeHidden();
  await expect(page.locator('#rallyDayPreflightStart')).toBeDisabled();
});

test('storage protection and offline-shell preparation expose distinct actions',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='Android portrait');
  await installPreflightPlatform(page,{persisted:false,shellReady:false});
  await openDay(page,'storage-offline-actions');
  await expect(page.locator('#rallyPreflightStorageState')).toHaveText('READY');
  await expect(page.locator('#rallyPreflightStorageAction')).toHaveText('PROTECT STORAGE');
  await expect(page.locator('#rallyPreflightOfflineState')).toHaveText('ACTION REQUIRED');
  await expect(page.locator('#rallyPreflightOfflineAction')).toHaveText('PREPARE OFFLINE');
  await page.locator('#rallyPreflightStorageAction').click();
  await expect(page.locator('#rallyPreflightStorageState')).toHaveText('READY');
  await page.locator('#rallyPreflightOfflineAction').click();
  await expect(page.locator('#rallyPreflightOfflineState')).toHaveText('READY');
  const result=await page.evaluate(()=>globalThis.__preflightPlatform.snapshot());
  expect(result.persistCalls).toBe(1);
  expect(result.registerCalls).toBeGreaterThanOrEqual(2);
});

test('preflight remains glove-safe and unclipped in phone portrait and landscape',async({page},testInfo)=>{
  test.skip(!phoneLayouts.has(testInfo.project.name));
  await installPreflightPlatform(page,{cameraPermission:'prompt',gpsPermission:'prompt',persisted:false,shellReady:false});
  await openDay(page,`layout-${testInfo.project.name.replaceAll(' ','-')}`);
  const geometry=await page.evaluate(()=>{
    const sheet=document.getElementById('rallyDayPreflight'),viewport={width:innerWidth,height:innerHeight};
    const rect=element=>{const box=element.getBoundingClientRect();return {left:box.left,top:box.top,right:box.right,bottom:box.bottom,width:box.width,height:box.height};};
    const buttonIds=[...sheet.querySelectorAll('button:not([hidden])')].filter(button=>getComputedStyle(button).display!=='none').map(button=>button.id);
    return {viewport,sheet:rect(sheet),buttonIds};
  });
  expect(geometry.sheet.left).toBeGreaterThanOrEqual(0);
  expect(geometry.sheet.right).toBeLessThanOrEqual(geometry.viewport.width+1);
  expect(geometry.sheet.top).toBeGreaterThanOrEqual(0);
  expect(geometry.sheet.bottom).toBeLessThanOrEqual(geometry.viewport.height+1);
  expect(geometry.buttonIds.length).toBeGreaterThanOrEqual(5);
  for(const id of geometry.buttonIds){
    const locator=page.locator(`#${id}`);
    await locator.scrollIntoViewIfNeeded();
    const button=await locator.boundingBox();
    expect(button,`${id} bounding box`).not.toBeNull();
    expect(button.width,`${id} width`).toBeGreaterThanOrEqual(48);
    expect(button.height,`${id} height`).toBeGreaterThanOrEqual(48);
    expect(button.x,`${id} left edge`).toBeGreaterThanOrEqual(0);
    expect(button.x+button.width,`${id} right edge`).toBeLessThanOrEqual(geometry.viewport.width+1);
    expect(button.y,`${id} top edge`).toBeGreaterThanOrEqual(0);
    expect(button.y+button.height,`${id} bottom edge`).toBeLessThanOrEqual(geometry.viewport.height+1);
  }
});
