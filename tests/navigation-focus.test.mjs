import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decideNavigationZoom,
  inferSignificantRouteTurns,
  selectNavigationFocus
} from '../src/domain/geo/navigation-focus.js';

test('turn inference detects meaningful bends and rejects short GPS wiggles',()=>{
  const turns=inferSignificantRouteTurns([
    {lat:0,lon:0},
    {lat:0,lon:.001},
    {lat:.001,lon:.001},
    {lat:.00101,lon:.00101},
    {lat:.00102,lon:.001}
  ]);
  assert.equal(turns.length,1);
  assert.equal(turns[0].index,1);
  assert.equal(turns[0].direction,'left');
  assert.ok(turns[0].turnDegrees>89&&turns[0].turnDegrees<91);
});

test('navigation focus chooses the nearer actionable checkpoint or next route turn',()=>{
  const position={lat:0,lon:0};
  const turn={index:4,point:{lat:0,lon:.004},actionable:true};
  const checkpoint={id:'cp',lat:0,lon:.002,status:'next'};
  const checkpointFocus=selectNavigationFocus({position,checkpoint,routeTurns:[turn],currentRouteIndex:1});
  assert.equal(checkpointFocus.kind,'checkpoint');
  assert.equal(checkpointFocus.target,checkpoint);

  const turnFocus=selectNavigationFocus({
    position,
    checkpoint:{...checkpoint,lon:.008},
    routeTurns:[turn],
    currentRouteIndex:1
  });
  assert.equal(turnFocus.kind,'turn');
  assert.equal(turnFocus.target,turn);
});

test('focus ignores passed turns and terminal checkpoints',()=>{
  const focus=selectNavigationFocus({
    position:{lat:0,lon:0},
    checkpoint:{lat:0,lon:.001,status:'completed'},
    routeTurns:[{index:2,point:{lat:0,lon:.001}}],
    currentRouteIndex:2
  });
  assert.deepEqual(focus,{kind:'none',target:null,distanceMeters:null,reason:'no-actionable-focus'});
});

test('zoom decisions use distance bands, hysteresis, rate limits, and manual override',()=>{
  const initial=decideNavigationZoom({focus:{distanceMeters:100},currentZoom:13,now:10000});
  assert.equal(initial.zoom,17);
  assert.equal(initial.band,'immediate');
  assert.equal(initial.changed,true);

  const edge=decideNavigationZoom({
    focus:{distanceMeters:195},currentZoom:17,
    previous:initial,now:20000
  });
  assert.equal(edge.band,'immediate','hysteresis prevents zoom chatter at the boundary');
  assert.equal(edge.changed,false);

  const farther=decideNavigationZoom({
    focus:{distanceMeters:250},currentZoom:17,
    previous:initial,now:20000
  });
  assert.equal(farther.band,'near');
  assert.equal(farther.zoom,16);

  const rateLimited=decideNavigationZoom({
    focus:{distanceMeters:2500},currentZoom:17,
    previous:initial,now:12000
  });
  assert.equal(rateLimited.changed,false);
  assert.equal(rateLimited.reason,'rate-limited');

  const overridden=decideNavigationZoom({
    focus:{distanceMeters:50},currentZoom:12,
    previous:{band:'overview',lastChangedAt:0},now:5000,manualOverrideUntil:9000
  });
  assert.equal(overridden.zoom,12);
  assert.equal(overridden.reason,'manual-override');
});
