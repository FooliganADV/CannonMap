import assert from 'node:assert/strict';
import test from 'node:test';
import {rebuildCheckpointAggregate,rebuildSequenceAggregate,validateCheckpointAggregate,validateSequenceAggregate} from '../src/domain/checkpoints/index.js';
import {compareCompatibility,createCompatibilitySuggestion,transitionSuggestion,validateCompatibilityResult} from '../src/domain/compatibility/index.js';
import {acceptSuggestion,applyNetworkCommand,assertSuggestionDoesNotMutateNetwork,emptyNetwork,validateNetworkCommand} from '../src/domain/network/index.js';

const NOW=1_800_000_000_000;
const checkpointEvidence=(id,outcome='success',qualityWeight=1,checkpointId='cp-1')=>({evidenceId:id,eventId:'event-1',checkpointId,outcome,qualityWeight,dwellMs:60_000,transitionToCheckpointIds:['cp-2']});
const checkpoint=(evidence,priorAggregate=null)=>rebuildCheckpointAggregate({eventId:'event-1',checkpointId:'cp-1',evidence,sourceRevisionRefs:['observation:r1'],routeFamilyRefs:['family:r1'],confidenceRefs:['confidence:r1'],priorAggregate,evaluationTime:NOW});
const sequenceEvidence=(id,outcome='success')=>({evidenceId:id,orderedCheckpointIds:['cp-1','cp-2'],outcome,elapsedMs:180_000});
const sequence=(evidence,priorAggregate=null)=>rebuildSequenceAggregate({eventId:'event-1',orderedCheckpointIds:['cp-1','cp-2'],evidence,sourceCheckpointRevisionRefs:['cp:r1'],routeFamilyRefs:['family:r1'],routeVariantRefs:['variant:r1'],confidenceRefs:['confidence:r1'],priorAggregate,evaluationTime:NOW});
const profile=(revision,overrides={})=>({revision,features:{
  speedDistribution:{value:50,evidenceRefs:[`speed:${revision}`]},
  failurePattern:{value:.2,evidenceRefs:[`failure:${revision}`]},
  checkpointDwell:{value:60,evidenceRefs:[`dwell:${revision}`]},
  routePreference:{value:['family-1'],evidenceRefs:[`route:${revision}`]},
  sequenceBehavior:{value:.8,evidenceRefs:[`sequence:${revision}`]},
  ...overrides
}});
const compatibility=(a=profile('a'),b=profile('b'),priorResult=null)=>compareCompatibility({eventId:'event-1',riderA:'rider-a',candidateId:'rider-b',profileA:a,profileB:b,priorResult,evaluationTime:NOW});
const command=(type,extra={})=>({schemaVersion:1,commandId:`command-${type}-${extra.memberId||'rider-b'}-${extra.issuedAt||NOW}`,uid:'user-1',eventId:'event-1',memberId:'rider-b',type,issuedAt:NOW,actorUid:'user-1',authorization:'explicit-user-command',eventMembershipVerified:true,...extra});

test('checkpoint aggregate retains success and failure evidence separately',()=>{
  const record=checkpoint([checkpointEvidence('success'),checkpointEvidence('failure','failure')]);
  assert.deepEqual(validateCheckpointAggregate(record),{valid:true,errors:[]});
  assert.equal(record.successCount,1); assert.equal(record.failureCount,1);
  assert.deepEqual(record.successEvidenceRefs,['success']); assert.deepEqual(record.failureEvidenceRefs,['failure']);
});

test('checkpoint rebuild is deterministic and duplicate evidence is idempotent',()=>{
  const first=checkpoint([checkpointEvidence('b'),checkpointEvidence('a')]);
  const replay=checkpoint([checkpointEvidence('a'),checkpointEvidence('b'),checkpointEvidence('a')]);
  assert.deepEqual(replay,first);
  assert.equal(checkpoint([checkpointEvidence('a')],checkpoint([checkpointEvidence('a')])).revision,1);
});

test('checkpoint revision history is immutable and references its predecessor',()=>{
  const first=checkpoint([checkpointEvidence('a')]);
  const second=checkpoint([checkpointEvidence('a'),checkpointEvidence('b','failure')],first);
  assert.equal(first.revision,1); assert.equal(second.revision,2); assert.equal(second.priorRevisionRef,first.revisionId);
  assert.equal(first.failureCount,0);
});

