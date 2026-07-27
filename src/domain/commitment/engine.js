import {COMMITMENT_ALGORITHM_VERSION,COMMITMENT_RECORD_KIND,COMMITMENT_SCHEMA_VERSION,validateCommitmentInference} from './contract.js';
import {createObservationEvidence,deterministicId,evidenceRef} from './evidence.js';

const EARTH_RADIUS_METERS=6371008.8;
const radians=value=>value*Math.PI/180;
const clamp=value=>Math.max(0,Math.min(1,value));
const distanceMeters=(left,right)=>{
  const lat1=radians(left.lat),lat2=radians(right.lat),deltaLat=lat2-lat1,deltaLon=radians(right.lon-left.lon);
  const a=Math.sin(deltaLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(deltaLon/2)**2;
  return 2*EARTH_RADIUS_METERS*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
};
const unique=values=>[...new Set(values)];
const iso=milliseconds=>new Date(milliseconds).toISOString();
const observationLocation=observation=>observation.observed?.location||observation.location;
const evidenceRefsFor=(observations,evidenceByObservation)=>unique(observations.map(item=>evidenceRef(evidenceByObservation.get(item.observationId))));
const signal=(name,statement,observations,evidenceByObservation,score)=>Object.freeze({
  signal:name,statement,evidenceRefs:Object.freeze(evidenceRefsFor(observations,evidenceByObservation)),score:Number(clamp(score).toFixed(3))
});

export function inferCommitment({eventId,competitorId,checkpoint,observations,nowMs=Date.now()}={}){
  if(!eventId||!competitorId||!checkpoint?.checkpointId)return Object.freeze({status:'insufficient-evidence',reason:'missing-context',diagnostics:{signalCount:0,observationCount:0}});
  const center=checkpoint.location||checkpoint.geometry?.location||checkpoint.geometry;
  if(!Number.isFinite(center?.lat)||!Number.isFinite(center?.lon))return Object.freeze({status:'insufficient-evidence',reason:'missing-checkpoint-geometry',diagnostics:{signalCount:0,observationCount:0}});
  const recent=(Array.isArray(observations)?observations:[])
    .filter(item=>item&&item.eventId===eventId&&item.competitorId===competitorId&&Number.isFinite(item.occurredAt)&&nowMs-item.occurredAt<=10*60*1000&&nowMs-item.occurredAt>=-60*1000&&observationLocation(item))
    .sort((left,right)=>left.occurredAt-right.occurredAt);
  if(recent.length<3)return Object.freeze({status:'insufficient-evidence',reason:'too-few-observations',diagnostics:{signalCount:0,observationCount:recent.length}});
  const evidence=recent.map(observation=>createObservationEvidence({eventId,competitorId,observation}));
  const evidenceByObservation=new Map(recent.map((observation,index)=>[observation.observationId,evidence[index]]));
  const radius=Math.max(25,Math.min(500,Number(checkpoint.radiusMeters)||100));
  const measured=recent.map(observation=>({observation,distance:distanceMeters(observationLocation(observation),center)}));
  const near=measured.filter(item=>item.distance<=radius+Math.min(100,Math.max(0,Number(item.observation.observed?.accuracyMeters)||0)));
  const elapsed=recent.at(-1).occurredAt-recent[0].occurredAt;
  const nearElapsed=near.length>1?near.at(-1).observation.occurredAt-near[0].observation.occurredAt:0;
  const signals=[];
  if(near.length>=2&&nearElapsed>=30000)signals.push(signal(
    'proximity-persistence',
    `${near.length} validated observations remained within the checkpoint accuracy-adjusted radius for ${Math.round(nearElapsed/1000)} seconds.`,
    near.map(item=>item.observation),evidenceByObservation,near.length/recent.length
  ));
  const first=measured[0],last=measured.at(-1),approachGain=first.distance-last.distance;
  if(elapsed>=60000&&approachGain>=100&&last.distance<=Math.max(500,radius*3))signals.push(signal(
    'sustained-approach',
    `Validated positions approached the checkpoint by ${Math.round(approachGain)} meters over ${Math.round(elapsed/1000)} seconds.`,
    [first.observation,last.observation],evidenceByObservation,approachGain/500
  ));
  if(near.length>=3&&nearElapsed>=60000)signals.push(signal(
    'checkpoint-dwell',
    `${near.length} validated observations show checkpoint-area presence spanning ${Math.round(nearElapsed/1000)} seconds.`,
    near.map(item=>item.observation),evidenceByObservation,nearElapsed/180000
  ));
  const hasAnchor=signals.some(item=>item.signal==='proximity-persistence'||item.signal==='checkpoint-dwell');
  if(!hasAnchor||signals.length<2)return Object.freeze({
    status:'insufficient-evidence',reason:hasAnchor?'independent-signals-required':'checkpoint-presence-required',
    diagnostics:Object.freeze({signalCount:signals.length,observationCount:recent.length})
  });
  const refs=unique(signals.flatMap(item=>item.evidenceRefs)).sort();
  const spatialConsistency=near.length/recent.length;
  const temporalConsistency=clamp(Math.max(elapsed,nearElapsed)/180000);
  const evidenceStrength=clamp(signals.length/3*0.65+Math.min(refs.length,6)/6*0.35);
  const confirmed=signals.some(item=>item.signal==='checkpoint-dwell')&&evidenceStrength>=0.72&&spatialConsistency>=0.6;
  const lifecycleState=confirmed?'confirmed':'candidate';
  const traceId=deterministicId('trace',[eventId,competitorId,checkpoint.checkpointId,...recent.map(item=>item.observationId)]);
  const inferenceId=deterministicId('commitment',[traceId,COMMITMENT_ALGORITHM_VERSION]);
  const timestamp=iso(nowMs);
  const inference=Object.freeze({
    schemaVersion:COMMITMENT_SCHEMA_VERSION,algorithmVersion:COMMITMENT_ALGORITHM_VERSION,
    inferenceId,competitorId,eventId,checkpointId:checkpoint.checkpointId,
    createdAt:timestamp,updatedAt:timestamp,lifecycleState,assertionKind:COMMITMENT_RECORD_KIND,
    confidenceDimensions:Object.freeze({
      evidenceStrength:Object.freeze({score:Number(evidenceStrength.toFixed(3)),method:'independent-signal-coverage',version:1}),
      spatialConsistency:Object.freeze({score:Number(spatialConsistency.toFixed(3)),method:'checkpoint-radius-observation-ratio',version:1}),
      temporalConsistency:Object.freeze({score:Number(temporalConsistency.toFixed(3)),method:'evidence-window-duration',version:1})
    }),
    evidenceRefs:Object.freeze(refs),
    explanation:Object.freeze({
      summary:`${lifecycleState==='confirmed'?'Confirmed':'Candidate'} checkpoint commitment inferred from ${signals.length} independent evidence signals; this is not an observed fact.`,
      signals:Object.freeze(signals),
      limitations:Object.freeze(['Commitment is inferred from recent validated observations only.','No rider-entered intent or route-family output was used.'])
    }),
    traceId,active:true
  });
  const validation=validateCommitmentInference(inference);
  if(!validation.valid)throw new Error(`Commitment inference contract failed: ${validation.errors.join(', ')}`);
  return Object.freeze({status:'inferred',inference,evidence:Object.freeze(evidence),diagnostics:Object.freeze({signalCount:signals.length,observationCount:recent.length})});
}
