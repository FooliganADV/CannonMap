export const RIDE_MEMORY_CAPTURE_TYPE='ride_memory';
export const DEFAULT_RIDE_MEMORY_INTERVAL_MS=60*60*1000;
export const DEFAULT_CHECKPOINT_COVERAGE_WINDOW_MS=5*60*1000;

const MPS_TO_MPH=2.23694;
const SCHEMA_VERSION=1;
const MAX_TIMER_DELAY=0x7fffffff;

const timestamp=value=>{
  if(value===null||value===undefined||value==='')return null;
  const result=typeof value==='number'?value:new Date(value).valueOf();
  return Number.isFinite(result)?result:null;
};
const positive=(value,fallback)=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):fallback;
const finite=value=>Number.isFinite(Number(value))?Number(value):null;
const iso=value=>new Date(value).toISOString();
const clone=value=>value===null||value===undefined?value:structuredClone(value);
const safeStamp=value=>iso(value).replace(/[-:]/g,'').replace('T','_').replace('Z','').replace('.','-');
const activeSession=value=>Boolean(value&&value.active!==false&&value.projectId&&value.sessionId&&Number(value.dayNumber)>0);
const abortLike=error=>error?.name==='AbortError'||error?.code==='CAMERA_SCOPE_CHANGED';

function gpsMetadata(position,now){
  const raw=position?.coords?{
    latitude:position.coords.latitude,longitude:position.coords.longitude,
    speedMps:position.coords.speed,heading:position.coords.heading,
    accuracyFeet:finite(position.coords.accuracy)===null?null:Number(position.coords.accuracy)*3.28084,
    sampleTimestamp:position.timestamp
  }:{
    latitude:position?.latitude??position?.lat,longitude:position?.longitude??position?.lon,
    speedMps:position?.speedMps,heading:position?.heading??position?.deviceHeading,
    accuracyFeet:position?.gpsAccuracyFeet??position?.accuracyFeet,
    sampleTimestamp:position?.gpsSampleTimestamp??position?.time??position?.timestamp
  };
  const sampleMs=timestamp(raw.sampleTimestamp),speedMph=finite(position?.speedMph)??(finite(raw.speedMps)===null?null:Number(raw.speedMps)*MPS_TO_MPH);
  return Object.freeze({
    latitude:finite(raw.latitude),longitude:finite(raw.longitude),speedMph,
    deviceHeading:finite(raw.heading),gpsAccuracy:finite(raw.accuracyFeet),
    gpsSampleTimestamp:sampleMs===null?null:iso(sampleMs),gpsSampleAgeMs:sampleMs===null?null:Math.max(0,now-sampleMs)
  });
}

function nextFutureSlot(scheduledAt,intervalMs,now){
  let next=scheduledAt+intervalMs;
  if(next<=now)next+=Math.ceil((now-next+1)/intervalMs)*intervalMs;
  return next;
}

/**
 * Samsung-first hourly Ride Memory capture. The service owns schedule metadata,
 * not a camera session. Camera acquisition is injected and must share CannonMap's
 * existing retained Android session through cameraArbiter.
 */
