import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {readFile} from 'node:fs/promises';
import {
  breadcrumbKey,
  compactTrailSegmentsForRender,
  deriveTacticalProjection,
  deriveTacticalTrail,
  distanceMeters,
  mergeCompetitorSnapshots,
  normalizeTrailPoints,
  pointTime,
  trailStatus
} from '../src/domain/competitors/trails.js';

const HISTORY_MS=8*60*60*1000;
const MAX_DURABLE_POINTS=12_000;
const MAX_RENDER_POINTS=720;
const fixtureNames=['field-0.7.17-sanitized.json','field-0.7.18-sanitized.json','field-0.7.19-sanitized.json','field-0.7.20-sanitized.json'];
const fixtures=await Promise.all(fixtureNames.map(async name=>JSON.parse(await readFile(new URL(`./fixtures/trail-intel/field-replays/${name}`,import.meta.url),'utf8'))));

function replayRider(rider,now){
  const received=Array.isArray(rider.points)?rider.points:[];
  const durable=normalizeTrailPoints(received,{now,historyMs:HISTORY_MS,maxPoints:MAX_DURABLE_POINTS});
  const tactical=deriveTacticalTrail(received,{now,historyMs:HISTORY_MS,maxPoints:MAX_DURABLE_POINTS});
  const renderedSegments=compactTrailSegmentsForRender(tactical.segments,{now,maxRenderPoints:MAX_RENDER_POINTS});
  const status=trailStatus(received,{now,historyMs:HISTORY_MS,maxPoints:MAX_DURABLE_POINTS,tacticalTrail:tactical});
  return {rider,received,durable,tactical,renderedSegments,rendered:renderedSegments.flat(),status};
}

function replayFixture(fixture){
  const now=Date.parse(fixture.exportedAt),riders=fixture.competitors.map(rider=>replayRider(rider,now));
  const sum=field=>riders.reduce((total,row)=>total+field(row),0);
  return {fixture,now,riders,counts:{received:sum(row=>row.received.length),durable:sum(row=>row.durable.length),accepted:sum(row=>row.tactical.points.length),quarantined:sum(row=>row.tactical.quarantined.length),segments:sum(row=>row.tactical.segments.length),rendered:sum(row=>row.rendered.length),omitted:sum(row=>row.tactical.points.length-row.rendered.length)}};
}

const replays=fixtures.map(replayFixture);
const replayByVersion=new Map(replays.map(replay=>[replay.fixture.appVersion,replay]));

test('field replay fixture census remains stable under the exact runtime bounds',()=>{
  assert.deepEqual(replays.map(replay=>replay.fixture.competitors.length),[14,14,14,14]);
  assert.deepEqual(Object.fromEntries(replays.map(replay=>[replay.fixture.appVersion,replay.counts])),{
    '0.7.17':{received:895,durable:895,accepted:895,quarantined:0,segments:3,rendered:721,omitted:174},
    '0.7.18':{received:3930,durable:3928,accepted:3361,quarantined:567,segments:1,rendered:720,omitted:2641},
    '0.7.19':{received:69,durable:69,accepted:58,quarantined:11,segments:1,rendered:58,omitted:0},
    '0.7.20':{received:1892,durable:1892,accepted:1892,quarantined:0,segments:2,rendered:720,omitted:1172}
  });
});

