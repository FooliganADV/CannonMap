import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

import {createCheckpointArrivalCoordinator} from '../src/application/checkpoint-arrival-coordinator.js';
import {createPhotoExportService} from '../src/application/photo-export-service.js';
import {
  createPendingEvidenceQueue,pendingEvidenceEntry,PENDING_EVIDENCE_ACTION,
  recordPendingEvidenceAction,upsertPendingEvidence
} from '../src/domain/checkpoints/pending-evidence-queue.js';
import {createSessionArtifactFilename} from '../src/domain/rally/artifacts.js';
import {
  activeSession,resumeSession,startNewSession,syncActiveSession
} from '../src/domain/rally/session.js';
import {wireRallyController} from '../src/ui/rally/controller.js';
import {renderRally} from '../src/ui/rally/presenter.js';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const clone=value=>structuredClone(value);

function functionSource(name){
  const start=app.indexOf(`function ${name}(`);
  assert.notEqual(start,-1,`${name} must exist`);
  const parameters=app.indexOf('(',start);
  let parameterDepth=0,parameterQuote=null,parameterEscaped=false,opening=-1;
  for(let index=parameters;index<app.length;index++){
    const character=app[index];
    if(parameterQuote){
      if(parameterEscaped)parameterEscaped=false;
      else if(character==='\\')parameterEscaped=true;
      else if(character===parameterQuote)parameterQuote=null;
      continue;
    }
    if(character==='\''||character==='"'||character==='`'){parameterQuote=character;continue;}
    if(character==='(')parameterDepth++;
    if(character===')'&&--parameterDepth===0){opening=app.indexOf('{',index);break;}
  }
  assert.notEqual(opening,-1,`${name} must have a function body`);
  let depth=0,quote=null,escaped=false;
  for(let index=opening;index<app.length;index++){
    const character=app[index];
    if(quote){
      if(escaped)escaped=false;
      else if(character==='\\')escaped=true;
      else if(character===quote)quote=null;
      continue;
    }
    if(character==='\''||character==='"'||character==='`'){quote=character;continue;}
    if(character==='{')depth++;
    if(character==='}'&&--depth===0)return app.slice(start,index+1);
  }
  throw new Error(`${name} has no closing brace`);
}

const projectFixture=()=>({
  projectId:'project-session-integration',rallyId:'america-250',name:'America 250',
  features:[
    {id:'cp-1.1',type:'checkpoint',day:1,name:'1.1 I-12',photoRequired:true,points:10,status:'upcoming',geometry:{kind:'point',coordinates:[{lat:38.1,lon:-105.1}]}},
    {id:'cp-1.2',type:'checkpoint',day:1,name:'1.2 HWY 190',photoRequired:true,points:10,status:'upcoming',geometry:{kind:'point',coordinates:[{lat:38.2,lon:-105.2}]}}
  ]
});

const arrivalEvidence=(sessionId,checkpointId,timestamp)=>({
  state:'confirmed',trustworthy:true,source:'gps_capture',arrivalId:`arrival:${sessionId}:${checkpointId}`,
  sessionId,checkpointId,timestamp,latitude:38.1,longitude:-105.1,gpsAccuracyFeet:14
});

function markArrivalPhotoMissing(project,sessionId,checkpointId,timestamp){
  const checkpoint=project.features.find(item=>item.id===checkpointId),arrival=arrivalEvidence(sessionId,checkpointId,timestamp);
  checkpoint.status='photo_required';
  checkpoint.arrivedAt=timestamp;
  checkpoint.arrivalState='confirmed';
  checkpoint.arrivalEvidence=arrival;
  checkpoint.photoEvidenceState='failed';
  checkpoint.finalCompletionState='pending';
  checkpoint.scoreAwarded=0;
  checkpoint.checkpointEvidence={
    schemaVersion:1,arrival,
    photo:{required:true,state:'failed',pairId:null,missingSides:['front','rear'],updatedAt:timestamp},
    completion:{state:'pending',pointsAwarded:0}
  };
  return checkpoint;
}

