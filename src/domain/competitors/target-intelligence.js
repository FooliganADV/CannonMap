import {distanceMeters,pointTime} from './trails.js';

const METERS_PER_SECOND_TO_MPH=2.236936;
const finite=value=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value));
const median=values=>{
  const rows=values.filter(finite).map(Number).sort((left,right)=>left-right);
  if(!rows.length)return null;
  const middle=Math.floor(rows.length/2);
  return rows.length%2?rows[middle]:(rows[middle-1]+rows[middle])/2;
};

export const TARGET_INTELLIGENCE_STATE=Object.freeze({
  UNKNOWN:'UNKNOWN',
  APPROACHING:'APPROACHING',
  NEAR_TARGET:'NEAR TARGET',
  STOPPED_NEAR_TARGET:'STOPPED NEAR TARGET',
  DEPARTED:'DEPARTED'
});

export const TARGET_INTELLIGENCE_DEFAULTS=Object.freeze({
  vicinityRadiusMeters:152.4,
  exitHysteresisMeters:60.96,
  dwellJitterMeters:15.24,
  candidateRadiusMeters:1609.344,
  minimumIndependentIntervalMs:500,
  approachMinimumObservations:4,
  approachMinimumDurationMs:15_000,
  approachMinimumClosureMeters:30.48,
  approachMinimumDecreaseRatio:.7,
  approachWindowMs:2*60*1000,
  approachMaximumObservations:32,
  distanceNoiseMeters:5,
  dwellMinimumDurationMs:30_000,
  dwellMinimumObservations:4,
  dwellMaximumIntervalMs:30_000,
  departureMinimumDurationMs:15_000,
  departureMinimumObservations:4,
  departureMinimumClosureMeters:30.48,
  departureMinimumOutwardRatio:.7,
  evidenceFreshnessMs:2*60*1000,
  relevantHistoryMs:5*60*1000,
  maxRelevantObservations:360,
  maxRelevantTargets:256,
  maxTargetCandidates:8,
  targetAmbiguityMeters:60.96,
  maximumDerivedSpeedMph:130,
  activityRetentionMs:5*60*1000,
  maxActivityRecords:360
});

const targetPoint=target=>{
  const coordinates=target?.geometry?.coordinates;
  return Array.isArray(coordinates)&&coordinates.length>=2?{lat:coordinates[1],lon:coordinates[0]}:target?.point||target;
};
const targetIdentity=(target,index)=>{
  const point=targetPoint(target),id=target?.id??target?.targetId??target?.objectiveId;
  if(id===undefined||id===null||String(id).trim()===''||!finite(point?.lat)||!finite(point?.lon))return null;
  return Object.freeze({id:String(id),label:String(target?.label??target?.name??id),point:{lat:Number(point.lat),lon:Number(point.lon)},sourceIndex:index});
};
const sameObservation=(left,right)=>Boolean(left&&right&&pointTime(left)===pointTime(right)&&Number(left.lat)===Number(right.lat)&&Number(left.lon)===Number(right.lon));
const validTacticalTrail=value=>Boolean(value&&Array.isArray(value.points)&&Array.isArray(value.segments)&&value.segments.every(Array.isArray)&&Object.hasOwn(value,'latest'));
const recentSegment=tacticalTrail=>{
  if(!validTacticalTrail(tacticalTrail)||!tacticalTrail.latest)return null;
  const segment=tacticalTrail.segments.at(-1)||[];
  return segment.length&&sameObservation(segment.at(-1),tacticalTrail.latest)?segment:null;
};

function independentObservations(points,minimumIntervalMs){
  const rows=[];
  for(const point of points){
    if(!rows.length||pointTime(point)-pointTime(rows.at(-1))>=minimumIntervalMs)rows.push(point);
  }
  return rows;
}

function boundedRecentObservations(segment,cutoff,maximum){
  let low=0,high=segment.length,boundaryChecks=0;
  while(low<high){
    const middle=Math.floor((low+high)/2);boundaryChecks++;
    if(pointTime(segment[middle])<cutoff)low=middle+1;
    else high=middle;
  }
  const rawCount=segment.length-low,start=Math.max(low,segment.length-maximum);
  return {points:segment.slice(start),rawCount,boundaryChecks,truncated:rawCount>maximum};
}

