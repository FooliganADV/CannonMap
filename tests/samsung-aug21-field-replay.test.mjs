import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {createCheckpointArrivalCoordinator} from '../src/application/checkpoint-arrival-coordinator.js';
import * as workflow from '../src/domain/checkpoints/workflow.js';
import {renderRally} from '../src/ui/rally/presenter.js';

const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const checkpoint=(id,sequence,status=sequence===1?'active':'upcoming')=>workflow.normalizeCheckpoint({id,name:`${id} ${id==='R02'?'DIRT':'SCORE'}`,type:'checkpoint',day:1,sequence,originalSequence:sequence,status,photoRequired:true,points:10,geometry:{kind:'point',coordinates:[{lat:30.3,lon:-89.7-sequence*.05}]}});

test('All Days is planner-only and Rally rendering requires an explicit executable day',()=>{assert.equal(workflow.activeRallyDay({dayFilter:'all'}),null);assert.match(app,/SELECT RALLY DAY/);assert.match(app,/All Days is map\/planning only/);assert.match(app,/executableDay:Boolean\(activeRallyDay\(\)\)/);assert.match(app,/status:'unresolved'/);assert.doesNotMatch(app,/dayFilter === 'all' \? '0'/);});

test('Rally START is disabled when All Days has no executable day',()=>{const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{id,hidden:false,disabled:false,textContent:'',innerHTML:'',value:'',checked:false,dataset:{},classList:{toggle(){}},setAttribute(name,value){this[name]=value;},querySelector(){return null;}});return elements.get(id);};renderRally({getElement:element,escapeHtml:String,model:{day:null,executableDay:false,online:true,gpsStatus:'GPS off',gpsActive:false,score:0,distance:null,next:null,checkpoints:[],warnings:[],pendingEvidence:[],sessionChoice:{show:false},dayPreflight:{},cameraReadiness:{},arrivalRadius:500,maxAccuracy:200}});assert.equal(element('rallyRecenterFab').disabled,true);assert.match(element('rallyRecenterFab')['aria-label'],/Choose a numbered Rally Day/);});

test('physical R01 through R04 replay maintains one normal active successor and no false restoration',async()=>{
  const rows=['R01','R02','R03','R04'].map((id,index)=>checkpoint(id,index+1)),arrivals=[],completions=[],restorations=[];
  const coordinator=createCheckpointArrivalCoordinator({dwellMs:0,persistArrival:async arrival=>{const item=rows.find(row=>row.id===arrival.checkpointId);workflow.recordCheckpointArrivalEvidence(item,{timestamp:arrival.detectedAtIso,latitude:30.308,longitude:-89.745,gpsAccuracyFeet:12,source:'gps-radius-dwell'});workflow.recordDetectedArrival(item,arrival.detectedAtIso);workflow.advanceRouteAfterDetectedArrival(rows,item);arrivals.push(item.id);return {item};},processArrival:async(arrival,{item})=>{const next=workflow.completeCheckpoint(rows,item,arrival.detectedAtIso,{photoRecorded:true,preserveActiveTarget:arrival.outOfOrder});completions.push(item.id);if(arrival.outOfOrder)restorations.push(next?.id);}});
  let observedAt=Date.parse('2026-08-21T14:56:39.338Z');
  for(const expected of rows){const active=rows.find(row=>row.status==='active');assert.equal(active.id,expected.id);const result=coordinator.observe({observedAt:observedAt++,speedMph:58.863,priorTargetId:active.id,detections:[{checkpointId:expected.id,distanceFeet:10,accuracyFeet:12,radiusFeet:500,maxAccuracyFeet:200,eligible:true}]});assert.equal(result.accepted.length,1);assert.equal(result.accepted[0].outOfOrder,false);await coordinator.whenIdle();const activeIds=rows.filter(row=>row.status==='active').map(row=>row.id);assert.ok(activeIds.length<=1,'completion must never create two active targets');}
  assert.deepEqual(arrivals,['R01','R02','R03','R04']);assert.deepEqual(completions,arrivals);assert.deepEqual(restorations,[]);assert.ok(rows.every(row=>row.status==='collected'));
});

test('normal completion cannot infer out-of-order ownership merely because its successor is active',()=>{const body=app.slice(app.indexOf('async function completeCurrentCheckpoint'),app.indexOf('async function deferCurrentCheckpoint'));assert.match(body,/const preserveRouteTarget=Boolean\(preserveActiveTarget\)/);assert.doesNotMatch(body,/preserveActiveTarget\|\|rows\.some/);assert.match(body,/if\(restoredPrior\)await appendRallyJournalEvent\('prior_target_restored'/);});

test('durable manual media is reconciled before any photo_failed projection',()=>{const body=app.slice(app.indexOf('async function addCheckpointCameraSide'),app.indexOf('async function addTestCheckpointCameraPair'));assert.ok(body.indexOf('reconcilePendingCheckpointEvidence')<body.indexOf("rallyDebug.record('photo_failed'"));assert.match(body,/photo_persistence_error_reconciled/);assert.match(app,/const selectedDay=Number\(\$\('createDay'\)\?\.value\),day=Number\.isInteger\(selectedDay\)&&selectedDay>0\?selectedDay:null/);});
