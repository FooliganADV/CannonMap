import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {analyzeTargetIntelligence,TARGET_INTELLIGENCE_STATE} from '../src/domain/competitors/target-intelligence.js';
import {deriveTacticalTrail,distanceMeters,pointTime,trailStatus} from '../src/domain/competitors/trails.js';

const epoch=Date.parse('2026-08-30T12:00:00.000Z'),origin={lat:30,lon:-90},metersPerLongitude=111_320*Math.cos(origin.lat*Math.PI/180);
const point=(second,eastMeters,extra={})=>({lat:origin.lat,lon:origin.lon+eastMeters/metersPerLongitude,time:new Date(epoch+second*1000).toISOString(),...extra});
const target=(id='target-a',eastMeters=0)=>({id,label:id,lat:origin.lat,lon:origin.lon+eastMeters/metersPerLongitude});
const analyze=(points,targets=[target()],{now=pointTime(points.at(-1)),status=null}={})=>{
  const tacticalTrail=deriveTacticalTrail(points,{now,historyMs:8*60*60*1000}),telemetryStatus=status||trailStatus(points,{now,tacticalTrail});
  return {tacticalTrail,telemetryStatus,result:analyzeTargetIntelligence({riderId:'required-scenario-rider',tacticalTrail,telemetryStatus,targets,context:{projectId:'required-scenarios',eventId:'60',dayNumber:1},now})};
};
const approach=[point(0,600),point(15,500),point(30,400),point(45,300)];
const stationaryStop=[...approach,point(60,140),point(75,100),point(90,100),point(105,100),point(120,100),point(135,100),point(150,100)];

const fixtures=await Promise.all(['field-0.7.19-sanitized.json','field-0.7.20-sanitized.json'].map(async name=>JSON.parse(await readFile(new URL(`./fixtures/trail-intel/field-replays/${name}`,import.meta.url),'utf8'))));
const fixtureByVersion=new Map(fixtures.map(fixture=>[fixture.appVersion,fixture]));

test('required scenario 01 — genuine approach transitions UNKNOWN → APPROACHING → NEAR TARGET',()=>{
  const insufficient=analyze(approach.slice(0,3)).result,approaching=analyze(approach).result,near=analyze([...approach,point(60,140)]).result;
  assert.equal(insufficient.state,TARGET_INTELLIGENCE_STATE.UNKNOWN);
  assert.equal(approaching.state,TARGET_INTELLIGENCE_STATE.APPROACHING);
  assert.equal(near.state,TARGET_INTELLIGENCE_STATE.NEAR_TARGET);
  assert.equal(near.targetId,'target-a');
});

test('required scenario 02 — approach plus a real stop progresses through STOPPED NEAR TARGET',()=>{
  const approaching=analyze(approach).result,near=analyze(stationaryStop.slice(0,5)).result,stopped=analyze(stationaryStop).result;
  assert.equal(approaching.state,TARGET_INTELLIGENCE_STATE.APPROACHING);
  assert.equal(near.state,TARGET_INTELLIGENCE_STATE.NEAR_TARGET);
  assert.equal(stopped.state,TARGET_INTELLIGENCE_STATE.STOPPED_NEAR_TARGET);
  assert.ok(stopped.dwellDurationMs>=30_000);
});

test('required scenario 03 — a stopped rider can later establish DEPARTED with new outward evidence',()=>{
  const stopped=analyze(stationaryStop).result,departedPoints=[...stationaryStop,point(155,180),point(165,220),point(175,250),point(185,280)],departed=analyze(departedPoints).result;
  assert.equal(stopped.state,TARGET_INTELLIGENCE_STATE.STOPPED_NEAR_TARGET);
  assert.equal(departed.state,TARGET_INTELLIGENCE_STATE.DEPARTED);
  assert.equal(departed.reason,'confirmed-same-segment-departure');
});

test('required scenario 04 — a pass near without stopping follows APPROACHING → NEAR → DEPARTED with no dwell',()=>{
  const passingApproach=[point(0,600),point(15,480),point(30,360),point(45,240)],nearPoints=[...passingApproach,point(60,100)],departedPoints=[...nearPoints,point(75,-220),point(90,-250),point(105,-280)];
  assert.equal(analyze(passingApproach).result.state,TARGET_INTELLIGENCE_STATE.APPROACHING);
  const near=analyze(nearPoints).result,departed=analyze(departedPoints).result;
  assert.equal(near.state,TARGET_INTELLIGENCE_STATE.NEAR_TARGET);
  assert.equal(near.dwellDurationMs,0);
  assert.equal(departed.state,TARGET_INTELLIGENCE_STATE.DEPARTED);
  assert.equal(departed.dwellDurationMs,0);
});