test('low-quality checkpoint evidence is retained and explicitly down-weighted',()=>{
  const record=checkpoint([checkpointEvidence('weak','failure',.1)]);
  assert.deepEqual(record.failureEvidenceRefs,['weak']); assert.equal(record.weightedEvidence.failure,.1);
  assert.equal(record.provenance[0].qualityWeight,.1);
});

test('partial checkpoint rebuild does not affect another checkpoint aggregate',()=>{
  const other=rebuildCheckpointAggregate({eventId:'event-1',checkpointId:'cp-2',evidence:[checkpointEvidence('other','success',1,'cp-2')],evaluationTime:NOW});
  checkpoint([checkpointEvidence('new')]);
  assert.equal(other.checkpointId,'cp-2'); assert.equal(other.revision,1);
});

test('conflicting checkpoint evidence replay is rejected',()=>{
  assert.throws(()=>checkpoint([checkpointEvidence('same'),checkpointEvidence('same','failure')]),/Conflicting evidence replay/);
});

test('sequence aggregate preserves ordered relationships and route family/variant separation',()=>{
  const record=sequence([sequenceEvidence('one'),sequenceEvidence('two','failure')]);
  assert.deepEqual(validateSequenceAggregate(record),{valid:true,errors:[]});
  assert.deepEqual(record.orderedCheckpointIds,['cp-1','cp-2']);
  assert.deepEqual(record.routeFamilyRefs,['family:r1']); assert.deepEqual(record.routeVariantRefs,['variant:r1']);
  assert.equal(record.statistics.successCount,1); assert.equal(record.statistics.failureCount,1);
});

test('unsupported sequence relationships remain explicit instead of invented',()=>{
  const record=sequence([]);
  assert.equal(record.aggregateProfile.complete,false); assert.match(record.explanation,/No evidence/);
  assert.equal(record.transitionCounts['cp-1->cp-2'],0);
});

test('sequence replay and revision history are deterministic',()=>{
  const first=sequence([sequenceEvidence('one')]),replay=sequence([sequenceEvidence('one')]);
  assert.deepEqual(replay,first);
  const second=sequence([sequenceEvidence('one'),sequenceEvidence('two')],first);
  assert.equal(second.revision,2); assert.equal(second.priorRevisionRef,first.revisionId);
});

test('compatibility score is bounded, evidence-backed, and explainable',()=>{
  const result=compatibility();
  assert.deepEqual(validateCompatibilityResult(result),{valid:true,errors:[]});
  assert.ok(result.score>=0&&result.score<=1); assert.ok(result.evidenceRefs.length>=2);
  assert.match(result.explanation,/increased compatibility/);
  assert.equal(result.inputs.featureComparisons.length,5);
});

test('compatibility decreases for divergent evidence and explains contributing features',()=>{
  const result=compatibility(profile('a'),profile('b',{
    speedDistribution:{value:5,evidenceRefs:['slow']},failurePattern:{value:.9,evidenceRefs:['fail']},
    checkpointDwell:{value:600,evidenceRefs:['long']},routePreference:{value:['family-9'],evidenceRefs:['other']},sequenceBehavior:{value:.1,evidenceRefs:['sequence-low']}
  }));
  assert.ok(result.score<.5); assert.match(result.explanation,/decreased it/);
  assert.ok(result.inputs.featureComparisons.every(item=>item.evidenceRefs.length));
});

test('sparse evidence returns an explicit insufficient-evidence result',()=>{
  const result=compatibility({revision:'a',features:{speedDistribution:{value:50,evidenceRefs:['a']}}},{revision:'b',features:{speedDistribution:{value:50,evidenceRefs:['b']}}});
  assert.equal(result.status,'InsufficientEvidence'); assert.equal(result.score,null);
  assert.match(result.explanation,/required/);
});

test('compatibility remains distinct from seven-dimensional confidence',()=>{
  const result=compatibility();
  assert.equal('confidenceScore' in result,false); assert.equal('combinedConfidence' in result,false);
  assert.deepEqual(result.inputs.featureComparisons.map(item=>item.feature).sort(),['checkpointDwell','failurePattern','routePreference','sequenceBehavior','speedDistribution']);
});

test('compatibility replay is idempotent and changed inputs create a prior-linked revision',()=>{
  const first=compatibility(),replay=compatibility(profile('a'),profile('b'),first);
  assert.strictEqual(replay,first);
  const second=compatibility(profile('a'),profile('b',{speedDistribution:{value:25,evidenceRefs:['changed']}}),first);
  assert.equal(second.revision,2); assert.equal(second.priorRevisionRef,first.revisionId);
});

