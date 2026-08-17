import {expect,test} from '@playwright/test';

const payload={
  format:'CannonMap Project',
  project:{
    projectId:'field-media-browser',
    name:'Field Media Browser',
    features:[
      {id:'cp-37',name:'1.37 Prior Target',type:'checkpoint',day:1,sequence:1,status:'active',photoRequirement:'required',visible:true,geometry:{kind:'point',coordinates:[{lat:30,lon:-90}]}},
      {id:'cp-42',name:'1.42 Detected Target',type:'checkpoint',day:1,sequence:2,status:'upcoming',photoRequirement:'required',visible:true,geometry:{kind:'point',coordinates:[{lat:30.0001,lon:-90}]}},
      {id:'hotel-1',name:'1.99 Hotel',type:'hotel',day:1,sequence:99,status:'upcoming',photoRequirement:'required',visible:true,geometry:{kind:'point',coordinates:[{lat:30.1,lon:-90.1}]}}
    ],
    competitors:[]
  }
};

const isPhone=projectName=>projectName!=='desktop';
const pngBase64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function installAutomaticCapture(page,{failure=false}={}){
  await page.evaluate(({png,failure})=>{
    const bytes=Uint8Array.from(atob(png),character=>character.charCodeAt(0));
    window.CannonMapTest.setAutomaticCameraCaptureForTest(camera=>{
      if(failure)throw new Error('camera unavailable');
      return {
        blob:new Blob([bytes],{type:'image/png'}),
        provenance:{requestedCamera:camera,actualCamera:camera,cameraSelectionHonored:true,captureMethod:'test-imagecapture',sourceKind:'image-capture-photo',nativeStill:true,derivedFromVideoFrame:false,upscaled:false,width:1,height:1,mimeType:'image/png',byteLength:bytes.length},
        tracksStopped:true
      };
    });
  },{png:pngBase64,failure});
}

async function proceedPastReadiness(page){
  await expect(page.locator('#rallyMode')).toBeVisible();
  const preflight=page.locator('#rallyDayPreflight');
  if(await preflight.isVisible()){
    await expect(page.locator('#rallyDayPreflightDegraded')).toBeEnabled();
    await page.locator('#rallyDayPreflightDegraded').click();
    await expect(preflight).toBeHidden();
  }
  if(await page.locator('#rallyCameraSetup').isVisible())await page.locator('#rallyCameraContinueManualButton').click();
}

async function open(page,input=payload){
  await page.goto('/?e2e=field-media-ux');
  await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  await page.locator('#projectInput').setInputFiles({
    name:'field-media-browser.cmap',
    mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify(input))
  });
  await expect(page.locator('#status')).toContainText('Opened field-media-browser.cmap');
  await page.evaluate(()=>{
    const day=document.getElementById('dayFilter');
    day.value='1';
    day.dispatchEvent(new Event('change',{bubbles:true}));
  });
  // This suite validates field-media behavior rather than permission setup.
  // Make the pre-ride degraded choice explicit so readiness cannot conceal
  // unrelated Rally controls in a fresh browser context.
  await proceedPastReadiness(page);
}

async function checkpointEvidenceSummary(page,checkpointId='cp-42'){
  return page.evaluate(async id=>{
    const events=await window.CannonMapTest.missionControlJournalEvents(),media=await window.CannonMapTest.missionMediaRecords();
    const forCheckpoint=events.filter(event=>event.references?.checkpointId===id||event.metadata?.checkpointId===id);
    return {
      arrivals:forCheckpoint.filter(event=>event.eventType==='checkpoint_arrival'),
      incomplete:forCheckpoint.filter(event=>event.eventType==='checkpoint_photo_evidence_incomplete'),
      completions:forCheckpoint.filter(event=>event.eventType==='checkpoint_completed'),
      mediaCount:media.length,
      score:window.CannonMapTest.rallyScore()
    };
  },checkpointId);
}

