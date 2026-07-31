import {test,expect} from '@playwright/test';

const uniqueName=testInfo=>`CannonMapDB-lifecycle-${testInfo.project.name}-${Date.now()}-${Math.random()}`;
test.beforeEach(async({page})=>page.goto('/'));

test('v7 migration adds empty lifecycle state without changing legacy, Projects, Journal, or Search',async({page},testInfo)=>{
  const result=await page.evaluate(async name=>{
    const legacy=await new Promise((resolve,reject)=>{
      const request=indexedDB.open(name,6);
      request.onupgradeneeded=()=>{
        request.result.createObjectStore('projects');
        request.result.createObjectStore('projectRecords',{keyPath:'projectId'});
        request.result.createObjectStore('journalEvents',{keyPath:'eventId'});
        request.result.createObjectStore('searchDocuments',{keyPath:['projectId','sourceType','sourceId']});
      };
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    await new Promise((resolve,reject)=>{
      const transaction=legacy.transaction(['projects','projectRecords','journalEvents','searchDocuments'],'readwrite');
      transaction.objectStore('projects').put({id:'p1',name:'Legacy'},'current');
      transaction.objectStore('projectRecords').add({projectId:'p1',name:'Project'});
      transaction.objectStore('journalEvents').add({eventId:'e1',projectId:'p1'});
      transaction.objectStore('searchDocuments').add({projectId:'p1',sourceType:'project',sourceId:'p1'});
      transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);
    });
    legacy.close();
    const module=await import('/src/infrastructure/indexeddb/index.js');
    const database=await module.openIndexedDbV2({
      indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name
    });
    const read=store=>new Promise((resolve,reject)=>{
      const request=database.transaction(store).objectStore(store).getAll();
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    const answer={
      version:database.version,legacy:await read('projects'),projects:await read('projectRecords'),
      journal:await read('journalEvents'),search:await read('searchDocuments'),
      lifecycle:await read('projectLifecycleState')
    };
    database.close();return answer;
  },uniqueName(testInfo));
  expect(result).toEqual({
    version:7,legacy:[{id:'p1',name:'Legacy'}],projects:[{projectId:'p1',name:'Project'}],
    journal:[{eventId:'e1',projectId:'p1'}],
    search:[{projectId:'p1',sourceType:'project',sourceId:'p1'}],lifecycle:[]
  });
});

test('active identity and interrupted transition survive repository reopen',async({page},testInfo)=>{
  const result=await page.evaluate(async name=>{
    const module=await import('/src/infrastructure/indexeddb/index.js');
    const open=()=>module.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name});
    let database=await open(),repository=module.createProjectLifecycleRepository({database});
    await repository.completeTransition('p1','2026-07-30T12:00:00.000Z');
    await repository.beginTransition({
      transitionId:'t1',fromProjectId:'p1',toProjectId:'p2',
      stage:'opening',startedAt:'2026-07-30T12:01:00.000Z',updatedAt:'2026-07-30T12:01:00.000Z'
    });
    database.close();
    database=await open();repository=module.createProjectLifecycleRepository({database});
    const answer={active:await repository.getActiveProjectId(),transition:await repository.getTransition()};
    await repository.completeTransition('p2','2026-07-30T12:02:00.000Z');
    answer.completed={active:await repository.getActiveProjectId(),transition:await repository.getTransition()};
    database.close();return answer;
  },uniqueName(testInfo));
  expect(result.active).toBe('p1');
  expect(result.transition).toMatchObject({fromProjectId:'p1',toProjectId:'p2',stage:'opening'});
  expect(result.completed).toEqual({active:'p2',transition:null});
});

test('Project repository archive and delete preserve unrelated Projects and legacy current',async({page},testInfo)=>{
  const result=await page.evaluate(async name=>{
    const module=await import('/src/infrastructure/indexeddb/index.js');
    const database=await module.openIndexedDbV2({
      indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name
    });
    let sequence=0;
    const projects=module.createProjectRepository({
      database,createId:()=>`p${++sequence}`,now:()=>`2026-07-30T12:00:0${sequence}.000Z`
    });
    const legacy=module.createLegacyCurrentProjectRepository({database});
    const first=await projects.save({id:'p1',name:'One'});
    await projects.save({id:'p2',name:'Two'});
    await legacy.save(first);
    await projects.archive('p1','2026-07-30T13:00:00.000Z');
    const deleted=await projects.delete('p2');
    const answer={deleted,projects:await projects.list(),legacy:await legacy.get()};
    database.close();return answer;
  },uniqueName(testInfo));
  expect(result.deleted).toBe(true);
  expect(result.projects).toHaveLength(1);
  expect(result.projects[0]).toMatchObject({projectId:'p1',lifecycleStatus:'archived'});
  expect(result.legacy).toMatchObject({projectId:'p1',name:'One'});
});

test('destroying a project scope removes its Journal, Analytics, and Search projections only',async({page},testInfo)=>{
  const result=await page.evaluate(async name=>{
    const [databaseModule,scopeModule]=await Promise.all([
      import('/src/infrastructure/indexeddb/index.js'),
      import('/src/application/project-repository-scope.js')
    ]);
    const database=await databaseModule.openIndexedDbV2({
      indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name
    });
    const journal=databaseModule.createJournalRepository({database});
    const analytics=databaseModule.createAnalyticsRepository(database);
    const search=databaseModule.createSearchRepository({database});
    await journal.appendEvents([
      {eventId:'e1',projectId:'p1',timestamp:'2026-07-30T12:00:00Z',createdAt:'2026-07-30T12:00:00Z'},
      {eventId:'e2',projectId:'p2',timestamp:'2026-07-30T12:00:00Z',createdAt:'2026-07-30T12:00:00Z'}
    ]);
    await analytics.appendSampleAndStats({sample:{
      sessionId:'s1',sampleId:'a1',projectId:'p1',occurredAt:'2026-07-30T12:00:00Z'
    }});
    const document=projectId=>({
      projectId,sourceType:'project',sourceId:projectId,title:projectId,normalizedTitle:projectId,
      normalizedContent:'',terms:[projectId],scopedTerms:[`${projectId}\u0000${projectId}`],schemaVersion:1
    });
    await search.replaceProjectIndex({
      projectId:'p1',revision:'r1',indexVersion:1,documents:[document('p1')],builtAt:'2026-07-30T12:00:00Z'
    });
    await search.replaceProjectIndex({
      projectId:'p2',revision:'r2',indexVersion:1,documents:[document('p2')],builtAt:'2026-07-30T12:00:00Z'
    });
    const scope=scopeModule.createProjectRepositoryScope({
      projectId:'p1',journalRepository:journal,analyticsRepository:analytics,searchRepository:search
    });
    await scope.destroy();await scope.close();
    const answer={
      journal:(await journal.getAllEvents()).map(event=>event.projectId),
      samples:(await new Promise((resolve,reject)=>{
        const request=database.transaction('telemetrySamples').objectStore('telemetrySamples').getAll();
        request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
      })).map(sample=>sample.projectId),
      search:(await search.listIndexStates()).map(state=>state.projectId)
    };
    database.close();return answer;
  },uniqueName(testInfo));
  expect(result).toEqual({journal:['p2'],samples:[],search:['p2']});
});