function pointSpeedMph(segment,index,maximumSpeedMph){
  const source=segment[index];
  if(finite(source?.speedMph)&&Number(source.speedMph)>=0&&Number(source.speedMph)<=maximumSpeedMph)return Number(source.speedMph);
  const speeds=[];
  for(const pair of [[index-1,index],[index,index+1]]){
    const from=segment[pair[0]],to=segment[pair[1]];
    if(!from||!to)continue;
    const elapsedMs=pointTime(to)-pointTime(from);
    if(elapsedMs<=0)continue;
    const speed=distanceMeters(from,to)/(elapsedMs/1000)*METERS_PER_SECOND_TO_MPH;
    if(Number.isFinite(speed)&&speed<=maximumSpeedMph)speeds.push(speed);
  }
  return median(speeds);
}

function closestApproach(segment,target,maximumSpeedMph){
  let index=-1,distance=Infinity;
  for(let candidateIndex=0;candidateIndex<segment.length;candidateIndex++){
    const candidateDistance=distanceMeters(segment[candidateIndex],target.point);
    if(candidateDistance<distance){distance=candidateDistance;index=candidateIndex;}
  }
  if(index<0)return null;
  return Object.freeze({targetId:target.id,distanceMeters:distance,timestamp:new Date(pointTime(segment[index])).toISOString(),speedMph:pointSpeedMph(segment,index,maximumSpeedMph)});
}

function approachEvidence(segment,distances,latestAt,config){
  const startAt=latestAt-config.approachWindowMs;
  const indexed=segment.map((point,index)=>({point,index,time:pointTime(point)})).filter(item=>item.time>=startAt).slice(-config.approachMaximumObservations);
  if(indexed.length<config.approachMinimumObservations)return {approaching:false,ambiguous:false,reason:'insufficient-approach-observations',supportingObservationCount:indexed.length,durationMs:indexed.length>1?indexed.at(-1).time-indexed[0].time:0,closureMeters:null,decreaseRatio:null};
  const durationMs=indexed.at(-1).time-indexed[0].time;
  const closureMeters=distances[indexed[0].index]-distances[indexed.at(-1).index];
  let decreases=0,increases=0;
  for(let position=1;position<indexed.length;position++){
    const delta=distances[indexed[position-1].index]-distances[indexed[position].index];
    if(delta>config.distanceNoiseMeters)decreases++;
    else if(delta<-config.distanceNoiseMeters)increases++;
  }
  const directional=decreases+increases,decreaseRatio=directional?decreases/directional:0;
  const sufficient=durationMs>=config.approachMinimumDurationMs&&closureMeters>=config.approachMinimumClosureMeters;
  const approaching=sufficient&&decreaseRatio>=config.approachMinimumDecreaseRatio&&decreases>increases;
  return {approaching,ambiguous:sufficient&&!approaching,reason:approaching?'approaching-target':sufficient?'ambiguous-approach':'insufficient-approach-trend',supportingObservationCount:indexed.length,durationMs,closureMeters,decreaseRatio};
}

function dwellEvidence(segment,distances,config){
  let start=segment.length;
  const tolerance=config.vicinityRadiusMeters+config.dwellJitterMeters;
  while(start>0&&distances[start-1]<=tolerance){
    if(start<segment.length&&pointTime(segment[start])-pointTime(segment[start-1])>config.dwellMaximumIntervalMs)break;
    start--;
  }
  const run=segment.slice(start),durationMs=run.length>1?pointTime(run.at(-1))-pointTime(run[0]):0;
  const stopped=run.length>=config.dwellMinimumObservations&&durationMs>=config.dwellMinimumDurationMs;
  return {stopped,durationMs:stopped?durationMs:0,observedDurationMs:durationMs,supportingObservationCount:run.length,startedAt:run.length?new Date(pointTime(run[0])).toISOString():null};
}