function expectArrivalConfirmedPhotoMissing(result,{failureDisposition}={}){
  expect(result.arrivals).toHaveLength(1);
  expect(result.arrivals[0].metadata).toMatchObject({arrivalState:'confirmed',pointsWithheld:true,photoRequired:true});
  expect(result.arrivals[0].metadata.arrivalEvidence).toMatchObject({state:'confirmed',trustworthy:true});
  expect(result.incomplete).toHaveLength(1);
  expect(result.incomplete[0].metadata).toMatchObject({arrivalState:'confirmed',pointsWithheld:true,pointsAwarded:0,normalCompletionEmitted:false});
  expect(result.incomplete[0].metadata.photoEvidenceState).not.toBe('complete');
  expect(result.incomplete[0].metadata.summary).toMatch(/GPS arrival is confirmed.*photo evidence is incomplete/i);
  if(failureDisposition)expect(result.incomplete[0].metadata.reasonCode).toBe(failureDisposition);
  expect(result.completions).toHaveLength(0);
  expect(result.score).toBe(0);
}

test('Mission Control exposes one paired Journey Photo action',async({page},testInfo)=>{
  test.skip(!isPhone(testInfo.project.name));
  await open(page);
  await page.locator('#rallyMoreButton').click();
  await expect(page.locator('#rallyJourneyPhotoButton')).toBeVisible();
  await expect(page.locator('#rallyJourneyPhotoButton')).toHaveText('Journey Photo');
  await expect(page.locator('#rallyJourneySelfieButton, #rallyJourneyForwardButton')).toHaveCount(0);
  const button=await page.locator('#rallyJourneyPhotoButton').boundingBox();
  expect(button).not.toBeNull();
  expect(button.width).toBeGreaterThanOrEqual(48);
  expect(button.height).toBeGreaterThanOrEqual(48);
});

test('automatic checkpoint capture is paired, silent, and returns to the Rally map',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='Android portrait','Automatic ImageCapture behavior is exercised once on the Android target.');
  const browserDialogs=[];
  page.on('dialog',async dialog=>{browserDialogs.push({type:dialog.type(),message:dialog.message()});await dialog.dismiss();});
  await open(page);
  await installAutomaticCapture(page);
  await page.evaluate(()=>window.CannonMapTest.observeCheckpointDetectionsForTest({observedAt:1000,speedMph:22,priorTargetId:'cp-37',gpsEvidence:{latitude:30,longitude:-90,accuracyFeet:8},detections:[{checkpointId:'cp-42',distanceFeet:5,accuracyFeet:8,radiusFeet:100}]}));
  await page.evaluate(()=>window.CannonMapTest.observeCheckpointDetectionsForTest({observedAt:4000,speedMph:22,priorTargetId:'cp-37',gpsEvidence:{latitude:30.0001,longitude:-90,accuracyFeet:8},detections:[{checkpointId:'cp-42',distanceFeet:4,accuracyFeet:8,radiusFeet:100}]}));
  await page.evaluate(()=>window.CannonMapTest.awaitFieldMediaIdle());
  await expect(page.locator('#rallyCameraWorkflow')).toBeHidden();
  await expect(page.locator('#rallyNextName')).toContainText('Prior Target');
  await expect(page.locator('#rallyMode')).toBeVisible();
  for(const selector of ['#rallyDayComplete','#rallyDeferredPrompt','#rallyBackupSheet','#rallyPhotoViewer','#restoreResultDialog'])await expect(page.locator(selector)).toBeHidden();
  for(const selector of ['#rallyMoreSheet','#rallyJournalSheet','#intelSheet'])await expect(page.locator(selector)).toHaveAttribute('aria-hidden','true');
  await expect.poll(()=>page.evaluate(async()=>({state:window.CannonMapTest.fieldMediaState(),events:await window.CannonMapTest.missionControlJournalEvents(),media:await window.CannonMapTest.missionMediaRecords()}))).toMatchObject({state:{pending:false}});
  const result=await page.evaluate(async()=>({events:await window.CannonMapTest.missionControlJournalEvents(),media:await window.CannonMapTest.missionMediaRecords()}));
  expect(result.media.map(item=>item.role).sort()).toEqual(['evidence','evidence','original','original']);
  expect(result.media.filter(item=>item.role==='original').every(item=>item.metadata.originalSourceProvenance?.nativeStill===true&&item.metadata.originalSourceProvenance?.upscaled===false)).toBeTruthy();
  expect(result.media.filter(item=>item.role==='original').map(item=>[item.metadata.requestedCamera,item.metadata.actualCamera,item.metadata.cameraSelectionHonored]).sort()).toEqual([['front','front',true],['rear','rear',true]]);
  expect(result.media.filter(item=>item.role==='original').every(item=>item.bytes.join(',')!==result.media.find(candidate=>candidate.role==='evidence'&&candidate.metadata.cameraRole===item.metadata.cameraRole)?.bytes.join(','))).toBeTruthy();
  expect(result.events.some(event=>event.eventType==='paired_capture_completed')).toBeTruthy();
  expect(result.events.some(event=>event.eventType==='checkpoint_completed'&&event.references.checkpointId==='cp-42')).toBeTruthy();
  expect(result.events.every(event=>!('blob' in event)&&!('bytes' in event))).toBeTruthy();
  expect(browserDialogs,'automatic success must not open a browser success dialog').toEqual([]);
});

