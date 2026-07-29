import assert from 'node:assert/strict';
import test from 'node:test';
import * as workflow from '../src/domain/checkpoints/workflow.js';

const checkpoint=(id,sequence,status='planned',extra={})=>workflow.normalizeCheckpoint({
  id,name:id,type:'checkpoint',day:1,sequence,status,points:10,...extra
});

test('checkpoint normalization, ordering, and scoring preserve Rally rules',()=>{
  const project={features:[
    checkpoint('standard',2,'completed'),
    checkpoint('extreme',1,'completed',{extreme:true,points:21}),
    checkpoint('next',3,'next'),
    {id:'hotel',type:'hotel',day:1}
  ]};
  assert.deepEqual(workflow.dayCheckpoints(project,{dayFilter:'1'}).map(item=>item.id),['extreme','standard','next','hotel']);
  assert.equal(workflow.currentCheckpoint(project,{dayFilter:'1'}).id,'next');
  assert.equal(workflow.currentHotel(project,{dayFilter:'1'}).id,'hotel');
  assert.equal(workflow.rallyScore(project),31);
});

test('checkpoint lifecycle transitions retain defer, restore, skip, and completion semantics',()=>{
  const rows=[checkpoint('one',1,'next'),checkpoint('two',2),checkpoint('three',3)];
  const next=workflow.deferCheckpoint(rows,rows[0],'Rider deferred','2026-01-01T00:00:00.000Z');
  assert.equal(rows[0].status,'deferred');assert.equal(rows[0].deferReason,'Rider deferred');assert.equal(next.id,'two');
  const restored=workflow.restoreDeferred(rows,'2026-01-01T00:01:00.000Z');
  assert.equal(restored.id,'one');assert.equal(restored.status,'next');assert.equal(rows[1].status,'planned');
  const afterComplete=workflow.completeCheckpoint(rows,restored,'2026-01-01T00:02:00.000Z');
  assert.equal(restored.status,'completed');assert.equal(afterComplete.id,'two');
  const afterSkip=workflow.skipCheckpoint(rows,afterComplete);
  assert.equal(afterComplete.status,'skipped');assert.equal(afterSkip.id,'three');
});

test('hotel bailout defers unfinished checkpoints without deleting or completing them',()=>{
  const rows=[checkpoint('one',1,'next'),checkpoint('two',2),checkpoint('done',3,'completed')];
  const deferred=workflow.deferForHotel(rows,'2026-01-01T00:00:00.000Z');
  assert.deepEqual(deferred.map(item=>item.id),['one','two']);
  assert.deepEqual(rows.map(item=>item.status),['deferred','deferred','completed']);
  assert.equal(rows.length,3);
});

test('checkpoint reordering and make-next preserve imported sequence metadata',()=>{
  const rows=[checkpoint('one',1),checkpoint('two',2,'deferred',{deferredAt:'2025-12-31T23:59:00.000Z'})];
  assert.equal(workflow.moveCheckpoint(rows,'two',-1).id,'two');
  assert.deepEqual(rows.map(item=>item.sequence),[1,2]);
  const target=workflow.makeCheckpointNext(rows,'two','2026-01-01T00:00:00.000Z');
  assert.equal(target.status,'next');assert.equal(target.deferredAt,null);assert.equal(target.restoredAt,'2026-01-01T00:00:00.000Z');
  workflow.restoreImportedOrder(rows);
  assert.deepEqual(rows.map(item=>item.sequence),[2,1]);
});

test('checkpoint names derive day and numeric default order without renaming',()=>{
  const project={features:[
    {id:'ten',name:'5.10 Balcony Arch',type:'checkpoint',day:1,status:'planned'},
    {id:'two',name:'5.2 Creek Crossing',type:'checkpoint',day:9,status:'planned'},
    {id:'one',name:'5.01 Start',type:'checkpoint',status:'planned'},
    {id:'other-day',name:'12.16 Future',type:'checkpoint',status:'planned'}
  ]};
  project.features.forEach(workflow.normalizeCheckpoint);
  assert.deepEqual(project.features.map(item=>[item.name,item.day,item.sequence]),[
    ['5.10 Balcony Arch',5,10],['5.2 Creek Crossing',5,2],['5.01 Start',5,1],['12.16 Future',12,16]
  ]);
  assert.deepEqual(workflow.dayCheckpoints(project,{dayFilter:'5'}).map(item=>item.id),['one','two','ten']);
});

test('unnumbered checkpoints remain available and are flagged for manual review',()=>{
  const feature=workflow.normalizeCheckpoint({id:'manual',name:'Scenic overlook',type:'checkpoint',day:5,status:'planned'});
  assert.equal(feature.sequence,null);
  assert.equal(feature.sequenceNeedsReview,true);
  assert.equal(workflow.dayCheckpoints({features:[feature]},{dayFilter:'5'})[0],feature);
});

test('out-of-order completion and NEXT preserve independent checkpoint states',()=>{
  const rows=[
    checkpoint('5.9 Earlier',9),
    checkpoint('5.16 Selected',16,'next'),
    checkpoint('5.20 Later',20)
  ];
  const next=workflow.completeCheckpoint(rows,rows[1],'2026-01-01T00:00:00.000Z');
  assert.deepEqual(rows.map(item=>item.status),['next','completed','planned']);
  assert.equal(next.id,'5.9 Earlier');
  workflow.selectNext(rows);
  assert.deepEqual(rows.map(item=>item.status),['planned','completed','next']);
});

test('only structured hotel or dayFinish metadata designates day completion',()=>{
  const hotel={id:'hotel',name:'Day 4 overnight',type:'hotel',day:4,status:'planned'};
  const namedFinish=workflow.normalizeCheckpoint({id:'named',name:'4.99 Finish',type:'checkpoint',status:'planned'});
  const explicit=workflow.normalizeCheckpoint({id:'explicit',name:'4.100 Control',type:'checkpoint',dayFinish:true,status:'planned'});
  assert.equal(workflow.isDayFinish(hotel),true);
  assert.equal(workflow.isDayFinish(namedFinish),false);
  assert.equal(workflow.isDayFinish(explicit),true);
  assert.equal(workflow.nextRallyDay({features:[hotel,{type:'route',day:5}]},4),5);
  assert.equal(workflow.nextRallyDay({features:[hotel,{type:'route',day:6}]},4),0);
});
