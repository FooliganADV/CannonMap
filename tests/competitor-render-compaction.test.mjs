import test from 'node:test';
import assert from 'node:assert/strict';
import {compactTrailSegmentsForRender} from '../src/domain/competitors/trails.js';

const now=Date.parse('2026-08-20T18:00:00.000Z');
const point=(seconds,index,extra={})=>({
  lat:30+index/1_000_000,
  lon:-90+index/2_000_000,
  time:new Date(now-seconds*1000).toISOString(),
  observationId:`render-${index}`,
  ...extra
});

test('segment-first compaction retains geometry, endpoints, dense recent history, and source objects',()=>{
  const points=Array.from({length:12_000},(_,index)=>point(11_999-index,index));
  const spike=points[3_777]={...points[3_777],lat:30.2};
  const segments=[points.slice(0,4_000),points.slice(4_000,8_000),points.slice(8_000)];
  const before=segments.map(segment=>segment.map(item=>item.observationId));
  const compacted=compactTrailSegmentsForRender(segments,{now,maxRenderPoints:720,recentMs:5*60_000,maxRecentPoints:360});
  const rendered=compacted.flat(),renderedSet=new Set(rendered),recent=points.filter(item=>Date.parse(item.time)>=now-5*60_000);

  assert.equal(rendered.length,720);
  assert.equal(compacted.length,3);
  assert.ok(renderedSet.has(spike),'the highest-deviation tactical shape point should survive');
  for(const segment of segments){assert.ok(renderedSet.has(segment[0]));assert.ok(renderedSet.has(segment.at(-1)));}
  for(const item of recent)assert.ok(renderedSet.has(item),'one-second samples in the newest five minutes stay dense');
  assert.ok(rendered.every(item=>points.includes(item)),'rendering reuses source point objects rather than synthesizing positions');
  assert.deepEqual(segments.map(segment=>segment.map(item=>item.observationId)),before,'source segments remain untouched');
});

test('compaction is deterministic and never merges distinct tactical segments',()=>{
  const segments=[
    Array.from({length:2_000},(_,index)=>point(7_999-index,index,{sessionId:'a'})),
    Array.from({length:2_000},(_,index)=>point(5_999-index,index+2_000,{sessionId:'b'})),
    Array.from({length:4_000},(_,index)=>point(3_999-index,index+4_000,{sessionId:'b'}))
  ];
  const options={now,maxRenderPoints:180,recentMs:60_000,maxRecentPoints:60};
  const first=compactTrailSegmentsForRender(segments,options),second=compactTrailSegmentsForRender(segments,options);

  assert.deepEqual(first.map(segment=>segment.map(item=>item.observationId)),second.map(segment=>segment.map(item=>item.observationId)));
  assert.deepEqual(first.map(segment=>segment[0].sessionId),['a','b','b']);
  assert.deepEqual(first.map(segment=>segment.at(-1).sessionId),['a','b','b']);
  assert.equal(first.flat().length,180);
});

test('an endpoint-saturated history drops whole oldest segments instead of drawing a cross-gap chord',()=>{
  const segments=Array.from({length:400},(_,segmentIndex)=>[
    point(800-segmentIndex*2,segmentIndex*2,{sessionId:`session-${segmentIndex}`}),
    point(799-segmentIndex*2,segmentIndex*2+1,{sessionId:`session-${segmentIndex}`})
  ]);
  const compacted=compactTrailSegmentsForRender(segments,{now,maxRenderPoints:720,recentMs:60_000,maxRecentPoints:60});

  assert.equal(compacted.length,360);
  assert.equal(compacted.flat().length,720);
  assert.equal(compacted[0][0],segments[40][0]);
  assert.ok(compacted.every(segment=>segment.length===2&&segment[0].sessionId===segment[1].sessionId));
});