test('high-speed camera failure preserves confirmed arrival, reports photo missing, and withholds score',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='Android portrait');
  await open(page);
  await installAutomaticCapture(page,{failure:true});
  await page.evaluate(()=>window.CannonMapTest.setGpsPositionForTest({lat:30.0001,lon:-90,speedMph:25,accuracyFeet:7}));
  await page.evaluate(()=>window.CannonMapTest.observeCheckpointDetectionsForTest({observedAt:1000,speedMph:25,priorTargetId:'cp-37',gpsEvidence:{latitude:30,longitude:-90,accuracyFeet:7},detections:[{checkpointId:'cp-42',distanceFeet:3,accuracyFeet:7,radiusFeet:100}]}));
  await page.evaluate(()=>window.CannonMapTest.observeCheckpointDetectionsForTest({observedAt:4000,speedMph:25,priorTargetId:'cp-37',gpsEvidence:{latitude:30.0001,longitude:-90,accuracyFeet:7},detections:[{checkpointId:'cp-42',distanceFeet:2,accuracyFeet:7,radiusFeet:100}]}));
  await page.evaluate(()=>window.CannonMapTest.awaitFieldMediaIdle());
  await expect(page.locator('#rallyCameraWorkflow')).toBeHidden();
  const events=await page.evaluate(()=>window.CannonMapTest.missionControlJournalEvents()),result=await checkpointEvidenceSummary(page);
  expect(result.mediaCount).toBe(0);
  expect(events.some(event=>event.eventType==='camera_failure'&&event.metadata.captureStatus==='camera_unavailable_high_speed'&&Number(event.metadata.speedAtFailureMph)>10)).toBeTruthy();
  expectArrivalConfirmedPhotoMissing(result,{failureDisposition:'camera_unavailable_high_speed'});
  await expect(page.locator('#rallyScore')).toHaveText('0');
  await expect(page.locator('#rallyNextName')).toContainText('Prior Target');
});

