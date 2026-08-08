import {test,expect} from '@playwright/test';
import path from 'node:path';

const fixture=path.resolve('tests/fixtures/rally-project.cmap');
const photoBuffer=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');

async function loadProject(page){
  await page.goto('/?e2e=1');
  await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  await page.locator('#projectInput').setInputFiles(fixture);
  await expect(page.locator('#status')).toContainText('Opened rally-project.cmap');
  await page.evaluate(()=>{const select=document.getElementById('dayFilter');select.value='1';select.dispatchEvent(new Event('change',{bubbles:true}));});
}
async function completeWithEvidence(page,name='objective.jpg'){
  const before=await page.locator('#rallyNextName').textContent();await page.locator('#rallyCompleteButton').click();
  await expect(page.locator('#rallyCameraWorkflow')).toBeVisible();await page.locator('#rallyCameraInput').setInputFiles({name,mimeType:'image/jpeg',buffer:photoBuffer});await expect(page.locator('#rallyCameraWorkflow')).toBeHidden();
  await expect.poll(async()=>await page.locator('#rallyDayComplete').isVisible()||await page.locator('#rallyNextName').textContent()!==before).toBeTruthy();
}

test('project import filters Old Coast Road and preserves nearby features',async({page})=>{
  await loadProject(page);
  await expect(page.locator('#layerList')).not.toContainText('Old Coast Road');
  await expect(page.locator('#layerList')).toContainText('Nearby Legal Road');
  const names=await page.evaluate(()=>window.CannonMapTest.sanitizeProjectData({features:[{name:'Old Coast Road'},{name:'Nearby Legal Road'}]}).features.map(f=>f.name));
  expect(names).toEqual(['Nearby Legal Road']);
  const numbered=await page.evaluate(()=>window.CannonMapTest.sanitizeProjectData({features:[{name:'1.03 Scenic Stop',type:'waypoint',geometry:{kind:'point',coordinates:[{lat:40,lon:-75}]}}]}).features[0]);
  expect(numbered).toMatchObject({type:'checkpoint',day:1,sequence:3,status:'upcoming',points:10});
  await page.evaluate(()=>{localStorage.setItem('cannonmap.snapshots.v1',JSON.stringify([{id:'blocked-restore',createdAt:new Date().toISOString(),project:{features:[{name:'Old Coast Road',type:'route',day:1,visible:true,geometry:{kind:'line',coordinates:[{lat:38,lon:-105},{lat:38.1,lon:-105.1}]}},{name:'Nearby Legal Road',type:'route',day:1,visible:true,geometry:{kind:'line',coordinates:[{lat:38,lon:-105.01},{lat:38.1,lon:-105.11}]}}],competitors:[]}}]));window.CannonMapTest.restoreSnapshot('blocked-restore');});
  await expect(page.locator('#layerList')).not.toContainText('Old Coast Road');
  await expect(page.locator('#layerList')).toContainText('Nearby Legal Road');
});

test('mileage deduplicates matching geometry but retains partial, parallel and alternative routes',async({page})=>{
  await page.goto('/?e2e=mileage');
  await page.waitForFunction(()=>Boolean(window.CannonMapTest));
  const result=await page.evaluate(()=>{
    const track=[{lat:38,lon:-105},{lat:38.05,lon:-105.05},{lat:38.1,lon:-105.1}];
    const reversed=[{lat:38.1,lon:-105.1},{lat:38.075,lon:-105.075},{lat:38.025,lon:-105.025},{lat:38,lon:-105}];
    const partial=[{lat:38,lon:-105},{lat:38.04,lon:-105.04}];
    const parallel=[{lat:38,lon:-104.996},{lat:38.1,lon:-105.096}];
    const alternative=[{lat:38,lon:-105},{lat:38.04,lon:-104.95},{lat:38.1,lon:-105.1}];
    const make=(type,coordinates)=>({type,day:1,geometry:{kind:'line',coordinates}});
    const features=[make('track',track),make('route',reversed),make('route',partial),make('route',parallel),make('route',alternative)];
    return {actual:window.CannonMapTest.planningMileage(features),expected:[track,partial,parallel,alternative].reduce((sum,line)=>sum+window.CannonMapTest.lineDistanceMiles(line),0),match:window.CannonMapTest.lineGeometriesMatch(track,reversed),parallelMatch:window.CannonMapTest.lineGeometriesMatch(track,parallel),partialMatch:window.CannonMapTest.lineGeometriesMatch(track,partial)};
  });
  expect(result.match).toBeTruthy();expect(result.parallelMatch).toBeFalsy();expect(result.partialMatch).toBeFalsy();expect(result.actual).toBeCloseTo(result.expected,5);
});

