import {
  analyticsSnapshot,applyAnalyticsEvent,createAnalyticsAccumulator,dayKeyFor,
  finalizeAnalyticsAccumulator,reduceGpsSample
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
  const records=(nextSessionAccumulator=sessionAccumulator,nextDailyAccumulator=dailyAccumulator,{
    sessionRecord=session,dayKey=currentDayKey
  }={})=>({
    session:{...sessionRecord,currentDayKey:dayKey,updatedAt:nextSessionAccumulator.updatedAt,accumulator:analyticsSnapshot(nextSessionAccumulator)},
    daily:{
      schemaVersion:1,rallyEventId:sessionRecord.rallyEventId,sessionId:sessionRecord.sessionId,
      dayKey,createdAt:nextDailyAccumulator.startedAt,updatedAt:nextDailyAccumulator.updatedAt,
      accumulator:analyticsSnapshot(nextDailyAccumulator),extensions:{}
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
    const nextSession=applyAnalyticsEvent(sessionAccumulator,{...event,occurredAt:raw.occurredAt});
    const nextDaily=applyAnalyticsEvent(dailyAccumulator,{...event,occurredAt:raw.occurredAt});
    const derived=records(nextSession,nextDaily);
    await persistence.appendEventAndStats({event:raw,...derived});
    sessionAccumulator=nextSession;dailyAccumulator=nextDaily;
    return raw;
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
        const nextSession={
          schemaVersion:1,rallyEventId:String(rallyEventId),sessionId,riderId:String(riderId),
          status:'active',startedAt:timestamp,createdAt:timestamp,updatedAt:timestamp,
          endedAt:null,currentDayKey,extensions:clone(extensions),accumulator:analyticsSnapshot(sessionAccumulator)
        };
        const event={
          schemaVersion:1,rallyEventId:String(rallyEventId),sessionId,
          telemetryEventId:createId(),occurredAt:timestamp,type:'session-started',payload:{},extensions:{}
        };
        const derived=records(sessionAccumulator,dailyAccumulator,{sessionRecord:nextSession,dayKey:currentDayKey});
        await persistence.appendEventAndStats({event,...derived});
        session=nextSession;
        return {status:'active',sessionId};
      });
    },
    async stopSession({endedAt=clock.iso(),reason='rally-stopped'}={}){
      if(!enabled())return {status:'disabled'};
      return enqueue(async()=>{
        if(!session)return {status:'idle'};
        ensureActive();
        const timestamp=new Date(endedAt).toISOString();
        const finalizedSession=finalizeAnalyticsAccumulator(sessionAccumulator,timestamp,policy);
        const finalizedDaily=finalizeAnalyticsAccumulator(dailyAccumulator,timestamp,policy);
        const nextSessionAccumulator=applyAnalyticsEvent(finalizedSession.state,{type:'session-ended',occurredAt:timestamp});
        const nextDailyAccumulator=applyAnalyticsEvent(finalizedDaily.state,{type:'session-ended',occurredAt:timestamp});
        const nextSession={...session,status:'completed',endedAt:timestamp,updatedAt:timestamp,currentDayKey};
        const events=[
          ...finalizedSession.events.map(event=>({
            schemaVersion:1,rallyEventId:session.rallyEventId,sessionId:session.sessionId,
            telemetryEventId:createId(),occurredAt:event.occurredAt,type:event.type,payload:clone(event),extensions:{}
          })),
          {
            schemaVersion:1,rallyEventId:session.rallyEventId,sessionId:session.sessionId,
            telemetryEventId:createId(),occurredAt:timestamp,type:'session-ended',payload:{reason},extensions:{}
          }
        ];
        const derived=records(nextSessionAccumulator,nextDailyAccumulator,{sessionRecord:nextSession,dayKey:currentDayKey});
        await persistence.appendSampleAndStats({events,...derived});
        session=nextSession;sessionAccumulator=nextSessionAccumulator;dailyAccumulator=nextDailyAccumulator;
        return {status:'completed',sessionId:session.sessionId};
      });
    },
    async recordGpsSample(position,{routeProgress=null,extensions={}}={}){
      if(!enabled())return {status:'disabled'};
      return enqueue(async()=>{
        ensureActive();
        const timestamp=new Date(position?.timestamp??position?.occurredAt??clock.now()).toISOString();
        const nextDayKey=dayKeyFor(timestamp,{timeZone}),dayChanged=nextDayKey!==currentDayKey;
        let sessionBase=sessionAccumulator;
        let dailyBase=dayChanged?createAnalyticsAccumulator({
          sessionId:session.sessionId,rallyEventId:session.rallyEventId,startedAt:timestamp,dayKey:nextDayKey
        }):dailyAccumulator;
        const events=[];
        if(dayChanged){
          const boundary={type:'day-boundary',occurredAt:timestamp,payload:{previousDayKey:currentDayKey,dayKey:nextDayKey}};
          sessionBase=applyAnalyticsEvent(sessionBase,boundary);
          dailyBase=applyAnalyticsEvent(dailyBase,boundary);
          events.push({
            schemaVersion:1,rallyEventId:session.rallyEventId,sessionId:session.sessionId,
            telemetryEventId:createId(),occurredAt:timestamp,type:boundary.type,
            payload:boundary.payload,extensions:{}
          });
        }
        const sessionResult=reduceGpsSample(sessionBase,position,policy);
        const dailyResult=reduceGpsSample(dailyBase,position,policy);
        let nextSessionAccumulator=sessionResult.state,nextDailyAccumulator=dailyResult.state;
        if(routeProgress){
          nextSessionAccumulator=applyAnalyticsEvent(nextSessionAccumulator,{type:'route-progress',occurredAt:timestamp});
          nextDailyAccumulator=applyAnalyticsEvent(nextDailyAccumulator,{type:'route-progress',occurredAt:timestamp});
        }
        const sample={
          schemaVersion:1,rallyEventId:session.rallyEventId,sessionId:session.sessionId,
          sampleId:createId(),occurredAt:timestamp,position:sessionResult.sample,
          movement:sessionResult.movement,routeProgress:clone(routeProgress),extensions:clone(extensions)
        };
        events.push(...sessionResult.events.map(event=>({
          schemaVersion:1,rallyEventId:session.rallyEventId,sessionId:session.sessionId,
          telemetryEventId:createId(),occurredAt:event.occurredAt,type:event.type,
          payload:clone(event),extensions:{algorithmVersion:nextSessionAccumulator.algorithmVersion}
        })));
        const derived=records(nextSessionAccumulator,nextDailyAccumulator,{dayKey:nextDayKey});
        await persistence.appendSampleAndStats({sample,events,...derived});
        sessionAccumulator=nextSessionAccumulator;dailyAccumulator=nextDailyAccumulator;currentDayKey=nextDayKey;
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
