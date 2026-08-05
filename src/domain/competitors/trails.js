const EARTH=6371008.8;
const rad=value=>value*Math.PI/180;
export function distanceMeters(a,b){const dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon),v=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;return 2*EARTH*Math.asin(Math.min(1,Math.sqrt(v)));}
export const pointTime=point=>{const raw=point?.time??point?.timestamp??point?.recordedAt;const value=typeof raw==='number'?raw:Date.parse(raw||'');return Number.isFinite(value)?value:0;};
export function stableCompetitorId(entry,index=0){const props=entry?.properties||{},rider=entry?.competitor||entry?.rider||{};const value=entry?.competitorId??entry?.id_competitor??entry?.riderId??entry?.id??props.competitorId??props.riderId??props.id??rider.id??rider.competitorId??entry?.number??rider.number;return value===undefined||value===null||String(value).trim()===''?`unidentified-${index+1}`:String(value);}
export const breadcrumbKey=point=>String(point?.observationId||point?.id||`${Number(point.lat).toFixed(6)}|${Number(point.lon).toFixed(6)}|${pointTime(point)}|${point?.sessionId||''}`);

export function normalizeTrailPoints(points,{now=Date.now(),historyMs=8*24*60*60*1000,maxPoints=12000}={}){
  const unique=new Map();for(const point of points||[]){const lat=Number(point?.lat),lon=Number(point?.lon),time=pointTime(point);if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180||!time||time>now+60000||now-time>historyMs)continue;const normalized={...point,lat,lon,time:new Date(time).toISOString()};unique.set(breadcrumbKey(normalized),normalized);}
  return [...unique.values()].sort((a,b)=>pointTime(a)-pointTime(b)||breadcrumbKey(a).localeCompare(breadcrumbKey(b))).slice(-maxPoints);
}

export function segmentTrail(points,{gapMs=20*60*1000,maxSpeedMph=130,maxJumpMeters=25000}={}){
  const ordered=normalizeTrailPoints(points),segments=[];let current=[];
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
  const byId=new Map((existing||[]).map(item=>[String(item.id),{...item,points:[...(item.points||[])]}]));let added=0;
  for(const next of incoming||[]){const id=String(next.id),current=byId.get(id)||{id,name:next.name||`Rider ${id}`,points:[]};const before=new Set(current.points.map(breadcrumbKey));current.points=normalizeTrailPoints([...current.points,...(next.points||[])],options);added+=current.points.filter(point=>!before.has(breadcrumbKey(point))).length;for(const key of ['name','number','signature'])if(next[key]!==undefined&&next[key]!==null)current[key]=next[key];byId.set(id,current);}
  return {competitors:[...byId.values()],added};
}

export function buildTacticalClusters(competitors,{radiusMeters=120,now=Date.now()}={}){
  const candidates=(competitors||[]).map(rider=>({rider,last:normalizeTrailPoints(rider.points,{now}).at(-1),status:trailStatus(rider.points,{now})})).filter(item=>item.last&&item.status.status!=='offline'),clusters=[];
  for(const candidate of candidates){let cluster=clusters.find(item=>distanceMeters(item.center,candidate.last)<=radiusMeters);if(!cluster){cluster={id:'',center:{lat:candidate.last.lat,lon:candidate.last.lon},riders:[],latestUpdate:null};clusters.push(cluster);}cluster.riders.push({id:String(candidate.rider.id),name:candidate.rider.name,status:candidate.status.status,motion:candidate.status.motion,lastUpdate:candidate.last.time});cluster.center={lat:cluster.riders.reduce((sum,r)=>sum+candidates.find(c=>String(c.rider.id)===r.id).last.lat,0)/cluster.riders.length,lon:cluster.riders.reduce((sum,r)=>sum+candidates.find(c=>String(c.rider.id)===r.id).last.lon,0)/cluster.riders.length};cluster.latestUpdate=cluster.riders.map(r=>r.lastUpdate).sort().at(-1);}
  return clusters.filter(item=>item.riders.length>1).map(item=>({...item,id:`cluster:${item.riders.map(r=>r.id).sort().join(',')}`,riders:item.riders.sort((a,b)=>a.id.localeCompare(b.id))}));
}
