import {
  analyticsSnapshot,applyAnalyticsEvent,createAnalyticsAccumulator,dayKeyFor,reduceGpsSample
} from '../domain/analytics/engine.js';

export const RALLY_ANALYTICS_FEATURE_FLAG='architecture.analytics.telemetry';

const clone=value=>structuredClone(value);

/**
 * Application-facing Rally Analytics API.
 *
 * The service serializes writes to preserve sample order, but keeps no raw track
 * in memory. It persists append-only evidence independently from replaceable
 * derived accumulators. Adapters may add fields under `extensions` without a
 * database migration.
 */
export function createRallyAnalyticsService({clock,createId,featureFlags,persistence,policy,timeZone}={}){
  if(!clock||typeof createId!=='function'||!featureFlags||!persistence)throw new TypeError('clock, createId, featureFlags, and persistence are required.');
  let session=null,sessionAccumulator=null,dailyAccumulator=null,currentDayKey=null;
  let queue=Promise.resolve();
  const enabled=()=>featureFlags.isEnabled(RALLY_ANALYTICS_FEATURE_FLAG)===true;
  const enqueue=operation=>{
    const result=queue.then(operation);
    queue=result.catch(()=>{});
    return result;
  };
  const records=()=>({
    session:{...session,currentDayKey,updatedAt:sessionAccumulator.updatedAt,accumulator:analyticsSnapshot(sessionAccumulator)},
    daily:{
      schemaVersion:1,rallyEventId:session.rallyEventId,sessionId:session.sessionId,
      dayKey:currentDayKey,createdAt:dailyAccumulator.startedAt,updatedAt:dailyAccumulator.updatedAt,
      accumulator:analyticsSnapshot(dailyAccumulator),extensions:{}
    }
  });
  const ensureActive=()=>{
    if(!session||session.status!=='active')throw new Error('Rally Analytics session is not active.');
  };
  const appendEvent=async event=>{
    const raw={
      schemaVersion:1,rallyEventId:session.rallyEventId,sessionId:session.sessionId,
      telemetryEventId:createId(),occurredAt:event.occurredAt||clock.iso(),type:event.type,
      payload:clone(event.payload||{}),extensions:clone(event.extensions||{})
    };
    sessionAccumulator=applyAnalyticsEvent(sessionAccumulator,{...event,occurredAt:raw.occurredAt});
    dailyAccumulator=applyAnalyticsEvent(dailyAccumulator,{...event,occurredAt:raw.occurredAt});
    const derived=records();
    await persistence.appendEventAndStats({event:raw,...derived});
    return raw;
  };
  const changeDay=async(dayKey,occurredAt)=>{
    if(dayKey===currentDayKey)return;
    const prior=currentDayKey;
    currentDayKey=dayKey;
    dailyAccumulator=createAnalyticsAccumulator({
      sessionId:session.sessionId,rallyEventId:session.rallyEventId,startedAt:occurredAt,dayKey
    });
    await appendEvent({type:'day-boundary',occurredAt,payload:{previousDayKey:prior,dayKey}});
  };

  return Object.freeze({
    isEnabled:enabled,
    async recover({rallyEventId}={}){
      if(!enabled())return {status:'disabled'};
      return enqueue(async()=>{
        const active=await persistence.findActiveSession(String(rallyEventId||'local'));
        if(!active)return {status:'idle'};
        session=active;sessionAccumulator=clone(active.accumulator);
        currentDayKey=active.currentDayKey||dayKeyFor(active.updatedAt,{timeZone});
        const daily=await persistence.getDaily(session.sessionId,currentDayKey);
        dailyAccumulator=daily?.accumulator||createAnalyticsAccumulator({
          sessionId:session.sessionId,rallyEventId:session.rallyEventId,startedAt:active.updatedAt,dayKey:currentDayKey
        });
        return {status:'active',sessionId:session.sessionId};
      });
    },
    async startSession({rallyEventId='local',riderId='local-rider',startedAt=clock.iso(),extensions={}}={}){
      if(!enabled())return {status:'disabled'};
      return enqueue(async()=>{
        if(session?.status==='active')return {status:'active',sessionId:session.sessionId,resumed:true};
        const existing=await persistence.findActiveSession(String(rallyEventId));
        if(existing){
          session=existing;sessionAccumulator=clone(existing.accumulator);
          currentDayKey=existing.currentDayKey||dayKeyFor(existing.updatedAt,{timeZone});
          dailyAccumulator=(await persistence.getDaily(existing.sessionId,currentDayKey))?.accumulator||createAnalyticsAccumulator({
            sessionId:existing.sessionId,rallyEventId:existing.rallyEventId,startedAt:existing.updatedAt,dayKey:currentDayKey
          });
          return {status:'active',sessionId:session.sessionId,resumed:true};
        }
        const sessionId=createId(),timestamp=new Date(startedAt).toISOString();
        currentDayKey=dayKeyFor(timestamp,{timeZone});
        sessionAccumulator=createAnalyticsAccumulator({sessionId,rallyEventId,startedAt:timestamp});
        dailyAccumulator=createAnalyticsAccumulator({sessionId,rallyEventId,startedAt:timestamp,dayKey:currentDayKey});
        session={
          schemaVersion:1,rallyEventId:String(rallyEventId),sessionId,riderId:String(riderId),
          status:'active',startedAt:timestamp,createdAt:timestamp,updatedAt:timestamp,
          endedAt:null,currentDayKey,extensions:clone(extensions),accumulator:analyticsSnapshot(sessionAccumulator)
        };
        const derived=records();
        await persistence.saveStats(derived);
        await appendEvent({type:'session-started',occurredAt:timestamp});
        return {status:'active',sessionId};
      });
    },
    async stopSession({endedAt=clock.iso(),reason='rally-stopped'}={}){
      if(!enabled())return {status:'disabled'};
      return enqueue(async()=>{
        if(!session)return {status:'idle'};
        ensureActive();
        await appendEvent({type:'session-ended',occurredAt:endedAt,payload:{reason}});
        session={...session,status:'completed',endedAt:new Date(endedAt).toISOString(),updatedAt:new Date(endedAt).toISOString(),currentDayKey};
        const derived=records();derived.session.status='completed';derived.session.endedAt=session.endedAt;derived.session.currentDayKey=currentDayKey;
        await persistence.saveStats(derived);
        return {status:'completed',sessionId:session.sessionId};
      });
    },
    async recordGpsSample(position,{routeProgress=null,extensions={}}={}){
      if(!enabled())return {status:'disabled'};
      return enqueue(async()=>{
        ensureActive();
        const timestamp=new Date(position?.timestamp??position?.occurredAt??clock.now()).toISOString();
        await changeDay(dayKeyFor(timestamp,{timeZone}),timestamp);
        const sessionResult=reduceGpsSample(sessionAccumulator,position,policy);
        const dailyResult=reduceGpsSample(dailyAccumulator,position,policy);
        sessionAccumulator=sessionResult.state;dailyAccumulator=dailyResult.state;
        if(routeProgress){
          sessionAccumulator=applyAnalyticsEvent(sessionAccumulator,{type:'route-progress',occurredAt:timestamp});
          dailyAccumulator=applyAnalyticsEvent(dailyAccumulator,{type:'route-progress',occurredAt:timestamp});
        }
        const sample={
          schemaVersion:1,rallyEventId:session.rallyEventId,sessionId:session.sessionId,
          sampleId:createId(),occurredAt:timestamp,position:sessionResult.sample,
          movement:sessionResult.movement,routeProgress:clone(routeProgress),extensions:clone(extensions)
        };
        const events=[...sessionResult.events.map(event=>({
          schemaVersion:1,rallyEventId:session.rallyEventId,sessionId:session.sessionId,
          telemetryEventId:createId(),occurredAt:event.occurredAt,type:event.type,
          payload:clone(event),extensions:{algorithmVersion:sessionAccumulator.algorithmVersion}
        }))];
        const derived=records();
        await persistence.appendSampleAndStats({sample,events,...derived});
        return {status:'recorded',sampleId:sample.sampleId,movement:sample.movement,events:events.map(event=>event.type)};
      });
    },
    async recordCheckpointEvent({checkpointId,action='completed',points=null,occurredAt=clock.iso(),extensions={}}={}){
      if(!enabled())return {status:'disabled'};
      return enqueue(async()=>{
        ensureActive();
        const event=await appendEvent({type:`checkpoint-${action}`,occurredAt,payload:{checkpointId,points},extensions});
        return {status:'recorded',eventId:event.telemetryEventId};
      });
    },
    async recordWeatherSnapshot(weather,{occurredAt=clock.iso(),location=null,extensions={}}={}){
      if(!enabled())return {status:'disabled'};
      return enqueue(async()=>{
        ensureActive();
        const event=await appendEvent({type:'weather-snapshot',occurredAt,payload:{weather:clone(weather),location:clone(location)},extensions});
        return {status:'recorded',eventId:event.telemetryEventId};
      });
    },
    async recordRouteProgress(progress,{occurredAt=clock.iso(),extensions={}}={}){
      if(!enabled())return {status:'disabled'};
      return enqueue(async()=>{
        ensureActive();
        const event=await appendEvent({type:'route-progress',occurredAt,payload:clone(progress),extensions});
        return {status:'recorded',eventId:event.telemetryEventId};
      });
    },
    async flush(){await queue;return {status:'flushed'};},
    snapshot(){return sessionAccumulator?analyticsSnapshot(sessionAccumulator):null;}
  });
}