test('slow-speed fallback expiration preserves confirmed arrival and withholds completion and score',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='Android portrait');
  const slowProject=structuredClone(payload);slowProject.project.projectId='field-media-slow-browser';slowProject.project.name='Field Media Slow Fallback';
  await open(page,slowProject);
  await installAutomaticCapture(page,{failure:true});
  await page.evaluate(()=>window.CannonMapTest.setGpsPositionForTest({lat:30.0001,lon:-90,speedMph:5,accuracyFeet:7}));
  await page.evaluate(()=>window.CannonMapTest.observeCheckpointDetectionsForTest({observedAt:8000,speedMph:5,priorTargetId:'cp-37',gpsEvidence:{latitude:30.0001,longitude:-90,accuracyFeet:7},detections:[{checkpointId:'cp-42',distanceFeet:3,accuracyFeet:7,radiusFeet:100}]}));
  await page.evaluate(()=>window.CannonMapTest.observeCheckpointDetectionsForTest({observedAt:11000,speedMph:5,priorTargetId:'cp-37',gpsEvidence:{latitude:30.0001,longitude:-90,accuracyFeet:7},detections:[{checkpointId:'cp-42',distanceFeet:2,accuracyFeet:7,radiusFeet:100}]}));
  await expect(page.locator('#rallyCameraWorkflow')).toBeVisible();await expect(page.locator('#rallyCameraTapSurface')).toBeVisible();await expect(page.locator('#rallyCameraWorkflow')).not.toContainText(/countdown|60 seconds/i);
  expect(await page.evaluate(()=>window.CannonMapTest.fieldMediaState())).toMatchObject({pending:true,pendingCheckpointId:'cp-42',priorTargetId:'cp-37',mode:'manual-fallback'});
  await page.evaluate(()=>window.CannonMapTest.expireManualFallbackForTest());await page.evaluate(()=>window.CannonMapTest.awaitFieldMediaIdle());
  await expect(page.locator('#rallyCameraWorkflow')).toBeHidden();
  await expect(page.locator('#rallyMode')).toBeVisible();
  await expect(page.locator('#rallyNextName')).toContainText('Prior Target');
  await expect(page.locator('#rallyDay')).toContainText('Day 1');
  await expect(page.locator('#rallyDayComplete')).toBeHidden();
  const state=await page.evaluate(()=>window.CannonMapTest.fieldMediaState()),events=await page.evaluate(()=>window.CannonMapTest.missionControlJournalEvents()),result=await checkpointEvidenceSummary(page);
  expect(state).toMatchObject({pending:false,pendingCheckpointId:null});
  expect(result.mediaCount).toBe(0);
  expect(events.some(event=>event.eventType==='camera_failure'&&event.references.checkpointId==='cp-42'&&event.metadata.captureStatus==='manual_fallback_expired'&&Number(event.metadata.speedAtFailureMph)<=10)).toBeTruthy();
  expectArrivalConfirmedPhotoMissing(result,{failureDisposition:'manual_fallback_expired'});
  await expect(page.locator('#rallyScore')).toHaveText('0');
});

test('reload restores one confirmed arrival with pending photo evidence and never duplicates completion',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='Android portrait');
  const reloadProject=structuredClone(payload);reloadProject.project.projectId='field-media-reload-browser';reloadProject.project.name='Field Media Reload Recovery';
  await open(page,reloadProject);await installAutomaticCapture(page,{failure:true});
  await page.evaluate(()=>window.CannonMapTest.setGpsPositionForTest({lat:30.0001,lon:-90,speedMph:25,accuracyFeet:7}));
  const detections=[{checkpointId:'cp-42',distanceFeet:3,accuracyFeet:7,radiusFeet:100}];
  await page.evaluate(d=>window.CannonMapTest.observeCheckpointDetectionsForTest({observedAt:20_000,speedMph:25,priorTargetId:'cp-37',gpsEvidence:{latitude:30.0001,longitude:-90,accuracyFeet:7},detections:d}),detections);
  await page.evaluate(d=>window.CannonMapTest.observeCheckpointDetectionsForTest({observedAt:23_000,speedMph:25,priorTargetId:'cp-37',gpsEvidence:{latitude:30.0001,longitude:-90,accuracyFeet:7},detections:d}),detections);
  await page.evaluate(()=>window.CannonMapTest.awaitFieldMediaIdle());
  expectArrivalConfirmedPhotoMissing(await checkpointEvidenceSummary(page),{failureDisposition:'camera_unavailable_high_speed'});

  await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  const restored=await checkpointEvidenceSummary(page);
  expectArrivalConfirmedPhotoMissing(restored,{failureDisposition:'camera_unavailable_high_speed'});
  expect(restored.mediaCount).toBe(0);
  await expect(page.locator('#rallyScore')).toHaveText('0');
});

