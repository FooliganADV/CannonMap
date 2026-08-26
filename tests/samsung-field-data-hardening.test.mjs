import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');

function functionSource(name){
  const start=app.indexOf(`function ${name}(`);assert.notEqual(start,-1,`${name} must exist`);
  const parameters=app.indexOf('(',start);let parameterDepth=0,parameterQuote=null,parameterEscaped=false,opening=-1;
  for(let index=parameters;index<app.length;index++){
    const character=app[index];
    if(parameterQuote){if(parameterEscaped)parameterEscaped=false;else if(character==='\\')parameterEscaped=true;else if(character===parameterQuote)parameterQuote=null;continue;}
    if(character==='\''||character==='"'||character==='`'){parameterQuote=character;continue;}
    if(character==='(')parameterDepth++;if(character===')'&&--parameterDepth===0){opening=app.indexOf('{',index);break;}
  }
  assert.notEqual(opening,-1,`${name} must have a function body`);let depth=0,quote=null,escaped=false;
  for(let index=opening;index<app.length;index++){
    const character=app[index];
    if(quote){if(escaped)escaped=false;else if(character==='\\')escaped=true;else if(character===quote)quote=null;continue;}
    if(character==='\''||character==='"'||character==='`'){quote=character;continue;}
    if(character==='{')depth++;if(character==='}'&&--depth===0)return app.slice(start,index+1);
  }
  throw new Error(`${name} has no closing brace`);
}
const asyncFunctionSource=name=>functionSource(name).replace(/^function /,'async function ');

test('planning snapshot restore never resurrects an absent executed checkpoint',()=>{
  const source=functionSource('preserveRallyExecutionHistory'),deepClean=value=>JSON.parse(JSON.stringify(value));
  const preserve=vm.runInNewContext(`(${source})`,{deepClean,CHECKPOINT_EXECUTION_FIELDS:['status','arrivedAt','scoreAwarded']});
  const restored={features:[{id:'cp-1.1',type:'checkpoint',day:1,status:'upcoming'},{id:'cp-1.5',type:'checkpoint',day:1,status:'upcoming'}]},current={
    features:[{id:'cp-1.1',type:'checkpoint',day:1,status:'collected',scoreAwarded:10},{id:'cp-1.2',type:'checkpoint',day:1,status:'active',arrivedAt:'2026-08-26T12:00:00.000Z'}],
    rallyExecution:{schemaVersion:2,activeSessionId:'run-1',sessions:{'run-1':{sessionId:'run-1'}}}
  };
  const result=preserve(deepClean(restored),deepClean(current));
  assert.deepEqual(result.features.map(feature=>feature.id),['cp-1.1','cp-1.5']);
  assert.equal(result.features[0].status,'collected');
  assert.equal(result.features[0].scoreAwarded,10);
  assert.equal(result.rallyExecution.activeSessionId,'run-1','session history remains durable without restoring membership');
});

