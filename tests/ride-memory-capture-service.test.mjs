import assert from 'node:assert/strict';
import test from 'node:test';
import {createCameraCaptureArbiter} from '../src/application/camera-capture-arbiter.js';
import {DEFAULT_RIDE_MEMORY_INTERVAL_MS,RIDE_MEMORY_CAPTURE_TYPE,createRideMemoryCaptureService} from '../src/application/ride-memory-capture-service.js';

const uuidFactory=()=>{let value=0;return()=>`00000000-0000-4000-8000-${String(++value).padStart(12,'0')}`;};
const clone=value=>value===undefined?value:structuredClone(value);

function harness({intervalMs=DEFAULT_RIDE_MEMORY_INTERVAL_MS,captureStill,mediaLookup=null,journalFailure=false,stateWriteFailure=false,postCommitFailureRole=null,checkpointActivity=()=>({})}={}){
  let current=Date.parse('2026-08-20T12:00:00.000Z'),journalShouldFail=journalFailure,stateWriteShouldFail=stateWriteFailure;
  const clock={now:()=>current},timers=new Map();let timerId=0;
  const timerApi={
    setTimeout(handler,delay){const id=++timerId;timers.set(id,{handler,delay,due:current+delay});return id;},
    clearTimeout(id){timers.delete(id);}
  };
  const listeners=new Set(),documentRef={visibilityState:'visible',addEventListener(type,handler){if(type==='visibilitychange')listeners.add(handler);},removeEventListener(type,handler){if(type==='visibilitychange')listeners.delete(handler);}};
  const durable=new Map(),stateStore={
    async load(sessionId){return clone(durable.get(sessionId)||null);},
    async save(value){if(stateWriteShouldFail)throw new Error('schedule storage unavailable');durable.set(value.sessionId,clone(value));return clone(value);}
  };
  const journalEvents=new Map(),journal={async appendEventIdempotent(event){if(journalShouldFail)throw new Error('journal unavailable');if(!journalEvents.has(event.eventId))journalEvents.set(event.eventId,clone(event));return journalEvents.get(event.eventId);}};
  const media=new Map(),mediaInputs=[];let postCommitFailurePending=postCommitFailureRole;
  const mediaRepository={
    async getMedia(mediaId){return mediaLookup?mediaLookup(mediaId):media.get(mediaId)||null;},
    async addOriginal(input){
      mediaInputs.push(input);if(media.has(input.identities.originalMediaId))throw new Error('duplicate media');
      const record={mediaId:input.identities.originalMediaId,mediaGroupId:input.identities.mediaGroupId,projectId:input.projectId,checkpointId:input.checkpointId,journalEventId:input.journalEventId,sessionId:input.metadata.sessionId,role:'original',kind:'photo',mimeType:input.originalFile.type,name:input.filenames.original,size:input.originalFile.size,capturedAt:input.metadata.capturedAt,metadata:clone(input.metadata),blob:input.originalFile,sourceProvenance:clone(input.sourceProvenance),evidenceStatus:input.metadata.evidenceRequired===false?'not_required':'pending'};
      media.set(record.mediaId,record);if(postCommitFailurePending===record.metadata.cameraRole){postCommitFailurePending=null;throw new Error(`${record.metadata.cameraRole} post-commit verification failed`);}return record;
    }
  };
  const context={active:true,projectId:'project-1',projectName:'America 250',rallyName:'America 250',sessionId:'session-1',sessionRunNumber:1,sessionCalendarDate:'2026-08-20',sessionStartedAt:'2026-08-20T12:00:00.000Z',dayNumber:1};
  const arbiter=createCameraCaptureArbiter({clock}),captures=[],createId=uuidFactory();
  const diagnostics=[],published=[],options={
    captureStill:captureStill|| (async(camera,options)=>{captures.push({camera,options});return {blob:new Blob([`samsung-${camera}-native-still`],{type:'image/jpeg'}),provenance:{sourceKind:'image-capture-photo',nativeStill:true,requestedCamera:camera,actualCamera:camera,cameraSelectionHonored:true,captureMethod:'getUserMedia-imagecapture',width:camera==='rear'?3072:2448,height:camera==='rear'?4080:3440}};}),
    mediaRepository,journal,createId,stateStore,cameraArbiter:arbiter,sessionProvider:()=>context,
    positionProvider:()=>({lat:38.12345,lon:-105.54321,speedMps:10,heading:87,accuracyFeet:12,time:new Date(current-250).toISOString()}),
    checkpointActivity,documentRef,clock,timerApi,intervalMs,retryDelayMs:60_000,missedGraceMs:60_000,onDiagnostic:event=>diagnostics.push(event),onState:snapshot=>published.push(snapshot)
  },createService=()=>createRideMemoryCaptureService(options),service=createService();
  return {
    service,createService,arbiter,context,clock,timers,listeners,durable,journalEvents,media,mediaInputs,captures,diagnostics,published,
    now:()=>current,setNow:value=>{current=typeof value==='number'?value:Date.parse(value);},advance:ms=>{current+=ms;},
    setJournalFailure:value=>{journalShouldFail=value;},
    setStateWriteFailure:value=>{stateWriteShouldFail=value;},
    async visibility(value){documentRef.visibilityState=value;for(const listener of [...listeners])listener();await Promise.resolve();await service.whenIdle();}
  };
}

