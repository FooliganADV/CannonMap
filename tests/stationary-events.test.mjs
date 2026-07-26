import assert from 'node:assert/strict';
import test from 'node:test';
import stationary from '../stationary-events.js';

const {
  detectStationaryEvents,
  updateStationaryEvents,
  signatureIconSpec,
  spreadNearbyEvents,
  zoomToStationaryEvent
}=stationary;
const origin=Date.parse('2026-07-25T12:00:00Z');
const point=(minutes,northMeters=0,eastMeters=0)=>({
  lat:38+northMeters/111320,
  lon:-105+eastMeters/(111320*Math.cos(38*Math.PI/180)),
  time:new Date(origin+minutes*60000).toISOString()
});
const scope={eventId:60,competitorId:7,competitorNumber:11,riderName:'Beau',signature:'#11'};

test('does not create an event before three minutes and creates it at the threshold',()=>{
  assert.equal(detectStationaryEvents([point(0),point(1),point(2.99)],scope).length,0);
  const events=detectStationaryEvents([point(0),point(1),point(3)],scope);
  assert.equal(events.length,1);
  assert.equal(events[0].status,'active');
  assert.equal(events[0].durationMs,180000);
});

test('accepts a 150-meter cluster boundary and rejects sustained movement beyond it',()=>{
  const inside=detectStationaryEvents([point(0),point(1,149),point(3,120),point(4,145)],scope);
  assert.equal(inside.length,1);
  const moving=detectStationaryEvents([point(0),point(1,310),point(2,620),point(3,930)],scope);
  assert.equal(moving.length,0);
});

test('GPS jitter does not repeatedly close and reopen an event',()=>{
  const events=detectStationaryEvents([point(0),point(1,10),point(3,5),point(3.2,0,205),point(4,8)],scope);
  assert.equal(events.length,1);
  assert.equal(events[0].status,'active');
  assert.equal(events[0].startTime,new Date(origin).toISOString());
});

test('two meaningful exit points close the active event',()=>{
  const events=detectStationaryEvents([point(0),point(1),point(3),point(4,0,210),point(4.2,0,230)],scope);
  assert.equal(events.length,1);
  assert.equal(events[0].status,'completed');
  assert.equal(events[0].endTime,new Date(origin+3*60000).toISOString());
});

test('continued stationary breadcrumbs update duration without duplicate events',()=>{
  const first=detectStationaryEvents([point(0),point(3)],scope);
  const updated=detectStationaryEvents([point(0),point(3),point(8,12)],scope,first);
  assert.equal(updated.length,1);
  assert.equal(updated[0].durationMs,8*60000);
  assert.equal(updated[0].id,first[0].id);
});

test('completed events persist locally and remain scoped by rally and competitor',()=>{
  const project={competitors:[{id:'7',number:11,name:'Beau',points:[point(0),point(3),point(4,0,220),point(4.2,0,240)]}],stationaryEvents:[]};
  updateStationaryEvents(project,'60');
  assert.equal(project.stationaryEvents[0].status,'completed');
  project.competitors[0].points=[point(10)];
  updateStationaryEvents(project,'60');
  assert.equal(project.stationaryEvents.length,1);
  project.competitors.push({id:'8',number:8,name:'Simon',points:[point(0),point(3)]});
  updateStationaryEvents(project,'61');
  assert.ok(project.stationaryEvents.some(event=>event.rallyEventId==='60'&&event.competitorId==='7'));
  assert.ok(project.stationaryEvents.some(event=>event.rallyEventId==='61'&&event.competitorId==='8'));
});

test('tap-to-zoom centers at building inspection zoom without changing base layer',()=>{
  const calls=[],map={setView(center,zoom){calls.push({center,zoom});}};
  const event={center:{lat:38.1,lon:-105.2}};
  zoomToStationaryEvent(map,event);
  assert.deepEqual(calls,[{center:[38.1,-105.2],zoom:18}]);
});

test('signature styling is large and does not use a fuel icon',()=>{
  const spec=signatureIconSpec({signature:'#11',riderName:'Beau'});
  assert.equal(spec.label,'#11');
  assert.ok(spec.size>=44);
  assert.doesNotMatch(`${spec.label} ${spec.className} ${spec.title}`,/fuel|gas/i);
});

test('multiple nearby events receive distinct tappable display positions',()=>{
  const events=[
    {id:'a',center:{lat:38,lon:-105}},
    {id:'b',center:{lat:38.00001,lon:-105.00001}},
    {id:'c',center:{lat:38.00002,lon:-105.00002}}
  ];
  const spread=spreadNearbyEvents(events);
  assert.equal(new Set(spread.map(event=>`${event.displayCenter.lat},${event.displayCenter.lon}`)).size,3);
});