test('authoritative checkpoint membership mutations fence and reconcile Rally runtime',()=>{
  const gpx=functionSource('applyPendingImport'),restore=functionSource('restoreSnapshot'),mutations=['reassignExistingDays','updateSelectedFeature','duplicateSelected','deleteSelected','bulkAssign','createPendingFeature'].map(functionSource);
  for(const source of [gpx,restore,...mutations])assert.match(source,/reconcileActiveProjectRallyMembership\(/);
  assert.match(gpx,/acquireProjectMutation\(`apply GPX \$\{mode\}`\)/);
  assert.ok(gpx.indexOf('suspendPendingEvidenceRuntime')<gpx.indexOf('projectWorkflows.applyImport'));
  assert.ok(gpx.indexOf('syncCurrentRallySessionProjection')<gpx.indexOf('projectWorkflows.applyImport'));
  assert.match(gpx,/Merge is additive; checkpoints absent from this file remain in the Project/);
  assert.match(restore,/without restoring deleted checkpoint membership/);
  assert.doesNotMatch(functionSource('preserveRallyExecutionHistory'),/restored\.features\.push/);
  for(const source of mutations){
    assert.match(source,/acquireProjectMutation\(/);
    assert.match(source,/suspendPendingEvidenceRuntime\(/);
    assert.ok(source.indexOf('suspendPendingEvidenceRuntime')<source.indexOf('reconcileActiveProjectRallyMembership'));
    assert.match(source,/persistProjectBeforeRallyScopeResume\(/);
    assert.doesNotMatch(source,/resumeRallyScopeRuntime\(/,'membership mutations must not bypass the durable-save barrier');
    assert.ok(source.indexOf('reconcileActiveProjectRallyMembership')<source.indexOf('persistProjectBeforeRallyScopeResume'));
  }
  for(const source of [gpx,restore]){
    assert.match(source,/persistProjectBeforeRallyScopeResume\(/);
    assert.doesNotMatch(source,/resumeRallyScopeRuntime\(/,'GPX/snapshot membership replacement must not bypass the durable-save barrier');
    assert.ok(source.indexOf('reconcileActiveProjectRallyMembership')<source.indexOf('persistProjectBeforeRallyScopeResume'));
  }
});

test('Rally scope resumes only after the revised Project is durably saved',async()=>{
  const order=[];let releaseSave;
  const saveGate=new Promise(resolve=>{releaseSave=resolve;});
  const persist=vm.runInNewContext(`(${asyncFunctionSource('persistProjectBeforeRallyScopeResume')})`,{
    saveProject:async()=>{order.push('save-start');await saveGate;order.push('save-complete');},
    resumeRallyScopeRuntime:reason=>order.push(`resume:${reason}`)
  });
  const pending=persist('checkpoint-membership-delete-complete');
  await Promise.resolve();
  assert.deepEqual(order,['save-start'],'arrival/GPS runtime stays fenced while persistence is pending');
  releaseSave();await pending;
  assert.deepEqual(order,['save-start','save-complete','resume:checkpoint-membership-delete-complete']);
});

test('a failed membership save never resumes Rally runtime on undurable state',async()=>{
  const resumes=[];
  const persist=vm.runInNewContext(`(${asyncFunctionSource('persistProjectBeforeRallyScopeResume')})`,{
    saveProject:async()=>{throw new Error('IndexedDB transaction failed');},
    resumeRallyScopeRuntime:reason=>resumes.push(reason)
  });
  await assert.rejects(persist('gpx-replace-complete'),/IndexedDB transaction failed/);
  assert.deepEqual(resumes,[],'save rejection must leave the Rally scope fenced');
});

test('day/session scope selection persists before restarting arrival processing',async()=>{
  const order=[],dayFilter={value:'1'};let releaseSave,markSaveStarted;
  const saveGate=new Promise(resolve=>{releaseSave=resolve;}),saveStarted=new Promise(resolve=>{markSaveStarted=resolve;});
  const context={
    rallyScopeSuspended:false,
    saveProject:async()=>{order.push('save-start');markSaveStarted();await saveGate;order.push('save-complete');},
    resumeRallyScopeRuntime:reason=>{context.rallyScopeSuspended=false;order.push(`resume:${reason}`);},
    rejectRallyMutationWhileQuiesced:()=>false,
    suspendPendingEvidenceRuntime:async reason=>{context.rallyScopeSuspended=true;order.push(`suspend:${reason}`);},
    state:{settings:{dayFilter:'1'}},$:id=>id==='dayFilter'?dayFilter:null,
    resetRallySessionSelection:()=>order.push('reset-session'),renderAll:()=>order.push('render'),
    refreshDayPreflight:()=>order.push('preflight'),setStatus:message=>order.push(`status:${message}`)
  };
  const select=vm.runInNewContext(`(()=>{${asyncFunctionSource('persistProjectBeforeRallyScopeResume')};return ${asyncFunctionSource('changeRallyDayScope')};})()`,context);
  const pending=select('2',{reason:'day-filter-change',refreshPreflight:true});
  await saveStarted;
  assert.deepEqual(order,['suspend:day-filter-change','reset-session','save-start']);
  assert.equal(context.rallyScopeSuspended,true,'day 2 must not become executable before its settings/project save commits');
  releaseSave();assert.equal(await pending,true);
  assert.deepEqual(order,['suspend:day-filter-change','reset-session','save-start','save-complete','resume:day-filter-change-complete','render','preflight']);
  assert.equal(dayFilter.value,'2');
});

test('failed day/session scope persistence cannot resume the new day',async()=>{
  const order=[],statuses=[],dayFilter={value:'1'},context={
    rallyScopeSuspended:false,saveProject:async()=>{order.push('save');throw new Error('settings transaction failed');},
    resumeRallyScopeRuntime:reason=>order.push(`resume:${reason}`),rejectRallyMutationWhileQuiesced:()=>false,
    suspendPendingEvidenceRuntime:async()=>{context.rallyScopeSuspended=true;order.push('suspend');},
    state:{settings:{dayFilter:'1'}},$:id=>id==='dayFilter'?dayFilter:null,
    resetRallySessionSelection:()=>order.push('reset-session'),renderAll:()=>order.push('render'),
    refreshDayPreflight:()=>order.push('preflight'),setStatus:message=>statuses.push(message)
  };
  const select=vm.runInNewContext(`(()=>{${asyncFunctionSource('persistProjectBeforeRallyScopeResume')};return ${asyncFunctionSource('changeRallyDayScope')};})()`,context);
  assert.equal(await select('5',{reason:'daily-readiness-selection',refreshPreflight:true}),false);
  assert.deepEqual(order,['suspend','reset-session','save']);
  assert.equal(context.rallyScopeSuspended,true);
  assert.equal(dayFilter.value,'5','UI may show the attempted day but cannot execute it while fenced');
  assert.match(statuses.at(-1),/runtime remains safely paused; reload CannonMap/i);
});

test('all save-backed direct scope transitions use the durable resume barrier',()=>{
  for(const name of ['undo','startNewRallySession','resumeExistingRallySession','openProjectFile']){
    const source=functionSource(name);
    assert.match(source,/persistProjectBeforeRallyScopeResume\(/,`${name} uses durable resume barrier`);
    assert.doesNotMatch(source,/resumeRallyScopeRuntime\(/,`${name} cannot resume in a failure cleanup path`);
  }
});

test('scope suspension drains only tracked actions that pre-existed the scope mutation',async()=>{
  const context={activeRallyMutationTasks:new Set()},api=vm.runInNewContext(`(()=>{
    ${functionSource('trackRallyMutationTask')}
    ${functionSource('trackedRallyAction')}
    ${asyncFunctionSource('drainTrackedRallyMutations')}
    return {trackedRallyAction,drainTrackedRallyMutations};
  })()`,context);
  let releaseEarlier,markDrainStarted;
  const earlierGate=new Promise(resolve=>{releaseEarlier=resolve;}),drainStarted=new Promise(resolve=>{markDrainStarted=resolve;});
  const earlier=api.trackedRallyAction(()=>earlierGate)();
  const scopeMutation=api.trackedRallyAction(async()=>{markDrainStarted();await api.drainTrackedRallyMutations();return 'scope-complete';})();
  await drainStarted;
  assert.equal(context.activeRallyMutationTasks.size,2,'the outer scope action joins after the drain snapshot begins');
  releaseEarlier();
  const outcome=await Promise.race([scopeMutation,new Promise(resolve=>setTimeout(()=>resolve('self-wait-timeout'),250))]);
  assert.equal(outcome,'scope-complete','the scope mutation must not add itself to a live-set drain loop');
  await earlier;await Promise.resolve();
  assert.equal(context.activeRallyMutationTasks.size,0);
});

test('portable Project open preserves incomplete media before installing its save fence',async()=>{
  const order=[],context={rallyScopeSuspended:false,fenceActive:false,activeLifecycleProjectId:'old-project',restoredDayReview:null,defaultProjectSettings:{},state:{project:{projectId:'old-project',features:[]},settings:{}},projectSaveQueue:Promise.resolve(),APP_VERSION:'test',
    acquireProjectMutation:()=>({release:()=>order.push('mutation-release')}),
    beginProjectSaveFence:()=>{order.push('fence-begin');context.fenceActive=true;let release;context.fencePromise=new Promise(resolve=>{release=resolve;});return ()=>{if(!context.fenceActive)return;context.fenceActive=false;order.push('fence-release');release();};},
    projectWorkflows:{readPortableProject:payload=>payload},projectLifecycle:{listProjects:async()=>[],createProject:async project=>{order.push('project-created');return project;}},
    uid:()=> 'new-project',planningOnlyPortableProject:project=>structuredClone(project),
    suspendPendingEvidenceRuntime:async()=>{context.rallyScopeSuspended=true;order.push(`preservation-start:fence-${context.fenceActive}`);if(context.fenceActive)await context.fencePromise;order.push('preservation-saved');},
    releaseRallyAnalyticsProjectScope:async()=>order.push('analytics-released'),snapshot:()=>order.push('snapshot'),
    sanitizeProjectData:project=>project,$:()=>({value:''}),planningOnlyPortableSettings:value=>value||{},
    rallyExecution:()=>{},resetRallySessionSelection:()=>{},bindRallyAnalyticsToActiveProject:async()=>{},clearSelection:()=>{},
    persistProjectBeforeRallyScopeResume:async()=>{order.push(`project-persist:fence-${context.fenceActive}`);context.rallyScopeSuspended=false;},
    renderAll:()=>{},fitMap:()=>{},setStatus:()=>{}
  };
  const open=vm.runInNewContext(`(${asyncFunctionSource('openProjectFile')})`,context),file={name:'replacement.cmap',text:async()=>JSON.stringify({project:{projectId:'new-project',name:'Replacement',features:[]},settings:{}})};
  const outcome=await Promise.race([open(file).then(()=> 'open-complete'),new Promise(resolve=>setTimeout(()=>resolve('fence-deadlock'),250))]);
  assert.equal(outcome,'open-complete');
  assert.ok(order.indexOf('preservation-saved')<order.indexOf('fence-begin'),'active evidence must commit before new saves are fenced');
  assert.ok(order.indexOf('fence-release')<order.indexOf('project-persist:fence-false'),'replacement Project persistence runs only after releasing the transition fence');
  assert.deepEqual(order.slice(-2),['project-persist:fence-false','mutation-release']);
});

test('membership mutation failure releases the UI lock without restarting the arrival runtime',async()=>{
  const order=[],statuses=[],feature={id:'cp-1.2',name:'Deleted target',type:'checkpoint',day:1};
  const context={
    state:{selectedId:feature.id,project:{features:[feature]}},confirm:()=>true,
    acquireProjectMutation:()=>({release:()=>order.push('lock-release')}),
    activeRallySessionRecord:()=>({sessionId:'session-1',dayNumber:1}),
    suspendPendingEvidenceRuntime:async()=>{context.rallyScopeSuspended=true;order.push('suspend');},
    syncCurrentRallySessionProjection:()=>order.push('sync'),snapshot:()=>order.push('snapshot'),
    clearSelection:()=>order.push('clear-selection'),reconcileActiveProjectRallyMembership:()=>({sessionId:'session-1',activeObjectiveId:'cp-1.5'}),
    acceptedRallySessionId:'session-1',bindPendingEvidenceQueue:()=>order.push('bind'),
    persistProjectBeforeRallyScopeResume:async()=>{order.push('save');throw new Error('disk unavailable');},
    renderAll:()=>order.push('render'),setStatus:message=>statuses.push(message),rallyScopeSuspended:false
  };
  const remove=vm.runInNewContext(`(${asyncFunctionSource('deleteSelected')})`,context);
  await remove();
  assert.deepEqual(order,['suspend','sync','snapshot','clear-selection','bind','save','lock-release']);
  assert.equal(context.rallyScopeSuspended,true,'failed persistence leaves Rally safely fenced');
  assert.equal(context.state.project.features.length,0,'the in-memory change is not presented as durable or resumed');
  assert.match(statuses.at(-1),/runtime remains safely paused; reload CannonMap/i);
});

test('a Rally membership mutation restarts reliability only after its lock releases',()=>{
  const context={started:0,polls:0};
  vm.runInNewContext(`
    let rallyPollRestoreTimer=null,rallyRuntimeRestorePending=true,rallyScopeSuspended=false,projectMutationLock=null;
    const callbacks=[];
    const clearTimeout=()=>{};
    const setTimeout=callback=>{callbacks.push(callback);return callbacks.length;};
    const setStatus=()=>{};
    const state={settings:{rallyLivePollingEnabled:true},rallyLiveFeed:null};
    const currentRallySession=()=>({sessionId:'session-1',dayNumber:1});
    const acceptedRallySessionId='session-1';
    const showRallySessionChoice=()=>false,showDayPreflight=()=>false;
    const rallyDayState=()=>({status:'active'});
    const startRallyReliabilityServices=()=>{globalThis.started+=1;};
    let livePollController=null;
    const startRallyPolling=()=>{globalThis.polls+=1;livePollController={};};
    ${functionSource('restoreRallyPollingIntent')}
    ${functionSource('acquireProjectMutation')}
    const mutation=acquireProjectMutation('delete current checkpoint');
    restoreRallyPollingIntent();
    callbacks.shift()();
    if(!rallyRuntimeRestorePending)throw new Error('restore intent was lost while the lock was held');
    mutation.release();
    callbacks.shift()();
  `,context);
  assert.equal(context.started,1);
  assert.equal(context.polls,1);
});

test('stale prior-target IDs are verified against current executable day membership everywhere',()=>{
  for(const name of ['preserveIncompletePhotoEvidence','failPendingPhotoObjective','processDetectedCheckpointArrival']){
    const source=functionSource(name);assert.match(source,/verifiedOutOfOrderPriorTarget\(dayCheckpoints\(\),checkpoint/);
    assert.doesNotMatch(source,/state\.project\.features\.find\(feature=>feature\.id===priorTargetId/);
  }
  const pending=functionSource('activePendingEvidenceEntries');assert.match(pending,/executableIds/);assert.match(pending,/\.filter\(entry=>executableIds\.has/);
});

test('manual Day backup reports stages and distinguishes verified bytes from a requested browser download',()=>{
  const backup=functionSource('exportDayBackupPackage'),context=functionSource('backupRuntimeDiagnosticContext'),cameraContext=functionSource('cameraRuntimeDiagnosticContext');
  for(const field of ['attemptId','stage','attemptDurationMs','stageDurationMs','outputRoute'])assert.ok(backup.includes(field),`backup diagnostics include ${field}`);
  assert.match(context,/cameraRuntimeDiagnosticContext\(\)/);
  for(const field of ['userActivationActive','checkpointCaptureActive','backupPendingSessionCount','backupTrailingSessionCount','backupExactQueuedSessionCount','backupProviderPending'])assert.ok(context.includes(field),`backup runtime diagnostics include ${field}`);
  for(const field of ['visibilityState','storageUsageBytes','storageQuotaBytes'])assert.ok(cameraContext.includes(field),`shared runtime diagnostics include ${field}`);
  assert.match(backup,/backup_status_persist_failed/);
  assert.match(backup,/Promise\.allSettled/);
  assert.match(backup,/bytesReopenedAndVerified:true/);
  assert.match(backup,/downloadCommitVerified:false/);
  assert.match(backup,/Confirm \$\{file\.filename\} appears in Samsung Downloads/);
  assert.doesNotMatch(backup,/Day backup failed verification\. Your ride data/,'non-verification failures are no longer mislabeled');
});
