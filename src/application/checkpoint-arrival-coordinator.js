const finite=value=>Number.isFinite(Number(value))?Number(value):null;

function timestamp(value){
  if(value instanceof Date)return value.getTime();
  const numeric=finite(value);
  return numeric===null?null:numeric;
}

function copyValue(value,seen=new WeakMap()){
  if(value===null||typeof value!=='object')return value;
  if(value instanceof Date)return new Date(value.getTime()).toISOString();
  if(seen.has(value))return seen.get(value);
  const copy=Array.isArray(value)?[]:{};
  seen.set(value,copy);
  for(const [key,item] of Object.entries(value))copy[key]=copyValue(item,seen);
  return copy;
}

function freezeDeep(value,seen=new WeakSet()){
  if(value===null||typeof value!=='object'||seen.has(value))return value;
  seen.add(value);
  for(const item of Object.values(value))freezeDeep(item,seen);
  return Object.freeze(value);
}

const immutableSnapshot=value=>freezeDeep(copyValue(value));

function checkpointIdOf(detection){
  const id=detection?.checkpointId??detection?.id??detection?.checkpoint?.id;
  return id===undefined||id===null||String(id).trim()===''?null:String(id);
}

function normalizedDetection(detection,inputOrder,defaultMaxAccuracyFeet){
  const checkpointId=checkpointIdOf(detection);
  return {
    source:detection,
    checkpointId,
    inputOrder,
    distanceFeet:finite(detection?.distanceFeet),
    accuracyFeet:finite(detection?.accuracyFeet),
    radiusFeet:finite(detection?.radiusFeet),
    maxAccuracyFeet:finite(detection?.maxAccuracyFeet)??defaultMaxAccuracyFeet,
    eligible:detection?.eligible!==false&&detection?.collected!==true
  };
}

function dedupeDetections(detections,defaultMaxAccuracyFeet){
  const unique=new Map();
  for(const [index,raw] of (Array.isArray(detections)?detections:[]).entries()){
    const item=normalizedDetection(raw,index,defaultMaxAccuracyFeet);
    if(!item.checkpointId)continue;
    const previous=unique.get(item.checkpointId);
    if(!previous||(
      item.distanceFeet!==null&&
      (previous.distanceFeet===null||item.distanceFeet<previous.distanceFeet)
    ))unique.set(item.checkpointId,item);
  }
  return [...unique.values()];
}

function compareArrivals(a,b){
  return a.enteredAt-b.enteredAt||
    a.detectedAt-b.detectedAt||
    a.distanceFeet-b.distanceFeet||
    a.checkpointId.localeCompare(b.checkpointId,'en',{numeric:true})||
    a.arrivalSequence-b.arrivalSequence;
}

/**
 * Keeps independent dwell state for every nearby checkpoint and serializes
 * accepted arrivals. Optional persistArrival(arrival) starts at acceptance;
 * its resolved value is passed to processArrival(arrival, persistenceResult)
 * only after persistence succeeds. The caller supplies distance calculations
 * so this module can remain independent of the map engine and UI.
 */
