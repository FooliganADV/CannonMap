import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const read=file=>readFile(new URL(`../${file}`,import.meta.url),'utf8');

function functionSource(source,name){
  const start=source.indexOf(`function ${name}(`);assert.notEqual(start,-1,`${name} must exist`);
  const closingParameters=source.indexOf('){',start),opening=closingParameters+1;assert.ok(closingParameters>start,`${name} parameters must close`);let depth=0,quote=null,escaped=false;
  for(let index=opening;index<source.length;index++){
    const character=source[index];
    if(quote){if(escaped)escaped=false;else if(character==='\\')escaped=true;else if(character===quote)quote=null;continue;}
    if(character==='\''||character==='"'||character==='`'){quote=character;continue;}
    if(character==='{')depth++;else if(character==='}'&&--depth===0)return source.slice(start,index+1);
  }
  throw new Error(`${name} is incomplete`);
}

test('app target intelligence consumes the cached validated tactical stream and current numbered-day catalog only',async()=>{
  const app=await read('app.js'),catalog=functionSource(app,'targetCatalogForCurrentDay'),projection=functionSource(app,'competitorTargetIntelligence');
  assert.match(app,/from '.\/src\/domain\/competitors\/target-intelligence\.js'/);
  assert.match(catalog,/activeRallyDay\(\)/);
  assert.match(catalog,/dayNumber===null\?\[\]:dayCheckpoints\(\)/);
  assert.match(catalog,/\['checkpoint','hotel'\]/);
  assert.match(catalog,/projectId,eventId,dayNumber/);
  assert.match(projection,/competitorTacticalProjection\(comp/);
  assert.match(projection,/analyzeTargetIntelligence\(\{riderId:[\s\S]+tacticalTrail:tactical[\s\S]+telemetryStatus:status[\s\S]+targets:targetCatalog\.targets/);
  assert.doesNotMatch(projection,/comp\.points\.(?:map|filter|reduce)|haversine/);
});

test('one replaceable WeakMap projection serves popup, selected card, objective text, and test diagnostics',async()=>{
  const app=await read('app.js'),objective=functionSource(app,'objectiveTrailIntel');
  assert.match(app,/const competitorTargetIntelligenceCache=new WeakMap\(\)/);
  assert.match(app,/competitorTargetIntelligenceCache\.set\(tactical,\{signature,result,validUntil\}\)/);
  assert.match(app,/compactTargetIntelligenceHtml\(model\.targetIntelligence/);
  assert.match(app,/selected\?compactTargetIntelligenceHtml\(targetById\.get/);
  assert.match(objective,/competitorTargetIntelligence/);
  assert.doesNotMatch(objective,/for\(let index=points\.length|haversine|\.tactical\.points/,'objective UI must not restore the full-history scan');
  assert.match(app,/competitorTargetIntelligenceMetrics:\(\)=>/);
});

test('compact UI adds observation language without speculative routes, scores, or predictions',async()=>{
  const [app,presentation,css]=await Promise.all([read('app.js'),read('src/ui/trail-intel/tactical-presentation.js'),read('app.css')]);
  assert.match(presentation,/compactTargetIntelligenceHtml/);
  assert.match(presentation,/TARGET_STATE_LABELS/);
  assert.match(css,/\.tactical-target-summary\{/);
  assert.match(css,/\.tactical-target-summary\.is-unknown/);
  assert.doesNotMatch(`${app}\n${presentation}`,/target[- ](?:route|eta|score|prediction)|projected (?:arrival|score|finish)|catch eta/i);
});
