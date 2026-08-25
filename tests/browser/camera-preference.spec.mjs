import {test,expect} from '@playwright/test';

const photo=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const point=(id,name,type,sequence)=>({id,name,type,day:1,sequence,status:'planned',photoRequirement:'required',visible:true,geometry:{kind:'point',coordinates:[{lat:30+sequence/100,lon:-90}]}});
const payload={format:'CannonMap Project',project:{projectId:'camera-objectives',name:'Camera Objectives',features:[point('cp','1.1 Camera','checkpoint',1),point('hotel','1.2 Hotel','hotel',2)],competitors:[]}};

async function proceedPastReadiness(page){
  const preflight=page.locator('#rallyDayPreflight');
  if(await preflight.isVisible()){
    await expect(page.locator('#rallyDayPreflightOverall')).not.toHaveText('CHECKING');
    await expect(page.locator('#rallyDayPreflightDegraded')).toBeEnabled();
    await page.locator('#rallyDayPreflightDegraded').click();
    await expect(preflight).toBeHidden();
  }
  if(await page.locator('#rallyCameraSetup').isVisible()){
    await page.locator('#rallyCameraContinueManualButton').click();
    await expect(page.locator('#rallyCameraSetup')).toBeHidden();
  }
}

async function open(page){
  await page.goto('/?e2e=camera-pair');await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  await page.locator('#projectInput').setInputFiles({name:'camera-objectives.cmap',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(payload))});
  await expect(page.locator('#status')).toContainText('Opened camera-objectives.cmap');
  await page.evaluate(()=>{const day=document.getElementById('dayFilter');day.value='1';day.dispatchEvent(new Event('change',{bubbles:true}));});
  await expect(page.locator('#rallyDay')).toHaveText('Day 1');
  await proceedPastReadiness(page);
}

test('PHOTO_REQUIRED exposes one full-view fallback shutter and no legacy camera controls',async({page},testInfo)=>{
  test.skip(!testInfo.project.name.startsWith('iPhone 13'),'Mission Control camera controls are a mobile workflow.');await open(page);
  await page.evaluate(()=>window.CannonMapTest.completeCurrentCheckpoint(false));await expect(page.locator('#rallyCameraWorkflow')).toBeVisible();
  await expect(page.locator('#rallyCameraTapSurface')).toBeVisible();
  await expect(page.locator('#rallyCameraWorkflow')).not.toContainText(/60-second|countdown|Save Pair|Open Camera|Capture Pair/);
  await expect(page.locator('#rallyCameraCapturePair, #rallyCameraRetry, #rallyCameraSelfie, #rallyCameraForward')).toHaveCount(0);
  await expect(page.locator('#rallyCameraPhotoCount')).toContainText('No photos captured');
});

test('checkpoint and hotel paired capture records durable four-asset Journal relationships',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='iPhone 13 portrait','Durable workflow is covered once on the primary field viewport.');await open(page);
  await page.evaluate(()=>window.CannonMapTest.completeCurrentCheckpoint(false));await page.locator('#rallyCameraInput').setInputFiles({name:'checkpoint.png',mimeType:'image/png',buffer:photo});await page.evaluate(()=>window.CannonMapTest.awaitFieldMediaIdle());await expect(page.locator('#rallyCameraWorkflow')).toBeHidden();
  await expect(page.locator('#rallyNextName')).toContainText('Hotel');await page.evaluate(()=>window.CannonMapTest.completeCurrentCheckpoint(false));await expect(page.locator('#rallyCameraWorkflow')).toBeVisible();await page.locator('#rallyCameraInput').setInputFiles({name:'hotel.png',mimeType:'image/png',buffer:photo});await page.evaluate(()=>window.CannonMapTest.awaitFieldMediaIdle());
  await expect(page.locator('#rallyDayComplete')).toBeVisible();await page.waitForFunction(async()=>{const events=await window.CannonMapTest.missionControlJournalEvents();return events.filter(event=>event.eventType==='photo_added').length===2;});
  const result=await page.evaluate(async()=>({events:await window.CannonMapTest.missionControlJournalEvents(),media:await window.CannonMapTest.missionMediaRecords()})),photos=result.events.filter(event=>event.eventType==='photo_added');
  expect(photos.map(event=>event.metadata.objectiveType)).toEqual(['checkpoint','hotel']);expect(result.media).toHaveLength(8);
  for(const event of photos){expect(event.references.pairId).toBeTruthy();expect(event.attachments.photos).toHaveLength(4);expect(event.metadata.persistenceStatus).toBe('complete');}
  expect(new Set(result.media.map(row=>row.metadata.cameraRole))).toEqual(new Set(['front','rear']));
});

test('one Journey Photo action creates a durable road and rider pair',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='iPhone 13 portrait');await open(page);await page.locator('#rallyMoreButton').click();
  await expect(page.locator('#rallyJourneyPhotoButton')).toBeVisible();await expect(page.locator('#rallyJourneySelfieButton, #rallyJourneyForwardButton')).toHaveCount(0);
  await page.locator('#rallyJourneyPhotoButton').click();await expect(page.locator('#rallyCameraWorkflow')).toBeVisible();await expect(page.locator('#rallyCameraHeading')).toHaveText('Journey Photo');
  await page.locator('#rallyCameraInput').setInputFiles({name:'journey.png',mimeType:'image/png',buffer:photo});await expect(page.locator('#rallyCameraWorkflow')).toBeHidden();
  await expect.poll(()=>page.evaluate(async()=>{const events=await window.CannonMapTest.missionControlJournalEvents();return events.some(event=>event.eventType==='photo_added'&&event.metadata.objectiveType==='journey'&&event.attachments.photos?.length===4);})).toBe(true);
});

test('full-view fallback remains glove-friendly without GPS overlap in iPhone portrait and landscape',async({page},testInfo)=>{
  test.skip(!testInfo.project.name.startsWith('iPhone 13'));await open(page);await page.evaluate(()=>window.CannonMapTest.completeCurrentCheckpoint(false));
  const capture=await page.locator('#rallyCameraTapSurface').boundingBox(),modal=await page.locator('#rallyCameraWorkflow').boundingBox(),gps=await page.locator('#rallyRecenterFab').boundingBox();
  expect(capture.width).toBeGreaterThanOrEqual(48);expect(capture.height).toBeGreaterThanOrEqual(48);expect(capture.width).toBeGreaterThanOrEqual(modal.width*.8);await expect(page.locator('#rallyRecenterFab')).toBeHidden();
  const overlaps=modal&&gps&&modal.x<gps.x+gps.width&&modal.x+modal.width>gps.x&&modal.y<gps.y+gps.height&&modal.y+modal.height>gps.y;expect(Boolean(overlaps&&await page.locator('#rallyRecenterFab').isVisible())).toBe(false);
});
