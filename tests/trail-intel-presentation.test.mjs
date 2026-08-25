import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {
  assignRiderColors,clusterPresentationRider,compactRiderListHtml,compactRiderRowHtml,compactRiderRowModel,
  competitorClusterFingerprint,competitorClusterIconSpec,competitorClusterPopupHtml,competitorMarkerIconSpec,
  competitorTrailStyle,deterministicMarkerOffsets,headingPresentation,riderSourceLabel,riderVisualIdentity,
  shouldShowTacticalCluster
} from '../src/ui/trail-intel/tactical-presentation.js';

const css=await readFile(new URL('../app.css',import.meta.url),'utf8');
const rider88={id:'gps-stream-7',competitor_number:88,name:'Beau',points:[{},{},{}]};
const rider246={id:'gps-stream-8',number:246,name:'Rider 246',points:[{}]};

test('upstream competitor_number is the visible label while stream id owns stable color',()=>{
  assert.equal(riderSourceLabel(rider88),'88');
  assert.equal(riderSourceLabel({id:'stream-2026',name:'Team 2026'}),'stream-2026');
  assert.equal(riderSourceLabel({id:'stream-246',name:'Rider #246'}),'246');
  const before=riderVisualIdentity(rider88),after=riderVisualIdentity({...rider88,competitor_number:99,name:'Updated'});
  assert.equal(before.key,'gps-stream-7');assert.equal(after.key,before.key);assert.equal(after.color,before.color);
  assert.match(competitorMarkerIconSpec(rider88).html,/>88<\/span>/);
});

test('a realistic 24-rider field receives 24 distinct colors that survive membership changes',()=>{
  const riders=Array.from({length:24},(_,index)=>({id:`event-60-stream-${index+1}`,number:index+1})),first=assignRiderColors(riders),second=assignRiderColors([...riders].reverse());
  assert.equal(new Set(first.values()).size,24);
  assert.deepEqual([...first.entries()].sort(),[...second.entries()].sort());
  const registry=new Map(),baseline=assignRiderColors(riders,{registry}),withEarlierKey=assignRiderColors([{id:'000-new-rider',number:99},...riders],{registry}),afterRemoval=assignRiderColors(riders.slice(4),{registry});
  for(const rider of riders){assert.equal(withEarlierKey.get(rider.id),baseline.get(rider.id));if(afterRemoval.has(rider.id))assert.equal(afterRemoval.get(rider.id),baseline.get(rider.id));}
  const updated=assignRiderColors(riders.map(rider=>({...rider,name:`Rider ${rider.number}`})));
  assert.deepEqual([...first.entries()],[...updated.entries()]);
});

test('selected rider is emphasized and nonselected riders are dimmed until ALL RIDERS reset',()=>{
  const colors=assignRiderColors([rider88,rider246]),selectedMarker=competitorMarkerIconSpec(rider88,{selectedRiderId:rider88.id,color:colors.get(rider88.id)}),otherMarker=competitorMarkerIconSpec(rider246,{selectedRiderId:rider88.id,color:colors.get(rider246.id)}),selectedTrail=competitorTrailStyle(rider88,{selectedRiderId:rider88.id,color:colors.get(rider88.id)}),otherTrail=competitorTrailStyle(rider246,{selectedRiderId:rider88.id,color:colors.get(rider246.id)});
  assert.match(selectedMarker.className,/is-selected/);assert.match(otherMarker.className,/is-dimmed/);assert.ok(selectedTrail.opacity>otherTrail.opacity);
  const isolated=compactRiderListHtml([rider88,rider246],{selectedRiderId:rider88.id,colorForRider:rider=>colors.get(rider.id)}),all=compactRiderListHtml([rider88,rider246],{colorForRider:rider=>colors.get(rider.id)});
  assert.match(isolated,/data-rider-view-all/);assert.match(isolated,/aria-pressed="true"/);assert.doesNotMatch(all,/data-rider-view-all|is-dimmed/);
});

