import {haversineMeters} from '../geo/geometry.js';

export const ANALYTICS_ALGORITHM_VERSION='rally-analytics.incremental.v1';
export const DEFAULT_ANALYTICS_POLICY=Object.freeze({
  movingSpeedMetersPerSecond:1.5,
  completeStopMs:3*60*1000,
  fuelStopCandidateMs:5*60*1000,
  maximumSampleGapMs:5*60*1000,
  maximumPlausibleSpeedMetersPerSecond:75
});

const finite=value=>Number.isFinite(Number(value))?Number(value):null;
const iso=value=>{
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))throw new TypeError('Telemetry timestamp must be valid.');
  return date.toISOString();
};
const emptyPeriod=()=>({kind:null,startedAt:null,lastAt:null,durationMs:0,distanceMeters:0});

/**
 * Derived analytics state is deliberately a versioned, extensible document.
 * New metrics belong in `metrics` or `extensions`; raw observations never belong
 * here. Persisting this accumulator makes recovery O(1), without replaying GPX.
 */
export function createAnalyticsAccumulator({sessionId,rallyEventId,startedAt,dayKey=null}){
  const timestamp=iso(startedAt);
  return {
    schemaVersion:1,algorithmVersion:ANALYTICS_ALGORITHM_VERSION,
    sessionId:String(sessionId),rallyEventId:String(rallyEventId),dayKey,
    startedAt:timestamp,updatedAt:timestamp,lastSample:null,
    currentPeriod:emptyPeriod(),currentRide:{startedAt:null,durationMs:0,distanceMeters:0},
    pendingStop:null,
    metrics:{
      sampleCount:0,totalDistanceMeters:0,elapsedMs:0,movingMs:0,stoppedMs:0,
      movingPeriodCount:0,completeStopCount:0,fuelStopCandidateCount:0,
      longestStopMs:0,longestContinuousRideMs:0,longestContinuousRideMeters:0,
      maximumSpeedMetersPerSecond:null,speedSampleCount:0,speedSumMetersPerSecond:0,
      minimumElevationMeters:null,maximumElevationMeters:null,elevationSampleCount:0,
      elevationSumMeters:0,totalClimbMeters:0,totalDescentMeters:0,
      trackingGapCount:0,offlinePeriodCount:0,
      accuracySampleCount:0,accuracySumMeters:0,minimumAccuracyMeters:null,maximumAccuracyMeters:null,
      checkpointEventCount:0,checkpointsCompleted:0,routeProgressSampleCount:0,weatherSnapshotCount:0
    },
    extensions:{}
  };
}

export function dayKeyFor(timestamp,{timeZone}={}){
  const date=new Date(timestamp);
  if(Number.isNaN(date.getTime()))throw new TypeError('Telemetry timestamp must be valid.');
  if(timeZone){
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
    const get=type=>parts.find(part=>part.type===type)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }
  const local=new Date(date.getTime()-date.getTimezoneOffset()*60000);
  return local.toISOString().slice(0,10);
}

export function normalizeGpsSample(input){
  const source=input?.coords||input;
  const latitude=finite(source?.latitude??source?.lat),longitude=finite(source?.longitude??source?.lon??source?.lng);
  if(latitude===null||longitude===null||Math.abs(latitude)>90||Math.abs(longitude)>180)throw new TypeError('Telemetry GPS coordinates are invalid.');
  return {
    occurredAt:iso(input?.timestamp??input?.occurredAt??Date.now()),
    latitude,longitude,
    accuracyMeters:finite(source?.accuracy??input?.accuracyMeters),
    speedMetersPerSecond:finite(source?.speed??input?.speedMetersPerSecond),
    elevationMeters:finite(source?.altitude??input?.elevationMeters),
    headingDegrees:finite(source?.heading??input?.headingDegrees)
  };
}

const updateRange=(metrics,{minimum,maximum,sum,count},value)=>{
  if(value===null)return;
  metrics[minimum]=metrics[minimum]===null?value:Math.min(metrics[minimum],value);
  metrics[maximum]=metrics[maximum]===null?value:Math.max(metrics[maximum],value);
  metrics[sum]+=value;metrics[count]++;
};

function finishRide(state){
  const ride=state.currentRide;
  state.metrics.longestContinuousRideMs=Math.max(state.metrics.longestContinuousRideMs,ride.durationMs);
  state.metrics.longestContinuousRideMeters=Math.max(state.metrics.longestContinuousRideMeters,ride.distanceMeters);
  state.currentRide={startedAt:null,durationMs:0,distanceMeters:0};
}

/**
 * Reduces one GPS sample into compact statistics and lifecycle events.
 * The function mutates no input and retains only the preceding sample and active
 * segment state. Consumers persist returned events separately from statistics.
 */