test('required scenario 05 — a stationary rider outside the target radius is never STOPPED NEAR TARGET',()=>{
  const rows=[point(0,250),point(15,250),point(30,250),point(45,250)],{telemetryStatus,result}=analyze(rows);
  assert.equal(telemetryStatus.motion,'stationary');
  assert.equal(result.state,TARGET_INTELLIGENCE_STATE.UNKNOWN);
  assert.notEqual(result.state,TARGET_INTELLIGENCE_STATE.STOPPED_NEAR_TARGET);
});

test('required scenario 06 — stopped-near dwell continues through accepted GPS jitter inside the tolerance band',()=>{
  const rows=[point(0,145),point(15,160),point(30,155),point(45,165),point(60,150)],{telemetryStatus,result}=analyze(rows);
  assert.equal(telemetryStatus.motion,'stationary');
  assert.equal(result.state,TARGET_INTELLIGENCE_STATE.STOPPED_NEAR_TARGET);
  assert.equal(result.supportingObservationCount,5);
  assert.equal(result.dwellDurationMs,60_000);
});

test('required scenario 07 — the sanitized dirty-feed divergent outlier is quarantined and causes no target transition',()=>{
  const fixture=fixtureByVersion.get('0.7.19'),rider=fixture.competitors.find(item=>item.id==='field-rider-14'),now=Date.parse(fixture.exportedAt),tacticalTrail=deriveTacticalTrail(rider.points,{now,historyMs:8*60*60*1000}),telemetryStatus=trailStatus(rider.points,{now,tacticalTrail});
  const isolated=tacticalTrail.quarantined.map(item=>({item,acceptedMinimum:Math.min(...tacticalTrail.points.map(accepted=>distanceMeters(item.point,accepted)))})).find(candidate=>candidate.acceptedMinimum>200&&candidate.acceptedMinimum<1609.344);
  assert.ok(isolated,'sanitized Rider 496 fixture must retain an isolated quarantined fix');
  const spikeTarget={id:'quarantined-spike',label:'quarantined-spike',lat:isolated.item.point.lat,lon:isolated.item.point.lon},result=analyzeTargetIntelligence({riderId:rider.id,tacticalTrail,telemetryStatus,targets:[spikeTarget],context:{projectId:'field',eventId:'60',dayNumber:1},now});
  const withoutSpike=rider.points.filter(point=>!(pointTime(point)===pointTime(isolated.item.point)&&point.lat===isolated.item.point.lat&&point.lon===isolated.item.point.lon)),baselineTrail=deriveTacticalTrail(withoutSpike,{now,historyMs:8*60*60*1000}),baselineStatus=trailStatus(withoutSpike,{now,tacticalTrail:baselineTrail}),baseline=analyzeTargetIntelligence({riderId:rider.id,tacticalTrail:baselineTrail,telemetryStatus:baselineStatus,targets:[spikeTarget],context:{projectId:'field',eventId:'60',dayNumber:1},now});
  assert.equal(result.state,baseline.state);
  assert.equal(result.reason,baseline.reason);
  assert.equal(result.latestDistanceMeters,baseline.latestDistanceMeters);
  assert.deepEqual(result.closestApproach,baseline.closestApproach);
  assert.notEqual(result.state,TARGET_INTELLIGENCE_STATE.NEAR_TARGET);
  assert.notEqual(result.state,TARGET_INTELLIGENCE_STATE.STOPPED_NEAR_TARGET);
  assert.notEqual(result.state,TARGET_INTELLIGENCE_STATE.DEPARTED);
  assert.ok(tacticalTrail.quarantined.some(item=>pointTime(item.point)===pointTime(isolated.item.point)));
});

test('required scenario 08 — a telemetry gap breaks an approach and four new fixes can re-establish it',()=>{
  assert.equal(analyze(approach).result.state,TARGET_INTELLIGENCE_STATE.APPROACHING);
  const afterGap=[...approach,point(200,300)],broken=analyze(afterGap).result,reestablished=analyze([...afterGap,point(215,260),point(230,220),point(245,180)]).result;
  assert.equal(broken.state,TARGET_INTELLIGENCE_STATE.UNKNOWN);
  assert.equal(broken.reason,'insufficient-independent-observations');
  assert.equal(reestablished.state,TARGET_INTELLIGENCE_STATE.APPROACHING);
});

test('required scenario 09 — a telemetry gap while stopped cannot carry dwell across the gap',()=>{
  const before=[point(0,10),point(15,10),point(30,10),point(45,10)],beforeResult=analyze(before).result,afterGap=[...before,point(200,10)],broken=analyze(afterGap).result,reestablished=analyze([...afterGap,point(215,10),point(230,10),point(245,10)]).result;
  assert.equal(beforeResult.state,TARGET_INTELLIGENCE_STATE.STOPPED_NEAR_TARGET);
  assert.equal(broken.state,TARGET_INTELLIGENCE_STATE.UNKNOWN);
  assert.equal(reestablished.state,TARGET_INTELLIGENCE_STATE.STOPPED_NEAR_TARGET);
  assert.equal(reestablished.dwellDurationMs,45_000);
});

