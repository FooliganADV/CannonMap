import assert from 'node:assert/strict';
import test from 'node:test';
import feedModule from '../gps-checkpoints-feed.js';
const {applyFirebaseUpdate,buildStandings,createGPSCheckpointsFeed}=feedModule;

test('applies Firebase put and patch messages',()=>{
  let value=applyFirebaseUpdate({},{path:'/',data:{101:{7:{points:10,date:20}}}});
  value=applyFirebaseUpdate(value,{path:'/101/7',data:{points:21}});
  assert.deepEqual(value,{101:{7:{points:21,date:20}}});
  assert.deepEqual(applyFirebaseUpdate(value,{path:'/101/7',data:null}),{101:{}});
});
test('builds leaderboard totals and latest checkpoint',()=>{
  const [row]=buildStandings([{id:7,competitor_number:11,name:'Beau'}],[{id:101,name:'First'},{id:102,name:'Latest'}],{101:{7:{points:10,date:20}},102:{7:{points:21,date:30}}});
  assert.equal(row.points,31);assert.equal(row.countAchieved,2);assert.equal(row.lastCheckpoint,'Latest');
});
test('seeds metadata, streams locations, and omits fake auth',async()=>{
  const requests=[],responses=[{id:60,name:'Event'},[{id:101,name:'CP'}],[{id:7,name:'Beau'}]];
  class FakeEventSource{static instances=[];constructor(url){this.url=url;this.listeners={};FakeEventSource.instances.push(this);}addEventListener(type,fn){this.listeners[type]=fn;}close(){this.closed=true;}send(type,data){this.listeners[type]({data:JSON.stringify(data)});}}
  const client=createGPSCheckpointsFeed({eventId:60,fetch:async(url,options)=>{requests.push({url,options});return{ok:true,json:async()=>responses.shift()};},EventSource:FakeEventSource,metadataRefreshMs:60000});
  const snapshots=[];client.on('snapshot',x=>snapshots.push(x));await client.start();
  assert.equal(requests.length,3);assert.equal(requests[0].options.headers.Authorization,undefined);
  FakeEventSource.instances.find(x=>x.url.includes('/locations/')).send('put',{path:'/',data:{7:{latitude:38.4,longitude:-105.2,date:123}}});
  assert.deepEqual(snapshots.at(-1).locations,[{id:'7',name:'Beau',lat:38.4,lon:-105.2,time:123}]);
  client.stop();assert.ok(FakeEventSource.instances.every(x=>x.closed));
});
