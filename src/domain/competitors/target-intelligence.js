import {distanceMeters,pointTime,segmentTrailDetailed} from './trails.js';

const MPH_PER_MPS=2.2369362920544;
const finite=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
const median=values=>{const rows=values.filter(finite).map(Number).sort((a,b)=>a-b);if(!rows.length)return null;const middle=Math.floor(rows.length/2);return rows.length%2?rows[middle]:(rows[middle-1]+rows[middle])/2;};
const objectivePoint=objective=>objective?.geometry?.coordinates?.[0]||objective?.point||objective;

function validIntervals(segment){
  const rows=[];
  for(let index=1;index<segment.length;index++){
    const from=segment[index-1],to=segment[index],durationMs=pointTime(to)-pointTime(from);
    if(durationMs<=0)continue;
    rows.push({from,to,durationMs,speedMph:distanceMeters(from,to)/(durationMs/1000)*MPH_PER_MPS});
  }
  return rows;
}

export const TARGET_ACTIVITY_DEFAULTS=Object.freeze({
  vicinityRadiusMeters:152.4,
  meaningfulRadiusMeters:61,
  stoppedRadiusMeters:244,
  stationarySpeedMph:2,
  minimumDwellMs:30000,
  recentActivityMs:30*60*1000,
  approachLookbackPoints:5,
  gapMs:90000,
  maxSpeedMph:130,
  maxJumpMeters:5000
});

export function analyzeCompetitorTarget(rider,objective,options={}){
  const config={...TARGET_ACTIVITY_DEFAULTS,...options},target=objectivePoint(objective),objectiveId=String(objective?.id||objective?.objectiveId||'');
  if(!target||!finite(target.lat)||!finite(target.lon)||!objectiveId)return null;
  const analysis=segmentTrailDetailed(rider?.points||[],config),observations=analysis.observations;
  if(!observations.length)return null;
  let closest=null;
  for(const point of observations){const distance=distanceMeters(point,target);if(!closest||distance<closest.distanceMeters)closest={point,distanceMeters:distance,timestampMs:pointTime(point)};}
  const closestSegment=analysis.segments.find(segment=>segment.includes(closest.point))||[];
  const credibleIntersection=closestSegment.length>=2;
  const intervals=validIntervals(closestSegment),closestIndex=closestSegment.indexOf(closest.point);
  const adjacent=intervals.filter((_,index)=>Math.abs(index-closestIndex)<=2).map(item=>item.speedMph);
  const sourceSpeed=finite(closest.point.speedMph)&&Number(closest.point.speedMph)>=0&&Number(closest.point.speedMph)<=config.maxSpeedMph?Number(closest.point.speedMph):null;
  const speedAtClosestMph=sourceSpeed??median(adjacent);
  const inside=closestSegment.map(point=>({point,distance:distanceMeters(point,target),time:pointTime(point)})).filter(item=>item.distance<=config.stoppedRadiusMeters);
  let dwellDurationMs=0,stoppedNearTarget=false;
  if(inside.length>1){
    const start=inside[0].time,end=inside.at(-1).time;
    dwellDurationMs=Math.max(0,end-start);
    const nearIntervals=intervals.filter(item=>pointTime(item.from)>=start&&pointTime(item.to)<=end);
    stoppedNearTarget=dwellDurationMs>=config.minimumDwellMs&&median(nearIntervals.map(item=>item.speedMph))!==null&&median(nearIntervals.map(item=>item.speedMph))<=config.stationarySpeedMph;
  }
  const entered=credibleIntersection&&closest.distanceMeters<=config.vicinityRadiusMeters;
  const meaningful=credibleIntersection&&closest.distanceMeters<=config.meaningfulRadiusMeters;
  const after=closestSegment.slice(closestIndex+1),departedPoint=after.find(point=>distanceMeters(point,target)>config.vicinityRadiusMeters);
  const recent=closest.timestampMs>0&&(config.now??Date.now())-closest.timestampMs<=config.recentActivityMs;
  const latest=observations.at(-1),latestDistance=distanceMeters(latest,target);
  const approachPoints=analysis.renderSegment.slice(-Math.max(2,config.approachLookbackPoints));
  const approachDistances=approachPoints.map(point=>distanceMeters(point,target));
  const approaching=!entered&&approachDistances.length>=2&&approachDistances.at(-1)<approachDistances[0]-Math.max(25,approachDistances[0]*0.05);
  let state='nearby';
  if(stoppedNearTarget)state='stopped-near-target';
  else if(departedPoint)state='departed-target';
  else if(meaningful||entered)state='passed-target-vicinity';
  else if(approaching)state='approaching-target';
  else if(recent)state='recent-target-activity';
  return Object.freeze({
    activityId:`${String(rider?.id||rider?.number||'rider')}:${objectiveId}:${closest.timestampMs}`,
    riderId:String(rider?.id||rider?.number||'unknown'),riderNumber:String(rider?.number||rider?.id||'unknown'),objectiveId,
    state,closestApproachMeters:closest.distanceMeters,closestApproachTimestamp:new Date(closest.timestampMs).toISOString(),
    speedAtClosestMph:finite(speedAtClosestMph)?speedAtClosestMph:null,approaching,enteredVicinity:entered,meaningfulIntersection:meaningful,
    stoppedNearTarget,dwellDurationMs:stoppedNearTarget?dwellDurationMs:null,
    departureTimestamp:departedPoint?new Date(pointTime(departedPoint)).toISOString():null,
    latestDistanceMeters:latestDistance,lastTelemetryTimestamp:new Date(pointTime(latest)).toISOString(),recent,
    confidence:meaningful?'high':entered||approaching?'medium':'low',gapCount:analysis.gaps.length
  });
}

export function buildTargetActivity(competitors,objective,options={}){
  return (competitors||[]).map(rider=>analyzeCompetitorTarget(rider,objective,options)).filter(Boolean)
    .filter(item=>item.approaching||item.enteredVicinity||item.recent)
    .sort((a,b)=>Date.parse(b.closestApproachTimestamp)-Date.parse(a.closestApproachTimestamp)||a.riderId.localeCompare(b.riderId));
}

export function mergeRecentTargetActivity(existing,incoming,{now=Date.now(),retentionMs=6*60*60*1000,maxRecords=200}={}){
  const records=new Map();
  for(const item of [...(existing||[]),...(incoming||[])]){
    if(!item?.activityId||!item.closestApproachTimestamp)continue;
    if(now-Date.parse(item.closestApproachTimestamp)>retentionMs)continue;
    records.set(`${item.riderId}:${item.objectiveId}`,item);
  }
  return [...records.values()].sort((a,b)=>Date.parse(b.closestApproachTimestamp)-Date.parse(a.closestApproachTimestamp)).slice(0,maxRecords);
}
