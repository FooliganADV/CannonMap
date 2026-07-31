import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>page.goto('/'));

test('raw telemetry and derived statistics persist separately and active sessions recover without GPX replay',async({page},testInfo)=>{
  const databaseName=`CannonMapDB-analytics-${testInfo.project.name}-${Date.now()}-${Math.random()}`;
  const result=await page.evaluate(async name=>{
    const indexed=await import('/src/infrastructure/indexeddb/index.js');
    const application=await import('/src/application/rally-analytics-service.js');
    const database=await indexed.openIndexedDbV2({
      indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name
    });
    let nextId=0;
    const options={
      clock:{now:()=>Date.parse('2026-07-29T10:00:00Z'),iso:()=>'2026-07-29T10:00:00.000Z'},
      createId:()=>`id-${++nextId}`,
      featureFlags:{isEnabled:key=>key===application.RALLY_ANALYTICS_FEATURE_FLAG},
      persistence:indexed.createAnalyticsRepository(database)
    };
    const service=application.createRallyAnalyticsService(options);
    const started=await service.startSession({rallyEventId:'event-1',riderId:'rider-1'});
    await service.recordGpsSample({
      occurredAt:'2026-07-29T10:00:00Z',latitude:35,longitude:-85,
      speedMetersPerSecond:10,elevationMeters:100,accuracyMeters:4,headingDegrees:90
    },{routeProgress:{checkpointId:'cp-1',distanceToCheckpointMiles:5}});
    await service.recordGpsSample({
      occurredAt:'2026-07-29T10:01:00Z',latitude:35.005,longitude:-85,
      speedMetersPerSecond:10,elevationMeters:110,accuracyMeters:5,headingDegrees:90
    },{routeProgress:{checkpointId:'cp-1',distanceToCheckpointMiles:4.6}});
    await service.recordCheckpointEvent({checkpointId:'cp-1',action:'completed',points:10});
    await service.recordWeatherSnapshot({temperature_2m:80},{extensions:{source:'test'}});
    await service.flush();

    const recoveredService=application.createRallyAnalyticsService({...options,createId:()=>`recovered-${++nextId}`});
    const recovered=await recoveredService.recover({rallyEventId:'event-1'});
    const snapshot=recoveredService.snapshot();
    const counts={};
    for(const storeName of ['telemetrySamples','telemetryEvents','analyticsSessions','analyticsDailyStats']){
      counts[storeName]=await new Promise((resolve,reject)=>{
        const request=database.transaction(storeName).objectStore(storeName).count();
        request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
      });
    }
    const stores=[...database.objectStoreNames],version=database.version;
    database.close();
    return {started,recovered,snapshot,counts,stores,version};
  },databaseName);

  expect(result.version).toBe(4);
  expect(result.stores).toEqual(expect.arrayContaining([
    'telemetrySamples','telemetryEvents','analyticsSessions','analyticsDailyStats'
  ]));
  expect(result.started.status).toBe('active');
  expect(result.recovered).toMatchObject({status:'active',sessionId:result.started.sessionId});
  expect(result.snapshot.metrics).toMatchObject({
    sampleCount:2,checkpointsCompleted:1,weatherSnapshotCount:1,routeProgressSampleCount:2
  });
  expect(result.counts).toMatchObject({
    telemetrySamples:2,analyticsSessions:1,analyticsDailyStats:1
  });
  expect(result.counts.telemetryEvents).toBeGreaterThanOrEqual(4);
});
