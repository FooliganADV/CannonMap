import assert from 'node:assert/strict';
import test from 'node:test';
import {AUTOMATIC_BACKUP_TRIGGER,createAutomaticBackupService} from '../src/application/automatic-backup-service.js';

const session={sessionId:'session-1',projectId:'project-1',dayNumber:1,runNumber:1,status:'active',checkpointStates:{}};
const event=(eventId='event-1')=>({eventId,projectId:'project-1',sessionId:'session-1',eventType:'session_started',metadata:{sessionId:'session-1',dayNumber:1}});
const context={projectId:'project-1',dayNumber:1,session,project:{projectId:'project-1'},journal:[event()],settings:{}};
const archive=(counts={journal:1,media:0})=>({verified:true,filename:'CannonMap_Rally_D01_Run01_2026-08-20_120000-000_Backup.cmapday.zip',blob:new Blob(['verified-backup']),manifest:{format:'cannonmap-day-backup',version:2,sessionId:'session-1',dayNumber:1,journalEventCount:counts.journal,mediaCount:counts.media,checkpointStates:[],dayState:{status:'active'}}});
const media=(id,index=0)=>{const bytes=new TextEncoder().encode(`photo-${index}`);return {mediaId:id,projectId:'project-1',sessionId:'session-1',role:'original',size:bytes.byteLength,binaryData:bytes.buffer,blob:new Blob([bytes]),name:`${id}.jpg`,metadata:{sessionId:'session-1',dayNumber:1}};};
const hasBinary=(value,seen=new WeakSet())=>{if(value instanceof Blob||value instanceof ArrayBuffer||ArrayBuffer.isView(value))return true;if(value==null||typeof value!=='object'||seen.has(value))return false;seen.add(value);return Object.values(value).some(item=>hasBinary(item,seen));};

function harness({saveFailure=null,external=null}={}){
  const rows=[],events=[],exportCalls=[],timers=[],mediaQueries={project:0,session:0};let current=archive(),mediaRows=[],now=Date.parse('2026-08-20T12:00:00.000Z');
  const repository={
    async findByFingerprint(sessionId,fingerprint){return rows.find(item=>item.sessionId===sessionId&&item.fingerprint===fingerprint)||null;},
    async latest(sessionId){return rows.filter(item=>item.sessionId===sessionId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]||null;},
    async save(row){if(saveFailure)throw saveFailure;rows.push(structuredClone(row));return row;},
    async get(snapshotId){return rows.find(item=>item.snapshotId===snapshotId)||null;},
    async delete(snapshotId){const index=rows.findIndex(item=>item.snapshotId===snapshotId);if(index>=0)rows.splice(index,1);},
    async updateExternal(snapshotId,value,lastExternal){const row=rows.find(item=>item.snapshotId===snapshotId);if(row){row.external=value;row.lastExternal=lastExternal||row.lastExternal;}},
    async prune(sessionId,retain,{keepSnapshotId}={}){const own=rows.filter(item=>item.sessionId===sessionId).sort((a,b)=>String(a.snapshotId)===String(keepSnapshotId)?-1:String(b.snapshotId)===String(keepSnapshotId)?1:b.createdAt.localeCompare(a.createdAt));for(const stale of own.slice(retain)){const index=rows.indexOf(stale);rows.splice(index,1);}},async pruneGlobal(){return 0;}
  };
  const mediaRepository={async listProjectPhotos(){mediaQueries.project++;return mediaRows;},async listProjectSessionPhotos(projectId,sessionId){mediaQueries.session++;return mediaRows.filter(item=>item.projectId===projectId&&item.sessionId===sessionId);},async listProjectSessionPhotoDescriptors(projectId,sessionId){mediaQueries.session++;return mediaRows.filter(item=>item.projectId===projectId&&item.sessionId===sessionId).map(({blob,binaryData,...item})=>structuredClone(item));},async getMedia(id){return mediaRows.find(item=>item.mediaId===id)||null;}};
  const service=createAutomaticBackupService({exporter:{async dayBackup(){exportCalls.push('export');return current;}},snapshotRepository:repository,mediaRepository,externalBackup:external,
    verify:async blob=>{assert.ok(blob.size);return {manifest:current.manifest};},journal:{async appendEventIdempotent(value){events.push(value);}},clock:{now:()=>now,iso:()=>new Date(now).toISOString()},createId:()=>`snapshot-${events.length+1}`,setIntervalFn(callback,delay){timers.push({callback,delay});return timers.length;},clearIntervalFn:()=>{}});
  return {service,rows,events,exportCalls,timers,mediaQueries,setArchive(value){current=value;},setMedia(value){mediaRows=value;},advance(ms){now+=ms;}};
}

