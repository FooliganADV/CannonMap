import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveTacticalTrail} from '../src/domain/competitors/trails.js';
import {
  TARGET_INTELLIGENCE_DEFAULTS,
  TARGET_INTELLIGENCE_STATE,
  analyzeTargetIntelligence,
  mergeRecentTargetActivity
} from '../src/domain/competitors/target-intelligence.js';

const now=Date.parse('2026-08-30T18:00:00.000Z');
const origin=Object.freeze({lat:30,lon:-90});
const metersPerLongitude=111_320*Math.cos(origin.lat*Math.PI/180);
const point=(ageMs,eastMeters=0,extra={})=>({
  lat:origin.lat,
  lon:origin.lon+eastMeters/metersPerLongitude,
  time:new Date(now-ageMs).toISOString(),
  ...extra
});
const target=(id='target-1',eastMeters=0,extra={})=>({id,label:`Target ${id}`,point:point(0,eastMeters),...extra});
const tacticalFrom=points=>({points:[...points],segments:[[...points]],latest:points.at(-1)||null,pending:null,quarantined:[]});
const analyze=(points,targets=[target()],extra={})=>analyzeTargetIntelligence({
  riderId:'496',tacticalTrail:tacticalFrom(points),telemetryStatus:{status:'live',motion:'moving'},targets,now,context:{eventId:'60'},...extra
});

test('exports conservative field defaults and the five-state public vocabulary',()=>{
  assert.deepEqual(Object.values(TARGET_INTELLIGENCE_STATE),['UNKNOWN','APPROACHING','NEAR TARGET','STOPPED NEAR TARGET','DEPARTED']);
  assert.equal(TARGET_INTELLIGENCE_DEFAULTS.vicinityRadiusMeters,152.4);
  assert.equal(TARGET_INTELLIGENCE_DEFAULTS.exitHysteresisMeters,60.96);
  assert.equal(TARGET_INTELLIGENCE_DEFAULTS.minimumIndependentIntervalMs,500);
  assert.equal(TARGET_INTELLIGENCE_DEFAULTS.maxRelevantObservations,360);
  assert.equal(TARGET_INTELLIGENCE_DEFAULTS.maxRelevantTargets,256);
  assert.equal(TARGET_INTELLIGENCE_DEFAULTS.maxTargetCandidates,8);
});

test('missing or inconsistent tactical input stays UNKNOWN rather than analyzing raw-like data',()=>{
  for(const tacticalTrail of [null,{points:[point(0)],segments:[],latest:point(0)},{points:[point(0)],segments:[[point(1000)]],latest:point(0)}]){
    const result=analyzeTargetIntelligence({riderId:'496',tacticalTrail,telemetryStatus:{status:'live'},targets:[target()],now});
    assert.equal(result.state,TARGET_INTELLIGENCE_STATE.UNKNOWN);
    assert.equal(result.reason,'missing-or-inconsistent-tactical-trail');
  }
});

test('four accepted fixes with 15 seconds and 30.48 meters of consistent closure classify APPROACHING',()=>{
  const result=analyze([point(45_000,600),point(30_000,500),point(15_000,400),point(0,300)]);
  assert.equal(result.state,TARGET_INTELLIGENCE_STATE.APPROACHING);
  assert.equal(result.reason,'confirmed-decreasing-distance-trend');
  assert.equal(result.supportingObservationCount,4);
  assert.ok(result.closestApproach.distanceMeters>295&&result.closestApproach.distanceMeters<305);
});

test('mixed distance trend remains UNKNOWN instead of fabricating an approach',()=>{
  const result=analyze([point(45_000,600),point(30_000,430),point(15_000,520),point(0,350)]);
  assert.equal(result.state,TARGET_INTELLIGENCE_STATE.UNKNOWN);
  assert.equal(result.reason,'ambiguous-approach');
  assert.equal(result.diagnostics.ambiguous,true);
  assert.equal(result.closestApproach,null);
});

test('an accepted latest fix inside the vicinity classifies NEAR TARGET',()=>{
  const result=analyze([point(10_000,210),point(0,100)]);
  assert.equal(result.state,TARGET_INTELLIGENCE_STATE.NEAR_TARGET);
  assert.equal(result.reason,'accepted-fix-inside-vicinity');
  assert.ok(result.latestDistanceMeters<101);
});

test('a single accepted fix stays UNKNOWN even when it is inside the vicinity',()=>{
  const result=analyze([point(0,10)]);
  assert.equal(result.state,TARGET_INTELLIGENCE_STATE.UNKNOWN);
  assert.equal(result.reason,'insufficient-independent-observations');
  assert.equal(result.targetId,null);
});

