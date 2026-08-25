import {test,expect} from '@playwright/test';

const metersEast=(meters,latitude=35)=>meters/(111195*Math.cos(latitude*Math.PI/180));

test('Samsung tactical rider presentation stays stable through refresh, dismissal, fan-out, and cluster selection',async({page})=>{
  await page.goto('/?e2e=trail-intel-tactical-presentation');
  await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true'&&typeof window.CannonMapTest?.competitorPresentationForTest==='function');
  const now=Date.now(),moving=Array.from({length:13},(_,index)=>({observationId:`event60-88-${index}`,lat:35,lon:-82+metersEast(index*1609.344),time:new Date(now-(12-index)*60_000).toISOString(),sessionId:'event-60-a'}));
  const normalized=await page.evaluate(timestamp=>window.CannonMapTest.normalizeCompetitorPayload({locations:[{competitor_number:88,lat:35,lon:-82,time:new Date(timestamp).toISOString()}]}),now);
  expect(normalized[0]).toMatchObject({id:'number:88',number:'88',name:'Rider 88'});
  const riders=Array.from({length:24},(_,index)=>index===0?{id:'event-60-stream-7',competitor_number:88,name:'Beau',points:moving}:{id:`event-60-stream-${index+7}`,number:200+index,name:`Rider ${200+index}`,points:[{observationId:`event60-${index}`,lat:35+index*.01,lon:-82,time:new Date(now-1000).toISOString(),sessionId:'event-60-a'}]});
  let state=await page.evaluate(value=>window.CannonMapTest.setCompetitorsForTest(value),riders);
  expect(state.riders).toHaveLength(24);expect(new Set(state.riders.map(rider=>rider.color)).size).toBe(24);
  expect(state.riders[0]).toMatchObject({id:'event-60-stream-7',number:null,label:'88'});
  expect(state.desktopRowCount).toBe(24);expect(state.mobileRowCount).toBe(24);
  if(page.viewportSize().width<=960){
    await page.locator('#rallyTrailIntelButton').click({force:true});await expect(page.locator('#intelSheet')).toHaveClass(/open/);
    const sheet=await page.locator('#intelSheet').boundingBox(),row=await page.locator('#mobileCompetitorSummary .tactical-rider-row').first().boundingBox(),viewport=page.viewportSize();
    expect(sheet).not.toBeNull();expect(row).not.toBeNull();expect(sheet.y).toBeGreaterThanOrEqual(0);expect(sheet.y+sheet.height).toBeLessThanOrEqual(viewport.height);expect(row.height).toBeGreaterThanOrEqual(48);expect(row.height).toBeLessThanOrEqual(60);
    const actions=page.locator('#intelSheet .mobile-intel-actions');await actions.scrollIntoViewIfNeeded();const scrolledSheet=await page.locator('#intelSheet').boundingBox(),actionBox=await actions.boundingBox();
    expect(actionBox).not.toBeNull();expect(actionBox.y).toBeGreaterThanOrEqual(scrolledSheet.y);expect(actionBox.y+actionBox.height).toBeLessThanOrEqual(scrolledSheet.y+scrolledSheet.height);
    await page.locator('#intelCloseButton').click();
  }
  const baselineColors=Object.fromEntries(state.riders.map(rider=>[rider.id,rider.color])),expanded=await page.evaluate(value=>window.CannonMapTest.setCompetitorsForTest(value),[{id:'000-new-rider',number:999,points:[{lat:36,lon:-83,time:new Date(now).toISOString()}]},...riders]);
  for(const rider of expanded.riders)if(baselineColors[rider.id])expect(rider.color).toBe(baselineColors[rider.id]);
  state=await page.evaluate(value=>window.CannonMapTest.setCompetitorsForTest(value),riders);for(const rider of state.riders)expect(rider.color).toBe(baselineColors[rider.id]);

  await page.evaluate(()=>window.CannonMapTest.setCompetitorZoomForTest(12));
  await page.evaluate(()=>window.CannonMapTest.selectCompetitorForTest('event-60-stream-7',true));
  await expect(page.locator('.leaflet-popup')).toContainText('Rider 88');
  await expect(page.locator('.leaflet-popup')).toContainText('3 min pace');
  await expect(page.locator('.leaflet-popup')).toContainText('15 min pace');
  state=await page.evaluate(()=>window.CannonMapTest.competitorPresentationForTest());
  expect(state.selectedRiderId).toBe('event-60-stream-7');expect(state.riders[0].markerClass).toContain('is-selected');
  expect(state.riders.slice(1).every(rider=>rider.markerClass.includes('is-dimmed'))).toBeTruthy();

  await page.evaluate(()=>window.CannonMapTest.dismissCompetitorPopupForTest());
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
  const refreshed=riders.map((rider,index)=>index?{...rider}:{...rider,points:[...rider.points,{observationId:'event60-88-refresh',lat:35,lon:-82+metersEast(13*1609.344),time:new Date(now+60_000).toISOString(),sessionId:'event-60-a'}]});
  await page.evaluate(value=>window.CannonMapTest.setCompetitorsForTest(value),refreshed);
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
  state=await page.evaluate(()=>window.CannonMapTest.competitorPresentationForTest());expect(state.selectedRiderId).toBe('event-60-stream-7');

  await page.evaluate(()=>window.CannonMapTest.clearCompetitorSelectionForTest());
  state=await page.evaluate(()=>window.CannonMapTest.competitorPresentationForTest());expect(state.selectedRiderId).toBeNull();expect(state.riders.every(rider=>!rider.markerClass.includes('is-dimmed'))).toBeTruthy();

  const overlap=[{id:'overlap-7',competitor_number:88,name:'Beau',points:[{lat:30,lon:-90,time:new Date(now).toISOString(),observationId:'overlap-a'}]},{id:'overlap-8',number:246,name:'Rider 246',points:[{lat:30,lon:-90,time:new Date(now).toISOString(),observationId:'overlap-b'}]}];
  await page.evaluate(value=>window.CannonMapTest.setCompetitorsForTest(value),overlap);
  state=await page.evaluate(()=>window.CannonMapTest.setCompetitorZoomForTest(12));
  expect(state.clusterCount).toBe(0);expect(state.riders.map(rider=>rider.displayOffset)).toEqual([{x:-24,y:0},{x:24,y:0}]);
  const repeated=await page.evaluate(()=>window.CannonMapTest.setCompetitorZoomForTest(12));expect(repeated.riders.map(rider=>rider.displayOffset)).toEqual(state.riders.map(rider=>rider.displayOffset));

  state=await page.evaluate(()=>window.CannonMapTest.setCompetitorZoomForTest(9,{x:770,y:205}));
  expect(state.clusterCount).toBe(1);expect(state.clusterRiderIds[0]).toEqual(['overlap-7','overlap-8']);expect(state.riders.every(rider=>rider.markerClass==='')).toBeTruthy();
  await page.locator('.competitor-rider-cluster').click();
  await expect(page.locator('.leaflet-popup:visible .competitor-cluster-popup')).toBeVisible();
  const movedOverlap=overlap.map((rider,index)=>({...rider,points:[...rider.points,{lat:30.00001,lon:-90.00001,time:new Date(now+1000).toISOString(),observationId:`overlap-refresh-${index}`}]}));
  await page.evaluate(value=>window.CannonMapTest.setCompetitorsForTest(value),movedOverlap);
  await expect(page.locator('.leaflet-popup:visible .competitor-cluster-popup')).toBeVisible();
  await page.evaluate(()=>window.CannonMapTest.dismissCompetitorPopupForTest());await expect(page.locator('.leaflet-popup')).toHaveCount(0);
  const dismissedRefresh=movedOverlap.map((rider,index)=>({...rider,points:[...rider.points,{lat:30.00002,lon:-90.00002,time:new Date(now+2000).toISOString(),observationId:`overlap-dismissed-${index}`}]}));
  await page.evaluate(value=>window.CannonMapTest.setCompetitorsForTest(value),dismissedRefresh);
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
  await page.locator('.competitor-rider-cluster').click();
  await page.locator('.competitor-cluster-rider[data-rider-id="overlap-7"]').click();
  state=await page.evaluate(()=>window.CannonMapTest.competitorPresentationForTest());expect(state.selectedRiderId).toBe('overlap-7');expect(state.clusterCount).toBe(0);expect(state.riders[0].markerClass).toContain('is-selected');
});