test('compact tactical row exposes immediate, 3-minute, 15-minute, freshness, motion, heading, and gaps',()=>{
  const status={status:'live',ageMs:12000,currentSpeedMph:78.6,rollingPaceMph:75.8,sustainedPaceMph:71.3,headingDegrees:44,headingCardinal:'NE',headingArrow:'↗',motion:'moving',trailGapCount:2};
  const model=compactRiderRowModel(rider88,status),html=compactRiderRowHtml(rider88,status);
  assert.deepEqual([model.label,model.speedLabel,model.rollingLabel,model.sustainedLabel,model.freshness,model.motion,model.heading,model.gapCount],['88','79','76','71','LIVE','MOVING','NE',2]);
  for(const value of ['88','79','NOW','76','3 MIN','71','15 MIN','LIVE','MOVING','2 GAPS','↗','NE'])assert.match(html,new RegExp(value));
  const insufficient=compactRiderRowModel(rider88,{status:'stale',motion:'stationary',rollingPaceMph:null,sustainedPaceMph:null});
  assert.deepEqual([insufficient.rollingLabel,insufficient.sustainedLabel,insufficient.motion,insufficient.freshness],['—','—','STOPPED','STALE']);
  assert.equal(compactRiderRowModel(rider88,{status:'offline',ageMs:74*60_000}).freshness,'OFFLINE');
});

test('overlapping marker fan-out is deterministic, stable under reorder, and leaves isolated riders centered',()=>{
  const markers=[{id:'246',point:{x:100,y:100}},{id:'88',point:{x:100,y:100}},{id:'301',point:{x:300,y:300}}],options={project:point=>point};
  const first=deterministicMarkerOffsets(markers,options),second=deterministicMarkerOffsets([...markers].reverse(),options);
  assert.deepEqual(first.get('88'),second.get('88'));assert.deepEqual(first.get('246'),second.get('246'));
  assert.deepEqual(first.get('88'),{x:-24,y:0});assert.deepEqual(first.get('246'),{x:24,y:0});assert.deepEqual(first.get('301'),{x:0,y:0});
});

test('dense eight-rider fan-out preserves a glove-size separation and remains deterministic',()=>{
  const markers=Array.from({length:8},(_,index)=>({id:`rider-${index+1}`,point:{x:100,y:100}})),first=deterministicMarkerOffsets(markers,{project:point=>point}),second=deterministicMarkerOffsets([...markers].reverse(),{project:point=>point});
  for(const marker of markers)assert.deepEqual(first.get(marker.id),second.get(marker.id));
  const offsets=[...first.values()];
  for(let left=0;left<offsets.length;left++)for(let right=left+1;right<offsets.length;right++)assert.ok(Math.hypot(offsets[left].x-offsets[right].x,offsets[left].y-offsets[right].y)>=46,`${left}/${right} markers overlap`);
});

test('cluster presentation and fingerprint never retain or stringify durable rider histories',()=>{
  const points=Array.from({length:12000},(_,index)=>({lat:30+index/1e6,lon:-90,time:new Date(index*1000).toISOString()})),projected=clusterPresentationRider({...rider88,points},{id:rider88.id,status:'live',motion:'moving',lastUpdate:'2026-08-25T12:00:00.000Z'}),cluster={id:'cluster:gps-stream-7,gps-stream-8',center:{lat:30,lon:-90},latestUpdate:'2026-08-25T12:00:00.000Z',riders:[projected,clusterPresentationRider(rider246,{id:rider246.id,status:'stale',motion:'unknown'})]},fingerprint=competitorClusterFingerprint(cluster);
  assert.equal('points' in projected,false);assert.equal(fingerprint.includes('lat\":30.000001'),false);assert.ok(fingerprint.length<1000);assert.match(fingerprint,/\"label\":\"88\"/);
});

test('clusters are low-zoom only and expose individually selectable rider numbers',()=>{
  const cluster={riders:[{id:'gps-stream-7',competitor_number:88,status:'live'},{id:'gps-stream-8',number:246,status:'stale'}]},icon=competitorClusterIconSpec(cluster),popup=competitorClusterPopupHtml(cluster);
  assert.equal(shouldShowTacticalCluster({zoom:9,riderCount:2}),true);assert.equal(shouldShowTacticalCluster({zoom:11,riderCount:2}),false);
  assert.deepEqual(icon.riderLabels,['88','246']);assert.match(popup,/data-rider-id="gps-stream-7"/);assert.match(popup,/>88<\/b>/);assert.match(popup,/>246<\/b>/);
});

test('heading and Samsung tactical controls remain compact and glove operable',()=>{
  assert.deepEqual(headingPresentation(225),{degrees:225,cardinal:'SW',arrow:'↙'});
  assert.match(css,/\.tactical-rider-row\{[^}]*min-height:52px/);assert.match(css,/\.tactical-rider-reset\{[^}]*min-height:48px/);
  assert.match(css,/\.competitor-rider-marker\.is-selected/);assert.match(css,/\.competitor-rider-marker\.is-dimmed/);
});