test('default hourly scheduler stores sequential rear and front Originals with complete Ride Memory and GPS metadata',async()=>{
  const h=harness(),checkpointState={status:'active',score:40};
  await h.service.start();
  assert.equal(Date.parse(h.service.state().schedule.nextScheduledAt)-h.clock.now(),DEFAULT_RIDE_MEMORY_INTERVAL_MS);
  h.advance(DEFAULT_RIDE_MEMORY_INTERVAL_MS);await h.service.runDueNow();
  assert.deepEqual(h.captures.map(item=>item.camera),['rear','front']);assert.equal(h.media.size,2);assert.equal(h.mediaInputs.length,2);
  const records=[...h.media.values()],record=records[0],metadata=record.metadata;
  assert.equal(new Set(records.map(item=>item.mediaGroupId)).size,2,'rear and front Originals remain independently visible in the gallery');
  assert.equal(record.role,'original');assert.equal(record.evidenceStatus,'not_required');assert.equal(metadata.captureType,RIDE_MEMORY_CAPTURE_TYPE);assert.equal(metadata.evidenceRequired,false);
  assert.equal(metadata.sessionId,'session-1');assert.equal(metadata.dayNumber,1);assert.equal(metadata.scheduledCaptureAt,'2026-08-20T13:00:00.000Z');assert.equal(metadata.actualCaptureAt,'2026-08-20T13:00:00.000Z');
  assert.equal(metadata.latitude,38.12345);assert.equal(metadata.longitude,-105.54321);assert.ok(Math.abs(metadata.speedMph-22.3694)<.0001);assert.equal(metadata.deviceHeading,87);assert.equal(metadata.gpsSampleAgeMs,250);
  const event=[...h.journalEvents.values()].find(item=>item.eventType==='ride_memory_captured');
  assert.equal(event.sessionId,'session-1');assert.deepEqual(event.references.mediaIds,records.map(item=>item.mediaId));assert.deepEqual(event.attachments.photos.map(item=>item.cameraRole),['rear','front']);assert.ok(records.every(item=>item.evidenceStatus==='not_required'));
  assert.deepEqual(checkpointState,{status:'active',score:40},'Ride Memory must not mutate checkpoint or score state');
  assert.equal(Date.parse(h.service.state().schedule.nextScheduledAt),Date.parse('2026-08-20T14:00:00.000Z'));
});

test('nearby checkpoint media covers a slot by reference without duplicate capture',async()=>{
  const h=harness();await h.service.start();
  h.arbiter.noteCheckpointCapture({capturedAt:'2026-08-20T12:57:00.000Z',checkpointId:'cp-1',mediaIds:['cp-rear','cp-front']});
  h.advance(DEFAULT_RIDE_MEMORY_INTERVAL_MS);await h.service.runDueNow();
  assert.equal(h.captures.length,0);assert.equal(h.media.size,0);
  const event=[...h.journalEvents.values()].find(item=>item.eventType==='ride_memory_covered');
  assert.equal(event.references.checkpointId,'cp-1');assert.deepEqual(event.references.mediaIds,['cp-rear','cp-front']);assert.equal(event.metadata.coverageType,'checkpoint_reference');
});

