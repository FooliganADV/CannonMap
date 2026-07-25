import assert from 'node:assert/strict';
import test from 'node:test';
import feedModule from '../gps-checkpoints-feed.js';

const {
  buildStandings,
  createGPSCheckpointsFeed,
  sanitizeCompetitor,
  sanitizeEvent
}=feedModule;

function fakeFirebase(){
  const refs=new Map();
  class Ref{
    constructor(path){this.path=path;this.handlers=new Map();}
    on(event,handler){this.handlers.set(event,[...(this.handlers.get(event)||[]),handler]);}
    off(event,handler){this.handlers.set(event,(this.handlers.get(event)||[]).filter(item=>item!==handler));}
    emit(event,key,value){for(const handler of this.handlers.get(event)||[])handler({key,val:()=>value});}
  }
  const database={ref(path){if(!refs.has(path))refs.set(path,new Ref(path));return refs.get(path);}};
  const app={database:()=>database};
  return {refs,app,initializeApp:()=>app,app:()=>{throw new Error('not initialized');}};
}

test('builds points, completed count, latest checkpoint, and leaderboard order',()=>{
  const rows=buildStandings(
    [{id:7,competitor_number:11,name:'Beau'},{id:8,competitor_number:8,name:'Simon'}],
    [{id:101,name:'First'},{id:102,name:'Latest'}],
    {101:{7:{points:10,date:20},8:{points:10,date:15}},102:{7:{points:21,date:30}}}
  );
  assert.deepEqual(rows.map(row=>row.id),['7','8']);
  assert.equal(rows[0].points,31);
  assert.equal(rows[0].countAchieved,2);
  assert.equal(rows[0].lastCheckpoint,'Latest');
});

test('sanitizers exclude tokens, contact data, and admin credentials',()=>{
  assert.deepEqual(sanitizeCompetitor({id:7,name:'Rider',vehicle:'GS',token:'secret',phone:'555',email:'x@y.test'}),{id:7,name:'Rider',vehicle:'GS'});
  assert.deepEqual(sanitizeEvent({id:60,name:'Event',token:'secret',authorization:'Bearer admin'}),{id:60,name:'Event'});
});

test('uses REST metadata plus Firebase subscriptions and preserves removed locations',async()=>{
  const firebase=fakeFirebase(),requests=[];
  const responses=[
    {id:60,name:'Event',token:'event-secret'},
    [{id:101,name:'CP'}],
    [{id:7,name:'Beau',token:'rider-secret',phone:'555'}]
  ];
  const client=createGPSCheckpointsFeed({
    eventId:60,
    firebase,
    fetch:async(url,options)=>{requests.push({url,options});return{ok:true,json:async()=>responses.shift()};},
    metadataRefreshMs:60000
  });
  const snapshots=[];
  client.on('snapshot',value=>snapshots.push(value));
  await client.start();
  assert.equal(requests.length,3);
  assert.equal(requests[0].options.headers.Authorization,undefined);
  assert.equal(snapshots[0].event.token,undefined);
  assert.equal(snapshots[0].competitors[0].phone,undefined);

  const locations=firebase.refs.get('locations/60');
  locations.emit('child_added','7',{latitude:38.4,longitude:-105.2,date:123});
  assert.deepEqual(snapshots.at(-1).locations,[{id:'7',name:'Beau',lat:38.4,lon:-105.2,time:123}]);
  locations.emit('child_removed','7',null);
  assert.deepEqual(client.snapshot().locations,[{id:'7',name:'Beau',lat:38.4,lon:-105.2,time:123}]);

  const achievements=firebase.refs.get('events/60');
  achievements.emit('value',null,{101:{7:{points:10,date:456}}});
  assert.equal(client.snapshot().standings[0].points,10);
  client.stop();
  assert.ok([...firebase.refs.values()].every(ref=>[...ref.handlers.values()].every(list=>list.length===0)));
});
