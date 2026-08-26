import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');

function functionSource(name,{async=false}={}){
  const marker=`${async?'async ':''}function ${name}(`,start=app.indexOf(marker);assert.notEqual(start,-1,`${name} must exist`);
  const parameters=app.indexOf('(',start);let parameterDepth=0,parameterQuote=null,parameterEscaped=false,opening=-1;
  for(let index=parameters;index<app.length;index+=1){
    const character=app[index];
    if(parameterQuote){if(parameterEscaped)parameterEscaped=false;else if(character==='\\')parameterEscaped=true;else if(character===parameterQuote)parameterQuote=null;continue;}
    if(character==='\''||character==='"'||character==='`'){parameterQuote=character;continue;}
    if(character==='(')parameterDepth+=1;else if(character===')'&&--parameterDepth===0){opening=app.indexOf('{',index);break;}
  }
  assert.notEqual(opening,-1,`${name} must have a body`);let depth=0,quote=null,escaped=false;
  for(let index=opening;index<app.length;index+=1){
    const character=app[index];
    if(quote){if(escaped)escaped=false;else if(character==='\\')escaped=true;else if(character===quote)quote=null;continue;}
    if(character==='\''||character==='"'||character==='`'){quote=character;continue;}
    if(character==='{')depth+=1;else if(character==='}'&&--depth===0)return app.slice(start,index+1);
  }
  throw new Error(`${name} has no closing brace`);
}

function persistedDayBackupStatus({backup,progress}){
  const session={sessionId:'session-1',dayNumber:1,runNumber:1};
  const state={settings:{mediaBackups:{'session-1':backup},mediaBackupProgress:{'session-1':progress}}};
  const source=`(()=>{${functionSource('dayBackupProgressKey')}\n${functionSource('dayBackupStatus')}\nreturn dayBackupStatus(1);})()`;
  return vm.runInNewContext(source,{state,activeRallyDay:()=>1,currentRallySession:()=>session});
}

async function renderedCompletedSessionStatus(backup){
  const elements={rallyStorageSummary:{innerHTML:''},rallyProjectSelect:{innerHTML:''},rallyUnbackedDays:{textContent:''}};
  const state={project:{projectId:'project-1',name:'Project'},settings:{mediaBackups:backup?{'session-1':backup}:{},lastMediaExportAt:'2026-08-26T21:41:07.224Z'}};
  const estimate={actualUsageBytes:1024,actualQuotaBytes:4096,preferredMissionMediaBudgetBytes:2048,projectPhotoCount:2,pairCount:1,projectMediaSize:1024,estimatedRemainingCapturePairs:10,persistence:{status:'granted'},unresolvedFailures:0,warningLevel:'normal'};
  const context={
    missionStorage:{estimate:async()=>estimate},projectLifecycle:{listProjects:async()=>[]},state,
    $:id=>elements[id]||null,rallyExecution:()=>({sessions:{'session-1':{sessionId:'session-1',dayNumber:1,runNumber:1,status:'completed'}}}),
    RALLY_SESSION_STATUS:{COMPLETED:'completed'},formatStorageBytes:value=>`${value} B`,formatPreferredMissionMediaBudget:value=>`${value} B`,escapeHtml:value=>String(value)
  };
  const render=vm.runInNewContext(`(${functionSource('renderStorageAndProjects',{async:true})})`,context);
  await render();
  return elements.rallyUnbackedDays.textContent;
}

test('browser Day package persistence says verified and download requested, never device-write complete',()=>{
  const backup={artifactKind:'browser-download-package',packageBytesVerified:true,downloadRequestedAt:'2026-08-26T21:41:07.224Z',downloadCommitVerified:false};
  const status=persistedDayBackupStatus({backup,progress:{packageRequested:'2026-08-26T21:41:07.224Z'}});
  assert.match(status,/package verified/i);
  assert.match(status,/confirm.+download/i);
  assert.doesNotMatch(status,/backup complete|package exported/i);

  const legacyStatus=persistedDayBackupStatus({backup:{completedAt:'2026-08-26T21:41:07.224Z',filename:'Day01_Backup.cmapday.zip'},progress:{package:'2026-08-26T21:41:07.224Z'}});
  assert.match(legacyStatus,/confirm.+download/i,'a reload must not promote an older browser-download bookkeeping record to a verified device write');
  assert.doesNotMatch(legacyStatus,/backup complete|package exported/i);
});

test('external incremental generation remains a completed verified backup status',()=>{
  const status=persistedDayBackupStatus({
    backup:{artifactKind:'external-folder-generation',externalLayout:'incremental-files',bytesReopenedAndVerified:true,completedAt:'2026-08-26T21:41:07.224Z'},
    progress:{externalGeneration:'2026-08-26T21:41:07.224Z'}
  });
  assert.equal(status,'External folder generation verified');
});

test('completed-session warning ignores an unconfirmed browser download but accepts verified external bytes',async()=>{
  const browserStatus=await renderedCompletedSessionStatus({artifactKind:'browser-download-package',packageBytesVerified:true,downloadRequestedAt:'2026-08-26T21:41:07.224Z',downloadCommitVerified:false});
  assert.match(browserStatus,/Unbacked sessions: Day 1 Run 1/);

  const externalStatus=await renderedCompletedSessionStatus({artifactKind:'external-folder-generation',externalLayout:'incremental-files',bytesReopenedAndVerified:true,completedAt:'2026-08-26T21:41:07.224Z'});
  assert.doesNotMatch(externalStatus,/Unbacked sessions/);
  assert.match(externalStatus,/Last successful export/);

  const confirmedBrowserStatus=await renderedCompletedSessionStatus({artifactKind:'browser-download-package',packageBytesVerified:true,downloadRequestedAt:'2026-08-26T21:41:07.224Z',downloadCommitVerified:true});
  assert.doesNotMatch(confirmedBrowserStatus,/Unbacked sessions/);
});

test('browser and external Day backup completion events have distinct truth semantics',()=>{
  const backup=functionSource('exportDayBackupPackage',{async:true}),browserStart=backup.indexOf("outputRoute='browser-download'"),catchStart=backup.indexOf('}catch(error)',browserStart);
  assert.notEqual(browserStart,-1);assert.notEqual(catchStart,-1);
  const external=backup.slice(0,browserStart),browser=backup.slice(browserStart,catchStart);
  assert.match(external,/artifactKind:'external-folder-generation'/);
  assert.match(external,/bytesReopenedAndVerified:true/);
  assert.match(external,/backup_completed/);
  assert.match(browser,/artifactKind:'browser-download-package'/);
  assert.match(browser,/packageBytesVerified:true/);
  assert.match(browser,/downloadCommitVerified:false/);
  assert.match(browser,/day_backup_download_requested/);
  assert.match(browser,/backup_package_verified_download_requested/);
  assert.match(browser,/markDayBackupProgress\(day,'packageRequested'/);
  assert.doesNotMatch(browser,/completedAt:/);
  assert.doesNotMatch(browser,/day_backup_exported/);
  assert.doesNotMatch(browser,/backup_completed/);
});

test('backup diagnostics expose all automatic-backup queue states',()=>{
  const source=functionSource('backupRuntimeDiagnosticContext');
  for(const field of ['backupPendingSessionCount','backupTrailingSessionCount','backupExactQueuedSessionCount','backupProviderPending'])assert.ok(source.includes(field),`backup diagnostics include ${field}`);
  for(const stateField of ['pendingSessions','trailingSessions','exactQueuedSessions','providerPending'])assert.ok(source.includes(stateField),`backup diagnostics read scheduler.${stateField}`);
});