test('active checkpoint defers Ride Memory and captures after checkpoint releases',async()=>{
  let checkpointActive=true;
  const h=harness({intervalMs:60_000,checkpointActivity:()=>({active:checkpointActive})});await h.service.start();h.advance(60_000);await h.service.runDueNow();
  assert.equal(h.captures.length,0);assert.equal(h.service.state().schedule.pending.status,'deferred');assert.equal([...h.journalEvents.values()].filter(event=>event.eventType==='ride_memory_deferred').length,1);
  checkpointActive=false;h.advance(60_000);await h.service.runDueNow();assert.deepEqual(h.captures.map(item=>item.camera),['rear','front']);assert.equal(h.media.size,2);
});

test('checkpoint request preempts an in-flight memory camera without persisting fabricated media',async()=>{
  let captureStarted;
  const started=new Promise(resolve=>{captureStarted=resolve;});
  const h=harness({intervalMs:60_000,captureStill:async(camera,{signal})=>new Promise((resolve,reject)=>{captureStarted();signal.addEventListener('abort',()=>reject(signal.reason||Object.assign(new Error('aborted'),{name:'AbortError'})),{once:true});})});
  await h.service.start();h.advance(60_000);const due=h.service.runDueNow();await started;
  let checkpointRan=false;await h.arbiter.runCheckpoint(async()=>{checkpointRan=true;});await due;
  assert.equal(checkpointRan,true);assert.equal(h.media.size,0);assert.equal(h.service.state().schedule.pending.status,'deferred');
  assert.ok([...h.journalEvents.values()].some(event=>event.eventType==='ride_memory_deferred'&&event.metadata.reason==='checkpoint-preempted'));
});

test('scope stop during deferred media lookup cannot start a late rear camera capture',async()=>{
  let releaseLookup,markLookupStarted,cameraStarts=0;const lookupStarted=new Promise(resolve=>{markLookupStarted=resolve;});
  const h=harness({intervalMs:60_000,mediaLookup:async()=>{markLookupStarted();return new Promise(resolve=>{releaseLookup=resolve;});},captureStill:async()=>{cameraStarts+=1;return new Blob(['must-not-capture'],{type:'image/jpeg'});}});
  await h.service.start();h.advance(60_000);const due=h.service.runDueNow();await lookupStarted;h.service.stop('scope-switch');releaseLookup(null);await due;
  assert.equal(cameraStarts,0);assert.equal(h.media.size,0);assert.equal(h.mediaInputs.length,0);assert.equal(h.arbiter.state().currentKind,null);assert.equal(h.service.state().running,false);assert.equal(h.timers.size,0);assert.equal(h.listeners.size,0);
});

test('background due time is recorded as missed and recovered only after foreground resumes',async()=>{
  const h=harness({intervalMs:60_000});await h.service.start();await h.visibility('hidden');h.advance(2*60_000);await h.service.runDueNow();
  assert.equal(h.captures.length,0);assert.equal(h.service.state().schedule.pending.status,'missed');
  const missed=[...h.journalEvents.values()].find(event=>event.eventType==='ride_memory_missed');assert.equal(missed.metadata.reason,'background-hidden');
  await h.visibility('visible');await h.service.whenIdle();
  assert.equal(h.captures.length,2);const record=[...h.media.values()][0];assert.equal(record.metadata.scheduledCaptureAt,'2026-08-20T12:01:00.000Z');assert.equal(record.metadata.actualCaptureAt,'2026-08-20T12:02:00.000Z');
});

test('memory camera failure is nonblocking and advances to a later slot',async()=>{
  let attempts=0;
  const h=harness({intervalMs:60_000,captureStill:async()=>{attempts+=1;if(attempts===1)throw Object.assign(new Error('camera busy'),{code:'CAMERA_BUSY'});return {blob:new Blob(['later'],{type:'image/jpeg'}),provenance:{requestedCamera:'rear',actualCamera:'rear'}};}});
  await h.service.start();h.advance(60_000);await assert.doesNotReject(()=>h.service.runDueNow());assert.equal(h.media.size,0);
  const failure=[...h.journalEvents.values()].find(event=>event.eventType==='ride_memory_capture_failed');assert.equal(failure.metadata.reason,'CAMERA_BUSY');assert.equal(h.service.state().schedule.pending,null);
  h.advance(60_000);await h.service.runDueNow();assert.equal(h.media.size,2);assert.equal(attempts,3);
});

