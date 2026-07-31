import {test,expect} from '@playwright/test';

const uniqueName=testInfo=>`CannonMapDB-lifecycle-${testInfo.project.name}-${Date.now()}-${Math.random()}`;
test.beforeEach(async({page})=>page.goto('/'));

test('v7 migration adds empty lifecycle state without changing existing data',async({page},testInfo)=>{
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
    const database=await module.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name});
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
      transitionId:'t1',fromProjectId:'p1',toProjectId:'p2',stage:'opening',
      startedAt:'2026-07-30T12:01:00.000Z',updatedAt:'2026-07-30T12:01:00.000Z'
    });
    database.close();database=await open();repository=module.createProjectLifecycleRepository({database});
    const answer={active:await repository.getActiveProjectId(),transition:await repository.getTransition()};
    await repository.completeTransition('p2','2026-07-30T12:02:00.000Z');
    answer.completed={active:await repository.getActiveProjectId(),transition:await repository.getTransition()};
    database.close();return answer;
  },uniqueName(testInfo));
  expect(result.active).toBe('p1');
  expect(result.transition).toMatchObject({fromProjectId:'p1',toProjectId:'p2',stage:'opening'});
  expect(result.completed).toEqual({active:'p2',transition:null});
});

test('restart reconciliation clears missing and archived active identities but preserves a valid active Project',async({page},testInfo)=>{
  const result=await page.evaluate(async baseName=>{
    const [dbModule,managerModule,scopeModule,eventModule]=await Promise.all([
      import('/src/infrastructure/indexeddb/index.js'),
      import('/src/application/project-lifecycle-manager.js'),
      import('/src/application/project-repository-scope.js'),
      import('/src/core/event-bus.js')
    ]);
    const run=async(kind,setup)=>{
      const name=`${baseName}-${kind}`;
      let database=await dbModule.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name});
      const repositories=()=>({
        projects:dbModule.createProjectRepository({database,createId:()=>crypto.randomUUID()}),
        lifecycle:dbModule.createProjectLifecycleRepository({database}),
        legacy:dbModule.createLegacyCurrentProjectRepository({database}),
        deletion:dbModule.createProjectDeletionRepository({database})
      });
      let repos=repositories();await setup(repos);
      const makeManager=()=>managerModule.createProjectLifecycleManager({
        projectRepository:repos.projects,projectDeletionRepository:repos.deletion,
        lifecycleRepository:repos.lifecycle,legacyCurrentRepository:repos.legacy,
        scopeFactory:projectId=>scopeModule.createProjectRepositoryScope({projectId}),
        eventBus:eventModule.createEventBus(),clock:{iso:()=>new Date(0).toISOString()},
        createId:()=>crypto.randomUUID()
      });
      const first=await makeManager().initialize();
      const firstState={active:await repos.lifecycle.getActiveProjectId(),legacy:await repos.legacy.get()};
      database.close();
      database=await dbModule.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name});
      repos=repositories();
      const second=await makeManager().initialize();
      const secondState={active:await repos.lifecycle.getActiveProjectId(),legacy:await repos.legacy.get()};
      const projects=(await repos.projects.list()).map(project=>({id:project.projectId,status:project.lifecycleStatus||null}));
      database.close();
      return {first:first?.projectId||null,second:second?.projectId||null,firstState,secondState,projects};
    };
    return {
      missing:await run('missing',async repos=>{
        await repos.lifecycle.completeTransition('missing',new Date(0).toISOString());
        await repos.legacy.save({id:'missing',projectId:'missing',name:'Stale'});
        await repos.projects.create({id:'other',name:'Other'});
      }),
      archived:await run('archived',async repos=>{
        const project=await repos.projects.create({id:'archived',name:'Archived'});
        await repos.projects.archive('archived',new Date(0).toISOString());
        await repos.lifecycle.completeTransition('archived',new Date(0).toISOString());
        await repos.legacy.save(project);
      }),
      valid:await run('valid',async repos=>{
        const project=await repos.projects.create({id:'valid',name:'Valid'});
        await repos.lifecycle.completeTransition('valid',new Date(0).toISOString());
        await repos.legacy.save({...project,name:'Stale'});
        void project;
      })
    };
  },uniqueName(testInfo));
  expect(result.missing).toMatchObject({
    first:null,second:null,firstState:{active:null,legacy:null},secondState:{active:null,legacy:null},
    projects:[{id:'other',status:null}]
  });
  expect(result.archived).toMatchObject({
    first:null,second:null,firstState:{active:null,legacy:null},secondState:{active:null,legacy:null},
    projects:[{id:'archived',status:'archived'}]
  });
  expect(result.valid).toMatchObject({
    first:'valid',second:'valid',firstState:{active:'valid'},secondState:{active:'valid'}
  });
  expect(result.valid.firstState.legacy.projectId).toBe('valid');
  expect(result.valid.firstState.legacy.name).toBe('Valid');
  expect(result.valid.secondState.legacy.projectId).toBe('valid');
  expect(result.valid.secondState.legacy.name).toBe('Valid');
});