function departureEvidence(segment,distances,config){
  let lastInside=-1;
  for(let index=0;index<distances.length;index++)if(distances[index]<=config.vicinityRadiusMeters)lastInside=index;
  if(lastInside<0||lastInside===segment.length-1)return {departed:false,ambiguous:false,entered:lastInside>=0,supportingObservationCount:lastInside>=0?1:0,timestamp:null};
  const exitRadius=config.vicinityRadiusMeters+config.exitHysteresisMeters,after=segment.slice(lastInside+1);
  let outsideStart=after.length;
  while(outsideStart>0&&distances[lastInside+outsideStart]>=exitRadius)outsideStart--;
  const outside=after.slice(outsideStart),evidence=[segment[lastInside],...outside],durationMs=outside.length?pointTime(outside.at(-1))-pointTime(segment[lastInside]):0;
  const evidenceDistances=[distances[lastInside],...distances.slice(lastInside+1+outsideStart)];
  const netOutwardMeters=outside.length?distances.at(-1)-distances[lastInside]:0;
  let outward=0,inward=0;
  for(let index=1;index<evidenceDistances.length;index++){
    const delta=evidenceDistances[index]-evidenceDistances[index-1];
    if(delta>config.distanceNoiseMeters)outward++;
    else if(delta<-config.distanceNoiseMeters)inward++;
  }
  const directional=outward+inward,outwardRatio=directional?outward/directional:0;
  const departed=evidence.length>=config.departureMinimumObservations&&durationMs>=config.departureMinimumDurationMs&&netOutwardMeters>=config.departureMinimumClosureMeters&&outwardRatio>=config.departureMinimumOutwardRatio&&outward>inward;
  return {departed,ambiguous:!departed,entered:true,supportingObservationCount:evidence.length,timestamp:departed?new Date(pointTime(outside[0])).toISOString():null,durationMs,netOutwardMeters,outwardRatio};
}

function analyzeCandidate(segment,target,config,motion){
  const distances=segment.map(point=>distanceMeters(point,target.point)),latestDistanceMeters=distances.at(-1),latestAt=pointTime(segment.at(-1));
  const closest=closestApproach(segment,target,config.maximumDerivedSpeedMph),dwell=dwellEvidence(segment,distances,config),departure=departureEvidence(segment,distances,config);
  const approach=approachEvidence(segment,distances,latestAt,config);
  let state=TARGET_INTELLIGENCE_STATE.UNKNOWN,reason='insufficient-target-evidence',ambiguous=false,supportingObservationCount=0,transitionTimestamp=null,dwellDurationMs=0;
  if(latestDistanceMeters<=config.vicinityRadiusMeters){
    if(dwell.stopped&&motion==='stationary'){state=TARGET_INTELLIGENCE_STATE.STOPPED_NEAR_TARGET;reason='contiguous-stationary-dwell';supportingObservationCount=dwell.supportingObservationCount;transitionTimestamp=dwell.startedAt;dwellDurationMs=dwell.durationMs;}
    else{state=TARGET_INTELLIGENCE_STATE.NEAR_TARGET;reason='accepted-fix-inside-vicinity';supportingObservationCount=1;transitionTimestamp=new Date(latestAt).toISOString();}
  }else if(departure.departed&&motion==='moving'){
    state=TARGET_INTELLIGENCE_STATE.DEPARTED;reason='confirmed-same-segment-departure';supportingObservationCount=departure.supportingObservationCount;transitionTimestamp=departure.timestamp;
  }else if(departure.departed){
    reason='motion-not-moving-for-departure';ambiguous=true;supportingObservationCount=departure.supportingObservationCount;
  }else if(departure.ambiguous){
    reason='ambiguous-departure';ambiguous=true;supportingObservationCount=departure.supportingObservationCount;
  }else if(approach.approaching&&motion==='moving'){
    state=TARGET_INTELLIGENCE_STATE.APPROACHING;reason='confirmed-decreasing-distance-trend';supportingObservationCount=approach.supportingObservationCount;transitionTimestamp=new Date(pointTime(segment.at(-approach.supportingObservationCount))).toISOString();
  }else if(approach.approaching){
    reason='motion-not-moving-for-approach';ambiguous=true;supportingObservationCount=approach.supportingObservationCount;
  }else{
    reason=approach.reason;ambiguous=approach.ambiguous;supportingObservationCount=approach.supportingObservationCount;
  }
  return {target,state,reason,ambiguous,latestDistanceMeters,dwellDurationMs,closestApproach:closest,supportingObservationCount,transitionTimestamp,enteredVicinity:departure.entered,diagnostics:{approach,dwell,departure}};
}

function unknownResult({riderId=null,target=null,reason,now,latest=null,telemetryAgeMs=null,pending=false,relevantObservationCount=0,candidateTargetCount=0,ambiguous=false,context=null,supportingObservationCount=0,diagnostics={}}){
  return Object.freeze({
    state:TARGET_INTELLIGENCE_STATE.UNKNOWN,reason,riderId:riderId===null?null:String(riderId),targetId:target?.id||null,targetLabel:target?.label||null,
    latestDistanceMeters:target&&latest?distanceMeters(latest,target.point):null,dwellDurationMs:0,closestApproach:null,supportingObservationCount,
    transitionTimestamp:null,activityId:null,
    diagnostics:Object.freeze({ambiguous,pendingObservation:pending,telemetryAgeMs,relevantObservationCount,candidateTargetCount,candidateChecks:0,acceptedPointChecks:0,rawRelevantObservationCount:0,cappedRelevantObservationCount:0,evaluatedAt:new Date(now).toISOString(),context:context?Object.freeze({...context}):null,...diagnostics})
  });
}

