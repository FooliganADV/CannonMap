const EARTH=6371008.8;
const METERS_PER_SECOND_TO_MPH=2.236936;
const rad=value=>value*Math.PI/180;
const finite=value=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value));
const clampHeading=value=>((Number(value)%360)+360)%360;
const TACTICAL_PROJECTION_CACHE=new WeakMap();
export const TACTICAL_PACE_DEFAULTS=Object.freeze({rollingPaceWindowMs:3*60*1000,rollingPaceMinimumMs:15*1000,sustainedPaceWindowMs:15*60*1000,sustainedPaceMinimumMs:10*60*1000,jitterMeters:3});
export function distanceMeters(a,b){const dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon),v=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;return 2*EARTH*Math.asin(Math.min(1,Math.sqrt(v)));}
export const pointTime=point=>{const raw=point?.time??point?.timestamp??point?.recordedAt;const value=typeof raw==='number'?raw:Date.parse(raw||'');return Number.isFinite(value)?value:0;};
export function stableCompetitorId(entry,index=0){const props=entry?.properties||{},rider=entry?.competitor||entry?.rider||{};const value=entry?.competitorId??entry?.id_competitor??entry?.riderId??entry?.id??props.competitorId??props.riderId??props.id??rider.id??rider.competitorId??entry?.number??rider.number;return value===undefined||value===null||String(value).trim()===''?`unidentified-${index+1}`:String(value);}
export const breadcrumbKey=point=>String(point?.observationId||point?.id||`${Number(point.lat).toFixed(6)}|${Number(point.lon).toFixed(6)}|${pointTime(point)}|${point?.sessionId||''}`);
const NORMALIZED_TRAIL=Symbol('cannonmap.normalizedTrail');
const TRAIL_KEYS=Symbol('cannonmap.trailKeys');
const markNormalized=(points,keys=null)=>{try{if(!points[NORMALIZED_TRAIL])Object.defineProperty(points,NORMALIZED_TRAIL,{value:true,configurable:true});if(keys||!points[TRAIL_KEYS])Object.defineProperty(points,TRAIL_KEYS,{value:keys??new Set(points.map(breadcrumbKey)),configurable:true});}catch{}return points;};
const comparePoints=(a,b)=>pointTime(a)-pointTime(b)||breadcrumbKey(a).localeCompare(breadcrumbKey(b));

export function normalizeTrailPoints(points,{now=Date.now(),historyMs=8*24*60*60*1000,maxPoints=12000}={}){
  if(points?.[NORMALIZED_TRAIL])return trimTrail(points,{now,historyMs,maxPoints,trimBatchPoints:Math.min(256,Math.max(1,maxPoints-1))});
  const unique=new Map();for(const point of points||[]){const lat=Number(point?.lat),lon=Number(point?.lon),time=pointTime(point);if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180||!time||time>now+60000||now-time>historyMs)continue;const normalized={...point,lat,lon,time:new Date(time).toISOString()};unique.set(breadcrumbKey(normalized),normalized);}
  return markNormalized([...unique.values()].sort(comparePoints).slice(-maxPoints));
}