test('session start and checkpoint completion roll one compact snapshot without persistent JPEG duplication',async()=>{
  const h=harness(),queued=h.service.enqueue(context,{trigger:AUTOMATIC_BACKUP_TRIGGER.SESSION_START});assert.equal(queued.accepted,true);assert.equal(h.rows.length,0);
  const first=await queued.task;assert.equal(first.status,'recovery-verified');assert.equal(h.rows.length,1);assert.equal(Object.hasOwn(h.rows[0],'blob'),false);assert.equal(h.rows[0].recovery.journal.length,1);assert.equal(h.exportCalls.length,0,'no full ZIP is built without an external destination');
  const mediaRows=[0,1,2,3].map(index=>media(`media-${index}`,index));h.setMedia(mediaRows);
  const nextSession={...session,checkpointStates:{'cp-1':{status:'collected',scoreAwarded:10}}},nextContext={...context,session:nextSession,journal:[event(),event('completed')]};
  const second=await h.service.run(nextContext,{trigger:AUTOMATIC_BACKUP_TRIGGER.CHECKPOINT_COMPLETED});
  assert.equal(second.status,'recovery-verified');assert.equal(h.rows.length,1,'only latest compact snapshot is retained per session');assert.equal(h.rows[0].manifest.mediaCount,4);assert.equal(Object.hasOwn(h.rows[0],'blob'),false);assert.equal(h.mediaQueries.project,0);assert.equal(h.mediaQueries.session,2,'compact capture queries only the active Project/session index');
  assert.equal(hasBinary(h.rows[0].recovery.mediaReferences),false,'compact recovery references must not duplicate Blob, ArrayBuffer, or typed-array JPEG bytes');
  assert.deepEqual(h.events.filter(item=>item.eventType==='automatic_recovery_snapshot_verified').map(item=>item.metadata.trigger),['session_start','checkpoint_completed']);
});

test('automatic external backup uses incremental generation API without building an aggregate ZIP',async()=>{
  const calls=[],external={inspect:async()=>({status:'ready'}),async writeVerifiedGeneration(input){calls.push(input);let active=0,maxActive=0;for(const reference of input.media){active++;maxActive=Math.max(maxActive,active);const blob=await input.openMedia(reference);assert.equal(blob.size,reference.size);active--;}return {status:'ready',filename:`${input.sessionDirectoryName}/${input.generationFilename}`,size:100,verified:true,finalizedBy:'incremental-files',manifest:{...input.manifest,mediaCount:input.media.length},maxActive};}},h=harness({external});h.setMedia(Array.from({length:96},(_,index)=>media(`media-${index}`,index)));
  const result=await h.service.run({...context,session:{...context.session,startedAt:'2026-08-20T12:00:00.000Z'},project:{...context.project,name:'America 250'},rallyName:'ADV Cannonball'},{trigger:AUTOMATIC_BACKUP_TRIGGER.SESSION_START});assert.equal(result.external.status,'ready');assert.equal(h.exportCalls.length,0);assert.equal(calls.length,1);assert.equal(calls[0].media.length,96);assert.equal(hasBinary(calls[0].media),false);assert.equal(calls[0].manifest.format,'cannonmap-incremental-session-backup');assert.match(calls[0].sessionDirectoryName,/^CannonMap_ADV-Cannonball_D01_Run01_20260820_120000Z_session-1$/);
});

test('unchanged rolling recovery is idempotent and does not duplicate Journal or media',async()=>{
  const h=harness();await h.service.run(context,{trigger:AUTOMATIC_BACKUP_TRIGGER.SESSION_START});const repeated=await h.service.run(context,{trigger:AUTOMATIC_BACKUP_TRIGGER.SCHEDULED});
  assert.equal(repeated.status,'unchanged');assert.equal(h.rows.length,1);assert.equal(h.events.filter(item=>item.eventType==='automatic_recovery_snapshot_verified').length,1);
});