test('0.7.20 field replay preserves stop/restart truth and resets pace across the long reconnect gap',()=>{
  const replay=replayByVersion.get('0.7.20'),row=replay.riders.find(item=>item.rider.id==='field-rider-13');
  assert.equal(replay.fixture.competitors.filter(rider=>rider.points.length===0).length,13);
  assert.deepEqual(row.tactical.segments.map(segment=>segment.length),[688,1204]);
  assert.deepEqual(row.renderedSegments.map(segment=>segment.length),[183,537]);
  assert.equal(row.tactical.quarantined.length,0);
  assert.equal(row.tactical.pending,null);
  assert.ok(row.received.every(point=>point.speedMph===null&&point.heading===null&&point.sessionId===null&&point.observationId===null));

  const statusAt=index=>{
    const points=row.received.slice(0,index+1),now=pointTime(points.at(-1)),tactical=deriveTacticalTrail(points,{now,historyMs:HISTORY_MS,maxPoints:MAX_DURABLE_POINTS});
    return trailStatus(points,{now,tacticalTrail:tactical});
  };
  assert.deepEqual([23,58,71,127].map(index=>statusAt(index).motion),['stationary','moving','stationary','moving']);

  const before=row.tactical.segments[0].at(-1),after=row.tactical.segments[1][0],gapMs=pointTime(after)-pointTime(before);
  assert.equal(gapMs,3_362_994);
  assert.ok(distanceMeters(before,after)>9_000&&distanceMeters(before,after)<10_000);
  const beforeKey=breadcrumbKey(before),afterKey=breadcrumbKey(after);
  assert.ok(row.renderedSegments.every(segment=>{
    const keys=new Set(segment.map(breadcrumbKey));return !(keys.has(beforeKey)&&keys.has(afterKey));
  }),'the long outage must remain two rendered lines with no chord');

  const reconnectIndex=row.received.findIndex(point=>breadcrumbKey(point)===afterKey),reconnectAt=pointTime(after);
  const atOrAfter=offsetMs=>row.received.findIndex((point,index)=>index>=reconnectIndex&&pointTime(point)>=reconnectAt+offsetMs);
  const immediate=statusAt(reconnectIndex),afterThirtySeconds=statusAt(atOrAfter(30_000)),afterTwoMinutes=statusAt(atOrAfter(120_000));
  const beforeTenMinutes=statusAt(row.received.findLastIndex((point,index)=>index>=reconnectIndex&&pointTime(point)<reconnectAt+600_000));
  const atTenMinutes=statusAt(atOrAfter(600_000));
  assert.deepEqual([immediate.motion,immediate.speedMph,immediate.headingDegrees,immediate.rollingPaceMph,immediate.sustainedPaceMph],['unknown',null,null,null,null]);
  assert.deepEqual([immediate.rollingCoverageMs,immediate.sustainedCoverageMs],[0,0]);
  assert.equal(afterThirtySeconds.motion,'stationary');
  assert.equal(afterThirtySeconds.speedMph,0);
  assert.equal(afterThirtySeconds.rollingPaceMph,0);
  assert.equal(afterThirtySeconds.sustainedPaceMph,null);
  assert.equal(afterTwoMinutes.rollingPaceMph,0);
  assert.ok(afterTwoMinutes.rollingCoverageMs>=120_000);
  assert.equal(beforeTenMinutes.sustainedPaceMph,null);
  assert.equal(beforeTenMinutes.sustainedPaceSufficient,false);
  assert.equal(atTenMinutes.sustainedPaceMph,0);
  assert.equal(atTenMinutes.sustainedPaceSufficient,true);
  assert.ok(atTenMinutes.sustainedCoverageMs>=600_000);

  const exactRuns=[];
  for(let start=0;start<row.tactical.segments[1].length;){
    const point=row.tactical.segments[1][start];let end=start+1;
    while(end<row.tactical.segments[1].length&&row.tactical.segments[1][end].lat===point.lat&&row.tactical.segments[1][end].lon===point.lon)end++;
    exactRuns.push(end-start);start=end;
  }
  assert.deepEqual(exactRuns.sort((left,right)=>right-left).slice(0,2),[790,412]);
  assert.equal(row.status.motion,'stationary');
  assert.equal(row.status.speedMph,0);
  assert.equal(row.status.headingDegrees,null);
  assert.equal(row.status.rollingPaceMph,0);
  assert.equal(row.status.rollingCoverageMs,180_000);
  assert.equal(row.status.sustainedPaceMph,0);
  assert.equal(row.status.sustainedCoverageMs,900_000);
  assert.equal(row.status.trailGapCount,1);
});

test('Rider field-rider-14 dirty feeds quarantine divergent observations without fragmenting the valid track',()=>{
  const expected={
    '0.7.18':{accepted:3361,quarantined:567,reasons:{implausible_jump:416,near_duplicate_corroboration:80,corroborated_trajectory_spike:58,isolated_spike:13}},
    '0.7.19':{accepted:58,quarantined:11,reasons:{implausible_jump:8,near_duplicate_corroboration:3}}
  };
  for(const version of ['0.7.18','0.7.19']){
    const row=replayByVersion.get(version).riders.find(item=>item.rider.id==='field-rider-14');
    const reasons=Object.fromEntries([...new Set(row.tactical.quarantined.map(item=>item.reason))].map(reason=>[reason,row.tactical.quarantined.filter(item=>item.reason===reason).length]));
    assert.equal(row.tactical.points.length,expected[version].accepted);
    assert.equal(row.tactical.quarantined.length,expected[version].quarantined);
    assert.deepEqual(reasons,expected[version].reasons);
    assert.equal(row.tactical.segments.length,1,'the legitimate same-session progression remains one continuous segment');
    assert.equal(row.tactical.pending,null,'the last trustworthy field fix resolves without a pending teleport');
  }
});

