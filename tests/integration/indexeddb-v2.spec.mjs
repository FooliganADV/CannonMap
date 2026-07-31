import {test,expect} from '@playwright/test';

const uniqueName=testInfo=>`CannonMapDB-M2-${testInfo.project.name}-${testInfo.title}-${Date.now()}-${Math.random()}`;

async function deleteDatabase(page,databaseName){
  await page.evaluate(name=>new Promise((resolve,reject)=>{
    const request=indexedDB.deleteDatabase(name);
    request.onsuccess=()=>resolve();
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('Database deletion blocked.'));
  }),databaseName);
}

test.beforeEach(async({page})=>page.goto('/'));

test('upgrades the legacy database additively and preserves the authoritative project',async({page},testInfo)=>{
  const databaseName=uniqueName(testInfo);
  const result=await page.evaluate(async name=>{
    const legacy=await new Promise((resolve,reject)=>{
      const request=indexedDB.open(name,1);
      request.onupgradeneeded=()=>request.result.createObjectStore('projects');
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
    await new Promise((resolve,reject)=>{
      const transaction=legacy.transaction('projects','readwrite');
      transaction.objectStore('projects').put({id:'legacy',name:'Preserved'},'current');
      transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);
    });
    legacy.close();

    const module=await import('/src/infrastructure/indexeddb/index.js');
    const database=await module.openIndexedDbV2({
      indexedDB,featureFlags:{isEnabled:key=>key===module.V2_FEATURE_FLAG},databaseName:name
    });
    const project=await new Promise((resolve,reject)=>{
      const request=database.transaction('projects').objectStore('projects').get('current');
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    const stores=[...database.objectStoreNames];
    const version=database.version;
    database.close();
    return {project,stores,version,registry:module.SCHEMA_REGISTRY.map(store=>store.name)};
  },databaseName);

  expect(result.version).toBe(3);
  expect(result.project).toEqual({id:'legacy',name:'Preserved'});
  expect(result.stores).toEqual(expect.arrayContaining(result.registry));
  await deleteDatabase(page,databaseName);
});

test('disabled v2 flag leaves a version 1 legacy database untouched',async({page},testInfo)=>{
  const databaseName=uniqueName(testInfo);
  const result=await page.evaluate(async name=>{
    const legacy=await new Promise((resolve,reject)=>{
      const request=indexedDB.open(name,1);
      request.onupgradeneeded=()=>request.result.createObjectStore('projects');
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    legacy.close();
    const module=await import('/src/infrastructure/indexeddb/index.js');
    const opened=await module.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:()=>false},databaseName:name});
    const check=await new Promise((resolve,reject)=>{
      const request=indexedDB.open(name);
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    const answer={opened,version:check.version,stores:[...check.objectStoreNames]};
    check.close();
    return answer;
  },databaseName);
  expect(result).toEqual({opened:null,version:1,stores:['projects']});
  await deleteDatabase(page,databaseName);
});

test('observation and outbox writes are atomic, durable offline, and append-only',async({page},testInfo)=>{
  const databaseName=uniqueName(testInfo);
  const result=await page.evaluate(async name=>{
    const module=await import('/src/infrastructure/indexeddb/index.js');
    const database=await module.openIndexedDbV2({
      indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name
    });
    const now=1000;
    const observation={
      schemaVersion:1,createdAt:now,updatedAt:now,eventId:'event-1',observationId:'obs-1',
      riderId:'rider-1',occurredAt:now,deviceSessionId:'session-1',sequence:1,syncState:'pending'
    };
    const outboxItem={
      schemaVersion:1,createdAt:now,updatedAt:now,eventId:'event-1',
      idempotencyKey:'event-1:obs-1',state:'pending',nextAttemptAt:now
    };
    await module.appendObservationWithOutbox(database,{observation,outboxItem});
    let duplicateError=false;
    try{
      await module.appendObservationWithOutbox(database,{
        observation:{...observation,observationId:'obs-rolled-back'},
        outboxItem:{...outboxItem}
      });
    }catch(_){duplicateError=true;}
    const repositories=module.createDomainRepositories(database);
    const observations=await repositories.observations.getAll();
    const outbox=await repositories.observationOutbox.getAll();
    database.close();
    return {duplicateError,observations,outbox};
  },databaseName);

  expect(result.duplicateError).toBeTruthy();
  expect(result.observations.map(item=>item.observationId)).toEqual(['obs-1']);
  expect(result.outbox.map(item=>item.idempotencyKey)).toEqual(['event-1:obs-1']);
  await deleteDatabase(page,databaseName);
});

test('interrupted migration resumes from its durable checkpoint without data loss',async({page},testInfo)=>{
  const databaseName=uniqueName(testInfo);
  const result=await page.evaluate(async name=>{
    const module=await import('/src/infrastructure/indexeddb/index.js');
    const database=await module.openIndexedDbV2({
      indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name
    });
    const source=['a','b','c','d','e'];
    let fail=true;
    const copyBatch=async({cursor,batchSize})=>{
      const start=cursor||0;
      if(start===2&&fail){fail=false;throw new Error('simulated interruption');}
      const records=source.slice(start,start+batchSize);
      const transaction=database.transaction('projects','readwrite');
      const store=transaction.objectStore('projects');
      for(const value of records)store.put({id:value,value},`migration:${value}`);
      await new Promise((resolve,reject)=>{
        transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);
      });
      return {records,cursor:start+records.length,done:start+records.length>=source.length};
    };
    const clock={value:0,now(){return ++this.value;}};
    const runner=module.createMigrationRunner({database,clock});
    let interrupted=false;
    try{await runner.run({id:'legacy-copy',schemaVersion:2,batchSize:2,runBatch:copyBatch});}
    catch(_){interrupted=true;}
    const afterFailure=await runner.checkpoint('legacy-copy');
    const complete=await runner.run({id:'legacy-copy',schemaVersion:2,batchSize:2,runBatch:copyBatch});
    const projects=await new Promise((resolve,reject)=>{
      const request=database.transaction('projects').objectStore('projects').getAll();
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    database.close();
    return {interrupted,afterFailure,complete,values:projects.map(item=>item.value).sort()};
  },databaseName);

  expect(result.interrupted).toBeTruthy();
  expect(result.afterFailure).toMatchObject({cursor:2,processed:2,state:'running'});
  expect(result.complete).toMatchObject({cursor:5,processed:5,state:'complete'});
  expect(result.values).toEqual(['a','b','c','d','e']);
  await deleteDatabase(page,databaseName);
});
