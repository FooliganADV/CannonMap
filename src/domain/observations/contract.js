export const OBSERVATION_SCHEMA_VERSION=1;
export const OBSERVATION_ALGORITHM_VERSION='capture-v1';

const finite=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?Number(value):null;

export function normalizePositionSample(sample={}){
  const coords=sample.coords||sample;
  const timestamp=finite(sample.timestamp??sample.timestampMs);
  return Object.freeze({
    timestampMs:timestamp,
    location:Object.freeze({
      lat:finite(coords.latitude??coords.lat),
      lon:finite(coords.longitude??coords.lon)
    }),
    accuracyMeters:finite(coords.accuracy??coords.accuracyMeters),
    altitudeMeters:finite(coords.altitude??coords.altitudeMeters),
    altitudeAccuracyMeters:finite(coords.altitudeAccuracy??coords.altitudeAccuracyMeters),
    headingDegrees:finite(coords.heading??coords.headingDegrees),
    speedMetersPerSecond:finite(coords.speed??coords.speedMetersPerSecond)
  });
}

export function stableObservationId({eventId,deviceSessionId,sequence,timestampMs}){
  const source=[eventId,deviceSessionId,sequence,timestampMs].map(value=>String(value??'')).join('|');
  let hash=2166136261;
  for(let index=0;index<source.length;index++){
    hash^=source.charCodeAt(index);
    hash=Math.imul(hash,16777619);
  }
  return `obs-${(hash>>>0).toString(16).padStart(8,'0')}`;
}

export function createObservationRecord({context,sample,quality,now}){
  const observationId=stableObservationId({...context,timestampMs:sample.timestampMs});
  return Object.freeze({
    schemaVersion:OBSERVATION_SCHEMA_VERSION,
    algorithmVersion:OBSERVATION_ALGORITHM_VERSION,
    eventId:String(context.eventId),
    observationId,
    riderId:String(context.riderId||'local-rider'),
    checkpointId:context.checkpointId?String(context.checkpointId):null,
    deviceSessionId:String(context.deviceSessionId),
    sequence:Number(context.sequence),
    occurredAt:sample.timestampMs,
    createdAt:now,
    updatedAt:now,
    captureSource:String(context.captureSource||'browser.geolocation'),
    lifecycleState:'captured',
    syncState:'pending',
    nextAttemptAt:now,
    observed:sample,
    derived:Object.freeze({quality}),
    evidenceRefs:Object.freeze([`observation:${context.eventId}:${observationId}`])
  });
}