const transitionBetween=(prior,point,{gapMs,maxSpeedMph,maxJumpMeters,equalTimestampMeters})=>{
  const elapsedMs=pointTime(point)-pointTime(prior),distance=distanceMeters(prior,point),normalizeSession=value=>value===null||value===undefined||String(value).trim()===''?null:String(value),priorSession=normalizeSession(prior?.sessionId),nextSession=normalizeSession(point?.sessionId),sessionChanged=priorSession!==nextSession&&(priorSession!==null||nextSession!==null),boundaryReason=sessionChanged?'session_changed':elapsedMs>gapMs?'telemetry_gap':null;
  if(boundaryReason){
    const validationSpeedMph=elapsedMs>0?distance/(elapsedMs/1000)*2.236936:null,implausibleTime=elapsedMs<=0?distance>equalTimestampMeters:validationSpeedMph>maxSpeedMph;
    return distance>maxJumpMeters||implausibleTime
      ?{type:'candidate',reason:'unconfirmed_relocation',boundaryReason,elapsedMs,distanceMeters:distance,speedMph:null,validationSpeedMph}
      :{type:'break',reason:boundaryReason,boundaryReason,elapsedMs,distanceMeters:distance,speedMph:null,validationSpeedMph};
  }
  if(elapsedMs<=0)return {type:distance<=equalTimestampMeters?'duplicate':'candidate',reason:distance<=equalTimestampMeters?'same_timestamp_duplicate':'conflicting_timestamp',elapsedMs,distanceMeters:distance,speedMph:null};
  const speedMph=distance/(elapsedMs/1000)*2.236936;
  return distance>maxJumpMeters||speedMph>maxSpeedMph
    ?{type:'candidate',reason:'implausible_jump',elapsedMs,distanceMeters:distance,speedMph}
    :{type:'continue',reason:null,elapsedMs,distanceMeters:distance,speedMph};
};

/**
 * Builds a derived tactical stream without deleting or rewriting durable raw
 * observations. A lone impossible/equal-time position remains pending and
 * cannot move the live marker. Two chronologically distinct, mutually
 * plausible observations confirm a genuine relocation as a new segment.
 */
export function deriveTacticalTrail(points,{gapMs=2*60*1000,maxSpeedMph=130,maxJumpMeters=25000,equalTimestampMeters=10,now=Date.now(),historyMs=8*24*60*60*1000,maxPoints=12000}={}){
  const ordered=normalizeTrailPoints(points,{now,historyMs,maxPoints}),segments=[],accepted=[],rejected=[];let current=[],pending=null;
  const append=point=>{current.push(point);accepted.push(point);};
  const start=point=>{if(current.length)segments.push(current);current=[];append(point);};
  const hold=(point,transition)=>({point,reason:transition.reason,boundaryReason:transition.boundaryReason||null,distanceMeters:transition.distanceMeters,speedMph:transition.speedMph,validationSpeedMph:transition.validationSpeedMph??null});
  for(const point of ordered){
    const prior=accepted.at(-1);if(!prior){append(point);continue;}
    const direct=transitionBetween(prior,point,{gapMs,maxSpeedMph,maxJumpMeters,equalTimestampMeters});
    if(pending){
      if(direct.type==='continue'){rejected.push(pending);pending=null;append(point);continue;}
      if(direct.type==='break'){rejected.push(pending);pending=null;start(point);continue;}
      const corroboration=transitionBetween(pending.point,point,{gapMs,maxSpeedMph,maxJumpMeters,equalTimestampMeters});
      if(direct.type==='candidate'&&corroboration.type==='continue'){
        start(pending.point);append(point);pending=null;continue;
      }
      if(direct.type==='duplicate'&&corroboration.type!=='continue'){
        rejected.push(hold(point,direct));continue;
      }
      rejected.push(pending);pending=hold(point,direct);continue;
    }
    if(direct.type==='continue'){append(point);continue;}
    if(direct.type==='break'){start(point);continue;}
    if(direct.type==='duplicate'){rejected.push(hold(point,direct));continue;}
    pending=hold(point,direct);
  }
  if(current.length)segments.push(current);
  return {points:accepted,segments,latest:accepted.at(-1)||null,pending,quarantined:pending?[...rejected,pending]:rejected};
}

/**
 * Keeps recent tactical breadcrumbs dense while bounding Leaflet geometry and
 * fingerprint work. Durable competitor history remains untouched.
 */
