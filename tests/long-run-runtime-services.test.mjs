import test from 'node:test';
import assert from 'node:assert/strict';
import {createGpsWatchdog} from '../src/application/gps-watchdog.js';
import {createLivePollController} from '../src/application/live-poll-controller.js';
import {createCoalescingWriteScheduler} from '../src/application/coalescing-write-scheduler.js';
import {createBackupSchedulerHealth} from '../src/application/backup-scheduler-health.js';

class ManualTime{
  constructor(start=0){this.value=start;this.sequence=0;this.tasks=new Map();}
  now=()=>this.value;
  setTimeout=(callback,delay=0)=>{const id=++this.sequence;this.tasks.set(id,{id,at:this.value+Math.max(0,Number(delay)||0),callback});return id;};
  clearTimeout=id=>this.tasks.delete(id);
  async settle(){for(let index=0;index<8;index++)await Promise.resolve();}
  async advance(milliseconds){const target=this.value+milliseconds;while(true){const next=[...this.tasks.values()].filter(task=>task.at<=target).sort((a,b)=>a.at-b.at||a.id-b.id)[0];if(!next)break;this.value=next.at;this.tasks.delete(next.id);next.callback();await this.settle();}this.value=target;await this.settle();}
}

class FakeEvents{
  constructor(){this.listeners=new Map();}
  addEventListener(type,listener){const values=this.listeners.get(type)||new Set();values.add(listener);this.listeners.set(type,values);}
  removeEventListener(type,listener){this.listeners.get(type)?.delete(listener);}
  dispatch(type){for(const listener of [...(this.listeners.get(type)||[])])listener({type});}
  count(type){return this.listeners.get(type)?.size||0;}
}

function fakeGeolocation(){
  let sequence=0;const active=new Map(),history=new Map(),cleared=[];
  return {
    watchPosition(success,error,options){const id=++sequence,record={id,success,error,options};active.set(id,record);history.set(id,record);return id;},
    clearWatch(id){active.delete(id);cleared.push(id);},
    position(value={}){for(const record of [...active.values()])record.success({timestamp:value.timestamp??0,coords:{latitude:30,longitude:-90,accuracy:5,...value.coords}});},
    error(value){for(const record of [...active.values()])record.error(value);},
    active,history,cleared
  };
}

test('GPS watchdog owns one watch, restarts a stalled watch with backoff, and ignores repeated start',async()=>{
  const time=new ManualTime(1_000),geolocation=fakeGeolocation(),restarts=[],watchdog=createGpsWatchdog({geolocation,now:time.now,setTimer:time.setTimeout,clearTimer:time.clearTimeout,stallAfterMs:45_000,minRestartDelayMs:1_000,onRestart:value=>restarts.push(value)});
  watchdog.start();watchdog.start();assert.equal(geolocation.active.size,1);assert.equal(time.tasks.size,1);
  geolocation.position({timestamp:1_000});assert.equal(watchdog.state().status,'healthy');assert.equal(time.tasks.size,1);
  await time.advance(45_000);assert.equal(geolocation.active.size,0);assert.equal(watchdog.state().status,'backoff');assert.equal(restarts.length,1);assert.equal(time.tasks.size,1);
  watchdog.start();assert.equal(geolocation.active.size,0,'start during owned backoff cannot create a parallel watch');
  await time.advance(1_000);assert.equal(geolocation.active.size,1);assert.equal(watchdog.state().restartAttempts,1);
  geolocation.position({timestamp:time.now()});assert.match(watchdog.state().status,/healthy/);assert.equal(watchdog.state().restartAttempts,0);
  watchdog.stop();assert.equal(geolocation.active.size,0);assert.equal(time.tasks.size,0);
});

test('GPS permission denial is blocked without a retry loop and explicit restart recovers',()=>{
  const time=new ManualTime(),geolocation=fakeGeolocation(),watchdog=createGpsWatchdog({geolocation,now:time.now,setTimer:time.setTimeout,clearTimer:time.clearTimeout});
  watchdog.start();geolocation.error({code:1,message:'Permission denied'});assert.equal(watchdog.state().status,'blocked');assert.equal(geolocation.active.size,0);assert.equal(time.tasks.size,0);
  watchdog.start();assert.equal(geolocation.active.size,1,'a deliberate start after browser permission changes is allowed');watchdog.stop();
});

test('a 12-hour foreground GPS simulation retains one watch and one stall timer',async()=>{
  const time=new ManualTime(Date.parse('2026-08-20T06:00:00Z')),geolocation=fakeGeolocation(),watchdog=createGpsWatchdog({geolocation,now:time.now,setTimer:time.setTimeout,clearTimer:time.clearTimeout,stallAfterMs:45_000});watchdog.start();
  for(let elapsed=0;elapsed<12*60*60_000;elapsed+=10_000){geolocation.position({timestamp:time.now()});await time.advance(10_000);assert.equal(geolocation.active.size,1);assert.ok(time.tasks.size<=1);}
  assert.equal(watchdog.state().stallCount,0);watchdog.stop();assert.equal(time.tasks.size,0);
});