test('legacy snapshots that embedded binaryData are replaced by compact references',async()=>{
  const h=harness();h.setMedia([media('media-1')]);await h.service.run(context,{trigger:AUTOMATIC_BACKUP_TRIGGER.SESSION_START});h.rows[0].recovery.mediaReferences[0].binaryData=new Uint8Array([1,2,3]).buffer;
  const replaced=await h.service.run(context,{trigger:AUTOMATIC_BACKUP_TRIGGER.SCHEDULED});assert.equal(replaced.status,'recovery-verified');assert.equal(h.rows.length,1);assert.equal(hasBinary(h.rows[0].recovery.mediaReferences),false);
});

test('unchanged recovery still permits scheduled and explicit session external backups',async()=>{
  const external={inspect:async()=>({status:'ready'}),writeVerified:async({filename,blob,verify})=>{await verify(blob);return {status:'ready',filename,size:blob.size,verified:true,finalizedBy:'move'};}},h=harness({external});
  const first=await h.service.run(context,{trigger:AUTOMATIC_BACKUP_TRIGGER.SESSION_START}),scheduled=await h.service.run(context,{trigger:AUTOMATIC_BACKUP_TRIGGER.SCHEDULED}),resumedStart=await h.service.run(context,{trigger:AUTOMATIC_BACKUP_TRIGGER.SESSION_START});
  assert.equal(first.status,'recovery-verified');assert.equal(scheduled.status,'unchanged');assert.equal(resumedStart.status,'unchanged');
  assert.equal(h.rows.length,1);assert.equal(h.exportCalls.length,3,'unchanged compact state must not suppress due external archives');
  assert.equal(h.events.filter(item=>item.eventType==='automatic_recovery_snapshot_verified').length,1);
  assert.equal(h.events.filter(item=>item.eventType==='automatic_backup_verified').length,3);
});

test('snapshot failure is contained and leaves rally caller operational',async()=>{
  const h=harness({saveFailure:new Error('quota full')}),queued=h.service.enqueue(context,{trigger:AUTOMATIC_BACKUP_TRIGGER.CHECKPOINT_COMPLETED});assert.equal(queued.accepted,true);
  const result=await queued.task;assert.deepEqual({status:result.status,error:result.error},{status:'failed',error:'quota full'});assert.equal(h.events.at(-1).eventType,'automatic_backup_failed');
});

test('checksum verification resolves every referenced durable missionMedia Blob',async()=>{
  const h=harness(),row=media('media-1');h.setMedia([row]);const result=await h.service.run(context,{trigger:AUTOMATIC_BACKUP_TRIGGER.SESSION_START});assert.equal(result.status,'recovery-verified');
  row.blob=new Blob(['mutated']);
  const unchanged=await h.service.run(context,{trigger:AUTOMATIC_BACKUP_TRIGGER.SCHEDULED});assert.equal(unchanged.status,'failed');assert.match(unchanged.error,/media verification failed/);
  const changed={...session,checkpointStates:{cp:{status:'arrived'}}},newSnapshot=await h.service.run({...context,session:changed},{trigger:AUTOMATIC_BACKUP_TRIGGER.CHECKPOINT_COMPLETED});assert.equal(newSnapshot.status,'failed');assert.match(newSnapshot.error,/media verification failed/);
});

test('recovery verification detects altered Journal metadata and checkpoint evidence',async()=>{
  const h=harness();await h.service.run(context,{trigger:AUTOMATIC_BACKUP_TRIGGER.SESSION_START});
  h.rows[0].recovery.journal[0].metadata.tampered=true;
  await assert.rejects(()=>h.service.latestRecovery('session-1'),/Journal verification failed/);
  delete h.rows[0].recovery.journal[0].metadata.tampered;
  h.rows[0].recovery.session.checkpointStates={cp:{status:'collected',scoreAwarded:10}};
  await assert.rejects(()=>h.service.latestRecovery('session-1'),/checkpoint evidence verification failed/);
});