export function reduceGpsSample(accumulator,input,policyOverrides={}){
  const policy={...DEFAULT_ANALYTICS_POLICY,...policyOverrides};
  const state=structuredClone(accumulator),sample=normalizeGpsSample(input),events=[];
  const previous=state.lastSample;
  let intervalMs=0,distanceMeters=0,speed=sample.speedMetersPerSecond;
  if(previous){
    intervalMs=Math.max(0,Date.parse(sample.occurredAt)-Date.parse(previous.occurredAt));
    distanceMeters=haversineMeters(
      {lat:previous.latitude,lon:previous.longitude},
      {lat:sample.latitude,lon:sample.longitude}
    );
    if(speed===null&&intervalMs>0)speed=distanceMeters/(intervalMs/1000);
    if(intervalMs>policy.maximumSampleGapMs){
      state.metrics.trackingGapCount++;
      events.push({type:'tracking-gap',startedAt:previous.occurredAt,occurredAt:sample.occurredAt,durationMs:intervalMs});
      intervalMs=0;distanceMeters=0;finishRide(state);
    }
    if(speed!==null&&speed>policy.maximumPlausibleSpeedMetersPerSecond)speed=null;
  }
  const moving=speed!==null?speed>=policy.movingSpeedMetersPerSecond:distanceMeters>=5;
  const kind=moving?'moving':'stopped';

  if(previous){
    state.metrics.elapsedMs=Math.max(0,Date.parse(sample.occurredAt)-Date.parse(state.startedAt));
    if(kind==='moving'){
      state.metrics.totalDistanceMeters+=distanceMeters;
      state.metrics.movingMs+=intervalMs;
      if(!state.currentRide.startedAt)state.currentRide.startedAt=sample.occurredAt;
      state.currentRide.durationMs+=intervalMs;state.currentRide.distanceMeters+=distanceMeters;
    }else state.metrics.stoppedMs+=intervalMs;
  }

  if(state.currentPeriod.kind!==kind){
    const prior=state.currentPeriod;
    if(prior.kind==='stopped'){
      const durationMs=Math.max(prior.durationMs,Date.parse(sample.occurredAt)-Date.parse(prior.startedAt));
      if(durationMs>=policy.completeStopMs){
        state.metrics.completeStopCount++;
        state.metrics.longestStopMs=Math.max(state.metrics.longestStopMs,durationMs);
        const fuelCandidate=durationMs>=policy.fuelStopCandidateMs;
        if(fuelCandidate)state.metrics.fuelStopCandidateCount++;
        events.push({type:'stop-completed',startedAt:prior.startedAt,occurredAt:sample.occurredAt,durationMs,fuelStopCandidate:fuelCandidate,location:prior.location});
        finishRide(state);
      }
    }
    if(kind==='moving'){
      state.metrics.movingPeriodCount++;
      events.push({type:'movement-started',occurredAt:sample.occurredAt,location:{latitude:sample.latitude,longitude:sample.longitude}});
    }else events.push({type:'stop-started',occurredAt:sample.occurredAt,location:{latitude:sample.latitude,longitude:sample.longitude}});
    state.currentPeriod={kind,startedAt:sample.occurredAt,lastAt:sample.occurredAt,durationMs:0,distanceMeters:0,location:{latitude:sample.latitude,longitude:sample.longitude}};
  }else{
    state.currentPeriod.lastAt=sample.occurredAt;
    state.currentPeriod.durationMs+=intervalMs;
    state.currentPeriod.distanceMeters+=distanceMeters;
  }

  state.metrics.sampleCount++;
  if(speed!==null){
    state.metrics.maximumSpeedMetersPerSecond=state.metrics.maximumSpeedMetersPerSecond===null?speed:Math.max(state.metrics.maximumSpeedMetersPerSecond,speed);
    state.metrics.speedSumMetersPerSecond+=speed;state.metrics.speedSampleCount++;
  }
  if(sample.elevationMeters!==null){
    const priorElevation=previous?.elevationMeters;
    if(priorElevation!==null&&priorElevation!==undefined){
      const delta=sample.elevationMeters-priorElevation;
      if(delta>0)state.metrics.totalClimbMeters+=delta;else state.metrics.totalDescentMeters+=Math.abs(delta);
    }
    updateRange(state.metrics,{
      minimum:'minimumElevationMeters',maximum:'maximumElevationMeters',
      sum:'elevationSumMeters',count:'elevationSampleCount'
    },sample.elevationMeters);
  }
  updateRange(state.metrics,{
    minimum:'minimumAccuracyMeters',maximum:'maximumAccuracyMeters',
    sum:'accuracySumMeters',count:'accuracySampleCount'
  },sample.accuracyMeters);
  state.lastSample={...sample,speedMetersPerSecond:speed};
  state.updatedAt=sample.occurredAt;
  return {state,events,sample:{...sample,speedMetersPerSecond:speed},movement:kind,distanceMeters};
}

export function applyAnalyticsEvent(accumulator,event){
  const state=structuredClone(accumulator),type=String(event?.type||'');
  if(type.startsWith('checkpoint-')){
    state.metrics.checkpointEventCount++;
    if(type==='checkpoint-completed')state.metrics.checkpointsCompleted++;
  }
  if(type==='weather-snapshot')state.metrics.weatherSnapshotCount++;
  if(type==='route-progress')state.metrics.routeProgressSampleCount++;
  if(type==='offline-started')state.metrics.offlinePeriodCount++;
  state.updatedAt=iso(event?.occurredAt??Date.now());
  return state;
}

export function analyticsSnapshot(accumulator){
  const state=structuredClone(accumulator),metrics=state.metrics;
  metrics.longestContinuousRideMs=Math.max(metrics.longestContinuousRideMs,state.currentRide.durationMs);
  metrics.longestContinuousRideMeters=Math.max(metrics.longestContinuousRideMeters,state.currentRide.distanceMeters);
  return Object.freeze({
    ...state,
    derived:{
      averageMovingSpeedMetersPerSecond:metrics.speedSampleCount?metrics.speedSumMetersPerSecond/metrics.speedSampleCount:null,
      averageElevationMeters:metrics.elevationSampleCount?metrics.elevationSumMeters/metrics.elevationSampleCount:null,
      averageAccuracyMeters:metrics.accuracySampleCount?metrics.accuracySumMeters/metrics.accuracySampleCount:null,
      ridingEfficiency:metrics.elapsedMs?metrics.movingMs/metrics.elapsedMs:null
    }
  });
}
