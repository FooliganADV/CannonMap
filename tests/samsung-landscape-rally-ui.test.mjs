import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const read=file=>readFile(new URL(`../${file}`,import.meta.url),'utf8');
const [html,css,app,presenter,controller]=await Promise.all([
  read('index.html'),read('app.css'),read('app.js'),read('src/ui/rally/presenter.js'),read('src/ui/rally/controller.js')
]);

test('Samsung Rally presentation composes project, objective, score, and recovery into one top bar',()=>{
  const top=html.match(/<div class="rally-top-bar">[\s\S]*?<\/div>\s*<section id="rallyDeferredPrompt"/)?.[0]||'';
  for(const id of ['rallyActiveProjectName','rallyDay','rallyGpsAccuracy','rallyOnlineStatus','rallyNextName','rallyNavigationGuidance','rallyNextDistance','rallyObjectiveStatus','rallyCompleteButton','rallyDeferIcon','rallyScore'])assert.match(top,new RegExp(`id="${id}"`),`${id} stays in the Rally bar`);
  assert.equal((html.match(/id="rallyScore"/g)||[]).length,1,'score has one authoritative presentation');
  assert.equal((html.match(/id="rallyCompleteButton"/g)||[]).length,1,'PHOTO keeps the existing completion/recovery action');
  assert.match(css,/height:98px/);
  assert.doesNotMatch(top,/id="rallyRecenterFab"/,'GPS action remains a separate compact edge control');
});

test('mounted landscape has no bottom dock and exposes two deterministic edge stacks',()=>{
  const mounted=css.slice(css.indexOf('/* Samsung mounted Rally Mode'));
  assert.match(mounted,/\.rally-actions\{position:static;display:contents;pointer-events:none\}/);
  assert.match(mounted,/#rallyMissionButton\{left:[^}]+top:114px\}/);
  assert.match(mounted,/#rallyTrailIntelButton\{left:[^}]+top:188px\}/);
  assert.match(mounted,/#rallyJournalButton\{right:[^}]+top:114px\}/);
  assert.match(mounted,/#rallyMoreButton\{right:[^}]+top:188px\}/);
  assert.doesNotMatch(mounted,/\.rally-actions\{[^}]*bottom:/);
  assert.match(mounted,/\.rally-actions button\{[\s\S]*?width:72px;[\s\S]*?height:68px/);
});

test('GPS action remains operational and automatic capture only adds a presentation refresh',()=>{
  assert.match(html,/id="rallyRecenterFab"/);
  assert.match(controller,/rallyRecenterFab/);
  assert.match(app,/photoCaptureActive:Boolean\(next&&pendingPhotoCheckpointId===next\.id&&\(automaticCaptureAbortController\|\|cameraCaptureArbiter\?\.state\?\.\(\)\.currentKind==='checkpoint'\)\)/);
  assert.match(app,/automaticCaptureAbortController=controller;renderRallyMode\(\)/);
  assert.match(app,/automaticCaptureAbortController===controller\)automaticCaptureAbortController=null;renderRallyMode\(\)/);
  assert.match(presenter,/capturing\?'CAPTURING…'/);
  assert.match(presenter,/recovery==='CAPTURE PHOTO'\?'PHOTO'/);
  assert.match(presenter,/recovery==='RETRY EVIDENCE'\?'RETRY PHOTO'/);
  assert.doesNotMatch(presenter,/addEventListener\([^)]*rallyCompleteButton/,'presenter does not replace controller wiring');
});

test('long critical text remains accessible after visual truncation',()=>{
  for(const id of ['rallyActiveProjectName','rallyNextName','rallyNavigationGuidance','rallyRiderNotes'])assert.match(presenter,new RegExp(`setTitle\\('${id}'`));
  const mounted=css.slice(css.indexOf('/* Samsung mounted Rally Mode'));
  assert.match(mounted,/\.rally-primary-card strong\{[\s\S]*?font-size:1\.12rem/);
  assert.match(mounted,/\.rally-objective-distance\{[\s\S]*?text-overflow:ellipsis;[\s\S]*?white-space:nowrap/);
  assert.match(mounted,/#rallyRiderNotesSection p\{[\s\S]*?text-overflow:ellipsis;[\s\S]*?white-space:nowrap/);
});
