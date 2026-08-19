import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RALLY_EXECUTION_SCHEMA_VERSION,activeSession,inspectRallySessions,listDaySessions,
  migrateRallyExecution,resumeSession,startNewSession,syncActiveSession
} from '../src/domain/rally/session.js';

const arrival={
  state:'confirmed',trustworthy:true,arrivalId:'arrival-1',timestamp:'2026-08-17T14:02:00.000Z',
  latitude:41,longitude:-87,gpsAccuracyFeet:18,source:'gps-radius-dwell'
};

const projectFixture=()=>({
  projectId:'america-250-execution',rallyId:'america-250',name:'America 250',
  rallyExecution:{schemaVersion:1,days:{'1':{
    dayNumber:1,dayId:'america-250-day-1',status:'active',startedAt:'2026-08-17T13:00:00.000Z'
  }}},
  features:[
    {id:'cp-1.1',type:'checkpoint',day:1,name:'1.1 I-12',points:10,notes:'Static rider note',geometry:{kind:'point',coordinates:[{lat:41,lon:-87}]},photoRequired:true,status:'collected',arrivedAt:'2026-08-17T14:00:00.000Z',photoEvidenceState:'complete',finalCompletionState:'completed',completedAt:'2026-08-17T14:00:05.000Z',scoreAwarded:10,photoPair:{pairId:'pair-complete',status:'complete'}},
    {id:'cp-1.2',type:'checkpoint',day:1,name:'1.2 Hwy 190',points:10,notes:'Keep this too',geometry:{kind:'point',coordinates:[{lat:42,lon:-88}]},photoRequired:true,status:'photo_required',arrivedAt:'2026-08-17T14:02:00.000Z',arrivalState:'confirmed',arrivalEvidence:{...arrival},checkpointEvidence:{arrival:{...arrival},photo:{required:true,state:'partial',pairId:'pair-partial',updatedAt:'2026-08-17T14:02:05.000Z'},completion:{state:'pending',pointsAwarded:0}},photoEvidenceState:'partial',finalCompletionState:'pending',scoreAwarded:0,pendingPhotoPair:{pairId:'pair-partial',status:'partial'}},
    {id:'hotel-1',type:'hotel',day:1,name:'Hotel',points:0,status:'upcoming',geometry:{kind:'point',coordinates:[{lat:43,lon:-89}]}},
    {id:'cp-2.1',type:'checkpoint',day:2,name:'2.1',points:10,status:'upcoming',geometry:{kind:'point',coordinates:[{lat:44,lon:-90}]}},
    {id:'route',type:'route',day:1,name:'Static route',status:'active',geometry:{kind:'line',coordinates:[]}}
  ]
});

test('schema-v1 day execution migrates once into stable session history',()=>{
  const project=projectFixture(),before=structuredClone(project.features);
  const execution=migrateRallyExecution(project,{migratedAt:'2026-08-18T12:00:00.000Z'});
  const session=activeSession(project);

  assert.equal(execution.schemaVersion,RALLY_EXECUTION_SCHEMA_VERSION);
  assert.match(session.sessionId,/^legacy-/);
  assert.deepEqual({projectId:session.projectId,rallyId:session.rallyId,dayId:session.dayId,dayNumber:session.dayNumber,calendarDate:session.calendarDate,runNumber:session.runNumber,status:session.status},
    {projectId:'america-250-execution',rallyId:'america-250',dayId:'america-250-day-1',dayNumber:1,calendarDate:'2026-08-17',runNumber:1,status:'active'});
  assert.equal(session.activeObjectiveId,null);
  assert.equal(session.checkpointStates['cp-1.1'].photoPair.pairId,'pair-complete');
  assert.equal(session.checkpointStates['cp-1.2'].pendingPhotoPair.pairId,'pair-partial');
  assert.deepEqual(session.pendingEvidence.entries.map(item=>item.checkpointId),['cp-1.2']);
  assert.deepEqual(project.features,before,'migration captures but does not rewrite live features');
  assert.deepEqual(JSON.parse(JSON.stringify(project.rallyExecution)),project.rallyExecution,'execution graph remains JSON serializable');

  const snapshot=structuredClone(project.rallyExecution);
  migrateRallyExecution(project,{migratedAt:'2099-01-01T00:00:00.000Z'});
  assert.deepEqual(project.rallyExecution,snapshot,'repeated migration is idempotent');
  assert.deepEqual(listDaySessions(project,1).map(item=>item.sessionId),[session.sessionId]);
});

test('legacy pending arrays normalize to the session-scoped queue contract',()=>{
  const project=projectFixture();
  project.rallyExecution.days['1'].pendingEvidence=[{checkpointId:'cp-1.2',photoState:'partial',queuedAt:'2026-08-17T14:02:00.000Z'}];
  migrateRallyExecution(project,{migratedAt:'2026-08-18T12:00:00.000Z'});
  const session=activeSession(project),entry=session.pendingEvidence.entries[0];
  assert.equal(session.pendingEvidence.schemaVersion,1);
  assert.equal(entry.sessionId,session.sessionId);
  assert.equal(entry.checkpointId,'cp-1.2');
  assert.equal(entry.enqueuedAt,'2026-08-17T14:02:00.000Z');
});

