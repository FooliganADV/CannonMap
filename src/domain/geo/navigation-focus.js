import {haversineMeters,validPoint} from './geometry.js';

const finite=value=>Number.isFinite(Number(value))?Number(value):null;
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const freeze=value=>Object.freeze(value);

function pointOf(value){
  const lat=finite(value?.lat??value?.latitude),lon=finite(value?.lon??value?.lng??value?.longitude);
  return validPoint({lat,lon})?{lat,lon}:null;
}

function bearingDegrees(a,b){
  const radians=value=>value*Math.PI/180;
  const y=Math.sin(radians(b.lon-a.lon))*Math.cos(radians(b.lat));
  const x=Math.cos(radians(a.lat))*Math.sin(radians(b.lat))-
    Math.sin(radians(a.lat))*Math.cos(radians(b.lat))*Math.cos(radians(b.lon-a.lon));
  return (Math.atan2(y,x)*180/Math.PI+360)%360;
}

function signedHeadingChange(inbound,outbound){
  return ((outbound-inbound+540)%360)-180;
}

/**
 * Conservatively identifies route vertices that represent useful turns.
 * Short GPS wiggles are rejected and nearby bend vertices collapse to the
 * strongest turn, avoiding a rapid sequence of false navigation events.
 */
export function inferSignificantRouteTurns(routePoints,{minimumTurnDegrees=50,minimumLegMeters=45,minimumSpacingMeters=100}={}){
  const points=(Array.isArray(routePoints)?routePoints:[]).map((value,index)=>({point:pointOf(value),index}));
  const cumulative=new Array(points.length).fill(0);
  for(let index=1;index<points.length;index++){
    const a=points[index-1].point,b=points[index].point;
    cumulative[index]=cumulative[index-1]+(a&&b?haversineMeters(a,b):0);
  }
  const candidates=[];
  for(let index=1;index<points.length-1;index++){
    const before=points[index-1].point,current=points[index].point,after=points[index+1].point;
    if(!before||!current||!after)continue;
    const inboundLegMeters=haversineMeters(before,current),outboundLegMeters=haversineMeters(current,after);
    if(inboundLegMeters<minimumLegMeters||outboundLegMeters<minimumLegMeters)continue;
    const change=signedHeadingChange(bearingDegrees(before,current),bearingDegrees(current,after));
    const turnDegrees=Math.abs(change);
    if(turnDegrees<minimumTurnDegrees)continue;
    const turn=freeze({
      index:points[index].index,
      point:freeze({...current}),
      turnDegrees,
      direction:change<0?'left':'right',
      inboundLegMeters,
      outboundLegMeters,
      distanceAlongRouteMeters:cumulative[index],
      actionable:true
    });
    const previous=candidates.at(-1);
    if(previous&&turn.distanceAlongRouteMeters-previous.distanceAlongRouteMeters<minimumSpacingMeters){
      if(turn.turnDegrees>previous.turnDegrees)candidates[candidates.length-1]=turn;
    }else candidates.push(turn);
  }
  return freeze(candidates);
}

const inactiveCheckpointStatuses=new Set(['completed','skipped','unreachable','deferred']);

function actionableCheckpoint(checkpoint){
  if(!checkpoint||checkpoint.actionable===false||checkpoint.collected===true)return false;
  return !inactiveCheckpointStatuses.has(String(checkpoint.status??'').toLowerCase());
}

function targetDistance(position,target){
  const supplied=finite(target?.distanceMeters);
  if(supplied!==null&&supplied>=0)return supplied;
  const a=pointOf(position),b=pointOf(target?.point??target);
  return a&&b?haversineMeters(a,b):null;
}

/**
 * Chooses the nearer actionable event ahead: the first significant route turn
 * after currentRouteIndex or the active checkpoint. Passed turns and terminal
 * checkpoints are ignored.
 */
