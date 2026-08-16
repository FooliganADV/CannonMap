import {test,expect} from '@playwright/test';

const metersEast=(meters,latitude=35)=>meters/(111195*Math.cos(latitude*Math.PI/180));

function liveRider({id,number,offsetNorthMeters=0,speedMph=30,now=Date.now()}){
  const metersPerSecond=speedMph/2.2369362920544,lat=35+offsetNorthMeters/111195;
  return {
    id:String(id),number,name:`Rider ${number}`,
    points:Array.from({length:31},(_,index)=>({
      observationId:`${number}-${index}`,
      lat,
      lon:-82+metersEast(index*metersPerSecond,lat),
      time:new Date(now-(30-index)*1000).toISOString()
    }))
  };
}

test('nearby synchronized riders keep visible identities, compact tactical rows, and independent selection',async({page},testInfo)=>{
  await page.goto('/?e2e=trail-intel-tactical-presentation');
  await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  const now=Date.now(),riders=[
    liveRider({id:'gps-stream-7',number:246,now}),
    liveRider({id:'gps-stream-8',number:299,offsetNorthMeters:45,now})
  ];
  const initial=await page.evaluate(value=>window.CannonMapTest.setCompetitorsForTest(value),riders);

  expect(initial.riders.map(rider=>[rider.id,rider.label])).toEqual([
    ['gps-stream-7','246'],['gps-stream-8','299']
  ]);
  expect(initial.riders.map(rider=>rider.markerText)).toEqual(['246','299']);
  expect(initial.desktopRowCount).toBe(2);
  expect(initial.mobileRowCount).toBe(2);
  expect(initial.clusterCount).toBe(1);
  expect(initial.riders.every(rider=>rider.renderedTrailSegments.length===1)).toBeTruthy();

  const mobileHost=page.locator('#mobileCompetitorSummary');
  await expect(mobileHost.locator('[data-rider-id="gps-stream-7"]')).toContainText('246');
  await expect(mobileHost.locator('[data-rider-id="gps-stream-8"]')).toContainText('299');
  await expect(mobileHost).not.toContainText(/breadcrumb/i);
  for(const selector of ['.tactical-rider-row__speed','.tactical-rider-row__pace','.tactical-rider-row__freshness','.tactical-rider-row__heading']){
    await expect(mobileHost.locator(`[data-rider-id="gps-stream-7"] ${selector}`)).not.toHaveText('');
  }

  const cluster=page.locator('.competitor-rider-cluster__face');
  await expect(cluster).toContainText('2');
  await cluster.click({force:true});
  const clusterPopup=page.locator('.competitor-cluster-popup');
  await expect(clusterPopup).toContainText('246');
  await expect(clusterPopup).toContainText('299');

  const usefulZoom=await page.evaluate(()=>window.CannonMapTest.setCompetitorZoomForTest(15));
  expect(usefulZoom.clusterCount).toBe(0);
  await expect(page.locator('.competitor-rider-cluster__face')).toHaveCount(0);
  const marker246=await page.locator('[aria-label="Rider 246"]').boundingBox(),marker299=await page.locator('[aria-label="Rider 299"]').boundingBox();
  expect(marker246).not.toBeNull();expect(marker299).not.toBeNull();
  const centerDistance=Math.hypot(marker246.x+marker246.width/2-marker299.x-marker299.width/2,marker246.y+marker246.height/2-marker299.y-marker299.height/2);
  expect(centerDistance).toBeGreaterThan(35);

  await mobileHost.locator('[data-rider-id="gps-stream-7"]').evaluate(button=>button.click());
  const selected=await page.evaluate(()=>window.CannonMapTest.competitorPresentationForTest());
  expect(selected.selectedRiderId).toBe('gps-stream-7');
  expect(selected.clusterCount).toBe(0);
  expect(selected.riders.find(rider=>rider.id==='gps-stream-7').markerClass).toContain('is-selected');
  expect(selected.riders.find(rider=>rider.id==='gps-stream-8').markerClass).toContain('is-dimmed');
  expect(selected.riders.find(rider=>rider.id==='gps-stream-7').trailClasses.every(value=>value.includes('is-selected'))).toBeTruthy();
  expect(selected.riders.find(rider=>rider.id==='gps-stream-8').trailClasses.every(value=>value.includes('is-dimmed'))).toBeTruthy();
  await expect(mobileHost.locator('[data-rider-id="gps-stream-7"]')).toHaveAttribute('aria-pressed','true');
  await expect(mobileHost.locator('[data-rider-view-all]')).toBeAttached();

  await mobileHost.locator('[data-rider-view-all]').evaluate(button=>button.click());
  const reset=await page.evaluate(()=>window.CannonMapTest.competitorPresentationForTest());
  expect(reset.selectedRiderId).toBeNull();
  expect(reset.riders.every(rider=>!rider.markerClass.includes('is-selected')&&!rider.markerClass.includes('is-dimmed'))).toBeTruthy();
  await expect(mobileHost.locator('[data-rider-view-all]')).toHaveCount(0);

  if(testInfo.project.name!=='desktop'){
    await page.locator('#rallyTrailIntelButton').click({force:true});
    await expect(page.locator('#intelSheet')).toHaveClass(/open/);
    const firstRow=mobileHost.locator('.tactical-rider-row').first(),rowBox=await firstRow.boundingBox(),sheetBox=await page.locator('#intelSheet').boundingBox();
    expect(rowBox).not.toBeNull();expect(sheetBox).not.toBeNull();
    expect(rowBox.height).toBeGreaterThanOrEqual(48);
    expect(rowBox.height).toBeLessThanOrEqual(60);
    expect(rowBox.x).toBeGreaterThanOrEqual(sheetBox.x);
    expect(rowBox.x+rowBox.width).toBeLessThanOrEqual(sheetBox.x+sheetBox.width+1);
    if(testInfo.project.name.includes('landscape')){
      const viewport=page.viewportSize(),closeBox=await page.locator('#intelCloseButton').boundingBox();
      expect(closeBox).not.toBeNull();
      expect(sheetBox.y).toBeGreaterThanOrEqual(0);
      expect(sheetBox.y+sheetBox.height).toBeLessThanOrEqual(viewport.height);
      expect(closeBox.y).toBeGreaterThanOrEqual(sheetBox.y);
      expect(closeBox.y+closeBox.height).toBeLessThanOrEqual(sheetBox.y+sheetBox.height);
      expect(closeBox.height).toBeGreaterThanOrEqual(44);
    }
  }

  const trustedLat=35,trustedLon=-82+metersEast(30),spikeLat=45,spikeLon=-70;
  const spikeState=await page.evaluate(value=>window.CannonMapTest.setCompetitorsForTest(value),[{
    id:'gps-stream-7',number:246,name:'Rider 246',points:[
      {observationId:'trusted-a',lat:35,lon:-82,time:new Date(now-4000).toISOString()},
      {observationId:'trusted-b',lat:trustedLat,lon:trustedLon,time:new Date(now-3000).toISOString()},
      {observationId:'spike',lat:spikeLat,lon:spikeLon,time:new Date(now-2000).toISOString()}
    ]
  }]);
  const projected=spikeState.riders[0];
  expect(projected.positionStatus).toBe('pending-corroboration');
  expect(projected.pendingObservation.observationId).toBe('spike');
  expect(projected.markerPosition.lat).toBeCloseTo(trustedLat,5);
  expect(projected.markerPosition.lon).toBeCloseTo(trustedLon,5);
  expect(projected.markerPosition.lat).not.toBeCloseTo(spikeLat,2);
  expect(projected.markerPosition.lon).not.toBeCloseTo(spikeLon,2);

  const oldTime=now-10*60*60*1000;
  await page.evaluate(value=>window.CannonMapTest.setCompetitorsForTest(value),[{
    id:'gps-stream-7',number:246,points:[{observationId:'old',lat:35,lon:-82,time:new Date(oldTime).toISOString()}]
  }]);
  const reconnect={id:'gps-stream-7',number:246,points:[{observationId:'reconnect',lat:35,lon:-81.9,time:new Date(now).toISOString()}]};
  const firstReconnect=await page.evaluate(value=>{window.CannonMapTest.mergeCompetitorData([value]);return window.CannonMapTest.competitorsForTest();},reconnect);
  const secondReconnect=await page.evaluate(value=>{window.CannonMapTest.mergeCompetitorData([value]);return window.CannonMapTest.competitorsForTest();},reconnect);
  expect(firstReconnect[0].points).toHaveLength(1);
  expect(firstReconnect[0].trailGaps).toHaveLength(1);
  expect(firstReconnect[0].trailGaps[0].durationMs).toBe(10*60*60*1000);
  expect(secondReconnect[0].trailGaps).toEqual(firstReconnect[0].trailGaps);
  await page.evaluate(()=>window.CannonMapTest.saveProjectForTest());
  await page.reload();
  await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  const restored=await page.evaluate(()=>window.CannonMapTest.competitorsForTest());
  expect(restored[0].trailGaps).toEqual(firstReconnect[0].trailGaps);
});
