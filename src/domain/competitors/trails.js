const EARTH_METERS=6371008.8;
const METERS_PER_SECOND_TO_MPH=2.2369362920544;
const rad=value=>value*Math.PI/180;
const finite=value=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value));
const clampHeading=value=>((Number(value)%360)+360)%360;

export const TACTICAL_TRAIL_DEFAULTS=Object.freeze({
  // The live GPS Checkpoints feed is normally close to one observation per second.
  // Ninety seconds tolerates brief radio/browser pauses without asserting a route
  // across a meaningful missing-telemetry interval.
  gapMs:90*1000,
  maxSpeedMph:130,
  maxJumpMeters:25000,
  jitterMeters:3,
  stationaryRadiusMeters:12,
  stationaryWindowMs:60*1000,
  recentSpeedWindowMs:30*1000,
  rollingPaceWindowMs:3*60*1000,
  sustainedPaceWindowMs:15*60*1000,
  sustainedPaceMinimumMs:10*60*1000,
  freshMs:2*60*1000,
  staleMs:15*60*1000
});

export function distanceMeters(a,b){
  const dLat=rad(Number(b.lat)-Number(a.lat)),dLon=rad(Number(b.lon)-Number(a.lon));
  const value=Math.sin(dLat/2)**2+Math.cos(rad(Number(a.lat)))*Math.cos(rad(Number(b.lat)))*Math.sin(dLon/2)**2;
  return 2*EARTH_METERS*Math.asin(Math.min(1,Math.sqrt(value)));
}

export function pointTime(point){
  const raw=point?.time??point?.timestamp??point?.recordedAt??point?.occurredAt;
  if(raw instanceof Date)return Number.isFinite(raw.getTime())?raw.getTime():0;
  if(typeof raw==='number')return Number.isFinite(raw)?(Math.abs(raw)<1e11?raw*1000:raw):0;
  if(typeof raw==='string'&&/^\d+(?:\.\d+)?$/.test(raw.trim())){
    const numeric=Number(raw);
    return Number.isFinite(numeric)?(Math.abs(numeric)<1e11?numeric*1000:numeric):0;
  }
  const value=Date.parse(raw||'');
  return Number.isFinite(value)?value:0;
}

const firstIdentityValue=(entry,paths)=>{
  for(const value of paths(entry))if(value!==undefined&&value!==null&&String(value).trim()!=='')return String(value).trim();
  return null;
};

export function stableCompetitorId(entry,index=0){
  const value=firstIdentityValue(entry||{},source=>{
    const props=source.properties||{},rider=source.competitor||source.rider||{};
    return [source.competitorId,source.id_competitor,source.riderId,source.id,props.competitorId,props.riderId,props.id,rider.id,rider.competitorId,source.number,source.competitor_number,rider.number,rider.competitor_number];
  });
  return value||`unidentified-${index+1}`;
}

export function competitorDisplayNumber(entry){
  return firstIdentityValue(entry||{},source=>{
    const props=source.properties||{},rider=source.competitor||source.rider||{};
    return [source.number,source.competitor_number,source.competitorNumber,props.number,props.competitor_number,props.competitorNumber,rider.number,rider.competitor_number,rider.competitorNumber];
  });
}

export function stableCompetitorIdentity(entry,index=0){
  const id=stableCompetitorId(entry,index),riderNumber=competitorDisplayNumber(entry);
  const suppliedName=firstIdentityValue(entry||{},source=>{
    const props=source.properties||{},rider=source.competitor||source.rider||{};
    return [source.name,source.riderName,source.competitorName,props.name,props.riderName,rider.name];
  });
  return Object.freeze({
    id,
    riderNumber,
    label:riderNumber||id,
    name:suppliedName||`Rider ${riderNumber||id}`
  });
}

const pointIdentity=point=>point?.observationId??point?.locationId??point?.pointId??point?.id;
const observationFingerprint=point=>`${Number(point.lat).toFixed(7)}|${Number(point.lon).toFixed(7)}|${pointTime(point)}|${point?.sessionId||''}`;
export const breadcrumbKey=point=>pointIdentity(point)!==undefined&&pointIdentity(point)!==null&&String(pointIdentity(point)).trim()!==''?`id:${String(pointIdentity(point))}`:`fix:${observationFingerprint(point)}`;

