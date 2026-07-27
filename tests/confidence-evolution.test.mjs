import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {
  CONFIDENCE_DIMENSIONS,evolveConfidenceVector,readLegacyConfidenceMigrationInput,
  validateConfidenceVector
} from '../src/domain/confidence/index.js';

const subject={eventId:'america-250',subjectType:'routeVariant',subjectId:'variant-1'};
const at=(evaluationTime,evidence=[],priorVector=null,extra={})=>evolveConfidenceVector({...subject,evaluationTime,evidence,priorVector,...extra});
const effect=(evidenceId,occurredAt,dimension,kind,value)=>({
  evidenceId,occurredAt,effects:{[dimension]:{kind,...(value===undefined?{}:{value})}}
});
const fixture=async name=>JSON.parse(await readFile(new URL(`./fixtures/confidence/${name}.json`,import.meta.url),'utf8'));

test('ConfidenceVector contract contains exactly seven independent dimensions',()=>{
  const vector=at(1000);
  assert.deepEqual(Object.keys(vector.dimensions),CONFIDENCE_DIMENSIONS);
  assert.deepEqual(validateConfidenceVector(vector),{valid:true,errors:[]});
  assert.ok(CONFIDENCE_DIMENSIONS.every(name=>vector.dimensions[name].provenance.length===1));
});

test('contract rejects every prohibited combined confidence field',()=>{
  const vector=at(1000);
  for(const field of ['overallConfidence','totalConfidence','aggregateConfidence','compositeConfidence','weightedConfidence','normalizedConfidence','combinedConfidence']){
    assert.equal(validateConfidenceVector({...vector,[field]:0.5}).valid,false,field);
  }
});

test('roadmap confidence fixtures preserve distinct dimension semantics',async()=>{
  const fresh=await fixture('fresh-weak'),old=await fixture('old-stable'),strong=await fixture('strong-low-quality'),sparse=await fixture('high-quality-sparse');
  const freshVector=at(fresh.evaluationTime,fresh.evidence),oldVector=at(old.evaluationTime,old.evidence);
  const strongVector=at(strong.evaluationTime,strong.evidence),sparseVector=at(sparse.evaluationTime,sparse.evidence);
  assert.equal(freshVector.dimensions.evidenceStrength.value,0.2);
  assert.ok(freshVector.dimensions.recency.value>oldVector.dimensions.recency.value);
  assert.equal(oldVector.dimensions.stability.value,0.9);
  assert.equal(strongVector.dimensions.evidenceStrength.value,0.9);
  assert.equal(strongVector.dimensions.quality.value,0.2);
  assert.equal(sparseVector.dimensions.quality.value,0.95);
  assert.equal(sparseVector.dimensions.evidenceStrength.value,0.25);
});

test('reinforcing evidence is monotonic for each evidence-governed dimension',()=>{
  for(const name of ['quality','evidenceStrength','inference','historical','current','stability']){
    const first=at(1000,[effect(`${name}-set`,1000,name,'set',0.4)]);
    const next=at(2000,[effect(`${name}-reinforce`,2000,name,'reinforce')],first);
    assert.ok(next.dimensions[name].value>=first.dimensions[name].value,name);
  }
});

test('current and recency decay independently and never increase from elapsed time',()=>{
  const initial=at(1000,[
    effect('current-set',1000,'current','set',0.8),
    effect('recency-set',1000,'recency','set')
  ]);
  const later=at(7201000,[],initial);
  assert.ok(later.dimensions.current.value<=initial.dimensions.current.value);
  assert.ok(later.dimensions.recency.value<=initial.dimensions.recency.value);
  assert.equal(later.dimensions.quality.value,initial.dimensions.quality.value);
});

test('stable dimensions do not change without qualifying evidence',()=>{
  const initial=at(1000,[effect('historical-set',1000,'historical','set',0.75)]);
  const later=at(9000000,[],initial);
  assert.equal(later.dimensions.historical.value,0.75);
  assert.strictEqual(later,initial);
});

test('recency responds only to relevant evidence timestamps and evaluation time',()=>{
  const initial=at(1000,[effect('freshness',500,'recency','set')]);
  const unrelated=at(2000,[effect('quality-only',2000,'quality','set',0.9)],initial);
  assert.ok(unrelated.dimensions.recency.value<initial.dimensions.recency.value);
  assert.equal(unrelated.dimensions.recency.decayBasis.latestEvidenceAt,500);
});

