import {expect,test} from '@playwright/test';

const payload={format:'CannonMap Project',project:{projectId:'camera-readiness-webkit',name:'Camera Readiness WebKit',features:[
  {id:'cp-webkit',name:'1.1 WebKit Target',type:'checkpoint',day:1,sequence:1,status:'active',photoRequirement:'required',visible:true,geometry:{kind:'point',coordinates:[{lat:30,lon:-90}]}},
  {id:'hotel-webkit',name:'1.99 Hotel',type:'hotel',day:1,sequence:99,status:'upcoming',photoRequirement:'required',visible:true,geometry:{kind:'point',coordinates:[{lat:30.1,lon:-90.1}]}}
],competitors:[]}};

async function installWebKitCameraLimit(page){
  await page.addInitScript(()=>{
    let getUserMediaCalls=0;
    const status={state:'granted',addEventListener(){},removeEventListener(){}};
    Object.defineProperty(navigator,'permissions',{configurable:true,value:{query:async descriptor=>{
      if(descriptor?.name!=='camera')throw new TypeError('Unexpected permission query.');
      return status;
    }}});
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{
      getUserMediaCalls++;
      throw new DOMException('WebKit automatic still capture is unavailable.','NotSupportedError');
    }}});
    Object.defineProperty(globalThis,'ImageCapture',{configurable:true,value:undefined});
    globalThis.__webkitCameraMock={getUserMediaCalls:()=>getUserMediaCalls};
  });
}

async function open(page){
  await page.goto('/?e2e=camera-readiness-webkit');
  await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true'&&typeof window.CannonMapTest?.cameraReadinessState==='function');
  await page.locator('#projectInput').setInputFiles({name:'camera-readiness-webkit.cmap',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(payload))});
  await page.evaluate(()=>{const day=document.getElementById('dayFilter');day.value='1';day.dispatchEvent(new Event('change',{bubbles:true}));});
  await expect(page.locator('#rallyDayPreflight')).toBeVisible();
  await expect(page.locator('#rallyDayPreflightOverall')).not.toHaveText('CHECKING');
  await page.locator('#rallyDayPreflightDegraded').click();
  await expect(page.locator('#rallyDayPreflight')).toBeHidden();
}

test('WebKit declares intentional manual-only capture in portrait and landscape',async({page})=>{
  await installWebKitCameraLimit(page);
  await open(page);
  await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.cameraReadinessState())).toMatchObject({permission:'unknown',capability:'manual-only',automaticCaptureEligible:false,getUserMediaSupported:true,imageCaptureSupported:false,reasonCode:'image-capture-unsupported'});
  await expect(page.locator('#rallyCameraSetup')).toBeHidden();
  await expect(page.locator('#rallyWarnings [data-warning-id="camera"] [data-warning-action]')).toHaveCount(0);
  await expect(page.locator('#rallyWarnings [data-warning-id="camera"] [data-camera-action="manual"]')).toHaveCount(1);
  await expect(page.locator('#rallyWarnings [data-warning-id="camera"]')).not.toContainText('ENABLE CAMERA');
  expect(await page.evaluate(()=>globalThis.__webkitCameraMock.getUserMediaCalls())).toBe(0);

  await page.evaluate(input=>window.CannonMapTest.observeCheckpointDetectionsForTest(input),{observedAt:1000,speedMph:5,priorTargetId:'cp-webkit',gpsEvidence:{latitude:30,longitude:-90,accuracyFeet:7},detections:[{checkpointId:'cp-webkit',distanceFeet:3,accuracyFeet:7,radiusFeet:100}]});
  await page.evaluate(input=>window.CannonMapTest.observeCheckpointDetectionsForTest(input),{observedAt:4000,speedMph:5,priorTargetId:'cp-webkit',gpsEvidence:{latitude:30,longitude:-90,accuracyFeet:7},detections:[{checkpointId:'cp-webkit',distanceFeet:2,accuracyFeet:7,radiusFeet:100}]});
  await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.fieldMediaState()?.mode)).toBe('manual-fallback');
  await expect(page.locator('#rallyCameraWorkflow')).toBeVisible();
  await expect(page.locator('#rallyCameraTapSurface')).toBeVisible();
  const viewport=page.viewportSize(),workflow=await page.locator('#rallyCameraWorkflow').boundingBox(),surface=await page.locator('#rallyCameraTapSurface').boundingBox();
  expect(workflow).not.toBeNull();expect(surface).not.toBeNull();
  expect(workflow.x).toBeGreaterThanOrEqual(0);expect(workflow.y).toBeGreaterThanOrEqual(0);
  expect(workflow.x+workflow.width).toBeLessThanOrEqual(viewport.width);expect(workflow.y+workflow.height).toBeLessThanOrEqual(viewport.height);
  expect(surface.width).toBeGreaterThanOrEqual(48);expect(surface.height).toBeGreaterThanOrEqual(48);
  expect(await page.evaluate(()=>globalThis.__webkitCameraMock.getUserMediaCalls())).toBe(0);
});