export function normalizeTrailPoints(points,{now=Date.now(),historyMs=Infinity,maxPoints=12000,futureToleranceMs=60000}={}){
  const records=new Map(),fingerprints=new Map();let ordinal=0;
  for(const source of points||[]){
    const lat=Number(source?.lat),lon=Number(source?.lon),time=pointTime(source);
    if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180||!time||time>now+futureToleranceMs||(Number.isFinite(historyMs)&&now-time>historyMs))continue;
    const normalized={...source,lat,lon,time:new Date(time).toISOString()};
    const key=breadcrumbKey(normalized),fingerprint=observationFingerprint(normalized),existing=records.get(key);
    if(existing){
      // A stable source observation ID may be corrected by a later snapshot. Keep
      // its original sort position while accepting the authoritative correction.
      existing.point=normalized;
      fingerprints.set(fingerprint,key);
      continue;
    }
    // Some feeds regenerate observation IDs during a refresh. Identical source
    // time/coordinate/session evidence is still one observation.
    if(fingerprints.has(fingerprint))continue;
    records.set(key,{point:normalized,ordinal:ordinal++});fingerprints.set(fingerprint,key);
  }
  return [...records.values()]
    .sort((a,b)=>pointTime(a.point)-pointTime(b.point)||a.ordinal-b.ordinal)
    .slice(-Math.max(1,Number(maxPoints)||12000))
    .map(record=>record.point);
}

const connectionBreak=(prior,point,options)=>{
  const durationMs=pointTime(point)-pointTime(prior),distance=distanceMeters(prior,point);
  const sourceSessionChanged=prior.sessionId&&point.sessionId&&String(prior.sessionId)!==String(point.sessionId);
  if(sourceSessionChanged)return {reason:'session-change',durationMs,distanceMeters:distance,impliedSpeedMph:null};
  if(durationMs<=0)return {reason:'non-increasing-timestamp',durationMs,distanceMeters:distance,impliedSpeedMph:null};
  const impliedSpeedMph=distance/(durationMs/1000)*METERS_PER_SECOND_TO_MPH;
  if(durationMs<=options.gapMs&&distance>options.maxJumpMeters)return {reason:'impossible-jump',durationMs,distanceMeters:distance,impliedSpeedMph};
  if(impliedSpeedMph>options.maxSpeedMph)return {reason:'impossible-speed',durationMs,distanceMeters:distance,impliedSpeedMph};
  if(durationMs>options.gapMs)return {reason:'telemetry-gap',durationMs,distanceMeters:distance,impliedSpeedMph:null};
  return null;
};

const gapEndpoint=point=>Object.freeze({lat:point.lat,lon:point.lon,time:point.time});

export function segmentTrailDetailed(points,options={}){
  const config={...TACTICAL_TRAIL_DEFAULTS,...options};
  const ordered=normalizeTrailPoints(points,{now:config.now??Date.now(),historyMs:config.historyMs??Infinity,maxPoints:config.maxPoints??12000});
  const segments=[],gaps=[];let current=[];
  for(const point of ordered){
    const prior=current.at(-1);
    if(prior){
      const rejected=connectionBreak(prior,point,config);
      if(rejected){
        if(current.length)segments.push(current);
        gaps.push(Object.freeze({
          riderId:config.riderId===undefined||config.riderId===null?null:String(config.riderId),
          reason:rejected.reason,
          gapStart:prior.time,
          gapEnd:point.time,
          durationMs:rejected.durationMs,
          distanceMeters:rejected.distanceMeters,
          impliedSpeedMph:rejected.impliedSpeedMph,
          from:gapEndpoint(prior),
          to:gapEndpoint(point)
        }));
        current=[];
      }
    }
    current.push(point);
  }
  if(current.length)segments.push(current);
  const result={
    riderId:config.riderId===undefined||config.riderId===null?null:String(config.riderId),
    observations:ordered,
    segments,
    gaps,
    gapThresholdMs:config.gapMs
  };
  return Object.freeze({...result,...resolveRenderPosition(result)});
}

export function segmentTrail(points,options={}){
  return segmentTrailDetailed(points,options).segments;
}

const UNCORROBORATED_BREAK_REASONS=new Set(['impossible-jump','impossible-speed','non-increasing-timestamp']);

/**
 * Raw observations remain auditable, but one impossible terminal fix is not a
 * trusted tactical position until a second compatible fix corroborates it.
 */