const fakeElement=()=>({
  textContent:'',innerHTML:'',hidden:false,disabled:false,dataset:{},listeners:{},
  classList:{values:new Set(),toggle(name,enabled){if(enabled)this.values.add(name);else this.values.delete(name);}},
  attributes:{},addEventListener(name,handler){this.listeners[name]=handler;},
  setAttribute(name,value){this.attributes[name]=String(value);},querySelector(){return null;}
});

test('assembled Rally UI makes Resume Existing and Start New separate deliberate actions',()=>{
  const elements=new Map(),getElement=id=>{if(!elements.has(id))elements.set(id,fakeElement());return elements.get(id);};
  const model={
    day:1,online:true,score:0,next:null,distance:null,warnings:[],checkpoints:[],hasHotel:true,
    sessionChoice:{show:true,canResume:true,canStartNew:true,session:{sessionId:'session-a',dayNumber:1,runNumber:2,calendarDate:'2026-08-17'}}
  };
  renderRally({getElement,escapeHtml:String,model});
  assert.equal(getElement('rallySessionChoice').hidden,false);
  assert.match(getElement('rallySessionChoiceSummary').textContent,/Day 1 · Run 2 · 2026-08-17/);
  assert.equal(getElement('rallyResumeSessionButton').hidden,false);
  assert.equal(getElement('rallyResumeSessionButton').disabled,false);
  assert.equal(getElement('rallyStartNewSessionButton').disabled,false);
  assert.equal(getElement('rallyPrimaryCard').hidden,true,'normal route controls remain gated until the rider chooses');

  const calls=[];
  wireRallyController({getElement,actions:new Proxy({
    resumeSession:()=>calls.push('resume'),startNewSession:()=>calls.push('start-new'),render:()=>{}
  },{get:(target,key)=>target[key]||(()=>{})}),windowTarget:{addEventListener(){}}});
  getElement('rallyResumeSessionButton').listeners.click();
  getElement('rallyStartNewSessionButton').listeners.click();
  assert.deepEqual(calls,['resume','start-new']);
});

test('two physical runs of the same Day 1 retain isolated checkpoint and pending-evidence projections',()=>{
  const project=projectFixture();
  const first=startNewSession(project,{dayNumber:1,calendarDate:'2026-08-17',sessionId:'session-date-a',startedAt:'2026-08-17T13:00:00.000Z'});
  let queue=createPendingEvidenceQueue();
  const firstCheckpoint=markArrivalPhotoMissing(project,first.sessionId,'cp-1.1','2026-08-17T14:00:00.000Z');
  queue=upsertPendingEvidence(queue,{sessionId:first.sessionId,checkpoint:firstCheckpoint}).queue;
  queue=recordPendingEvidenceAction(queue,{sessionId:first.sessionId,checkpointId:firstCheckpoint.id,action:PENDING_EVIDENCE_ACTION.CONTINUE,at:'2026-08-17T14:02:00.000Z'}).queue;
  syncActiveSession(project,{activeObjectiveId:'cp-1.2',pendingEvidence:queue,syncedAt:'2026-08-17T14:02:00.000Z'});

  const second=startNewSession(project,{dayNumber:1,calendarDate:'2026-08-18',sessionId:'session-date-b',startedAt:'2026-08-18T13:00:00.000Z'});
  assert.deepEqual({run:second.runNumber,date:second.calendarDate,pending:second.pendingEvidence.entries.length},{run:2,date:'2026-08-18',pending:0});
  assert.equal(project.features.find(item=>item.id==='cp-1.1').status,'upcoming');
  assert.equal(project.rallyExecution.sessions[first.sessionId].checkpointStates['cp-1.1'].arrivalState,'confirmed');
  assert.equal(project.rallyExecution.sessions[first.sessionId].pendingEvidence.entries[0].lastAction,'CONTINUE');

  const secondCheckpoint=markArrivalPhotoMissing(project,second.sessionId,'cp-1.2','2026-08-18T14:00:00.000Z');
  const secondQueue=upsertPendingEvidence(createPendingEvidenceQueue(),{sessionId:second.sessionId,checkpoint:secondCheckpoint}).queue;
  syncActiveSession(project,{activeObjectiveId:'cp-1.1',pendingEvidence:secondQueue,syncedAt:'2026-08-18T14:01:00.000Z'});
  const resumed=resumeSession(project,first.sessionId,{resumedAt:'2026-08-18T18:00:00.000Z'});
  assert.equal(resumed.sessionId,first.sessionId);
  assert.equal(project.features.find(item=>item.id==='cp-1.1').arrivalEvidence.sessionId,first.sessionId);
  assert.equal(project.features.find(item=>item.id==='cp-1.2').status,'active','Resume materializes exactly one current navigation target');
  assert.deepEqual(activeSession(project).pendingEvidence.entries.map(item=>[item.checkpointId,item.lastAction]),[['cp-1.1','CONTINUE']]);

  const reloaded=clone(project),before=clone(reloaded.rallyExecution.sessions[first.sessionId]);
  const reloadResume=resumeSession(reloaded,first.sessionId,{resumedAt:'2099-01-01T00:00:00.000Z'});
  assert.deepEqual(reloadResume,before,'explicit Resume reapplies the exact stored projection without duplicating it');
  assert.deepEqual(reloaded.rallyExecution.sessions[second.sessionId].pendingEvidence.entries.map(item=>item.checkpointId),['cp-1.2']);
});

