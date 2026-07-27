import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inferCommitment} from '../src/domain/commitment/engine.js';
import {validateCommitmentInference} from '../src/domain/commitment/contract.js';
import {canTransitionCommitment,transitionCommitment} from '../src/domain/commitment/state-machine.js';
import {createInferCommitmentHandler} from '../functions/src/infer-commitment.js';

const fixture=async name=>JSON.parse(await readFile(new URL(`./fixtures/commitment/${name}.json`,import.meta.url),'utf8'));

test('confirmed trace produces an explainable multi-signal inference',async()=>{
  const result=inferCommitment(await fixture('confirmed'));
  assert.equal(result.status,'inferred');
  assert.equal(result.inference.lifecycleState,'confirmed');
  assert.equal(result.inference.assertionKind,'inferred');
  assert.ok(result.inference.explanation.signals.length>=2);
  assert.equal(validateCommitmentInference(result.inference).valid,true);
});

test('every explanation signal references immutable observed evidence',async()=>{
  const result=inferCommitment(await fixture('confirmed'));
  const refs=new Set(result.inference.evidenceRefs);
  for(const item of result.inference.explanation.signals){
    assert.ok(item.evidenceRefs.length);
    assert.ok(item.evidenceRefs.every(ref=>refs.has(ref)));
  }
  assert.ok(result.evidence.every(item=>item.immutable&&item.assertionKind==='observed'));
  assert.ok(result.evidence.every(item=>!('lifecycleState' in item)));
});

test('deterministic replay returns identical inference, trace, and evidence identities',async()=>{
  const trace=await fixture('confirmed');
  const first=inferCommitment(trace),second=inferCommitment(structuredClone(trace));
  assert.deepEqual(second,first);
});

test('false-positive review rejects a fast checkpoint pass-through',async()=>{
  const result=inferCommitment(await fixture('pass-through'));
  assert.equal(result.status,'insufficient-evidence');
  assert.equal(result.reason,'checkpoint-presence-required');
});

test('false-positive review rejects stale, mismatched, and single-source traces',async()=>{
  const trace=await fixture('confirmed');
  const stale={...trace,observations:trace.observations.map(item=>({...item,occurredAt:item.occurredAt-20*60*1000}))};
  assert.equal(inferCommitment(stale).status,'insufficient-evidence');
  const mismatch={...trace,observations:trace.observations.map(item=>({...item,competitorId:'other'}))};
  assert.equal(inferCommitment(mismatch).status,'insufficient-evidence');
  const noGeometry={...trace,checkpoint:{checkpointId:'cp-7'}};
  assert.equal(inferCommitment(noGeometry).reason,'missing-checkpoint-geometry');
});

test('false-negative review retains a sustained commitment without heading data',async()=>{
  const result=inferCommitment(await fixture('missing-heading'));
  assert.equal(result.status,'inferred');
  assert.equal(result.inference.lifecycleState,'confirmed');
  assert.match(result.inference.explanation.summary,/not an observed fact/i);
});

test('insufficient evidence produces no inference object',async()=>{
  const trace=await fixture('pass-through'),result=inferCommitment(trace);
  assert.equal('inference' in result,false);
  assert.equal('evidence' in result,false);
});

test('confidence remains dimensional and never fabricates an aggregate score',async()=>{
  const {inference}=inferCommitment(await fixture('confirmed'));
  assert.deepEqual(Object.keys(inference.confidenceDimensions).sort(),['evidenceStrength','spatialConsistency','temporalConsistency']);
  assert.equal('confidence' in inference,false);
  assert.equal('confidenceScore' in inference,false);
});

test('explicit lifecycle accepts only approved forward transitions',()=>{
  assert.equal(transitionCommitment('pending','candidate'),'candidate');
  assert.equal(transitionCommitment('candidate','confirmed'),'confirmed');
  assert.equal(transitionCommitment('candidate','rejected'),'rejected');
  assert.equal(transitionCommitment('confirmed','expired'),'expired');
  assert.equal(canTransitionCommitment('rejected','candidate'),false);
  assert.throws(()=>transitionCommitment('confirmed','candidate'),/Invalid commitment transition/);
});

function memoryRepository({observations,checkpoints}){
  const inferences=new Map(),evidence=new Map(),diagnostics=[];
  return {
    inferences,evidence,diagnostics,
    async recentValidatedObservations(){return structuredClone(observations);},
    async checkpoints(){return structuredClone(checkpoints);},
    async persistShadow(result){
      if(inferences.has(result.inference.inferenceId))return {replayed:true};
      inferences.set(result.inference.inferenceId,result.inference);
      for(const item of result.evidence)evidence.set(item.evidenceId,item);
      return {replayed:false};
    },
    async diagnostic(record){diagnostics.push(record);}
  };
}

test('shadow handler persists inference and ledger but exposes no downstream action',async()=>{
  const trace=await fixture('confirmed'),repository=memoryRepository({observations:trace.observations,checkpoints:[trace.checkpoint]});
  const handler=createInferCommitmentHandler({repository,clock:()=>trace.nowMs});
  const result=await handler({eventId:trace.eventId,observation:trace.observations.at(-1)});
  assert.equal(result.status,'inferred');
  assert.equal(result.replayed,false);
  assert.equal(repository.inferences.size,1);
  assert.equal(repository.evidence.size,trace.observations.length);
  assert.equal(repository.diagnostics[0].shadowMode,true);
  assert.equal('publication' in result,false);
  assert.equal('recommendation' in result,false);
});

test('shadow handler is idempotent on trigger replay',async()=>{
  const trace=await fixture('confirmed'),repository=memoryRepository({observations:trace.observations,checkpoints:[trace.checkpoint]});
  const handler=createInferCommitmentHandler({repository,clock:()=>trace.nowMs});
  const request={eventId:trace.eventId,observation:trace.observations.at(-1)};
  assert.equal((await handler(request)).replayed,false);
  assert.equal((await handler(request)).replayed,true);
  assert.equal(repository.inferences.size,1);
});

test('shadow handler records insufficient diagnostics without persistence',async()=>{
  const trace=await fixture('pass-through'),repository=memoryRepository({observations:trace.observations,checkpoints:[trace.checkpoint]});
  const result=await createInferCommitmentHandler({repository,clock:()=>trace.nowMs})({eventId:trace.eventId,observation:trace.observations.at(-1)});
  assert.equal(result.status,'insufficient-evidence');
  assert.equal(repository.inferences.size,0);
  assert.equal(repository.evidence.size,0);
  assert.equal(repository.diagnostics[0].shadowMode,true);
});
