const freeze=value=>Object.freeze({...value});
const finite=value=>Number.isFinite(Number(value))?Number(value):null;

/** Serial, reconnect-aware polling. It never owns more than one timer/request. */
export function createLivePollController({
  poll,
  now=()=>Date.now(),
  setTimer=globalThis.setTimeout,
  clearTimer=globalThis.clearTimeout,
  intervalMs=30_000,
  staleAfterMs=90_000,
  minRetryMs=2_000,
  maxRetryMs=60_000,
  online=()=>globalThis.navigator?.onLine!==false,
  visible=()=>globalThis.document?.visibilityState!=='hidden',
  connectivityTarget=globalThis.window??null,
  visibilityTarget=globalThis.document??null,
  onSnapshot=()=>{},
  onStateChange=()=>{}
}={}){
  if(typeof poll!=='function')throw new TypeError('poll is required.');
  const interval=Math.max(1_000,finite(intervalMs)??30_000),staleMs=Math.max(interval,finite(staleAfterMs)??90_000),retryMin=Math.max(0,finite(minRetryMs)??2_000),retryMax=Math.max(retryMin,finite(maxRetryMs)??60_000);
  let desired=false,destroyed=false,bound=false,timer=null,inFlight=null,abortController=null,generation=0,status='stopped',lastAttemptAt=null,lastSuccessAt=null,lastError=null,consecutiveFailures=0,nextPollAt=null,pollCount=0,successCount=0;
  const currentStatus=()=>{if(!desired)return'stopped';if(!online())return'offline';if(!visible())return'paused';if(inFlight)return'polling';if(lastSuccessAt!==null&&now()-lastSuccessAt>staleMs)return'stale';return status;};
  const snapshot=()=>freeze({desired,destroyed,status:currentStatus(),online:Boolean(online()),visible:Boolean(visible()),timerActive:timer!==null,inFlight:Boolean(inFlight),lastAttemptAt,lastSuccessAt,ageMs:lastSuccessAt===null?null:Math.max(0,now()-lastSuccessAt),lastError,consecutiveFailures,nextPollAt,pollCount,successCount});
  const emit=()=>{const value=snapshot();try{onStateChange(value);}catch{}return value;};
  const clearScheduled=()=>{if(timer!==null){clearTimer(timer);timer=null;}nextPollAt=null;};
  const schedule=(delay,reason)=>{
    clearScheduled();if(!desired||destroyed||!online()||!visible())return emit();
    const bounded=Math.max(0,Number(delay)||0),scheduledGeneration=generation;nextPollAt=now()+bounded;
    timer=setTimer(()=>{timer=null;nextPollAt=null;if(scheduledGeneration===generation)void trigger(reason);},bounded);return emit();
  };
  const failureDelay=()=>Math.min(retryMax,retryMin*2**Math.max(0,consecutiveFailures-1));
  async function trigger(reason='manual'){
    if(!desired||destroyed)return snapshot();
    if(!online()){clearScheduled();status='offline';return emit();}
    if(!visible()){clearScheduled();status='paused';return emit();}
    if(inFlight)return inFlight;
    clearScheduled();const requestGeneration=generation,controller=new AbortController();abortController=controller;lastAttemptAt=now();pollCount++;status='polling';emit();
    inFlight=(async()=>{let nextDelay=null,nextReason=null;
      try{
        const value=await poll({signal:controller.signal,reason});
        if(!desired||destroyed||requestGeneration!==generation)return snapshot();
        lastSuccessAt=now();lastError=null;consecutiveFailures=0;successCount++;status='live';try{await onSnapshot(value,{reason,receivedAt:lastSuccessAt});}catch(error){lastError=String(error?.message||error);status='degraded';}
        nextDelay=interval;nextReason='interval';return snapshot();
      }catch(error){
        if(!desired||destroyed||requestGeneration!==generation||error?.name==='AbortError')return snapshot();
        lastError=String(error?.message||error);consecutiveFailures++;status='error';nextDelay=failureDelay();nextReason='retry';return snapshot();
      }finally{if(requestGeneration===generation){inFlight=null;abortController=null;if(nextDelay!==null)schedule(nextDelay,nextReason);else emit();}}
    })();
    return inFlight;
  }
  const onOffline=()=>{if(!desired)return;generation++;clearScheduled();abortController?.abort();abortController=null;inFlight=null;status='offline';emit();};
  const resume=(reason)=>{if(!desired||!online()||!visible()||inFlight)return snapshot();generation++;status='reconnecting';void trigger(reason);return snapshot();};
  const onOnline=()=>{resume('network-online');};
  const onVisibility=()=>{if(!desired)return;if(!visible()){generation++;clearScheduled();abortController?.abort();abortController=null;inFlight=null;status='paused';emit();}else resume('foreground');};
  const bind=()=>{if(bound)return;connectivityTarget?.addEventListener?.('online',onOnline);connectivityTarget?.addEventListener?.('offline',onOffline);visibilityTarget?.addEventListener?.('visibilitychange',onVisibility);bound=true;};
  const unbind=()=>{if(!bound)return;connectivityTarget?.removeEventListener?.('online',onOnline);connectivityTarget?.removeEventListener?.('offline',onOffline);visibilityTarget?.removeEventListener?.('visibilitychange',onVisibility);bound=false;};
  return Object.freeze({
    start(){if(destroyed)throw new Error('Live poll controller is destroyed.');if(desired)return snapshot();desired=true;generation++;bind();status=!online()?'offline':!visible()?'paused':'starting';emit();if(online()&&visible())void trigger('start');return snapshot();},
    trigger,
    networkChanged(){online()?onOnline():onOffline();return snapshot();},
    visibilityChanged(){onVisibility();return snapshot();},
    stop(){if(!desired)return snapshot();desired=false;generation++;clearScheduled();abortController?.abort();abortController=null;inFlight=null;status='stopped';unbind();return emit();},
    state:snapshot,
    destroy(){if(destroyed)return snapshot();desired=false;generation++;clearScheduled();abortController?.abort();abortController=null;inFlight=null;status='stopped';unbind();destroyed=true;return emit();}
  });
}
