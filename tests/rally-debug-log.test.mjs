import assert from 'node:assert/strict';import test from 'node:test';
import {createRallyDebugLog} from '../src/application/rally-debug-log.js';

test('Rally Debug Log is bounded, durable, exportable, and strips image data',()=>{
  const values=new Map(),storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)},clock={iso:()=> '2026-08-03T00:00:00.000Z'};
  const log=createRallyDebugLog({storage,limit:2,clock});log.record('one',{image:'secret',accuracy:10});log.record('two');log.record('three');
  assert.deepEqual(log.entries().map(item=>item.type),['two','three']);assert.doesNotMatch(log.exportJson(),/secret/);
  assert.equal(createRallyDebugLog({storage,limit:2,clock}).entries().length,2);
});