test('offline reconnection reconciles pending evidence without duplicating arrival, media, or score',async({page,context},testInfo)=>{
  test.skip(testInfo.project.name!=='Android portrait');
  const reconnectProject=structuredClone(payload);reconnectProject.project.projectId='field-media-reconnect-browser';reconnectProject.project.name='Field Media Reconnect';
  await open(page,reconnectProject);await installAutomaticCapture(page,{failure:true});await context.setOffline(true);
  await page.evaluate(()=>window.CannonMapTest.setGpsPositionForTest({lat:30.0001,lon:-90,speedMph:25,accuracyFeet:7}));
  const detections=[{checkpointId:'cp-42',distanceFeet:3,accuracyFeet:7,radiusFeet:100}];
  await page.evaluate(d=>window.CannonMapTest.observeCheckpointDetectionsForTest({observedAt:30_000,speedMph:25,priorTargetId:'cp-37',gpsEvidence:{latitude:30.0001,longitude:-90,accuracyFeet:7},detections:d}),detections);
  await page.evaluate(d=>window.CannonMapTest.observeCheckpointDetectionsForTest({observedAt:33_000,speedMph:25,priorTargetId:'cp-37',gpsEvidence:{latitude:30.0001,longitude:-90,accuracyFeet:7},detections:d}),detections);
  await page.evaluate(()=>window.CannonMapTest.awaitFieldMediaIdle());
  const offline=await checkpointEvidenceSummary(page);expectArrivalConfirmedPhotoMissing(offline,{failureDisposition:'camera_unavailable_high_speed'});expect(offline.arrivals[0].metadata.offline).toBe(true);

  await context.setOffline(false);
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  // Reconnection restores the durable projection without silently opening a
  // hidden camera workflow. Rider-initiated recovery opens only on demand.
  await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.checkpointEvidenceStateForTest('cp-42'))).toMatchObject({arrival:{state:'confirmed',trustworthy:true},completion:{state:'pending'}});
  expect(await page.evaluate(()=>window.CannonMapTest.fieldMediaState())).toMatchObject({pending:false,pendingCheckpointId:null});
  await page.evaluate(()=>window.CannonMapTest.reconcilePendingCheckpointEvidenceForTest({checkpointId:'cp-42',interactive:true}));
  await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.fieldMediaState())).toMatchObject({pending:true,pendingCheckpointId:'cp-42',mode:'recovery'});
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  const reconnected=await checkpointEvidenceSummary(page);expectArrivalConfirmedPhotoMissing(reconnected,{failureDisposition:'camera_unavailable_high_speed'});expect(reconnected.mediaCount).toBe(0);
});

test('background position gap does not invent a checkpoint crossing without an authoritative in-radius sample',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='Android portrait');
  const backgroundProject=structuredClone(payload);backgroundProject.project.projectId='field-media-background-gap';backgroundProject.project.name='Field Media Background Gap';
  await open(page,backgroundProject);
  await page.evaluate(()=>{globalThis.__fieldVisibility='visible';Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>globalThis.__fieldVisibility});window.CannonMapTest.setGpsPositionForTest({lat:30.0001,lon:-90.003,speedMph:25,accuracyFeet:7});});
  await page.evaluate(()=>{globalThis.__fieldVisibility='hidden';document.dispatchEvent(new Event('visibilitychange'));window.CannonMapTest.setGpsPositionForTest({lat:30.0001,lon:-89.997,speedMph:25,accuracyFeet:7});});
  await page.evaluate(()=>{globalThis.__fieldVisibility='visible';document.dispatchEvent(new Event('visibilitychange'));window.CannonMapTest.evaluateCheckpointArrival(7);window.CannonMapTest.evaluateCheckpointArrival(7);});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const result=await checkpointEvidenceSummary(page);
  expect(result.arrivals).toHaveLength(0);expect(result.incomplete).toHaveLength(0);expect(result.completions).toHaveLength(0);expect(result.mediaCount).toBe(0);expect(result.score).toBe(0);
});