test('quarantined field observations cannot enter geometry or tactical metrics',()=>{
  for(const version of ['0.7.18','0.7.19']){
    const replay=replayByVersion.get(version),row=replay.riders.find(item=>item.rider.id==='field-rider-14');
    const quarantinedKeys=new Set(row.tactical.quarantined.map(item=>breadcrumbKey(item.point)));
    assert.ok(quarantinedKeys.size>0);
    assert.ok(row.tactical.points.every(point=>!quarantinedKeys.has(breadcrumbKey(point))));
    assert.ok(row.rendered.every(point=>!quarantinedKeys.has(breadcrumbKey(point))));
    const acceptedStatus=trailStatus(row.tactical.points,{now:replay.now});
    for(const field of ['speedMph','speedSource','headingDegrees','headingCardinal','rollingPaceMph','rollingCoverageMs','sustainedPaceMph','sustainedCoverageMs','motion'])assert.equal(row.status[field],acceptedStatus[field],`${version} ${field}`);
  }
});

test('the real reconnect gap is segmented and no rendered line can bridge it',()=>{
  const replay=replayByVersion.get('0.7.17'),row=replay.riders.find(item=>item.rider.id==='field-rider-13');
  assert.equal(row.tactical.segments.length,2);
  assert.equal(row.renderedSegments.length,2);
  assert.equal(row.status.trailGapCount,1);
  assert.ok(row.status.rollingCoverageMs<60_000,'the older segment cannot fill the current 3-minute window');
  assert.equal(row.status.sustainedPaceMph,null,'the older segment cannot satisfy 15-minute coverage');
  const before=row.tactical.segments[0].at(-1),after=row.tactical.segments[1][0];
  assert.ok(pointTime(after)-pointTime(before)>2*60*1000);
  const beforeKey=breadcrumbKey(before),afterKey=breadcrumbKey(after);
  assert.ok(row.renderedSegments.every(segment=>{
    const keys=new Set(segment.map(breadcrumbKey));return !(keys.has(beforeKey)&&keys.has(afterKey));
  }),'compaction must preserve the gap as two Leaflet lines');
});

test('repeated identical coordinates remain durable stationary evidence rather than exact duplicates',()=>{
  const replay=replayByVersion.get('0.7.17'),row=replay.riders.find(item=>item.rider.id==='field-rider-13');
  let best=[];
  for(let start=0;start<row.durable.length;start++){
    const run=[row.durable[start]];let index=start+1;
    while(index<row.durable.length&&row.durable[index].lat===run[0].lat&&row.durable[index].lon===run[0].lon){run.push(row.durable[index]);index++;}
    if(run.length>best.length)best=run;start=index-1;
  }
  assert.ok(best.length>=5,'the physical feed contains a sustained identical-coordinate stop');
  assert.equal(new Set(best.map(breadcrumbKey)).size,best.length,'distinct timestamps remain distinct durable observations');
  const status=trailStatus(best,{now:pointTime(best.at(-1))});
  assert.equal(status.motion,'stationary');
  assert.equal(status.speedMph,0);
  assert.equal(status.headingDegrees,null);
});

test('null provider fields derive truthful speed and heading while pace stays same-segment and coverage gated',()=>{
  const longReplay=replayByVersion.get('0.7.18'),longRow=longReplay.riders.find(item=>item.rider.id==='field-rider-14');
  assert.ok(longRow.tactical.points.slice(-10).every(point=>point.speedMph==null&&point.heading==null));
  assert.equal(longRow.status.speedSource,'position_median');
  assert.ok(longRow.status.speedMph>70&&longRow.status.speedMph<85);
  assert.ok(Number.isFinite(longRow.status.headingDegrees));
  assert.match(longRow.status.headingCardinal,/^(N|NE|E|SE|S|SW|W|NW)$/);
  assert.equal(longRow.status.rollingCoverageMs,3*60*1000);
  assert.ok(Number.isFinite(longRow.status.rollingPaceMph));
  assert.equal(longRow.status.sustainedCoverageMs,15*60*1000);
  assert.ok(Number.isFinite(longRow.status.sustainedPaceMph));

  const shortReplay=replayByVersion.get('0.7.19'),shortRow=shortReplay.riders.find(item=>item.rider.id==='field-rider-14');
  assert.ok(shortRow.status.rollingCoverageMs>=2*60*1000);
  assert.ok(Number.isFinite(shortRow.status.rollingPaceMph));
  assert.ok(shortRow.status.sustainedCoverageMs<10*60*1000);
  assert.equal(shortRow.status.sustainedPaceMph,null);
  assert.equal(shortRow.status.sustainedPaceSufficient,false);
});

