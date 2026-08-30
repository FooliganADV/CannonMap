import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {analyzeTargetIntelligence,TARGET_INTELLIGENCE_STATE} from '../src/domain/competitors/target-intelligence.js';
import {deriveTacticalTrail,distanceMeters,pointTime,trailStatus} from '../src/domain/competitors/trails.js';

const names=['field-0.7.17-sanitized.json','field-0.7.18-sanitized.json','field-0.7.19-sanitized.json','field-0.7.20-sanitized.json'];
const fixtures=await Promise.all(names.map(async name=>JSON.parse(await readFile(new URL(`./fixtures/trail-intel/field-replays/${name}`,import.meta.url),'utf8'))));
const byVersion=new Map(fixtures.map(fixture=>[fixture.appVersion,fixture]));
const replay=(fixture,rider)=>{const now=Date.parse(fixture.exportedAt),tactical=deriveTacticalTrail(rider.points,{now,historyMs:8*60*60*1000}),status=trailStatus(rider.points,{now,tacticalTrail:tactical});return {now,tactical,status};};
const targetAt=(id,point)=>({id,label:id,point:{lat:point.lat,lon:point.lon}});

test('0.7.20 repeated identical Samsung feed fixes establish truthful bounded stationary dwell',()=>{
  const fixture=byVersion.get('0.7.20'),rider=fixture.competitors.find(item=>item.id==='field-rider-13'),{now,tactical,status}=replay(fixture,rider),latest=tactical.latest;
  assert.equal(status.motion,'stationary');assert.equal(status.speedMph,0);assert.equal(status.headingDegrees,null);
  const result=analyzeTargetIntelligence({riderId:rider.id,tacticalTrail:tactical,telemetryStatus:status,targets:[targetAt('field-stop',latest)],context:{projectId:'field',eventId:'60',dayNumber:1},now});
  assert.equal(result.state,TARGET_INTELLIGENCE_STATE.STOPPED_NEAR_TARGET);
  assert.ok(result.dwellDurationMs>=30_000&&result.dwellDurationMs<=5*60_000);
  assert.equal(result.closestApproach.targetId,'field-stop');
  assert.ok(result.closestApproach.distanceMeters<1);
  assert.ok(result.diagnostics.relevantObservationCount<=360);
});

test('0.7.17 real reconnect gap cannot carry closest approach or departure across segments',()=>{
  const fixture=byVersion.get('0.7.17'),rider=fixture.competitors.find(item=>item.id==='field-rider-13'),full=replay(fixture,rider).tactical,preGap=full.segments[0].at(-1),firstAfter=full.segments[1][0],prefix=rider.points.filter(point=>pointTime(point)<=pointTime(firstAfter)),now=pointTime(firstAfter),tactical=deriveTacticalTrail(prefix,{now,historyMs:8*60*60*1000}),status=trailStatus(prefix,{now,tacticalTrail:tactical});
  assert.equal(tactical.segments.length,2);assert.equal(tactical.segments.at(-1).length,1);
  const result=analyzeTargetIntelligence({riderId:rider.id,tacticalTrail:tactical,telemetryStatus:status,targets:[targetAt('pre-gap-target',preGap)],context:{projectId:'field',eventId:'60',dayNumber:1},now});
  assert.equal(result.state,TARGET_INTELLIGENCE_STATE.UNKNOWN);
  assert.equal(result.closestApproach,null);
  assert.notEqual(result.reason,'confirmed-same-segment-departure');
});

test('0.7.18 and 0.7.19 Rider 496 quarantined spike coordinates never become closest accepted approach',()=>{
  for(const version of ['0.7.18','0.7.19']){
    const fixture=byVersion.get(version),rider=fixture.competitors.find(item=>item.id==='field-rider-14'),{now,tactical,status}=replay(fixture,rider);
    const candidates=tactical.quarantined.map(item=>({item,acceptedMinimum:Math.min(...tactical.points.map(point=>distanceMeters(item.point,point))),latestDistance:distanceMeters(item.point,tactical.latest)})).filter(item=>item.acceptedMinimum>200&&item.acceptedMinimum<1609.344).sort((left,right)=>right.latestDistance-left.latestDistance);
    assert.ok(candidates.length,`${version} must retain a spatially isolated quarantined field fix`);
    const spike=candidates[0].item.point,result=analyzeTargetIntelligence({riderId:rider.id,tacticalTrail:tactical,telemetryStatus:status,targets:[targetAt(`${version}-quarantined`,spike)],context:{projectId:'field',eventId:'60',dayNumber:1},now});
    assert.notEqual(result.state,TARGET_INTELLIGENCE_STATE.NEAR_TARGET);
    assert.notEqual(result.state,TARGET_INTELLIGENCE_STATE.STOPPED_NEAR_TARGET);
    assert.notEqual(result.state,TARGET_INTELLIGENCE_STATE.DEPARTED);
    if(result.closestApproach)assert.ok(result.closestApproach.distanceMeters>200,`${version} closest approach used quarantined geometry`);
    assert.ok(tactical.quarantined.some(item=>pointTime(item.point)===pointTime(spike)));
  }
});

test('real single-point and empty field riders remain mandatory UNKNOWN',()=>{
  const fixture=byVersion.get('0.7.17'),single=fixture.competitors.find(item=>item.id==='field-rider-14'),empty=fixture.competitors.find(item=>item.points.length===0);
  for(const rider of [single,empty]){
    const {now,tactical,status}=replay(fixture,rider),anchor=tactical.latest||{lat:30,lon:-90},result=analyzeTargetIntelligence({riderId:rider.id,tacticalTrail:tactical,telemetryStatus:status,targets:[targetAt('field-target',anchor)],context:{projectId:'field',eventId:'60',dayNumber:1},now});
    assert.equal(result.state,TARGET_INTELLIGENCE_STATE.UNKNOWN);
    assert.equal(result.closestApproach,null);
  }
});
