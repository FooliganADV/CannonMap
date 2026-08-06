import {test,expect} from '@playwright/test';

const photo=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const point=(id,name,type,sequence)=>({id,name,type,day:1,sequence,status:'planned',photoRequirement:'required',visible:true,geometry:{kind:'point',coordinates:[{lat:30+sequence/100,lon:-90}]}});
const payload={format:'CannonMap Project',project:{projectId:'camera-objectives',name:'Camera Objectives',features:[point('cp','1.1 Camera','checkpoint',1),point('hotel','1.2 Hotel','hotel',2)],competitors:[]}};

async function open(page){
  await page.goto('/?e2e=camera-direct');await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  await page.locator('#projectInput').setInputFiles({name:'camera-objectives.cmap',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(payload))});
}
async function interceptNativePicker(page,inputId){
  await page.evaluate(id=>{const input=document.getElementById(id);input.dataset.directTriggers='0';input.click=()=>{input.dataset.directTriggers=String(Number(input.dataset.directTriggers)+1);};},inputId);
}

test('More has no duplicate camera preference and checkpoint buttons open the requested native camera directly',async({page},testInfo)=>{
  test.skip(!testInfo.project.name.startsWith('iPhone 13'),'Mission Control camera controls are a mobile workflow.');await open(page);
  await page.locator('#rallyMoreButton').click();await expect(page.locator('.rally-camera-settings')).toHaveCount(0);await page.locator('#rallyMoreButton').click();
  await page.evaluate(()=>window.CannonMapTest.completeCurrentCheckpoint(false));await expect(page.locator('#rallyCameraWorkflow')).toBeVisible();
  await expect(page.locator('#rallyCameraWorkflow')).not.toContainText('Open Camera');await interceptNativePicker(page,'rallyCameraInput');
  await page.locator('#rallyCameraSelfie').click();await expect(page.locator('#rallyCameraInput')).toHaveAttribute('capture','user');await expect(page.locator('#rallyCameraInput')).toHaveAttribute('data-direct-triggers','1');await expect(page.locator('#rallyCameraSelfie')).toHaveClass(/is-active/);
  await page.locator('#rallyCameraForward').click();await expect(page.locator('#rallyCameraInput')).toHaveAttribute('capture','environment');await expect(page.locator('#rallyCameraInput')).toHaveAttribute('data-direct-triggers','2');await expect(page.locator('#rallyCameraForward')).toHaveClass(/is-active/);
  await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');await expect(page.locator('#rallyCameraInput')).toHaveAttribute('capture','environment');
});

test('checkpoint and hotel direct capture preserve durable camera metadata',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='iPhone 13 portrait','Durable workflow is covered once on the primary field viewport.');await open(page);
  await page.evaluate(()=>window.CannonMapTest.completeCurrentCheckpoint(false));await page.locator('#rallyCameraForward').click();await page.locator('#rallyCameraInput').setInputFiles({name:'checkpoint.png',mimeType:'image/png',buffer:photo});
  await expect(page.locator('#rallyNextName')).toContainText('Hotel');await page.evaluate(()=>window.CannonMapTest.completeCurrentCheckpoint(false));await page.locator('#rallyCameraSelfie').click();await page.locator('#rallyCameraInput').setInputFiles({name:'hotel.png',mimeType:'image/png',buffer:photo});
  await page.waitForFunction(async()=>{const events=await window.CannonMapTest.missionControlJournalEvents();return events.filter(event=>event.eventType==='photo_added').length===2;});
  const events=await page.evaluate(()=>window.CannonMapTest.missionControlJournalEvents()),photos=events.filter(event=>event.eventType==='photo_added');
  expect(photos.map(event=>event.metadata.objectiveType)).toEqual(['checkpoint','hotel']);expect(photos.map(event=>event.metadata.requestedCamera)).toEqual(['rear','front']);
  for(const event of photos){expect(event.metadata).toMatchObject({actualCamera:'unknown',cameraSelectionHonored:'unknown',captureMethod:'file-input'});expect(event.metadata.captureTimestamp).toBeTruthy();}
});

test('Journey Selfie and Forward are direct actions and retain the last-used highlight',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='iPhone 13 portrait');await open(page);await page.locator('#rallyMoreButton').click();await page.evaluate(()=>{window.prompt=()=>'';});await interceptNativePicker(page,'rallyJourneyPhotoInput');
  await page.locator('#rallyJourneySelfieButton').click();await expect(page.locator('#rallyJourneyPhotoInput')).toHaveAttribute('capture','user');await expect(page.locator('#rallyJourneyPhotoInput')).toHaveAttribute('data-direct-triggers','1');
  await page.locator('#rallyJourneyForwardButton').click();await expect(page.locator('#rallyJourneyPhotoInput')).toHaveAttribute('capture','environment');await expect(page.locator('#rallyJourneyPhotoInput')).toHaveAttribute('data-direct-triggers','2');await expect(page.locator('#rallyJourneyForwardButton')).toHaveClass(/is-active/);
});

test('camera prompt remains glove-friendly without GPS overlap in iPhone portrait and landscape',async({page},testInfo)=>{
  test.skip(!testInfo.project.name.startsWith('iPhone 13'));await open(page);await page.evaluate(()=>window.CannonMapTest.completeCurrentCheckpoint(false));
  const selfie=await page.locator('#rallyCameraSelfie').boundingBox(),forward=await page.locator('#rallyCameraForward').boundingBox(),modal=await page.locator('#rallyCameraWorkflow').boundingBox(),gps=await page.locator('#rallyRecenterFab').boundingBox();
  expect(selfie.width).toBeGreaterThanOrEqual(48);expect(selfie.height).toBeGreaterThanOrEqual(48);expect(forward.width).toBeGreaterThanOrEqual(48);expect(forward.height).toBeGreaterThanOrEqual(48);
  const overlaps=modal&&gps&&modal.x<gps.x+gps.width&&modal.x+modal.width>gps.x&&modal.y<gps.y+gps.height&&modal.y+modal.height>gps.y;expect(overlaps).toBe(false);
});
