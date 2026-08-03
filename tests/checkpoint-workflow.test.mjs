import assert from 'node:assert/strict';
import test from 'node:test';
import * as workflow from '../src/domain/checkpoints/workflow.js';

const checkpoint=(id,sequence,status='planned',extra={})=>workflow.normalizeCheckpoint({
  id,name:id,type:'checkpoint',day:1,sequence,status,points:10,photoRequirement:'optional',...extra
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

test('completed official hotel exposes but does not activate the next available rally day',()=>{
  const hotel=workflow.normalizeCheckpoint({id:'hotel-1',name:'Hotel',type:'hotel',day:1});
  const project={features:[hotel,checkpoint('day-2',1,'planned',{day:2})]},settings={dayFilter:'1'};
  workflow.completeCheckpoint([hotel],hotel,'2026-01-01T20:00:00.000Z');
  assert.equal(workflow.nextRallyDay(project,1),2);
  assert.equal(settings.dayFilter,'1');
});

test('checkpoint lifecycle transitions retain defer, restore, skip, and completion semantics',()=>{
  const rows=[checkpoint('one',1,'next'),checkpoint('two',2),checkpoint('three',3)];
  const next=workflow.deferCheckpoint(rows,rows[0],'Rider deferred','2026-01-01T00:00:00.000Z');
  assert.equal(rows[0].status,'deferred');assert.equal(rows[0].deferReason,'Rider deferred');assert.equal(next.id,'two');
  const restored=workflow.restoreDeferred(rows,'2026-01-01T00:01:00.000Z');
  assert.equal(restored.id,'one');assert.equal(restored.status,'active');assert.equal(rows[1].status,'upcoming');
  const afterComplete=workflow.completeCheckpoint(rows,restored,'2026-01-01T00:02:00.000Z');
  assert.equal(restored.status,'collected');assert.equal(afterComplete.id,'two');
  const afterSkip=workflow.skipCheckpoint(rows,afterComplete);
  assert.equal(afterComplete.status,'failed');assert.equal(afterSkip.id,'three');
});

test('hotel bailout defers unfinished checkpoints without deleting or completing them',()=>{
  const hotel=workflow.normalizeCheckpoint({id:'hotel',name:'Hotel',type:'hotel',day:1});
  const rows=[checkpoint('one',1,'next'),checkpoint('two',2),checkpoint('done',3,'completed'),hotel];
  const deferred=workflow.deferForHotel(rows,'2026-01-01T00:00:00.000Z');
  assert.deepEqual(deferred.map(item=>item.id),['one','two']);
  assert.deepEqual(rows.map(item=>item.status),['deferred','deferred','collected','upcoming']);
  assert.equal(rows.length,4);
});

test('mandatory hotel waits for the intelligent deferred queue and cannot be deferred',()=>{
  const deferred=checkpoint('deferred',1,'deferred'),hotel=workflow.normalizeCheckpoint({id:'hotel',name:'Hotel',type:'hotel',day:1,status:'planned'});
  const rows=[deferred,hotel];
  assert.equal(workflow.activateNextPlanned(rows),null);
  assert.equal(workflow.resumeDeferred(rows,'2026-01-01T00:00:00.000Z').id,'deferred');
  deferred.status='deferred';
  assert.equal(workflow.finishDayWithHotel(rows,'2026-01-01T00:01:00.000Z').id,'hotel');
  assert.equal(workflow.deferCheckpoint(rows,hotel,'invalid','2026-01-01T00:02:00.000Z'),null);
  assert.equal(hotel.status,'active');
});

test('checkpoint reordering and make-next preserve imported sequence metadata',()=>{
  const rows=[checkpoint('one',1),checkpoint('two',2,'deferred',{deferredAt:'2025-12-31T23:59:00.000Z'})];
  assert.equal(workflow.moveCheckpoint(rows,'two',-1).id,'two');
  assert.deepEqual(rows.map(item=>item.sequence),[1,2]);
  const target=workflow.makeCheckpointNext(rows,'two','2026-01-01T00:00:00.000Z');
  assert.equal(target.status,'active');assert.equal(target.deferredAt,null);assert.equal(target.restoredAt,'2026-01-01T00:00:00.000Z');
  workflow.restoreImportedOrder(rows);
  assert.deepEqual(rows.map(item=>item.sequence),[2,1]);
});

test('next-day resolution ignores stale current-day values and requires an executable later day',()=>{
  const project={features:[checkpoint('day-1',1,'completed'),checkpoint('day-2',1,'planned',{day:2}),{id:'route-3',type:'route',day:3}]};
  assert.equal(workflow.nextRallyDay(project,1),2);
  assert.equal(workflow.nextRallyDay(project,2),0);
});

test('required photo creates an explicit gate and blocks collection until recorded',()=>{
  const photo=checkpoint('photo',1,'next',{photoRequired:true}),rows=[photo,checkpoint('after',2)];
  workflow.recordArrival(photo,'2026-01-01T00:00:00.000Z');
  assert.equal(photo.status,workflow.CHECKPOINT_STATE.PHOTO_REQUIRED);
  assert.equal(workflow.completeCheckpoint(rows,photo,'2026-01-01T00:01:00.000Z'),null);
  assert.equal(photo.status,workflow.CHECKPOINT_STATE.PHOTO_REQUIRED);
  const next=workflow.completeCheckpoint(rows,photo,'2026-01-01T00:02:00.000Z',{photoRecorded:true});
  assert.equal(photo.status,workflow.CHECKPOINT_STATE.COLLECTED);assert.equal(next.id,'after');
});

test('photo requirement aliases normalize to one durable boolean contract',()=>{
  for(const source of [{requiresPhoto:'yes'},{requirePhoto:1},{photoRequirement:'Required'},{properties:{photoRequired:true}},{metadata:{photoRequired:'true'}}]){
    assert.equal(workflow.normalizeCheckpoint({id:'photo',name:'photo',type:'checkpoint',...source}).photoRequired,true);
  }
  assert.equal(workflow.normalizeCheckpoint({id:'legacy-default',name:'legacy-default',type:'checkpoint',photoRequired:false}).photoRequired,true);
  assert.equal(checkpoint('optional',1,'planned',{photoRequirement:'optional'}).photoRequired,false);
  assert.equal(workflow.normalizeCheckpoint({id:'hotel',name:'Hotel',type:'hotel'}).photoRequired,true);
  assert.equal(workflow.normalizeCheckpoint({id:'required-hotel',name:'Hotel',type:'hotel',photoRequired:true}).photoRequired,true);
});

test('checkpoint colors have exactly one authoritative meaning',()=>{
  assert.equal(new Set(Object.values(workflow.CHECKPOINT_COLOR)).size,Object.keys(workflow.CHECKPOINT_COLOR).length);
  assert.equal(workflow.CHECKPOINT_COLOR.deferred,'#f59e0b');
});