test('checkpoint defer queue, completion, scoring, mandatory hotel bailout and undo',async({page},testInfo)=>{
  test.skip(testInfo.project.name==='desktop');
  await loadProject(page);
  await expect(page.locator('#rallyNextName')).toContainText('Checkpoint One');
  await page.locator('#rallyDeferIcon').click();
  await expect(page.locator('#rallyNextName')).toContainText('Extreme Checkpoint Two');
  await completeWithEvidence(page,'extreme.jpg');
  await expect(page.locator('#rallyScore')).toHaveText('21');
  await expect(page.locator('#rallyDeferredMessage')).toContainText('1 deferred checkpoint');
  await page.locator('#rallyResumeDeferredButton').click();
  await expect(page.locator('#rallyNextName')).toContainText('Checkpoint One');
  await completeWithEvidence(page,'checkpoint-one.jpg');
  await expect(page.locator('#rallyScore')).toHaveText('31');
  await expect(page.locator('#rallyNextName')).toContainText('Hotel');
  await expect(page.locator('#rallyDeferIcon')).toBeHidden();
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#rallyMoreButton').click();
  await page.locator('#goHotelButton').click();
  await expect(page.locator('#goHotelButton')).toHaveText('UNDO HOTEL BAILOUT');
  await page.locator('#goHotelButton').click();
  await expect(page.locator('#status')).toContainText('undone');
});

test('hotel completion persists Day Complete and requires explicit next-day start',async({page},testInfo)=>{
  test.skip(testInfo.project.name==='desktop');
  await loadProject(page);
  await page.waitForTimeout(100);
  await page.reload();
  await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  await completeWithEvidence(page,'checkpoint-one.jpg');
  await completeWithEvidence(page,'checkpoint-two.jpg');
  await completeWithEvidence(page,'hotel.jpg');
  await expect(page.locator('#rallyDay')).toHaveCount(0);
  await expect(page.locator('#rallyDayComplete')).toBeVisible();
  await expect(page.locator('#rallyStartNextDay')).toHaveText('Start Day 2');
  await page.waitForFunction(async()=>{
    const events=await window.CannonMapTest.missionControlJournalEvents();
    return events.some(event=>event.eventType==='hotel_arrival');
  });
  await page.waitForTimeout(100);
  await page.reload();
  await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  await expect(page.locator('#rallyDayComplete')).toBeVisible();
  await expect(page.locator('#rallyStartNextDay')).toHaveText('Start Day 2');
  await page.locator('#rallyStartNextDay').click();
  await expect(page.locator('#rallyNextName')).toContainText('Day 2 Checkpoint');
});

test('automatic checkpoint arrival waits for CAPTURE PAIR and attaches four media references to Journal',async({page},testInfo)=>{
  test.skip(testInfo.project.name==='desktop');
  await loadProject(page);
  await page.evaluate(()=>window.CannonMapTest.completeCurrentCheckpoint(true));
  await expect(page.locator('#rallyCameraWorkflow')).toBeVisible();
  await expect(page.locator('#rallyCameraCapturePair')).toHaveText('CAPTURE PAIR');
  await expect(page.locator('#rallyCameraSelfie, #rallyCameraForward')).toHaveCount(0);
  await expect(page.locator('#rallyCameraRetry')).toBeHidden();
  await page.locator('#rallyCameraInput').setInputFiles({name:'checkpoint.jpg',mimeType:'image/jpeg',buffer:photoBuffer});
  await expect(page.locator('#rallyCameraWorkflow')).toBeHidden();
  await page.waitForFunction(async()=>{
    const events=await window.CannonMapTest.missionControlJournalEvents();
    return events.some(event=>event.eventType==='photo_added'&&event.references.pairId&&event.attachments.photos?.length===4&&event.attachments.photos.every(photo=>photo.uri?.startsWith('media://')));
  });
});