export function compactTrailForRender(points,{now=Date.now(),historyMs=8*60*60*1000,maxRenderPoints=720,recentMs=5*60*1000,maxRecentPoints=360}={}){
  const ordered=normalizeTrailPoints(points,{now,historyMs}),limit=Math.max(2,Number(maxRenderPoints)||720);
  if(ordered.length<=limit)return ordered;
  let recentStart=ordered.findIndex(point=>pointTime(point)>=now-Math.max(60_000,Number(recentMs)||5*60*1000));
  if(recentStart<0)recentStart=ordered.length;
  const sample=(rows,count)=>{
    if(rows.length<=count)return rows;
    if(count<=1)return [rows.at(-1)];
    const selected=[];for(let index=0;index<count;index++)selected.push(rows[Math.round(index*(rows.length-1)/(count-1))]);return selected;
  };
  const recent=sample(ordered.slice(recentStart),Math.min(limit-1,Math.max(1,Number(maxRecentPoints)||360))),olderBudget=Math.max(1,limit-recent.length),older=sample(ordered.slice(0,recentStart),olderBudget);
  const merged=[...older,...recent],seen=new Set();return merged.filter(point=>{const key=breadcrumbKey(point);if(seen.has(key))return false;seen.add(key);return true;}).slice(-limit);
}

const deviationFromChordMeters=(point,start,end,longitudeScale=(EARTH*Math.PI/180)*Math.cos(rad((start.lat+end.lat)/2)))=>{
  const latitudeScale=EARTH*Math.PI/180;
  const dx=(end.lon-start.lon)*longitudeScale,dy=(end.lat-start.lat)*latitudeScale,px=(point.lon-start.lon)*longitudeScale,py=(point.lat-start.lat)*latitudeScale,lengthSquared=dx*dx+dy*dy;
  if(lengthSquared===0)return Math.hypot(px,py);
  const position=Math.max(0,Math.min(1,(px*dx+py*dy)/lengthSquared));return Math.hypot(px-position*dx,py-position*dy);
};
const endpointCount=segments=>segments.reduce((count,segment)=>count+(segment.length===1?1:2),0);
const chosenCount=states=>states.reduce((count,state)=>count+state.selected.size,0);
const fillByBucketedDeviation=(states,requested,predicate=()=>true)=>{
  const spans=[];
  states.forEach((state,segmentIndex)=>{
    const selected=[...state.selected].sort((a,b)=>a-b);
    for(let position=1;position<selected.length;position++){
      const left=selected[position-1],right=selected[position],indices=[];
      for(let index=left+1;index<right;index++)if(!state.selected.has(index)&&predicate(state.points[index],index,segmentIndex))indices.push(index);
      if(indices.length)spans.push({segmentIndex,left,right,indices,allocation:0,remainder:0});
    }
  });
  const available=spans.reduce((count,span)=>count+span.indices.length,0),target=Math.min(Math.max(0,requested),available);if(!target)return 0;
  let assigned=0;for(const span of spans){const exact=target*span.indices.length/available;span.allocation=Math.floor(exact);span.remainder=exact-span.allocation;assigned+=span.allocation;}
  const ranked=[...spans].sort((a,b)=>b.remainder-a.remainder||b.indices.length-a.indices.length||b.segmentIndex-a.segmentIndex||a.left-b.left);
  for(let index=0;assigned<target;index=(index+1)%ranked.length){const span=ranked[index];if(span.allocation>=span.indices.length)continue;span.allocation++;assigned++;}
  for(const span of spans){
    const state=states[span.segmentIndex],count=span.indices.length,slots=span.allocation;
    for(let slot=0;slot<slots;slot++){
      const from=Math.floor(slot*count/slots),to=Math.floor((slot+1)*count/slots),leftIndex=from?span.indices[from-1]:span.left,rightIndex=to<count?span.indices[to]:span.right,midpoint=(from+to-1)/2,longitudeScale=(EARTH*Math.PI/180)*Math.cos(rad((state.points[leftIndex].lat+state.points[rightIndex].lat)/2));let bestIndex=span.indices[from],bestDeviation=-1,bestMidpointDistance=Infinity;
      for(let offset=from;offset<to;offset++){const candidateIndex=span.indices[offset],deviation=deviationFromChordMeters(state.points[candidateIndex],state.points[leftIndex],state.points[rightIndex],longitudeScale),midpointDistance=Math.abs(offset-midpoint);if(deviation>bestDeviation+1e-9||(Math.abs(deviation-bestDeviation)<=1e-9&&(midpointDistance<bestMidpointDistance||(midpointDistance===bestMidpointDistance&&candidateIndex<bestIndex)))){bestIndex=candidateIndex;bestDeviation=deviation;bestMidpointDistance=midpointDistance;}}
      state.selected.add(bestIndex);
    }
  }
  return target;
};