/**
 * Conservative target analysis over an already validated CannonMap tactical
 * derivation. Raw observations are intentionally not accepted by this API.
 * Only the latest accepted segment is scanned, so gaps, session changes,
 * relocations, pending fixes, and quarantined fixes cannot be bridged.
 */
export function analyzeTargetIntelligence({riderId=null,tacticalTrail=null,telemetryStatus=null,targets=[],context=null,now=Date.now(),options={}}={}){
  const config={...TARGET_INTELLIGENCE_DEFAULTS,...options},segmentSource=recentSegment(tacticalTrail),latest=tacticalTrail?.latest||null;
  if(!segmentSource)return unknownResult({riderId,reason:'missing-or-inconsistent-tactical-trail',now,latest,context});
  const latestAt=pointTime(latest),telemetryAgeMs=Math.max(0,now-latestAt),status=typeof telemetryStatus==='string'?telemetryStatus:telemetryStatus?.status,motion=typeof telemetryStatus==='object'?telemetryStatus?.motion:null;
  const validTargets=(targets||[]).map(targetIdentity).filter(Boolean);
  if(tacticalTrail.pending||telemetryStatus?.pendingObservation)return unknownResult({riderId,reason:'pending-tactical-observation',now,latest,telemetryAgeMs,pending:true,candidateTargetCount:validTargets.length,context});
  if(status&&status!=='live')return unknownResult({riderId,reason:`telemetry-${status}`,now,latest,telemetryAgeMs,candidateTargetCount:validTargets.length,context});
  if(telemetryAgeMs>config.evidenceFreshnessMs)return unknownResult({riderId,reason:'stale-telemetry',now,latest,telemetryAgeMs,candidateTargetCount:validTargets.length,context});
  if(validTargets.length>config.maxRelevantTargets)return unknownResult({riderId,reason:'target-catalog-overflow',now,latest,telemetryAgeMs,candidateTargetCount:validTargets.length,ambiguous:true,context,diagnostics:{maximumRelevantTargets:config.maxRelevantTargets,candidateChecks:0,acceptedPointChecks:0,rawRelevantObservationCount:0,cappedRelevantObservationCount:0}});
  const cutoff=latestAt-config.relevantHistoryMs,recentWindow=boundedRecentObservations(segmentSource,cutoff,config.maxRelevantObservations),recent=recentWindow.points;
  const segment=independentObservations(recent,config.minimumIndependentIntervalMs);
  const historyDiagnostics={rawRelevantObservationCount:recentWindow.rawCount,cappedRelevantObservationCount:recent.length,relevantObservationTruncated:recentWindow.truncated,maximumRelevantObservations:config.maxRelevantObservations,historyBoundaryChecks:recentWindow.boundaryChecks,acceptedPointChecks:recent.length,candidateChecks:validTargets.length};
  if(!segment.length)return unknownResult({riderId,reason:'no-independent-observations',now,latest,telemetryAgeMs,candidateTargetCount:validTargets.length,context,diagnostics:historyDiagnostics});
  if(segment.length<2)return unknownResult({riderId,reason:'insufficient-independent-observations',now,latest,telemetryAgeMs,relevantObservationCount:segment.length,candidateTargetCount:validTargets.length,context,diagnostics:historyDiagnostics});
  const candidates=validTargets.map(target=>({target,minimumDistanceMeters:Math.min(...segment.map(point=>distanceMeters(point,target.point))),latestDistanceMeters:distanceMeters(latest,target.point)}))
    .filter(item=>item.minimumDistanceMeters<=config.candidateRadiusMeters)
    .sort((left,right)=>left.minimumDistanceMeters-right.minimumDistanceMeters||left.latestDistanceMeters-right.latestDistanceMeters||left.target.id.localeCompare(right.target.id));
  if(!candidates.length)return unknownResult({riderId,reason:'no-target-within-candidate-radius',now,latest,telemetryAgeMs,relevantObservationCount:segment.length,candidateTargetCount:0,context,diagnostics:historyDiagnostics});
  if(candidates.length>config.maxTargetCandidates)return unknownResult({riderId,reason:'candidate-target-overflow',now,latest,telemetryAgeMs,relevantObservationCount:segment.length,candidateTargetCount:candidates.length,ambiguous:true,context,diagnostics:{...historyDiagnostics,maximumTargetCandidates:config.maxTargetCandidates}});
  const analyses=candidates.map(item=>analyzeCandidate(segment,item.target,config,motion)),rank=new Map([[TARGET_INTELLIGENCE_STATE.STOPPED_NEAR_TARGET,4],[TARGET_INTELLIGENCE_STATE.NEAR_TARGET,3],[TARGET_INTELLIGENCE_STATE.DEPARTED,2],[TARGET_INTELLIGENCE_STATE.APPROACHING,1],[TARGET_INTELLIGENCE_STATE.UNKNOWN,0]]);
  analyses.sort((left,right)=>rank.get(right.state)-rank.get(left.state)||left.latestDistanceMeters-right.latestDistanceMeters||left.target.id.localeCompare(right.target.id));
  const selected=analyses[0],sameRank=analyses.filter(item=>rank.get(item.state)===rank.get(selected.state));
  const ambiguousTarget=sameRank.length>1&&Math.abs(sameRank[1].latestDistanceMeters-selected.latestDistanceMeters)<=config.targetAmbiguityMeters;
  if(ambiguousTarget)return unknownResult({riderId,target:null,reason:'ambiguous-target-match',now,latest,telemetryAgeMs,relevantObservationCount:segment.length,candidateTargetCount:candidates.length,ambiguous:true,context,diagnostics:{...historyDiagnostics,candidateStates:sameRank.slice(0,config.maxTargetCandidates).map(item=>Object.freeze({targetId:item.target.id,state:item.state,latestDistanceMeters:item.latestDistanceMeters}))}});
  if(selected.state===TARGET_INTELLIGENCE_STATE.UNKNOWN)return unknownResult({riderId,target:null,reason:selected.reason,now,latest,telemetryAgeMs,relevantObservationCount:segment.length,candidateTargetCount:candidates.length,ambiguous:selected.ambiguous,context,supportingObservationCount:selected.supportingObservationCount,diagnostics:{...historyDiagnostics,candidateState:Object.freeze({targetId:selected.target.id,state:selected.state,latestDistanceMeters:selected.latestDistanceMeters}),...selected.diagnostics}});
  const scopeId=String(context?.scopeId??context?.eventId??context?.projectId??''),activityId=[scopeId,String(riderId??'unknown'),selected.target.id,selected.state].join('|');
  return Object.freeze({
    state:selected.state,reason:selected.reason,riderId:riderId===null?null:String(riderId),targetId:selected.target.id,targetLabel:selected.target.label,
    latestDistanceMeters:selected.latestDistanceMeters,dwellDurationMs:selected.dwellDurationMs,closestApproach:selected.closestApproach,
    supportingObservationCount:selected.supportingObservationCount,transitionTimestamp:selected.transitionTimestamp,activityId,
    diagnostics:Object.freeze({ambiguous:false,pendingObservation:false,telemetryAgeMs,motion,relevantObservationCount:segment.length,candidateTargetCount:candidates.length,enteredVicinity:selected.enteredVicinity,evaluatedAt:new Date(now).toISOString(),context:context?Object.freeze({...context}):null,...historyDiagnostics,...selected.diagnostics})
  });
}

