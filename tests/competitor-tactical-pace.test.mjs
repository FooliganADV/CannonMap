import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cardinalDirection,
  deriveTacticalProjection,
  deriveTacticalTrail,
  directionArrow,
  trailStatus
} from '../src/domain/competitors/trails.js';

const now=Date.parse('2026-08-25T12:00:00.000Z');
const latitude=35;
const metersPerLongitudeDegree=111195*Math.cos(latitude*Math.PI/180);
const eastLongitude=meters=>-82+meters/metersPerLongitudeDegree;

function constantTrail({startSeconds,durationSeconds,speedMph=60,sessionId='session-a',prefix='point'}){
  const metersPerSecond=speedMph/2.236936;
  return Array.from({length:durationSeconds+1},(_,index)=>{
    const seconds=startSeconds+index;
    return {lat:latitude,lon:eastLongitude((seconds-startSeconds)*metersPerSecond),time:new Date(now+seconds*1000).toISOString(),sessionId,observationId:`${prefix}-${index}`};
  });
}

test('validated same-segment motion restores rolling and sustained pace with coverage metadata',()=>{
  const points=constantTrail({startSeconds:-900,durationSeconds:900}),status=trailStatus(points,{now,gapMs:5000});
  assert.ok(Math.abs(status.speedMph-60)<0.1,`immediate ${status.speedMph}`);
  assert.ok(Math.abs(status.rollingPaceMph-60)<0.1,`rolling ${status.rollingPaceMph}`);
  assert.ok(Math.abs(status.sustainedPaceMph-60)<0.1,`sustained ${status.sustainedPaceMph}`);
  assert.equal(status.rollingCoverageMs,3*60*1000);
  assert.equal(status.sustainedCoverageMs,15*60*1000);
  assert.equal(status.rollingCoverageRatio,1);
  assert.equal(status.sustainedCoverageRatio,1);
  assert.equal(status.rollingPaceSufficient,true);
  assert.equal(status.sustainedPaceSufficient,true);
  assert.equal(status.headingCardinal,'E');
  assert.equal(status.headingArrow,'→');
  assert.equal(status.headingDegrees,status.direction,'the existing direction alias remains authoritative');
});

test('15-minute sustained pace remains unknown below the accepted ten-minute coverage floor',()=>{
  const points=constantTrail({startSeconds:-9*60,durationSeconds:9*60}),status=trailStatus(points,{now,gapMs:5000});
  assert.ok(status.rollingPaceMph>59.9&&status.rollingPaceMph<60.1);
  assert.equal(status.sustainedCoverageMs,9*60*1000);
  assert.equal(status.sustainedCoverageRatio,0.6);
  assert.equal(status.sustainedPaceMph,null);
  assert.equal(status.sustainedPaceSufficient,false);
});

test('rolling pace also stays unknown until its explicit minimum coverage exists',()=>{
  const points=constantTrail({startSeconds:-10,durationSeconds:10}),status=trailStatus(points,{now,gapMs:5000});
  assert.equal(status.rollingCoverageMs,10*1000);
  assert.equal(status.rollingPaceMph,null);
  assert.equal(status.rollingPaceSufficient,false);
});

test('telemetry gaps reset both pace windows and report only confirmed tactical breaks',()=>{
  const old=constantTrail({startSeconds:-20*60,durationSeconds:10*60,prefix:'old'});
  const recent=constantTrail({startSeconds:-2*60,durationSeconds:2*60,prefix:'recent'}).map((point,index)=>({...point,lon:eastLongitude((10*60+8*60+index)*60/2.236936)}));
  const status=trailStatus([...old,...recent],{now,gapMs:2*60*1000});
  assert.equal(status.trailGapCount,1);
  assert.equal(status.rollingCoverageMs,2*60*1000);
  assert.ok(status.rollingPaceMph>59.9&&status.rollingPaceMph<60.1);
  assert.equal(status.sustainedCoverageMs,2*60*1000);
  assert.equal(status.sustainedPaceMph,null,'the older segment must not satisfy coverage');
});

