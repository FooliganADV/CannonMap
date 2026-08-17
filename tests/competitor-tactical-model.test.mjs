import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCompetitorTacticalModels,
  buildRiderTacticalModel,
  calculateTacticalMotion,
  cardinalDirection,
  directionArrow,
  mergeCompetitorSnapshots,
  mergeTrailGapMetadata,
  normalizeTrailPoints,
  segmentTrailDetailed,
  stableCompetitorIdentity
} from '../src/domain/competitors/trails.js';

const now=Date.parse('2026-08-16T18:00:00Z');
const iso=milliseconds=>new Date(milliseconds).toISOString();
const metersEast=(meters,latitude=35)=>meters/(111195*Math.cos(latitude*Math.PI/180));
const observation=(rider,seconds,lat=35,lon=-82,extra={})=>({
  observationId:`${rider}-${seconds}`,
  lat,
  lon,
  time:iso(now+seconds*1000),
  ...extra
});

test('synchronized nearby riders retain independent upstream identities and coordinates',()=>{
  const rider246=[observation(246,-3),observation(246,-2,35,-82+metersEast(35)),observation(246,-1,35,-82+metersEast(70))];
  const rider299=[observation(299,-3,35.0003),observation(299,-2,35.0003,-82+metersEast(25)),observation(299,-1,35.0003,-82+metersEast(50))];
  const models=buildCompetitorTacticalModels([
    {id:'internal-7',competitor_number:246,points:rider246},
    {id:'internal-8',competitor_number:299,points:rider299}
  ],{now});
  assert.deepEqual(models.map(model=>[model.id,model.label]),[['internal-7','246'],['internal-8','299']]);
  assert.deepEqual(models[0].observations.map(point=>point.observationId),rider246.map(point=>point.observationId));
  assert.deepEqual(models[1].observations.map(point=>point.observationId),rider299.map(point=>point.observationId));
  assert.equal(models[0].observations.some(point=>point.observationId.startsWith('299-')),false);
  assert.equal(models[1].observations.some(point=>point.observationId.startsWith('246-')),false);
});

test('snapshot ingest is idempotent, chronological, and stable across repeated manual sync',()=>{
  const incoming=[{id:'7',number:246,points:[observation(246,-1),observation(246,-3),observation(246,-2)]}];
  const first=mergeCompetitorSnapshots([],incoming,{now});
  const second=mergeCompetitorSnapshots(first.competitors,incoming,{now});
  const third=mergeCompetitorSnapshots(second.competitors,incoming,{now});
  assert.equal(first.added,3);
  assert.equal(second.added,0);
  assert.equal(third.added,0);
  assert.deepEqual(second.competitors,third.competitors);
  assert.deepEqual(third.competitors[0].points.map(point=>point.observationId),['246--3','246--2','246--1']);
});

test('identical observations with regenerated IDs deduplicate without unstable reordering',()=>{
  const original=observation(246,-2),duplicate={...original,observationId:'server-regenerated-id'};
  const points=normalizeTrailPoints([original,duplicate,observation(246,-1)],{now});
  assert.equal(points.length,2);
  assert.equal(points[0].observationId,'246--2');
});

test('telemetry gap splits geometry and preserves rider-scoped gap evidence',()=>{
  const points=[observation(246,-181),observation(246,-180,35,-82+metersEast(20)),observation(246,-10,35,-82+metersEast(1000)),observation(246,-9,35,-82+metersEast(1020))];
  const result=segmentTrailDetailed(points,{riderId:'rider-246',now,gapMs:90000});
  assert.equal(result.segments.length,2);
  assert.deepEqual(result.segments.map(segment=>segment.length),[2,2]);
  assert.equal(result.gaps.length,1);
  assert.equal(result.gaps[0].riderId,'rider-246');
  assert.equal(result.gaps[0].reason,'telemetry-gap');
  assert.equal(result.gaps[0].durationMs,170000);
  assert.equal(result.segments[0].at(-1).observationId,'246--180');
  assert.equal(result.segments[1][0].observationId,'246--10');
});

test('speed and heading are never inferred across a telemetry gap',()=>{
  const points=[observation(246,-300),observation(246,-299,35,-82+metersEast(30)),observation(246,-1,35,-82+metersEast(1000))];
  const model=buildRiderTacticalModel({id:'7',number:246,points},{now,gapMs:90000});
  assert.equal(model.segments.length,2);
  assert.equal(model.tactical.currentSpeedMph,null);
  assert.equal(model.tactical.rollingPaceMph,null);
  assert.equal(model.tactical.headingDegrees,null);
});

test('impossible jumps reject only the unsupported connection, never another rider history',()=>{
  const model=buildRiderTacticalModel({id:'7',number:246,points:[observation(246,-3),observation(246,-2,45,-70),observation(246,-1,45,-70+metersEast(20,45))]},{now});
  assert.equal(model.segments.length,2);
  assert.equal(model.gaps[0].reason,'impossible-jump');
  assert.equal(model.segments[1].length,2);
});

test('constant synthetic movement produces reasonable recent, rolling, and sustained pace',()=>{
  const mph=60,metersPerSecond=mph/2.2369362920544;
  const points=Array.from({length:901},(_,index)=>observation(246,index-900,35,-82+metersEast(index*metersPerSecond)));
  const tactical=calculateTacticalMotion(points,{now,gapMs:5000});
  assert.ok(Math.abs(tactical.currentSpeedMph-mph)<0.5,`current ${tactical.currentSpeedMph}`);
  assert.ok(Math.abs(tactical.rollingPaceMph-mph)<0.5,`rolling ${tactical.rollingPaceMph}`);
  assert.ok(Math.abs(tactical.sustainedPaceMph-mph)<0.5,`sustained ${tactical.sustainedPaceMph}`);
  assert.equal(tactical.headingCardinal,'E');
  assert.equal(tactical.headingArrow,'→');
  assert.equal(tactical.motion,'moving');
});

