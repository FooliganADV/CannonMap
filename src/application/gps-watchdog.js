const freeze=value=>Object.freeze({...value});
const finite=value=>Number.isFinite(Number(value))?Number(value):null;

/**
 * Owns exactly one browser geolocation watch and restarts transiently stalled
 * watches with bounded exponential backoff. Permission denial is terminal until
 * the rider explicitly starts the controller again after changing site access.
 */
export function createGpsWatchdog({
  geolocation=globalThis.navigator?.geolocation,
  now=()=>Date.now(),
  setTimer=globalThis.setTimeout,
  clearTimer=globalThis.clearTimeout,
  stallAfterMs=45_000,
  minRestartDelayMs=1_000,
  maxRestartDelayMs=60_000,
  backoffFactor=2,
  watchOptions={enableHighAccuracy:true,maximumAge:2_000,timeout:15_000},
  visible=()=>globalThis.document?.visibilityState!=='hidden',
  onPosition=()=>{},
  onError=()=>{},
  onStateChange=()=>{},
  onRestart=()=>{}
}={}){
  if(!geolocation||typeof geolocation.watchPosition!=='function'||typeof geolocation.clearWatch!=='function')throw new TypeError('geolocation watchPosition and clearWatch are required.');
  if(typeof now!=='function'||typeof setTimer!=='function'||typeof clearTimer!=='function'||typeof visible!=='function')throw new TypeError('clock, visibility, and timer functions are required.');
  const stallMs=Math.max(1_000,finite(stallAfterMs)??45_000),minimumDelay=Math.max(0,finite(minRestartDelayMs)??1_000),maximumDelay=Math.max(minimumDelay,finite(maxRestartDelayMs)??60_000),factor=Math.max(1,finite(backoffFactor)??2);
  let desired=false,destroyed=false,watchId=null,watchGeneration=0,watchStartedAt=null,stallTimer=null,retryTimer=null,status='stopped',startedAt=null,lastFixAt=null,lastSampleTimestamp=null,lastError=null,restartAttempts=0,nextRetryAt=null,stallCount=0;

  const snapshot=()=>{
    const timestamp=now(),ageMs=lastFixAt===null?null:Math.max(0,timestamp-lastFixAt),reported=status==='healthy'&&ageMs!==null&&ageMs>=stallMs?'stalled':status;
    return freeze({desired,destroyed,status:reported,watchActive:watchId!==null,startedAt,watchStartedAt,lastFixAt,lastSampleTimestamp,fixAgeMs:ageMs,lastError,restartAttempts,nextRetryAt,stallCount,stallAfterMs:stallMs});
  };
  const emit=()=>{const value=snapshot();try{onStateChange(value);}catch{}return value;};
  const clearStallTimer=()=>{if(stallTimer!==null){clearTimer(stallTimer);stallTimer=null;}};
  const clearRetryTimer=()=>{if(retryTimer!==null){clearTimer(retryTimer);retryTimer=null;}nextRetryAt=null;};
  const clearActiveWatch=()=>{if(watchId!==null){const current=watchId;watchId=null;try{geolocation.clearWatch(current);}catch{}}};

  function armStallTimer(generation=watchGeneration){
    clearStallTimer();if(!desired||watchId===null||!visible())return;
    const anchor=lastFixAt!==null&&lastFixAt>=watchStartedAt?lastFixAt:watchStartedAt,elapsed=anchor===null?0:Math.max(0,now()-anchor),delay=Math.max(0,stallMs-elapsed);
    stallTimer=setTimer(()=>{stallTimer=null;if(generation!==watchGeneration||!desired)return;checkNow();},delay);
  }
  function scheduleRestart(reason,error=null){
    if(!desired||destroyed)return snapshot();
    clearStallTimer();clearRetryTimer();clearActiveWatch();watchGeneration++;
    restartAttempts++;const delay=Math.min(maximumDelay,minimumDelay*factor**Math.max(0,restartAttempts-1));
    status='backoff';lastError=error?String(error?.message||error):lastError;nextRetryAt=now()+delay;
    try{onRestart({reason,attempt:restartAttempts,delay,error:lastError});}catch{}
    retryTimer=setTimer(()=>{retryTimer=null;nextRetryAt=null;if(desired&&!destroyed)startWatch(`retry:${reason}`);},delay);return emit();
  }
  function handlePosition(position,generation){
    if(!desired||destroyed||generation!==watchGeneration)return;
    lastFixAt=now();lastSampleTimestamp=finite(position?.timestamp);lastError=null;restartAttempts=0;nextRetryAt=null;status='healthy';
    armStallTimer(generation);emit();try{onPosition(position,snapshot());}catch{}
  }
  function handleError(error,generation){
    if(!desired||destroyed||generation!==watchGeneration)return;
    lastError=String(error?.message||error||'GPS watch failed.');try{onError(error,snapshot());}catch{}
    if(Number(error?.code)===1){clearStallTimer();clearRetryTimer();clearActiveWatch();watchGeneration++;status='blocked';emit();return;}
    scheduleRestart('watch-error',error);
  }
  function startWatch(reason='start'){
    if(!desired||destroyed||watchId!==null)return snapshot();
    clearRetryTimer();const generation=++watchGeneration;status='starting';startedAt=startedAt??now();lastError=null;emit();
    try{
      const id=geolocation.watchPosition(position=>handlePosition(position,generation),error=>handleError(error,generation),watchOptions);
      if(!desired||destroyed||generation!==watchGeneration){try{geolocation.clearWatch(id);}catch{}return snapshot();}
      watchId=id;watchStartedAt=now();armStallTimer(generation);emit();return snapshot();
    }catch(error){handleError(error,generation);return snapshot();}
  }
  function checkNow(){
    if(!desired||destroyed||watchId===null)return snapshot();
    if(!visible()){clearStallTimer();status='paused';return emit();}
    const anchor=lastFixAt!==null&&lastFixAt>=watchStartedAt?lastFixAt:watchStartedAt??now();if(now()-anchor<stallMs){armStallTimer();return snapshot();}
    stallCount++;status='stalled';emit();return scheduleRestart('fix-stalled',new Error(`No GPS fix received for ${stallMs} ms.`));
  }

  return Object.freeze({
    start(){
      if(destroyed)throw new Error('GPS watchdog is destroyed.');
      if(desired&&(watchId!==null||retryTimer!==null))return snapshot();
      desired=true;if(status==='blocked')restartAttempts=0;return startWatch('start');
    },
    restart(reason='manual-restart'){if(destroyed)throw new Error('GPS watchdog is destroyed.');desired=true;restartAttempts=0;clearRetryTimer();clearStallTimer();clearActiveWatch();watchGeneration++;return startWatch(reason);},
    checkNow,
    stop(reason='stop'){
      desired=false;watchGeneration++;clearStallTimer();clearRetryTimer();clearActiveWatch();status='stopped';lastError=reason==='stop'?lastError:null;emit();return snapshot();
    },
    state:snapshot,
    destroy(){if(destroyed)return snapshot();desired=false;watchGeneration++;clearStallTimer();clearRetryTimer();clearActiveWatch();status='stopped';destroyed=true;return emit();}
  });
}
