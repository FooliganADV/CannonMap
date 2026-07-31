import {test,expect} from '@playwright/test';

const uniqueName=testInfo=>`CannonMapDB-journal-${testInfo.project.name}-${Date.now()}-${Math.random()}`;
const id=number=>`00000000-0000-4000-8000-${String(number).padStart(12,'0')}`;

test.beforeEach(async({page})=>page.goto('/'));

test('v5 migration is additive, creates no events, and preserves existing project authority',async({page},testInfo)=>{
  const result=await page.evaluate(async name=>{
    const legacy=await new Promise((resolve,reject)=>{
      const request=indexedDB.open(name,4);
      request.onupgradeneeded=()=>request.result.createObjectStore('projects');
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    await new Promise((resolve,reject)=>{
      const transaction=legacy.transaction('projects','readwrite');
      transaction.objectStore('projects').put({id:'legacy',name:'Preserved'},'current');
      transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);
    });
    legacy.close();
    const module=await import('/src/infrastructure/indexeddb/index.js');
    const database=await module.openIndexedDbV2({
      indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name
    });
    const transaction=database.transaction(['projects','journalEvents'],'readonly');
    const request=(store,key)=>new Promise((resolve,reject)=>{
      const operation=key===undefined?store.getAll():store.get(key);
      operation.onsuccess=()=>resolve(operation.result);operation.onerror=()=>reject(operation.error);
    });
    const [project,events]=await Promise.all([
      request(transaction.objectStore('projects'),'current'),
      request(transaction.objectStore('journalEvents'))
    ]);
    const answer={version:database.version,project,events,stores:[...database.objectStoreNames]};
    database.close();
    return answer;
  },uniqueName(testInfo));
  expect(result.version).toBe(5);
  expect(result.project).toEqual({id:'legacy',name:'Preserved'});
  expect(result.events).toEqual([]);
  expect(result.stores).toContain('journalEvents');
});

test('repository orders events, isolates projects, supports queries, and recovers after reopen',async({page},testInfo)=>{
  const result=await page.evaluate(async({name,ids})=>{
    const module=await import('/src/infrastructure/indexeddb/index.js');
    const open=()=>module.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name});
    let database=await open();
    let repository=module.createJournalRepository({database});
    const event=(eventId,projectId,timestamp,eventType)=>({
      eventId,projectId,timestamp,eventType,source:'test',title:'',summary:'',
      metadata:{},references:{},attachments:{},createdAt:timestamp,schemaVersion:1
    });
    await repository.appendEvents([
      event(ids[1],'project-1','2026-07-30T18:00:00.000Z','road_hazard'),
      event(ids[0],'project-1','2026-07-30T17:00:00.000Z','unknown_future_event'),
      event(ids[2],'project-2','2026-07-30T16:00:00.000Z','road_hazard')
    ]);
    database.close();
    database=await open();
    repository=module.createJournalRepository({database});
    const project=await repository.getEventsByProject('project-1');
    const hazards=await repository.getEventsByType('road_hazard',{projectId:'project-1'});
    const range=await repository.getEventsByTimeRange({
      projectId:'project-1',from:'2026-07-30T16:30:00.000Z',to:'2026-07-30T17:30:00.000Z'
    });
    const restored=await repository.getEvent(ids[0]);
    database.close();
    return {
      project:project.map(item=>item.eventId),hazards:hazards.map(item=>item.eventId),
      range:range.map(item=>item.eventId),restored
    };
  },{name:uniqueName(testInfo),ids:[id(1),id(2),id(3)]});
  expect(result.project).toEqual([id(1),id(2)]);
  expect(result.hazards).toEqual([id(2)]);
  expect(result.range).toEqual([id(1)]);
  expect(result.restored.eventType).toBe('unknown_future_event');
});

test('batch append and explicit transaction rollback never leave partial journal history',async({page},testInfo)=>{
  const result=await page.evaluate(async({name,ids})=>{
    const module=await import('/src/infrastructure/indexeddb/index.js');
    const database=await module.openIndexedDbV2({
      indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name
    });
    const repository=module.createJournalRepository({database});
    const event=eventId=>({
      eventId,projectId:'project-1',timestamp:'2026-07-30T17:00:00.000Z',
      eventType:'system_event',source:'test',title:'',summary:'',metadata:{},
      references:{},attachments:{},createdAt:'2026-07-30T17:00:00.000Z',schemaVersion:1
    });
    await repository.appendEvent(event(ids[0]));
    let batchRolledBack=false,transactionRolledBack=false;
    try{await repository.appendEvents([event(ids[1]),event(ids[0])]);}catch(_){batchRolledBack=true;}
    try{
      await repository.transact(async transaction=>{
        await transaction.appendEvent(event(ids[2]));
        throw new Error('abort');
      });
    }catch(_){transactionRolledBack=true;}
    const events=await repository.getAllEvents();
    database.close();
    return {batchRolledBack,transactionRolledBack,ids:events.map(item=>item.eventId)};
  },{name:uniqueName(testInfo),ids:[id(10),id(11),id(12)]});
  expect(result).toEqual({batchRolledBack:true,transactionRolledBack:true,ids:[id(10)]});
});

test('deleting a project journal leaves every other project untouched',async({page},testInfo)=>{
  const result=await page.evaluate(async({name,ids})=>{
    const module=await import('/src/infrastructure/indexeddb/index.js');
    const database=await module.openIndexedDbV2({
      indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name
    });
    const repository=module.createJournalRepository({database});
    const event=(eventId,projectId)=>({
      eventId,projectId,timestamp:'2026-07-30T17:00:00.000Z',eventType:'system_event',
      source:'test',title:'',summary:'',metadata:{},references:{},attachments:{},
      createdAt:'2026-07-30T17:00:00.000Z',schemaVersion:1
    });
    await repository.appendEvents([event(ids[0],'project-1'),event(ids[1],'project-2')]);
    const deleted=await repository.deleteProjectJournal('project-1');
    const remaining=await repository.getAllEvents();
    database.close();
    return {deleted,remaining:remaining.map(item=>item.projectId)};
  },{name:uniqueName(testInfo),ids:[id(20),id(21)]});
  expect(result).toEqual({deleted:1,remaining:['project-2']});
});