test('ambiguous legacy GPS fields do not fabricate a pending-evidence queue entry',()=>{
  const project=projectFixture(),checkpoint=project.features.find(item=>item.id==='cp-1.2');
  delete checkpoint.arrivalEvidence.trustworthy;delete checkpoint.checkpointEvidence.arrival.trustworthy;
  migrateRallyExecution(project,{migratedAt:'2026-08-18T12:00:00.000Z'});
  assert.deepEqual(activeSession(project).pendingEvidence.entries,[]);
});

test('start new preserves yesterday and resets only same-day execution state',()=>{
  const project=projectFixture();migrateRallyExecution(project,{migratedAt:'2026-08-18T12:00:00.000Z'});
  const legacy=activeSession(project),staticBefore=project.features.map(feature=>({id:feature.id,name:feature.name,points:feature.points,notes:feature.notes,geometry:structuredClone(feature.geometry)}));
  const session=startNewSession(project,{dayNumber:1,calendarDate:'2026-08-18',sessionId:'session-date-b',startedAt:'2026-08-18T13:00:00.000Z'});

  assert.deepEqual({sessionId:session.sessionId,calendarDate:session.calendarDate,runNumber:session.runNumber,status:session.status},
    {sessionId:'session-date-b',calendarDate:'2026-08-18',runNumber:2,status:'active'});
  assert.equal(project.rallyExecution.sessions[legacy.sessionId].status,'suspended');
  assert.equal(project.rallyExecution.sessions[legacy.sessionId].checkpointStates['cp-1.1'].scoreAwarded,10);
  assert.deepEqual(session.pendingEvidence,{schemaVersion:1,entries:[]});
  for(const feature of project.features.filter(item=>['cp-1.1','cp-1.2','hotel-1'].includes(item.id))){
    assert.equal(feature.status,'upcoming');
    for(const key of ['arrivedAt','arrivalEvidence','checkpointEvidence','photoPair','pendingPhotoPair','completedAt','scoreAwarded','deferredAt','failedAt'])assert.equal(Object.hasOwn(feature,key),false,`${feature.id}.${key} reset`);
  }
  assert.equal(project.features.find(item=>item.id==='cp-2.1').status,'upcoming','other days are untouched');
  assert.equal(project.features.find(item=>item.id==='route').status,'active','non-objective route state is untouched');
  assert.deepEqual(project.features.map(feature=>({id:feature.id,name:feature.name,points:feature.points,notes:feature.notes,geometry:structuredClone(feature.geometry)})),staticBefore);
  assert.deepEqual(listDaySessions(project,1).map(item=>[item.calendarDate,item.runNumber]),[['2026-08-17',1],['2026-08-18',2]]);
});

test('sync and resume preserve isolated projections and are idempotent',()=>{
  const project=projectFixture();migrateRallyExecution(project,{migratedAt:'2026-08-18T12:00:00.000Z'});
  const legacy=activeSession(project);
  startNewSession(project,{dayNumber:1,calendarDate:'2026-08-18',sessionId:'session-date-b',startedAt:'2026-08-18T13:00:00.000Z'});
  const checkpoint=project.features.find(item=>item.id==='cp-1.1');
  Object.assign(checkpoint,{status:'photo_required',arrivedAt:'2026-08-18T14:00:00.000Z',arrivalState:'confirmed',photoEvidenceState:'failed',scoreAwarded:0});
  const queue={schemaVersion:1,entries:[{sessionId:'wrong-scope',checkpointId:'cp-1.1',photoState:'failed',enqueuedAt:'2026-08-18T14:00:00.000Z',updatedAt:'2026-08-18T14:00:00.000Z'}]};
  syncActiveSession(project,{activeObjectiveId:'cp-1.1',pendingEvidence:queue,syncedAt:'2026-08-18T14:01:00.000Z'});
  const once=structuredClone(project.rallyExecution);
  syncActiveSession(project,{activeObjectiveId:'cp-1.1',pendingEvidence:queue,syncedAt:'2099-01-01T00:00:00.000Z'});
  assert.deepEqual(project.rallyExecution,once,'same sync does not churn timestamps or state');

  const restored=resumeSession(project,legacy.sessionId,{resumedAt:'2026-08-18T15:00:00.000Z'});
  assert.equal(restored.sessionId,legacy.sessionId);
  assert.equal(project.features.find(item=>item.id==='cp-1.1').status,'collected');
  assert.equal(project.features.find(item=>item.id==='cp-1.1').scoreAwarded,10);
  assert.equal(project.features.find(item=>item.id==='cp-1.2').pendingPhotoPair.pairId,'pair-partial');
  assert.equal(project.rallyExecution.sessions['session-date-b'].checkpointStates['cp-1.1'].photoEvidenceState,'failed');
  assert.equal(project.rallyExecution.sessions['session-date-b'].pendingEvidence.entries[0].sessionId,'session-date-b');

  const resumeSnapshot=structuredClone(project.rallyExecution);
  resumeSession(project,legacy.sessionId,{resumedAt:'2099-01-01T00:00:00.000Z'});
  assert.deepEqual(project.rallyExecution,resumeSnapshot,'resuming the already-active session is idempotent');
});

