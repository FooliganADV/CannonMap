import {test,expect} from '@playwright/test';

test('map marker ignores one impossible point and confirmed relocation renders as a separate segment',async({page})=>{
  await page.goto('/?e2e=competitor-render-validation');
  await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true'&&typeof window.CannonMapTest?.competitorLayerDiagnostics==='function');
  const now=Date.now(),base=[
    {lat:30,lon:-90,time:new Date(now-180_000).toISOString(),observationId:'good-1',sessionId:'feed-a'},
    {lat:30.001,lon:-90,time:new Date(now-120_000).toISOString(),observationId:'good-2',sessionId:'feed-a'},
    {lat:40,lon:-80,time:new Date(now-60_000).toISOString(),observationId:'jump-1',sessionId:'feed-a'}
  ];

  await page.evaluate(points=>window.CannonMapTest.setCompetitorsForTest([{id:'246',name:'Rider 246',points}]),base);
  let layers=await page.evaluate(()=>window.CannonMapTest.competitorLayerDiagnostics()),marker=layers.find(layer=>layer.kind==='marker'),trails=layers.filter(layer=>layer.kind==='trail');
  expect(marker.pointIds).toEqual(['good-2']);
  expect(marker.points[0]).toMatchObject({lat:30.001,lon:-90});
  expect(trails).toHaveLength(1);
  expect(trails[0].pointIds).toEqual(['good-1','good-2']);
  expect(layers.flatMap(layer=>layer.pointIds)).not.toContain('jump-1');
  const cache=await page.evaluate(()=>{const original=Date.now,fixed=original();Date.now=()=>fixed;try{window.CannonMapTest.renderMapFeatures();const before=window.CannonMapTest.competitorTacticalProjectionMetrics();window.CannonMapTest.renderMapFeatures();return {before,after:window.CannonMapTest.competitorTacticalProjectionMetrics()};}finally{Date.now=original;}});
  expect(cache.after.hits).toBeGreaterThan(cache.before.hits);
  expect(cache.after.misses).toBe(cache.before.misses);
  expect(cache.after.compactions).toBe(cache.before.compactions);
  await page.evaluate(()=>window.CannonMapTest.followCompetitorForTest('246'));
  let view=await page.evaluate(()=>window.CannonMapTest.mapViewForTest());
  expect(view.center.lat).toBeCloseTo(30.001,4);
  await page.evaluate(()=>window.CannonMapTest.zoomCompetitorForTest('246'));
  view=await page.evaluate(()=>window.CannonMapTest.mapViewForTest());
  expect(view.center.lat).toBeLessThan(31);

  const confirmed=[...base,{lat:40.001,lon:-80,time:new Date(now-30_000).toISOString(),observationId:'jump-2',sessionId:'feed-a'}];
  await page.evaluate(points=>window.CannonMapTest.setCompetitorsForTest([{id:'246',name:'Rider 246',points}]),confirmed);
  layers=await page.evaluate(()=>window.CannonMapTest.competitorLayerDiagnostics());marker=layers.find(layer=>layer.kind==='marker');trails=layers.filter(layer=>layer.kind==='trail');
  expect(marker.pointIds).toEqual(['jump-2']);
  expect(trails).toHaveLength(2);
  expect(trails.map(layer=>layer.pointIds)).toEqual([['good-1','good-2'],['jump-1','jump-2']]);
  expect(trails.every(layer=>!(layer.pointIds.includes('good-2')&&layer.pointIds.includes('jump-1')))).toBe(true);
});
