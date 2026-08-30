import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const css=await readFile(new URL('../app.css',import.meta.url),'utf8');
const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
const workflow=await readFile(new URL('../.github/workflows/deploy-reconciliation-preview.yml',import.meta.url),'utf8');

test('Rally navigation is Mission, Trail Intel, Journal, and More while Planner remains deliberate',()=>{
  const nav=html.match(/<nav class="rally-actions"[\s\S]*?<\/nav>/)?.[0]||'';
  assert.match(nav,/>MISSION</);assert.match(nav,/>TRAIL INTEL</);assert.match(nav,/>JOURNAL</);assert.match(nav,/>MORE</);
  assert.doesNotMatch(nav,/>Project</);assert.doesNotMatch(nav,/>Features</);assert.doesNotMatch(nav,/>Search</);
  assert.match(html,/id="rallyPlannerButton"[^>]*>OPEN PLANNER</);
  assert.match(css,/\.rally-actions\{position:static;display:contents;pointer-events:none\}/);
  assert.match(css,/#rallyMissionButton\{left:max\(8px,env\(safe-area-inset-left\)\);top:114px\}/);
  assert.match(css,/#rallyTrailIntelButton\{left:max\(8px,env\(safe-area-inset-left\)\);top:188px\}/);
  assert.match(css,/#rallyJournalButton\{right:max\(8px,env\(safe-area-inset-right\)\);top:114px\}/);
  assert.match(css,/#rallyMoreButton\{right:max\(8px,env\(safe-area-inset-right\)\);top:188px\}/);
});

test('Mission hierarchy keeps score, day, contextual GPS, objective facts, and automatic elevation metadata',()=>{
  assert.match(html,/class="rally-top-bar"/);assert.match(html,/id="rallyDay"/);assert.match(html,/class="rally-score-slot"/);assert.doesNotMatch(html,/rally-score-slot" aria-hidden/);
  assert.match(html,/id="rallyObjectiveIntelSection" hidden/);assert.match(html,/id="rallyElevation" class="rally-recorded-metadata"/);
  assert.match(app,/return accuracy>maximum\?`GPS POOR/);assert.match(app,/:\s*'GPS ✓'/);
  assert.match(app,/NO CHECKPOINTS LOADED/);assert.match(app,/ALL REMAINING CHECKPOINTS DEFERRED/);assert.match(app,/RECOVERY REVIEW/);
  assert.doesNotMatch(app,/No objectives available/);assert.doesNotMatch(app,/Rally ready/);
});

test('Trail Intel remains factual and configuration stays behind Advanced settings',()=>{
  assert.match(html,/id="mobileObjectiveIntel"/);assert.match(html,/id="rallyTrailSettingsButton"[^>]*>Trail Intel Advanced</);
  for(const label of ['COMPETITORS','BREADCRUMBS','CHECKPOINTS','ROUTE / TRACK','RADAR'])assert.match(html,new RegExp(`>${label}<`));
  assert.match(app,/validated rider relationship/);assert.match(app,/TARGET UNKNOWN/);assert.match(app,/compactTargetIntelligenceModel/);
  assert.doesNotMatch(app,/road is good|checkpoint accessible|take this route/i);
  assert.match(app,/\[data-tab="tracking"\]/);
});

test('Journal and More preserve automatic review, full-view fallback, grouped tools, and normal-flow photos',()=>{
  assert.match(html,/id="rallyJournalTimeline"/);assert.match(html,/ADD RIDER OBSERVATION/);
  for(const heading of ['Documentation','Storage &amp; Recovery','Settings','Project / Planner','Diagnostics'])assert.match(html,new RegExp(heading));
  assert.match(html,/id="rallyCameraTapSurface"[^>]*role="button"/);assert.doesNotMatch(html,/id="rallyCamera(CapturePair|Retry|Selfie|Forward)|>Save Pair</);
  assert.match(html,/id="rallyJourneyPhotoButton"[^>]*>Journey Photo</);assert.doesNotMatch(html,/id="rallyJourney(Selfie|Forward)Button/);
  assert.match(css,/\.rally-more-actions \.rally-photos-entry\{grid-column:1\/-1;position:static;z-index:auto/);
});

test('deployment contract remains npm-based and preview-only',()=>{
  assert.match(html,/rallyBackupDayPackage"[^>]*>BACK UP DAY/);
  assert.match(workflow,/packageManager: npm/);assert.match(workflow,/--project-name=cannonmap/);assert.match(workflow,/pages deploy \./);
  assert.match(workflow,/branches:\s*\n\s*- agent\/mission-control-reconciliation/);assert.doesNotMatch(workflow,/\n\s*- main/);
});
