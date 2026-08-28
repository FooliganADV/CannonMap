import test from 'node:test';import assert from 'node:assert/strict';
import {stableCompetitorId,breadcrumbKey,normalizeTrailPoints,deriveTacticalTrail,compactTrailForRender,mergeTrailPoints,segmentTrail,trailStatus,mergeCompetitorSnapshots,buildTacticalClusters} from '../src/domain/competitors/trails.js';
const now=Date.parse('2026-08-04T18:00:00Z'),p=(minute,lat=30,lon=-90,extra={})=>({lat,lon,time:new Date(now+minute*60000).toISOString(),...extra});
const metersNorth=meters=>meters/111_195;
const metersEast=meters=>meters/(111_195*Math.cos(30*Math.PI/180));
const timedPoint=(offsetMs,{north=0,east=0,id})=>({lat:30+metersNorth(north),lon:-90+metersEast(east),time:new Date(now-10_000+offsetMs).toISOString(),observationId:id});
test('stable identities prevent cross-rider connections',()=>{assert.equal(stableCompetitorId({competitorId:7}),stableCompetitorId({id_competitor:7}));const result=mergeCompetitorSnapshots([],[{id:'7',points:[p(-2)]},{id:'8',points:[p(-1,31)]}],{now});assert.equal(result.competitors.length,2);assert.deepEqual(result.competitors.map(r=>r.points.length),[1,1]);});
test('out-of-order points sort and duplicates disappear deterministically',()=>{const points=normalizeTrailPoints([p(-1),p(-3),p(-1)],{now});assert.equal(points.length,2);assert.ok(Date.parse(points[0].time)<Date.parse(points[1].time));});
test('sessions, time gaps, and impossible jumps create separate segments',()=>{assert.equal(segmentTrail([p(-10,30,-90,{sessionId:'a'}),p(-9,30.001,-90,{sessionId:'a'}),p(-8,30.002,-90,{sessionId:'b'})],{now}).length,2);assert.equal(segmentTrail([p(-60),p(-20,30.001)],{now}).length,2);assert.equal(segmentTrail([p(-2),p(-1,40,-80)],{now}).length,2);});
test('repeated polling is idempotent and history remains bounded',()=>{let competitors=[];for(let poll=0;poll<20;poll++)competitors=mergeCompetitorSnapshots(competitors,[{id:'7',points:Array.from({length:1000},(_,i)=>p(-i/10,30+i/1e6,-90))}],{now,maxPoints:500}).competitors;assert.equal(competitors.length,1);assert.equal(competitors[0].points.length,500);});
test('freshness, motion, speed, and direction are evidence based',()=>{const live=trailStatus([p(-2),p(-1,30.01,-90)],{now});assert.equal(live.status,'live');assert.equal(live.motion,'moving');assert.ok(Number.isFinite(live.speedMph));const undated=trailStatus([],{now});assert.deepEqual([undated.status,undated.speedMph,undated.direction],['offline',null,null]);});
test('tactical clusters contain only nearby live riders',()=>{const clusters=buildTacticalClusters([{id:'7',name:'A',points:[p(-1,30,-90)]},{id:'8',name:'B',points:[p(-1,30.0005,-90)]},{id:'9',name:'C',points:[p(-1,31,-90)]}],{now});assert.equal(clusters.length,1);assert.deepEqual(clusters[0].riders.map(r=>r.id),['7','8']);});
test('incremental merge accepts out-of-order history without duplicating or reordering',()=>{const existing=normalizeTrailPoints([p(-3),p(-1)],{now}),result=mergeTrailPoints(existing,[p(-2),p(-1)],{now,maxPoints:20});assert.equal(result.added,1);assert.deepEqual(result.points.map(point=>point.time),[p(-3).time,p(-2).time,p(-1).time]);});
test('incremental append deduplicates a stable observation id even if a replay changes its timestamp',()=>{const original={...p(-2),observationId:'gps-246-42'},replayed={...p(-1),observationId:'gps-246-42'},result=mergeTrailPoints(normalizeTrailPoints([original],{now}),[replayed],{now,maxPoints:20});assert.equal(result.added,0);assert.equal(result.points.length,1);assert.equal(result.points[0].time,original.time);});
test('twelve hours of one-second snapshots remain bounded and idempotent',()=>{const start=Date.parse('2026-08-20T06:00:00Z');let competitors=[];for(let second=0;second<12*60*60;second++){const timestamp=start+second*1000,point={lat:30+second/10_000_000,lon:-90,time:new Date(timestamp).toISOString(),observationId:`obs-${second}`};competitors=mergeCompetitorSnapshots(competitors,[{id:'246',points:[point,point]}],{now:timestamp,historyMs:12*60*60_000,maxPoints:12_000,trimBatchPoints:256}).competitors;if(second===6*60*60)competitors=JSON.parse(JSON.stringify(competitors));}const points=competitors[0].points;assert.ok(points.length<=12_000);assert.ok(points.length>=11_700);assert.equal(points.at(-1).observationId,`obs-${12*60*60-1}`);assert.equal(new Set(points.map(breadcrumbKey)).size,points.length);});
test('map rendering keeps recent tactical points dense while bounding long trail geometry',()=>{const points=Array.from({length:12_000},(_,index)=>({lat:30+index/1e6,lon:-90,time:new Date(now-(11_999-index)*1000).toISOString(),observationId:`render-${index}`})),rendered=compactTrailForRender(points,{now,historyMs:12*60*60_000,maxRenderPoints:720,recentMs:5*60_000,maxRecentPoints:360});assert.ok(rendered.length<=720);assert.equal(rendered.at(-1).observationId,'render-11999');assert.ok(rendered.filter(point=>Date.parse(point.time)>=now-5*60_000).length>=300);assert.equal(points.length,12_000);});
test('a lone impossible jump is quarantined without mutating raw history or teleporting the tactical marker',()=>{const raw=[p(-2,30,-90,{observationId:'good'}),p(-1,40,-80,{observationId:'jump'})],before=structuredClone(raw),tactical=deriveTacticalTrail(raw,{now});assert.deepEqual(raw,before);assert.equal(tactical.points.length,1);assert.equal(tactical.latest.observationId,'good');assert.equal(tactical.pending?.point.observationId,'jump');assert.equal(tactical.quarantined.at(-1).reason,'implausible_jump');});
test('a corroborating next observation confirms a genuine relocation as a new segment',()=>{const raw=[p(-3,30,-90,{observationId:'old'}),p(-2,40,-80,{observationId:'relocated-1'}),p(-1,40.001,-80,{observationId:'relocated-2'})],tactical=deriveTacticalTrail(raw,{now});assert.equal(tactical.pending,null);assert.deepEqual(tactical.segments.map(segment=>segment.map(point=>point.observationId)),[['old'],['relocated-1','relocated-2']]);assert.equal(tactical.latest.observationId,'relocated-2');});
test('a millisecond same-position copy cannot independently corroborate an impossible relocation',()=>{
  const raw=[
    {lat:34.9582284,lon:-97.36892679,time:new Date(now-5000).toISOString(),observationId:'legitimate-before'},
    {lat:34.9616049,lon:-97.3812019,time:new Date(now-2603).toISOString(),observationId:'divergent-candidate'},
    {lat:34.9616049,lon:-97.3812019,time:new Date(now-2601).toISOString(),observationId:'millisecond-copy'},
    {lat:34.95972818,lon:-97.36910448,time:new Date(now-7).toISOString(),observationId:'legitimate-after'}
  ],tactical=deriveTacticalTrail(raw,{now});
  assert.equal(tactical.segments.length,1);
  assert.deepEqual(tactical.points.map(point=>point.observationId),['legitimate-before','legitimate-after']);
  assert.equal(tactical.latest.observationId,'legitimate-after');
  assert.deepEqual(tactical.quarantined.map(row=>row.point.observationId).sort(),['divergent-candidate','millisecond-copy']);
  assert.equal(tactical.quarantined.find(row=>row.point.observationId==='millisecond-copy')?.reason,'near_duplicate_corroboration');
});
test('a later independent 966ms stationary fix can corroborate a genuine relocation',()=>{
  const raw=[
    {lat:30,lon:-90,time:new Date(now-5000).toISOString(),observationId:'old-location'},
    {lat:40,lon:-80,time:new Date(now-4000).toISOString(),observationId:'relocated-first'},
    {lat:40,lon:-80,time:new Date(now-3998).toISOString(),observationId:'relocated-copy'},
    {lat:40,lon:-80,time:new Date(now-3034).toISOString(),observationId:'relocated-independent'}
  ],tactical=deriveTacticalTrail(raw,{now});
  assert.equal(tactical.pending,null);
  assert.deepEqual(tactical.segments.map(segment=>segment.map(point=>point.observationId)),[['old-location'],['relocated-first','relocated-independent']]);
  assert.equal(tactical.latest.observationId,'relocated-independent');
  assert.equal(tactical.quarantined.find(row=>row.point.observationId==='relocated-copy')?.reason,'near_duplicate_corroboration');
});
test('a plausible isolated trajectory spike is removed after consistent surrounding fixes',()=>{
  const raw=[
    timedPoint(0,{east:0,id:'trajectory-a'}),
    timedPoint(1000,{north:50,east:12.5,id:'trajectory-spike'}),
    timedPoint(2000,{east:25,id:'trajectory-c'}),
    timedPoint(3000,{east:50,id:'trajectory-d'})
  ],tactical=deriveTacticalTrail(raw,{now});
  assert.equal(tactical.segments.length,1);
  assert.deepEqual(tactical.points.map(point=>point.observationId),['trajectory-a','trajectory-c','trajectory-d']);
  assert.equal(tactical.quarantined.find(row=>row.point.observationId==='trajectory-spike')?.reason,'corroborated_trajectory_spike');
});
test('an isolated stopped-position spike cannot fabricate movement or heading',()=>{
  const raw=[
    timedPoint(0,{id:'stopped-a'}),
    timedPoint(1000,{north:25,id:'stopped-spike'}),
    timedPoint(2000,{id:'stopped-c'}),
    timedPoint(3000,{id:'stopped-d'})
  ],tactical=deriveTacticalTrail(raw,{now}),status=trailStatus(raw,{now,tacticalTrail:tactical});
  assert.deepEqual(tactical.points.map(point=>point.observationId),['stopped-a','stopped-c','stopped-d']);
  assert.equal(tactical.quarantined.find(row=>row.point.observationId==='stopped-spike')?.reason,'corroborated_trajectory_spike');
  assert.equal(status.motion,'stationary');
  assert.equal(status.speedMph,0);
  assert.equal(status.headingDegrees,null);
});
test('a legitimate high-speed bend remains in the accepted geometry',()=>{
  const raw=[
    timedPoint(0,{id:'bend-a'}),
    timedPoint(2000,{east:100,id:'bend-b'}),
    timedPoint(4000,{north:100,east:100,id:'bend-c'}),
    timedPoint(6000,{north:200,east:100,id:'bend-d'})
  ],tactical=deriveTacticalTrail(raw,{now});
  assert.equal(tactical.segments.length,1);
  assert.deepEqual(tactical.points.map(point=>point.observationId),['bend-a','bend-b','bend-c','bend-d']);
  assert.equal(tactical.quarantined.some(row=>row.reason==='corroborated_trajectory_spike'),false);
});
test('a lone large relocation after a gap or session change cannot teleport the tactical marker',()=>{const cases=[[p(-5,30,-90,{observationId:'before-gap'}),p(-1,40,-80,{observationId:'after-gap'})],[p(-2,30,-90,{observationId:'session-a',sessionId:'a'}),p(-1,40,-80,{observationId:'session-b',sessionId:'b'})]];for(const raw of cases){const tactical=deriveTacticalTrail(raw,{now});assert.equal(tactical.latest.observationId,raw[0].observationId);assert.equal(tactical.pending?.reason,'unconfirmed_relocation');assert.equal(tactical.quarantined.length,1);}});
test('a sub-25km but physically impossible boundary fix is quarantined without contributing pace',()=>{const cases=[[p(-4,30,-90,{observationId:'gap-origin'}),p(-1,30.18,-90,{observationId:'gap-teleport'})],[p(-2,30,-90,{observationId:'session-origin',sessionId:'a'}),p(-1,30.18,-90,{observationId:'session-teleport',sessionId:'b'})]];for(const raw of cases){const tactical=deriveTacticalTrail(raw,{now}),status=trailStatus(raw,{now});assert.ok(tactical.pending.distanceMeters<25_000);assert.ok(tactical.pending.validationSpeedMph>130);assert.equal(tactical.latest.observationId,raw[0].observationId);assert.equal(status.speedMph,null);assert.equal(status.speedSampleCount,0);assert.equal(status.pendingObservation,true);}});
test('conflicting equal-time positions remain raw but cannot move the tactical marker without corroboration',()=>{const time=p(-1).time,raw=[{lat:30,lon:-90,time,observationId:'a-good'},{lat:40,lon:-80,time,observationId:'z-conflict'}],tactical=deriveTacticalTrail(raw,{now});assert.equal(raw.length,2);assert.equal(tactical.latest.observationId,'a-good');assert.equal(tactical.pending?.reason,'conflicting_timestamp');assert.equal(tactical.quarantined.length,1);});
test('high-cadence motorcycle movement uses bounded median speed instead of per-sample distance',()=>{const oneSecondDistancesMph=[22,22,22,22,0],raw=[{lat:30,lon:-90,time:new Date(now-5000).toISOString(),observationId:'fast-0'}];for(const [index,mph] of oneSecondDistancesMph.entries())raw.push({lat:raw.at(-1).lat+(mph/2.236936)/111_195,lon:-90,time:new Date(now-(4-index)*1000).toISOString(),observationId:`fast-${index+1}`});const status=trailStatus(raw,{now});assert.equal(status.motion,'moving');assert.equal(status.speedSource,'position_median');assert.equal(status.speedSampleCount,5);assert.ok(status.speedMph>21&&status.speedMph<23);});
test('speed and direction are never calculated across a telemetry gap or session boundary',()=>{const gapPoints=[p(-4,30,-90),p(-1,30.001,-90)],gap=trailStatus(gapPoints,{now}),session=trailStatus([p(-2,30,-90,{sessionId:'a'}),p(-1,30.001,-90,{sessionId:'b'})],{now});assert.equal(segmentTrail(gapPoints,{now}).length,2);for(const status of [gap,session]){assert.equal(status.speedMph,null);assert.equal(status.direction,null);assert.equal(status.motion,'unknown');assert.equal(status.speedSampleCount,0);}});
test('credible provider speed is a provenance-labelled fallback when positional pace is unavailable',()=>{const status=trailStatus([p(-1,30,-90,{speedMph:22,heading:90})],{now});assert.equal(status.speedMph,22);assert.equal(status.speedSource,'provider_reported');assert.equal(status.speedConfidence,'reported');assert.equal(status.motion,'moving');assert.equal(status.direction,90);});
test('trail status can reuse a validated tactical derivation without changing its result',()=>{const raw=[p(-4,30,-90,{observationId:'pace-1'}),p(-3.9,30.01,-90,{observationId:'pace-2'}),p(-3.8,30.02,-90,{observationId:'pace-3'}),p(-1,40,-80,{observationId:'pending-jump'})],tacticalTrail=deriveTacticalTrail(raw,{now}),expected=trailStatus(raw,{now});assert.deepEqual(trailStatus(raw,{now,tacticalTrail}),expected);assert.deepEqual(trailStatus(raw,{now,tacticalTrail:{segments:[]}}),expected);});
test('tactical clusters can reuse caller-provided competitor derivations',()=>{const riders=[{id:'7',name:'A',points:[p(-1,30,-90)]},{id:'8',name:'B',points:[p(-1,30.0005,-90)]}],tacticalByCompetitorId=new Map(riders.map(rider=>[rider.id,deriveTacticalTrail(rider.points,{now})]));assert.deepEqual(buildTacticalClusters(riders,{now,tacticalByCompetitorId}),buildTacticalClusters(riders,{now}));});