/**
 * Compacts already validated tactical segments independently, so a render
 * line can never bridge a session, telemetry gap, or confirmed relocation.
 * This is an independent deterministic fixed-budget bucketed-deviation
 * implementation. It selects existing point objects only; raw history and
 * the caller's segment arrays remain unchanged.
 */
export function compactTrailSegmentsForRender(segments,{now=Date.now(),maxRenderPoints=720,recentMs=5*60*1000,maxRecentPoints=360}={}){
  const limit=Math.max(2,Math.floor(Number(maxRenderPoints)||720)),recentCutoff=now-Math.max(60_000,Number(recentMs)||5*60*1000),recentLimit=Math.min(limit,Math.max(1,Math.floor(Number(maxRecentPoints)||360)));
  let retained=(segments||[]).filter(segment=>Array.isArray(segment)&&segment.length);
  const total=retained.reduce((count,segment)=>count+segment.length,0);if(total<=limit)return retained.map(segment=>segment.slice());
  if(endpointCount(retained)>limit){const newest=[];let required=0;for(let index=retained.length-1;index>=0;index--){const cost=retained[index].length===1?1:2;if(required+cost>limit)break;newest.unshift(retained[index]);required+=cost;}retained=newest;}
  if(!retained.length)return [];
  const states=retained.map(points=>({points,selected:new Set(points.length===1?[0]:[0,points.length-1])})),usable=retained.reduce((count,segment)=>count+segment.length,0);
  const recentTotal=retained.reduce((count,segment)=>count+segment.reduce((sum,point)=>sum+(pointTime(point)>=recentCutoff?1:0),0),0);
  const recentSelected=states.reduce((count,state)=>count+[...state.selected].reduce((sum,index)=>sum+(pointTime(state.points[index])>=recentCutoff?1:0),0),0);
  const recentTarget=Math.max(recentSelected,Math.min(recentTotal,recentLimit)),recentSlots=Math.min(recentTarget-recentSelected,limit-chosenCount(states));
  fillByBucketedDeviation(states,recentSlots,point=>pointTime(point)>=recentCutoff);
  fillByBucketedDeviation(states,Math.min(usable,limit)-chosenCount(states));
  return states.map(state=>[...state.selected].sort((a,b)=>a-b).map(index=>state.points[index]));
}

function trimTrail(points,{now,historyMs,maxPoints,trimBatchPoints}){
  if(!points.length)return markNormalized(points);
  const cutoff=now-historyMs;let firstValid=0;
  while(firstValid<points.length&&pointTime(points[firstValid])<cutoff)firstValid++;
  if(firstValid){
    const remaining=points.length-firstValid,minimumRetained=Math.min(remaining,Math.max(1,maxPoints-trimBatchPoints)),extra=Math.min(trimBatchPoints,Math.max(0,remaining-minimumRetained));
    points=points.slice(firstValid+extra);
  }
  if(points.length>maxPoints){const target=Math.max(1,maxPoints-Math.min(trimBatchPoints,maxPoints-1));points=points.slice(-target);}
  return markNormalized(points);
}

/**
 * Incremental bounded merge. The common one-second append/duplicate path is
 * O(new points); a linear merge is reserved for genuine out-of-order history.
 */