test('mobile Rally Mode controls do not overlap and meet 48px targets',async({page},testInfo)=>{
  test.skip(testInfo.project.name==='desktop');
  await page.goto('/?e2e=layout');
  await page.waitForFunction(()=>Boolean(window.CannonMapTest));
  await expect(page.locator('#rallyMode')).toBeVisible();
  await expect(page.locator('#rallyMoreSheet')).not.toBeVisible();
  const controls=page.locator('.rally-actions button:visible');
  const boxes=await controls.evaluateAll(elements=>elements.map(element=>{const r=element.getBoundingClientRect();return {id:element.id,x:r.x,y:r.y,w:r.width,h:r.height};}));
  const viewport=page.viewportSize();for(const box of boxes){expect(box.w,`${box.id} width`).toBeGreaterThanOrEqual(48);expect(box.h,`${box.id} height`).toBeGreaterThanOrEqual(48);expect(box.x,`${box.id} left edge`).toBeGreaterThanOrEqual(0);expect(box.x+box.w,`${box.id} right edge`).toBeLessThanOrEqual(viewport.width);expect(box.y+box.h,`${box.id} bottom edge`).toBeLessThanOrEqual(viewport.height);}
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j],overlap=a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;expect(overlap,`${a.id} overlaps ${b.id}`).toBeFalsy();}
  const card=page.locator('#rallyPrimaryCard, .rally-primary-card').first();
  await expect(card.locator('#rallyRiderNotesSection')).toBeHidden();
  await expect(card.locator('#rallyRouteIntelligenceSection')).toBeHidden();
  await expect(card.locator('#rallyWarningsSection')).toBeHidden();
  const cardBox=await card.evaluate(element=>{const r=element.getBoundingClientRect();return {top:r.top,bottom:r.bottom};});
  expect(cardBox.top).toBeGreaterThanOrEqual(0);expect(cardBox.bottom).toBeLessThan(viewport.height-72);
  await page.evaluate(()=>document.getElementById('intelSheet').classList.add('open'));
  await expect(page.locator('#rallyRecenterFab')).toBeHidden();
  const intelBox=await page.locator('#intelSheet').evaluate(element=>{const r=element.getBoundingClientRect();return {bottom:r.bottom};});
  const dockBox=await page.locator('.rally-actions').evaluate(element=>{const r=element.getBoundingClientRect();return {top:r.top};});
  expect(intelBox.bottom,'Intel sheet must stay above the action dock').toBeLessThanOrEqual(dockBox.top);
  await page.screenshot({path:testInfo.outputPath('rally-mode.png')});
});

test('GPX import and export remain available',async({page})=>{
  await page.goto('/?e2e=gpx');
  await page.waitForFunction(()=>Boolean(window.CannonMapTest));
  await page.locator('#gpxInput').setInputFiles(path.resolve('cannonmap-test.gpx'));
  await expect(page.locator('#importDialog')).toBeVisible();
  await page.locator('#importForm button[value="replace"]').click();
  await expect(page.locator('#status')).toContainText('GPX replace');
  const download=page.waitForEvent('download');await page.evaluate(()=>document.getElementById('exportAllButton').click());expect((await download).suggestedFilename()).toMatch(/\.gpx$/);
});

test('application shell starts offline after installation',async({page,context})=>{
  await page.goto('/?offline-install=1');await page.waitForTimeout(1200);await page.reload();
  await context.setOffline(true);await page.reload();await expect(page.locator('h1')).toHaveText('CannonMap');await context.setOffline(false);
});