test('single-point and zero-point field riders remain safely unknown',()=>{
  const replay=replayByVersion.get('0.7.17'),single=replay.riders.find(item=>item.rider.id==='field-rider-14'),empty=replay.riders.find(item=>item.received.length===0);
  assert.equal(single.tactical.points.length,1);
  assert.deepEqual([single.status.motion,single.status.speedMph,single.status.headingDegrees,single.status.rollingPaceMph,single.status.sustainedPaceMph],['unknown',null,null,null,null]);
  assert.equal(empty.tactical.points.length,0);
  assert.equal(empty.rendered.length,0);
  assert.deepEqual([empty.status.status,empty.status.motion,empty.status.speedMph,empty.status.headingDegrees],['offline','unknown',null,null]);
});

test('durable replay is idempotent and field rendering remains bounded without synthesized points',()=>{
  for(const replay of replays){
    const first=mergeCompetitorSnapshots([],replay.fixture.competitors,{now:replay.now,historyMs:HISTORY_MS,maxPoints:MAX_DURABLE_POINTS});
    const repeated=mergeCompetitorSnapshots(first.competitors,replay.fixture.competitors,{now:replay.now,historyMs:HISTORY_MS,maxPoints:MAX_DURABLE_POINTS});
    assert.equal(repeated.added,0);
    assert.deepEqual(repeated.competitors.map(rider=>rider.points.map(breadcrumbKey)),first.competitors.map(rider=>rider.points.map(breadcrumbKey)));
    for(const row of replay.riders){
      assert.ok(row.durable.length<=MAX_DURABLE_POINTS);
      assert.ok(row.rendered.length<=MAX_RENDER_POINTS);
      const acceptedKeys=new Set(row.tactical.points.map(breadcrumbKey));
      assert.ok(row.rendered.every(point=>acceptedKeys.has(breadcrumbKey(point))),'render compaction may select source points only');
    }
  }
});

test('repeated largest-field replay remains deterministic within a generous Node gate',()=>{
  const fixture=replayByVersion.get('0.7.18').fixture,now=Date.parse(fixture.exportedAt),started=performance.now();let signature=null;
  for(let index=0;index<20;index++){
    const replay=replayFixture(fixture),current=JSON.stringify(replay.counts);
    signature??=current;assert.equal(current,signature);
    assert.equal(replay.now,now);
  }
  const elapsed=performance.now()-started;
  assert.ok(elapsed<5000,`twenty complete 3,930-point replays took ${elapsed.toFixed(1)} ms`);
});

test('20-rider by 12,000-point tactical projection and render benchmark stays bounded',t=>{
  const now=Date.parse('2026-08-28T18:00:00.000Z'),latitude=33,metersPerLongitudeDegree=111195*Math.cos(latitude*Math.PI/180),pointCount=MAX_DURABLE_POINTS;
  const field=Array.from({length:20},(_,riderIndex)=>Array.from({length:pointCount},(_,pointIndex)=>({
    lat:latitude+riderIndex*0.001,
    lon:-90+pointIndex*5/metersPerLongitudeDegree,
    time:new Date(now-(pointCount-1-pointIndex)*2000).toISOString(),
    sessionId:`scale-session-${riderIndex}`,
    observationId:`scale-${riderIndex}-${pointIndex}`
  })));
  const started=performance.now();
  for(const points of field){
    const durable=normalizeTrailPoints(points,{now,historyMs:HISTORY_MS,maxPoints:MAX_DURABLE_POINTS});
    const tactical=deriveTacticalTrail(durable,{now,historyMs:HISTORY_MS,maxPoints:MAX_DURABLE_POINTS,gapMs:5000});
    const projection=deriveTacticalProjection(durable,{now,gapMs:5000,tacticalTrail:tactical});
    const rendered=compactTrailSegmentsForRender(tactical.segments,{now,maxRenderPoints:MAX_RENDER_POINTS}).flat();
    assert.ok(durable.length<=MAX_DURABLE_POINTS);
    assert.ok(rendered.length<=MAX_RENDER_POINTS);
    assert.ok([projection.rollingPaceMph,projection.sustainedPaceMph,projection.rollingCoverageMs,projection.sustainedCoverageMs].every(Number.isFinite));
    const durableKeys=new Set(durable.map(breadcrumbKey));
    assert.ok(tactical.points.every(point=>durableKeys.has(breadcrumbKey(point))),'tactical validation may retain durable source points only');
    assert.ok(rendered.every(point=>durableKeys.has(breadcrumbKey(point))),'render compaction may select durable source points only');
  }
  const elapsed=performance.now()-started;
  t.diagnostic(`20 riders x 12,000 points projected and rendered in ${elapsed.toFixed(1)} ms`);
  assert.ok(elapsed<20_000,`20-rider x 12,000-point benchmark took ${elapsed.toFixed(1)} ms`);
});