test('same inputs and time replay deterministically without duplicate evidence',()=>{
  const evidence=[effect('repeat',1000,'quality','reinforce')];
  const first=at(1000,evidence),replay=at(1000,evidence);
  assert.deepEqual(replay,first);
  const duplicate=at(1000,evidence,first);
  assert.strictEqual(duplicate,first);
  assert.deepEqual(first.dimensions.quality.evidenceRefs,['repeat']);
});

test('contradictory evidence is explicit, bounded, and explainable',()=>{
  const first=at(1000,[effect('quality-set',1000,'quality','set',0.7)]);
  const contradicted=at(2000,[effect('quality-conflict',2000,'quality','contradict')],first);
  assert.ok(contradicted.dimensions.quality.value<0.7);
  assert.equal(contradicted.dimensions.quality.changeReason,'contradictory-evidence');
  assert.deepEqual(contradicted.dimensions.quality.provenance.at(-1).effects,[{evidenceId:'quality-conflict',kind:'contradict',value:null}]);
});

test('confidence values remain bounded under repeated reinforcement and contradiction',()=>{
  let vector=at(1000,[effect('start',1000,'stability','set',0.5)]);
  for(let index=0;index<20;index++)vector=at(2000+index,[effect(`up-${index}`,2000+index,'stability','reinforce')],vector);
  assert.ok(vector.dimensions.stability.value<=1);
  for(let index=0;index<20;index++)vector=at(3000+index,[effect(`down-${index}`,3000+index,'stability','contradict')],vector);
  assert.ok(vector.dimensions.stability.value>=0);
});

test('time reversal and future evidence are rejected',()=>{
  const vector=at(2000,[effect('known',2000,'quality','set',0.5)]);
  assert.throws(()=>at(1999,[],vector),/cannot move backward/);
  assert.throws(()=>at(3000,[effect('future',3001,'quality','reinforce')],vector),/no later than evaluationTime/);
});

test('one dimension changes without forcing values in the other six',()=>{
  const initial=at(1000);
  const next=at(2000,[effect('quality-only',2000,'quality','set',0.8)],initial);
  assert.equal(next.dimensions.quality.value,0.8);
  for(const name of CONFIDENCE_DIMENSIONS.filter(name=>name!=='quality')){
    assert.equal(next.dimensions[name].value,initial.dimensions[name].value,name);
    assert.strictEqual(next.dimensions[name],initial.dimensions[name],name);
  }
});

test('every changed dimension retains complete policy and revision provenance',()=>{
  const first=at(1000,[effect('first',1000,'inference','set',0.4)]);
  const second=at(2000,[effect('second',2000,'inference','reinforce')],first);
  const dimension=second.dimensions.inference;
  assert.equal(dimension.policyId,'inference-support');
  assert.equal(dimension.policyVersion,1);
  assert.equal(dimension.priorValue,0.4);
  assert.equal(dimension.provenance.at(-1).priorRevisionRef,first.revisionId);
  assert.equal(second.priorRevisionRef,first.revisionId);
});

test('legacy confidence is migration input only and cannot populate seven dimensions',()=>{
  const migration=readLegacyConfidenceMigrationInput({value:0.88,source:'legacyProject.confidence',readAt:900});
  const migrated=at(1000,[],null,{migrationInput:migration});
  assert.equal(migrated.migrationSource.originalValue,0.88);
  assert.equal(migrated.migrationSource.authoritative,false);
  assert.ok(CONFIDENCE_DIMENSIONS.every(name=>migrated.dimensions[name].value===null));
  const evidenceBacked=at(2000,[effect('new-quality',2000,'quality','set',0.6)],migrated,{migrationInput:readLegacyConfidenceMigrationInput({value:0.99,source:'other',readAt:1900})});
  assert.equal(evidenceBacked.dimensions.quality.value,0.6);
  assert.equal(evidenceBacked.migrationSource.originalValue,0.88);
});

test('observed evidence objects remain unchanged and confidence stays derived metadata',()=>{
  const evidence=Object.freeze(effect('immutable-observation-ref',1000,'quality','set',0.7));
  const before=JSON.stringify(evidence);
  const vector=at(1000,[evidence]);
  assert.equal(JSON.stringify(evidence),before);
  assert.equal(vector.evidenceRefs[0],'immutable-observation-ref');
  assert.equal('observed' in vector,false);
});
