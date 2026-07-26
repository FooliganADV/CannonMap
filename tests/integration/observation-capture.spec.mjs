import {test,expect} from '@playwright/test';

const FLAG='architecture.observation.capture';
const databaseName='CannonMapDB';

test.beforeEach(async({page,context})=>{
  await context.setOffline(false);
  await page.addInitScript(flag=>{globalThis.__CANNONMAP_FEATURE_FLAGS__={[flag]:true};},FLAG);
  await page.goto('/');
  await page.waitForFunction(()=>window.CannonMapTest?.observationCaptureDiagnostics().initialized===true);
});

test('captures observed GPS evidence and a durable outbox item while offline',async({page,context})=>{
  await context.setOffline(true);
  const result=await page.evaluate(async()=>window.CannonMapTest.captureGpsObservation(
    {timestamp:Date.now(),coords:{latitude:39.7392,longitude:-104.9903,accuracy:8,altitude:null,altitudeAccuracy:null,heading:null,speed:null}},
    {eventId:'m5-event',riderId:'local-rider',deviceSessionId:'browser-test',sequence:1,captureSource:'test.geolocation'}
  ));
  expect(result.status).toBe('persisted');
  const stored=await page.evaluate(async name=>{
    const database=await new Promise((resolve,reject)=>{const request=indexedDB.open(name);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const read=store=>new Promise((resolve,reject)=>{const request=database.transaction(store).objectStore(store).getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const observations=await read('observations'),outbox=await read('observationOutbox');
    database.close();
    return {observations,outbox};
  },databaseName);
  expect(stored.observations).toHaveLength(1);
  expect(stored.outbox).toHaveLength(1);
  expect(stored.observations[0].observed.location).toEqual({lat:39.7392,lon:-104.9903});
  expect(stored.observations[0].derived.quality.classification).toBe('accepted');
  expect(stored.outbox[0].idempotencyKey).toBe(`observation:m5-event:${stored.observations[0].observationId}`);
  await context.setOffline(false);
});

test('stable capture identity is idempotent across a reload and legacy project save remains compatible',async({page})=>{
  const input={
    position:{timestamp:Date.now(),coords:{latitude:40,longitude:-105,accuracy:10}},
    capture:{eventId:'m5-recovery',riderId:'local-rider',deviceSessionId:'stable-session',sequence:2,captureSource:'test.geolocation'}
  };
  expect((await page.evaluate(input=>window.CannonMapTest.captureGpsObservation(input.position,input.capture),input)).status).toBe('persisted');
  await page.reload();
  await page.waitForFunction(()=>window.CannonMapTest?.observationCaptureDiagnostics().initialized===true);
  const retry=await page.evaluate(input=>window.CannonMapTest.captureGpsObservation(input.position,input.capture),input);
  expect(retry.status).toBe('persisted');
  expect(retry.duplicate).toBe(true);
  await page.evaluate(()=>{
    const input=document.querySelector('#projectName');
    input.value='M5 compatibility';
    input.dispatchEvent(new Event('change'));
  });
  await expect(page.locator('#status')).not.toContainText('Save failed');
});