test('explicit resume reapplies the active stored projection after reload drift',()=>{
  const project=projectFixture();migrateRallyExecution(project,{migratedAt:'2026-08-18T12:00:00.000Z'});
  const session=activeSession(project),checkpoint=project.features.find(item=>item.id==='cp-1.1');
  checkpoint.status='upcoming';delete checkpoint.completedAt;delete checkpoint.scoreAwarded;
  resumeSession(project,session.sessionId,{resumedAt:'2026-08-18T15:00:00.000Z'});
  assert.equal(checkpoint.status,'collected');
  assert.equal(checkpoint.completedAt,'2026-08-17T14:00:05.000Z');
  assert.equal(checkpoint.scoreAwarded,10);
});

test('completed session retains summary and maps to legacy complete day status',()=>{
  const project=projectFixture();migrateRallyExecution(project,{migratedAt:'2026-08-18T12:00:00.000Z'});
  const summary={score:20,checkpointCount:2};
  const session=syncActiveSession(project,{status:'completed',completedAt:'2026-08-17T20:00:00.000Z',summary,nextDay:2,syncedAt:'2026-08-17T20:00:00.000Z'});
  assert.equal(session.status,'completed');assert.deepEqual(session.summary,summary);assert.equal(session.nextDay,2);
  assert.deepEqual(project.rallyExecution.days['1'],{
    dayNumber:1,dayId:'america-250-day-1',sessionId:session.sessionId,status:'complete',startedAt:'2026-08-17T13:00:00.000Z',
    completedAt:'2026-08-17T20:00:00.000Z',nextDay:2,summary
  });
});

test('inspection requires an explicit new-or-resume choice for unfinished history',()=>{
  const project=projectFixture();migrateRallyExecution(project,{migratedAt:'2026-08-18T12:00:00.000Z'});
  const inspection=inspectRallySessions(project,{dayNumber:1});
  assert.equal(inspection.requiresStartChoice,true);
  assert.equal(inspection.canResume,true);
  assert.equal(inspection.canStartNew,true);
  assert.equal(Object.isFrozen(inspection),true);
  assert.equal(Object.isFrozen(inspection.daySessions[0]),true);
});

test('default-normalized untouched checkpoints do not fabricate legacy sessions',()=>{
  const project={projectId:'fresh-project',features:[1,2].map(day=>({
    id:`cp-${day}`,type:'checkpoint',day,status:'upcoming',arrivedAt:null,completedAt:null,deferredAt:null,
    photoRequired:true,photoStatus:'required_pending',photoEvidenceState:'not_attempted',arrivalState:'not_confirmed',
    finalCompletionState:'pending',scoreAwarded:0,
    checkpointEvidence:{arrival:{state:'not_confirmed',trustworthy:false},photo:{state:'not_attempted'},completion:{state:'pending'}}
  }))};
  migrateRallyExecution(project,{migratedAt:'2026-08-18T12:00:00.000Z'});
  assert.equal(activeSession(project),null);
  assert.deepEqual(project.rallyExecution.sessions,{});
});

test('at least 60 independent trip days are supported without a fixed-day ceiling',()=>{
  const project={projectId:'long-trip',rallyId:'month-ride',features:Array.from({length:60},(_,index)=>({id:`cp-${index+1}`,type:'checkpoint',day:index+1,status:'planned',name:`Day ${index+1}`,geometry:{kind:'point',coordinates:[{lat:40,lon:-90}]}}))};
  for(let day=1;day<=60;day++)startNewSession(project,{dayNumber:day,calendarDate:`2026-${day<=31?'08':'09'}-${String(day<=31?day:day-31).padStart(2,'0')}`,sessionId:`session-${day}`,startedAt:new Date(Date.UTC(2026,7,day,12)).toISOString()});
  assert.equal(Object.keys(project.rallyExecution.sessions).length,60);
  assert.equal(activeSession(project).dayNumber,60);
  assert.equal(listDaySessions(project,60)[0].sessionId,'session-60');
  assert.equal(project.features.at(-1).status,'upcoming');
});

test('generated session identities must be unique and completed history cannot resume',()=>{
  const project=projectFixture();migrateRallyExecution(project,{migratedAt:'2026-08-18T12:00:00.000Z'});
  const values=['duplicate','duplicate','fresh-id'];
  const created=startNewSession(project,{dayNumber:1,calendarDate:'2026-08-18',startedAt:'2026-08-18T13:00:00.000Z',createId:()=>values.shift()});
  assert.equal(created.sessionId,'duplicate');
  assert.throws(()=>startNewSession(project,{dayNumber:1,calendarDate:'2026-08-18',sessionId:'duplicate'}),/already exists/);
  syncActiveSession(project,{status:'completed',completedAt:'2026-08-18T20:00:00.000Z'});
  assert.throws(()=>resumeSession(project,'duplicate'),/cannot be resumed/);
});