export function resolveRenderPosition(analysis={}){
  const observations=analysis.observations||[],segments=analysis.segments||[],gaps=analysis.gaps||[];
  const latestObservation=observations.at(-1)||null,lastSegment=segments.at(-1)||[],lastBreak=gaps.at(-1)||null;
  if(!latestObservation)return Object.freeze({renderObservation:null,acceptedObservation:null,pendingObservation:null,renderSegment:[],positionStatus:'unavailable',positionReason:null});
  const requiresCorroboration=lastSegment.length===1&&UNCORROBORATED_BREAK_REASONS.has(lastBreak?.reason);
  if(!requiresCorroboration)return Object.freeze({renderObservation:latestObservation,acceptedObservation:latestObservation,pendingObservation:null,renderSegment:lastSegment,positionStatus:'accepted',positionReason:null});
  let acceptedSegment=null;
  for(let index=segments.length-2;index>=0;index--){if(segments[index].length>=2){acceptedSegment=segments[index];break;}}
  acceptedSegment ||= segments[0]||[];
  const acceptedObservation=acceptedSegment.at(-1)||observations[0]||null;
  return Object.freeze({
    renderObservation:acceptedObservation,
    acceptedObservation,
    pendingObservation:latestObservation,
    renderSegment:acceptedSegment,
    positionStatus:'pending-corroboration',
    positionReason:lastBreak.reason
  });
}

const bearingDegrees=(a,b)=>{
  const dLon=rad(b.lon-a.lon),lat1=rad(a.lat),lat2=rad(b.lat);
  const y=Math.sin(dLon)*Math.cos(lat2),x=Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon);
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

const median=values=>{
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
};

const segmentIntervals=(segment,jitterMeters)=>{
  const intervals=[];
  for(let index=1;index<segment.length;index++){
    const from=segment[index-1],to=segment[index],durationMs=pointTime(to)-pointTime(from);
    if(durationMs<=0)continue;
    const measuredDistanceMeters=distanceMeters(from,to);
    const effectiveDistanceMeters=measuredDistanceMeters<=jitterMeters?0:measuredDistanceMeters;
    intervals.push({from,to,startedAt:pointTime(from),endedAt:pointTime(to),durationMs,measuredDistanceMeters,effectiveDistanceMeters,speedMph:effectiveDistanceMeters/(durationMs/1000)*METERS_PER_SECOND_TO_MPH});
  }
  return intervals;
};

const intervalPace=(intervals,{minimumMs=0}={})=>{
  const durationMs=intervals.reduce((sum,item)=>sum+item.durationMs,0);
  if(!intervals.length||durationMs<minimumMs)return null;
  const meters=intervals.reduce((sum,item)=>sum+item.effectiveDistanceMeters,0);
  return meters/(durationMs/1000)*METERS_PER_SECOND_TO_MPH;
};

const latestWindow=(intervals,latestMs,windowMs)=>intervals.filter(item=>item.endedAt>latestMs-windowMs);
const validSourceSpeed=point=>finite(point?.speedMph)&&Number(point.speedMph)>=0&&Number(point.speedMph)<=TACTICAL_TRAIL_DEFAULTS.maxSpeedMph?Number(point.speedMph):null;
const validSourceHeading=point=>finite(point?.heading)?clampHeading(point.heading):null;

