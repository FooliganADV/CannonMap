import {test,expect} from '@playwright/test';

const longitudeOffset=(meters,latitude=35)=>meters/(111195*Math.cos(latitude*Math.PI/180));

const targetFeature={
  id:'field-target-4.7',name:'4.7 Field Target',type:'checkpoint',day:4,status:'active',points:10,
  geometry:{kind:'point',coordinates:[{lat:35,lon:-82}]}
};

function approachingRider(now,{latestAgeMs=1000}={}){
  const distances=[700,550,400,250],ages=[latestAgeMs+45_000,latestAgeMs+30_000,latestAgeMs+15_000,latestAgeMs];
  return {
    id:'field-rider-495',competitor_number:495,name:'Field Rider 495',
    points:distances.map((distance,index)=>({
      observationId:`field-495-${now}-${index}`,sessionId:'event-60-field',lat:35,
      lon:-82-longitudeOffset(distance),time:new Date(now-ages[index]).toISOString(),speedMph:null,heading:null
    }))
  };
}

async function layoutMetrics(locator){
  return locator.evaluate(element=>{
    const rect=element.getBoundingClientRect(),children=[...element.children];
    return {
      rect:{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height},
      scrollWidth:element.scrollWidth,clientWidth:element.clientWidth,
      childOverflow:children.filter(child=>child.scrollWidth>child.clientWidth+1).map(child=>({className:child.className,text:child.textContent}))
    };
  });
}

test('Samsung landscape selected-rider target UI stays compact, cached, and honest when telemetry becomes stale',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='Android landscape','Samsung landscape is the pre-rally release gate.');
  expect(page.viewportSize()).toEqual({width:915,height:412});
  const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto('/?e2e=target-intelligence-samsung-rc');
  await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true'&&typeof window.CannonMapTest?.setTargetContextForTest==='function'&&typeof window.CannonMapTest?.competitorTargetIntelligenceMetrics==='function');

  await page.evaluate(feature=>window.CannonMapTest.setTargetContextForTest({features:[feature],dayNumber:4,eventId:'event-60-field'}),targetFeature);
  const now=Date.now(),rider=approachingRider(now);
  await page.evaluate(value=>window.CannonMapTest.setCompetitorsForTest([value]),rider);
  await page.evaluate(()=>window.CannonMapTest.setCompetitorZoomForTest(12,{x:458,y:250}));
  await page.evaluate(()=>window.CannonMapTest.selectCompetitorForTest('field-rider-495',true));

  const popup=page.locator('.leaflet-popup:visible .competitor-tactical-popup'),target=popup.locator('.tactical-target-summary');
  await expect(popup).toBeVisible();await expect(target).toBeVisible();
  await expect(target).toContainText('TARGET');await expect(target).toContainText('CP 4.7');await expect(target).toContainText('APPROACHING');
  const tactical=await page.evaluate(()=>window.CannonMapTest.targetIntelligenceForTest('field-rider-495'));
  expect(tactical).toMatchObject({state:'APPROACHING',targetId:'field-target-4.7',targetLabel:'CP 4.7'});
  expect(tactical.latestDistanceMeters).toBeGreaterThan(200);expect(tactical.latestDistanceMeters).toBeLessThan(300);

  const popupLayout=await layoutMetrics(target),viewport=page.viewportSize();
  expect(popupLayout.rect.left).toBeGreaterThanOrEqual(0);expect(popupLayout.rect.right).toBeLessThanOrEqual(viewport.width);
  expect(popupLayout.rect.top).toBeGreaterThanOrEqual(0);expect(popupLayout.rect.bottom).toBeLessThanOrEqual(viewport.height);
  expect(popupLayout.scrollWidth).toBeLessThanOrEqual(popupLayout.clientWidth+1);expect(popupLayout.childOverflow).toEqual([]);
  expect(popupLayout.rect.height).toBeLessThanOrEqual(80);

  const metricsBefore=await page.evaluate(()=>window.CannonMapTest.competitorTargetIntelligenceMetrics());
  const reuse=await page.evaluate(()=>{
    const states=[];for(let index=0;index<3;index++)states.push(window.CannonMapTest.targetIntelligenceForTest('field-rider-495').state);
    return {states,metrics:window.CannonMapTest.competitorTargetIntelligenceMetrics()};
  });
  expect(reuse.states).toEqual(['APPROACHING','APPROACHING','APPROACHING']);
  expect(reuse.metrics.hits-metricsBefore.hits).toBeGreaterThanOrEqual(3);expect(reuse.metrics.misses).toBe(metricsBefore.misses);
  await testInfo.attach('target-intelligence-915x412',{body:await page.screenshot(),contentType:'image/png'});

  await page.evaluate(()=>window.CannonMapTest.dismissCompetitorPopupForTest());await expect(page.locator('.leaflet-popup')).toHaveCount(0);
  await page.locator('#rallyTrailIntelButton').click({force:true});await expect(page.locator('#intelSheet')).toHaveClass(/open/);
  const selectedSummary=page.locator('#mobileCompetitorSummary .tactical-target-summary');await expect(selectedSummary).toBeVisible();await expect(selectedSummary).toContainText('APPROACHING');
  const sheetLayout=await layoutMetrics(selectedSummary);expect(sheetLayout.scrollWidth).toBeLessThanOrEqual(sheetLayout.clientWidth+1);expect(sheetLayout.childOverflow).toEqual([]);expect(sheetLayout.rect.height).toBeLessThanOrEqual(56);

  const stale=approachingRider(now,{latestAgeMs:5*60_000});
  await page.evaluate(value=>window.CannonMapTest.setCompetitorsForTest([value]),stale);
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
  const stalePresentation=await page.evaluate(()=>({state:window.CannonMapTest.competitorPresentationForTest(),target:window.CannonMapTest.targetIntelligenceForTest('field-rider-495')}));
  expect(stalePresentation.state.selectedRiderId).toBe('field-rider-495');expect(stalePresentation.state.popup).toBeNull();
  expect(stalePresentation.target).toMatchObject({state:'UNKNOWN',reason:'stale-telemetry'});
  await expect(selectedSummary).toContainText('TARGET');await expect(selectedSummary).toContainText('UNKNOWN');await expect(selectedSummary).not.toContainText('APPROACHING');
  expect(pageErrors).toEqual([]);
});