test('GPS watchdog does not churn the watch while hidden and rechecks it on foreground',async()=>{
  const time=new ManualTime(10_000),geolocation=fakeGeolocation();let visible=true,restarts=0;
  const watchdog=createGpsWatchdog({geolocation,visible:()=>visible,now:time.now,setTimer:time.setTimeout,clearTimer:time.clearTimeout,stallAfterMs:45_000,onRestart:()=>{restarts++;}});
  watchdog.start();geolocation.position({timestamp:time.now()});visible=false;geolocation.position({timestamp:time.now()});
  await time.advance(10*60_000);assert.equal(geolocation.active.size,1);assert.equal(restarts,0);assert.equal(time.tasks.size,0);
  visible=true;watchdog.checkNow();assert.equal(geolocation.active.size,0);assert.equal(watchdog.state().status,'backoff');assert.equal(restarts,1);watchdog.stop();
});

test('live poll controller serializes requests, reconnects, and owns listeners/timers',async()=>{
  const time=new ManualTime(),network=new FakeEvents(),visibility=new FakeEvents();let isOnline=true,isVisible=true,polls=0,snapshots=0;
  const controller=createLivePollController({poll:async()=>({sequence:++polls}),onSnapshot:()=>{snapshots++;},now:time.now,setTimer:time.setTimeout,clearTimer:time.clearTimeout,intervalMs:30_000,online:()=>isOnline,visible:()=>isVisible,connectivityTarget:network,visibilityTarget:visibility});
  controller.start();controller.start();await time.settle();assert.equal(polls,1);assert.equal(snapshots,1);assert.equal(time.tasks.size,1);assert.deepEqual([network.count('online'),network.count('offline'),visibility.count('visibilitychange')],[1,1,1]);
  isOnline=false;network.dispatch('offline');assert.equal(controller.state().status,'offline');assert.equal(time.tasks.size,0);await time.advance(120_000);assert.equal(polls,1);
  isOnline=true;network.dispatch('online');network.dispatch('online');await time.settle();assert.equal(polls,2,'duplicate online events share the in-flight request');assert.equal(time.tasks.size,1);
  isVisible=false;visibility.dispatch('visibilitychange');assert.equal(controller.state().status,'paused');assert.equal(time.tasks.size,0);
  isVisible=true;visibility.dispatch('visibilitychange');await time.settle();assert.equal(polls,3);controller.stop();assert.equal(time.tasks.size,0);assert.deepEqual([network.count('online'),network.count('offline'),visibility.count('visibilitychange')],[0,0,0]);
});

test('live poll controller remains single-timer and fresh through a 12-hour synthetic loop',async()=>{
  const time=new ManualTime(),network=new FakeEvents(),visibility=new FakeEvents();let polls=0;
  const controller=createLivePollController({poll:async()=>++polls,now:time.now,setTimer:time.setTimeout,clearTimer:time.clearTimeout,intervalMs:30_000,staleAfterMs:90_000,online:()=>true,visible:()=>true,connectivityTarget:network,visibilityTarget:visibility});controller.start();await time.settle();
  for(let elapsed=0;elapsed<12*60*60_000;elapsed+=30_000){await time.advance(30_000);assert.ok(time.tasks.size<=1);assert.equal(controller.state().status,'live');}
  assert.equal(polls,1+12*60*2);controller.stop();assert.equal(time.tasks.size,0);
});

test('coalescing writer bounds durable writes and never overlaps them',async()=>{
  const time=new ManualTime();let writes=0,active=0,maxActive=0;
  const scheduler=createCoalescingWriteScheduler({write:async()=>{writes++;active++;maxActive=Math.max(maxActive,active);await Promise.resolve();active--;},now:time.now,setTimer:time.setTimeout,clearTimer:time.clearTimeout,delayMs:30_000,maxWaitMs:30_000});
  for(let elapsed=0;elapsed<12*60*60_000;elapsed+=30_000){for(let update=0;update<100;update++)scheduler.markDirty('competitor-snapshot');await time.advance(30_000);assert.ok(time.tasks.size<=1);}
  assert.equal(writes,12*60*2);assert.equal(maxActive,1);assert.equal(scheduler.state().writeCount,writes);await scheduler.stop();assert.equal(time.tasks.size,0);
});

test('backup scheduler hook distinguishes healthy scheduling, overdue backup, and failure',()=>{
  const time=new ManualTime(Date.parse('2026-08-20T06:00:00Z')),health=createBackupSchedulerHealth({now:time.now,expectedHeartbeatMs:5*60_000,backupDueAfterMs:2*60*60_000});health.beginSession({sessionId:'run-3',startedAt:new Date(time.now()).toISOString()});
  for(let hour=0;hour<12;hour++){for(let tick=0;tick<12;tick++){time.value+=5*60_000;health.heartbeat();}health.backupStarted();health.backupCompleted({filename:`hour-${hour+1}.cmapday.zip`});}
  assert.equal(health.state().schedulerStatus,'healthy');assert.equal(health.state().backupStatus,'current');
  time.value+=11*60_000;assert.equal(health.state().schedulerStatus,'stalled');
  time.value+=2*60*60_000;assert.equal(health.state().backupStatus,'overdue');health.backupStarted();health.backupFailed(new Error('quota'));assert.equal(health.state().backupStatus,'failed');assert.equal(health.state().lastError,'quota');
});
