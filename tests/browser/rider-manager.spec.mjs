import {expect,test} from '@playwright/test';

const riders=()=>[
  {id:'7',number:17,name:'Alex Rider',team:'North Team',score:42,rank:1,points:[
    {lat:38,lon:-105,time:new Date(Date.now()-60000).toISOString()},
    {lat:38.001,lon:-105.001,time:new Date().toISOString()}
  ]},
  {id:'8',number:28,name:'Sam Rider',vehicle:'KTM 890',score:30,rank:2,points:[
    {lat:38.01,lon:-105.01,time:new Date().toISOString()}
  ]}
];

test.beforeEach(async({page})=>{
  await page.goto('/');
  await page.evaluate(()=>localStorage.removeItem('cannonmap.riderPreferences.v1'));
  await page.reload();
  await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true'&&Boolean(window.CannonMapTest));
  await page.evaluate(data=>window.CannonMapTest.setTestCompetitors(data,'60'),riders());
});

test('Rider Manager opens and closes without changing feed listener state',async({page,isMobile})=>{
  const before=await page.evaluate(()=>window.CannonMapTest.riderManagerTestState().liveFeedActive);
  if(isMobile){await page.locator('#rallyMoreButton').click();await page.locator('#rallyRidersButton').click();}
  else {await page.locator('[data-tab="tracking"]').click();await page.getByText('Competitor trail display',{exact:true}).click();await page.locator('#openRiderManagerButton').click();}
  await expect(page.locator('#riderManager')).toBeVisible();
  for(let index=0;index<3;index++){await page.locator('#riderManagerClose').click();await page.evaluate(()=>window.CannonMapTest.setRiderManagerOpen(true));}
  await page.locator('#riderManagerClose').click();
  await expect(page.locator('#riderManager')).not.toBeVisible();
  expect(await page.evaluate(()=>window.CannonMapTest.riderManagerTestState().liveFeedActive)).toBe(before);
});

test('mobile and desktop layouts retain glove-friendly controls',async({page})=>{
  await page.setViewportSize({width:430,height:932});
  await page.evaluate(()=>window.CannonMapTest.setRiderManagerOpen(true));
  const panel=await page.locator('#riderManager').boundingBox();
  const controls=await page.locator('#riderManager button, #riderManager label').evaluateAll(elements=>elements.map(element=>element.getBoundingClientRect().height));
  expect(panel.width).toBeLessThanOrEqual(430);
  expect(panel.y+panel.height).toBeLessThanOrEqual(932);
  expect(Math.min(...controls)).toBeGreaterThanOrEqual(48);
});

test('marker and breadcrumb controls update rendered rider layers immediately',async({page})=>{
  await page.evaluate(()=>window.CannonMapTest.setRiderManagerOpen(true));
  await page.locator('[data-rider-id="7"][data-rider-pref="markerVisible"]').uncheck();
  await page.locator('[data-rider-id="7"][data-rider-pref="breadcrumbVisible"]').check();
  const layers=await page.evaluate(()=>window.CannonMapTest.riderManagerTestState().layers['7']);
  expect(layers).toEqual({marker:false,breadcrumb:true});
});

test('settings persist after reload',async({page})=>{
  await page.evaluate(()=>window.CannonMapTest.setRiderManagerOpen(true));
  await page.locator('[data-rider-id="7"][data-rider-pref="markerVisible"]').uncheck();
  await page.reload();
  await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  await page.evaluate(data=>{window.CannonMapTest.setTestCompetitors(data,'60');window.CannonMapTest.setRiderManagerOpen(true);},riders());
  await expect(page.locator('[data-rider-id="7"][data-rider-pref="markerVisible"]')).not.toBeChecked();
});

test('event switching restores event-specific preferences',async({page})=>{
  await page.evaluate(()=>window.CannonMapTest.setRiderManagerOpen(true));
  await page.locator('[data-rider-id="7"][data-rider-pref="markerVisible"]').uncheck();
  await page.evaluate(data=>window.CannonMapTest.setTestCompetitors(data,'61'),riders());
  await expect(page.locator('[data-rider-id="7"][data-rider-pref="markerVisible"]')).toBeChecked();
  await page.evaluate(data=>window.CannonMapTest.setTestCompetitors(data,'60'),riders());
  await expect(page.locator('[data-rider-id="7"][data-rider-pref="markerVisible"]')).not.toBeChecked();
});

test('bulk trail actions preserve markers and show only selected riders',async({page})=>{
  await page.evaluate(()=>window.CannonMapTest.setRiderManagerOpen(true));
  await page.locator('[data-rider-id="7"][data-rider-pref="breadcrumbVisible"]').check();
  await page.locator('[data-rider-id="8"][data-rider-pref="breadcrumbVisible"]').check();
  await page.locator('[data-rider-select="7"]').click();
  await page.locator('#riderHideAllTrails').click();
  expect(await page.evaluate(()=>window.CannonMapTest.riderManagerTestState().layers['7'])).toEqual({marker:true,breadcrumb:false});
  await page.locator('#riderSelectedTrails').click();
  const state=await page.evaluate(()=>window.CannonMapTest.riderManagerTestState());
  expect(state.layers['7']).toEqual({marker:true,breadcrumb:true});
  expect(state.layers['8']).toEqual({marker:true,breadcrumb:false});
});

test('stationary-event rendering remains functional',async({page})=>{
  const now=Date.now();
  const stationary=[{id:'7',number:17,name:'Alex Rider',points:[0,1,2,3].map(minutes=>({lat:38+minutes/1000000,lon:-105,time:new Date(now-(3-minutes)*60000).toISOString()}))}];
  const count=await page.evaluate(data=>{
    window.CannonMapTest.setTestCompetitors(data,'60');
    window.CannonMapTest.updateStationaryDetection();
    window.CannonMapTest.renderStationaryEvents();
    return window.CannonMapTest.riderManagerTestState().stationaryLayerCount;
  },stationary);
  expect(count).toBeGreaterThan(0);
});
