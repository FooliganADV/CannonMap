import {expect,test} from '@playwright/test';

const uniqueName=testInfo=>`CannonMapDB-M9-${testInfo.project.name}-${testInfo.title}-${Date.now()}-${Math.random()}`;
const deleteDatabase=(page,name)=>page.evaluate(databaseName=>new Promise((resolve,reject)=>{
  const request=indexedDB.deleteDatabase(databaseName);
  request.onsuccess=resolve;request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Database deletion blocked.'));
}),name);

test.beforeEach(async({page})=>page.goto('/'));

test('confidence revisions are immutable, indexed, and replay-safe',async({page},testInfo)=>{
  const databaseName=uniqueName(testInfo);
  const result=await page.evaluate(async name=>{
    const indexed=await import('/src/infrastructure/indexeddb/index.js');
    const confidence=await import('/src/domain/confidence/index.js');
    const database=await indexed.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:key=>key===indexed.V2_FEATURE_FLAG},databaseName:name});
    const repository=indexed.createDomainRepositories(database).confidenceVectors;
    const subject={eventId:'event-1',subjectType:'routeVariant',subjectId:'variant-1'};
    const first=confidence.evolveConfidenceVector({...subject,evaluationTime:1000,evidence:[{evidenceId:'quality-1',occurredAt:1000,effects:{quality:{kind:'set',value:0.7}}}]});
    const created=await repository.addRevision(first);
    const replayed=await repository.addRevision(first);
    const second=confidence.evolveConfidenceVector({...subject,priorVector:first,evaluationTime:2000,evidence:[{evidenceId:'stability-1',occurredAt:2000,effects:{stability:{kind:'set',value:0.8}}}]});
    await repository.addRevision(second);
    const revisions=await repository.revisionsFor(subject),latest=await repository.latest(subject);
    database.close();
    return {created,replayed,revisions:revisions.map(item=>({revision:item.revision,revisionId:item.revisionId})),latestRevision:latest.revision,priorRevisionRef:latest.priorRevisionRef};
  },databaseName);
  expect(result.created).toMatchObject({created:true,replayed:false});
  expect(result.replayed).toMatchObject({created:false,replayed:true});
  expect(result.revisions.map(item=>item.revision)).toEqual([1,2]);
  expect(result.latestRevision).toBe(2);
  expect(result.priorRevisionRef).toBe(result.revisions[0].revisionId);
  await deleteDatabase(page,databaseName);
});

test('aborted confidence write leaves no partial revision and retry recovers',async({page},testInfo)=>{
  const databaseName=uniqueName(testInfo);
  const result=await page.evaluate(async name=>{
    const indexed=await import('/src/infrastructure/indexeddb/index.js');
    const confidence=await import('/src/domain/confidence/index.js');
    const database=await indexed.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name});
    const repository=indexed.createConfidenceVectorRepository({database});
    const subject={eventId:'event-1',subjectType:'routeFamily',subjectId:'family-1'};
    const vector=confidence.evolveConfidenceVector({...subject,evaluationTime:1000});
    const transaction=database.transaction('confidenceVectors','readwrite');
    transaction.objectStore('confidenceVectors').add(vector);
    transaction.abort();
    await new Promise(resolve=>{transaction.onabort=resolve;});
    const afterAbort=await repository.latest(subject);
    const retry=await repository.addRevision(vector);
    const afterRetry=await repository.latest(subject);
    database.close();
    return {afterAbort,retry,afterRetry:afterRetry?.revisionId};
  },databaseName);
  expect(result.afterAbort).toBeNull();
  expect(result.retry).toMatchObject({created:true,replayed:false});
  expect(result.afterRetry).toBeTruthy();
  await deleteDatabase(page,databaseName);
});