test('a contiguous independent stationary dwell classifies STOPPED NEAR TARGET',()=>{
  const result=analyze([point(45_000,6),point(30_000,9),point(15_000,7),point(0,8)],[target()],{telemetryStatus:{status:'live',motion:'stationary'}});
  assert.equal(result.state,TARGET_INTELLIGENCE_STATE.STOPPED_NEAR_TARGET);
  assert.equal(result.reason,'contiguous-stationary-dwell');
  assert.equal(result.supportingObservationCount,4);
  assert.equal(result.dwellDurationMs,45_000);
});

test('near-target evidence without enough duration remains NEAR TARGET',()=>{
  const result=analyze([point(20_000,6),point(10_000,9),point(0,8)]);
  assert.equal(result.state,TARGET_INTELLIGENCE_STATE.NEAR_TARGET);
  assert.equal(result.dwellDurationMs,0);
  assert.equal(result.diagnostics.dwell.stopped,false);
});

test('dwell continuity breaks across an interval longer than 30 seconds',()=>{
  const result=analyze([point(70_000,8),point(60_000,9),point(20_000,7),point(0,8)],[target()],{telemetryStatus:{status:'live',motion:'stationary'}});
  assert.equal(result.state,TARGET_INTELLIGENCE_STATE.NEAR_TARGET);
  assert.equal(result.diagnostics.dwell.supportingObservationCount,2);
});

test('dwell tolerates intermediate fixes inside the vicinity plus jitter band',()=>{
  const result=analyze([point(45_000,160),point(30_000,159),point(15_000,158),point(0,150)],[target()],{telemetryStatus:{status:'live',motion:'stationary'}});
  assert.equal(result.state,TARGET_INTELLIGENCE_STATE.STOPPED_NEAR_TARGET);
  assert.equal(result.supportingObservationCount,4);
});

test('moving telemetry cannot be labeled STOPPED despite a dwell-shaped geometry',()=>{
  const result=analyze([point(45_000,6),point(30_000,9),point(15_000,7),point(0,8)]);
  assert.equal(result.state,TARGET_INTELLIGENCE_STATE.NEAR_TARGET);
});

test('leaving and re-entering resets dwell to the latest contiguous near run',()=>{
  const result=analyze([point(50_000,5),point(35_000,8),point(20_000,260),point(5_000,10),point(0,9)]);
  assert.equal(result.state,TARGET_INTELLIGENCE_STATE.NEAR_TARGET);
  assert.equal(result.diagnostics.dwell.supportingObservationCount,2);
  assert.equal(result.diagnostics.dwell.observedDurationMs,5_000);
});

test('four accepted outward fixes over 15 seconds beyond hysteresis confirm DEPARTED',()=>{
  const result=analyze([point(30_000,100),point(20_000,220),point(10_000,250),point(0,280)]);
  assert.equal(result.state,TARGET_INTELLIGENCE_STATE.DEPARTED);
  assert.equal(result.reason,'confirmed-same-segment-departure');
  assert.equal(result.supportingObservationCount,4);
  assert.equal(result.transitionTimestamp,point(20_000).time);
});

test('a normal transitional fix inside the hysteresis band does not erase a confirmed departure tail',()=>{
  const result=analyze([point(30_000,100),point(25_000,180),point(20_000,220),point(10_000,250),point(0,280)]);
  assert.equal(result.state,TARGET_INTELLIGENCE_STATE.DEPARTED);
  assert.equal(result.supportingObservationCount,4);
});

test('APPROACHING and DEPARTED require telemetry motion to be moving',()=>{
  const approach=analyze([point(45_000,600),point(30_000,500),point(15_000,400),point(0,300)],[target()],{telemetryStatus:{status:'live',motion:'stationary'}});
  assert.equal(approach.state,TARGET_INTELLIGENCE_STATE.UNKNOWN);
  assert.equal(approach.reason,'motion-not-moving-for-approach');
  const departure=analyze([point(30_000,100),point(20_000,220),point(10_000,250),point(0,280)],[target()],{telemetryStatus:{status:'live',motion:'unknown'}});
  assert.equal(departure.state,TARGET_INTELLIGENCE_STATE.UNKNOWN);
  assert.equal(departure.reason,'motion-not-moving-for-departure');
});

test('one unconfirmed exit remains UNKNOWN and explicitly ambiguous',()=>{
  const result=analyze([point(10_000,100),point(0,230)]);
  assert.equal(result.state,TARGET_INTELLIGENCE_STATE.UNKNOWN);
  assert.equal(result.reason,'ambiguous-departure');
  assert.equal(result.diagnostics.ambiguous,true);
});

