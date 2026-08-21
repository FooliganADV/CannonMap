import assert from 'node:assert/strict';
import test from 'node:test';
import {createScreenWakeLockController} from '../src/application/screen-wake-lock-controller.js';

class FakeDocument{
  constructor(){this.visibilityState='visible';this.listeners=new Map();}
  addEventListener(name,listener){this.listeners.set(name,listener);}
  removeEventListener(name,listener){if(this.listeners.get(name)===listener)this.listeners.delete(name);}
  dispatch(name){this.listeners.get(name)?.();}
}

class FakeSentinel{
  constructor(){this.released=false;this.listeners=new Set();}
  addEventListener(name,listener){if(name==='release')this.listeners.add(listener);}
  removeEventListener(name,listener){if(name==='release')this.listeners.delete(listener);}
  async release(){
    if(this.released)return;
    this.released=true;
    for(const listener of [...this.listeners])listener();
  }
  platformRelease(){return this.release();}
}

test('unsupported Wake Lock is a safe optional state',async()=>{
  const controller=createScreenWakeLockController({wakeLock:null,documentRef:new FakeDocument()});
  const result=await controller.start();
  assert.equal(result.acquired,false);
  assert.equal(result.reason,'unsupported');
  assert.equal(controller.state().supported,false);
  assert.equal(controller.state().desired,true);
  await controller.destroy();
});

test('acquires while Rally Mode is active and reacquires after visibility returns',async()=>{
  const documentRef=new FakeDocument(),sentinels=[];
  const wakeLock={async request(type){assert.equal(type,'screen');const sentinel=new FakeSentinel();sentinels.push(sentinel);return sentinel;}};
  const controller=createScreenWakeLockController({wakeLock,documentRef});
  assert.equal((await controller.start()).acquired,true);
  assert.equal(controller.state().held,true);
  assert.equal(sentinels.length,1);

  documentRef.visibilityState='hidden';
  await sentinels[0].platformRelease();
  assert.equal(controller.state().held,false);
  documentRef.visibilityState='visible';
  documentRef.dispatch('visibilitychange');
  await controller.reacquire('test-await-visibility-request');
  assert.equal(sentinels.length,2);
  assert.equal(controller.state().held,true);

  await controller.stop();
  assert.equal(controller.state().desired,false);
  assert.equal(controller.state().held,false);
  assert.equal(sentinels[1].released,true);
});

test('a wake lock resolving after stop is released instead of leaking',async()=>{
  let resolveRequest;
  const wakeLock={request(){return new Promise(resolve=>{resolveRequest=resolve;});}};
  const controller=createScreenWakeLockController({wakeLock,documentRef:new FakeDocument()});
  const starting=controller.start();
  await controller.stop();
  const lateSentinel=new FakeSentinel();
  resolveRequest(lateSentinel);
  const result=await starting;
  assert.equal(result.acquired,false);
  assert.equal(result.reason,'request-obsolete');
  assert.equal(lateSentinel.released,true);
  assert.equal(controller.state().held,false);
});

test('duplicate start while acquisition is pending reuses the request without invalidating it',async()=>{
  let resolveRequest,requests=0;
  const wakeLock={request(){requests++;return new Promise(resolve=>{resolveRequest=resolve;});}};
  const controller=createScreenWakeLockController({wakeLock,documentRef:new FakeDocument()});
  const first=controller.start('gps-started'),second=controller.start('preflight-retry');
  assert.equal(requests,1);
  const sentinel=new FakeSentinel();resolveRequest(sentinel);
  const [firstResult,secondResult]=await Promise.all([first,second]);
  assert.equal(firstResult.acquired,true);
  assert.equal(secondResult.acquired,true);
  assert.equal(controller.state().held,true);
  assert.equal(sentinel.released,false);
  await controller.destroy();
});

test('pagehide stop followed by pageshow start waits out an obsolete request and reacquires',async()=>{
  const pending=[];let requests=0;
  const wakeLock={request(){requests++;return new Promise(resolve=>pending.push(resolve));}};
  const controller=createScreenWakeLockController({wakeLock,documentRef:new FakeDocument()});
  const firstStart=controller.start('gps-started');
  await controller.stop('page-hidden');
  const restarted=controller.start('page-restored');
  assert.equal(requests,1,'the replacement request waits for the obsolete platform request to settle');

  const obsolete=new FakeSentinel();pending.shift()(obsolete);
  assert.equal((await firstStart).reason,'request-obsolete');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(obsolete.released,true);
  assert.equal(requests,2,'the current generation must reacquire after releasing the obsolete sentinel');

  const current=new FakeSentinel();pending.shift()(current);
  assert.equal((await restarted).acquired,true);
  assert.equal(controller.state().desired,true);
  assert.equal(controller.state().held,true);
  assert.equal(controller.state().requesting,false);
  await controller.destroy();
});

test('permission failure is reported without making Rally Mode fail',async()=>{
  const states=[];
  const controller=createScreenWakeLockController({
    wakeLock:{async request(){throw new Error('NotAllowedError');}},
    documentRef:new FakeDocument(),
    onStateChange:state=>states.push(state)
  });
  const result=await controller.start();
  assert.equal(result.acquired,false);
  assert.equal(result.reason,'request-failed');
  assert.match(controller.state().lastError,/NotAllowedError/);
  assert.ok(states.length>0);
});
