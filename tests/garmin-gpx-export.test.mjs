import assert from 'node:assert/strict';
import test from 'node:test';
import {buildGarminGpx,formatGarminWaypointName,garminCategories,garminSymbol,selectGarminFeatures} from '../src/domain/gpx/garmin-export.js';

const point=(id,name,type,extra={})=>({id,name,type,day:1,notes:'Don’t stop & look <behind>',geometry:{kind:'point',coordinates:[{lat:30.401324,lon:-90.120646}]},...extra});
const line=(id,name,type,count=3)=>({id,name,type,day:1,notes:`${type} notes`,geometry:{kind:'line',coordinates:Array.from({length:count},(_,index)=>({lat:30+index/1000,lon:-90-index/1000}))}});
const build=(features,options={})=>buildGarminGpx({project:{name:'Mandeville Test'},features,appVersion:'0.7.1',exportedAt:'2026-08-02T12:00:00.000Z',options});

test('Garmin GPX uses GPX 1.1 namespaces and standard waypoint metadata',()=>{
  const xml=build([point('cp','1.1','checkpoint',{points:10})]);
  assert.match(xml,/<gpx version="1.1" creator="CannonMap 0.7.1"/);
  assert.match(xml,/xmlns:gpxx="http:\/\/www\.garmin\.com\/xmlschemas\/GpxExtensions\/v3"/);
  assert.match(xml,/<name>1\.1<\/name>/);assert.match(xml,/<cmt>Don’t stop &amp; look &lt;behind&gt;<\/cmt>/);
  assert.match(xml,/<desc>Checkpoint \| 1\.1 \| Day 1 \| 10 points<\/desc>/);
  assert.match(xml,/<sym>Flag, Blue<\/sym>/);assert.match(xml,/<type>Checkpoint<\/type>/);
  assert.match(xml,/<gpxx:Category>Day 1<\/gpxx:Category>/);assert.match(xml,/<gpxx:Category>Checkpoint<\/gpxx:Category>/);
});

test('central symbol mapping covers supported Garmin waypoint types with safe fallback',()=>{
  assert.equal(garminSymbol({type:'checkpoint'}),'Flag, Blue');assert.equal(garminSymbol({type:'fuel'}),'Gas Station');
  assert.equal(garminSymbol({type:'hotel'}),'Lodging');assert.equal(garminSymbol({type:'start'}),'Flag, Green');
  assert.equal(garminSymbol({type:'finish'}),'Flag, Red');assert.equal(garminSymbol({type:'unknown'}),'Waypoint');
});

test('waypoint presets omit absent points and remain extensible',()=>{
  const cp=point('cp','1.1','checkpoint',{day:2,points:10});
  assert.equal(formatGarminWaypointName(cp,'name'),'1.1');assert.equal(formatGarminWaypointName(cp,'dayName'),'D2-1.1');
  assert.equal(formatGarminWaypointName(cp,'namePoints'),'1.1-10');assert.equal(formatGarminWaypointName(cp,'dayNamePoints'),'D2-1.1-10');
  assert.equal(formatGarminWaypointName(point('wp','Gas','fuel',{day:0}),'dayNamePoints'),'Gas');
});

test('duplicate waypoint names receive deterministic numeric suffixes',()=>{
  const xml=build([point('a','CP01','checkpoint'),point('b','CP01','checkpoint')]);
  assert.match(xml,/<name>CP01<\/name>/);assert.match(xml,/<name>CP01-2<\/name>/);
});

test('routes, tracks, backbones, and track segments preserve geometry',()=>{
  const route=line('route','Test','route',134),track=line('track','Trail','track',4),backbone=line('backbone','Backbone','backbone',5);
  track.geometry.segments=[[{lat:1,lon:2},{lat:3,lon:4}],[{lat:5,lon:6},{lat:7,lon:8}]];
  const xml=build([route,track,backbone]);
  assert.equal((xml.match(/<rtept /g)||[]).length,134);assert.equal((xml.match(/<trkseg>/g)||[]).length,3);
  assert.equal((xml.match(/<trkpt /g)||[]).length,9);assert.doesNotMatch(xml,/<wpt [^>]*>[^]*?<name>Test<\/name>/);
});

test('geometry counts never become rally points',()=>{
  const xml=build([point('cp','1.1','checkpoint',{points:10}),line('route','134 Coordinate Route','route',134)]);
  assert.match(xml,/10 points/);assert.doesNotMatch(xml,/134 points/);assert.doesNotMatch(xml,/<cannonmap:points>/);
});

test('scope and include controls select only requested days and feature types',()=>{
  const features=[point('d1','D1','checkpoint'),point('d2','D2','fuel',{day:2}),line('r2','Route 2','route',2)];features[2].day=2;
  assert.deepEqual(selectGarminFeatures(features,{scope:'current',currentDay:2}).map(item=>item.id),['d2','r2']);
  assert.deepEqual(selectGarminFeatures(features,{scope:'selected',selectedDays:[1],include:{checkpoint:true,fuel:false,route:false}}).map(item=>item.id),['d1']);
  assert.deepEqual(garminCategories(features[1]),['Day 2','Fuel']);
});

test('empty selections fail with a useful message',()=>assert.throws(()=>build([],{}),/No features match/));
