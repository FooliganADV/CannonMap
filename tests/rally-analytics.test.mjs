import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyticsSnapshot,applyAnalyticsEvent,createAnalyticsAccumulator,dayKeyFor,reduceGpsSample
} from '../src/domain/analytics/engine.js';
import {createRallyAnalyticsService,RALLY_ANALYTICS_FEATURE_FLAG} from '../src/application/rally-analytics-service.js';

const sample=(occurredAt,latitude,longitude,speed,elevation=100)=>({
  occurredAt,latitude,longitude,speedMetersPerSecond:speed,elevationMeters:elevation,accuracyMeters:5,headingDegrees:90
});

test('incremental reducer derives motion, complete stops, fuel candidates, elevation, and longest ride without retaining the track',()=>{
  let state=createAnalyticsAccumulator({sessionId:'session-1',rallyEventId:'event-1',startedAt:'2026-07-29T10:00:00Z'});
  const inputs=[
    sample('2026-07-29T10:00:00Z',35,-85,10,100),
    sample('2026-07-29T10:01:00Z',35.005,-85,10,120),
    sample('2026-07-29T10:02:00Z',35.005,-85,0,120),
    sample('2026-07-29T10:07:01Z',35.005,-85,0,120),
    sample('2026-07-29T10:07:02Z',35.006,-85,10,110)
  ];
  const events=[];
  for(const input of inputs){
    const result=reduceGpsSample(state,input);
    state=result.state;events.push(...result.events);
  }
  const snapshot=analyticsSnapshot(state);
  assert.equal(snapshot.metrics.sampleCount,5);
  assert.equal(snapshot.metrics.completeStopCount,1);
  assert.equal(snapshot.metrics.fuelStopCandidateCount,1);
  assert.equal(snapshot.metrics.movingPeriodCount,2);
  assert.ok(snapshot.metrics.totalDistanceMeters>600);
  assert.ok(snapshot.metrics.longestContinuousRideMeters>500);
  assert.equal(snapshot.metrics.totalClimbMeters,20);
  assert.equal(snapshot.metrics.totalDescentMeters,10);
  assert.equal(snapshot.metrics.elevationSampleCount,5);
  assert.ok(events.some(event=>event.type==='stop-completed'&&event.fuelStopCandidate));
  assert.equal('samples' in snapshot,false);
  assert.ok(Object.keys(snapshot).length<20);
});

test('tracking gaps are counted but not converted into implausible distance or riding time',()=>{
  let state=createAnalyticsAccumulator({sessionId:'s',rallyEventId:'e',startedAt:'2026-07-29T10:00:00Z'});
  state=reduceGpsSample(state,sample('2026-07-29T10:00:00Z',35,-85,10)).state;
  const result=reduceGpsSample(state,sample('2026-07-29T11:00:00Z',36,-86,10));
  assert.equal(result.state.metrics.trackingGapCount,1);
  assert.equal(result.state.metrics.totalDistanceMeters,0);
  assert.equal(result.state.metrics.movingMs,0);
  assert.ok(result.events.some(event=>event.type==='tracking-gap'));
});

test('event metrics and local daily keys remain separate from raw evidence',()=>{
  let state=createAnalyticsAccumulator({sessionId:'s',rallyEventId:'e',startedAt:'2026-07-29T10:00:00Z'});
  state=applyAnalyticsEvent(state,{type:'checkpoint-completed',occurredAt:'2026-07-29T10:01:00Z'});
  state=applyAnalyticsEvent(state,{type:'weather-snapshot',occurredAt:'2026-07-29T10:02:00Z'});
  state=applyAnalyticsEvent(state,{type:'route-progress',occurredAt:'2026-07-29T10:03:00Z'});
  assert.equal(state.metrics.checkpointsCompleted,1);
  assert.equal(state.metrics.weatherSnapshotCount,1);
  assert.equal(state.metrics.routeProgressSampleCount,1);
  assert.equal(dayKeyFor('2026-07-30T01:00:00Z',{timeZone:'America/Chicago'}),'2026-07-29');
});

test('analytics service serializes raw writes and compact statistics through the documented API',async()=>{
  const sessions=new Map(),daily=new Map(),samples=[],events=[];
  const persistence={
    async findActiveSession(eventId){return [...sessions.values()].find(row=>row.rallyEventId===eventId&&row.status==='active')||null;},
    async getDaily(sessionId,key){return daily.get(`${sessionId}:${key}`)||null;},
    async saveStats({session, daily:day}){sessions.set(session.sessionId,structuredClone(session));daily.set(`${day.sessionId}:${day.dayKey}`,structuredClone(day));},
    async appendEventAndStats({event,session,daily:day}){events.push(structuredClone(event));await this.saveStats({session,daily:day});},
    async appendSampleAndStats({sample,events:items,session,daily:day}){samples.push(structuredClone(sample));events.push(...structuredClone(items));await this.saveStats({session,daily:day});}
  };
  let id=0;
  const service=createRallyAnalyticsService({
    clock:{now:()=>Date.parse('2026-07-29T10:00:00Z'),iso:()=>'2026-07-29T10:00:00.000Z'},
    createId:()=>`id-${++id}`,featureFlags:{isEnabled:key=>key===RALLY_ANALYTICS_FEATURE_FLAG},persistence
  });
  assert.deepEqual(await service.recover({rallyEventId:'event-1'}),{status:'idle'});
  await service.startSession({rallyEventId:'event-1'});
  await Promise.all([
    service.recordGpsSample(sample('2026-07-29T10:00:00Z',35,-85,10),{routeProgress:{checkpointId:'cp-1'}}),
    service.recordGpsSample(sample('2026-07-29T10:01:00Z',35.005,-85,10),{routeProgress:{checkpointId:'cp-1'}})
  ]);
  await service.recordCheckpointEvent({checkpointId:'cp-1'});
  await service.recordWeatherSnapshot({temperature_2m:80});
  await service.stopSession();
  assert.equal(samples.length,2);
  assert.equal(samples[0].position.latitude,35);
  assert.equal(samples[0].routeProgress.checkpointId,'cp-1');
  assert.ok(events.some(event=>event.type==='checkpoint-completed'));
  assert.ok(events.some(event=>event.type==='weather-snapshot'));
  const persisted=[...sessions.values()][0];
  assert.equal(persisted.status,'completed');
  assert.equal(persisted.accumulator.metrics.sampleCount,2);
  assert.equal(persisted.accumulator.metrics.routeProgressSampleCount,2);
});

test('feature flag absence keeps the service inert and backward-compatible',async()=>{
  const service=createRallyAnalyticsService({
    clock:{now:()=>0,iso:()=>new Date(0).toISOString()},createId:()=>'unused',
    featureFlags:{isEnabled:()=>false},persistence:{}
  });
  assert.deepEqual(await service.startSession(),{status:'disabled'});
  assert.deepEqual(await service.recordGpsSample({}),{status:'disabled'});
  assert.equal(service.snapshot(),null);
});