test('CP 1.1 unresolved media processing cannot block CP 1.2 durable GPS arrival or queue state',async()=>{
  const project=projectFixture(),session=startNewSession(project,{dayNumber:1,calendarDate:'2026-08-18',sessionId:'field-run',startedAt:'2026-08-18T13:00:00.000Z'});
  let queue=createPendingEvidenceQueue(),releaseFirst,signalFirst;
  const firstBlocked=new Promise(resolve=>{releaseFirst=resolve;}),firstProcessing=new Promise(resolve=>{signalFirst=resolve;});
  const persisted=[],processed=[];
  const coordinator=createCheckpointArrivalCoordinator({
    dwellMs:0,
    persistArrival(arrival){
      const checkpoint=markArrivalPhotoMissing(project,session.sessionId,arrival.checkpointId,arrival.detectedAtIso);
      queue=upsertPendingEvidence(queue,{sessionId:session.sessionId,checkpoint}).queue;
      syncActiveSession(project,{activeObjectiveId:'cp-1.2',pendingEvidence:queue,syncedAt:arrival.detectedAtIso});
      persisted.push(arrival.checkpointId);
      return {sessionId:session.sessionId,checkpointId:arrival.checkpointId};
    },
    async processArrival(arrival){
      processed.push(arrival.checkpointId);
      if(arrival.checkpointId==='cp-1.1'){signalFirst();await firstBlocked;}
    }
  });
  const detection=checkpointId=>({checkpointId,distanceFeet:10,accuracyFeet:14,radiusFeet:100});
  const start=Date.parse('2026-08-18T14:00:00.000Z');
  coordinator.observe({observedAt:start,detections:[detection('cp-1.1')]});
  await firstProcessing;
  coordinator.observe({observedAt:start+120_001,detections:[detection('cp-1.2')]});

  assert.deepEqual(persisted,['cp-1.1','cp-1.2'],'both arrivals persist while CP 1.1 media processing is unresolved');
  assert.deepEqual(processed,['cp-1.1'],'CP 1.2 media work remains serialized without delaying its factual arrival');
  assert.deepEqual(queue.entries.map(item=>item.checkpointId),['cp-1.1','cp-1.2']);
  for(const checkpoint of project.features){
    assert.equal(checkpoint.arrivalState,'confirmed');
    assert.equal(checkpoint.finalCompletionState,'pending');
    assert.equal(checkpoint.scoreAwarded,0,'GPS arrival alone never awards ordinary points');
  }

  const retry={sessionId:session.sessionId,checkpointId:'cp-1.1',action:PENDING_EVIDENCE_ACTION.RETRY,at:'2026-08-18T14:03:00.000Z'};
  queue=recordPendingEvidenceAction(queue,retry).queue;
  queue=recordPendingEvidenceAction(queue,{sessionId:session.sessionId,checkpointId:'cp-1.2',action:PENDING_EVIDENCE_ACTION.CONTINUE,at:'2026-08-18T14:03:01.000Z'}).queue;
  syncActiveSession(project,{pendingEvidence:queue,syncedAt:'2026-08-18T14:03:01.000Z'});
  const reloaded=clone(project),restoredQueue=createPendingEvidenceQueue(activeSession(reloaded).pendingEvidence);
  assert.equal(pendingEvidenceEntry(restoredQueue,{sessionId:session.sessionId,checkpointId:'cp-1.1'}).lastAction,'RETRY');
  assert.equal(pendingEvidenceEntry(restoredQueue,{sessionId:session.sessionId,checkpointId:'cp-1.2'}).lastAction,'CONTINUE');
  const replay=recordPendingEvidenceAction(restoredQueue,retry);
  assert.equal(replay.changed,false,'reload/replay of the same durable action is idempotent');
  assert.equal(replay.entry.actions.length,1);

  releaseFirst();
  await coordinator.whenIdle();
  assert.deepEqual(processed,['cp-1.1','cp-1.2']);
});

