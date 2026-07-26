(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CannonMapStationaryEvents=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const STATIONARY_RADIUS_METERS=150;
const STATIONARY_THRESHOLD_MS=3*60*1000;
const EXIT_RADIUS_METERS=190;
const EXIT_CONFIRMATION_POINTS=2;
const EARTH_RADIUS_METERS=6371008.8;

function pointTime(point){const value=typeof point?.time==='number'?point.time:Date.parse(point?.time||'');return Number.isFinite(value)?value:0;}
function distanceMeters(a,b){
  const rad=Math.PI/180,dLat=(b.lat-a.lat)*rad,dLon=(b.lon-a.lon)*rad;
  const lat1=a.lat*rad,lat2=b.lat*rad,s=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 2*EARTH_RADIUS_METERS*Math.asin(Math.min(1,Math.sqrt(s)));
}
function clusterStats(points){
  const center=points.reduce((sum,p)=>({lat:sum.lat+p.lat,lon:sum.lon+p.lon}),{lat:0,lon:0});
  center.lat/=points.length;center.lon/=points.length;
  return {center,radiusMeters:Math.max(0,...points.map(point=>distanceMeters(center,point)))};
}
function competitorSignature(competitor){
  if(competitor?.signature)return String(competitor.signature);
  const number=competitor?.number??competitor?.competitorNumber;
  if(number!==undefined&&number!==null&&String(number).trim())return `#${String(number).trim()}`;
  const initials=String(competitor?.name||'').trim().split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join('').toUpperCase();
  return initials||String(competitor?.id||'?').slice(-3);
}
function eventIdFor(eventId,competitorId,startTime){return `${eventId}:${competitorId}:${new Date(startTime).toISOString()}`;}
function buildEvent(scope,cluster,status,endTime=null){
  const stats=clusterStats(cluster),start=pointTime(cluster[0]),last=pointTime(cluster.at(-1));
  return {
    id:eventIdFor(scope.eventId,scope.competitorId,start),
    rallyEventId:String(scope.eventId),competitorId:String(scope.competitorId),
    competitorNumber:scope.competitorNumber??'',riderName:scope.riderName||`Rider ${scope.competitorId}`,
    signature:scope.signature||competitorSignature({id:scope.competitorId,number:scope.competitorNumber,name:scope.riderName}),
    startTime:new Date(start).toISOString(),lastUpdateTime:new Date(last).toISOString(),
    endTime:endTime?new Date(endTime).toISOString():null,durationMs:Math.max(0,(endTime||last)-start),
    center:stats.center,radiusMeters:Math.round(stats.radiusMeters),status
  };
}
function detectStationaryEvents(points,scope,previousEvents=[]){
  const valid=(points||[]).filter(point=>Number.isFinite(Number(point.lat))&&Number.isFinite(Number(point.lon))&&pointTime(point)>0).map(point=>({...point,lat:Number(point.lat),lon:Number(point.lon)})).sort((a,b)=>pointTime(a)-pointTime(b));
  const detected=[];let cluster=[],outside=[];
  const finish=(endTime,status='completed')=>{
    if(cluster.length&&pointTime(cluster.at(-1))-pointTime(cluster[0])>=STATIONARY_THRESHOLD_MS)detected.push(buildEvent(scope,cluster,status,endTime));
  };
  for(const point of valid){
    if(!cluster.length){cluster=[point];outside=[];continue;}
    const candidate=[...cluster,point],insideAnchor=distanceMeters(cluster[0],point)<=STATIONARY_RADIUS_METERS;
    if(insideAnchor){cluster=candidate;outside=[];continue;}
    const current=clusterStats(cluster),exitDistance=distanceMeters(current.center,point);
    outside.push(point);
    if(exitDistance<=EXIT_RADIUS_METERS||outside.length<EXIT_CONFIRMATION_POINTS)continue;
    finish(pointTime(cluster.at(-1)));
    cluster=[...outside];outside=[];
    while(cluster.length>1&&distanceMeters(cluster[0],cluster.at(-1))>STATIONARY_RADIUS_METERS)cluster.shift();
  }
  finish(null,'active');
  const prior=new Map((previousEvents||[]).map(event=>[event.id,event]));
  const merged=detected.map(event=>({...prior.get(event.id),...event,hidden:Boolean(prior.get(event.id)?.hidden)}));
  for(const event of previousEvents||[])if(event.status==='completed'&&!merged.some(item=>item.id===event.id))merged.push(event);
  return merged.sort((a,b)=>Date.parse(a.startTime)-Date.parse(b.startTime));
}
function updateStationaryEvents(project,eventId){
  const prior=Array.isArray(project.stationaryEvents)?project.stationaryEvents:[];
  const retained=prior.filter(event=>String(event.rallyEventId)!==String(eventId));
  const scoped=[];
  for(const competitor of project.competitors||[]){
    const previous=prior.filter(event=>String(event.rallyEventId)===String(eventId)&&String(event.competitorId)===String(competitor.id));
    scoped.push(...detectStationaryEvents(competitor.points,{eventId,competitorId:competitor.id,competitorNumber:competitor.number,riderName:competitor.name,signature:competitorSignature(competitor)},previous));
  }
  project.stationaryEvents=[...retained,...scoped];
  return project.stationaryEvents;
}
function spreadNearbyEvents(events){
  const placed=[];
  return (events||[]).map((event,index)=>{
    const neighbors=placed.filter(item=>distanceMeters(item.original,event.center)<35).length;
    const angle=(index*137.508)*Math.PI/180,distance=Math.min(24,neighbors*8);
    const latOffset=(distance*Math.cos(angle))/111320;
    const lonOffset=(distance*Math.sin(angle))/(111320*Math.max(.2,Math.cos(event.center.lat*Math.PI/180)));
    const displayCenter={lat:event.center.lat+latOffset,lon:event.center.lon+lonOffset};
    placed.push({original:event.center,displayCenter});
    return {...event,displayCenter};
  });
}
function signatureIconSpec(event){return{label:event.signature||'?',size:48,className:'stationary-event-signature',title:`Stationary event · ${event.riderName}`};}
function zoomToStationaryEvent(map,event){map.setView([event.center.lat,event.center.lon],18);return event;}
return{STATIONARY_RADIUS_METERS,STATIONARY_THRESHOLD_MS,EXIT_RADIUS_METERS,EXIT_CONFIRMATION_POINTS,distanceMeters,clusterStats,competitorSignature,detectStationaryEvents,updateStationaryEvents,spreadNearbyEvents,signatureIconSpec,zoomToStationaryEvent};
});
