import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';

let environment;
before(async()=>{
  environment=await initializeTestEnvironment({
    projectId:'demo-cannonmap',
    database:{rules:await readFile('database.rules.json','utf8')}
  });
});
after(async()=>environment?.cleanup());

test('default deny blocks unauthenticated reads and writes',async()=>{
  const database=environment.unauthenticatedContext().database();
  await assertFails(database.ref('/unknown').once('value'));
  await assertFails(database.ref('/unknown').set({value:true}));
});

test('clients cannot bypass the ingestion function',async()=>{
  const database=environment.authenticatedContext('owner-a').database();
  await assertFails(database.ref('/observationIngress/event-1/owner-a/obs-1').set({schemaVersion:1}));
  await assertFails(database.ref('/validatedObservations/event-1/obs-1').set({schemaVersion:1}));
  await assertFails(database.ref('/ingestionQuota/event-1/owner-a/1').set({count:1}));
});

test('receipt and ingress reads are owner scoped',async()=>{
  await environment.withSecurityRulesDisabled(async context=>{
    const database=context.database();
    await database.ref('/private/owner-a/observationReceipts/r1').set({status:'accepted'});
    await database.ref('/observationIngress/event-1/owner-a/obs-1').set({ownerUid:'owner-a'});
  });
  const owner=environment.authenticatedContext('owner-a').database();
  const other=environment.authenticatedContext('owner-b').database();
  await assertSucceeds(owner.ref('/private/owner-a/observationReceipts/r1').once('value'));
  await assertSucceeds(owner.ref('/observationIngress/event-1/owner-a/obs-1').once('value'));
  await assertFails(other.ref('/private/owner-a/observationReceipts/r1').once('value'));
  await assertFails(other.ref('/observationIngress/event-1/owner-a/obs-1').once('value'));
});

test('derived intelligence remains server-only',async()=>{
  const database=environment.authenticatedContext('owner-a').database();
  await assertFails(database.ref('/derivedIntelligence/event-1').once('value'));
  await assertFails(database.ref('/derivedIntelligence/event-1').set({commitment:'forbidden'}));
  await assertFails(database.ref('/evidenceLedger/event-1/evidence-1').set({assertionKind:'observed'}));
  await assertFails(database.ref('/commitmentInferences/event-1/owner-a/inference-1').set({assertionKind:'inferred'}));
  await assertFails(database.ref('/commitmentDiagnostics/event-1/trace-1').once('value'));
});

test('emulator suite reached the configured rules project',()=>{
  assert.equal(environment.projectId,'demo-cannonmap');
});