export function createRideMemoryCaptureService({
  captureStill,mediaRepository,journal,createId,stateStore,cameraArbiter,
  sessionProvider,positionProvider=()=>null,checkpointActivity=()=>({}),
  documentRef=globalThis.document,clock={now:()=>Date.now()},
  timerApi={setTimeout:(handler,delay)=>setTimeout(handler,delay),clearTimeout:handle=>clearTimeout(handle)},
  intervalMs=DEFAULT_RIDE_MEMORY_INTERVAL_MS,coverageWindowMs=DEFAULT_CHECKPOINT_COVERAGE_WINDOW_MS,
  retryDelayMs=60*1000,missedGraceMs=60*1000,onState=()=>{},onDiagnostic=()=>{}
}={}){
  if(typeof captureStill!=='function'||typeof mediaRepository?.addOriginal!=='function'||typeof mediaRepository?.getMedia!=='function')throw new TypeError('Ride Memory capture and media repository ports are required.');
  if(typeof journal?.appendEventIdempotent!=='function'||typeof createId!=='function'||typeof stateStore?.load!=='function'||typeof stateStore?.save!=='function')throw new TypeError('Ride Memory Journal, identity, and state-store ports are required.');
  if(typeof cameraArbiter?.tryRunMemory!=='function'||typeof sessionProvider!=='function')throw new TypeError('Ride Memory camera arbitration and session context are required.');
  let every=positive(intervalMs,DEFAULT_RIDE_MEMORY_INTERVAL_MS);
  const coverage=positive(coverageWindowMs,DEFAULT_CHECKPOINT_COVERAGE_WINDOW_MS),retryAfter=positive(retryDelayMs,60*1000),missedGrace=positive(missedGraceMs,60*1000);
  let running=false,destroyed=false,generation=0,timer=null,startPromise=null,tickPromise=null,context=null,state=null,visibilitySubscribed=false;

  const now=()=>Number(clock.now());
  const visible=()=>String(documentRef?.visibilityState||'visible')==='visible';
  const ownsGeneration=token=>running&&!destroyed&&token===generation;
  const emit=(eventType,details={})=>{try{onDiagnostic(Object.freeze({eventType,occurredAt:iso(now()),sessionId:context?.sessionId||null,...details}));}catch{}};
  const publish=()=>{try{onState(snapshot());}catch{}};
  const snapshot=()=>Object.freeze({running,destroyed,timerScheduled:timer!==null,captureActive:Boolean(tickPromise),context:clone(context),schedule:clone(state)});

  async function saveState(){
    if(!state)return false;
    const attemptedAt=iso(now()),priorLastPersistedAt=state.lastPersistedAt||null;state.updatedAt=attemptedAt;state.persistenceStatus='ready';state.persistenceError=null;state.lastPersistedAt=attemptedAt;
    try{await stateStore.save(state);return true;}
    catch(error){state.persistenceStatus='failed';state.lastPersistedAt=priorLastPersistedAt;state.persistenceError={occurredAt:attemptedAt,errorName:error?.name||'Error',message:String(error?.message||error)};emit('ride_memory_state_write_failed',state.persistenceError);publish();return false;}
  }

  function journalInput({eventId,eventType,title,summary,timestamp:occurredAt=iso(now()),metadata={},references={},attachments={}}){
    return {
      eventId,projectId:context.projectId,sessionId:context.sessionId,eventType,source:'ride_memory',title,summary,timestamp:occurredAt,
      metadata:{captureType:RIDE_MEMORY_CAPTURE_TYPE,dayNumber:context.dayNumber,sessionId:context.sessionId,sessionRunNumber:context.sessionRunNumber??null,sessionCalendarDate:context.sessionCalendarDate??null,sessionStartTimestamp:context.sessionStartedAt||context.sessionStartTimestamp||null,...metadata},
      references:{sessionId:context.sessionId,...references},attachments
    };
  }

  async function appendOrQueue(input){
    try{await journal.appendEventIdempotent(input);return true;}
    catch(error){
      state.journalBacklog||=[];
      if(!state.journalBacklog.some(item=>item.eventId===input.eventId))state.journalBacklog.push(clone(input));
      emit('ride_memory_journal_write_deferred',{eventId:input.eventId,eventType:input.eventType,errorName:error?.name||'Error',message:error?.message||String(error)});
      await saveState();return false;
    }
  }

  async function flushJournalBacklog(){
    if(!state?.journalBacklog?.length)return;
    const retained=[];
    for(const input of state.journalBacklog){
      try{await journal.appendEventIdempotent(input);}
      catch(error){retained.push(input);emit('ride_memory_journal_retry_failed',{eventId:input.eventId,errorName:error?.name||'Error'});}
    }
    state.journalBacklog=retained;await saveState();
  }

  function clearTimer(){if(timer!==null){timerApi.clearTimeout(timer);timer=null;}}
  function dueAt(){return timestamp(state?.pending?.retryAt)||timestamp(state?.nextScheduledAt);}
  function schedule(){
    clearTimer();
    if(!running||destroyed||!state||!visible())return;
    const due=dueAt();if(due===null)return;
    const delay=Math.min(MAX_TIMER_DELAY,Math.max(0,due-now()));
    timer=timerApi.setTimeout(()=>{timer=null;void tick();},delay);publish();
  }

  function ensurePending(){
    if(state.pending){state.pending.rearMediaId||=state.pending.mediaId;state.pending.frontMediaId||=createId();state.pending.rearMediaGroupId||=state.pending.mediaGroupId||createId();state.pending.frontMediaGroupId||=createId();return state.pending;}
    const scheduledAt=state.nextScheduledAt,slotKey=String(scheduledAt).replace(/[^0-9]/g,'');
    state.pending={
      slotId:`${context.sessionId}:${slotKey}`,scheduledAt,retryAt:null,status:'due',
      mediaId:createId(),rearMediaId:null,frontMediaId:createId(),rearMediaGroupId:createId(),frontMediaGroupId:createId(),journalEventId:createId(),failureEventId:createId(),missedEventId:createId(),deferredEventId:createId(),coverageEventId:createId()
    };
    state.pending.rearMediaId=state.pending.mediaId;
    return state.pending;
  }

  async function recordMissed(reason){
    const pending=ensurePending();if(pending.missedAt)return;
    pending.missedAt=iso(now());pending.missedReason=reason;pending.status='missed';state.status='missed';
    await saveState();
    await appendOrQueue(journalInput({
      eventId:pending.missedEventId,eventType:'ride_memory_missed',title:'Ride Memory Delayed',summary:'The scheduled Ride Memory photo was not fabricated while CannonMap was suspended or backgrounded.',
      metadata:{scheduledCaptureAt:pending.scheduledAt,observedAt:pending.missedAt,status:'missed',reason}
    }));
    emit('ride_memory_missed',{scheduledCaptureAt:pending.scheduledAt,reason});
  }

  async function deferPending(reason){
    const pending=ensurePending(),first=!pending.deferredAt;
    pending.deferredAt=pending.deferredAt||iso(now());pending.deferReason=reason;pending.retryAt=iso(now()+retryAfter);pending.status='deferred';state.status='deferred';
    await saveState();
    if(first)await appendOrQueue(journalInput({
      eventId:pending.deferredEventId,eventType:'ride_memory_deferred',title:'Ride Memory Deferred',summary:'Checkpoint camera work has priority; Ride Memory will retry later.',
      metadata:{scheduledCaptureAt:pending.scheduledAt,deferredAt:pending.deferredAt,status:'deferred',reason}
    }));
    emit('ride_memory_deferred',{scheduledCaptureAt:pending.scheduledAt,reason});schedule();
  }

  async function advance(outcome,details={}){
    const pending=state.pending,scheduled=timestamp(pending?.scheduledAt??state.nextScheduledAt)??now();
    state.lastOutcome={outcome,scheduledAt:pending?.scheduledAt||state.nextScheduledAt,recordedAt:iso(now()),...details};
    state.lastActualCaptureAt=details.actualCaptureAt||state.lastActualCaptureAt||null;
    state.pending=null;state.nextScheduledAt=iso(nextFutureSlot(scheduled,every,now()));state.status='scheduled';state.visibilityState=visible()?'visible':'hidden';
    await saveState();publish();schedule();
  }

  function coverageCandidate(scheduledAt){
    const activity=checkpointActivity?.()||{};
    if(activity.lastCaptureAt)cameraArbiter.noteCheckpointCapture?.(activity);
    return cameraArbiter.checkpointCoverage?.(scheduledAt,coverage)||null;
  }

  async function recordCoverage(reference){
    const pending=ensurePending(),coveredAt=reference.capturedAt||iso(reference.capturedAtMs);
    await appendOrQueue(journalInput({
      eventId:pending.coverageEventId,eventType:'ride_memory_covered',title:'Ride Memory Covered by Checkpoint',summary:'A nearby checkpoint photo provided memory coverage by reference; no duplicate photo was created.',
      metadata:{scheduledCaptureAt:pending.scheduledAt,coverageWindowMs:coverage,coverageType:'checkpoint_reference',checkpointCapturedAt:coveredAt,status:'covered'},
      references:{checkpointId:reference.checkpointId||null,mediaIds:[...(reference.mediaIds||[])]}
    }));
    emit('ride_memory_covered',{scheduledCaptureAt:pending.scheduledAt,checkpointId:reference.checkpointId||null});
    await advance('covered',{checkpointId:reference.checkpointId||null,checkpointCapturedAt:coveredAt});
  }

  function captureMetadata(pending,capturedAt,source,cameraRole){
    const gps=gpsMetadata(positionProvider?.(),now()),provenance=source?.provenance||{};
    return {
      captureType:RIDE_MEMORY_CAPTURE_TYPE,evidenceRequired:false,objectiveType:RIDE_MEMORY_CAPTURE_TYPE,eventName:'Ride Memory',points:0,
      projectId:context.projectId,rallyName:context.rallyName||context.projectName||'CannonMap',dayNumber:context.dayNumber,
      sessionId:context.sessionId,sessionRunNumber:context.sessionRunNumber??null,sessionCalendarDate:context.sessionCalendarDate??null,
      sessionStartedAt:context.sessionStartedAt||context.sessionStartTimestamp||null,
      scheduledCaptureAt:pending.scheduledAt,actualCaptureAt:capturedAt,capturedAt,captureTimestamp:capturedAt,
      cameraRole,requestedCamera:provenance.requestedCamera||cameraRole,actualCamera:provenance.actualCamera||'unknown',
      cameraSelectionHonored:provenance.cameraSelectionHonored??'unknown',captureMethod:provenance.captureMethod||'getUserMedia-imagecapture',
      originalSourceProvenance:clone(provenance),...gps
    };
  }

  function memoryFilename(capturedAt,cameraRole){return `Day${String(context.dayNumber).padStart(2,'0')}_RideMemory_${safeStamp(capturedAt)}_${cameraRole==='front'?'Front':'Rear'}_Original.jpg`;}

  function validateExisting(existing){
    if(existing&&(String(existing.projectId)!==String(context.projectId)||String(existing.sessionId||existing.metadata?.sessionId||'')!==String(context.sessionId)||existing.metadata?.captureType!==RIDE_MEMORY_CAPTURE_TYPE))throw new Error('The persisted Ride Memory identity belongs to another session.');
    return existing;
  }

  async function recoverExisting(pending,rear,front){
    validateExisting(rear);validateExisting(front);const rows=[rear,front].filter(Boolean),capturedAt=rows.map(row=>row.metadata?.actualCaptureAt||row.capturedAt).sort().at(-1)||iso(now());
    await appendOrQueue(journalInput({
      eventId:pending.journalEventId,eventType:'ride_memory_captured',title:'Ride Memory Captured',summary:'Sequential Samsung rear and front Ride Memory Originals were stored independently from checkpoint evidence.',timestamp:capturedAt,
      metadata:{scheduledCaptureAt:pending.scheduledAt,actualCaptureAt:capturedAt,status:'complete',cameraRoles:['rear','front']},references:{rideMemoryId:pending.slotId,rearMediaId:rear.mediaId,frontMediaId:front.mediaId,mediaIds:[rear.mediaId,front.mediaId]},
      attachments:{photos:rows.map(record=>({mediaId:record.mediaId,uri:`media://${record.mediaId}`,kind:'photo',role:'original',cameraRole:record.metadata?.cameraRole,captureType:RIDE_MEMORY_CAPTURE_TYPE,mimeType:record.mimeType,name:record.name,size:record.size,capturedAt:record.capturedAt}))}
    }));
    emit('ride_memory_reconciled',{mediaIds:rows.map(row=>row.mediaId),scheduledCaptureAt:pending.scheduledAt});
    await advance('captured',{actualCaptureAt:capturedAt,mediaIds:rows.map(row=>row.mediaId),reconciled:true});
  }

  async function recordPartial(pending,rear,error,stage){
    const failedAt=iso(now()),reason=error?.code||error?.name||stage;
    await appendOrQueue(journalInput({eventId:pending.journalEventId,eventType:'ride_memory_partially_captured',title:'Ride Memory Partially Captured',summary:'Rear Ride Memory Original was retained; front capture failed without affecting Rally operation.',timestamp:failedAt,metadata:{scheduledCaptureAt:pending.scheduledAt,actualCaptureAt:rear.capturedAt,status:'partial',completedRoles:['rear'],missingRoles:['front'],stage,reason,message:String(error?.message||error).slice(0,240)},references:{rideMemoryId:pending.slotId,rearMediaId:rear.mediaId,mediaIds:[rear.mediaId]},attachments:{photos:[{mediaId:rear.mediaId,uri:`media://${rear.mediaId}`,kind:'photo',role:'original',cameraRole:'rear',captureType:RIDE_MEMORY_CAPTURE_TYPE,mimeType:rear.mimeType,name:rear.name,size:rear.size,capturedAt:rear.capturedAt}]}}));
    emit('ride_memory_partially_captured',{scheduledCaptureAt:pending.scheduledAt,rearMediaId:rear.mediaId,reason});await advance('partial',{actualCaptureAt:rear.capturedAt,mediaIds:[rear.mediaId],missingRoles:['front'],reason});
  }

  async function recordFailure(pending,error,stage){
    const failedAt=iso(now()),reason=error?.code||error?.name||stage;
    await appendOrQueue(journalInput({
      eventId:pending.failureEventId,eventType:'ride_memory_capture_failed',title:'Ride Memory Capture Failed',summary:'Ride Memory capture failed without changing checkpoint evidence, scoring, GPS, or navigation.',
      metadata:{scheduledCaptureAt:pending.scheduledAt,failedAt,status:'failed',stage,reason,errorName:error?.name||'Error',errorCode:error?.code||null,message:String(error?.message||error).slice(0,240)}
    }));
    emit('ride_memory_capture_failed',{scheduledCaptureAt:pending.scheduledAt,stage,reason});
    await advance('failed',{failedAt,stage,reason});
  }

  async function capturePending(pending,token){
    if(!ownsGeneration(token))return;
    pending.rearMediaId||=pending.mediaId;pending.frontMediaId||=createId();pending.rearMediaGroupId||=pending.mediaGroupId||createId();pending.frontMediaGroupId||=createId();let rear=validateExisting(await mediaRepository.getMedia(pending.rearMediaId));if(!ownsGeneration(token))return;let front=validateExisting(await mediaRepository.getMedia(pending.frontMediaId));if(!ownsGeneration(token))return;if(rear&&front){await recoverExisting(pending,rear,front);return;}
    const activity=checkpointActivity?.()||{};
    if(!ownsGeneration(token))return;
    if(activity.active){await deferPending('checkpoint-active');return;}
    const covered=!rear&&!front?coverageCandidate(pending.scheduledAt):null;if(covered){await recordCoverage(covered);return;}
    if(!ownsGeneration(token))return;
    const captureRole=async role=>{
      const result=await cameraArbiter.tryRunMemory(({signal})=>captureStill(role,{signal,captureType:RIDE_MEMORY_CAPTURE_TYPE,scheduledCaptureAt:pending.scheduledAt}));if(!result.started)return {deferred:result.reason||'camera-busy'};
      const capture=result.value,file=capture instanceof Blob?capture:capture?.blob,provenance=capture instanceof Blob?{}:capture?.provenance;if(!(file instanceof Blob))throw Object.assign(new Error(`Ride Memory ${role} camera returned no JPEG bytes.`),{code:'RIDE_MEMORY_EMPTY_CAPTURE'});
      const capturedAt=iso(now()),metadata=captureMetadata(pending,capturedAt,{provenance},role),mediaId=role==='rear'?pending.rearMediaId:pending.frontMediaId;
      return {stored:await mediaRepository.addOriginal({
        projectId:context.projectId,checkpointId:`ride-memory:${context.sessionId}:${String(pending.scheduledAt).replace(/[^0-9]/g,'')}`,
        journalEventId:pending.journalEventId,originalFile:file,metadata,filenames:{original:memoryFilename(capturedAt,role)},identities:{mediaGroupId:role==='rear'?pending.rearMediaGroupId:pending.frontMediaGroupId,originalMediaId:mediaId},sourceProvenance:provenance
      })};
    };
    if(!rear){try{const result=await captureRole('rear');if(result.deferred){await deferPending(result.deferred);return;}rear=result.stored;}catch(error){if(abortLike(error)){if(!visible()){pending.retryAt=null;await recordMissed('background-interrupted');return;}await deferPending('checkpoint-preempted');return;}try{rear=validateExisting(await mediaRepository.getMedia(pending.rearMediaId));}catch{}if(!rear){await recordFailure(pending,error,'rear-capture-or-persistence');return;}}}
    if(!ownsGeneration(token))return;
    if(!front){try{const result=await captureRole('front');if(result.deferred){await deferPending(result.deferred);return;}front=result.stored;}catch(error){if(abortLike(error)){await deferPending(visible()?'checkpoint-preempted':'background-interrupted');return;}try{front=validateExisting(await mediaRepository.getMedia(pending.frontMediaId));}catch{}if(!front){await recordPartial(pending,rear,error,'front-capture-or-persistence');return;}}}
    if(!ownsGeneration(token))return;await recoverExisting(pending,rear,front);
  }

  async function performTick(token){
    if(!ownsGeneration(token)||!state)return;
    await flushJournalBacklog();
    if(!ownsGeneration(token))return;
    const latest=await sessionProvider();
    if(!ownsGeneration(token))return;
    if(!activeSession(latest)||String(latest.sessionId)!==String(context.sessionId)){
      emit('ride_memory_session_inactive',{observedSessionId:latest?.sessionId||null});stop('session-inactive');return;
    }
    const due=dueAt();if(due===null||due>now()){schedule();return;}
    const pending=ensurePending();
    if(!visible()){
      state.visibilityState='hidden';await recordMissed('background-hidden');await saveState();publish();return;
    }
    if(state.resumeFromBackground||now()-(timestamp(pending.scheduledAt)||now())>missedGrace){
      const reason=state.resumeFromBackground?'foreground-resumed':'scheduler-delayed';state.resumeFromBackground=false;await recordMissed(reason);
    }
    if(!ownsGeneration(token))return;
    await saveState();if(!ownsGeneration(token))return;publish();if(!ownsGeneration(token))return;await capturePending(pending,token);
  }

  function tick(){
    if(tickPromise)return tickPromise;
    const token=generation;
    tickPromise=performTick(token).catch(async error=>{
      emit('ride_memory_scheduler_failed',{errorName:error?.name||'Error',message:error?.message||String(error)});
      if(ownsGeneration(token)&&state?.pending){state.pending.retryAt=iso(now()+retryAfter);state.pending.status='retry_scheduled';state.status='retry_scheduled';await saveState();}
    }).finally(()=>{tickPromise=null;if(running&&token===generation)schedule();publish();});
    return tickPromise;
  }

  async function visibilityChanged(){
    if(!running||!state)return;
    if(!visible()){
      clearTimer();state.visibilityState='hidden';state.backgroundedAt=iso(now());cameraArbiter.cancelMemory?.('document-hidden');await saveState();publish();return;
    }
    const wasHidden=state.visibilityState==='hidden';state.visibilityState='visible';state.foregroundedAt=iso(now());
    if(wasHidden&&dueAt()!==null&&dueAt()<=now())state.resumeFromBackground=true;
    await saveState();if(dueAt()!==null&&dueAt()<=now())void tick();else schedule();publish();
  }
  const visibilityListener=()=>{void visibilityChanged();};
  const subscribeVisibility=()=>{if(!visibilitySubscribed&&documentRef?.addEventListener){documentRef.addEventListener('visibilitychange',visibilityListener);visibilitySubscribed=true;}};
  const unsubscribeVisibility=()=>{if(visibilitySubscribed){documentRef?.removeEventListener?.('visibilitychange',visibilityListener);visibilitySubscribed=false;}};

  async function startInternal(requestGeneration){
    const nextContext=await sessionProvider();
    if(destroyed||requestGeneration!==generation)return snapshot();
    if(!activeSession(nextContext)){stop('session-unavailable');return snapshot();}
    if(running&&context?.sessionId===String(nextContext.sessionId)){schedule();return snapshot();}
    stop('session-changed');running=true;generation+=1;const token=generation;context={...clone(nextContext),projectId:String(nextContext.projectId),sessionId:String(nextContext.sessionId),dayNumber:Number(nextContext.dayNumber)};const sessionId=context.sessionId;
    let loadedState=null,readError=null;try{loadedState=await stateStore.load(sessionId);}catch(error){readError=error;}
    if(!running||destroyed||token!==generation||context?.sessionId!==sessionId)return snapshot();
    state=loadedState;if(readError)emit('ride_memory_state_read_failed',{errorName:readError?.name||'Error',message:readError?.message||String(readError)});
    const valid=state&&state.schemaVersion===SCHEMA_VERSION&&String(state.sessionId)===context.sessionId&&String(state.projectId)===context.projectId;
    if(!valid)state={schemaVersion:SCHEMA_VERSION,sessionId:context.sessionId,projectId:context.projectId,dayNumber:context.dayNumber,intervalMs:every,nextScheduledAt:iso(now()+every),pending:null,status:'scheduled',journalBacklog:[],visibilityState:visible()?'visible':'hidden',createdAt:iso(now()),updatedAt:iso(now())};
    else{
      every=positive(state.intervalMs,every);state.intervalMs=every;state.projectId=context.projectId;state.dayNumber=context.dayNumber;
      if(!state.nextScheduledAt)state.nextScheduledAt=iso(now()+every);
      if(state.visibilityState==='hidden'&&visible()&&dueAt()!==null&&dueAt()<=now())state.resumeFromBackground=true;
      state.visibilityState=visible()?'visible':'hidden';
    }
    subscribeVisibility();await saveState();if(!running||destroyed||token!==generation||context?.sessionId!==sessionId)return snapshot();
    await flushJournalBacklog();if(!running||destroyed||token!==generation||context?.sessionId!==sessionId)return snapshot();
    publish();schedule();return snapshot();
  }

  function start(){
    if(destroyed)return Promise.reject(new Error('Ride Memory capture service is destroyed.'));
    const prior=startPromise,requestGeneration=generation;let tracked;
    tracked=(async()=>{if(prior)await prior.catch(()=>{});if(destroyed||requestGeneration!==generation)return snapshot();return startInternal(requestGeneration);})().finally(()=>{if(startPromise===tracked)startPromise=null;});
    startPromise=tracked;return tracked;
  }

  function stop(reason='session-stopped'){
    const wasActive=running||timer!==null||visibilitySubscribed;clearTimer();cameraArbiter.cancelMemory?.(reason);running=false;generation+=1;unsubscribeVisibility();if(wasActive){emit('ride_memory_stopped',{reason});publish();}return snapshot();
  }

  return Object.freeze({
    start,stop,runDueNow:tick,whenIdle:async()=>{while(startPromise){const pending=startPromise;await pending.catch(()=>{});if(startPromise===pending)break;}if(tickPromise)await tickPromise;},state:snapshot,
    noteCheckpointCapture:input=>cameraArbiter.noteCheckpointCapture?.(input),
    async setInterval(nextIntervalMs){
      every=positive(nextIntervalMs,every);if(!state)return every;
      state.intervalMs=every;state.nextScheduledAt=iso(now()+every);state.pending=null;await saveState();schedule();publish();return every;
    },
    destroy(){if(destroyed)return;stop('service-destroyed');destroyed=true;state=null;context=null;publish();}
  });
}
