import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const gpsFollow=readFileSync(new URL('../src/application/gps-follow-controller.js',import.meta.url),'utf8');

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

const occurrences=(source,needle)=>source.split(needle).length-1;

test('manual competitor sync is fenced by Project and poll generation at every async boundary',()=>{
  const capture=functionSource('rallyPollScope');
  const matches=functionSource('rallyPollScopeMatches');
  const sync=functionSource('syncRallyFeed');
  assert.match(capture,/generation:rallyPollGeneration/);
  assert.match(capture,/projectId:String\(state\.project\.projectId\|\|''\)/);
  assert.match(matches,/scope\.generation===rallyPollGeneration/);
  assert.match(matches,/scope\.projectId===String\(state\.project\.projectId\|\|''\)/);
  assert.match(matches,/!rallyScopeSuspended/);

  const fetchAt=sync.indexOf('await fetchRallyFeedSnapshot'),guardAt=sync.indexOf('if(!rallyPollScopeMatches(scope))',fetchAt),applyAt=sync.indexOf('await applyRallyFeedSnapshot',guardAt);
  assert.ok(fetchAt>=0&&guardAt>fetchAt&&applyAt>guardAt,'a completed request must be scope-checked before applying its snapshot');
  assert.match(sync,/applyRallyFeedSnapshot\(incoming,\{announce,scope\}\)/);
  assert.ok(occurrences(sync,'rallyPollScopeMatches(scope)')>=3,'success, error, and completion paths must all be scope fenced');
});

