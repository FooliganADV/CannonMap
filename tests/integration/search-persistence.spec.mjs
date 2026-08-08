import {test,expect} from '@playwright/test';

const uniqueName=testInfo=>`CannonMapDB-search-${testInfo.project.name}-${Date.now()}-${Math.random()}`;
test.beforeEach(async({page})=>page.goto('/'));

test('v6 migration adds empty search stores without changing projects or journal history',async({page},testInfo)=>{
  const result=await page.evaluate(async name=>{
    const legacy=await new Promise((resolve,reject)=>{
      const request=indexedDB.open(name,5);
      request.onupgradeneeded=()=>{
        request.result.createObjectStore('projects');
        request.result.createObjectStore('journalEvents',{keyPath:'eventId'});
      };
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    await new Promise((resolve,reject)=>{
      const transaction=legacy.transaction(['projects','journalEvents'],'readwrite');
      transaction.objectStore('projects').put({id:'legacy',name:'Preserved'},'current');
      transaction.objectStore('journalEvents').add({eventId:'event-1',projectId:'legacy'});
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
      version:database.version,projects:await read('projects'),journal:await read('journalEvents'),
      search:await read('searchDocuments'),state:await read('searchIndexState')
    };
    database.close();return answer;
  },uniqueName(testInfo));
  expect(result).toEqual({
    version:11,projects:[{id:'legacy',name:'Preserved'}],
    journal:[{eventId:'event-1',projectId:'legacy'}],search:[],state:[]
  });
});

test('IndexedDB search is project-scoped by default and supports explicit partial all-project search',async({page},testInfo)=>{
  const result=await page.evaluate(async name=>{
    const [databaseModule,serviceModule]=await Promise.all([
      import('/src/infrastructure/indexeddb/index.js'),
      import('/src/application/search-service.js')
    ]);
    const database=await databaseModule.openIndexedDbV2({
      indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name
    });
    const repository=databaseModule.createSearchRepository({database});
    const service=serviceModule.createSearchService({repository,clock:{iso:()=>new Date().toISOString()}});
    await service.rebuildProject({project:{
      projectId:'p1',name:'Utah Rally',features:[{id:'cp-1',type:'checkpoint',name:'Balcony Arch'}]
    }});
    await service.rebuildProject({project:{
      projectId:'p2',name:'Colorado Rally',features:[{id:'cp-2',type:'checkpoint',name:'Balcony House'}]
    }});
    const scoped=await service.search('lcon',{projectId:'p1'});
    const all=await service.search('lcon',{allProjects:true});
    database.close();
    return {
      scoped:scoped.map(item=>item.sourceId),
      all:all.map(item=>`${item.projectId}:${item.sourceId}`)
    };
  },uniqueName(testInfo));
  expect(result.scoped).toEqual(['cp-1']);
  expect(result.all).toEqual(['p1:cp-1','p2:cp-2']);
});

test('rebuild removes stale projections and failed replacement preserves the last complete index',async({page},testInfo)=>{
  const result=await page.evaluate(async name=>{
    const [databaseModule,serviceModule,domainModule]=await Promise.all([
      import('/src/infrastructure/indexeddb/index.js'),
      import('/src/application/search-service.js'),
      import('/src/domain/search/index.js')
    ]);
    const database=await databaseModule.openIndexedDbV2({
      indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name
    });
    const repository=databaseModule.createSearchRepository({database});
    const service=serviceModule.createSearchService({repository,clock:{iso:()=>new Date().toISOString()}});
    await service.rebuildProject({project:{
      projectId:'p1',name:'Rally',features:[{id:'cp-1',type:'checkpoint',name:'Old Pass'}]
    }});
    await service.rebuildProject({project:{
      projectId:'p1',name:'Rally',features:[{id:'cp-2',type:'checkpoint',name:'New Pass'}]
    }});
    const stale=(await service.search('old',{projectId:'p1'})).length;
    const fresh=(await service.search('new',{projectId:'p1'})).map(item=>item.sourceId);
    const duplicate=domainModule.createSearchDocument({
      projectId:'p1',sourceType:'checkpoint',sourceId:'duplicate',title:'Broken replacement'
    });
    let rolledBack=false;
    try{
      await repository.replaceProjectIndex({
        projectId:'p1',revision:'broken',indexVersion:1,builtAt:new Date().toISOString(),
        documents:[duplicate,duplicate]
      });
    }catch(_){rolledBack=true;}
    const afterFailure=(await service.search('new',{projectId:'p1'})).map(item=>item.sourceId);
    const state=await service.getIndexState('p1');
    database.close();
    return {stale,fresh,rolledBack,afterFailure,stateRevision:state.revision};
  },uniqueName(testInfo));
  expect(result.stale).toBe(0);
  expect(result.fresh).toEqual(['cp-2']);
  expect(result.rolledBack).toBe(true);
  expect(result.afterFailure).toEqual(['cp-2']);
  expect(result.stateRevision).not.toBe('broken');
});
