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

test('M10 public intelligence projections remain server-only',async()=>{
  const database=environment.authenticatedContext('owner-a',{events:{'event-1':true}}).database();
  for(const path of ['checkpointAggregateRevisions/event-1/cp-1/r1','sequenceAggregateRevisions/event-1/s1/r1','compatibilityRevisions/event-1/c1/r1','compatibilitySuggestions/event-1/user-a/s1']){
    await assertFails(database.ref(path).set({schemaVersion:1}));
  }
});

test('network commands require owner identity, event membership, schema, bounds, and immutability',async()=>{
  const now=Date.now();
  const valid={schemaVersion:1,commandId:'command-1',uid:'owner-a',eventId:'event-1',memberId:'rider-b',type:'AddMember',issuedAt:now,actorUid:'owner-a',authorization:'explicit-user-command',eventMembershipVerified:true,weight:.8,notes:'pseudonymous note'};
  const owner=environment.authenticatedContext('owner-a',{events:{'event-1':true}}).database();
  const outsider=environment.authenticatedContext('owner-b',{events:{'event-1':true}}).database();
  const nonmember=environment.authenticatedContext('owner-a',{events:{}}).database();
  await assertSucceeds(owner.ref('/networkCommands/owner-a/command-1').set(valid));
  await assertFails(owner.ref('/networkCommands/owner-a/command-1').set(valid));
  await assertFails(outsider.ref('/networkCommands/owner-a/command-2').set({...valid,commandId:'command-2'}));
  await assertFails(nonmember.ref('/networkCommands/owner-a/command-3').set({...valid,commandId:'command-3'}));
  await assertFails(owner.ref('/networkCommands/owner-a/command-4').set({...valid,commandId:'command-4',weight:2}));
  await assertFails(owner.ref('/networkCommands/owner-a/command-5').set({...valid,commandId:'command-5',token:'forbidden'}));
});

test('clients cannot write reconciled Intelligence Network membership',async()=>{
  const database=environment.authenticatedContext('owner-a',{events:{'event-1':true}}).database();
  await assertFails(database.ref('/intelligenceNetworks/owner-a/event-1/rider-b').set({weight:1}));
});

test('emulator suite reached the configured rules project',()=>{
  assert.equal(environment.projectId,'demo-cannonmap');
});
