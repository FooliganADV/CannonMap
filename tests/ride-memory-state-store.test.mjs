import assert from 'node:assert/strict';
import test from 'node:test';
import {createRideMemoryStateStore} from '../src/infrastructure/browser/ride-memory-state-store.js';

test('Ride Memory schedule state is isolated by immutable Rally session',async()=>{
  const values=new Map(),storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const store=createRideMemoryStateStore({storage});
  await store.save({schemaVersion:1,sessionId:'run-a',nextScheduledAt:'2026-08-20T13:00:00.000Z'});
  await store.save({schemaVersion:1,sessionId:'run-b',nextScheduledAt:'2026-08-21T13:00:00.000Z'});
  assert.equal((await store.load('run-a')).nextScheduledAt,'2026-08-20T13:00:00.000Z');
  assert.equal((await store.load('run-b')).nextScheduledAt,'2026-08-21T13:00:00.000Z');
  await store.remove('run-a');assert.equal(await store.load('run-a'),null);assert.ok(await store.load('run-b'));
});

test('invalid or foreign stored state cannot contaminate another session',async()=>{
  const values=new Map(),storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
  const store=createRideMemoryStateStore({storage});
  values.set(store.keyForSession('run-a'),'{not json');assert.equal(await store.load('run-a'),null);
  values.set(store.keyForSession('run-a'),JSON.stringify({sessionId:'run-b'}));assert.equal(await store.load('run-a'),null);
});
