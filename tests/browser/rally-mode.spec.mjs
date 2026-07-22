import {test,expect} from '@playwright/test';
import path from 'node:path';

const fixture=path.resolve('tests/fixtures/rally-project.cmap');

async function loadProject(page){
  await page.goto('/?e2e=1');
  await page.waitForFunction(()=>Boolean(window.CannonMapTest));
  await page.locator('#projectInput').setInputFiles(fixture);
  await expect(page.locator('#status')).toContainText('Opened rally-project.cmap');
  await page.evaluate(()=>{const select=document.getElementById('dayFilter');select.value='1';select.dispatchEvent(new Event('change',{bubbles:true}));});
}

test('project import filters Old Coast Road and preserves nearby features',async({page})=>{
  await loadProject(page);
  await expect(page.locator('#layerList')).not.toContainText('Old Coast Road');
  await expect(page.locator('#layerList')).toContainText('Nearby Legal Road');
  const names=await page.evaluate(()=>window.CannonMapTest.sanitizeProjectData({features:[{name:'Old Coast Road'},{name:'Nearby Legal Road'}]}).features.map(f=>f.name));
  expect(names).toEqual(['Nearby Legal Road']);
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

test('checkpoint defer, restore, complete, scoring, hotel bailout and undo',async({page},testInfo)=>{
  test.skip(testInfo.project.name==='desktop');
  await loadProject(page);
  await page.locator('#rallyNextButton').click();
  await expect(page.locator('#rallyNextName')).toContainText('Checkpoint One');
  await page.locator('#rallyDeferButton').click();
  await expect(page.locator('#rallyNextName')).toContainText('Extreme Checkpoint Two');
  await page.locator('#rallyRestoreButton').click();
  await page.locator('#rallyCompleteButton').click();
  await expect(page.locator('#rallyScore')).toHaveText('10');
  await page.locator('#rallyNextButton').click();await page.locator('#rallyCompleteButton').click();
  await expect(page.locator('#rallyScore')).toHaveText('31');
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#goHotelButton').click();
  await expect(page.locator('#goHotelButton')).toHaveText('UNDO HOTEL BAILOUT');
  await page.locator('#goHotelButton').click();
  await expect(page.locator('#status')).toContainText('undone');
});

test('mobile Rally Mode controls do not overlap and meet 48px targets',async({page},testInfo)=>{
  test.skip(testInfo.project.name==='desktop');
  await loadProject(page);
  await expect(page.locator('#rallyMode')).toBeVisible();
  const controls=page.locator('.rally-actions button, .rally-checkpoint-actions button, #goHotelButton');
  const boxes=await controls.evaluateAll(elements=>elements.map(element=>{const r=element.getBoundingClientRect();return {id:element.id,x:r.x,y:r.y,w:r.width,h:r.height};}));
  for(const box of boxes){expect(box.w,`${box.id} width`).toBeGreaterThanOrEqual(48);expect(box.h,`${box.id} height`).toBeGreaterThanOrEqual(48);}
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j],overlap=a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;expect(overlap,`${a.id} overlaps ${b.id}`).toBeFalsy();}
  await page.screenshot({path:`test-results/${testInfo.project.name.replaceAll(' ','-')}-rally-mode.png`});
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
