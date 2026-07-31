import {expect,test} from '@playwright/test';

const uniqueName=testInfo=>`CannonMapBackup-${testInfo.project.name}-${testInfo.workerIndex}-${Date.now()}`;

async function exercise(page,databaseName,options={}){
  await page.goto('/');
  return page.evaluate(async({databaseName,options})=>{
    const indexed=await import('/src/infrastructure/indexeddb/index.js');
    const app=await import('/src/application/project-backup-service.js');
    const database=await indexed.openIndexedDbV2({
      indexedDB,featureFlags:{isEnabled:()=>true},databaseName
    });
    const projectId='project-1',otherId='project-2',now='2026-07-31T12:00:00.000Z';
    const projects=indexed.createProjectRepository({database,createId:()=>crypto.randomUUID(),now:()=>now});
    const project=await projects.create({
      id:projectId,name:'Rally',features:[
        {id:'route-1',type:'route'},{id:'track-1',type:'track'},
        {id:'waypoint-1',type:'waypoint'},{id:'checkpoint-1',type:'checkpoint'}
      ],journal:[{id:'embedded-journal'}],analytics:{embedded:true},settings:{units:'miles'},
      templateReference:{templateId:'template-1'},offlineMapConfiguration:{region:'north'},
      photos:[{id:'photo-1',uri:'media://one'}]
    });
    const other=await projects.create({id:otherId,name:'Other',features:[],settings:{other:true}});
    const activeProject=options.activeProjectId===projectId?project:other;
    await indexed.createLegacyCurrentProjectRepository({database}).save(activeProject);
    await indexed.createProjectLifecycleRepository({database}).completeTransition(activeProject.projectId,now);
    await indexed.createJournalRepository({database}).appendEvent({
      eventId:'event-1',projectId,timestamp:now,createdAt:now,eventType:'rider_note'
    });
    await indexed.createAnalyticsRepository(database).appendSampleAndStats({
      sample:{projectId,sessionId:'session-1',sampleId:'sample-1',occurredAt:now},
      event:{projectId,sessionId:'session-1',telemetryEventId:'telemetry-1',occurredAt:now},
      session:{projectId,rallyEventId:'rally-1',sessionId:'session-1',status:'complete'},
      daily:{projectId,rallyEventId:'rally-1',sessionId:'session-1',dayKey:'1'}
    });
    await indexed.createSearchRepository({database}).replaceProjectIndex({
      projectId,revision:'source-revision',indexVersion:1,builtAt:now,documents:[{
        projectId,sourceType:'project',sourceId:projectId,title:'Rally',normalizedTitle:'rally',
        normalizedContent:'',terms:['rally'],scopedTerms:[`${projectId}\u0000rally`],schemaVersion:1
      }]
    });
    const repository=indexed.createBackupRepository({
      database,onImportBoundary:options.failBoundary?
        boundary=>{if(boundary===options.failBoundary)throw new Error(`fail:${boundary}`);}:undefined
    });
    const service=app.createProjectBackupService({
      backupRepository:repository,projectLifecycle:{flush:async()=>{}},
      clock:{iso:()=>now},applicationVersion:'0.7.0',schemaVersion:7
    });
    const archive=await service.exportProject(projectId),parsed=JSON.parse(archive);
    if(options.mutateArchive)options.mutateArchive(parsed);
    const readAll=storeName=>new Promise((resolve,reject)=>{
      const request=database.transaction(storeName).objectStore(storeName).getAll();
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    const snapshot=async()=>({
      projects:(await projects.list()).map(value=>({id:value.projectId,name:value.name,settings:value.settings})),
      journal:await readAll('journalEvents'),samples:await readAll('telemetrySamples'),
      events:await readAll('telemetryEvents'),sessions:await readAll('analyticsSessions'),
      daily:await readAll('analyticsDailyStats'),searchDocuments:await readAll('searchDocuments'),
      searchState:await readAll('searchIndexState'),legacy:await indexed.createLegacyCurrentProjectRepository({database}).get(),
      active:await indexed.createProjectLifecycleRepository({database}).getActiveProjectId()
    });
    const before=await snapshot();let result=null,error=null;
    try{result=await service.importProject(options.archive||archive,{mode:options.mode||'replace',dryRun:options.dryRun});}
    catch(value){error={code:value.code,message:value.message};}
    const after=await snapshot();database.close();
    return {archive:parsed,before,after,result,error};
  },{databaseName,options});
}

test('export and replace round-trip preserves Project-owned data and marks Search stale',async({page},testInfo)=>{
  const result=await exercise(page,uniqueName(testInfo));
  expect(result.error).toBeNull();
  expect(result.result).toMatchObject({projectId:'project-1',mode:'replace',replaced:true,searchRebuildRequired:true});
  expect(result.after.projects).toEqual(result.before.projects);
  expect(result.after.journal).toEqual(result.before.journal);
  expect(result.after.samples).toEqual(result.before.samples);
  expect(result.after.events).toEqual(result.before.events);
  expect(result.after.sessions).toEqual(result.before.sessions);
  expect(result.after.daily).toEqual(result.before.daily);
  expect(result.after.searchDocuments).toEqual([]);
  expect(result.after.searchState).toEqual([expect.objectContaining({
    projectId:'project-1',status:'stale',rebuildRequired:true,revision:'source-revision'
  })]);
  expect(result.after.legacy.name).toBe('Other');
  expect(result.after.active).toBe('project-2');
  expect(result.archive.data.templateReference).toEqual({templateId:'template-1'});
  expect(result.archive.data.offlineMapMetadata).toEqual({region:'north'});
  expect(result.archive.data.mediaReferences.photos).toEqual([{id:'photo-1',uri:'media://one'}]);
});

test('create import rejects duplicate identity without changing either Project',async({page},testInfo)=>{
  const result=await exercise(page,uniqueName(testInfo),{mode:'create'});
  expect(result.error.code).toBe('BACKUP_PROJECT_ALREADY_EXISTS');
  expect(result.after).toEqual(result.before);
});

test('replace import rejects the active Project without changing lifecycle or data',async({page},testInfo)=>{
  const result=await exercise(page,uniqueName(testInfo),{mode:'replace',activeProjectId:'project-1'});
  expect(result.error.code).toBe('BACKUP_ACTIVE_PROJECT_REPLACE_FORBIDDEN');
  expect(result.after).toEqual(result.before);
});

test('dry-run validation performs no writes',async({page},testInfo)=>{
  const result=await exercise(page,uniqueName(testInfo),{mode:'replace',dryRun:true});
  expect(result.result).toEqual({valid:true,dryRun:true,mode:'replace',projectId:'project-1'});
  expect(result.after).toEqual(result.before);
});

test('failure at every import boundary rolls back the complete replacement',async({page},testInfo)=>{
  const boundaries=['projectRecord','journalEvents','telemetrySamples','telemetryEvents','analyticsSessions','analyticsDailyStats','searchRebuildMetadata'];
  for(const boundary of boundaries){
    const result=await exercise(page,`${uniqueName(testInfo)}-${boundary}`,{failBoundary:boundary});
    expect(result.error.message).toBe(`fail:${boundary}`);
    expect(result.after).toEqual(result.before);
  }
});

test('valid archive can be imported into a fresh database as a new Project',async({page},testInfo)=>{
  const source=await exercise(page,`${uniqueName(testInfo)}-source`,{dryRun:true});
  const result=await page.evaluate(async({databaseName,archive})=>{
    const indexed=await import('/src/infrastructure/indexeddb/index.js');
    const app=await import('/src/application/project-backup-service.js');
    const database=await indexed.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:()=>true},databaseName});
    const service=app.createProjectBackupService({
      backupRepository:indexed.createBackupRepository({database}),projectLifecycle:{flush:async()=>{}},
      clock:{iso:()=> '2026-07-31T12:00:00.000Z'},
      applicationVersion:'0.7.0',schemaVersion:7
    });
    const imported=await service.importProject(JSON.stringify(archive),{mode:'create'});
    const project=await indexed.createProjectRepository({database}).get('project-1');
    const journal=await indexed.createJournalRepository({database}).getEventsByProject('project-1');
    const search=await indexed.createSearchRepository({database}).getIndexState('project-1');
    database.close();return {imported,project,journal,search};
  },{databaseName:`${uniqueName(testInfo)}-target`,archive:source.archive});
  expect(result.imported).toMatchObject({projectId:'project-1',mode:'create',replaced:false});
  expect(result.project).toMatchObject({name:'Rally',settings:{units:'miles'},templateReference:{templateId:'template-1'}});
  expect(result.journal).toHaveLength(1);
  expect(result.search).toMatchObject({status:'stale',rebuildRequired:true});
});
