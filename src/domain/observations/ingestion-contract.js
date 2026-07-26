export const INGESTION_SCHEMA_VERSION=1;
export const MAX_INGESTION_BYTES=32768;
export const MAX_FUTURE_SKEW_MS=5*60*1000;
export const MAX_OBSERVATION_AGE_MS=30*24*60*60*1000;

const TOP_LEVEL_KEYS=new Set([
  'schemaVersion','algorithmVersion','eventId','observationId','riderId','checkpointId',
  'deviceSessionId','sequence','occurredAt','createdAt','updatedAt','captureSource',
  'lifecycleState','syncState','nextAttemptAt','observed','derived','evidenceRefs'
]);
const OBSERVED_KEYS=new Set([
  'timestampMs','location','accuracyMeters','altitudeMeters','altitudeAccuracyMeters',
  'headingDegrees','speedMetersPerSecond'
]);
const LOCATION_KEYS=new Set(['lat','lon']);
const DERIVED_KEYS=new Set(['quality']);
const QUALITY_KEYS=new Set(['classification','score','reasons','inputs']);
const QUALITY_INPUT_KEYS=new Set(['ageMs','accuracyMeters']);
const IDENTIFIER=/^[A-Za-z0-9._:-]{1,128}$/;
const hasOnly=(value,allowed)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>allowed.has(key));
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const optionalFinite=(value,min,max)=>value===null||(finite(value)&&value>=min&&value<=max);
const validIso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const byteLength=value=>new TextEncoder().encode(JSON.stringify(value)).byteLength;

export function expectedIdempotencyKey(observation){
  return `observation:${observation?.eventId||''}:${observation?.observationId||''}`;
}

export function validateObservationIngress(observation,{nowMs=Date.now(),idempotencyKey}={}){
  const errors=[];
  if(!observation||typeof observation!=='object'||Array.isArray(observation))return Object.freeze({valid:false,errors:['observation must be an object']});
  if(byteLength(observation)>MAX_INGESTION_BYTES)errors.push('request exceeds size limit');
  if(!hasOnly(observation,TOP_LEVEL_KEYS))errors.push('observation contains unsupported keys');
  if(observation.schemaVersion!==INGESTION_SCHEMA_VERSION)errors.push('unsupported schemaVersion');
  if(observation.algorithmVersion!=='capture-v1'||observation.captureSource!=='browser.geolocation')errors.push('capture metadata is invalid');
  for(const key of ['eventId','observationId','riderId','deviceSessionId']){
    if(typeof observation[key]!=='string'||!IDENTIFIER.test(observation[key]))errors.push(`${key} is invalid`);
  }
  if(observation.checkpointId!==null&&(typeof observation.checkpointId!=='string'||!IDENTIFIER.test(observation.checkpointId)))errors.push('checkpointId is invalid');
  if(!Number.isSafeInteger(observation.sequence)||observation.sequence<0||observation.sequence>Number.MAX_SAFE_INTEGER)errors.push('sequence is invalid');
  if(!finite(observation.occurredAt)||observation.occurredAt>nowMs+MAX_FUTURE_SKEW_MS||observation.occurredAt<nowMs-MAX_OBSERVATION_AGE_MS)errors.push('occurredAt is outside the accepted window');
  for(const key of ['createdAt','updatedAt','nextAttemptAt'])if(!validIso(observation[key]))errors.push(`${key} is invalid`);
  if(observation.lifecycleState!=='captured'||observation.syncState!=='pending')errors.push('observation state is invalid');
  if(!hasOnly(observation.observed,OBSERVED_KEYS)||!hasOnly(observation.observed?.location,LOCATION_KEYS))errors.push('observed sample contains unsupported keys');
  const sample=observation.observed||{},location=sample.location||{};
  if(!finite(sample.timestampMs)||sample.timestampMs!==observation.occurredAt)errors.push('sample timestamp does not match occurredAt');
  if(!finite(location.lat)||location.lat<-90||location.lat>90)errors.push('latitude is out of bounds');
  if(!finite(location.lon)||location.lon<-180||location.lon>180)errors.push('longitude is out of bounds');
  if(!optionalFinite(sample.accuracyMeters,0,10000))errors.push('accuracy is out of bounds');
  if(!optionalFinite(sample.altitudeMeters,-1000,20000))errors.push('altitude is out of bounds');
  if(!optionalFinite(sample.altitudeAccuracyMeters,0,10000))errors.push('altitude accuracy is out of bounds');
  if(!optionalFinite(sample.headingDegrees,0,360))errors.push('heading is out of bounds');
  if(!optionalFinite(sample.speedMetersPerSecond,0,200))errors.push('speed is out of bounds');
  if(!Array.isArray(observation.evidenceRefs)||observation.evidenceRefs.length>16||observation.evidenceRefs.some(value=>typeof value!=='string'||value.length>256))errors.push('evidenceRefs is invalid');
  const quality=observation.derived?.quality;
  if(!hasOnly(observation.derived,DERIVED_KEYS)||!hasOnly(quality,QUALITY_KEYS)||!hasOnly(quality?.inputs,QUALITY_INPUT_KEYS))errors.push('derived quality contains unsupported keys');
  if(!['accepted','degraded'].includes(quality?.classification)||!finite(quality?.score)||quality.score<0||quality.score>1)errors.push('derived quality is invalid');
  if(!finite(quality?.inputs?.ageMs)||quality.inputs.ageMs<0||quality.inputs.ageMs>MAX_OBSERVATION_AGE_MS||quality.inputs.accuracyMeters!==sample.accuracyMeters)errors.push('quality inputs are invalid');
  if(!Array.isArray(quality?.reasons)||quality.reasons.length>16||quality.reasons.some(value=>typeof value!=='string'||value.length>64))errors.push('quality reasons are invalid');
  if(idempotencyKey!==undefined&&idempotencyKey!==expectedIdempotencyKey(observation))errors.push('idempotency key does not match observation');
  return Object.freeze({valid:errors.length===0,errors:Object.freeze(errors)});
}
