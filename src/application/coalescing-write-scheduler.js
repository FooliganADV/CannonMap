const freeze=value=>Object.freeze({...value});

/**
 * Coalesces high-cadence live updates into bounded durable writes. A write in
 * progress is never overlapped; dirtiness raised during it is retained.
 */
export function createCoalescingWriteScheduler({
  write,
  now=()=>Date.now(),
  setTimer=globalThis.setTimeout,
  clearTimer=globalThis.clearTimeout,
  delayMs=5_000,
  maxWaitMs=30_000,
  onStateChange=()=>{}
}={}){
  if(typeof write!=='function')throw new TypeError('write is required.');
  const delay=Math.max(0,Number(delayMs)||0),maxWait=Math.max(delay,Number(maxWaitMs)||delay);
  let dirty=false,dirtySince=null,timer=null,nextWriteAt=null,inFlight=null,stopped=false,reasons=new Set(),writeCount=0,lastWriteAt=null,lastError=null;
  const snapshot=()=>freeze({dirty,dirtySince,timerActive:timer!==null,nextWriteAt,inFlight:Boolean(inFlight),stopped,reasons:Object.freeze([...reasons]),writeCount,lastWriteAt,lastError});
  const emit=()=>{const value=snapshot();try{onStateChange(value);}catch{}return value;};
  const clearScheduled=()=>{if(timer!==null){clearTimer(timer);timer=null;}nextWriteAt=null;};
  const schedule=()=>{
    if(stopped||!dirty||inFlight||timer!==null)return emit();
    const timestamp=now(),due=Math.min(timestamp+delay,(dirtySince??timestamp)+maxWait);nextWriteAt=due;
    timer=setTimer(()=>{timer=null;nextWriteAt=null;void flush('scheduled');},Math.max(0,due-timestamp));return emit();
  };
  async function flush(reason='manual'){
    clearScheduled();if(inFlight)return inFlight;if(!dirty)return snapshot();
    const batchReasons=[...reasons];reasons.clear();dirty=false;dirtySince=null;
    inFlight=(async()=>{
      try{await write({reason,reasons:batchReasons,requestedAt:now()});writeCount++;lastWriteAt=now();lastError=null;}
      catch(error){lastError=String(error?.message||error);dirty=true;dirtySince=dirtySince??now();for(const item of batchReasons)reasons.add(item);}
      finally{inFlight=null;if(dirty&&!stopped)schedule();emit();}
      return snapshot();
    })();return inFlight;
  }
  return Object.freeze({
    markDirty(reason='update'){if(stopped)return snapshot();dirty=true;dirtySince=dirtySince??now();reasons.add(String(reason));schedule();return snapshot();},
    flush,
    async stop({flush:shouldFlush=true}={}){stopped=true;clearScheduled();if(shouldFlush&&dirty){stopped=false;await flush('stop');stopped=true;clearScheduled();}if(inFlight)await inFlight;clearScheduled();return emit();},
    state:snapshot
  });
}
