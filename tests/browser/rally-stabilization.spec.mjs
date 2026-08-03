import {test,expect} from '@playwright/test';import path from 'node:path';
const fixture=path.resolve('tests/fixtures/two-day-stabilization.cmap');

async function load(page){
  await page.goto('/?e2e=rally-stabilization');await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  await page.locator('#projectInput').setInputFiles(fixture);await expect(page.locator('#status')).toContainText('Opened two-day-stabilization.cmap');
  await page.evaluate(()=>{const select=document.getElementById('dayFilter');select.value='1';select.dispatchEvent(new Event('change',{bubbles:true}));});
}

test('GPS follow keeps rider visible, manual pan suspends, and GPS restores follow',async({page},testInfo)=>{
  test.skip(testInfo.project.name==='desktop');
  await page.addInitScript(()=>{
    let success=null;Object.defineProperty(navigator,'geolocation',{configurable:true,value:{watchPosition(callback){success=callback;return 7;},clearWatch(){}}});
    globalThis.emitGps=(lat,lon,accuracy=8,heading=0)=>success?.({coords:{latitude:lat,longitude:lon,accuracy,altitude:100,heading},timestamp:Date.now()});
  });
  await load(page);await page.locator('#rallyRecenterFab').click();
  await page.evaluate(()=>{emitGps(38,-105,8,0);emitGps(38.002,-104.998,8,10);});
  await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.gpsFollowState()?.following)).toBe(true);
  await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.gpsMarkerBounds())).not.toBeNull();
  const position=await page.evaluate(()=>window.CannonMapTest.gpsMarkerBounds());
  const viewport=page.viewportSize();expect(position.x).toBeGreaterThan(0);expect(position.x).toBeLessThan(viewport.width);expect(position.y).toBeGreaterThan(viewport.height*.45);expect(position.y).toBeLessThan(viewport.height*.8);
  const map=page.locator('#map');const box=await map.boundingBox();await page.mouse.move(box.width*.5,box.height*.65);await page.mouse.down();await page.mouse.move(box.width*.35,box.height*.5,{steps:4});await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.gpsFollowState()?.following)).toBe(false);
  await page.locator('#rallyRecenterFab').click();await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.gpsFollowState()?.following)).toBe(true);
  await page.evaluate(()=>window.dispatchEvent(new Event('orientationchange')));await page.waitForTimeout(150);expect(await page.evaluate(()=>window.CannonMapTest.gpsFollowState()?.following)).toBe(true);
});

test('required photo gates collection, supports retry, and Journal remains idempotent',async({page},testInfo)=>{
  test.skip(testInfo.project.name==='desktop');const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));await load(page);
  await page.evaluate(()=>window.CannonMapTest.completeCurrentCheckpoint(false));
  await expect(page.locator('#rallyNextName')).toContainText('1.2 Photo');
  await page.evaluate(()=>window.CannonMapTest.completeCurrentCheckpoint(true));
  await expect(page.locator('#rallyCameraWorkflow')).toBeVisible();
  const before=await page.evaluate(()=>window.CannonMapTest.missionControlJournalEvents());
  expect(before.filter(event=>event.eventType==='checkpoint_arrival'&&event.references.checkpointId==='photo-1')).toHaveLength(1);
  await page.locator('#rallyCameraInput').dispatchEvent('cancel');await expect(page.locator('#rallyCameraRetry')).toBeVisible();
  await page.locator('#rallyCameraRetry').click();
  await page.locator('#rallyCameraInput').setInputFiles({name:'required.jpg',mimeType:'image/jpeg',buffer:Buffer.from('photo')});
  await expect(page.locator('#rallyNextName')).toContainText('1.3 Defer');
  const events=await page.evaluate(()=>window.CannonMapTest.missionControlJournalEvents());
  expect(events.filter(event=>event.eventType==='checkpoint_arrival'&&event.references.checkpointId==='photo-1')).toHaveLength(1);
  expect(events.some(event=>event.eventType==='photo_added'&&event.references.checkpointId==='photo-1')).toBeTruthy();
  expect(events.some(event=>event.eventType==='checkpoint_completed'&&event.references.checkpointId==='photo-1')).toBeTruthy();
  expect(events.some(event=>event.eventType==='photo_canceled'&&event.references.checkpointId==='photo-1')).toBeTruthy();
  expect(pageErrors).toEqual([]);
});