test('assembled app persists session-scoped arrivals/actions and passes session identity through every Day export',()=>{
  const start=functionSource('startNewRallySession'),resume=functionSource('resumeExistingRallySession');
  assert.match(start,/startNewRallySessionRecord\(state\.project/);
  assert.match(start,/appendRallyJournalEvent\('rally_session_started'/);
  assert.match(resume,/resumeRallySessionRecord\(state\.project,sessionId/);
  assert.match(resume,/bindPendingEvidenceQueue\(session\)/);
  assert.match(resume,/reconcilePendingCheckpointEvidence\(\{interactive:false\}\)/);

  const arrival=functionSource('persistDetectedCheckpointArrival'),action=functionSource('persistPendingEvidenceActionFor');
  assert.match(arrival,/arrival\?\.evidence\?\.metadata\?\.sessionId!==session\.sessionId/);
  assert.match(arrival,/upsertCheckpointPendingEvidence\(checkpoint/);
  assert.match(arrival,/Promise\.all\(\[journalWrite,projectWrite\]\)/,'arrival and project evidence are durable before media processing');
  assert.ok(action.indexOf("appendRallyJournalEvent('checkpoint_pending_evidence_action'")<action.indexOf('recordPendingEvidenceAction('));
  assert.ok(action.indexOf('recordPendingEvidenceAction(')<action.indexOf('await saveProject(false)'));

  const append=functionSource('appendRallyJournalEvent');
  assert.match(append,/metadata:\{\.\.\.metadata,[\s\S]*?sessionId/);
  assert.match(append,/references:\{checkpointId:[\s\S]*?sessionId\}/);
  assert.match(append,/projectId,sessionId,timestamp,eventType/,'session identity is also directly visible on every execution event');
  assert.match(append,/projectId=String\(state\.project\.projectId\)/);
  assert.match(append,/stableUuid\(`\$\{projectId\}:\$\{sessionId\|\|'unscoped'\}/);
  assert.match(append,/activeJournalWrites\.add\(writeMarker\)/);

  const photos=functionSource('exportPhotoArchive'),journal=functionSource('exportDayJournal'),backup=functionSource('exportDayBackupPackage');
  assert.match(photos,/captureRallyExportContext\(\)/);
  assert.match(photos,/photoExports\.day\(context\.projectId,[\s\S]*?\{journal,project:context\.project,session,exportedAt/);
  assert.match(photos,/rallyExportContextMatches\(context\)/);
  assert.match(photos,/serviceWorkerCacheId:APP_SHELL_CACHE/);
  assert.match(journal,/journalEventsForSession\(journalEventsForDay/);
  assert.match(journal,/createSessionArtifactFilename\(/);
  assert.match(backup,/photoExports\.dayBackup\([\s\S]*?session,exportedAt:new Date\(\)/);
  assert.match(backup,/serviceWorkerCacheId:APP_SHELL_CACHE/);
  assert.match(functionSource('dayBackupProgressKey'),/session\?\.sessionId/);
});

test('view changes cannot replace an active session pending queue with an unowned empty runtime queue',()=>{
  const reset=functionSource('resetRallySessionSelection'),sync=functionSource('syncCurrentRallySessionProjection'),bind=functionSource('bindPendingEvidenceQueue');
  assert.match(reset,/pendingEvidenceQueueOwner=null/);
  assert.match(bind,/pendingEvidenceQueueOwner=pendingEvidenceOwnerFor\(session\)/);
  assert.match(sync,/queueOwned=pendingEvidenceQueueOwner===pendingEvidenceOwnerFor\(session\)/);
  assert.match(sync,/pendingEvidence:queueOwned\?pendingEvidenceQueue:undefined/,'save preserves the session\'s durable queue whenever the in-memory queue is not owned by that session');
});

test('a Journaled pending-evidence action is reprojected, saved, and rendered after an interrupted write',()=>{
  const replay=functionSource('replayPendingEvidenceActions'),reconcile=functionSource('reconcilePendingCheckpointEvidence');
  assert.match(replay,/let changed=false/);
  assert.match(replay,/changed=changed\|\|replay\.changed/);
  assert.match(replay,/applyPendingEvidenceActionProjection\(checkpoint,action/);
  assert.match(replay,/return \{queue:pendingEvidenceQueue,changed\}/);
  assert.match(reconcile,/pendingActionsReplayed=replayPendingEvidenceActions\(journal,session\)\.changed/);
  assert.match(reconcile,/pendingActionsReplayed\|\|executionActionsReplayed\)\{await saveProject\(false\);renderAll\(\);\}/);
});

test('Journal and Backup artifacts remain distinguishable and retain one immutable session identity',async()=>{
  const project=projectFixture(),session=startNewSession(project,{dayNumber:1,calendarDate:'2026-08-18',sessionId:'export-session',startedAt:'2026-08-18T13:00:00.000Z'}),buildIdentity={applicationVersion:'0.7.11',buildId:'2026.08.18.session-recovery-1',serviceWorkerCacheId:'cannonmap-v0.7.11-20260818-session-recovery-1'};
  const exporter=createPhotoExportService({repository:{async listProjectPhotos(){return [];}}});
  const firstAt='2026-08-18T22:37:42.123Z',secondAt='2026-08-18T22:37:42.124Z';
  const firstBackup=await exporter.dayBackup(project.projectId,1,{project,session,journal:[],buildIdentity,exportedAt:firstAt}),secondBackup=await exporter.dayBackup(project.projectId,1,{project,session,journal:[],buildIdentity,exportedAt:secondAt});
  const firstJournal=createSessionArtifactFilename({rallyName:project.name,dayNumber:1,runNumber:session.runNumber,exportedAt:firstAt,artifactType:'Journal',extension:'json'}),secondJournal=createSessionArtifactFilename({rallyName:project.name,dayNumber:1,runNumber:session.runNumber,exportedAt:secondAt,artifactType:'Journal',extension:'json'});
  assert.equal(new Set([firstBackup.filename,secondBackup.filename,firstJournal,secondJournal]).size,4);
  assert.match(firstBackup.filename,/CannonMap_America250_D01_Run01_.*_Backup\.cmapday\.zip$/);
  assert.match(firstJournal,/CannonMap_America250_D01_Run01_.*_Journal\.json$/);
  for(const manifest of [firstBackup.manifest,secondBackup.manifest]){
    assert.equal(manifest.sessionId,session.sessionId);
    assert.equal(manifest.calendarDate,'2026-08-18');
    assert.equal(manifest.sessionRunNumber,1);
    assert.equal(manifest.applicationVersion,'0.7.11');
    assert.equal(manifest.buildId,buildIdentity.buildId);
    assert.equal(manifest.serviceWorkerCacheId,buildIdentity.serviceWorkerCacheId);
  }
});