test('required scenario 10 — corroborated relocation near another checkpoint resets the old target relationship',()=>{
  const oldTarget=target('old-target',0),newTarget=target('new-target',1500),rows=[point(0,10),point(15,10),point(30,10),point(45,10),point(50,1500),point(51,1502)],{tacticalTrail,telemetryStatus}=analyze(rows,[oldTarget,newTarget]),oldResult=analyzeTargetIntelligence({riderId:'relocated',tacticalTrail,telemetryStatus,targets:[oldTarget],now:pointTime(rows.at(-1))}),newResult=analyzeTargetIntelligence({riderId:'relocated',tacticalTrail,telemetryStatus,targets:[oldTarget,newTarget],now:pointTime(rows.at(-1))});
  assert.equal(tacticalTrail.segments.length,2);
  assert.equal(oldResult.state,TARGET_INTELLIGENCE_STATE.UNKNOWN);
  assert.equal(oldResult.closestApproach,null);
  assert.equal(newResult.state,TARGET_INTELLIGENCE_STATE.NEAR_TARGET);
  assert.equal(newResult.targetId,'new-target');
});

test('required scenario 11 — a single accepted point remains UNKNOWN',()=>{
  const result=analyze([point(0,10)]).result;
  assert.equal(result.state,TARGET_INTELLIGENCE_STATE.UNKNOWN);
  assert.equal(result.reason,'insufficient-independent-observations');
  assert.equal(result.closestApproach,null);
});

test('required scenario 12 — a zero-point rider remains UNKNOWN without throwing',()=>{
  const now=epoch,tacticalTrail=deriveTacticalTrail([],{now}),telemetryStatus=trailStatus([],{now,tacticalTrail}),result=analyzeTargetIntelligence({riderId:'empty',tacticalTrail,telemetryStatus,targets:[target()],now});
  assert.equal(result.state,TARGET_INTELLIGENCE_STATE.UNKNOWN);
  assert.equal(result.reason,'missing-or-inconsistent-tactical-trail');
  assert.equal(result.closestApproach,null);
});

test('required scenario 13 — similarly plausible checkpoints resolve to explicit UNKNOWN ambiguity',()=>{
  const rows=[point(0,0),point(15,0)],result=analyze(rows,[target('east',20),target('west',-20)]).result;
  assert.equal(result.state,TARGET_INTELLIGENCE_STATE.UNKNOWN);
  assert.equal(result.reason,'ambiguous-target-match');
  assert.equal(result.targetId,null);
  assert.equal(result.diagnostics.ambiguous,true);
});

test('required scenario 14 — a road-speed target pass can become NEAR then DEPARTED but never STOPPED',()=>{
  const rows=[point(0,500),point(5,343),point(10,186),point(15,29),point(20,-128),point(25,-285),point(30,-442),point(35,-599)],near=analyze(rows.slice(0,4)),departed=analyze(rows);
  assert.ok(near.telemetryStatus.speedMph>65&&near.telemetryStatus.speedMph<75);
  assert.equal(near.result.state,TARGET_INTELLIGENCE_STATE.NEAR_TARGET);
  assert.notEqual(near.result.state,TARGET_INTELLIGENCE_STATE.STOPPED_NEAR_TARGET);
  assert.equal(departed.result.state,TARGET_INTELLIGENCE_STATE.DEPARTED);
  assert.notEqual(departed.result.state,TARGET_INTELLIGENCE_STATE.STOPPED_NEAR_TARGET);
});

test('required scenario 15 — repeated identical stationary field fixes establish dwell without false speed or heading',()=>{
  const fixture=fixtureByVersion.get('0.7.20'),rider=fixture.competitors.find(item=>item.id==='field-rider-13'),now=Date.parse(fixture.exportedAt),tacticalTrail=deriveTacticalTrail(rider.points,{now,historyMs:8*60*60*1000}),telemetryStatus=trailStatus(rider.points,{now,tacticalTrail}),latest=tacticalTrail.latest,result=analyzeTargetIntelligence({riderId:rider.id,tacticalTrail,telemetryStatus,targets:[{id:'stationary-field-target',label:'stationary-field-target',lat:latest.lat,lon:latest.lon}],context:{projectId:'field',eventId:'60',dayNumber:1},now});
  assert.equal(telemetryStatus.motion,'stationary');
  assert.equal(telemetryStatus.speedMph,0);
  assert.equal(telemetryStatus.headingDegrees,null);
  assert.equal(result.state,TARGET_INTELLIGENCE_STATE.STOPPED_NEAR_TARGET);
  assert.ok(result.dwellDurationMs>=30_000);
});