test('suggestions are immutable advisory records and insufficient evidence creates none',()=>{
  const result=compatibility(),suggestion=createCompatibilitySuggestion({eventId:'event-1',userId:'user-1',candidateId:'rider-b',compatibility:result,createdAt:NOW,expiresAt:NOW+1000});
  assert.equal(suggestion.status,'Proposed'); assert.equal(suggestion.compatibilityRef,result.revisionId);
  const sparse=compatibility({revision:'a',features:{}},{revision:'b',features:{}});
  assert.equal(createCompatibilitySuggestion({eventId:'event-1',userId:'user-1',candidateId:'rider-b',compatibility:sparse,createdAt:NOW}),null);
});

test('suggestion status and expiry transitions are explicit',()=>{
  const original=createCompatibilitySuggestion({eventId:'event-1',userId:'user-1',candidateId:'rider-b',compatibility:compatibility(),createdAt:NOW,expiresAt:NOW+1000});
  const viewed=transitionSuggestion({suggestion:original,status:'Viewed',at:NOW+100});
  assert.equal(viewed.status,'Viewed'); assert.equal(original.status,'Proposed');
  assert.throws(()=>transitionSuggestion({suggestion:viewed,status:'Expired',at:NOW+500}),/before expiresAt/);
  assert.equal(transitionSuggestion({suggestion:viewed,status:'Expired',at:NOW+1000}).status,'Expired');
});

test('network membership changes only through attributable explicit user commands',()=>{
  const empty=emptyNetwork({uid:'user-1',eventId:'event-1'}),added=applyNetworkCommand({snapshot:empty,command:command('AddMember')});
  const weighted=applyNetworkCommand({snapshot:added,command:command('UpdateWeight',{weight:.4,commandId:'weight'})});
  const noted=applyNetworkCommand({snapshot:weighted,command:command('UpdateNotes',{notes:'Known riding partner',commandId:'notes'})});
  const removed=applyNetworkCommand({snapshot:noted,command:command('RemoveMember',{commandId:'remove'})});
  assert.equal(added.members.length,1); assert.equal(weighted.members[0].weight,.4); assert.equal(noted.members[0].notes,'Known riding partner'); assert.equal(removed.members.length,0);
  assert.ok(removed.audit.every(item=>item.attribution==='explicit-user-command'));
});

test('network commands enforce ownership, event membership, bounds, and replay protection',()=>{
  assert.equal(validateNetworkCommand(command('AddMember')).valid,true);
  assert.equal(validateNetworkCommand(command('AddMember',{actorUid:'attacker'})).valid,false);
  assert.equal(validateNetworkCommand(command('AddMember',{eventMembershipVerified:false})).valid,false);
  assert.equal(validateNetworkCommand(command('UpdateWeight',{weight:2})).valid,false);
  const added=applyNetworkCommand({snapshot:emptyNetwork({uid:'user-1',eventId:'event-1'}),command:command('AddMember')});
  assert.strictEqual(applyNetworkCommand({snapshot:added,command:command('AddMember')}),added);
});

test('suggestions and background reconciliation never mutate network membership',()=>{
  const snapshot=applyNetworkCommand({snapshot:emptyNetwork({uid:'user-1',eventId:'event-1'}),command:command('AddMember')});
  const suggestions=[createCompatibilitySuggestion({eventId:'event-1',userId:'user-1',candidateId:'candidate-x',compatibility:compatibility(),createdAt:NOW})];
  assert.strictEqual(assertSuggestionDoesNotMutateNetwork({snapshot,suggestions}),snapshot);
  assert.deepEqual(snapshot.members.map(item=>item.memberId),['rider-b']);
});

test('accepted suggestion still requires a separate matching explicit AddMember command',()=>{
  const proposed=createCompatibilitySuggestion({eventId:'event-1',userId:'user-1',candidateId:'rider-b',compatibility:compatibility(),createdAt:NOW});
  const accepted=transitionSuggestion({suggestion:proposed,status:'Accepted',at:NOW+1});
  const snapshot=emptyNetwork({uid:'user-1',eventId:'event-1'});
  assert.throws(()=>acceptSuggestion({snapshot,suggestion:accepted,command:command('UpdateNotes',{notes:'no'})}),/separate matching AddMember/);
  assert.equal(acceptSuggestion({snapshot,suggestion:accepted,command:command('AddMember')}).members.length,1);
});