export function calculateTacticalMotion(points,options={}){
  const config={...TACTICAL_TRAIL_DEFAULTS,...options};
  const analysis=segmentTrailDetailed(points,config),last=analysis.renderObservation;
  if(!last)return Object.freeze({
    status:'offline',ageMs:null,lastUpdate:null,currentSpeedMph:null,recentSpeedMph:null,rollingPaceMph:null,sustainedPaceMph:null,
    headingDegrees:null,headingCardinal:null,headingArrow:null,motion:'unknown',motionReliable:false,speedSource:null,
    rollingCoverageMs:0,sustainedCoverageMs:0,positionStatus:'unavailable',positionReason:null,pendingObservation:null
  });

  const latestMs=pointTime(last),ageMs=Math.max(0,(config.now??Date.now())-latestMs);
  const status=ageMs<=config.freshMs?'live':ageMs<=config.staleMs?'stale':'offline';
  const activeSegment=analysis.renderSegment||[],intervals=segmentIntervals(activeSegment,config.jitterMeters);
  const recentIntervals=latestWindow(intervals,latestMs,config.recentSpeedWindowMs);
  const rollingIntervals=latestWindow(intervals,latestMs,config.rollingPaceWindowMs);
  const sustainedIntervals=latestWindow(intervals,latestMs,config.sustainedPaceWindowMs);
  const stationaryPoints=activeSegment.filter(point=>pointTime(point)>=latestMs-config.stationaryWindowMs);
  const stationarySpanMs=stationaryPoints.length>1?latestMs-pointTime(stationaryPoints[0]):0;
  const stationaryEvidence=stationarySpanMs>=Math.min(5000,config.stationaryWindowMs)&&stationaryPoints.every(point=>distanceMeters(point,last)<=config.stationaryRadiusMeters);

  const derivedRecent=stationaryEvidence?0:median(recentIntervals.slice(-5).map(item=>item.speedMph));
  const upstreamSpeed=validSourceSpeed(last);
  const currentSpeedMph=stationaryEvidence?0:(upstreamSpeed??derivedRecent);
  const rollingCoverageMs=rollingIntervals.reduce((sum,item)=>sum+item.durationMs,0);
  const sustainedCoverageMs=sustainedIntervals.reduce((sum,item)=>sum+item.durationMs,0);
  const rollingPaceMph=stationaryEvidence?0:intervalPace(rollingIntervals,{minimumMs:Math.min(15000,config.rollingPaceWindowMs)});
  const sustainedPaceMph=stationaryEvidence&&sustainedCoverageMs>=config.sustainedPaceMinimumMs?0:intervalPace(sustainedIntervals,{minimumMs:config.sustainedPaceMinimumMs});

  const headingInterval=[...recentIntervals].reverse().find(item=>item.effectiveDistanceMeters>config.jitterMeters);
  const upstreamHeading=validSourceHeading(last);
  const headingDegrees=stationaryEvidence?null:(upstreamHeading??(headingInterval?bearingDegrees(headingInterval.from,headingInterval.to):null));
  const motion=currentSpeedMph===null?'unknown':currentSpeedMph<2?'stopped':'moving';
  return Object.freeze({
    status,ageMs,lastUpdate:last.time,
    currentSpeedMph,recentSpeedMph:derivedRecent,rollingPaceMph,sustainedPaceMph,
    headingDegrees,headingCardinal:cardinalDirection(headingDegrees),headingArrow:directionArrow(headingDegrees),
    motion,motionReliable:status==='live'&&currentSpeedMph!==null,speedSource:currentSpeedMph===null?null:(upstreamSpeed===null?'derived':'upstream'),
    rollingCoverageMs,sustainedCoverageMs,
    positionStatus:analysis.positionStatus,positionReason:analysis.positionReason,pendingObservation:analysis.pendingObservation
  });
}

export function trailStatus(points,{now=Date.now(),freshMs=15*60*1000,offlineMs=60*60*1000,...options}={}){
  const tactical=calculateTacticalMotion(points,{...options,now,freshMs,staleMs:offlineMs});
  return {
    status:tactical.status,
    ageMs:tactical.ageMs,
    lastUpdate:tactical.lastUpdate,
    speedMph:tactical.currentSpeedMph,
    direction:tactical.headingDegrees,
    motion:tactical.motion==='stopped'?'stationary':tactical.motion
  };
}

export const trailGapKey=gap=>[
  gap?.riderId??'',gap?.reason??'',gap?.gapStart??gap?.from?.time??'',gap?.gapEnd??gap?.to?.time??''
].map(value=>String(value)).join('|');

/** Durable union: sync refreshes may rediscover a gap but never duplicate or
 * silently discard earlier gap evidence when point retention advances. */
export function mergeTrailGapMetadata(existing,incoming,{maxGaps=12000}={}){
  const byKey=new Map();
  for(const gap of [...(existing||[]),...(incoming||[])]){
    if(!gap||!gap.gapStart||!gap.gapEnd||!gap.reason)continue;
    const normalized={...gap,riderId:gap.riderId===undefined||gap.riderId===null?null:String(gap.riderId)};
    byKey.set(trailGapKey(normalized),normalized);
  }
  return [...byKey.values()]
    .sort((a,b)=>pointTime({time:a.gapStart})-pointTime({time:b.gapStart})||pointTime({time:a.gapEnd})-pointTime({time:b.gapEnd})||trailGapKey(a).localeCompare(trailGapKey(b)))
    .slice(-Math.max(1,Number(maxGaps)||12000));
}

const latestValidObservation=points=>{
  let latest=null,latestMs=0;
  for(const point of points||[]){
    const lat=Number(point?.lat),lon=Number(point?.lon),time=pointTime(point);
    if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180||!time||time<latestMs)continue;
    latest={...point,lat,lon,time:new Date(time).toISOString()};latestMs=time;
  }
  return latest;
};

