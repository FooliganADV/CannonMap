const finite=value=>Number.isFinite(Number(value))?Number(value):null;

/** Owns follow intent independently from map renders and objective updates. */
export function createGpsFollowController({
  map,
  debugLog,
  followScreenY=.62,
  smoothing=.35,
  zoomSmoothing=1,
  minZoomIntervalMs=1800,
  now=()=>Date.now()
}={}){
  if(!map)throw new TypeError('map is required.');
  const zoomStep=Math.max(.1,finite(zoomSmoothing)??1),zoomInterval=Math.max(0,finite(minZoomIntervalMs)??1800);
  let mode='following',programmaticDepth=0,last=null,targetZoom=null,targetZoomReason=null,lastZoomChangeAt=null;
  const log=(type,details)=>debugLog?.record(type,details);
  const performProgrammaticMapChange=(operation,{reason='application-map-change'}={})=>{
    if(typeof operation!=='function')throw new TypeError('A map change operation is required.');
    programmaticDepth++;
    let result;
    try{result=operation();}
    catch(error){programmaticDepth--;throw error;}
    if(result&&typeof result.then==='function')return Promise.resolve(result).finally(()=>{programmaticDepth--;});
    programmaticDepth--;
    log('programmatic_map_change_completed',{reason});
    return result;
  };
  const normalizeZoom=value=>{
    const parsed=finite(value);if(parsed===null)return null;
    const minimum=finite(map.getMinZoom?.()),maximum=finite(map.getMaxZoom?.());
    return Math.min(maximum??Infinity,Math.max(minimum??-Infinity,parsed));
  };
  const smooth=sample=>{
    if(!last){last={...sample};return last;}
    last={...sample,lat:last.lat+(sample.lat-last.lat)*smoothing,lon:last.lon+(sample.lon-last.lon)*smoothing,
      heading:sample.heading===null?last.heading:(last.heading===null?sample.heading:last.heading+(sample.heading-last.heading)*smoothing)};return last;
  };
  const chooseZoom=(current,{forceZoom=false}={})=>{
    if(targetZoom===null)return {zoom:current,changed:false};
    const timestamp=finite(now())??Date.now(),due=forceZoom||lastZoomChangeAt===null||timestamp-lastZoomChangeAt>=zoomInterval;
    if(!due||Math.abs(targetZoom-current)<.05)return {zoom:current,changed:false};
    const delta=targetZoom-current,zoom=Math.abs(delta)<=zoomStep?targetZoom:current+Math.sign(delta)*zoomStep;
    return {zoom,changed:true,timestamp};
  };
  const recenter=(sample,options={})=>{
    if(mode!=='following'||!sample)return false;
    const size=map.getSize(),currentZoom=normalizeZoom(map.getZoom())??map.getZoom(),zoomChoice=chooseZoom(currentZoom,options),zoom=zoomChoice.zoom,
      point=map.project([sample.lat,sample.lon],zoom),requested=typeof followScreenY==='function'?followScreenY():followScreenY,target=Math.min(.75,Math.max(.3,finite(requested)??.62));
    const centerPoint={x:point.x,y:point.y+(size.y/2-size.y*target)};
    log('map_recenter_requested',{lat:sample.lat,lon:sample.lon,mode,zoom,targetZoom,zoomReason:targetZoomReason});
    performProgrammaticMapChange(()=>map.setView(map.unproject(centerPoint,zoom),zoom,{animate:false}),{reason:'gps-follow'});
    if(zoomChoice.changed){lastZoomChangeAt=zoomChoice.timestamp;log('map_follow_zoom_changed',{zoom,targetZoom,reason:targetZoomReason});}
    log('map_recenter_completed',{lat:sample.lat,lon:sample.lon,mode,zoom});return true;
  };
  const suspendForMapGesture=reason=>{if(programmaticDepth>0||mode==='suspended')return;mode='suspended';log('follow_mode_changed',{enabled:false,reason});};
  const onMoveStart=()=>suspendForMapGesture('manual-map-drag');
  const onZoomStart=()=>suspendForMapGesture('manual-map-zoom');
  map.on?.('dragstart',onMoveStart);
  map.on?.('zoomstart',onZoomStart);
  return Object.freeze({
    update(position,{targetZoom:requestedZoom,zoomReason}={}){
      const sample={lat:finite(position?.lat),lon:finite(position?.lon),heading:finite(position?.heading)};if(sample.lat===null||sample.lon===null)return null;
      if(requestedZoom!==undefined){targetZoom=normalizeZoom(requestedZoom);targetZoomReason=targetZoom===null?null:(zoomReason||'position-context');}
      const filtered=smooth(sample);recenter(filtered);return {...filtered};
    },
    setTargetZoom(value,{reason='navigation-context',immediate=false}={}){
      targetZoom=normalizeZoom(value);targetZoomReason=targetZoom===null?null:reason;
      log('map_follow_zoom_target_changed',{targetZoom,reason:targetZoomReason});
      if(immediate&&last&&mode==='following')recenter(last,{forceZoom:true});
      return targetZoom;
    },
    performProgrammaticMapChange,
    clearTargetZoom(reason='navigation-context-cleared'){targetZoom=null;targetZoomReason=null;log('map_follow_zoom_target_changed',{targetZoom:null,reason});},
    restore(reason='gps-button'){mode='following';log('follow_mode_changed',{enabled:true,reason});if(last)recenter(last,{forceZoom:true});return true;},
    suspend(reason='manual'){mode='suspended';log('follow_mode_changed',{enabled:false,reason});},
    orientationChanged(){log('orientation_changed',{mode});if(last&&mode==='following')recenter(last);},
    state:()=>Object.freeze({mode,following:mode==='following',last:last?{...last}:null,targetZoom,targetZoomReason,lastZoomChangeAt}),
    destroy(){map.off?.('dragstart',onMoveStart);map.off?.('zoomstart',onZoomStart);}
  });
}
