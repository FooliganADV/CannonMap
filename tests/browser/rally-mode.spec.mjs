import {test,expect} from '@playwright/test';
import path from 'node:path';

const fixture=path.resolve('tests/fixtures/rally-project.cmap');
async function mockRouting(page){await page.route('https://router.project-osrm.org/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({code:'Ok',routes:[{distance:160934.4,duration:10800,geometry:{coordinates:[[-105,38],[-104.8,38.2],[-104.5,38.5],[-104.2,38.8],[-104,39]]}}]})}));}

async function loadProject(page){
  await page.goto('/?e2e=1');
  await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  await page.locator('#projectInput').setInputFiles(fixture);
  await expect(page.locator('#status')).toContainText('Opened rally-project.cmap');
  await page.evaluate(()=>{const select=document.getElementById('dayFilter');select.value='1';select.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-tab="project"]').click();});
}

test('project import filters Old Coast Road and preserves nearby features',async({page})=>{
  await loadProject(page);
  await expect(page.locator('#layerList')).not.toContainText('Old Coast Road');
  await expect(page.locator('#layerList')).toContainText('Nearby Legal Road');
  const names=await page.evaluate(()=>window.CannonMapTest.sanitizeProjectData({features:[{name:'Old Coast Road'},{name:'Nearby Legal Road'}]}).features.map(f=>f.name));
  expect(names).toEqual(['Nearby Legal Road']);
  const numbered=await page.evaluate(()=>window.CannonMapTest.sanitizeProjectData({features:[{name:'1.03 Scenic Stop',type:'waypoint',geometry:{kind:'point',coordinates:[{lat:40,lon:-75}]}}]}).features[0]);
  expect(numbered).toMatchObject({type:'checkpoint',day:1,sequence:3,status:'planned',points:10});
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
  await page.locator('#rallyMoreButton').click();
  await page.locator('#rallyRestoreButton').click();
  await page.locator('#rallyMoreButton').click();
  await page.locator('#rallyCompleteButton').click();
  await expect(page.locator('#rallyScore')).toHaveText('10');
  await expect(page.locator('#rallyNextName')).toContainText('Extreme Checkpoint Two');
  await page.locator('#rallyCompleteButton').click();
  await expect(page.locator('#rallyScore')).toHaveText('31');
  await page.locator('#rallyMoreButton').click();
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#goHotelButton').click();
  await expect(page.locator('#goHotelButton')).toHaveText('UNDO HOTEL BAILOUT');
  await page.locator('#goHotelButton').click();
  await expect(page.locator('#status')).toContainText('undone');
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
  expect(await page.locator('#rallyPrimaryCard, .rally-primary-card').first().evaluate(element=>element.getBoundingClientRect().height)).toBeLessThan(100);
  await page.evaluate(()=>document.getElementById('intelSheet').classList.add('open'));
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

test('desktop checkpoint sequence reorders and builds a route',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop');
  await mockRouting(page);
  await loadProject(page);
  await expect(page.locator('#plannerBuilder')).toBeVisible();
  const first=page.locator('.sequence-row').filter({hasText:'Checkpoint One'});
  const second=page.locator('.sequence-row').filter({hasText:'Extreme Checkpoint Two'});
  await second.dragTo(first);
  await expect(page.locator('.sequence-row').first()).toContainText('Extreme Checkpoint Two');
  await page.locator('#buildSequenceRouteButton').click();
  await expect(page.locator('#routePairList')).toContainText('Day 1 Primary Route');
  const features=await page.evaluate(()=>window.CannonMapPlannerTest.projectFeatures());
  const route=features.find(f=>f.name==='Day 1 Primary Route');
  expect(route.geometry.coordinates).toHaveLength(5);
  expect(route.planRole).toBe('primary');
  expect(route.routingKind).toBe('calculated');
  expect(route.routingProvider).toBe('OSRM public demo');
  expect(features.find(f=>f.id==='cp2').sequence).toBe(1);
  expect(features.find(f=>f.id==='cp1').sequence).toBe(2);
  await page.screenshot({path:testInfo.outputPath('desktop-route-builder.png'),fullPage:true});
});

test('desktop route tools split join reverse duplicate and convert',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop');
  await mockRouting(page);
  await loadProject(page);
  await page.locator('#buildSequenceRouteButton').click();
  const initial=await page.evaluate(()=>window.CannonMapPlannerTest.projectFeatures().find(f=>f.name==='Day 1 Primary Route').geometry.coordinates);
  await page.locator('#reversePlannerLineButton').click();
  let current=await page.evaluate(()=>window.CannonMapPlannerTest.projectFeatures().find(f=>f.name==='Day 1 Primary Route').geometry.coordinates);
  expect(current[0]).toEqual(initial.at(-1));
  await page.selectOption('#plannerAlternativeName','Paved');
  await page.locator('#duplicateAlternativeButton').click();
  await expect(page.locator('#routePairList')).toContainText('Paved');
  await page.locator('#convertRouteTrackButton').click();
  expect((await page.evaluate(()=>window.CannonMapPlannerTest.projectFeatures())).some(f=>f.type==='track'&&f.pairId)).toBeTruthy();
  await page.locator('#splitPointIndex').fill('2');
  await page.locator('#splitPlannerLineButton').click();
  const split=await page.evaluate(()=>window.CannonMapPlannerTest.projectFeatures().filter(f=>/ A$| B$/.test(f.name)));
  expect(split.length).toBeGreaterThanOrEqual(2);
  await page.locator('#routePairList [data-planner-select]').filter({has:page.locator('strong').filter({hasText:/ A$/})}).click();
  await page.selectOption('#joinLineSelect',split.find(f=>/ B$/.test(f.name)).id);
  await page.locator('#joinPlannerLineButton').click();
  await expect(page.locator('#status')).toContainText('Joined lines');
});

test('planner validation, active-day and master GPX exports remain scoped',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop');
  await mockRouting(page);
  await loadProject(page);
  await page.locator('#buildSequenceRouteButton').click();
  const qa=await page.evaluate(()=>window.CannonMapPlannerTest.validateDayPlan(1));
  expect(qa.points).toBe(31);
  expect(qa.issues.some(i=>/Old Coast Road/i.test(i.message))).toBeFalsy();
  const dayDownload=page.waitForEvent('download');await page.locator('#exportActiveDayButton').click();const day=await dayDownload;expect(day.suggestedFilename()).toContain('day-1.gpx');
  const masterDownload=page.waitForEvent('download');await page.locator('#exportMasterPlannerButton').click();const master=await masterDownload;expect(master.suggestedFilename()).toContain('master.gpx');
});

test('planner labels a straight connection as provisional',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop');await loadProject(page);await page.locator('#buildProvisionalRouteButton').click();
  const route=await page.evaluate(()=>window.CannonMapPlannerTest.projectFeatures().find(f=>f.routingKind==='provisional'));
  expect(route.name).toContain('Provisional Connection');expect(route.geometry.coordinates).toHaveLength(4);
  await expect(page.locator('#plannerRoutingStatus')).toContainText('not a navigable road route');
  const qa=await page.evaluate(()=>window.CannonMapPlannerTest.validateDayPlan(1));expect(qa.issues.some(issue=>/provisional connection/i.test(issue.message))).toBeTruthy();
});
