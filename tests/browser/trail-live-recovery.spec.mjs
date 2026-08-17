import {test,expect} from '@playwright/test';

const project={format:'CannonMap Project',project:{projectId:'trail-live-recovery',name:'Event 60 Recovery',features:[{id:'D02-029',name:'D02-029 Ivydale New Bridge',type:'checkpoint',day:2,sequence:29,status:'active',photoRequirement:'none',visible:true,geometry:{kind:'point',coordinates:[{lat:38.5,lon:-81}]}}],competitors:[]}};

test.beforeEach(async({page})=>{
  await page.route(/gps-checkpoints-feed\.js/,route=>route.fulfill({contentType:'application/javascript',body:`
    window.GPSCheckpointsFeed={createGPSCheckpointsFeed(){const listeners=new Map();return{on(type,fn){listeners.set(type,fn);},async start(){localStorage.setItem('e2e-feed-starts',String(Number(localStorage.getItem('e2e-feed-starts')||0)+1));await listeners.get('snapshot')?.({standings:[{id:'stream-246',number:'246'}],locations:[{id:'stream-246',lat:38.5,lon:-80.99997,time:'2026-08-17T14:00:05.000Z'}]});},stop(){}};}};
  `}));
});

test('enabled live feed restores history then reconnects once without duplicate points',async({page})=>{
  await page.goto('/?e2e=trail-live-recovery');await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  await page.locator('#projectInput').setInputFiles({name:'event60.cmap',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
  await page.evaluate(()=>{document.querySelector('[data-tab="tracking"]').click();document.querySelector('#rallyEventId').value='60';document.querySelector('#saveTrackingSettings').click();});
  await page.locator('#toggleRallyPollingButton').evaluate(button=>button.click());
  await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.trailIntelStateForTest())).toMatchObject({pollingEnabled:true,live:true,eventId:'60'});
  await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.trailIntelStateForTest().competitors[0]?.points?.length)).toBe(1);
  await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true'&&window.CannonMapTest?.trailIntelStateForTest);
  await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.trailIntelStateForTest())).toMatchObject({pollingEnabled:true,live:true,eventId:'60'});
  await expect.poll(()=>page.evaluate(()=>Number(localStorage.getItem('e2e-feed-starts')))).toBe(2);
  expect(await page.evaluate(()=>window.CannonMapTest.trailIntelStateForTest().competitors[0].points.length)).toBe(1);
});

test('intentional off survives reload and keeps one compact live-feed control',async({page})=>{
  await page.goto('/?e2e=trail-live-off');await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  await expect(page.locator('#rallyLiveFeedControl')).toHaveText('OFF');
  await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  expect(await page.evaluate(()=>window.CannonMapTest.trailIntelStateForTest().pollingEnabled)).toBe(false);
  await expect(page.locator('#rallyLiveFeedControl')).toHaveText('OFF');
});
