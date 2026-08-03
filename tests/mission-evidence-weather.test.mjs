import test from 'node:test';
import assert from 'node:assert/strict';
import {captureArrivalEvidence} from '../src/application/arrival-evidence.js';
import {createWeatherMaintenance,WEATHER_CACHE_KEY} from '../src/application/weather-maintenance.js';
import {buildPhotoEvidenceMetadata,photoEvidenceOverlayEntries} from '../src/application/photo-evidence-service.js';

test('arrival evidence freezes rolling speed and fresh heading at arrival',()=>{
  const evidence=captureArrivalEvidence({lat:1,lon:2,speedMps:10,heading:90,accuracyFeet:12,time:'2026-08-03T12:00:00.000Z'},Date.parse('2026-08-03T12:00:05.000Z'));
  assert.equal(Math.round(evidence.speedMph),22);assert.equal(evidence.motion,'moving');assert.equal(evidence.heading,90);assert.equal(evidence.sampleAgeMs,5000);
});

test('stationary and stale samples never expose misleading direction',()=>{
  const stopped=captureArrivalEvidence({speedMps:.1,heading:180,time:'2026-08-03T12:00:00Z'},Date.parse('2026-08-03T12:00:01Z'));
  const stale=captureArrivalEvidence({speedMps:5,heading:180,time:'2026-08-03T12:00:00Z'},Date.parse('2026-08-03T12:01:00Z'));
  assert.deepEqual([stopped.speedMph,stopped.motion,stopped.heading],[0,'stationary',null]);assert.equal(stale.heading,null);
  assert.deepEqual(captureArrivalEvidence({time:'2026-08-03T12:00:00Z'},Date.parse('2026-08-03T12:00:01Z')).speedMph,null);
});

test('hotel evidence renders hotel, speed, GPS sample and unavailable values',()=>{
  const metadata=buildPhotoEvidenceMetadata({eventName:'Hotel Arrival',capturedAt:'2026-08-03T12:00:00Z',speedMph:0,motion:'stationary',gpsSampleTimestamp:'2026-08-03T11:59:59Z',gpsSampleAgeMs:1000});
  const entries=new Map(photoEvidenceOverlayEntries(metadata));assert.match(entries.get('Hotel'),/Unavailable/);assert.match(entries.get('Speed / Motion'),/0 mph/);assert.match(entries.get('GPS Sample'),/1.0 sec/);
});

test('weather maintenance refreshes on startup, time, distance and stale arrival without duplicate requests',async()=>{
  let now=0,calls=0;const storage=new Map(),api={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
  const service=createWeatherMaintenance({clock:{now:()=>now},storage:api,online:()=>true,visible:()=>true,distanceMeters:(a,b)=>Math.abs(a.lon-b.lon)*160934.4,
    fetchWeather:async()=>{calls++;return {temperature:72,condition:'Clear'};}});
  await service.onGps({lat:0,lon:0},{moving:true});assert.equal(calls,1);
  now=10*60*1000;await service.onGps({lat:0,lon:0},{moving:true});assert.equal(calls,2);
  now+=1000;await service.onGps({lat:0,lon:.11},{moving:false});assert.equal(calls,3);
  now+=10*60*1000;await service.onArrival({lat:0,lon:.11});assert.equal(calls,4);assert.ok(storage.has(WEATHER_CACHE_KEY));
});

test('weather restores bounded cached context offline and never blocks callers',()=>{
  const saved=JSON.stringify({temperature:55,condition:'Rain',fetchedAt:'2026-08-03T12:00:00Z',requestCoordinates:{lat:1,lon:2}}),storage={getItem:()=>saved,setItem(){}};
  const service=createWeatherMaintenance({storage,online:()=>false,visible:()=>true,distanceMeters:()=>0,fetchWeather:async()=>{throw new Error('offline');}});
  assert.deepEqual(service.restore(),{temperature:55,condition:'Rain',fetchedAt:'2026-08-03T12:00:00Z',requestCoordinates:{lat:1,lon:2},cached:true,offline:true});
});
