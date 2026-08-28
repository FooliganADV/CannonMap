import {readFileSync} from 'node:fs';
import {test,expect} from '@playwright/test';
import {breadcrumbKey,deriveTacticalTrail,distanceMeters,pointTime} from '../../src/domain/competitors/trails.js';

const fixture=JSON.parse(readFileSync(new URL('../fixtures/trail-intel/field-replays/field-0.7.19-sanitized.json',import.meta.url),'utf8'));
const dirtyRider=fixture.competitors.find(rider=>Array.isArray(rider.points)&&rider.points.length);

test('Samsung landscape normalizes absent provider metrics and renders the 0.7.19 dirty feed without a fan or chord',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='Android landscape','Samsung production regression');
  expect(page.viewportSize()).toEqual({width:915,height:412});
  await page.goto('/?e2e=trail-intel-field-forensics');
  await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true'&&typeof window.CannonMapTest?.competitorLayerDiagnostics==='function');

  const normalized=await page.evaluate(time=>window.CannonMapTest.normalizeCompetitorPayload({competitors:[{id:'null-provider-rider',points:[{lat:35,lon:-97,time,speedMph:null,heading:null}]}]}),new Date().toISOString());
  expect(normalized).toHaveLength(1);
  expect(normalized[0].points[0]).toMatchObject({speedMph:null,heading:null});

  const sourceLast=pointTime(dirtyRider.points.at(-1)),replayLast=Date.now()-1000,offset=replayLast-sourceLast;
  const rider={...dirtyRider,points:dirtyRider.points.map(point=>({...point,time:new Date(pointTime(point)+offset).toISOString()}))};
  const tactical=deriveTacticalTrail(rider.points,{now:replayLast+1000,historyMs:8*60*60*1000});
  expect(tactical.segments).toHaveLength(1);
  expect(tactical.quarantined.length).toBeGreaterThan(0);

  await page.evaluate(value=>window.CannonMapTest.setCompetitorsForTest([value]),rider);
  const layers=await page.evaluate(()=>window.CannonMapTest.competitorLayerDiagnostics()),trails=layers.filter(layer=>layer.kind==='trail'),marker=layers.find(layer=>layer.kind==='marker');
  expect(trails).toHaveLength(1);
  expect(trails[0].pointIds).toEqual(tactical.segments[0].map(breadcrumbKey));
  expect(marker.pointIds).toEqual([breadcrumbKey(tactical.latest)]);
  for(let index=1;index<trails[0].points.length;index++){
    const prior=trails[0].points[index-1],point=trails[0].points[index],elapsedMs=pointTime(point)-pointTime(prior);
    const derivedMph=distanceMeters(prior,point)/(elapsedMs/1000)*2.236936;
    expect(elapsedMs).toBeGreaterThan(0);
    expect(derivedMph).toBeLessThanOrEqual(130);
  }
  const presentation=await page.evaluate(()=>window.CannonMapTest.competitorPresentationForTest()),row=presentation.riders.find(item=>item.id===dirtyRider.id);
  expect(row.status.speedSource).toBe('position_median');
  expect(row.status.currentSpeedMph).toBeGreaterThan(0);
  expect(row.status.headingDegrees).not.toBeNull();
});