test('front Ride Memory failure preserves rear Original and the next slot still captures both roles',async()=>{let frontAttempts=0;const h=harness({intervalMs:60_000,captureStill:async camera=>{h.captures.push({camera});if(camera==='front'&&++frontAttempts===1)throw Object.assign(new Error('front unavailable'),{code:'FRONT_UNAVAILABLE'});return {blob:new Blob([camera],{type:'image/jpeg'}),provenance:{requestedCamera:camera,actualCamera:camera}};}});await h.service.start();h.advance(60_000);await h.service.runDueNow();assert.equal(h.media.size,1);const rear=[...h.media.values()][0];assert.equal(rear.metadata.cameraRole,'rear');const partial=[...h.journalEvents.values()].find(event=>event.eventType==='ride_memory_partially_captured');assert.equal(rear.journalEventId,partial.eventId,'retained media must reference its truthful partial terminal event');assert.deepEqual(partial.metadata.completedRoles,['rear']);assert.deepEqual(partial.metadata.missingRoles,['front']);h.advance(60_000);await h.service.runDueNow();assert.equal(h.media.size,3);assert.deepEqual([...h.media.values()].slice(-2).map(row=>row.metadata.cameraRole),['rear','front']);});

test('checkpoint coverage cannot discard a rear Original after front preemption',async()=>{let releaseFront,frontStarted,frontAttempt=0;const began=new Promise(resolve=>{frontStarted=resolve;}),h=harness({intervalMs:60_000,captureStill:async(camera,{signal})=>{h.captures.push({camera});if(camera==='front'&&frontAttempt++===0)return new Promise((resolve,reject)=>{releaseFront=resolve;frontStarted();signal.addEventListener('abort',()=>reject(signal.reason||Object.assign(new Error('aborted'),{name:'AbortError'})),{once:true});});return {blob:new Blob([camera],{type:'image/jpeg'}),provenance:{requestedCamera:camera,actualCamera:camera}};}});await h.service.start();h.advance(60_000);const due=h.service.runDueNow();await began;await h.arbiter.runCheckpoint(async()=>{});await due;assert.equal(h.media.size,1);h.arbiter.noteCheckpointCapture({capturedAt:new Date(h.clock.now()).toISOString(),checkpointId:'cp-nearby',mediaIds:['cp-rear','cp-front']});h.advance(60_000);await h.service.runDueNow();assert.equal(h.media.size,2);assert.ok([...h.journalEvents.values()].some(event=>event.eventType==='ride_memory_captured'));assert.ok(![...h.journalEvents.values()].some(event=>event.eventType==='ride_memory_covered'));void releaseFront;});

test('post-commit media errors reconcile deterministic rear and front Originals instead of projecting failure',async()=>{const h=harness({intervalMs:60_000,postCommitFailureRole:'front'});await h.service.start();h.advance(60_000);await h.service.runDueNow();assert.equal(h.media.size,2);assert.ok([...h.journalEvents.values()].some(event=>event.eventType==='ride_memory_captured'));assert.ok(![...h.journalEvents.values()].some(event=>['ride_memory_partially_captured','ride_memory_capture_failed'].includes(event.eventType)));});

test('restart and interval changes retain one timer, one listener, and no duplicate media',async()=>{
  const h=harness();await h.service.start();await h.service.start();assert.equal(h.timers.size,1);assert.equal(h.listeners.size,1);
  await h.service.setInterval(5*60_000);h.advance(5*60_000);await h.service.runDueNow();assert.equal(h.media.size,2);
  assert.equal(Date.parse(h.service.state().schedule.nextScheduledAt),Date.parse('2026-08-20T12:10:00.000Z'),'subsequent slots keep the configured interval');
  h.service.stop('test-restart');assert.equal(h.timers.size,0);assert.equal(h.listeners.size,0);
  const reloaded=h.createService();await reloaded.start();assert.equal(reloaded.state().schedule.intervalMs,5*60_000,'a reload reuses the durable configured interval');assert.equal(h.timers.size,1);assert.equal(h.listeners.size,1);assert.equal(h.media.size,2);
  reloaded.destroy();assert.equal(h.timers.size,0);assert.equal(h.listeners.size,0);
});

test('twelve-hour synthetic foreground ride keeps timers/listeners bounded',async()=>{
  const h=harness();await h.service.start();
  for(let hour=0;hour<12;hour+=1){h.advance(DEFAULT_RIDE_MEMORY_INTERVAL_MS);await h.service.runDueNow();assert.equal(h.timers.size,1);assert.equal(h.listeners.size,1);}
  assert.equal(h.media.size,24);assert.equal(h.captures.length,24);assert.equal([...h.journalEvents.values()].filter(event=>event.eventType==='ride_memory_captured').length,12);
  h.service.destroy();assert.equal(h.timers.size,0);assert.equal(h.listeners.size,0);
});

