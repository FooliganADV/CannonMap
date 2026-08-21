const abortError=()=>typeof DOMException==='function'
  ?new DOMException('Lower-priority camera work was preempted.','AbortError')
  :Object.assign(new Error('Lower-priority camera work was preempted.'),{name:'AbortError'});

const finiteTimestamp=value=>{
  const timestamp=typeof value==='number'?value:new Date(value).valueOf();
  return Number.isFinite(timestamp)?timestamp:null;
};

/**
 * A deliberately small, composition-scoped camera mutex.
 *
 * Checkpoint work is serialized and always has priority. Starting checkpoint
 * work aborts an in-flight Ride Memory capture and waits for its cleanup before
 * allowing the checkpoint camera task to acquire a stream. Ride Memory work is
 * never queued behind another camera operation; its scheduler can retry later.
 */
export function createCameraCaptureArbiter({clock={now:()=>Date.now()},onEvent=()=>{}}={}){
  let current=null,pendingCheckpoints=0,checkpointTail=Promise.resolve(),lastCheckpointCapture=null,destroyed=false;

  const emit=(eventType,details={})=>{
    try{onEvent(Object.freeze({eventType,occurredAt:new Date(clock.now()).toISOString(),...details}));}catch{}
  };

  async function execute(kind,task){
    if(destroyed)throw Object.assign(new Error('Camera capture arbiter is destroyed.'),{code:'CAMERA_ARBITER_DESTROYED'});
    const controller=new AbortController(),slot={kind,controller,promise:null,startedAt:clock.now()};
    current=slot;emit('camera_arbiter_started',{kind});
    slot.promise=Promise.resolve().then(()=>task(Object.freeze({signal:controller.signal,kind})));
    try{return await slot.promise;}
    finally{
      if(current===slot)current=null;
      emit('camera_arbiter_released',{kind,aborted:controller.signal.aborted});
    }
  }

  async function runCheckpoint(task){
    if(typeof task!=='function')throw new TypeError('Checkpoint camera task is required.');
    if(destroyed)throw Object.assign(new Error('Camera capture arbiter is destroyed.'),{code:'CAMERA_ARBITER_DESTROYED'});
    pendingCheckpoints+=1;
    const prior=checkpointTail;
    let release;
    checkpointTail=new Promise(resolve=>{release=resolve;});
    if(current?.kind==='ride_memory'){
      emit('ride_memory_preempted',{reason:'checkpoint-requested'});
      current.controller.abort(abortError());
      await current.promise.catch(()=>{});
    }
    await prior;
    try{
      if(current?.kind==='ride_memory'){
        emit('ride_memory_preempted',{reason:'checkpoint-started'});
        current.controller.abort(abortError());
        await current.promise.catch(()=>{});
      }
      return await execute('checkpoint',task);
    }finally{
      pendingCheckpoints-=1;
      release();
    }
  }

  async function tryRunMemory(task){
    if(typeof task!=='function')throw new TypeError('Ride Memory camera task is required.');
    if(destroyed)return Object.freeze({started:false,reason:'arbiter-destroyed'});
    if(current||pendingCheckpoints>0)return Object.freeze({started:false,reason:pendingCheckpoints>0?'checkpoint-pending':`${current.kind}-active`});
    try{return Object.freeze({started:true,value:await execute('ride_memory',task)});}
    catch(error){error.cameraWorkKind='ride_memory';throw error;}
  }

  function noteCheckpointCapture(input={}){
    const capturedAt=finiteTimestamp(input.capturedAt??clock.now());
    if(capturedAt===null)return null;
    lastCheckpointCapture=Object.freeze({
      capturedAt:new Date(capturedAt).toISOString(),capturedAtMs:capturedAt,
      checkpointId:input.checkpointId?String(input.checkpointId):null,
      mediaIds:Object.freeze([...(input.mediaIds||[])].filter(Boolean).map(String))
    });
    emit('checkpoint_capture_noted',{checkpointId:lastCheckpointCapture.checkpointId,capturedAt:lastCheckpointCapture.capturedAt});
    return lastCheckpointCapture;
  }

  function checkpointCoverage(scheduledAt,windowMs=5*60*1000){
    const scheduled=finiteTimestamp(scheduledAt),limit=Math.max(0,Number(windowMs)||0);
    if(scheduled===null||!lastCheckpointCapture||Math.abs(lastCheckpointCapture.capturedAtMs-scheduled)>limit)return null;
    return lastCheckpointCapture;
  }

  function cancelMemory(reason='ride-memory-stopped'){
    if(current?.kind!=='ride_memory')return false;
    emit('ride_memory_canceled',{reason});current.controller.abort(abortError());return true;
  }

  function state(){
    return Object.freeze({
      currentKind:current?.kind||null,currentStartedAt:current?new Date(current.startedAt).toISOString():null,
      pendingCheckpoints,destroyed,lastCheckpointCapture
    });
  }

  return Object.freeze({
    runCheckpoint,tryRunMemory,noteCheckpointCapture,checkpointCoverage,cancelMemory,state,
    destroy(){if(destroyed)return;cancelMemory('arbiter-destroyed');destroyed=true;emit('camera_arbiter_destroyed');}
  });
}
