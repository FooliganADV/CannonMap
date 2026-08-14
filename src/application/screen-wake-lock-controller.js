const frozenState=value=>Object.freeze({...value});

/**
 * Optional Screen Wake Lock lifecycle for Rally Mode. Unsupported browsers,
 * denied permission, background tabs, and unexpected releases are all safe
 * states; navigation never depends on the lock being held.
 */
export function createScreenWakeLockController({
  wakeLock=globalThis.navigator?.wakeLock??null,
  documentRef=globalThis.document??null,
  debugLog=null,
  onStateChange=null
}={}){
  let desired=false,sentinel=null,requestPromise=null,destroyed=false,generation=0,lastError=null;
  const supported=Boolean(wakeLock&&typeof wakeLock.request==='function');
  const visible=()=>!documentRef||documentRef.visibilityState!=='hidden';
  const state=()=>frozenState({
    supported,
    desired,
    held:Boolean(sentinel&&!sentinel.released),
    requesting:Boolean(requestPromise),
    visible:visible(),
    lastError
  });
  const emit=(type,details={})=>{
    try{debugLog?.record?.(type,details);}catch{}
    try{onStateChange?.(state());}catch{}
  };

  const detach=current=>{
    if(!current)return;
    if(typeof current.removeEventListener==='function')current.removeEventListener('release',onRelease);
    else if(current.onrelease===onRelease)current.onrelease=null;
  };

  function onRelease(){
    const released=sentinel;
    detach(released);
    sentinel=null;
    emit('screen_wake_lock_released',{reason:'platform-release'});
    if(desired&&!destroyed&&visible())void acquire('platform-release');
  }

  async function acquire(reason='start'){
    if(destroyed||!desired)return frozenState({acquired:false,reason:'inactive',state:state()});
    if(!supported){
      emit('screen_wake_lock_unavailable',{reason:'unsupported'});
      return frozenState({acquired:false,reason:'unsupported',state:state()});
    }
    if(!visible())return frozenState({acquired:false,reason:'hidden',state:state()});
    if(sentinel&&!sentinel.released)return frozenState({acquired:true,reason:'already-held',state:state()});
    if(requestPromise)return requestPromise;
    const requestGeneration=generation;
    requestPromise=(async()=>{
      try{
        const acquired=await wakeLock.request('screen');
        if(destroyed||!desired||requestGeneration!==generation||!visible()){
          try{await acquired?.release?.();}catch{}
          return frozenState({acquired:false,reason:'request-obsolete',state:state()});
        }
        sentinel=acquired;
        lastError=null;
        if(typeof sentinel?.addEventListener==='function')sentinel.addEventListener('release',onRelease);
        else if(sentinel)sentinel.onrelease=onRelease;
        emit('screen_wake_lock_acquired',{reason});
        return frozenState({acquired:true,reason,state:state()});
      }catch(error){
        lastError=String(error?.message??error??'Wake Lock request failed');
        emit('screen_wake_lock_failed',{reason,error:lastError});
        return frozenState({acquired:false,reason:'request-failed',error:lastError,state:state()});
      }finally{
        requestPromise=null;
        try{onStateChange?.(state());}catch{}
      }
    })();
    return requestPromise;
  }

  const onVisibilityChange=()=>{
    emit('screen_wake_lock_visibility',{visibilityState:documentRef?.visibilityState??'visible'});
    if(desired&&visible())void acquire('visibility-restored');
  };
  documentRef?.addEventListener?.('visibilitychange',onVisibilityChange);

  async function stop(reason='rally-mode-inactive'){
    desired=false;
    generation++;
    const current=sentinel;
    sentinel=null;
    detach(current);
    if(current&&!current.released){
      try{await current.release?.();}catch(error){lastError=String(error?.message??error);}
    }
    emit('screen_wake_lock_released',{reason});
    return state();
  }

  return Object.freeze({
    async start(reason='rally-mode-active'){
      if(destroyed)return frozenState({acquired:false,reason:'destroyed',state:state()});
      desired=true;
      generation++;
      return acquire(reason);
    },
    async reacquire(reason='manual-reacquire'){
      if(!desired)return frozenState({acquired:false,reason:'inactive',state:state()});
      return acquire(reason);
    },
    stop,
    state,
    async destroy(){
      if(destroyed)return;
      documentRef?.removeEventListener?.('visibilitychange',onVisibilityChange);
      await stop('destroyed');
      destroyed=true;
    }
  });
}
