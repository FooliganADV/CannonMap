import {expect,test} from '@playwright/test';

const uniqueName=testInfo=>`CannonMapTemplates-${testInfo.project.name}-${testInfo.workerIndex}-${Date.now()}`;

test.beforeEach(async({page})=>page.goto('/'));

test('v8 migration is additive, empty, indexed, and idempotent',async({page},testInfo)=>{
  const result=await page.evaluate(async name=>{
    const legacy=await new Promise((resolve,reject)=>{
      const request=indexedDB.open(name,7);
      request.onupgradeneeded=()=>{
        const database=request.result;
        database.createObjectStore('projectRecords',{keyPath:'projectId'}).put({projectId:'p1',name:'Preserved'});
      };
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });legacy.close();
    const module=await import('/src/infrastructure/indexeddb/index.js');
    const open=()=>module.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name});
    const first=await open();
    const transaction=first.transaction(['projectRecords','projectTemplates'],'readonly');
    const read=(store,operation)=>new Promise((resolve,reject)=>{
      const request=operation(transaction.objectStore(store));
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    const project=await read('projectRecords',store=>store.get('p1'));
    const templates=await read('projectTemplates',store=>store.getAll());
    const indexes=[...transaction.objectStore('projectTemplates').indexNames];
    const version=first.version;first.close();
    const second=await open(),secondCount=await new Promise((resolve,reject)=>{
      const request=second.transaction('projectTemplates').objectStore('projectTemplates').count();
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });second.close();
    return {version,project,templates,indexes,secondCount};
  },uniqueName(testInfo));
  expect(result).toEqual({
    version:8,project:{projectId:'p1',name:'Preserved'},templates:[],secondCount:0,
    indexes:['isBuiltIn','name','templateType','updatedAt']
  });
});

test('repository protects built-ins and provides create, update, clone, list, and delete',async({page},testInfo)=>{
  const result=await page.evaluate(async name=>{
    const module=await import('/src/infrastructure/indexeddb/index.js');
    const database=await module.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name});
    let id=0,time=0;
    const repository=module.createTemplateRepository({
      database,createId:()=>`template-${++id}`,now:()=>`2026-07-31T12:00:0${time++}.000Z`
    });
    const defaults={
      name:'Custom',description:'User',templateType:'custom',settings:{units:'miles'},
      layerDefaults:{},journalDefaults:{enabled:true},analyticsDefaults:{enabled:true},weatherDefaults:{},
      hazardDefaults:{},checklistDefaults:{},offlineMapDefaults:{},rallyModeDefaults:{},metadata:{}
    };
    const created=await repository.createTemplate({...defaults,templateId:'user-1'});
    let duplicateCode,builtInUpdateCode,builtInDeleteCode;
    try{await repository.createTemplate({...defaults,templateId:'user-1'});}catch(error){duplicateCode=error.code;}
    try{await repository.updateTemplate('builtin.day_ride',{name:'No'});}catch(error){builtInUpdateCode=error.code;}
    try{await repository.deleteTemplate('builtin.day_ride');}catch(error){builtInDeleteCode=error.code;}
    const updated=await repository.updateTemplate('user-1',{name:'Updated',templateType:'future_type'});
    const clone=await repository.cloneTemplate('builtin.day_ride',{templateId:'user-clone'});
    const listBeforeDelete=await repository.listTemplates();
    const deleted=await repository.deleteTemplate('user-1');
    const afterDelete=await repository.getTemplate('user-1');
    database.close();return {
      created,duplicateCode,builtInUpdateCode,builtInDeleteCode,updated,clone,
      list:listBeforeDelete.map(value=>({id:value.templateId,builtIn:value.isBuiltIn,type:value.templateType})),
      deleted,afterDelete
    };
  },uniqueName(testInfo));
  expect(result.created).toMatchObject({templateId:'user-1',isBuiltIn:false,isUserDefined:true});
  expect(result).toMatchObject({
    duplicateCode:'TEMPLATE_ALREADY_EXISTS',builtInUpdateCode:'TEMPLATE_BUILT_IN_IMMUTABLE',
    builtInDeleteCode:'TEMPLATE_BUILT_IN_IMMUTABLE',deleted:true,afterDelete:null
  });
  expect(result.updated).toMatchObject({name:'Updated',templateType:'future_type'});
  expect(result.clone).toMatchObject({templateId:'user-clone',isBuiltIn:false,isUserDefined:true});
  expect(result.list).toEqual(expect.arrayContaining([
    {id:'builtin.adv_cannonball',builtIn:true,type:'adv_cannonball'},
    {id:'builtin.day_ride',builtIn:true,type:'day_ride'},
    {id:'user-1',builtIn:false,type:'future_type'},
    {id:'user-clone',builtIn:false,type:'day_ride'}
  ]));
});