export function mergeTrailPoints(existing,incoming,{now=Date.now(),historyMs=8*24*60*60*1000,maxPoints=12000,trimBatchPoints=256}={}){
  const limit=Math.max(1,Number(maxPoints)||12000),batch=Math.max(1,Math.min(limit-1||1,Number(trimBatchPoints)||256)),prior=existing?.[NORMALIZED_TRAIL]?existing:normalizeTrailPoints(existing,{now,historyMs,maxPoints:limit}),next=normalizeTrailPoints(incoming,{now,historyMs,maxPoints:limit});
  if(!next.length)return {points:trimTrail(prior,{now,historyMs,maxPoints:limit,trimBatchPoints:batch}),added:0};
  if(!prior.length)return {points:trimTrail(next,{now,historyMs,maxPoints:limit,trimBatchPoints:batch}),added:next.length};
  const lastTime=pointTime(prior.at(-1)),appendable=next.every(point=>pointTime(point)>=lastTime);
  if(appendable){let added=0;const known=prior[TRAIL_KEYS]??new Set(prior.map(breadcrumbKey));for(const point of next){const key=breadcrumbKey(point);if(known.has(key))continue;prior.push(point);known.add(key);added++;}
    if(next.length>1)prior.sort(comparePoints);return {points:trimTrail(prior,{now,historyMs,maxPoints:limit,trimBatchPoints:batch}),added};
  }
  const priorKeys=new Set(prior.map(breadcrumbKey)),merged=[],seen=new Set();let left=0,right=0;
  while(left<prior.length||right<next.length){const takeLeft=right>=next.length||(left<prior.length&&comparePoints(prior[left],next[right])<=0),point=takeLeft?prior[left++]:next[right++],key=breadcrumbKey(point);if(seen.has(key))continue;seen.add(key);merged.push(point);}
  const points=trimTrail(merged,{now,historyMs,maxPoints:limit,trimBatchPoints:batch}),added=points.reduce((sum,point)=>sum+(priorKeys.has(breadcrumbKey(point))?0:1),0);return {points,added};
}

export function segmentTrail(points,{gapMs=2*60*1000,maxSpeedMph=130,maxJumpMeters=25000,now=Date.now(),historyMs=8*24*60*60*1000,maxPoints=12000}={}){
  const ordered=normalizeTrailPoints(points,{now,historyMs,maxPoints}),segments=[];let current=[];
  for(const point of ordered){const prior=current.at(-1);if(prior){const elapsed=(pointTime(point)-pointTime(prior))/1000,distance=distanceMeters(prior,point),speed=elapsed>0?distance/elapsed*2.236936:null;const sessionChanged=prior.sessionId&&point.sessionId&&String(prior.sessionId)!==String(point.sessionId);if(sessionChanged||elapsed*1000>gapMs||distance>maxJumpMeters||(speed!==null&&speed>maxSpeedMph)){if(current.length)segments.push(current);current=[];}}
    current.push(point);
  }if(current.length)segments.push(current);return segments;
}

const isTacticalTrail=value=>Boolean(value&&Array.isArray(value.points)&&Array.isArray(value.segments)&&value.segments.every(Array.isArray)&&Object.hasOwn(value,'latest'));

const bearingDegrees=(a,b)=>{
  const dLon=rad(b.lon-a.lon),lat1=rad(a.lat),lat2=rad(b.lat),y=Math.sin(dLon)*Math.cos(lat2),x=Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon);
  return clampHeading(Math.atan2(y,x)*180/Math.PI);
};

export function cardinalDirection(degrees){
  if(!finite(degrees))return null;
  return ['N','NE','E','SE','S','SW','W','NW'][Math.round(clampHeading(degrees)/45)%8];
}

export function directionArrow(degrees){
  if(!finite(degrees))return null;
  return ['↑','↗','→','↘','↓','↙','←','↖'][Math.round(clampHeading(degrees)/45)%8];
}

const paceIntervals=(segment,{maxSpeedMph,jitterMeters})=>{
  const intervals=[];
  for(let index=1;index<segment.length;index++){
    const prior=segment[index-1],point=segment[index],startedAt=pointTime(prior),endedAt=pointTime(point),durationMs=endedAt-startedAt;
    if(durationMs<=0)continue;
    const measuredDistanceMeters=distanceMeters(prior,point),speedMph=measuredDistanceMeters/(durationMs/1000)*METERS_PER_SECOND_TO_MPH;
    if(!Number.isFinite(speedMph)||speedMph>maxSpeedMph)continue;
    intervals.push({startedAt,endedAt,durationMs,distanceMeters:measuredDistanceMeters<=jitterMeters?0:measuredDistanceMeters});
  }
  return intervals;
};