test('stationary GPS jitter does not produce absurd speed or a false moving state',()=>{
  const offsets=[0,1,-1,2,-2,1,0,-1,1,0];
  const points=offsets.map((meters,index)=>observation(246,index-9,35,-82+metersEast(meters)));
  const tactical=calculateTacticalMotion(points,{now});
  assert.equal(tactical.currentSpeedMph,0);
  assert.equal(tactical.recentSpeedMph,0);
  assert.equal(tactical.motion,'stopped');
  assert.equal(tactical.headingDegrees,null);
});

test('duplicate timestamps cannot create speed or a rendered connection',()=>{
  const sameTime=observation(246,-1),other={...observation(246,-1,35.01),observationId:'246-same-time-other-position'};
  const model=buildRiderTacticalModel({id:'7',number:246,points:[sameTime,other]},{now});
  assert.equal(model.segments.length,2);
  assert.equal(model.gaps[0].reason,'non-increasing-timestamp');
  assert.equal(model.tactical.currentSpeedMph,null);
});

test('upstream competitor number remains the tactical label while stable stream ID remains the key',()=>{
  const identity=stableCompetitorIdentity({id:7,competitor_number:246,name:'Competitor 246'});
  assert.deepEqual(identity,{id:'7',riderNumber:'246',label:'246',name:'Competitor 246'});
});

test('explicit null upstream motion uses derived Event 60 speed and heading',()=>{
  const points=[
    {...observation(246,-2),speedMph:null,heading:null},
    {...observation(246,-1,35,-82+metersEast(35)),speedMph:null,heading:null}
  ];
  const tactical=calculateTacticalMotion(points,{now});
  assert.ok(tactical.currentSpeedMph>70&&tactical.currentSpeedMph<90,tactical.currentSpeedMph);
  assert.equal(tactical.speedSource,'derived');
  assert.equal(tactical.headingCardinal,'E');
  assert.equal(tactical.headingArrow,'→');
  assert.equal(tactical.motion,'moving');
  assert.equal(cardinalDirection(null),null);
  assert.equal(directionArrow('  '),null);
});

test('gap metadata survives retention pruning and repeated reconnect sync is idempotent',()=>{
  const prior=observation(246,-10*60*60),latest=observation(246,0,35,-81.9);
  const first=mergeCompetitorSnapshots(
    [{id:'7',number:246,points:[prior],trailGaps:[]}],
    [{id:'7',number:246,points:[latest]}],
    {now,historyMs:8*60*60*1000,gapMs:90000}
  );
  assert.equal(first.competitors[0].points.length,1);
  assert.equal(first.competitors[0].points[0].observationId,'246-0');
  assert.equal(first.competitors[0].trailGaps.length,1);
  assert.equal(first.competitors[0].trailGaps[0].riderId,'7');
  assert.equal(first.competitors[0].trailGaps[0].durationMs,10*60*60*1000);
  assert.equal(first.gapsAdded,1);
  const second=mergeCompetitorSnapshots(first.competitors,[{id:'7',number:246,points:[latest]}],{now,historyMs:8*60*60*1000,gapMs:90000});
  assert.equal(second.competitors[0].trailGaps.length,1);
  assert.equal(second.gapsAdded,0);
  assert.deepEqual(second.competitors[0].trailGaps,first.competitors[0].trailGaps);
  assert.equal(mergeTrailGapMetadata(first.competitors[0].trailGaps,first.competitors[0].trailGaps).length,1);
});

test('uncorroborated terminal impossible fix cannot move the tactical render position',()=>{
  const trusted=[observation(246,-4),observation(246,-3,35,-82+metersEast(30))];
  const spike=observation(246,-2,45,-70);
  const pending=buildRiderTacticalModel({id:'7',number:246,points:[...trusted,spike]},{now});
  assert.equal(pending.positionStatus,'pending-corroboration');
  assert.equal(pending.positionReason,'impossible-jump');
  assert.equal(pending.renderObservation.observationId,'246--3');
  assert.equal(pending.pendingObservation.observationId,'246--2');
  assert.equal(pending.tactical.lastUpdate,pending.renderObservation.time);

  const corroboration=observation(246,-1,45,-70+metersEast(20,45));
  const accepted=buildRiderTacticalModel({id:'7',number:246,points:[...trusted,spike,corroboration]},{now});
  assert.equal(accepted.positionStatus,'accepted');
  assert.equal(accepted.pendingObservation,null);
  assert.equal(accepted.renderObservation.observationId,'246--1');
});

test('isolated spike followed by an impossible return keeps the last corroborated position',()=>{
  const trusted=[observation(246,-5),observation(246,-4,35,-82+metersEast(20))];
  const spike=observation(246,-3,45,-70),returned=observation(246,-2,35,-82+metersEast(40));
  const model=buildRiderTacticalModel({id:'7',number:246,points:[...trusted,spike,returned]},{now});
  assert.equal(model.positionStatus,'pending-corroboration');
  assert.equal(model.renderObservation.observationId,'246--4');
  assert.equal(model.pendingObservation.observationId,'246--2');
});

test('a long interval still rejects a physically impossible terminal position',()=>{
  const trusted=[observation(246,-602),observation(246,-601,35,-82+metersEast(20))];
  const impossible=observation(246,-1,-10,120);
  const model=buildRiderTacticalModel({id:'7',number:246,points:[...trusted,impossible]},{now,gapMs:90000});
  assert.equal(model.gaps.at(-1).reason,'impossible-speed');
  assert.equal(model.positionStatus,'pending-corroboration');
  assert.equal(model.renderObservation.observationId,'246--601');
});