test('official competitor callbacks retain their creation scope and coalesce snapshots before rendering',()=>{
  const start=functionSource('startRallyPolling');
  const queue=functionSource('queueOfficialRallySnapshot');
  const apply=functionSource('applyRallyFeedSnapshot');
  assert.match(start,/const scope=\{generation:\+\+rallyPollGeneration,projectId:String\(state\.project\.projectId\|\|''\)\}/);
  assert.match(start,/feed\.on\('snapshot',payload=>queueOfficialRallySnapshot\(payload,scope\)\)/);
  assert.match(start,/feed\.on\('error',detail=>\{if\(!rallyPollScopeMatches\(scope\)\)return/);
  assert.match(start,/await feed\.start\(\);\s*if\(!rallyPollScopeMatches\(scope\)\)\{feed\.stop\(\);return/);

  assert.match(queue,/if\(!rallyPollScopeMatches\(scope\)\)return false/);
  const replaceAt=queue.indexOf('rallyOfficialPendingSnapshot={payload,scope}'),reuseAt=queue.indexOf('if(rallyOfficialSnapshotTimer!==null)return true'),timerAt=queue.indexOf('setTimeout');
  assert.ok(replaceAt>=0&&reuseAt>replaceAt&&timerAt>reuseAt,'a burst must retain only its newest snapshot and reuse one batching timer');
  assert.match(queue,/1000-\(Date\.now\(\)-rallyOfficialLastAppliedAt\)/);
  assert.match(queue,/if\(!pending\|\|!rallyPollScopeMatches\(pending\.scope\)\)return/);
  assert.match(queue,/applyRallyFeedSnapshot\(officialSnapshotCompetitors\(pending\.payload\),\{scope:pending\.scope\}\)/);
  assert.doesNotMatch(queue,/renderMapFeatures|renderCompetitorSummary/,'Firebase callbacks must not render independently of the batched apply');
  assert.equal(occurrences(apply,'renderMapFeatures()'),0,'a Trail snapshot must not reconcile every static map feature');
  assert.equal(occurrences(apply,'renderCompetitors()'),1);
  assert.equal(occurrences(apply,'renderCompetitorSummary()'),1);
  assert.equal(occurrences(apply,'updateStationaryDetection()'),1,'a Trail snapshot must run stationary detection at most once');
  assert.match(apply,/if\(result\.added>0\)\{updateStationaryDetection\(\);state\.rallySync\.lastSync=state\.rallySync\.lastSnapshotAt/,'duplicate metadata snapshots must not refresh observation freshness');
});

test('competitor persistence is coalesced to 30-60 seconds and lifecycle stops drain all timers',()=>{
  const scheduler=functionSource('ensureLivePollWriteScheduler');
  const apply=functionSource('applyRallyFeedSnapshot');
  const clearBatch=functionSource('clearOfficialRallySnapshotBatch');
  const startHealth=functionSource('startRallyPollHealth');
  const stopHealth=functionSource('stopRallyPollHealth');
  const stop=functionSource('stopRallyPolling');
  assert.match(scheduler,/delayMs:30000/);
  assert.match(scheduler,/maxWaitMs:60000/);
  assert.match(apply,/ensureLivePollWriteScheduler\(\)\.markDirty\('competitor-feed'\)/);
  assert.doesNotMatch(apply,/saveProject\(/,'individual live snapshots must not synchronously persist the whole Project');

  assert.match(clearBatch,/clearTimeout\(rallyOfficialSnapshotTimer\)/);
  assert.match(clearBatch,/rallyOfficialSnapshotTimer=null/);
  assert.match(clearBatch,/rallyOfficialPendingSnapshot=null/);
  assert.match(startHealth,/rallyPollHealthTimer=setInterval/);
  assert.match(startHealth,/if\(!rallyPollScopeMatches\(scope\)\|\|state\.settings\.rallyLivePollingEnabled!==true\)return/);
  assert.match(stopHealth,/clearInterval\(rallyPollHealthTimer\)/);
  assert.match(stopHealth,/rallyPollHealthTimer=null/);
  assert.match(stopHealth,/rallyOfficialHealthRefreshAt=0/);
  assert.match(stop,/rallyPollGeneration\+\+/);
  assert.match(stop,/rallyManualSyncController\?\.abort/);
  assert.match(stop,/clearOfficialRallySnapshotBatch\(\);stopRallyPollHealth\(\)/);
  assert.match(stop,/livePollWriteScheduler\?\.stop\?\.\(\{flush:true\}\)/);
  assert.match(stop,/livePollWriteScheduler=null/);
});

test('page lifecycle flushes pending competitor writes without creating duplicate poll ownership',()=>{
  assert.match(app,/window\.addEventListener\('pagehide',[\s\S]*?livePollWriteScheduler\?\.flush\?\.\('pagehide'\)/);
  const pageshow=(app.match(/window\.addEventListener\('pageshow',[\s\S]*?\},\{passive:true\}\);/)||[])[0]||'';
  const online=(app.match(/window\.addEventListener\('online',[\s\S]*?\},\{passive:true\}\);/)||[])[0]||'';
  assert.match(pageshow,/restoreRallyPollingIntent\(\)/);
  assert.match(online,/state\.settings\.rallyLivePollingEnabled/);
  assert.match(online,/restoreRallyPollingIntent\(\)/);
  assert.doesNotMatch(pageshow,/startRallyPolling\(/,'page restoration must pass through the idempotent intent owner');
  assert.doesNotMatch(online,/startRallyPolling\(/,'network restoration must pass through the idempotent intent owner');
});

test('GPS stall detection respects page visibility and avoids per-fix UI/debug amplification',()=>{
  const initialize=functionSource('initializeGpsWatchdog');
  const position=functionSource('handleGpsPosition');
  const watchState=functionSource('handleGpsWatchState');
  assert.match(initialize,/visible:\(\)=>document\.visibilityState==='visible'/);
  assert.equal(occurrences(position,'renderRallyMode()'),1,'one accepted GPS fix should request at most one Rally render');
  assert.doesNotMatch(position,/rallyDebug\.record\(/,'routine GPS fixes must not synchronously append the bounded debug log');
  const keyAt=watchState.indexOf('const uiKey='),returnAt=watchState.indexOf('if(uiKey===lastGpsWatchUiKey)return'),renderAt=watchState.indexOf('renderRallyMode()');
  assert.ok(keyAt>=0&&returnAt>keyAt&&renderAt>returnAt,'unchanged watchdog health emissions must return before touching the UI');

  const updateAt=gpsFollow.indexOf('update(position,{targetZoom:requestedZoom,zoomReason}={}){');
  const nextMethodAt=gpsFollow.indexOf('setTargetZoom(',updateAt);
  assert.ok(updateAt>=0&&nextMethodAt>updateAt,'GPS follow update method must remain inspectable');
  const update=gpsFollow.slice(updateAt,nextMethodAt);
  assert.doesNotMatch(update,/\blog\(/,'routine follow updates must not create a debug record per GPS fix');
  assert.match(gpsFollow,/recordCompletion:false/,'routine GPS recentering must suppress programmatic-map completion logging');
});

test('repeated GPS readiness actions never toggle off an acquiring or reconnecting watch',()=>{
  const initialize=functionSource('initializeRallyDayPreflight');
  const start=functionSource('startGps');
  assert.match(initialize,/const watch=gpsWatchdog\?\.state\?\.\(\),desired=watch\?\.desired===true/);
  assert.match(initialize,/return \{active:desired,fixReceived:/);
  const desiredAt=start.indexOf("priorWatch?.desired&&priorWatch.status!=='blocked'");
  const ensureAt=start.indexOf('if(preflightAction){gpsWatchdog?.checkNow?.();return priorWatch;}',desiredAt);
  const stopAt=start.indexOf('stopGpsTracking();return;',desiredAt);
  assert.ok(desiredAt>=0&&ensureAt>desiredAt&&stopAt>ensureAt,'preflight must reuse/check the desired watch before any toggle-off path');
});

test('Rally reliability health owns one foreground timer and tears it down with the session',()=>{
  const start=functionSource('startRallyReliabilityServices');
  const stop=functionSource('stopRallyReliabilityServices');
  assert.match(start,/if\(reliabilityHealthTimer===null\)reliabilityHealthTimer=setInterval/);
  assert.match(start,/document\.visibilityState==='visible'/);
  assert.match(start,/runReliabilityHealthCheck\(\{force:true\}\)/);
  assert.match(start,/RELIABILITY_HEALTH_INTERVAL_MS/);
  assert.match(stop,/if\(reliabilityHealthTimer!==null\)clearInterval\(reliabilityHealthTimer\)/);
  assert.match(stop,/reliabilityHealthTimer=null/);
  assert.match(app,/visibilitychange[\s\S]*?runReliabilityHealthCheck\(\{force:true\}\)/);
  assert.match(app,/pageshow[\s\S]*?runReliabilityHealthCheck\(\{force:true\}\)/);
});
