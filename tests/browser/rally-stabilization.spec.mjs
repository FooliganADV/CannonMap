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
  await page.evaluate(()=>window.CannonMapTest.simulateManualMapPan());
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

test('stale persisted next-day state is reconciled and final day has no invalid start action',async({page},testInfo)=>{
  test.skip(testInfo.project.name==='desktop');
  const project={format:'CannonMap Project',settings:{dayFilter:'1'},project:{projectId:'22222222-2222-4222-8222-222222222222',name:'Stale next day',rallyExecution:{schemaVersion:1,days:{'1':{dayNumber:1,dayId:'day-1',status:'complete',nextDay:1,summary:{totalCollected:2,totalDeferred:0,score:10}}}},features:[
    {id:'cp-1',name:'1.1',type:'checkpoint',day:1,status:'collected',geometry:{kind:'point',coordinates:[{lat:38,lon:-105}]}},
    {id:'hotel-1',name:'1.2 Hotel',type:'hotel',day:1,status:'collected',geometry:{kind:'point',coordinates:[{lat:38.1,lon:-105.1}]}},
    {id:'cp-2',name:'2.1',type:'checkpoint',day:2,status:'upcoming',geometry:{kind:'point',coordinates:[{lat:39,lon:-104}]}},
    {id:'hotel-2',name:'2.2 Hotel',type:'hotel',day:2,status:'upcoming',geometry:{kind:'point',coordinates:[{lat:39.1,lon:-104.1}]}}
  ]}};
  await page.goto('/?e2e=stale-day');await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  await page.locator('#projectInput').setInputFiles({name:'stale.cmap',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
  await expect(page.locator('#rallyStartNextDay')).toHaveText('Start Day 2');await page.locator('#rallyStartNextDay').click();await expect(page.locator('#rallyNextName')).toHaveText('2.1');
  await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');await expect(page.locator('#rallyNextName')).toHaveText('2.1');
  await page.evaluate(async()=>{await window.CannonMapTest.completeCurrentCheckpoint(false);await window.CannonMapTest.completeCurrentCheckpoint(false);});
  await expect(page.locator('#rallyDayCompleteTitle')).toHaveText('✓ Rally Complete');await expect(page.locator('#rallyStartNextDay')).toBeHidden();
});

test('landscape Rally controls and layer control do not overlap',async({page},testInfo)=>{
  test.skip(!testInfo.project.name.toLowerCase().includes('landscape'));await load(page);
  const ids=['rallyPrimaryCard','rallyRecenterFab','rallyCompleteButton','rallyMoreButton'];
  const boxes=await page.evaluate(ids=>Object.fromEntries(ids.map(id=>{const r=document.getElementById(id).getBoundingClientRect();return [id,{left:r.left,right:r.right,top:r.top,bottom:r.bottom}];})),ids);
  const layer=await page.locator('.leaflet-control-layers').evaluate(element=>{const r=element.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};});
  const overlaps=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
  for(const [id,box] of Object.entries(boxes))expect(overlaps(box,layer),`${id} overlaps layers`).toBeFalsy();
  expect(overlaps(boxes.rallyRecenterFab,boxes.rallyMoreButton),'GPS overlaps More').toBeFalsy();
  const followBefore=await page.evaluate(()=>window.CannonMapTest.gpsFollowState()?.mode);
  await page.locator('.leaflet-control-layers-toggle').click({force:true});await expect(page.locator('.leaflet-control-layers')).toHaveClass(/leaflet-control-layers-expanded/);
  const stack=await page.evaluate(()=>({layer:Number(getComputedStyle(document.querySelector('.leaflet-top.leaflet-right')).zIndex),gps:getComputedStyle(document.getElementById('rallyRecenterFab')).visibility,hud:getComputedStyle(document.getElementById('rallyPrimaryCard')).visibility}));
  expect(stack.layer).toBeGreaterThan(1260);expect(stack.gps).toBe('hidden');expect(stack.hud).toBe('hidden');
  await page.locator('#map').click({position:{x:20,y:20}});await expect(page.locator('.leaflet-control-layers')).not.toHaveClass(/leaflet-control-layers-expanded/);
  expect(await page.evaluate(()=>window.CannonMapTest.gpsFollowState()?.mode)).toBe(followBefore);
  await page.screenshot({path:testInfo.outputPath('rally-stabilization-landscape.png')});
});
