import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../app.css',import.meta.url),'utf8');

test('adaptive navigation reads CannonMap line geometry and guards every application map move',()=>{
  const navigation=app.slice(app.indexOf('function activeNavigationLine()'),app.indexOf('async function processDetectedCheckpointArrival'));
  assert.match(navigation,/geometry\?\.kind==='line'/);
  assert.doesNotMatch(navigation,/geometry\?\.type==='LineString'/);
  const unguarded=app.split(/\r?\n/).filter(line=>/state\.map\.(?:setView|fitBounds)\(/.test(line)&&!line.includes('performProgrammaticMapChange'));
  assert.deepEqual(unguarded,[],'application map moves must not masquerade as manual zoom gestures');
  const animated=app.split(/\r?\n/).filter(line=>/performProgrammaticMapChange\([^\n]+state\.map\.(?:setView|fitBounds)\(/.test(line)&&!line.includes('animate:false'));
  assert.deepEqual(animated,[],'guarded Leaflet moves must remain synchronous so zoomstart occurs inside the guard');
  assert.match(app,/function fitMap\(\)\s*\{\s*return performProgrammaticMapChange\('fit-map',[\s\S]*?mapEngine\.fitLayerType\('features',[\s\S]*?animate:false/);
  assert.match(app,/function fitIntelligence\(\)\s*\{\s*return performProgrammaticMapChange\('fit-intelligence',[\s\S]*?mapEngine\.fitLayerTypes\([\s\S]*?animate:false/);
});

test('Wake Lock resumes with an active GPS watch after day and page restoration',()=>{
  assert.match(app,/if\(state\.gpsWatchId!==null\)void screenWakeLock\?\.start\('day-started'\)/);
  assert.match(app,/addEventListener\('pageshow',[^\n]+state\.gpsWatchId!==null[^\n]+screenWakeLock\?\.start\('page-restored'\)/);
});

test('camera readiness is device-local and cannot mutate portable project settings at startup',()=>{
  assert.match(app,/const CAMERA_SETUP_HINT_KEY = 'cannonmap\.camera-setup-succeeded\.v1'/);
  assert.match(app,/priorSetupSucceeded:cameraSetupHint\(\)/);
  assert.match(app,/persistSetupSucceeded:persistCameraSetupHint/);
  assert.doesNotMatch(app,/state\.settings\.cameraSetupSucceededAt/);
  const persistence=app.slice(app.indexOf('function persistCameraSetupHint'),app.indexOf('function initializeCameraReadiness'));
  assert.match(persistence,/localStorage\.(?:setItem|removeItem)/);
  assert.doesNotMatch(persistence,/saveProject|state\.project|state\.settings/);
});

test('camera setup gates active Rally GPS without blocking Planner GPS',()=>{
  const startGps=app.slice(app.indexOf('function startGps('),app.indexOf('function stopGps('));
  assert.match(startGps,/if\(activeRallyDay\(\)&&showDayPreflight\(\)&&!preflightAction\)/);
  assert.match(startGps,/activeDayNeedsSetup=Boolean\(rallyDay&&rallyDayState\(rallyDay\)\.status!==['"]complete['"]&&!restoredDayReview\)/);
  assert.match(startGps,/if\(activeDayNeedsSetup&&cameraSetupRequired\(\)&&!cameraSetupDismissed&&!preflightAction\)/);
  assert.match(startGps,/const preflightAction=options\?\.preflightAction===true/);
});

test('only native camera-stage failures revoke automatic camera readiness',()=>{
  assert.match(app,/isNativeCameraCaptureFailure\(error\).*noteCaptureFailure/);
  assert.doesNotMatch(app,/!\(error instanceof AutomaticCameraNotReadyError\).*noteCaptureFailure/);
  assert.match(app,/failureStage:'pair-finalization'/);
  const automationLog=app.slice(app.indexOf('async function recordMediaAutomationEvent'),app.indexOf('async function captureAutomaticPair'));
  assert.match(automationLog,/try\{[\s\S]*await appendRallyJournalEvent[\s\S]*catch\(error\)[\s\S]*camera_automation_journal_failed/);
});

test('Samsung landscape uses one shallow top bar and independent glove-safe edge controls',()=>{
  assert.match(css,/\.rally-top-bar\{[\s\S]*?height:98px;[\s\S]*?grid-template-columns:minmax\(150px,19vw\) minmax\(0,1fr\) 58px/);
  assert.match(css,/\.rally-head\{position:static;display:contents\}/);
  assert.match(css,/\.rally-primary-card\{[\s\S]*?grid-column:2;[\s\S]*?grid-template-areas:[\s\S]*?"notes notes notes notes"/);
  assert.match(css,/\.rally-score-slot\{[\s\S]*?grid-column:3;[\s\S]*?border-left:1px solid #92400e/);
  assert.match(css,/\.rally-actions\{position:static;display:contents;pointer-events:none\}/);
  assert.match(css,/\.rally-actions button\{[\s\S]*?width:72px;[\s\S]*?height:68px/);
  assert.match(css,/\.rally-recenter-fab\{[\s\S]*?width:52px;[\s\S]*?height:52px/);
  assert.match(css,/\.leaflet-control-layers\{display:none!important\}/);
  assert.doesNotMatch(css,/Samsung mounted Rally Mode:[\s\S]*?grid-template-columns:repeat\(4/);
});
