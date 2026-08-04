const finite=value=>Number.isFinite(Number(value))?Number(value):null;

/** Owns follow intent independently from map renders and objective updates. */
export function createGpsFollowController({map,debugLog,followScreenY=.62,smoothing=.35}={}){
  if(!map)throw new TypeError('map is required.');
  let mode='following',programmatic=false,last=null;
  const log=(type,details)=>debugLog?.record(type,details);
  const smooth=sample=>{
    if(!last){last={...sample};return last;}
    last={...sample,lat:last.lat+(sample.lat-last.lat)*smoothing,lon:last.lon+(sample.lon-last.lon)*smoothing,
      heading:sample.heading===null?last.heading:(last.heading===null?sample.heading:last.heading+(sample.heading-last.heading)*smoothing)};return last;
  };
  const recenter=sample=>{
    if(mode!=='following'||!sample)return false;
    const size=map.getSize(),zoom=map.getZoom(),point=map.project([sample.lat,sample.lon],zoom),requested=typeof followScreenY==='function'?followScreenY():followScreenY,target=Math.min(.75,Math.max(.3,finite(requested)??.62));
    const centerPoint={x:point.x,y:point.y+(size.y/2-size.y*target)};
    programmatic=true;log('map_recenter_requested',{lat:sample.lat,lon:sample.lon,mode});
    map.setView(map.unproject(centerPoint,zoom),zoom,{animate:false});programmatic=false;
    log('map_recenter_completed',{lat:sample.lat,lon:sample.lon,mode});return true;
  };
  const onMoveStart=event=>{if(!programmatic&&(event?.originalEvent||event?.sourceTarget===map)){mode='suspended';log('follow_mode_changed',{enabled:false,reason:'manual-map-movement'});}};
  map.on?.('dragstart',onMoveStart);
  return Object.freeze({
    update(position){const sample=smooth({lat:finite(position?.lat),lon:finite(position?.lon),heading:finite(position?.heading)});if(sample.lat===null||sample.lon===null)return null;recenter(sample);return {...sample};},
    restore(reason='gps-button'){mode='following';log('follow_mode_changed',{enabled:true,reason});if(last)recenter(last);return true;},
    suspend(reason='manual'){mode='suspended';log('follow_mode_changed',{enabled:false,reason});},
    orientationChanged(){log('orientation_changed',{mode});if(last&&mode==='following')recenter(last);},
    state:()=>Object.freeze({mode,following:mode==='following',last:last?{...last}:null}),
    destroy(){map.off?.('dragstart',onMoveStart);}
  });
}