/** Keeps one latest record for each rider/target/state transition class. */
export function mergeRecentTargetActivity(existing,incoming,{now=Date.now(),retentionMs=TARGET_INTELLIGENCE_DEFAULTS.activityRetentionMs,maxRecords=TARGET_INTELLIGENCE_DEFAULTS.maxActivityRecords}={}){
  const rows=new Map();
  for(const item of [...(existing||[]),...(Array.isArray(incoming)?incoming:[incoming])]){
    if(!item||item.state===TARGET_INTELLIGENCE_STATE.UNKNOWN||!item.activityId)continue;
    const observedAt=Date.parse(item.diagnostics?.evaluatedAt||item.transitionTimestamp||'');
    if(!Number.isFinite(observedAt)||now-observedAt>retentionMs)continue;
    const prior=rows.get(item.activityId),priorAt=Date.parse(prior?.diagnostics?.evaluatedAt||prior?.transitionTimestamp||'');
    if(!prior||observedAt>=priorAt)rows.set(item.activityId,item);
  }
  return [...rows.values()].sort((left,right)=>Date.parse(right.diagnostics?.evaluatedAt||right.transitionTimestamp)-Date.parse(left.diagnostics?.evaluatedAt||left.transitionTimestamp)||left.activityId.localeCompare(right.activityId)).slice(0,Math.max(1,Number(maxRecords)||1));
}