test('concurrent duplicate creation has one winner and repository recovers after reopen',async({page},testInfo)=>{
  const result=await page.evaluate(async name=>{
    const module=await import('/src/infrastructure/indexeddb/index.js');
    const open=()=>module.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name});
    const database=await open(),make=()=>module.createTemplateRepository({
      database,createId:()=>crypto.randomUUID(),now:()=> '2026-07-31T12:00:00.000Z'
    });
    const input={
      templateId:'same',name:'Same',templateType:'custom',settings:{},layerDefaults:{},journalDefaults:{},
      analyticsDefaults:{},weatherDefaults:{},hazardDefaults:{},checklistDefaults:{},offlineMapDefaults:{},
      rallyModeDefaults:{},metadata:{}
    };
    const attempts=await Promise.allSettled([make().createTemplate(input),make().createTemplate(input)]);
    database.close();const reopened=await open();
    const repository=module.createTemplateRepository({
      database:reopened,createId:()=>crypto.randomUUID(),now:()=> '2026-07-31T12:00:01.000Z'
    });
    const recovered=await repository.getTemplate('same');
    const users=(await repository.listTemplates()).filter(template=>template.isUserDefined);
    reopened.close();return {
      statuses:attempts.map(value=>value.status).sort(),
      errorCode:attempts.find(value=>value.status==='rejected')?.reason?.code,recovered,userCount:users.length
    };
  },uniqueName(testInfo));
  expect(result.statuses).toEqual(['fulfilled','rejected']);
  expect(result.errorCode).toBe('TEMPLATE_ALREADY_EXISTS');
  expect(result.recovered.templateId).toBe('same');
  expect(result.userCount).toBe(1);
});

test('Project draft remains unactivated and its Template reference survives Backup metadata export',async({page},testInfo)=>{
  const result=await page.evaluate(async name=>{
    const indexed=await import('/src/infrastructure/indexeddb/index.js');
    const templates=await import('/src/domain/templates/built-ins.js');
    const application=await import('/src/application/project-template-service.js');
    const backup=await import('/src/application/project-backup-service.js');
    const database=await indexed.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name});
    const clock={iso:()=> '2026-07-31T12:00:00.000Z'};
    const draft=application.createProjectTemplateService({createId:()=> 'draft-project',clock})
      .createProjectDraft(templates.getBuiltInTemplate('builtin.adv_cannonball'));
    const before={active:await indexed.createProjectLifecycleRepository({database}).getActiveProjectId()};
    await indexed.createProjectRepository({database,createId:()=>crypto.randomUUID(),now:clock.iso}).create(draft);
    const archive=JSON.parse(await backup.createProjectBackupService({
      backupRepository:indexed.createBackupRepository({database}),projectLifecycle:{flush:async()=>{}},
      clock,applicationVersion:'0.7.0',schemaVersion:8
    }).exportProject(draft.projectId));
    const after={active:await indexed.createProjectLifecycleRepository({database}).getActiveProjectId()};
    database.close();return {draft,before,after,reference:archive.data.templateReference};
  },uniqueName(testInfo));
  expect(result.before.active).toBeNull();expect(result.after.active).toBeNull();
  expect(result.draft).toMatchObject({projectId:'draft-project',journal:[],analytics:{},features:[]});
  expect(result.reference).toMatchObject({
    templateId:'builtin.adv_cannonball',templateType:'adv_cannonball',schemaVersion:1
  });
});