export function mergeCompetitorSnapshots(existing,incoming,options={}){
  const byId=new Map();
  for(const [index,item] of (existing||[]).entries()){
    const identity=stableCompetitorIdentity(item,index),number=competitorDisplayNumber(item);
    byId.set(identity.id,{...item,id:identity.id,...(number?{number}:{}),points:[...(item.points||item.observations||[])]});
  }
  let added=0,gapsAdded=0;
  for(const [index,next] of (incoming||[]).entries()){
    const identity=stableCompetitorIdentity(next,index),id=identity.id;
    const current=byId.get(id)||{id,name:identity.name,points:[]};
    const incomingPoints=next.points||next.observations||[],priorLatest=latestValidObservation(current.points);
    const incomingAudit=segmentTrailDetailed(incomingPoints,{...options,riderId:id,historyMs:Infinity,maxPoints:Math.max(Number(options.maxPoints)||12000,incomingPoints.length||1)});
    const firstAfterPrior=priorLatest?incomingAudit.observations.find(point=>pointTime(point)>pointTime(priorLatest)):null;
    const bridgeAudit=firstAfterPrior?segmentTrailDetailed([priorLatest,firstAfterPrior],{...options,riderId:id,historyMs:Infinity,maxPoints:2}):{gaps:[]};
    const before=new Set(current.points.map(breadcrumbKey));
    current.points=normalizeTrailPoints([...current.points,...incomingPoints],options);
    added+=current.points.filter(point=>!before.has(breadcrumbKey(point))).length;
    const priorGapKeys=new Set((current.trailGaps||[]).map(trailGapKey));
    current.trailGaps=mergeTrailGapMetadata(current.trailGaps,[...incomingAudit.gaps,...bridgeAudit.gaps],options);
    gapsAdded+=current.trailGaps.filter(gap=>!priorGapKeys.has(trailGapKey(gap))).length;
    const number=competitorDisplayNumber(next);
    if(number)current.number=number;
    for(const key of ['name','signature'])if(next[key]!==undefined&&next[key]!==null)current[key]=next[key];
    byId.set(id,current);
  }
  return {competitors:[...byId.values()],added,gapsAdded};
}

export function buildRiderTacticalModel(rider,options={}){
  const identity=stableCompetitorIdentity(rider,options.index||0),analysis=segmentTrailDetailed(rider?.points||rider?.observations||[],{...options,riderId:identity.id});
  const tactical=calculateTacticalMotion(analysis.observations,{...options,riderId:identity.id});
  const gaps=mergeTrailGapMetadata(rider?.trailGaps,analysis.gaps,options);
  return Object.freeze({
    ...identity,
    observations:analysis.observations,
    segments:analysis.segments,
    gaps,
    renderObservation:analysis.renderObservation,
    acceptedObservation:analysis.acceptedObservation,
    pendingObservation:analysis.pendingObservation,
    positionStatus:analysis.positionStatus,
    positionReason:analysis.positionReason,
    tactical
  });
}

export function buildCompetitorTacticalModels(competitors,options={}){
  return (competitors||[]).map((rider,index)=>buildRiderTacticalModel(rider,{...options,index}));
}

export function buildTacticalClusters(competitors,{radiusMeters=120,now=Date.now(),freshMs=15*60*1000,staleMs=60*60*1000,...options}={}){
  const candidates=(competitors||[]).map((rider,index)=>{
    const model=buildRiderTacticalModel(rider,{...options,now,index,freshMs,staleMs}),identity=stableCompetitorIdentity(rider,index),last=model.renderObservation;
    const status={status:model.tactical.status,motion:model.tactical.motion==='stopped'?'stationary':model.tactical.motion};
    return {rider,identity,last,status};
  }).filter(item=>item.last&&item.status.status!=='offline'),clusters=[];
  for(const candidate of candidates){
    let cluster=clusters.find(item=>distanceMeters(item.center,candidate.last)<=radiusMeters);
    if(!cluster){cluster={id:'',center:{lat:candidate.last.lat,lon:candidate.last.lon},riders:[],latestUpdate:null,_locations:[]};clusters.push(cluster);}
    cluster._locations.push(candidate.last);
    cluster.riders.push({id:candidate.identity.id,number:candidate.identity.riderNumber,label:candidate.identity.label,name:candidate.identity.name,status:candidate.status.status,motion:candidate.status.motion,lastUpdate:candidate.last.time});
    cluster.center={lat:cluster._locations.reduce((sum,item)=>sum+item.lat,0)/cluster._locations.length,lon:cluster._locations.reduce((sum,item)=>sum+item.lon,0)/cluster._locations.length};
    cluster.latestUpdate=cluster.riders.map(item=>item.lastUpdate).sort().at(-1);
  }
  return clusters.filter(item=>item.riders.length>1).map(({_locations,...item})=>({...item,id:`cluster:${item.riders.map(rider=>rider.id).sort().join(',')}`,riders:item.riders.sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}))}));
}
