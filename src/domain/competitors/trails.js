const EARTH=6371008.8;
const rad=value=>value*Math.PI/180;
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

export function segmentTrail(points,{gapMs=20*60*1000,maxSpeedMph=130,maxJumpMeters=25000,now=Date.now(),historyMs=8*24*60*60*1000,maxPoints=12000}={}){
  const ordered=normalizeTrailPoints(points,{now,historyMs,maxPoints}),segments=[];let current=[];
  for(const point of ordered){const prior=current.at(-1);if(prior){const elapsed=(pointTime(point)-pointTime(prior))/1000,distance=distanceMeters(prior,point),speed=elapsed>0?distance/elapsed*2.236936:null;const sessionChanged=prior.sessionId&&point.sessionId&&String(prior.sessionId)!==String(point.sessionId);if(sessionChanged||elapsed*1000>gapMs||distance>maxJumpMeters||(speed!==null&&speed>maxSpeedMph)){if(current.length)segments.push(current);current=[];}}
    current.push(point);
  }if(current.length)segments.push(current);return segments;
}

export function trailStatus(points,{now=Date.now(),freshMs=15*60*1000,offlineMs=60*60*1000}={}){
  const ordered=normalizeTrailPoints(points,{now}),last=ordered.at(-1),prior=ordered.at(-2);if(!last)return {status:'offline',ageMs:null,lastUpdate:null,speedMph:null,direction:null,motion:'unknown'};
  const ageMs=Math.max(0,now-pointTime(last)),status=ageMs<=freshMs?'live':ageMs<=offlineMs?'stale':'offline';let speedMph=Number.isFinite(Number(last.speedMph))&&Number(last.speedMph)>=0&&Number(last.speedMph)<=130?Number(last.speedMph):null,direction=Number.isFinite(Number(last.heading))&&Number(last.heading)>=0&&Number(last.heading)<360?Number(last.heading):null,motion=speedMph===null?'unknown':speedMph<1?'stationary':'moving';
  if(prior){const seconds=(pointTime(last)-pointTime(prior))/1000,distance=distanceMeters(prior,last);if(seconds>0&&seconds<=300){const speed=distance/seconds*2.236936;if(speedMph===null&&speed<=130)speedMph=speed;if(distance<25)motion='stationary';else if(speedMph!==null){motion='moving';if(direction===null){const y=Math.sin(rad(last.lon-prior.lon))*Math.cos(rad(last.lat)),x=Math.cos(rad(prior.lat))*Math.sin(rad(last.lat))-Math.sin(rad(prior.lat))*Math.cos(rad(last.lat))*Math.cos(rad(last.lon-prior.lon));direction=(Math.atan2(y,x)*180/Math.PI+360)%360;}}}}
  return {status,ageMs,lastUpdate:last.time,speedMph,direction,motion};
}

export function mergeCompetitorSnapshots(existing,incoming,options={}){
  const byId=new Map((existing||[]).map(item=>[String(item.id),{...item,points:item.points||[]}]));let added=0;
  for(const next of incoming||[]){const id=String(next.id),current=byId.get(id)||{id,name:next.name||`Rider ${id}`,points:[]},result=mergeTrailPoints(current.points,next.points||[],options);current.points=result.points;added+=result.added;for(const key of ['name','number','signature'])if(next[key]!==undefined&&next[key]!==null)current[key]=next[key];byId.set(id,current);}
  return {competitors:[...byId.values()],added};
}

export function buildTacticalClusters(competitors,{radiusMeters=120,now=Date.now()}={}){
  const candidates=(competitors||[]).map(rider=>({rider,last:normalizeTrailPoints(rider.points,{now}).at(-1),status:trailStatus(rider.points,{now})})).filter(item=>item.last&&item.status.status!=='offline'),clusters=[];
  for(const candidate of candidates){let cluster=clusters.find(item=>distanceMeters(item.center,candidate.last)<=radiusMeters);if(!cluster){cluster={id:'',center:{lat:candidate.last.lat,lon:candidate.last.lon},sumLat:0,sumLon:0,riders:[],latestUpdate:null};clusters.push(cluster);}cluster.riders.push({id:String(candidate.rider.id),name:candidate.rider.name,status:candidate.status.status,motion:candidate.status.motion,lastUpdate:candidate.last.time});cluster.sumLat+=candidate.last.lat;cluster.sumLon+=candidate.last.lon;cluster.center={lat:cluster.sumLat/cluster.riders.length,lon:cluster.sumLon/cluster.riders.length};if(!cluster.latestUpdate||candidate.last.time>cluster.latestUpdate)cluster.latestUpdate=candidate.last.time;}
  return clusters.filter(item=>item.riders.length>1).map(({sumLat,sumLon,...item})=>({...item,id:`cluster:${item.riders.map(r=>r.id).sort().join(',')}`,riders:item.riders.sort((a,b)=>a.id.localeCompare(b.id))}));
}