test('closely spaced out-of-order checkpoint hits are serialized and preserve the prior target',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='Android portrait');
  const clustered=structuredClone(payload);clustered.project.features.splice(2,0,{id:'cp-43',name:'1.43 Second Detected Target',type:'checkpoint',day:1,sequence:3,status:'upcoming',photoRequirement:'required',visible:true,geometry:{kind:'point',coordinates:[{lat:30.0002,lon:-90}]}});
  await page.goto('/?e2e=field-media-queue');await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');await page.locator('#projectInput').setInputFiles({name:'clustered.cmap',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(clustered))});await page.evaluate(()=>{const day=document.getElementById('dayFilter');day.value='1';day.dispatchEvent(new Event('change',{bubbles:true}));});await proceedPastReadiness(page);
  await installAutomaticCapture(page);
  const detections=[{checkpointId:'cp-42',distanceFeet:4,accuracyFeet:6,radiusFeet:100},{checkpointId:'cp-43',distanceFeet:7,accuracyFeet:6,radiusFeet:100}];
  await page.evaluate(d=>window.CannonMapTest.observeCheckpointDetectionsForTest({observedAt:1000,speedMph:18,priorTargetId:'cp-37',gpsEvidence:{latitude:30,longitude:-90,accuracyFeet:6},detections:d}),detections);
  await page.evaluate(d=>window.CannonMapTest.observeCheckpointDetectionsForTest({observedAt:4000,speedMph:18,priorTargetId:'cp-37',gpsEvidence:{latitude:30.0001,longitude:-90,accuracyFeet:6},detections:d}),detections);
  await page.evaluate(()=>window.CannonMapTest.awaitFieldMediaIdle());
  const completed=await page.evaluate(async()=>{const events=await window.CannonMapTest.missionControlJournalEvents();return events.filter(event=>event.eventType==='checkpoint_completed').map(event=>event.references.checkpointId);});
  expect(completed).toEqual(expect.arrayContaining(['cp-42','cp-43']));expect(completed.indexOf('cp-42')).toBeLessThan(completed.indexOf('cp-43'));await expect(page.locator('#rallyNextName')).toContainText('Prior Target');
});

test('supported Journey Photo capture stays silent and stores one logical pair',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='Android portrait');await open(page);await installAutomaticCapture(page);await page.locator('#rallyMoreButton').click();await page.locator('#rallyJourneyPhotoButton').click();
  await expect(page.locator('#rallyCameraWorkflow')).toBeHidden();await expect.poll(()=>page.evaluate(async()=>{const events=await window.CannonMapTest.missionControlJournalEvents();return events.some(event=>event.eventType==='photo_added'&&event.metadata.objectiveType==='journey');})).toBe(true);
  const result=await page.evaluate(async()=>({events:await window.CannonMapTest.missionControlJournalEvents(),media:await window.CannonMapTest.missionMediaRecords()}));
  const journey=result.events.find(event=>event.eventType==='photo_added'&&event.metadata.objectiveType==='journey');expect(journey).toBeTruthy();expect(journey.attachments.photos).toHaveLength(4);expect(result.media).toHaveLength(4);
});

