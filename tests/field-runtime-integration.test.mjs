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

test('landscape header and action dock preserve score separation and 48px safe-area targets',()=>{
  assert.match(css,/\.rally-head\{left:max\(8px,env\(safe-area-inset-left\)\);right:max\(8px,env\(safe-area-inset-right\)\);width:auto\}/);
  assert.doesNotMatch(css,/\.rally-head\{[^}]*width:120px/);
  assert.match(css,/\.rally-head-day\{[^}]*width:min\(34vw,260px\)[^}]*overflow:hidden/);
  assert.match(css,/\.rally-primary-card\{[^}]*left:calc\(max\(8px,env\(safe-area-inset-left\)\) \+ min\(34vw,260px\) \+ 12px\)/);
  assert.match(css,/\.rally-score-slot\{flex:0 0 auto\}/);
  assert.match(css,/\.rally-actions\{[^}]*grid-template-columns:repeat\(4,minmax\(48px,1fr\)\)/);
  const iPhone13Landscape={width:844,safeLeft:47,reservedPlannerWidth:486,reservedRight:72,gap:6};
  const available=iPhone13Landscape.width-iPhone13Landscape.safeLeft-iPhone13Landscape.reservedPlannerWidth-iPhone13Landscape.reservedRight;
  assert.ok(available>=4*48+3*iPhone13Landscape.gap,'iPhone 13 landscape safe area must fit four 48px actions');
  const safeStart=Math.max(8,iPhone13Landscape.safeLeft),headerWidth=Math.min(iPhone13Landscape.width*.34,260),primaryLeft=safeStart+headerWidth+12;
  assert.ok(primaryLeft>=safeStart+headerWidth+12,'landscape objective card must start after the day/GPS header');
});
