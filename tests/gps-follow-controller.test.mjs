import assert from 'node:assert/strict';
import test from 'node:test';
import {createGpsFollowController} from '../src/application/gps-follow-controller.js';

function fakeMap(){
  const handlers={};return {handlers,views:[],on(name,fn){handlers[name]=fn;},off(){},getSize:()=>({x:390,y:844}),getZoom:()=>15,
    project:([lat,lon])=>({x:lon*1000,y:lat*-1000}),unproject:point=>({lat:point.y/-1000,lon:point.x/1000}),setView(center){this.views.push(center);}};
}

test('continuous GPS movement follows at the forward-visibility offset and smooths samples',()=>{
  const map=fakeMap(),follow=createGpsFollowController({map,smoothing:.5});
  const first=follow.update({lat:40,lon:-90,heading:0}),second=follow.update({lat:40.002,lon:-89.998,heading:10});
  assert.equal(map.views.length,2);assert.ok(Math.abs(second.lat-40.001)<1e-9);assert.ok(Math.abs(second.lon+89.999)<1e-9);assert.equal(first.lat,40);
  assert.ok(map.views[1].lat>second.lat,'map center is north of rider so rider renders below center');
});

test('manual pan suspends follow, GPS button and orientation restore it',()=>{
  const map=fakeMap(),follow=createGpsFollowController({map});follow.update({lat:40,lon:-90});
  map.handlers.dragstart({originalEvent:{}});follow.update({lat:41,lon:-91});assert.equal(map.views.length,1);assert.equal(follow.state().following,false);
  follow.restore('gps-button');assert.equal(map.views.length,2);assert.equal(follow.state().following,true);
  follow.orientationChanged();assert.equal(map.views.length,3);assert.equal(follow.state().following,true);
});