test('deferred resume and finish, hotel completion, reload, and explicit Day 2 start are durable',async({page},testInfo)=>{
  test.skip(testInfo.project.name==='desktop');const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));await load(page);
  await page.evaluate(async()=>{await window.CannonMapTest.completeCurrentCheckpoint(false);const projectPhoto=document.getElementById('rallyNextName').textContent;return projectPhoto;});
  await page.evaluate(async()=>{await window.CannonMapTest.completeCurrentCheckpoint(true);});
  await expect(page.locator('#rallyCameraWorkflow')).toBeVisible();
  await page.locator('#rallyCameraInput').setInputFiles({name:'required.jpg',mimeType:'image/jpeg',buffer:Buffer.from('photo')});
  await expect(page.locator('#rallyNextName')).toContainText('1.3 Defer');
  await page.locator('#rallyDeferIcon').click();await expect(page.locator('#rallyDeferredPrompt')).toBeVisible();
  await page.locator('#rallyResumeDeferredButton').click();await expect(page.locator('#rallyNextName')).toContainText('1.3 Defer');
  await page.locator('#rallyDeferIcon').click();await expect(page.locator('#rallyDeferredPrompt')).toBeVisible();
  await page.locator('#rallyFinishDayButton').click();await expect(page.locator('#rallyNextName')).toContainText('Hotel');
  await page.locator('#rallyCompleteButton').click();await expect(page.locator('#rallyDayComplete')).toBeVisible();
  await expect(page.locator('#rallyDeferredPrompt')).toBeHidden();
  await page.screenshot({path:testInfo.outputPath('rally-day-complete-portrait.png')});
  let events=await page.evaluate(()=>window.CannonMapTest.missionControlJournalEvents());
  expect(events.some(event=>event.eventType==='checkpoint_deferred')).toBeTruthy();expect(events.some(event=>event.eventType==='checkpoint_resumed')).toBeTruthy();expect(events.some(event=>event.eventType==='deferred_finish_decision')).toBeTruthy();expect(events.some(event=>event.eventType==='day_finished')).toBeTruthy();
  await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');await expect(page.locator('#rallyDayComplete')).toBeVisible();
  await expect(page.locator('#rallyStartNextDay')).toHaveText('Start Day 2');await page.locator('#rallyStartNextDay').click();await expect(page.locator('#rallyNextName')).toContainText('2.1 Normal');
  events=await page.evaluate(()=>window.CannonMapTest.missionControlJournalEvents());expect(events.filter(event=>event.eventType==='day_finished')).toHaveLength(1);expect(events.some(event=>event.eventType==='day_started'&&event.metadata.dayNumber===2)).toBeTruthy();expect(pageErrors).toEqual([]);
});

test('landscape Rally controls and layer control do not overlap',async({page},testInfo)=>{
  test.skip(!testInfo.project.name.toLowerCase().includes('landscape'));await load(page);
  const ids=['rallyPrimaryCard','rallyRecenterFab','rallyCompleteButton','rallyMoreButton'];
  const boxes=await page.evaluate(ids=>Object.fromEntries(ids.map(id=>{const r=document.getElementById(id).getBoundingClientRect();return [id,{left:r.left,right:r.right,top:r.top,bottom:r.bottom}];})),ids);
  const layer=await page.locator('.leaflet-control-layers').evaluate(element=>{const r=element.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};});
  const overlaps=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
  for(const [id,box] of Object.entries(boxes))expect(overlaps(box,layer),`${id} overlaps layers`).toBeFalsy();
  expect(overlaps(boxes.rallyRecenterFab,boxes.rallyMoreButton),'GPS overlaps More').toBeFalsy();
  await page.screenshot({path:testInfo.outputPath('rally-stabilization-landscape.png')});
});