test('manual camera fallback accepts taps across the capture surface, stores a pair, and returns to the map',async({page},testInfo)=>{
  test.skip(!isPhone(testInfo.project.name));
  await open(page);
  await page.evaluate(()=>window.CannonMapTest.completeCurrentCheckpoint(false));
  await expect(page.locator('#rallyCameraWorkflow')).toBeVisible();
  await expect(page.locator('#rallyCameraTapSurface')).toBeVisible();
  await expect(page.locator('#rallyCameraWorkflow')).not.toContainText(/countdown|use photo|retake|open camera|capture pair/i);
  await expect(page.locator('#rallyCameraFailObjective')).toBeVisible();
  const viewport=page.viewportSize();
  const modal=await page.locator('#rallyCameraWorkflow').boundingBox();
  const surface=await page.locator('#rallyCameraTapSurface').boundingBox();
  expect(modal).not.toBeNull();
  expect(surface).not.toBeNull();
  expect(modal.x).toBeGreaterThanOrEqual(0);
  expect(modal.y).toBeGreaterThanOrEqual(0);
  expect(modal.x+modal.width).toBeLessThanOrEqual(viewport.width);
  expect(modal.y+modal.height).toBeLessThanOrEqual(viewport.height);
  expect(surface.width).toBeGreaterThanOrEqual(modal.width*.8);
  expect(surface.height).toBeGreaterThanOrEqual(Math.max(48,modal.height*.65));
  await expect(page.locator('#rallyRecenterFab')).toBeHidden();

  await page.evaluate(()=>{
    globalThis.__fieldMediaFallbackTaps=0;
    for(const id of ['rallyCameraFrontInput','rallyCameraRearInput']){
      const input=document.getElementById(id);
      input.click=()=>{globalThis.__fieldMediaFallbackTaps++;};
    }
  });
  const tapPoints=[
    {x:12,y:12},
    {x:Math.floor(surface.width/2),y:Math.floor(surface.height/2)},
    {x:Math.max(1,Math.floor(surface.width-12)),y:Math.max(1,Math.floor(surface.height-12))}
  ];
  for(const [index,position] of tapPoints.entries()){
    await page.locator('#rallyCameraTapSurface').click({position});
    await expect.poll(()=>page.evaluate(()=>globalThis.__fieldMediaFallbackTaps)).toBe(index+1);
  }

  await page.locator('#rallyCameraInput').setInputFiles({name:'manual-pair.png',mimeType:'image/png',buffer:Buffer.from(pngBase64,'base64')});
  await expect(page.locator('#rallyCameraWorkflow')).toBeHidden();
  await expect(page.locator('#rallyMode')).toBeVisible();
  await expect(page.locator('#rallyNextName')).toContainText('Detected Target');
  const result=await page.evaluate(async()=>({events:await window.CannonMapTest.missionControlJournalEvents(),media:await window.CannonMapTest.missionMediaRecords()}));
  expect(result.media.map(item=>item.role).sort()).toEqual(['evidence','evidence','original','original']);
  expect(result.events.some(event=>event.eventType==='checkpoint_completed'&&event.references.checkpointId==='cp-37')).toBeTruthy();
  await page.screenshot({path:testInfo.outputPath('field-media-manual-fallback.png')});
});

test('Rally Mode and fallback remain within portrait and landscape safe areas',async({page},testInfo)=>{
  test.skip(!isPhone(testInfo.project.name));
  await open(page);
  const viewport=page.viewportSize();
  const dock=await page.locator('.rally-actions').boundingBox();
  expect(dock).not.toBeNull();
  expect(dock.x).toBeGreaterThanOrEqual(0);
  expect(dock.y).toBeGreaterThanOrEqual(0);
  expect(dock.x+dock.width).toBeLessThanOrEqual(viewport.width);
  expect(dock.y+dock.height).toBeLessThanOrEqual(viewport.height);

  const buttons=await page.locator('.rally-actions button:visible').evaluateAll(elements=>elements.map(element=>{
    const rect=element.getBoundingClientRect();
    return {id:element.id,left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height};
  }));
  for(const button of buttons){
    expect(button.width,`${button.id} width`).toBeGreaterThanOrEqual(48);
    expect(button.height,`${button.id} height`).toBeGreaterThanOrEqual(48);
    expect(button.left,`${button.id} left`).toBeGreaterThanOrEqual(0);
    expect(button.right,`${button.id} right`).toBeLessThanOrEqual(viewport.width);
    expect(button.top,`${button.id} top`).toBeGreaterThanOrEqual(0);
    expect(button.bottom,`${button.id} bottom`).toBeLessThanOrEqual(viewport.height);
  }
  for(let left=0;left<buttons.length;left++)for(let right=left+1;right<buttons.length;right++){
    const a=buttons[left],b=buttons[right];
    const overlaps=a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
    expect(overlaps,`${a.id} overlaps ${b.id}`).toBeFalsy();
  }

  if(viewport.width>viewport.height){
    const [dayHeader,primaryCard,score]=await Promise.all([
      page.locator('.rally-head-day').boundingBox(),
      page.locator('#rallyPrimaryCard').boundingBox(),
      page.locator('.rally-score-slot').boundingBox()
    ]);
    for(const [leftName,left,rightName,right] of [['day/GPS header',dayHeader,'primary objective',primaryCard],['primary objective',primaryCard,'score',score]]){
      expect(left).not.toBeNull();expect(right).not.toBeNull();
      const overlaps=left.x<right.x+right.width&&left.x+left.width>right.x&&left.y<right.y+right.height&&left.y+left.height>right.y;
      expect(overlaps,`${leftName} overlaps ${rightName}`).toBeFalsy();
    }
  }

  await page.evaluate(()=>window.CannonMapTest.completeCurrentCheckpoint(false));
  const fallback=await page.locator('#rallyCameraWorkflow').boundingBox();
  expect(fallback).not.toBeNull();
  expect(fallback.x).toBeGreaterThanOrEqual(0);
  expect(fallback.y).toBeGreaterThanOrEqual(0);
  expect(fallback.x+fallback.width).toBeLessThanOrEqual(viewport.width);
  expect(fallback.y+fallback.height).toBeLessThanOrEqual(viewport.height);
});

