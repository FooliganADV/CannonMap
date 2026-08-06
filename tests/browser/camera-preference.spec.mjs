import {test,expect} from '@playwright/test';

test('Selfie is default, Forward persists through reload and PWA restart, and both capture workflows share it',async({page,context},testInfo)=>{
  test.skip(!testInfo.project.name.startsWith('iPhone 13'),'Mission Control camera controls are a mobile workflow.');
  await page.goto('/?e2e=camera-preference');await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  const project={format:'CannonMap Project',project:{projectId:'camera-project',name:'Camera Test',features:[{id:'cp',name:'1.1 Camera',type:'checkpoint',day:1,sequence:1,status:'planned',visible:true,geometry:{kind:'point',coordinates:[{lat:30,lon:-90}]}}],competitors:[]}};
  await page.locator('#projectInput').setInputFiles({name:'camera.cmap',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
  await expect(page.locator('#rallyCameraInput')).toHaveAttribute('accept','image/*');
  await expect(page.locator('#rallyCameraInput')).toHaveAttribute('capture','user');
  await expect(page.locator('#rallyJourneyPhotoInput')).toHaveAttribute('capture','user');
  await page.locator('#rallyMoreButton').click();await page.locator('.rally-camera-settings summary').click();await page.locator('#rallyPreferredCameraForward').click();
  await expect(page.locator('#rallyCameraInput')).toHaveAttribute('capture','environment');
  await expect(page.locator('#rallyJourneyPhotoInput')).toHaveAttribute('capture','environment');
  await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  await expect(page.locator('#rallyCameraInput')).toHaveAttribute('capture','environment');
  await expect(page.locator('#rallyPreferredCameraForward')).toHaveClass(/is-active/);
  await page.close();const restarted=await context.newPage();await restarted.goto('/?e2e=camera-preference-pwa-restart');await restarted.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  await expect(restarted.locator('#rallyCameraInput')).toHaveAttribute('capture','environment');await expect(restarted.locator('#rallyJourneyPhotoInput')).toHaveAttribute('capture','environment');
});

test('saved preference drives checkpoint and hotel capture while Journal camera metadata stays explicit',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='iPhone 13 portrait','Durable Mission Control workflow is covered once on the primary field viewport.');
  const photo=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
  await page.goto('/?e2e=camera-objectives');await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  const point=(id,name,type,sequence)=>({id,name,type,day:1,sequence,status:'planned',photoRequirement:'required',visible:true,geometry:{kind:'point',coordinates:[{lat:30+sequence/100,lon:-90}]}}),project={format:'CannonMap Project',project:{projectId:'camera-objectives',name:'Camera Objectives',features:[point('cp','1.1 Selfie','checkpoint',1),point('hotel','1.2 Hotel','hotel',2)],competitors:[]}};
  await page.locator('#projectInput').setInputFiles({name:'camera-objectives.cmap',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});await page.locator('#rallyMoreButton').click();await page.locator('.rally-camera-settings summary').click();await page.locator('#rallyPreferredCameraForward').click();await page.locator('#rallyMoreButton').click();
  await page.evaluate(()=>window.CannonMapTest.completeCurrentCheckpoint(false));await expect(page.locator('#rallyCameraInput')).toHaveAttribute('capture','environment');await page.locator('#rallyCameraInput').setInputFiles({name:'checkpoint.png',mimeType:'image/png',buffer:photo});
  await expect(page.locator('#rallyNextName')).toContainText('Hotel');await page.evaluate(()=>window.CannonMapTest.completeCurrentCheckpoint(false));await expect(page.locator('#rallyCameraInput')).toHaveAttribute('capture','environment');await page.locator('#rallyCameraInput').setInputFiles({name:'hotel.png',mimeType:'image/png',buffer:photo});await page.waitForFunction(async()=>{const events=await window.CannonMapTest.missionControlJournalEvents();return events.filter(event=>event.eventType==='photo_added').length===2;});
  const events=await page.evaluate(()=>window.CannonMapTest.missionControlJournalEvents()),photos=events.filter(event=>event.eventType==='photo_added');expect(photos.map(event=>event.metadata.objectiveType)).toEqual(['checkpoint','hotel']);for(const event of photos){expect(event.metadata).toMatchObject({requestedCamera:'rear',actualCamera:'unknown',cameraSelectionHonored:'unknown',captureMethod:'file-input'});expect(event.metadata.captureTimestamp).toBeTruthy();}
});
