import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deriveTacticalTrail,mergeTrailPoints,pointTime,trailStatus} from '../src/domain/competitors/trails.js';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/trail-intel/event-60-sanitized.json',import.meta.url),'utf8'));
const rider=fixture.competitors[0];
const points=rider.points;

test('event-60 replay retains the real feed timing, gaps, reconnects, and absent provider fields',()=>{
  assert.equal(fixture.source.eventId,'60');
  assert.equal(fixture.source.sourceBuild,'0.7.14');
  assert.equal(fixture.source.originalPointCount,2892);
  assert.equal(fixture.source.selectedPointCount,points.length);
  assert.match(fixture.source.sourceSha256,/^[a-f0-9]{64}$/);
  assert.equal(rider.number,'88');
  assert.ok(points.length>=400);
  assert.ok(points.every(point=>point.speedMph===null&&point.heading===null&&point.sessionId===null&&point.observationId===null));
  const intervals=points.slice(1).map((point,index)=>pointTime(point)-pointTime(points[index]));
  assert.ok(intervals.filter(interval=>interval>120_000).length>=2);
  assert.ok(intervals.filter(interval=>interval<=5_000).length>300);
});

test('event-60 movement derives immediate and sustained pace without provider speed or heading',()=>{
  const firstGapIndex=points.findIndex((point,index)=>index>0&&pointTime(point)-pointTime(points[index-1])>120_000);
  const active=points.slice(0,firstGapIndex);
  const now=pointTime(active.at(-1));
  const tactical=deriveTacticalTrail(active,{now});
  const status=trailStatus(active,{now,tacticalTrail:tactical});
  assert.equal(tactical.segments.length,1);
  assert.equal(status.speedSource,'position_median');
  assert.ok(status.speedMph>10);
  assert.ok(status.rollingPaceMph>10);
  assert.ok(status.sustainedPaceMph>10);
  assert.ok(status.sustainedCoverageMs>=10*60*1000);
  assert.ok(Number.isFinite(status.headingDegrees));
  assert.match(status.headingCardinal,/^(N|NE|E|SE|S|SW|W|NW)$/);
});

test('event-60 reconnect never bridges a telemetry gap into a pace window',()=>{
  const now=pointTime(points.at(-1));
  const tactical=deriveTacticalTrail(points,{now});
  const status=trailStatus(points,{now,tacticalTrail:tactical});
  assert.ok(tactical.segments.length>=3);
  assert.ok(status.trailGapCount>=2);
  assert.equal(status.rollingPaceMph,null);
  assert.equal(status.sustainedPaceMph,null);
  assert.ok(status.rollingCoverageMs<15_000);
});

test('event-60 stationary interval is derived from positions and remains stopped without provider speed',()=>{
  const stopped=points.filter(point=>pointTime(point)>=Date.parse('2026-08-22T19:38:08.000Z')&&pointTime(point)<=Date.parse('2026-08-22T19:41:23.999Z'));
  const now=pointTime(stopped.at(-1));
  const status=trailStatus(stopped,{now});
  assert.ok(stopped.length>=90);
  assert.equal(status.motion,'stationary');
  assert.ok(status.speedMph<=2);
  assert.ok(status.rollingPaceMph<=2);
  assert.equal(status.sustainedPaceMph,null);
});

test('event-60 id-less replay remains deduplicated across repeated polling merges',()=>{
  const now=pointTime(points.at(-1));
  const first=mergeTrailPoints([],points,{now});
  const repeated=mergeTrailPoints(first.points,points,{now});
  assert.equal(first.added,points.length);
  assert.equal(repeated.added,0);
  assert.equal(repeated.points.length,points.length);
});