const projectPaceWindow=(intervals,latestAt,windowMs,minimumCoverageMs)=>{
  const windowStart=latestAt-windowMs;let coverageMs=0,distance=0,sampleCount=0;
  for(const interval of intervals){
    const overlapStart=Math.max(windowStart,interval.startedAt),overlapEnd=Math.min(latestAt,interval.endedAt),overlapMs=overlapEnd-overlapStart;
    if(overlapMs<=0)continue;
    coverageMs+=overlapMs;distance+=interval.distanceMeters*(overlapMs/interval.durationMs);sampleCount++;
  }
  const paceMph=sampleCount&&coverageMs>=minimumCoverageMs?distance/(coverageMs/1000)*METERS_PER_SECOND_TO_MPH:null;
  return {paceMph,coverageMs,coverageRatio:Math.min(1,coverageMs/windowMs),sampleCount,sufficient:paceMph!==null};
};

/**
 * Adds pace metadata to the already validated tactical stream. Only the most
 * recent accepted segment contributes: quarantined observations, telemetry
 * gaps, and source-session boundaries can never be bridged by a pace window.
 * The WeakMap keeps repeated UI consumers O(1) for the same cached derivation.
 */
export function deriveTacticalProjection(points,{now=Date.now(),gapMs=2*60*1000,maxSpeedMph=130,maxJumpMeters=25000,tacticalTrail=null,rollingPaceWindowMs=TACTICAL_PACE_DEFAULTS.rollingPaceWindowMs,rollingPaceMinimumMs=TACTICAL_PACE_DEFAULTS.rollingPaceMinimumMs,sustainedPaceWindowMs=TACTICAL_PACE_DEFAULTS.sustainedPaceWindowMs,sustainedPaceMinimumMs=TACTICAL_PACE_DEFAULTS.sustainedPaceMinimumMs,jitterMeters=TACTICAL_PACE_DEFAULTS.jitterMeters}={}){
  const tactical=isTacticalTrail(tacticalTrail)?tacticalTrail:deriveTacticalTrail(points,{now,gapMs,maxSpeedMph,maxJumpMeters});
  const rollingWindow=Math.max(1000,Number(rollingPaceWindowMs)||TACTICAL_PACE_DEFAULTS.rollingPaceWindowMs),rollingMinimum=Math.max(0,Math.min(rollingWindow,Number(rollingPaceMinimumMs)||0)),sustainedWindow=Math.max(1000,Number(sustainedPaceWindowMs)||TACTICAL_PACE_DEFAULTS.sustainedPaceWindowMs),sustainedMinimum=Math.max(0,Math.min(sustainedWindow,Number(sustainedPaceMinimumMs)||0)),jitter=Math.max(0,Number(jitterMeters)||0),speedLimit=Math.max(1,Number(maxSpeedMph)||130);
  const cacheKey=`${rollingWindow}|${rollingMinimum}|${sustainedWindow}|${sustainedMinimum}|${jitter}|${speedLimit}`;
  let cache=TACTICAL_PROJECTION_CACHE.get(tactical);if(cache?.has(cacheKey))return cache.get(cacheKey);
  if(!cache){cache=new Map();TACTICAL_PROJECTION_CACHE.set(tactical,cache);}
  const segment=tactical.segments.at(-1)||[],latest=tactical.latest,empty=Object.freeze({rollingPaceMph:null,rollingCoverageMs:0,rollingCoverageRatio:0,rollingSampleCount:0,rollingPaceSufficient:false,sustainedPaceMph:null,sustainedCoverageMs:0,sustainedCoverageRatio:0,sustainedSampleCount:0,sustainedPaceSufficient:false,trailGapCount:Math.max(0,tactical.segments.length-1)});
  if(!latest){cache.set(cacheKey,empty);return empty;}
  const intervals=paceIntervals(segment,{maxSpeedMph:speedLimit,jitterMeters:jitter}),latestAt=pointTime(latest),rolling=projectPaceWindow(intervals,latestAt,rollingWindow,rollingMinimum),sustained=projectPaceWindow(intervals,latestAt,sustainedWindow,sustainedMinimum);
  const projection=Object.freeze({rollingPaceMph:rolling.paceMph,rollingCoverageMs:rolling.coverageMs,rollingCoverageRatio:rolling.coverageRatio,rollingSampleCount:rolling.sampleCount,rollingPaceSufficient:rolling.sufficient,sustainedPaceMph:sustained.paceMph,sustainedCoverageMs:sustained.coverageMs,sustainedCoverageRatio:sustained.coverageRatio,sustainedSampleCount:sustained.sampleCount,sustainedPaceSufficient:sustained.sufficient,trailGapCount:Math.max(0,tactical.segments.length-1)});
  cache.set(cacheKey,projection);return projection;
}