test('Project create is unique under concurrency and save remains an explicit update',async({page},testInfo)=>{
  const result=await page.evaluate(async name=>{
    const module=await import('/src/infrastructure/indexeddb/index.js');
    const database=await module.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name});
    const make=()=>module.createProjectRepository({database,createId:()=>crypto.randomUUID()});
    const [first,second]=await Promise.allSettled([
      make().create({id:'same',name:'First'}),make().create({id:'same',name:'Second'})
    ]);
    const repository=make(),before=await repository.get('same');
    const updated=await repository.save({...before,name:'Updated'});
    const answer={
      statuses:[first.status,second.status].sort(),
      errorCode:[first,second].find(item=>item.status==='rejected')?.reason?.code,
      beforeName:before.name,updatedName:updated.name,count:(await repository.list()).length
    };
    database.close();return answer;
  },uniqueName(testInfo));
  expect(result.statuses).toEqual(['fulfilled','rejected']);
  expect(result.errorCode).toBe('PROJECT_ALREADY_EXISTS');
  expect(['First','Second']).toContain(result.beforeName);
  expect(result).toMatchObject({updatedName:'Updated',count:1});
});

test('atomic deletion removes one complete Project and preserves every other Project',async({page},testInfo)=>{
  const result=await page.evaluate(async name=>{
    const module=await import('/src/infrastructure/indexeddb/index.js');
    const database=await module.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name});
    const projects=module.createProjectRepository({database,createId:()=>crypto.randomUUID()});
    const journal=module.createJournalRepository({database});
    const analytics=module.createAnalyticsRepository(database);
    const search=module.createSearchRepository({database});
    const legacy=module.createLegacyCurrentProjectRepository({database});
    const lifecycle=module.createProjectLifecycleRepository({database});
    const p1=await projects.create({id:'p1',name:'One'}),p2=await projects.create({id:'p2',name:'Two'});
    await legacy.save(p1);await lifecycle.completeTransition('p1','2026-07-30T12:00:00Z');
    await journal.appendEvents([
      {eventId:'e1',projectId:'p1',timestamp:'2026-07-30T12:00:00Z',createdAt:'2026-07-30T12:00:00Z'},
      {eventId:'e2',projectId:'p2',timestamp:'2026-07-30T12:00:00Z',createdAt:'2026-07-30T12:00:00Z'}
    ]);
    for(const [projectId,number] of [['p1','1'],['p2','2']])await analytics.appendSampleAndStats({
      sample:{sessionId:`s${number}`,sampleId:`a${number}`,projectId,occurredAt:'2026-07-30T12:00:00Z'},
      event:{sessionId:`s${number}`,telemetryEventId:`t${number}`,projectId,occurredAt:'2026-07-30T12:00:00Z'},
      session:{rallyEventId:`r${number}`,sessionId:`s${number}`,projectId,status:'complete'},
      daily:{sessionId:`s${number}`,dayKey:'1',projectId,rallyEventId:`r${number}`}
    });
    const document=projectId=>({
      projectId,sourceType:'project',sourceId:projectId,title:projectId,normalizedTitle:projectId,
      normalizedContent:'',terms:[projectId],scopedTerms:[`${projectId}\u0000${projectId}`],schemaVersion:1
    });
    for(const id of ['p1','p2'])await search.replaceProjectIndex({
      projectId:id,revision:`r-${id}`,indexVersion:1,documents:[document(id)],builtAt:'2026-07-30T12:00:00Z'
    });
    const deleted=await module.createProjectDeletionRepository({database}).deleteProject('p1');
    const read=store=>new Promise((resolve,reject)=>{
      const request=database.transaction(store).objectStore(store).getAll();
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    const answer={
      deleted,projects:(await projects.list()).map(project=>project.projectId),
      journal:(await journal.getAllEvents()).map(event=>event.projectId),
      analytics:{
        samples:(await read('telemetrySamples')).map(value=>value.projectId),
        events:(await read('telemetryEvents')).map(value=>value.projectId),
        sessions:(await read('analyticsSessions')).map(value=>value.projectId),
        daily:(await read('analyticsDailyStats')).map(value=>value.projectId)
      },
      search:(await search.listIndexStates()).map(state=>state.projectId),
      legacy:await legacy.get(),active:await lifecycle.getActiveProjectId(),otherName:(await projects.get(p2.projectId)).name
    };
    database.close();return answer;
  },uniqueName(testInfo));
  expect(result).toEqual({
    deleted:true,projects:['p2'],journal:['p2'],
    analytics:{samples:['p2'],events:['p2'],sessions:['p2'],daily:['p2']},
    search:['p2'],legacy:null,active:null,otherName:'Two'
  });
});