test('checkpoint external ZIPs are rate-limited while scheduled and day-complete writes are forced',async()=>{
  const external={inspect:async()=>({status:'ready'}),writeVerified:async({filename,blob,verify})=>{await verify(blob);return {status:'ready',filename,size:15,verified:true,finalizedBy:'move'};}},h=harness({external});
  let result=await h.service.run(context,{trigger:AUTOMATIC_BACKUP_TRIGGER.SESSION_START});assert.equal(result.external.status,'ready');assert.equal(h.exportCalls.length,1);
  h.advance(10*60*1000);const changed={...session,checkpointStates:{cp:{status:'collected'}}};result=await h.service.run({...context,session:changed},{trigger:AUTOMATIC_BACKUP_TRIGGER.CHECKPOINT_COMPLETED});assert.equal(result.external.status,'deferred');assert.equal(h.exportCalls.length,1,'nearby checkpoint does not rebuild the full ZIP');
  h.advance(2*60*60*1000);result=await h.service.run({...context,session:{...changed,status:'completed'}},{trigger:AUTOMATIC_BACKUP_TRIGGER.DAY_COMPLETED});assert.equal(result.external.status,'ready');assert.equal(h.exportCalls.length,2);
  assert.equal(h.events.filter(item=>item.eventType==='automatic_backup_verified').length,2,'BACKUP VERIFIED is reserved for reopened external archives');
});

test('external failure cannot invalidate the internal recovery snapshot',async()=>{
  const h=harness({external:{inspect:async()=>({status:'ready'}),writeVerified:async()=>({status:'failed',error:'device removed',priorVerifiedPreserved:true})}}),result=await h.service.run(context,{trigger:AUTOMATIC_BACKUP_TRIGGER.DAY_COMPLETED});
  assert.equal(result.status,'recovery-verified');assert.equal(result.external.status,'failed');assert.equal(h.rows.length,1);assert.equal(h.rows[0].verified,true);assert.ok(h.events.some(item=>item.eventType==='automatic_backup_external_attention'));
});

test('scheduler installs one two-hour interval and drains scheduled work',async()=>{
  const h=harness();assert.equal(h.service.start(()=>context),true);assert.equal(h.service.start(()=>context),false);assert.equal(h.timers.length,1);assert.equal(h.timers[0].delay,2*60*60*1000);h.timers[0].callback();await h.service.drain();assert.equal(h.rows.length,1);h.service.stop();assert.equal(h.service.state().running,false);
});

test('scheduler awaits an asynchronous context provider before enqueueing recovery',async()=>{
  const h=harness();let release;const providerResult=new Promise(resolve=>{release=resolve;});
  assert.equal(h.service.start(async()=>providerResult),true);h.timers[0].callback();await Promise.resolve();release(context);
  await new Promise(resolve=>setTimeout(resolve,0));await h.service.drain();
  assert.equal(h.rows.length,1);assert.equal(h.rows[0].trigger,AUTOMATIC_BACKUP_TRIGGER.SCHEDULED);assert.equal(h.service.state().pendingSessions.length,0);
});

test('a manual exact request queued behind an in-flight backup awaits its own context and generation',async()=>{
  let releaseFirst,enteredFirst;const firstEntered=new Promise(resolve=>{enteredFirst=resolve;}),firstGate=new Promise(resolve=>{releaseFirst=resolve;}),calls=[],external={inspect:async()=>({status:'ready'}),async writeVerifiedGeneration(input){calls.push(input);if(calls.length===1){enteredFirst();await firstGate;}return {status:'ready',filename:`${input.sessionDirectoryName}/${input.generationFilename}`,size:100,verified:true,finalizedBy:'incremental-files',manifest:{...input.manifest,mediaCount:input.media.length}};}},h=harness({external}),first=h.service.enqueue(context,{trigger:AUTOMATIC_BACKUP_TRIGGER.SCHEDULED});await firstEntered;
  const manualContext={...context,session:{...context.session,checkpointStates:{'cp-1':{status:'collected',scoreAwarded:10}}},journal:[event(),event('manual-current')]},manual=h.service.enqueue(manualContext,{trigger:AUTOMATIC_BACKUP_TRIGGER.MANUAL,waitForOwnRun:true});let manualResolved=false;void manual.task.then(()=>{manualResolved=true;});await Promise.resolve();assert.equal(manualResolved,false);releaseFirst();const firstResult=await first.task,manualResult=await manual.task;
  assert.equal(firstResult.external.manifest.journalEventCount,1);assert.equal(manualResult.external.manifest.journalEventCount,2);assert.notEqual(firstResult.external.filename,manualResult.external.filename);assert.equal(calls.length,2);assert.equal(calls[1].manifest.checkpointStates[0].checkpointId,'cp-1');
});