test('source-session boundaries reset pace even when the physical movement remains plausible',()=>{
  const first=constantTrail({startSeconds:-15*60,durationSeconds:13*60,sessionId:'session-a',prefix:'a'});
  const second=constantTrail({startSeconds:-2*60,durationSeconds:2*60,sessionId:'session-b',prefix:'b'}).map((point,index)=>({...point,lon:eastLongitude((13*60+index)*60/2.236936)}));
  const status=trailStatus([...first,...second],{now,gapMs:5000});
  assert.equal(status.trailGapCount,1);
  assert.equal(status.sustainedCoverageMs,2*60*1000);
  assert.equal(status.sustainedPaceMph,null);
});

test('known-to-missing-to-new source sessions cannot bridge a pace window',()=>{
  const first=constantTrail({startSeconds:-180,durationSeconds:120,sessionId:'session-a',prefix:'known'}),missing=constantTrail({startSeconds:-60,durationSeconds:30,sessionId:null,prefix:'missing'}).map((point,index)=>({...point,lon:eastLongitude((120+index)*60/2.236936)})),next=constantTrail({startSeconds:-30,durationSeconds:30,sessionId:'session-b',prefix:'next'}).map((point,index)=>({...point,lon:eastLongitude((150+index)*60/2.236936)})),status=trailStatus([...first,...missing,...next],{now});
  assert.equal(status.trailGapCount,2);
  assert.ok(status.rollingCoverageMs<=30_000);
  assert.equal(status.sustainedPaceMph,null);
});

test('stationary positional jitter does not fabricate a north heading',()=>{
  const points=Array.from({length:6},(_,index)=>({lat:30,lon:-90,time:new Date(now-(5-index)*1000).toISOString(),observationId:`still-${index}`})),status=trailStatus(points,{now});
  assert.equal(status.motion,'stationary');
  assert.equal(status.headingDegrees,null);
  assert.equal(status.headingCardinal,null);
  assert.equal(status.headingArrow,null);
});

test('a quarantined terminal outlier cannot contaminate pace, heading, or the live marker',()=>{
  const clean=constantTrail({startSeconds:-901,durationSeconds:900,prefix:'clean'}),baseline=trailStatus(clean,{now,gapMs:5000});
  const spike={lat:45,lon:-70,time:new Date(now).toISOString(),sessionId:'session-a',observationId:'unsupported-spike'},withSpike=trailStatus([...clean,spike],{now,gapMs:5000});
  assert.equal(withSpike.pendingObservation,true);
  assert.ok(Math.abs(withSpike.rollingPaceMph-baseline.rollingPaceMph)<1e-9);
  assert.ok(Math.abs(withSpike.sustainedPaceMph-baseline.sustainedPaceMph)<1e-9);
  assert.equal(withSpike.headingCardinal,'E');
  assert.equal(withSpike.trailGapCount,0,'an uncorroborated point is pending, not a confirmed segment break');
});

test('heading helpers are deterministic and tolerate missing provider heading',()=>{
  assert.equal(cardinalDirection(0),'N');
  assert.equal(cardinalDirection(44),'NE');
  assert.equal(cardinalDirection(270),'W');
  assert.equal(cardinalDirection(null),null);
  assert.equal(directionArrow(225),'↙');
  assert.equal(directionArrow(''),null);
});

test('a cached 12,000-point tactical derivation calculates pace once for repeated UI consumers',()=>{
  const points=constantTrail({startSeconds:-11999,durationSeconds:11999,speedMph:55,prefix:'bounded'}),tactical=deriveTacticalTrail(points,{now,gapMs:5000,maxPoints:12000});
  assert.equal(tactical.points.length,12000);
  const first=deriveTacticalProjection(points,{now,gapMs:5000,tacticalTrail:tactical}),second=deriveTacticalProjection(points,{now,gapMs:5000,tacticalTrail:tactical});
  assert.strictEqual(second,first,'WeakMap projection caching avoids a second full-segment scan');
  assert.ok(Math.abs(first.rollingPaceMph-55)<0.1);
  assert.ok(Math.abs(first.sustainedPaceMph-55)<0.1);
});

test('a 20-rider synthetic field retains finite same-segment projections',()=>{
  const field=Array.from({length:20},(_,rider)=>constantTrail({startSeconds:-900,durationSeconds:900,speedMph:35+rider,prefix:`rider-${rider}`}));
  const statuses=field.map(points=>trailStatus(points,{now,gapMs:5000}));
  assert.equal(statuses.length,20);
  assert.ok(statuses.every(status=>Number.isFinite(status.rollingPaceMph)&&Number.isFinite(status.sustainedPaceMph)&&status.trailGapCount===0));
});