export function createCheckpointArrivalCoordinator({
  dwellMs=2000,
  maxAccuracyFeet=200,
  clock=()=>Date.now(),
  persistArrival=null,
  processArrival=null,
  onError=null
}={}){
  const dwell=Math.max(0,finite(dwellMs)??2000);
  const defaultMaxAccuracy=Math.max(0,finite(maxAccuracyFeet)??200);
  const candidates=new Map(),queuedIds=new Set(),handledIds=new Set(),queue=[],persistenceBySequence=new Map();
  let nextSequence=1,processing=false,destroyed=false,pumpPromise=Promise.resolve();

  const beginPersistence=arrival=>{
    if(typeof persistArrival!=='function')return;
    let pending;
    try{pending=Promise.resolve(persistArrival(arrival));}
    catch(error){pending=Promise.reject(error);}
    // Convert rejection to data immediately. A later arrival can fail while an
    // earlier one is still in a long media workflow without causing an
    // unhandled rejection before the serialized pump reaches it.
    persistenceBySequence.set(arrival.arrivalSequence,pending.then(
      value=>Object.freeze({ok:true,value}),
      error=>Object.freeze({ok:false,error})
    ));
  };

  const schedule=()=>{
    if(destroyed||processing||typeof processArrival!=='function'||queue.length===0)return;
    processing=true;
    pumpPromise=(async()=>{
      while(!destroyed&&queue.length){
        queue.sort(compareArrivals);
        const arrival=queue.shift();
        try{
          let persistenceResult;
          if(persistenceBySequence.has(arrival.arrivalSequence)){
            const persisted=await persistenceBySequence.get(arrival.arrivalSequence);
            if(!persisted.ok)throw persisted.error;
            persistenceResult=persisted.value;
          }
          await processArrival(arrival,persistenceResult);
          handledIds.add(arrival.checkpointId);
        }catch(error){
          if(typeof onError==='function')await onError(error,arrival);
        }finally{
          persistenceBySequence.delete(arrival.arrivalSequence);
          queuedIds.delete(arrival.checkpointId);
        }
      }
    })().finally(()=>{
      processing=false;
      if(!destroyed&&queue.length)schedule();
    });
  };

  const enqueue=(item,candidate,context)=>{
    if(queuedIds.has(item.checkpointId)||handledIds.has(item.checkpointId))return null;
    const detectedAt=context.observedAt;
    const speedMph=finite(context.speedMph);
    const event=immutableSnapshot({
      type:'checkpoint-arrival',
      arrivalSequence:nextSequence++,
      checkpointId:item.checkpointId,
      checkpoint:item.source.checkpoint??null,
      enteredAt:candidate.enteredAt,
      detectedAt,
      enteredAtIso:new Date(candidate.enteredAt).toISOString(),
      detectedAtIso:new Date(detectedAt).toISOString(),
      distanceFeet:item.distanceFeet,
      accuracyFeet:item.accuracyFeet,
      radiusFeet:item.radiusFeet,
      speedMph,
      priorTargetId:candidate.priorTargetId,
      outOfOrder:Boolean(candidate.priorTargetId&&candidate.priorTargetId!==item.checkpointId),
      evidence:{
        entry:candidate.entryEvidence,
        detection:context.gpsEvidence??context.position??null,
        metadata:item.source.metadata??null
      }
    });
    queuedIds.add(item.checkpointId);
    queue.push(event);
    beginPersistence(event);
    queue.sort(compareArrivals);
    return event;
  };

  return Object.freeze({
    /**
     * Observe all checkpoint distances from one GPS sample. Multiple accepted
     * checkpoints are retained and ordered rather than allowing the last hit
     * to overwrite the first.
     */
    observe({
      detections=[],
      observedAt=clock(),
      speedMph=null,
      priorTargetId=null,
      gpsEvidence=null,
      position=null
    }={}){
      if(destroyed)return Object.freeze({started:[],accepted:[],rejected:[],pending:0});
      const at=timestamp(observedAt);
      if(at===null)throw new TypeError('observedAt must be a finite millisecond timestamp.');
      const context={
        observedAt:at,
        speedMph,
        priorTargetId:priorTargetId===undefined||priorTargetId===null?null:String(priorTargetId),
        gpsEvidence:immutableSnapshot(gpsEvidence??position)
      };
      const started=[],accepted=[],rejected=[];
      for(const item of dedupeDetections(detections,defaultMaxAccuracy)){
        if(!item.eligible){
          candidates.delete(item.checkpointId);
          rejected.push(Object.freeze({checkpointId:item.checkpointId,reason:'ineligible'}));
          continue;
        }
        if(queuedIds.has(item.checkpointId)||handledIds.has(item.checkpointId)){
          rejected.push(Object.freeze({checkpointId:item.checkpointId,reason:'already-detected'}));
          continue;
        }
        if(item.distanceFeet===null||item.radiusFeet===null){
          rejected.push(Object.freeze({checkpointId:item.checkpointId,reason:'location-unavailable'}));
          continue;
        }
        const candidate=candidates.get(item.checkpointId);
        if(item.accuracyFeet===null||item.accuracyFeet>item.maxAccuracyFeet){
          rejected.push(Object.freeze({checkpointId:item.checkpointId,reason:'accuracy-poor'}));
          continue;
        }
        const compensatedRadius=item.radiusFeet+Math.min(item.accuracyFeet,item.maxAccuracyFeet);
        if(item.distanceFeet>compensatedRadius){
          candidates.delete(item.checkpointId);
          rejected.push(Object.freeze({checkpointId:item.checkpointId,reason:'outside-radius'}));
          continue;
        }
        let active=candidate;
        if(!active){
          active=immutableSnapshot({
            checkpointId:item.checkpointId,
            enteredAt:at,
            priorTargetId:context.priorTargetId,
            entryEvidence:context.gpsEvidence,
            initialDistanceFeet:item.distanceFeet
          });
          candidates.set(item.checkpointId,active);
          started.push(item.checkpointId);
        }
        if(at-active.enteredAt>=dwell){
          candidates.delete(item.checkpointId);
          const event=enqueue(item,active,context);
          if(event)accepted.push(event);
        }
      }
      accepted.sort(compareArrivals);
      schedule();
      return Object.freeze({
        started:Object.freeze(started),
        accepted:Object.freeze(accepted),
        rejected:Object.freeze(rejected),
        pending:candidates.size,
        queued:queue.length+(processing?1:0)
      });
    },

    /** Consume queued arrivals manually when no processArrival callback is used. */
    takeNext(){
      if(typeof processArrival==='function'||processing||queue.length===0)return null;
      queue.sort(compareArrivals);
      const arrival=queue.shift();
      persistenceBySequence.delete(arrival.arrivalSequence);
      queuedIds.delete(arrival.checkpointId);
      handledIds.add(arrival.checkpointId);
      return arrival;
    },

    /** Wait until the configured asynchronous arrival processor is idle. */
    async whenIdle(){
      do{await pumpPromise;}while(processing||queue.length&&typeof processArrival==='function');
    },

    /** Permit a checkpoint to be detected again after an explicit caller reset. */
    release(checkpointId){
      const id=String(checkpointId??'');
      candidates.delete(id);
      handledIds.delete(id);
      const index=queue.findIndex(item=>item.checkpointId===id);
      if(index>=0){const [arrival]=queue.splice(index,1);persistenceBySequence.delete(arrival.arrivalSequence);}
      queuedIds.delete(id);
    },

    state(){
      return immutableSnapshot({
        candidates:[...candidates.values()],
        queued:queue,
        handledCheckpointIds:[...handledIds].sort((a,b)=>a.localeCompare(b,'en',{numeric:true})),
        processing
      });
    },

    destroy(){
      destroyed=true;
      candidates.clear();
      queue.length=0;
      queuedIds.clear();
      persistenceBySequence.clear();
    }
  });
}