test('failed Journal writes queue durably and replay idempotently without recapturing media',async()=>{
  const h=harness({intervalMs:60_000,journalFailure:true});await h.service.start();h.advance(60_000);await h.service.runDueNow();
  assert.equal(h.media.size,2);assert.equal(h.captures.length,2);assert.equal(h.service.state().schedule.journalBacklog.length,1);
  h.setJournalFailure(false);h.service.stop('reload');await h.service.start();
  assert.equal(h.captures.length,2);assert.equal(h.media.size,2);assert.equal(h.service.state().schedule.journalBacklog.length,0);assert.equal([...h.journalEvents.values()].filter(event=>event.eventType==='ride_memory_captured').length,1);
});

test('schedule persistence failure is nonblocking, visible, and clears after a successful write',async()=>{
  const h=harness({stateWriteFailure:true});await assert.doesNotReject(()=>h.service.start());
  let snapshot=h.service.state();assert.equal(snapshot.running,true);assert.equal(snapshot.schedule.persistenceStatus,'failed');assert.equal(snapshot.schedule.persistenceError.message,'schedule storage unavailable');assert.equal(snapshot.schedule.lastPersistedAt,null);assert.equal(h.timers.size,1);assert.equal(h.listeners.size,1);
  assert.ok(h.diagnostics.some(event=>event.eventType==='ride_memory_state_write_failed'));assert.ok(h.published.some(item=>item.schedule?.persistenceStatus==='failed'));
  h.setStateWriteFailure(false);await h.service.setInterval(5*60_000);snapshot=h.service.state();assert.equal(snapshot.schedule.persistenceStatus,'ready');assert.equal(snapshot.schedule.persistenceError,null);assert.equal(snapshot.schedule.lastPersistedAt,'2026-08-20T12:00:00.000Z');assert.equal(h.durable.get('session-1').persistenceStatus,'ready');assert.equal(h.timers.size,1);
  h.service.destroy();
});

test('scope stop drains an in-flight schedule restore without reviving the old session',async()=>{
  let releaseLoad,markLoadStarted,currentContext={active:true,projectId:'project-1',sessionId:'session-1',dayNumber:1},timerId=0;
  const loadStarted=new Promise(resolve=>{markLoadStarted=resolve;}),saved=[],timers=new Set(),listeners=new Set(),stateStore={
    async load(sessionId){if(sessionId==='session-1'){markLoadStarted();return new Promise(resolve=>{releaseLoad=resolve;});}return null;},
    async save(value){saved.push(clone(value));return value;}
  },service=createRideMemoryCaptureService({
    captureStill:async()=>new Blob(['memory'],{type:'image/jpeg'}),mediaRepository:{async getMedia(){return null;},async addOriginal(){throw new Error('not due');}},journal:{async appendEventIdempotent(event){return event;}},createId:uuidFactory(),stateStore,cameraArbiter:createCameraCaptureArbiter(),sessionProvider:()=>currentContext,
    documentRef:{visibilityState:'visible',addEventListener(type,handler){if(type==='visibilitychange')listeners.add(handler);},removeEventListener(type,handler){if(type==='visibilitychange')listeners.delete(handler);}},timerApi:{setTimeout(){const id=++timerId;timers.add(id);return id;},clearTimeout(id){timers.delete(id);}}
  });
  const starting=service.start();await loadStarted;service.stop('scope-switch');let drained=false;const drain=service.whenIdle().then(()=>{drained=true;});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(drained,false,'scope drain must wait for the outstanding storage read');assert.equal(service.state().running,false);assert.equal(listeners.size,0);assert.equal(timers.size,0);
  releaseLoad(null);await Promise.all([starting,drain]);assert.equal(saved.length,0,'the invalidated old session must not save after its storage read returns');assert.equal(listeners.size,0);assert.equal(timers.size,0);
  currentContext={active:true,projectId:'project-1',sessionId:'session-2',dayNumber:1};await service.start();assert.equal(service.state().running,true);assert.equal(service.state().context.sessionId,'session-2');assert.deepEqual(saved.map(item=>item.sessionId),['session-2']);assert.equal(listeners.size,1);assert.equal(timers.size,1);
  service.destroy();await service.whenIdle();assert.equal(listeners.size,0);assert.equal(timers.size,0);
});