export function selectNavigationFocus({
  position,
  checkpoint=null,
  routePoints=[],
  routeTurns=null,
  currentRouteIndex=-1,
  maxTurnLookaheadMeters=8000,
  turnOptions={}
}={}){
  const turns=Array.isArray(routeTurns)?routeTurns:inferSignificantRouteTurns(routePoints,turnOptions);
  const nextTurn=turns
    .filter(turn=>turn&&turn.actionable!==false&&turn.passed!==true&&finite(turn.index)!==null&&Number(turn.index)>currentRouteIndex)
    .sort((a,b)=>Number(a.index)-Number(b.index))[0]??null;
  const turnDistance=nextTurn?targetDistance(position,nextTurn):null;
  const checkpointDistance=actionableCheckpoint(checkpoint)?targetDistance(position,checkpoint):null;
  const turnIsUseful=turnDistance!==null&&turnDistance>=0&&turnDistance<=maxTurnLookaheadMeters;
  const checkpointIsUseful=checkpointDistance!==null&&checkpointDistance>=0;
  if(!turnIsUseful&&!checkpointIsUseful)return freeze({kind:'none',target:null,distanceMeters:null,reason:'no-actionable-focus'});
  if(checkpointIsUseful&&(!turnIsUseful||checkpointDistance<=turnDistance))return freeze({
    kind:'checkpoint',target:checkpoint,distanceMeters:checkpointDistance,reason:turnIsUseful?'checkpoint-nearer':'checkpoint-only'
  });
  return freeze({kind:'turn',target:nextTurn,distanceMeters:turnDistance,reason:checkpointIsUseful?'turn-nearer':'turn-only'});
}

export const NAVIGATION_ZOOM_BANDS=freeze([
  freeze({id:'immediate',maxMeters:180,zoom:17}),
  freeze({id:'near',maxMeters:650,zoom:16}),
  freeze({id:'approach',maxMeters:1800,zoom:15}),
  freeze({id:'context',maxMeters:5000,zoom:13}),
  freeze({id:'overview',maxMeters:Infinity,zoom:11})
]);

const bandIndex=id=>NAVIGATION_ZOOM_BANDS.findIndex(band=>band.id===id);
const bandForDistance=distance=>NAVIGATION_ZOOM_BANDS.find(band=>distance<=band.maxMeters)??NAVIGATION_ZOOM_BANDS.at(-1);

/**
 * Pure hysteretic zoom policy. The caller owns animation and supplies previous
 * state, which makes manual override and timing behavior deterministic in tests.
 */
export function decideNavigationZoom({
  focus,
  currentZoom,
  previous=null,
  now=Date.now(),
  manualOverrideUntil=0,
  hysteresisRatio=.18,
  minimumChangeIntervalMs=8000
}={}){
  const current=finite(currentZoom)??13,at=finite(now)??Date.now();
  const distance=finite(focus?.distanceMeters);
  const priorBandIndex=bandIndex(previous?.band),priorBand=priorBandIndex>=0?NAVIGATION_ZOOM_BANDS[priorBandIndex]:null;
  const unchanged=(reason,band=priorBand?.id??null)=>freeze({zoom:current,band,changed:false,reason,lastChangedAt:finite(previous?.lastChangedAt)});
  if(at<(finite(manualOverrideUntil)??0))return unchanged('manual-override');
  if(distance===null||distance<0)return unchanged('no-focus');
  let desired=bandForDistance(distance);
  if(priorBand&&desired.id!==priorBand.id){
    const desiredIndex=bandIndex(desired.id);
    if(desiredIndex<priorBandIndex){
      const closerBoundary=NAVIGATION_ZOOM_BANDS[desiredIndex].maxMeters;
      if(distance>closerBoundary*(1-clamp(hysteresisRatio,0,.45)))desired=priorBand;
    }else if(Number.isFinite(priorBand.maxMeters)&&distance<priorBand.maxMeters*(1+clamp(hysteresisRatio,0,.45)))desired=priorBand;
  }
  if(desired.id===priorBand?.id&&Math.abs(current-desired.zoom)<.5)return unchanged('stable',desired.id);
  const lastChangedAt=finite(previous?.lastChangedAt);
  if(lastChangedAt!==null&&at-lastChangedAt<Math.max(0,minimumChangeIntervalMs))return unchanged('rate-limited',priorBand?.id??desired.id);
  if(Math.abs(current-desired.zoom)<.5)return freeze({zoom:current,band:desired.id,changed:false,reason:'already-at-target',lastChangedAt});
  return freeze({zoom:desired.zoom,band:desired.id,changed:true,reason:'focus-distance-changed',lastChangedAt:at});
}
