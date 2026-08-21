import assert from 'node:assert/strict';
import test from 'node:test';
import {createCameraCaptureArbiter} from '../src/application/camera-capture-arbiter.js';

test('checkpoint capture preempts Ride Memory and never overlaps camera ownership',async()=>{
  const events=[],order=[];
  const arbiter=createCameraCaptureArbiter({clock:{now:()=>Date.parse('2026-08-20T12:00:00.000Z')},onEvent:event=>events.push(event)});
  let memoryStarted;
  const started=new Promise(resolve=>{memoryStarted=resolve;});
  const memory=arbiter.tryRunMemory(({signal})=>new Promise((resolve,reject)=>{
    order.push('memory-start');memoryStarted();
    signal.addEventListener('abort',()=>{order.push('memory-abort');reject(signal.reason||Object.assign(new Error('aborted'),{name:'AbortError'}));},{once:true});
  }));
  const observedMemory=memory.then(()=>null,error=>error);
  await started;
  const checkpoint=arbiter.runCheckpoint(async({signal})=>{assert.equal(signal.aborted,false);order.push('checkpoint-start');return 'pair';});
  assert.equal(await checkpoint,'pair');
  const memoryError=await observedMemory;
  assert.equal(memoryError.name,'AbortError');
  assert.deepEqual(order,['memory-start','memory-abort','checkpoint-start']);
  assert.ok(events.some(event=>event.eventType==='ride_memory_preempted'));
  assert.equal(arbiter.state().currentKind,null);
});

test('Ride Memory is not queued twice and checkpoint tasks serialize',async()=>{
  const arbiter=createCameraCaptureArbiter(),order=[];
  let releaseMemory;
  const memory=arbiter.tryRunMemory(()=>new Promise(resolve=>{releaseMemory=resolve;}));
  await Promise.resolve();
  let duplicateCalls=0;
  const duplicate=await arbiter.tryRunMemory(async()=>{duplicateCalls+=1;});
  assert.deepEqual(duplicate,{started:false,reason:'ride_memory-active'});assert.equal(duplicateCalls,0);
  releaseMemory('photo');assert.deepEqual(await memory,{started:true,value:'photo'});
  let releaseFirst;
  const first=arbiter.runCheckpoint(async()=>{order.push('first-start');await new Promise(resolve=>{releaseFirst=resolve;});order.push('first-end');});
  await Promise.resolve();
  const second=arbiter.runCheckpoint(async()=>{order.push('second-start');order.push('second-end');});
  await Promise.resolve();assert.deepEqual(order,['first-start']);releaseFirst();await Promise.all([first,second]);
  assert.deepEqual(order,['first-start','first-end','second-start','second-end']);
});

test('checkpoint media can cover a scheduled memory slot by reference within five minutes',()=>{
  let now=Date.parse('2026-08-20T13:00:00.000Z');
  const arbiter=createCameraCaptureArbiter({clock:{now:()=>now}}),noted=arbiter.noteCheckpointCapture({capturedAt:now-4*60*1000,checkpointId:'cp-1',mediaIds:['rear-original']});
  assert.equal(arbiter.checkpointCoverage(now,5*60*1000),noted);
  assert.equal(arbiter.checkpointCoverage(now+6*60*1000,5*60*1000),null);
});
