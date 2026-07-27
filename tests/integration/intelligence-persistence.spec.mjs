import {expect,test} from '@playwright/test';

const uniqueName=testInfo=>`CannonMapDB-M10-${testInfo.project.name}-${Date.now()}-${Math.random()}`;
const remove=(page,name)=>page.evaluate(databaseName=>new Promise((resolve,reject)=>{
  const request=indexedDB.deleteDatabase(databaseName); request.onsuccess=resolve; request.onerror=()=>reject(request.error); request.onblocked=()=>reject(new Error('blocked'));
}),name);

test.beforeEach(async({page})=>page.goto('/'));

test('M10 projections are immutable, replay-safe, prior-linked, and recoverable',async({page},testInfo)=>{
  const name=uniqueName(testInfo);
  const result=await page.evaluate(async databaseName=>{
    const indexed=await import('/src/infrastructure/indexeddb/index.js');
    const checkpoints=await import('/src/domain/checkpoints/index.js');
    const database=await indexed.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:()=>true},databaseName});
    const repository=indexed.createIntelligenceRepository({database});
    const input={eventId:'event-1',checkpointId:'cp-1',evidence:[{evidenceId:'one',eventId:'event-1',checkpointId:'cp-1',outcome:'success',qualityWeight:1}],evaluationTime:1000};
    const first=checkpoints.rebuildCheckpointAggregate(input);
    await repository.appendProjection('checkpoint',first,{subjectId:'cp-1'});
    await repository.appendProjection('checkpoint',first,{subjectId:'cp-1'});
    const second=checkpoints.rebuildCheckpointAggregate({...input,evidence:[...input.evidence,{evidenceId:'two',eventId:'event-1',checkpointId:'cp-1',outcome:'failure',qualityWeight:.5}],priorAggregate:first,evaluationTime:2000});
    const transaction=database.transaction(['intelligenceItems','syncMeta'],'readwrite');
    transaction.objectStore('intelligenceItems').add({schemaVersion:1,createdAt:2000,updatedAt:2000,eventId:'event-1',intelligenceId:`checkpoint:${second.revisionId}`,type:'checkpoint',subjectId:'cp-1',revision:2,record:second});
    transaction.abort(); await new Promise(resolve=>transaction.onabort=resolve);
    const afterAbort=await repository.readHead('checkpoint','event-1','cp-1');
    await repository.appendProjection('checkpoint',second,{subjectId:'cp-1'});
    const head=await repository.readHead('checkpoint','event-1','cp-1');
    const diagnostics=await repository.reconcile('checkpoint','event-1','cp-1');
    database.close();
    return {afterAbortRevision:afterAbort.revision,headRevision:head.revision,priorRevisionRef:head.priorRevisionRef,firstRevisionId:first.revisionId,diagnostics};
  },name);
  expect(result.afterAbortRevision).toBe(1);
  expect(result.headRevision).toBe(2);
  expect(result.priorRevisionRef).toBe(result.firstRevisionId);
  expect(result.diagnostics).toMatchObject({revisionCount:2,headRevision:2,orphanedRevisions:[]});
  await remove(page,name);
});
