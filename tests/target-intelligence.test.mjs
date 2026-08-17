import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeCompetitorTarget,buildTargetActivity,mergeRecentTargetActivity} from '../src/domain/competitors/target-intelligence.js';

const origin={lat:38.5,lon:-81.0};
const point=(meters,time,speedMph=null)=>({lat:origin.lat,lon:origin.lon+meters/(111320*Math.cos(origin.lat*Math.PI/180)),time:new Date(time).toISOString(),speedMph});
const objective={id:'D02-029',geometry:{coordinates:[origin]}};

test('Event 60 rider 246 crosses within ten feet, decelerates, dwells, and departs without upstream speed',()=>{
  const start=Date.parse('2026-08-17T14:00:00Z'),points=[];
  [35,29,23,17,11,5,-1].forEach((meters,index)=>points.push(point(meters,start+index*1000,null)));
  for(let second=7;second<=167;second++)points.push(point(-25+(second%2)*0.2,start+second*1000,null));
  points.push(point(-90,start+177000,null),point(-180,start+187000,null));
  const result=analyzeCompetitorTarget({id:'rider-246',number:'246',points},objective,{now:start+188000,minimumDwellMs:30000});
  assert.equal(result.riderNumber,'246');assert.ok(result.closestApproachMeters<3.5);assert.equal(result.stoppedNearTarget,true);
  assert.ok(result.dwellDurationMs>=150000);assert.ok(result.departureTimestamp);assert.ok(result.speedAtClosestMph>12&&result.speedAtClosestMph<15);
});

test('approach, intersection, departure, and multiple rider convergence remain distinct',()=>{
  const start=Date.parse('2026-08-17T15:00:00Z');
  const approaching={id:'299',number:'299',points:[point(3000,start),point(2500,start+30000),point(2000,start+60000)]};
  let result=analyzeCompetitorTarget(approaching,objective,{now:start+60000});assert.equal(result.state,'approaching-target');
  const passed={id:'246',number:'246',points:[point(200,start),point(5,start+30000),point(-300,start+60000)]};
  const rows=buildTargetActivity([approaching,passed],objective,{now:start+60000});
  assert.equal(rows.length,2);assert.deepEqual(new Set(rows.map(row=>row.riderNumber)),new Set(['246','299']));assert.equal(rows.find(row=>row.riderNumber==='246').state,'departed-target');
});

test('teleport and telemetry gaps do not fabricate speed or target intersection',()=>{
  const start=Date.parse('2026-08-17T16:00:00Z');
  const gap=analyzeCompetitorTarget({id:'gap',points:[point(500,start),point(5,start+5*60000)]},objective,{now:start+5*60000});
  assert.equal(gap.speedAtClosestMph,null);assert.equal(gap.gapCount,1);
  const teleport=analyzeCompetitorTarget({id:'teleport',points:[point(20000,start),point(5,start+1000)]},objective,{now:start+1000});
  assert.equal(teleport.meaningfulIntersection,false);assert.equal(teleport.gapCount,1);
});

test('recent target activity merge is idempotent across restart restoration',()=>{
  const start=Date.parse('2026-08-17T17:00:00Z'),activity=buildTargetActivity([{id:'246',number:'246',points:[point(100,start),point(2,start+1000),point(-100,start+2000)]}],objective,{now:start+3000});
  const once=mergeRecentTargetActivity([],activity,{now:start+3000}),restored=JSON.parse(JSON.stringify(once)),twice=mergeRecentTargetActivity(restored,activity,{now:start+3000});
  assert.equal(once.length,1);assert.equal(twice.length,1);assert.equal(twice[0].activityId,once[0].activityId);
});