test('telemetry gaps isolate target evidence to the supplied latest segment',()=>{
  const raw=[point(220_000,10,{observationId:'old-near'}),point(10_000,400,{observationId:'new-far'})];
  const tacticalTrail=deriveTacticalTrail(raw,{now});
  assert.equal(tacticalTrail.segments.length,2);
  const result=analyzeTargetIntelligence({riderId:'496',tacticalTrail,telemetryStatus:{status:'live'},targets:[target()],now});
  assert.equal(result.state,TARGET_INTELLIGENCE_STATE.UNKNOWN);
  assert.notEqual(result.state,TARGET_INTELLIGENCE_STATE.DEPARTED);
  assert.equal(result.diagnostics.relevantObservationCount,1);
});

test('confirmed relocation boundaries cannot borrow prior-segment target evidence',()=>{
  const raw=[point(20_000,0,{observationId:'near'}),point(2_000,1500,{observationId:'relocate-a'}),point(1_000,1502,{observationId:'relocate-b'})];
  const tacticalTrail=deriveTacticalTrail(raw,{now});
  assert.equal(tacticalTrail.segments.length,2);
  assert.equal(tacticalTrail.latest.observationId,'relocate-b');
  const result=analyzeTargetIntelligence({riderId:'496',tacticalTrail,telemetryStatus:{status:'live'},targets:[target()],now});
  assert.equal(result.state,TARGET_INTELLIGENCE_STATE.UNKNOWN);
  assert.notEqual(result.state,TARGET_INTELLIGENCE_STATE.DEPARTED);
});

test('a pending relocation forces UNKNOWN until the hardened trail validates it',()=>{
  const raw=[point(2_000,1500,{observationId:'accepted'}),point(1_000,0,{observationId:'pending'})];
  const tacticalTrail=deriveTacticalTrail(raw,{now});
  assert.equal(tacticalTrail.pending?.point.observationId,'pending');
  const result=analyzeTargetIntelligence({riderId:'496',tacticalTrail,telemetryStatus:{status:'live'},targets:[target()],now});
  assert.equal(result.state,TARGET_INTELLIGENCE_STATE.UNKNOWN);
  assert.equal(result.reason,'pending-tactical-observation');
  assert.equal(result.diagnostics.pendingObservation,true);
});

test('stale and offline telemetry cannot produce target activity',()=>{
  const tacticalTrail=tacticalFrom([point(0,10)]);
  for(const status of ['stale','offline']){
    const result=analyzeTargetIntelligence({riderId:'496',tacticalTrail,telemetryStatus:{status},targets:[target()],now});
    assert.equal(result.state,TARGET_INTELLIGENCE_STATE.UNKNOWN);
    assert.equal(result.reason,`telemetry-${status}`);
  }
  const aged=analyzeTargetIntelligence({riderId:'496',tacticalTrail:tacticalFrom([point(130_000,10)]),telemetryStatus:{status:'live'},targets:[target()],now});
  assert.equal(aged.reason,'stale-telemetry');
});

test('quarantined near-target observations do not contaminate accepted far evidence',()=>{
  const far=[point(20_000,600,{observationId:'far-a'}),point(0,500,{observationId:'far-b'})];
  const tacticalTrail={...tacticalFrom(far),quarantined:[{point:point(10_000,0,{observationId:'quarantined-near'}),reason:'corroborated_trajectory_spike'}]};
  const result=analyzeTargetIntelligence({riderId:'496',tacticalTrail,telemetryStatus:{status:'live'},targets:[target()],now});
  assert.equal(result.state,TARGET_INTELLIGENCE_STATE.UNKNOWN);
  assert.equal(result.targetId,null);
  assert.ok(result.diagnostics.candidateState.latestDistanceMeters>490);
  assert.equal(result.closestApproach,null);
});

test('closest approach includes derived speed when provider speed is explicitly null',()=>{
  const result=analyze([point(20_000,120,{speedMph:null,heading:null}),point(10_000,80,{speedMph:null,heading:null}),point(0,50,{speedMph:null,heading:null})]);
  assert.equal(result.state,TARGET_INTELLIGENCE_STATE.NEAR_TARGET);
  assert.ok(result.closestApproach.distanceMeters>49&&result.closestApproach.distanceMeters<51);
  assert.equal(result.closestApproach.targetId,'target-1');
  assert.equal(result.closestApproach.timestamp,point(0).time);
  assert.ok(Number.isFinite(result.closestApproach.speedMph));
});

test('sub-500ms same-position deliveries are not independent dwell evidence',()=>{
  const rows=[point(30_300,8),point(30_200,8),point(30_100,8),point(30_000,8),point(300,8),point(200,8),point(100,8),point(0,8)];
  const result=analyze(rows);
  assert.equal(result.state,TARGET_INTELLIGENCE_STATE.NEAR_TARGET);
  assert.equal(result.diagnostics.relevantObservationCount,2);
  assert.equal(result.diagnostics.dwell.supportingObservationCount,2);
});

