import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {
  compactRiderListHtml,compactRiderRowHtml,compactRiderRowModel,
  competitorClusterIconSpec,competitorClusterPopupHtml,competitorDiagnosticSummary,
  competitorMarkerIconSpec,competitorTrailStyle,headingPresentation,
  riderSourceLabel,riderVisualIdentity,shouldShowTacticalCluster
} from '../src/ui/trail-intel/tactical-presentation.js';

const css=await readFile(new URL('../app.css',import.meta.url),'utf8');
const rider246={id:'gps-7',number:246,name:'Rider 246',points:[{},{},{}]};
const rider299={id:'gps-8',number:299,name:'Rider 299',points:[{}]};

test('upstream rider number drives a stable, distinct marker/trail/row identity',()=>{
  assert.equal(riderSourceLabel(rider246),'246');
  assert.equal(riderSourceLabel({...rider246,competitorNumber:'#246'}),'246');
  const first=riderVisualIdentity(rider246),second=riderVisualIdentity({...rider246,name:'Updated display name'}),other=riderVisualIdentity(rider299);
  assert.deepEqual(first,second);
  assert.notEqual(first.color,other.color);
  assert.match(competitorMarkerIconSpec(rider246).html,/>246<\/span>/);
  assert.equal(competitorTrailStyle(rider246).color,first.color);
  assert.match(compactRiderRowHtml(rider246,{status:'live'}),/>246<\/b>/);
});

test('selected rider is highlighted and every other rider is de-emphasized independently',()=>{
  const chosenMarker=competitorMarkerIconSpec(rider246,{selectedRiderId:'gps-7'}),otherMarker=competitorMarkerIconSpec(rider299,{selectedRiderId:'gps-7'});
  const chosenTrail=competitorTrailStyle(rider246,{selectedRiderId:'gps-7'}),otherTrail=competitorTrailStyle(rider299,{selectedRiderId:'gps-7'});
  assert.match(chosenMarker.className,/is-selected/);assert.doesNotMatch(chosenMarker.className,/is-dimmed/);
  assert.match(otherMarker.className,/is-dimmed/);
  assert.equal(chosenTrail.weight,7);assert.ok(otherTrail.opacity<chosenTrail.opacity);assert.match(otherTrail.className,/is-dimmed/);
  const all=competitorTrailStyle(rider299,{selectedRiderId:null});assert.doesNotMatch(all.className,/is-dimmed|is-selected/);
});

test('compact tactical row prioritizes identity, speed, pace, freshness and heading',()=>{
  const status={status:'live',ageMs:12000,recentSpeedMph:78.6,rollingPaceMph:75.8,direction:44};
  const model=compactRiderRowModel(rider246,status),html=compactRiderRowHtml(rider246,status);
  assert.deepEqual([model.label,model.speedLabel,model.paceLabel,model.freshness,model.headingArrow,model.heading],['246','79','76','LIVE','↗','NE']);
  for(const value of ['246','79','mph','76','avg','LIVE','↗','NE'])assert.match(html,new RegExp(value));
  assert.doesNotMatch(html,/breadcrumb/i);
  assert.equal(competitorDiagnosticSummary(rider246).breadcrumbCount,3);
  const unavailable=compactRiderRowModel(rider246,{speedMph:null,rollingPaceMph:null});
  assert.deepEqual([unavailable.speedLabel,unavailable.paceLabel],['—','—']);
  const tacticalShape=compactRiderRowModel(rider246,{currentSpeedMph:62.4,rollingPaceMph:59.7,headingDegrees:90,status:'live'});
  assert.deepEqual([tacticalShape.speedLabel,tacticalShape.paceLabel,tacticalShape.heading],['62','60','E']);
});

test('all-riders reset appears only during rider isolation',()=>{
  const selected=compactRiderListHtml([rider246,rider299],{selectedRiderId:'gps-7'}),all=compactRiderListHtml([rider246,rider299]);
  assert.match(selected,/data-rider-view-all/);assert.match(selected,/aria-pressed="true"/);assert.match(selected,/is-dimmed/);
  assert.doesNotMatch(all,/data-rider-view-all/);assert.doesNotMatch(all,/is-dimmed/);
});

test('cluster presentation exposes a rider count and individual upstream IDs',()=>{
  const cluster={riders:[{id:'gps-7',number:246,status:'live'},{id:'gps-8',number:299,status:'live'}]};
  const icon=competitorClusterIconSpec(cluster),popup=competitorClusterPopupHtml(cluster);
  assert.equal(icon.count,2);assert.deepEqual(icon.riderLabels,['246','299']);assert.match(icon.html,/>2<\/b>/);
  assert.match(popup,/data-rider-id="gps-7"/);assert.match(popup,/>246<\/b>/);assert.match(popup,/>299<\/b>/);
  assert.equal(shouldShowTacticalCluster({zoom:9,riderCount:2}),true);
  assert.equal(shouldShowTacticalCluster({zoom:12,riderCount:2}),false);
});

test('heading and tactical CSS stay phone dense and glove operable',()=>{
  assert.deepEqual(headingPresentation(225),{degrees:225,cardinal:'SW',arrow:'↙'});
  assert.match(css,/\.tactical-rider-row\{[^}]*min-height:50px/);
  assert.match(css,/\.tactical-rider-reset\{[^}]*min-height:48px/);
  assert.match(css,/\.competitor-rider-marker\.is-selected/);
  assert.match(css,/\.competitor-rider-marker\.is-dimmed/);
});