export function trailStatus(points,{now=Date.now(),freshMs=15*60*1000,offlineMs=60*60*1000,gapMs=2*60*1000,maxSpeedMph=130,maxJumpMeters=25000,speedWindowIntervals=5,speedMaxIntervalMs=2*60*1000,stationaryMaxMph=2,movingMinMph=5,tacticalTrail=null,rollingPaceWindowMs=TACTICAL_PACE_DEFAULTS.rollingPaceWindowMs,rollingPaceMinimumMs=TACTICAL_PACE_DEFAULTS.rollingPaceMinimumMs,sustainedPaceWindowMs=TACTICAL_PACE_DEFAULTS.sustainedPaceWindowMs,sustainedPaceMinimumMs=TACTICAL_PACE_DEFAULTS.sustainedPaceMinimumMs,jitterMeters=TACTICAL_PACE_DEFAULTS.jitterMeters}={}){
  const tactical=isTacticalTrail(tacticalTrail)?tacticalTrail:deriveTacticalTrail(points,{now,gapMs,maxSpeedMph,maxJumpMeters}),last=tactical.latest,latestSegment=tactical.segments.at(-1)||[];
  const projection=deriveTacticalProjection(points,{now,gapMs,maxSpeedMph,maxJumpMeters,tacticalTrail:tactical,rollingPaceWindowMs,rollingPaceMinimumMs,sustainedPaceWindowMs,sustainedPaceMinimumMs,jitterMeters});
  if(!last)return {status:'offline',ageMs:null,lastUpdate:null,speedMph:null,currentSpeedMph:null,recentSpeedMph:null,direction:null,headingDegrees:null,headingCardinal:null,headingArrow:null,motion:'unknown',speedSource:null,speedSampleCount:0,speedConfidence:'none',pendingObservation:false,...projection};
  const ageMs=Math.max(0,now-pointTime(last)),status=ageMs<=freshMs?'live':ageMs<=offlineMs?'stale':'offline',limit=Math.max(1,Math.min(9,Number(speedWindowIntervals)||5)),samples=[];
  for(let index=Math.max(1,latestSegment.length-limit);index<latestSegment.length;index++){
    const prior=latestSegment[index-1],point=latestSegment[index],elapsedMs=pointTime(point)-pointTime(prior);if(elapsedMs<=0||elapsedMs>speedMaxIntervalMs)continue;
    const speedMph=distanceMeters(prior,point)/(elapsedMs/1000)*2.236936;if(!Number.isFinite(speedMph)||speedMph>maxSpeedMph)continue;samples.push({speedMph,prior,point});
  }
  const speeds=samples.map(sample=>sample.speedMph).sort((a,b)=>a-b),middle=Math.floor(speeds.length/2);let speedMph=speeds.length?(speeds.length%2?speeds[middle]:(speeds[middle-1]+speeds[middle])/2):null,speedSource=speeds.length?'position_median':null,speedConfidence=speeds.length>=3?'high':speeds.length===2?'medium':speeds.length===1?'low':'none';
  const providerSpeed=last.speedMph===null||last.speedMph===undefined||last.speedMph===''?NaN:Number(last.speedMph);if(speedMph===null&&Number.isFinite(providerSpeed)&&providerSpeed>=0&&providerSpeed<=maxSpeedMph){speedMph=providerSpeed;speedSource='provider_reported';speedConfidence='reported';}
  const providerHeading=last.heading===null||last.heading===undefined||last.heading===''?NaN:Number(last.heading);let direction=Number.isFinite(providerHeading)&&providerHeading>=0&&providerHeading<360?providerHeading:null;
  const directionSample=[...samples].reverse().find(sample=>distanceMeters(sample.prior,sample.point)>Math.max(0,Number(jitterMeters)||0));if(direction===null&&directionSample)direction=bearingDegrees(directionSample.prior,directionSample.point);
  const motion=speedMph===null?'unknown':speedMph>=movingMinMph?'moving':speedMph<=stationaryMaxMph?'stationary':'unknown';
  return {status,ageMs,lastUpdate:last.time,speedMph,currentSpeedMph:speedMph,recentSpeedMph:speedSource==='position_median'?speedMph:null,direction,headingDegrees:direction,headingCardinal:cardinalDirection(direction),headingArrow:directionArrow(direction),motion,speedSource,speedSampleCount:speeds.length,speedConfidence,pendingObservation:Boolean(tactical.pending),...projection};
}

