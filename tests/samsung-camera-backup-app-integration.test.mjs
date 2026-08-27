import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');

function functionSource(name){
  const marker=`function ${name}(`,start=app.indexOf(marker);assert.notEqual(start,-1,`${name} must exist`);
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

test('Samsung release-candidate identity and foreground camera recovery barrier are wired into the PWA',()=>{
  assert.match(app,/const APP_VERSION = '0\.7\.19'/);
  assert.match(app,/const BUILD_ID = '2026\.08\.27\.samsung-landscape-ui-1'/);
  const hidden=functionSource('backgroundCameraLifecycle'),visible=functionSource('resumeForegroundCameraLifecycle'),capture=functionSource('captureAutomaticPair');
  assert.match(hidden,/automaticCaptureAbortController\?\.abort/);
  assert.match(hidden,/cameraSession\?\.setVisibility\?\.\('hidden',reason\)/);
  assert.match(hidden,/cameraReadiness\?\.invalidateOperationalReadiness\?\.\(\{reason\}\)/);
  assert.ok(hidden.indexOf("setVisibility?.('hidden',reason)")<hidden.indexOf('invalidateOperationalReadiness'),'old camera ownership is torn down before operational readiness is invalidated');
  assert.match(visible,/cameraSession\?\.setVisibility\?\.\('visible',reason\)/);
  assert.match(visible,/cameraReadiness\?\.invalidateOperationalReadiness\?\.\(\{reason:'foreground-resume-camera-stale'\}\)/);
  assert.match(visible,/cameraReadiness\?\.inspect\?\.\(\{force:true,reason:'foreground-resume'\}\)/);
  assert.match(visible,/cycle!==foregroundCameraRecoveryCycle/);
  assert.match(visible,/readinessGeneration!==cameraReadiness\?\.operationalGeneration\?\.\(\)/);
  assert.match(visible,/camera_foreground_revalidation_superseded/);
  assert.match(capture,/cameraReadiness\?\.prepareCheckpointCapture\?\.\(\)/);
  assert.ok(capture.indexOf('prepareCheckpointCapture')<capture.indexOf('pairedMediaCapture.capturePair'),'checkpoint priority fences a readiness probe before opening the first production camera');
  assert.match(app,/visibilitychange[^\n]+gpsWatchdog\?\.checkNow\?\.\(\)[^\n]+resumeForegroundCameraLifecycle/);
  assert.match(app,/pageshow[^\n]+event\.persisted\|\|cameraLifecycleState==='hidden'[^\n]+resumeForegroundCameraLifecycle/);
  assert.match(app,/else cameraSession\?\.setVisibility\?\.\('visible','initial-page-show'\)/);
});

test('checkpoint fallback frame is retained as diagnostic Original and cannot become Evidence',()=>{
  const persist=functionSource('persistDegradedCameraCaptures'),capture=functionSource('captureAutomaticPair');
  assert.match(persist,/provenance\.nativeStill===true/);
  assert.match(persist,/provenance\.derivedFromVideoFrame!==true/);
  assert.match(persist,/captureType:'camera_diagnostic'/);
  assert.match(persist,/objectiveType:'camera_diagnostic'/);
  assert.match(persist,/evidenceRequired:false/);
  assert.match(persist,/diagnosticOnly:true/);
  assert.match(persist,/diagnosticPairId:workflow\.pairId/);
  const metadataStart=persist.indexOf('metadata:{'),metadataEnd=persist.indexOf('\n      });',metadataStart),metadata=persist.slice(metadataStart,metadataEnd);
  assert.doesNotMatch(metadata,/(?:^|[,\s])pairId:workflow\.pairId/);
  assert.match(persist,/nativeStill:false,derivedFromVideoFrame:true/);
  assert.match(persist,/missionMedia\.addOriginal/);
  assert.doesNotMatch(persist,/photoEvidence\.(?:capture|create)|addEvidence/);
  assert.match(capture,/persistDegradedCameraCaptures\(error,checkpoint,arrivalEvent,workflow\)/);
  assert.ok(capture.indexOf('persistDegradedCameraCaptures')<capture.indexOf('throw error'),'diagnostic persistence is attempted before evidence recovery receives the failure');
});

test('manual Day backup prefers bounded incremental folder output and gates large RAM ZIPs',()=>{
  const backup=functionSource('exportDayBackupPackage'),status=functionSource('dayBackupStatus');
  assert.match(backup,/listProjectSessionPhotoDescriptors/);
  assert.match(backup,/externalState\?\.status===EXTERNAL_BACKUP_STATUS\.READY/);
  assert.match(backup,/requestAutomaticBackup\(AUTOMATIC_BACKUP_TRIGGER\.MANUAL,\{waitForOwnRun:true\}\)/);
  assert.match(backup,/externalLayout:'incremental-files'/);
  assert.match(backup,/artifactKind:'external-folder-generation'/);
  assert.match(app,/objectiveType==='camera_diagnostic'\?'Camera Diagnostics'/);assert.match(app,/kind==='Camera Diagnostics'\?'Not required'/);
  assert.match(backup,/markDayBackupProgress\(day,'externalGeneration'/);
  assert.match(backup,/Internal recovery remains the direct restore path/);
  assert.match(status,/External folder generation verified/);
  assert.match(backup,/declaredBytes>MAX_SAFE_MANUAL_DAY_PACKAGE_BYTES/);
  assert.ok(backup.indexOf('requestAutomaticBackup')<backup.indexOf('photoExports.dayBackup'),'incremental external backup must be attempted before a legacy in-memory ZIP');
});

test('camera field diagnostics stay bounded and include mounted-phone runtime context',()=>{
  const record=functionSource('recordCameraDiagnostic'),context=functionSource('cameraRuntimeDiagnosticContext'),automation=functionSource('recordMediaAutomationEvent');
  for(const field of ['cannonMapVersion','buildId','serviceWorkerCacheId','visibilityState','wakeLockHeld','gpsWatchActive','gpsSampleAgeMs','gpsAccuracyFeet','speedMph','screenOrientation','storageUsageBytes','storageQuotaBytes'])assert.ok(context.includes(field),`diagnostic context must include ${field}`);
  assert.match(record,/rallyDebug\.record/);
  assert.match(automation,/event\.diagnosticOnly===true&&event\.journalImportant!==true/);
});