test('failure at every destructive boundary aborts deletion and leaves the complete Project intact',async({page},testInfo)=>{
  const result=await page.evaluate(async baseName=>{
    const module=await import('/src/infrastructure/indexeddb/index.js'),outcomes=[];
    for(const boundary of module.PROJECT_DELETION_BOUNDARIES){
      const database=await module.openIndexedDbV2({
        indexedDB,featureFlags:{isEnabled:()=>true},databaseName:`${baseName}-${boundary}`
      });
      const projects=module.createProjectRepository({database,createId:()=>crypto.randomUUID()});
      const project=await projects.create({id:'p1',name:'One'});
      await module.createLegacyCurrentProjectRepository({database}).save(project);
      await module.createProjectLifecycleRepository({database}).completeTransition('p1','2026-07-30T12:00:00Z');
      await module.createJournalRepository({database}).appendEvent({
        eventId:'e1',projectId:'p1',timestamp:'2026-07-30T12:00:00Z',createdAt:'2026-07-30T12:00:00Z'
      });
      await module.createAnalyticsRepository(database).appendSampleAndStats({
        sample:{sessionId:'s1',sampleId:'a1',projectId:'p1',occurredAt:'2026-07-30T12:00:00Z'},
        event:{sessionId:'s1',telemetryEventId:'t1',projectId:'p1',occurredAt:'2026-07-30T12:00:00Z'},
        session:{rallyEventId:'r1',sessionId:'s1',projectId:'p1',status:'complete'},
        daily:{sessionId:'s1',dayKey:'1',projectId:'p1',rallyEventId:'r1'}
      });
      await module.createSearchRepository({database}).replaceProjectIndex({
        projectId:'p1',revision:'r1',indexVersion:1,builtAt:'2026-07-30T12:00:00Z',documents:[{
          projectId:'p1',sourceType:'project',sourceId:'p1',title:'One',normalizedTitle:'one',
          normalizedContent:'',terms:['one'],scopedTerms:['p1\u0000one'],schemaVersion:1
        }]
      });
      let error;
      try{
        await module.createProjectDeletionRepository({
          database,onBoundary:name=>{if(name===boundary)throw new Error(`fail:${name}`);}
        }).deleteProject('p1');
      }catch(value){error=value.message;}
      const counts={};
      for(const store of ['projectRecords','journalEvents','telemetrySamples','telemetryEvents','analyticsSessions','analyticsDailyStats','searchDocuments','searchIndexState']){
        counts[store]=await new Promise((resolve,reject)=>{
          const request=database.transaction(store).objectStore(store).count();
          request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
        });
      }
      outcomes.push({
        boundary,error,counts,
        legacy:Boolean(await module.createLegacyCurrentProjectRepository({database}).get()),
        active:await module.createProjectLifecycleRepository({database}).getActiveProjectId()
      });
      database.close();
    }
    return outcomes;
  },uniqueName(testInfo));
  expect(result).toHaveLength(10);
  for(const outcome of result){
    expect(outcome.error).toBe(`fail:${outcome.boundary}`);
    expect(Object.values(outcome.counts)).toEqual([1,1,1,1,1,1,1,1]);
    expect(outcome).toMatchObject({legacy:true,active:'p1'});
  }
});