export function mergeCompetitorSnapshots(existing,incoming,options={}){
  const byId=new Map((existing||[]).map(item=>[String(item.id),{...item,points:item.points||[]}]));let added=0;
  for(const next of incoming||[]){const id=String(next.id),current=byId.get(id)||{id,name:next.name||`Rider ${id}`,points:[]},result=mergeTrailPoints(current.points,next.points||[],options);current.points=result.points;added+=result.added;for(const key of ['name','number','signature'])if(next[key]!==undefined&&next[key]!==null)current[key]=next[key];byId.set(id,current);}
  return {competitors:[...byId.values()],added};
}

export function buildTacticalClusters(competitors,{radiusMeters=120,now=Date.now(),tacticalByCompetitorId=null}={}){
  const candidates=(competitors||[]).map(rider=>{const supplied=tacticalByCompetitorId instanceof Map?tacticalByCompetitorId.get(String(rider.id)):null,tacticalTrail=isTacticalTrail(supplied)?supplied:deriveTacticalTrail(rider.points,{now});return {rider,last:tacticalTrail.latest,status:trailStatus(rider.points,{now,tacticalTrail})};}).filter(item=>item.last&&item.status.status!=='offline'),clusters=[];
  for(const candidate of candidates){let cluster=clusters.find(item=>distanceMeters(item.center,candidate.last)<=radiusMeters);if(!cluster){cluster={id:'',center:{lat:candidate.last.lat,lon:candidate.last.lon},sumLat:0,sumLon:0,riders:[],latestUpdate:null};clusters.push(cluster);}cluster.riders.push({id:String(candidate.rider.id),name:candidate.rider.name,status:candidate.status.status,motion:candidate.status.motion,lastUpdate:candidate.last.time});cluster.sumLat+=candidate.last.lat;cluster.sumLon+=candidate.last.lon;cluster.center={lat:cluster.sumLat/cluster.riders.length,lon:cluster.sumLon/cluster.riders.length};if(!cluster.latestUpdate||candidate.last.time>cluster.latestUpdate)cluster.latestUpdate=candidate.last.time;}
  return clusters.filter(item=>item.riders.length>1).map(({sumLat,sumLon,...item})=>({...item,id:`cluster:${item.riders.map(r=>r.id).sort().join(',')}`,riders:item.riders.sort((a,b)=>a.id.localeCompare(b.id))}));
}
