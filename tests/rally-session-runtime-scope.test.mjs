import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

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

test('GPS fixes cannot activate objectives or record execution telemetry before the session and preflight are accepted',()=>{
  const gps=functionSource('startGps'),telemetry=functionSource('recordRallyTelemetry'),evaluation=functionSource('evaluateCheckpointArrival');
  assert.doesNotMatch(gps,/\n\s*ensureNextCheckpoint\(\);/,'the raw GPS callback delegates objective activation to the gated arrival path');
  assert.match(gps,/evaluateCheckpointArrival\(accuracyFeet\)/);
  assert.match(evaluation,/showRallySessionChoice\(\)\|\|!currentRallySession\(\)\|\|acceptedRallySessionId!==currentRallySessionId\(\)/);
  assert.match(evaluation,/showDayPreflight\(\)/);
  for(const gate of ['acceptedRallySessionId!==session.sessionId','analyticsExecutionSessionId!==session.sessionId','rallyScopeSuspended','showRallySessionChoice()','showDayPreflight()'])assert.ok(telemetry.includes(gate),`telemetry must require ${gate}`);
});

test('opening a Project cannot attach administrative Journal events to an unaccepted historical session',()=>{
  const append=functionSource('appendRallyJournalEvent'),switchProject=functionSource('switchProject');
  assert.match(append,/acceptedRallySessionId===session\.sessionId&&metadata\.sessionScope!==false/);
  assert.match(switchProject,/appendRallyJournalEvent\('project_opened',null,[\s\S]*sessionScope:false/);
});

test('incidental saves and expiry checks cannot mutate a suspended session before Resume is accepted',()=>{
  const sync=functionSource('syncCurrentRallySessionProjection'),release=functionSource('releaseExpiredPendingEvidence'),proceed=functionSource('proceedFromDayPreflight');
  assert.match(sync,/if\(acceptedRallySessionId!==session\.sessionId\)return session/);
  assert.match(release,/acceptedRallySessionId!==session\.sessionId\|\|showRallySessionChoice\(\)\|\|showDayPreflight\(\)\|\|rallyScopeSuspended/);
  assert.match(proceed,/await releaseExpiredPendingEvidence\(\);await saveProject/,'durable expiry replay begins only after the rider accepts the readiness gate');
});

test('session changes invalidate cross-run Undo and hotel-bailout state',()=>{
  for(const name of ['startNewRallySession','resumeExistingRallySession']){
    const source=functionSource(name);assert.match(source,/state\.history=\[\]/);assert.match(source,/state\.hotelBailoutActive=false/);assert.match(source,/hotelBailoutUndo=null/);
  }
  const reset=functionSource('resetRallySessionSelection');assert.match(reset,/state\.history=\[\]/);assert.match(reset,/hotelBailoutUndo=null/);
});

test('hotel bailout has a dedicated same-session undo instead of consuming an unrelated global snapshot',()=>{
  const bailout=functionSource('goToHotel'),undo=functionSource('undoHotelBailout'),toggle=functionSource('toggleHotelBailout');
  assert.doesNotMatch(bailout,/snapshot\(\)/);assert.match(bailout,/hotelBailoutUndo=\{projectId:/);
  assert.match(undo,/undoState\.sessionId!==session\?\.sessionId/);assert.match(undo,/checkpoint\.deferredAt!==undoState\.transitionAt/);assert.match(undo,/hotel_bailout_undone/);
  assert.match(toggle,/undoHotelBailout\(\)/);assert.doesNotMatch(toggle,/return undo\(\)/);
});

test('photo gallery and Evidence retry remain scoped to one immutable rally session',()=>{
  const viewer=functionSource('openPhotoViewer'),retry=functionSource('retryFailedEvidence'),matcher=functionSource('journalEventMatchesSession');
  assert.match(matcher,/event\?\.sessionId\|\|event\?\.metadata\?\.sessionId/);
  assert.match(viewer,/allRecords\.filter\(record=>journalEventMatchesSession\(record,selectedSession\)\)/);
  assert.match(viewer,/item\.sessionId\|\|'legacy'/,'same checkpoint IDs from different runs use separate gallery groups');
  assert.match(retry,/missionMedia\.listProjectPhotos\(state\.project\.projectId\)/);assert.match(retry,/journalEventMatchesSession\(item,session\)/);
});

test('project replacement rebinds analytics persistence instead of retaining a closed prior-project scope',()=>{
  const initialize=functionSource('initializeRallyAnalytics'),release=functionSource('releaseRallyAnalyticsProjectScope'),bind=functionSource('bindRallyAnalyticsToActiveProject'),switchProject=functionSource('switchProject'),refresh=functionSource('refreshRideExportSource'),start=functionSource('startRallyAnalytics'),startInternal=functionSource('startRallyAnalyticsInternal');
  assert.match(initialize,/activeLifecycleProjectId===state\.project\.projectId/);
  assert.match(release,/stopRallyAnalytics\(reason\)/);assert.match(bind,/initializeRallyAnalytics\(\)/);
  assert.ok(switchProject.indexOf("releaseRallyAnalyticsProjectScope('project-switch')")<switchProject.indexOf('projectLifecycle.openProject(projectId)'),'old analytics flushes before its repository scope closes');
  assert.ok(switchProject.indexOf('projectLifecycle.openProject(projectId)')<switchProject.indexOf('bindRallyAnalyticsToActiveProject()'));
  assert.match(bind,/refreshRideExportSource\(\)/);assert.match(refresh,/analytics:rallyAnalytics/,'Ride export snapshots follow the rebound analytics service');
  assert.match(start,/enqueueRallyAnalyticsTransition/,'overlapping Run A/Run B starts are serialized');
  assert.match(startInternal,/result\.executionSessionId!==requestedSessionId/,'the analytics service must prove it opened the requested immutable session');
  assert.match(startInternal,/quarantineRallyAnalytics\('session-identity-mismatch'/);
});

test('active Day restore drains lifecycle caches and installs the durable restored session before later saves',()=>{
  assert.match(app,/createJourneyPackageRestoreService\(\{repository:createJourneyRestoreRepository\(\{database:foundationDatabase\}\),projectLifecycle\}\)/);
  const restore=functionSource('restoreDayBackupPackage');
  assert.ok(restore.indexOf("releaseRallyAnalyticsProjectScope('day-backup-restore')")<restore.indexOf('journeyRestore.restoreDay(file'),'analytics must flush before the active repository scope is drained');
  assert.ok(restore.indexOf('journeyRestore.restoreDay(file')<restore.indexOf('projectLifecycle.getActiveProject()'));
  assert.match(restore,/state\.project=sanitizeProjectData\(refreshedProject,'restored Day refresh'\)/);
  assert.match(restore,/rallyExecution\(\);resetRallySessionSelection\(\);await bindRallyAnalyticsToActiveProject\(\)/);
  const recovery=restore.slice(restore.indexOf('finally{'));
  assert.match(recovery,/projectLifecycle\.getActiveProject\(\)/,'a committed restore is reloaded even when post-write verification throws');
  assert.match(recovery,/state\.project=sanitizeProjectData\(refreshedProject,'Day restore recovery refresh'\)/);
  assert.doesNotMatch(restore,/failed without partial changes/,'post-write verification failures cannot claim that durable data was rolled back');
});

test('portable planning files and named snapshots cannot erase durable rally-session history',()=>{
  const planning=functionSource('planningOnlyPortableProject'),portableSettings=functionSource('planningOnlyPortableSettings'),preserveSettings=functionSource('preserveRallyExecutionSettings'),portableExport=functionSource('exportProjectFile'),portableOpen=functionSource('openProjectFile'),preserve=functionSource('preserveRallyExecutionHistory'),snapshotRestore=functionSource('restoreSnapshot');
  assert.match(planning,/delete copy\.rallyExecution/);
  assert.match(planning,/CHECKPOINT_EXECUTION_FIELDS/);
  assert.match(portableExport,/planningOnlyPortableProject\(state\.project/);
  assert.match(portableExport,/planningOnlyPortableSettings\(state\.settings\)/);
  assert.match(portableOpen,/planningOnlyPortableProject\(portable\.project/);
  assert.match(portableOpen,/planningOnlyPortableSettings\(portable\.settings\|\|\{\}\)/);
  assert.match(portableOpen,/state\.settings=Object\.assign\(\{\},planningOnlyPortableSettings\(defaultProjectSettings\|\|state\.settings\)/,'both the default baseline and portable settings are stripped of prior execution state');
  assert.match(portableOpen,/restoredDayReview=null/);
  assert.match(portableOpen,/collision\?uid\(\):requestedProjectId/,'same-ID portable imports become an independent Project instead of overwriting execution history');
  assert.match(portableSettings,/RALLY_EXECUTION_SETTING_KEYS/);
  assert.match(preserve,/restored\.rallyExecution=deepClean\(current\.rallyExecution\)/);
  assert.match(preserve,/CHECKPOINT_EXECUTION_FIELDS/);
  assert.match(snapshotRestore,/preserveRallyExecutionHistory\(deepClean\(item\.project\),state\.project\)/);
  assert.match(preserveSettings,/RALLY_EXECUTION_SETTING_KEYS/);
  assert.match(snapshotRestore,/preserveRallyExecutionSettings\(item\.settings,state\.settings\)/);
});

test('scope suspension drains every durable Rally write class before Project replacement',()=>{
  const append=functionSource('appendRallyJournalEvent'),suspend=functionSource('suspendPendingEvidenceRuntime'),journey=functionSource('requestJourneyPhoto');
  assert.match(append,/activeJournalWrites\.add\(writeMarker\)/);
  assert.match(append,/finally\{activeJournalWrites\.delete\(writeMarker\);settleWrite\(\);\}/);
  for(const seam of ['priorArrivalCoordinator?.whenIdle?.()','priorReconciliationTask','priorMediaRecoveryTask','priorManualFallbackExpiryTask','priorCheckpointCompletionTask','priorAnalyticsTransition','priorRallyMutationDrain','priorJournalWrites'])assert.ok(suspend.includes(seam),`suspension must drain ${seam}`);
  assert.doesNotMatch(journey,/await beginManualFallback\(/,'optional Journey fallback cannot hold a Project transition open while waiting for the rider');
});
