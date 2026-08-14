import assert from 'node:assert/strict';
import test from 'node:test';
import {createGpsFollowController} from '../src/application/gps-follow-controller.js';

function fakeMap({programmaticZoomEvent=false}={}){
  const handlers={};return {handlers,views:[],zoom:15,on(name,fn){handlers[name]=fn;},off(name,fn){if(handlers[name]===fn)delete handlers[name];},getSize:()=>({x:390,y:844}),getZoom(){return this.zoom;},
    project:([lat,lon],zoom)=>({x:lon*1000*zoom/15,y:lat*-1000*zoom/15}),unproject:(point,zoom)=>({lat:point.y/-1000*15/zoom,lon:point.x/1000*15/zoom}),
    setView(center,zoom,options){if(programmaticZoomEvent&&zoom!==this.zoom)handlers.zoomstart?.({type:'zoomstart',sourceTarget:this});this.zoom=zoom;this.views.push({center,zoom,options});}};
}

test('continuous GPS movement follows at the forward-visibility offset and smooths samples',()=>{
  const map=fakeMap(),follow=createGpsFollowController({map,smoothing:.5});
  const first=follow.update({lat:40,lon:-90,heading:0}),second=follow.update({lat:40.002,lon:-89.998,heading:10});
  assert.equal(map.views.length,2);assert.ok(Math.abs(second.lat-40.001)<1e-9);assert.ok(Math.abs(second.lon+89.999)<1e-9);assert.equal(first.lat,40);
  assert.ok(map.views[1].center.lat>second.lat,'map center is north of rider so rider renders below center');
});

test('manual pan suspends follow, GPS button and orientation restore it',()=>{
  const map=fakeMap(),follow=createGpsFollowController({map});follow.update({lat:40,lon:-90});
  map.handlers.dragstart({originalEvent:{}});follow.update({lat:41,lon:-91});assert.equal(map.views.length,1);assert.equal(follow.state().following,false);
  follow.restore('gps-button');assert.equal(map.views.length,2);assert.equal(follow.state().following,true);
  follow.orientationChanged();assert.equal(map.views.length,3);assert.equal(follow.state().following,true);
});

test('caller-owned target zoom changes are stepped and rate limited',()=>{
  let timestamp=1000;const map=fakeMap(),follow=createGpsFollowController({map,minZoomIntervalMs:1800,zoomSmoothing:1,now:()=>timestamp});
  follow.update({lat:40,lon:-90},{targetZoom:12,zoomReason:'checkpoint-ahead'});
  assert.equal(map.views.at(-1).zoom,14);assert.equal(follow.state().targetZoom,12);
  timestamp=2000;follow.update({lat:40.001,lon:-90});assert.equal(map.views.at(-1).zoom,14,'zoom does not change again inside the rate limit');
  timestamp=3000;follow.update({lat:40.002,lon:-90});assert.equal(map.views.at(-1).zoom,13);
  timestamp=5000;follow.update({lat:40.003,lon:-90});assert.equal(map.views.at(-1).zoom,12);
});

test('target zoom can be set independently and cleared without changing follow intent',()=>{
  const map=fakeMap(),follow=createGpsFollowController({map,minZoomIntervalMs:0});
  assert.equal(follow.setTargetZoom(17,{reason:'nearby-turn'}),17);follow.update({lat:40,lon:-90});assert.equal(map.views.at(-1).zoom,16);
  follow.clearTargetZoom();assert.equal(follow.state().targetZoom,null);assert.equal(follow.state().following,true);
});

test('target zoom respects map zoom limits',()=>{
  const map=fakeMap();map.getMinZoom=()=>5;map.getMaxZoom=()=>18;const follow=createGpsFollowController({map});
  assert.equal(follow.setTargetZoom(2),5);assert.equal(follow.setTargetZoom(22),18);
});

test('programmatic zoom events do not suspend follow',()=>{
  const map=fakeMap({programmaticZoomEvent:true}),follow=createGpsFollowController({map,minZoomIntervalMs:0});
  follow.update({lat:40,lon:-90},{targetZoom:13});
  assert.equal(map.views.at(-1).zoom,14);assert.equal(follow.state().following,true);
});

test('application-owned map changes use the same guard and do not suspend follow',()=>{
  const map=fakeMap({programmaticZoomEvent:true}),follow=createGpsFollowController({map});follow.update({lat:40,lon:-90});let calls=0;
  follow.performProgrammaticMapChange(()=>map.setView({lat:39,lon:-89},12,{animate:false}),{reason:'checkpoint-focus'});
  follow.performProgrammaticMapChange(()=>{calls++;},{reason:'void-map-operation'});
  assert.equal(calls,1);assert.equal(map.views.at(-1).zoom,12);assert.equal(follow.state().following,true);
});

test('manual zoom suspends follow and GPS restore re-enables it',()=>{
  const map=fakeMap(),follow=createGpsFollowController({map,minZoomIntervalMs:0});follow.update({lat:40,lon:-90},{targetZoom:13});
  map.handlers.zoomstart({type:'zoomstart'});follow.update({lat:41,lon:-91});assert.equal(map.views.length,1);assert.equal(follow.state().following,false);
  follow.restore('gps-button');assert.equal(map.views.length,2);assert.equal(follow.state().following,true);assert.equal(map.views.at(-1).zoom,13);
});

test('destroy removes both manual gesture listeners',()=>{
  const map=fakeMap(),follow=createGpsFollowController({map});follow.destroy();assert.equal(map.handlers.dragstart,undefined);assert.equal(map.handlers.zoomstart,undefined);
});