test('equally supported nearby targets produce explicit target ambiguity',()=>{
  const result=analyze([point(1000,0),point(0,0)],[target('east',10),target('west',-10)]);
  assert.equal(result.state,TARGET_INTELLIGENCE_STATE.UNKNOWN);
  assert.equal(result.reason,'ambiguous-target-match');
  assert.equal(result.targetId,null);
  assert.equal(result.diagnostics.ambiguous,true);
  assert.equal(result.diagnostics.candidateStates.length,2);
});

test('high-rate recent observations are safely capped without disabling a normal live feed',()=>{
  const rows=Array.from({length:600},(_,index)=>point((599-index)*500,400-index*.1));
  const result=analyze(rows);
  assert.notEqual(result.reason,'relevant-observation-overflow');
  assert.equal(result.diagnostics.rawRelevantObservationCount,600);
  assert.equal(result.diagnostics.cappedRelevantObservationCount,360);
  assert.equal(result.diagnostics.relevantObservationTruncated,true);
  assert.equal(result.diagnostics.acceptedPointChecks,360);
  assert.equal(result.diagnostics.candidateChecks,1);
  assert.equal(result.diagnostics.maximumRelevantObservations,360);
});

test('candidate overflow returns UNKNOWN rather than silently choosing among too many targets',()=>{
  const targets=Array.from({length:20},(_,index)=>target(`t-${String(index).padStart(2,'0')}`,index*2));
  const result=analyze([point(1000,300),point(0,290)],targets);
  assert.equal(result.state,TARGET_INTELLIGENCE_STATE.UNKNOWN);
  assert.equal(result.reason,'candidate-target-overflow');
  assert.equal(result.diagnostics.candidateTargetCount,20);
  assert.equal(result.diagnostics.maximumTargetCandidates,8);
});

test('an oversized current target catalog returns UNKNOWN before distance scans',()=>{
  const targets=Array.from({length:257},(_,index)=>target(`t-${String(index).padStart(3,'0')}`,index));
  const result=analyze([point(1000,300),point(0,290)],targets);
  assert.equal(result.state,TARGET_INTELLIGENCE_STATE.UNKNOWN);
  assert.equal(result.reason,'target-catalog-overflow');
  assert.equal(result.diagnostics.maximumRelevantTargets,256);
  assert.equal(result.diagnostics.candidateChecks,0);
  assert.equal(result.diagnostics.acceptedPointChecks,0);
});

test('twenty 12,000-point rider analyses inspect only the bounded recent window',()=>{
  const rows=Array.from({length:12_000},(_,index)=>point((11_999-index)*1000,1500-index*.1)),tacticalTrail=tacticalFrom(rows);
  for(let rider=0;rider<20;rider++){
    const result=analyzeTargetIntelligence({riderId:String(rider),tacticalTrail,telemetryStatus:{status:'live',motion:'moving'},targets:[target()],now});
    assert.ok(result.diagnostics.acceptedPointChecks<=360);
    assert.ok(result.diagnostics.historyBoundaryChecks<=14);
    assert.equal(result.diagnostics.candidateChecks,1);
    assert.equal(result.diagnostics.rawRelevantObservationCount,301);
  }
});

test('recent activity merge deduplicates transition classes and enforces retention and bounds',()=>{
  const base=analyze([point(1000,21),point(0,20)]),newer={...base,diagnostics:{...base.diagnostics,evaluatedAt:new Date(now-1_000).toISOString()}},older={...base,diagnostics:{...base.diagnostics,evaluatedAt:new Date(now-10_000).toISOString()}},expired={...base,activityId:'expired',diagnostics:{...base.diagnostics,evaluatedAt:new Date(now-600_000).toISOString()}};
  const second={...base,activityId:'event|496|target-2|NEAR TARGET',targetId:'target-2',diagnostics:{...base.diagnostics,evaluatedAt:new Date(now-2_000).toISOString()}};
  const merged=mergeRecentTargetActivity([older,expired],[newer,second],{now,retentionMs:300_000,maxRecords:1});
  assert.equal(merged.length,1);
  assert.equal(merged[0].activityId,base.activityId);
  assert.equal(merged[0].diagnostics.evaluatedAt,newer.diagnostics.evaluatedAt);
});

test('recent target activity history is bounded to 360 records by default',()=>{
  const base=analyze([point(1000,21),point(0,20)]),records=Array.from({length:500},(_,index)=>({...base,activityId:`activity-${index}`,diagnostics:{...base.diagnostics,evaluatedAt:new Date(now-index).toISOString()}}));
  const merged=mergeRecentTargetActivity([],records,{now});
  assert.equal(merged.length,360);
  assert.equal(merged[0].activityId,'activity-0');
});