test('stationary-event popup survives a live refresh but respects explicit dismissal',async({page})=>{
  await page.goto('/?e2e=stationary-popup-dismissal');await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true'&&typeof window.CannonMapTest?.setStationaryEventsForTest==='function');
  const event={id:'stop-event-88',rallyEventId:'event-60',competitorId:'stream-88',competitorNumber:88,riderName:'Beau',signature:'#88',status:'active',startTime:'2026-08-25T12:00:00.000Z',lastUpdateTime:'2026-08-25T12:10:00.000Z',durationMs:600000,center:{lat:38.5,lon:-98.5},radiusMeters:18};
  await page.evaluate(()=>{window.CannonMapTest.setCompetitorsForTest([{id:'map-position-anchor',points:[{lat:38.5,lon:-98.5,time:new Date().toISOString()}]}]);window.CannonMapTest.setCompetitorZoomForTest(9,{x:770,y:205});window.CannonMapTest.setCompetitorsForTest([]);});
  expect(await page.evaluate(value=>window.CannonMapTest.setStationaryEventsForTest([value],'event-60'),event)).toBe(1);
  await page.locator('.stationary-event-signature').click();await expect(page.locator('.leaflet-popup:visible .stationary-event-popup')).toBeVisible();
  await page.evaluate(value=>window.CannonMapTest.setStationaryEventsForTest([{...value,durationMs:660000,lastUpdateTime:'2026-08-25T12:11:00.000Z'}],'event-60'),event);await expect(page.locator('.leaflet-popup:visible .stationary-event-popup')).toBeVisible();
  await page.evaluate(()=>window.CannonMapTest.dismissCompetitorPopupForTest());await expect(page.locator('.leaflet-popup')).toHaveCount(0);
  await page.evaluate(value=>window.CannonMapTest.setStationaryEventsForTest([{...value,durationMs:720000,lastUpdateTime:'2026-08-25T12:12:00.000Z'}],'event-60'),event);await expect(page.locator('.leaflet-popup')).toHaveCount(0);expect(await page.evaluate(()=>window.CannonMapTest.competitorPopupState())).toBeNull();
});
