import assert from 'node:assert/strict';
import test from 'node:test';
import {createClock} from '../src/core/clock.js';
import {createCoreCompatibility} from '../src/core/compatibility.js';
import {createEventBus} from '../src/core/event-bus.js';
import {InvariantError} from '../src/core/errors.js';
import {createIdFactory} from '../src/core/ids.js';
import {createStateStore} from '../src/core/state-store.js';
import {distancePointToSegmentMiles,haversineMeters,lineDistanceMiles,validPoint} from '../src/domain/geo/geometry.js';

test('clock has deterministic millisecond, ISO, and Date projections',()=>{
  const clock=createClock({now:()=>1_700_000_000_000});
  assert.equal(clock.now(),1_700_000_000_000);
  assert.equal(clock.iso(),'2023-11-14T22:13:20.000Z');
  assert.equal(clock.date().getTime(),1_700_000_000_000);
});

test('ID factory prefers UUID and preserves the legacy fallback format',()=>{
  assert.equal(createIdFactory({randomUUID:()=>'stable-id'})(),'stable-id');
  assert.equal(createIdFactory({randomUUID:null,now:()=>123,random:()=>0.5})(),'123-8');
});

test('geometry utilities preserve golden distances and validate coordinates',()=>{
  const chicago={lat:41.8781,lon:-87.6298},milwaukee={lat:43.0389,lon:-87.9065};
  assert.ok(Math.abs(haversineMeters(chicago,milwaukee)-131019)<100);
  assert.ok(Math.abs(lineDistanceMiles([chicago,milwaukee])-81.411)<0.1);
  assert.equal(distancePointToSegmentMiles({lat:0.5,lon:0.5},{lat:0,lon:0},{lat:0,lon:1})>34,true);
  assert.equal(validPoint({lat:90,lon:-180}),true);
  assert.equal(validPoint({lat:91,lon:0}),false);
});

test('event bus publishes immutable events synchronously',()=>{
  const bus=createEventBus(),calls=[];
  bus.subscribe('project.saved',event=>calls.push(event));
  const event=bus.publish({
    type:'project.saved',eventId:'evt-1',entityId:'project-1',occurredAt:123,
    correlationId:'corr-1',causationId:null,schemaVersion:1,payload:{name:'Test'}
  });
  assert.equal(calls.length,1);
  assert.equal(calls[0],event);
  assert.equal(Object.isFrozen(event),true);
  assert.equal(Object.isFrozen(event.payload),true);
});

test('event bus duplicate subscription keys fail in development mode',()=>{
  const bus=createEventBus({detectDuplicateKeys:true});
  bus.subscribe('project.saved',()=>{},{key:'render-project'});
  assert.throws(()=>bus.subscribe('project.saved',()=>{},{key:'render-project'}),InvariantError);
});

test('state store runs pure reducers, logs mutations, and supports unsubscribe',()=>{
  const store=createStateStore({
    initialState:{count:0},
    reducers:{increment:(state,action)=>({...state,count:state.count+action.payload})}
  });
  const changes=[],unsubscribe=store.subscribe(next=>changes.push(next.count));
  store.dispatch({type:'increment',payload:2});
  unsubscribe();store.dispatch({type:'increment',payload:3});
  assert.deepEqual(store.getState(),{count:5});
  assert.deepEqual(changes,[2]);
  assert.deepEqual(store.mutationLog().map(item=>item.type),['increment','increment']);
});

test('compatibility facade preserves legacy state defaults and exposes core seams',()=>{
  const core=createCoreCompatibility({
    appVersion:'0.7.1',now:()=>1_700_000_000_000,randomUUID:()=>'id-1'
  });
  assert.equal(core.state,core.store.getState());
  assert.equal(core.state.project.version,'0.7.1');
  assert.equal(core.state.project.createdAt,'2023-11-14T22:13:20.000Z');
  assert.equal(core.state.settings.dayFilter,'all');
  assert.deepEqual(core.state.project.features,[]);
  assert.equal(core.ids.create(),'id-1');
});