test('storage diagnostics distinguish preferred budget from actual browser capacity',async({page},testInfo)=>{
  test.skip(!isPhone(testInfo.project.name));
  await page.addInitScript(()=>Object.defineProperty(navigator,'storage',{configurable:true,value:{estimate:async()=>({usage:125_000_000,quota:2_000_000_000}),persisted:async()=>false,persist:async()=>true}}));
  await open(page);
  await page.locator('#rallyMoreButton').click();
  const diagnostics=page.locator('.rally-storage-diagnostics').first();
  await diagnostics.locator('summary').click();
  await expect(page.locator('#rallyStorageSummary')).toContainText(/Preferred mission-media budget/i);
  await expect(page.locator('#rallyStorageSummary')).toContainText(/planning target, not guaranteed capacity/i);
  await expect(page.locator('#rallyStorageSummary')).toContainText(/Browser storage/i);
  await expect(page.locator('#rallyStorageSummary')).toContainText(/Persistent storage/i);
  await expect(page.locator('#rallyStorageSummary')).toContainText(/remaining paired captures/i);
  const estimate=await page.evaluate(()=>window.CannonMapTest.missionStorageEstimate());expect(estimate.preferredMissionMediaBudgetBytes).toBe(10_000_000_000);expect(estimate.actualQuotaBytes).toBe(2_000_000_000);expect(estimate.actualUsageBytes).toBe(125_000_000);expect(estimate.preferredBudget.kind).toBe('preferred-not-guaranteed');
});

test('Wake Lock is optional, acquired with GPS, and released when GPS stops',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='Android portrait');
  await page.addInitScript(()=>{
    globalThis.__wakeLockRequests=0;globalThis.__visibility='visible';let success=null;
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>globalThis.__visibility});
    Object.defineProperty(navigator,'wakeLock',{configurable:true,value:{request:async type=>{globalThis.__wakeLockRequests++;const listeners=new Set(),sentinel={type,released:false,addEventListener:(name,callback)=>{if(name==='release')listeners.add(callback);},removeEventListener:(name,callback)=>listeners.delete(callback),async release(){if(this.released)return;this.released=true;for(const callback of listeners)callback();}};globalThis.__wakeSentinel=sentinel;return sentinel;}}});
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:{watchPosition(callback){success=callback;return 41;},clearWatch(){success=null;}}});
  });
  // Explicit preflight continuation already starts GPS; no second tap should
  // be required and a second tap would intentionally stop the active watch.
  await open(page);
  await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.wakeLockState())).toMatchObject({supported:true,desired:true,held:true});expect(await page.evaluate(()=>globalThis.__wakeLockRequests)).toBe(1);
  await page.evaluate(async()=>{globalThis.__visibility='hidden';document.dispatchEvent(new Event('visibilitychange'));await globalThis.__wakeSentinel.release();});await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.wakeLockState())).toMatchObject({desired:true,held:false,visible:false});
  await page.evaluate(()=>{globalThis.__visibility='visible';document.dispatchEvent(new Event('visibilitychange'));});await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.wakeLockState())).toMatchObject({desired:true,held:true,visible:true});expect(await page.evaluate(()=>globalThis.__wakeLockRequests)).toBe(2);
  await page.locator('#rallyRecenterFab').click();await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.wakeLockState())).toMatchObject({supported:true,desired:false,held:false});await expect(page.locator('#rallyMode')).toBeVisible();
});
