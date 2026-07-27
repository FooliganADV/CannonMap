import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyProvisionalMerge,applyProvisionalSplit,geometryFingerprint,projectFamily,projectTraversal,
  proposeFamilyMerge,proposeFamilySplit,transitionRouteLifecycle,validateRouteFamily,validateRouteVariant
} from '../src/domain/routes/index.js';
import {createUpdateRouteVariantHandler} from '../functions/routes/update-route-variant.js';
import {createRealtimeRouteRepository} from '../functions/routes/repository.js';

const NOW=Date.parse('2026-07-26T12:00:00.000Z');
const points=[[41,-87],[41.01,-87.01]].map(([lat,lon])=>({lat,lon}));
const traversal=(suffix='a',priorVariant=null)=>projectTraversal({
  eventId:'america-250',fromCheckpointId:'cp-1',toCheckpointId:'cp-2',points,
  distanceMeters:1600,durationSeconds:120,evidenceRefs:[`evidence:${suffix}`],priorVariant,nowMs:NOW
});
const familyFor=(variants,priorFamily=null)=>projectFamily({eventId:'america-250',familyId:variants[0].familyId,variants,priorFamily,nowMs:NOW});

test('geometry fingerprinting is deterministic and coordinate-sensitive',()=>{
  const input={eventId:'e',fromCheckpointId:'a',toCheckpointId:'b',points};
  assert.equal(geometryFingerprint(input),geometryFingerprint({...input,points:points.map(point=>({...point}))}));
  assert.notEqual(geometryFingerprint(input),geometryFingerprint({...input,points:[points[0],{lat:42,lon:-87}]}));
});

test('variant replay produces identical initial revisions and valid contracts',()=>{
  const first=traversal(),replay=traversal();
  assert.deepEqual(replay,first);
  assert.deepEqual(validateRouteVariant(first),{valid:true,errors:[]});
});

test('variant revisions retain independent statistics and immutable evidence',()=>{
  const first=traversal('a'),second=traversal('b',first);
  assert.equal(first.independentStats.traversalCount,1);
  assert.equal(second.independentStats.traversalCount,2);
  assert.deepEqual(first.evidenceRefs,['evidence:a']);
  assert.deepEqual(second.evidenceRefs,['evidence:a','evidence:b']);
  assert.equal(second.supersedesRevision,1);
});

test('family aggregate statistics never overwrite variant statistics',()=>{
  const variant=traversal(),family=familyFor([variant]);
  assert.notStrictEqual(family.aggregateStats,variant.independentStats);
  assert.equal(family.aggregateStats.traversalCount,1);
  assert.equal(variant.independentStats.traversalCount,1);
  assert.deepEqual(validateRouteFamily(family),{valid:true,errors:[]});
});

test('family replay is deterministic and revisions retain prior snapshots',()=>{
  const variant=traversal(),first=familyFor([variant]),replay=familyFor([variant]);
  assert.deepEqual(replay,first);
  const next=familyFor([traversal('b',variant)],first);
  assert.equal(next.revision,2);
  assert.equal(first.revision,1);
  assert.equal(next.supersedesRevision,1);
});

test('Route Family and Variant lifecycles allow only explicit forward transitions',()=>{
  const variant=traversal();
  const active=transitionRouteLifecycle(variant,'active',{nowMs:NOW,reason:'Reviewed evidence'});
  assert.equal(active.lifecycle,'active');
  assert.equal(active.revision,2);
  assert.throws(()=>transitionRouteLifecycle(active,'provisional'),/Invalid route lifecycle transition/);
  const superseded=transitionRouteLifecycle(active,'superseded',{nowMs:NOW});
  assert.throws(()=>transitionRouteLifecycle(superseded,'active'),/Invalid route lifecycle transition/);
});

test('provisional merge is explainable and preserves superseded family history',()=>{
  const leftVariant=traversal('left');
  const left=familyFor([leftVariant]);
  const rightVariant=projectTraversal({eventId:'america-250',fromCheckpointId:'cp-1',toCheckpointId:'cp-2',points:[points[0],{lat:41.02,lon:-87.02}],distanceMeters:2100,durationSeconds:150,evidenceRefs:['evidence:right'],nowMs:NOW});
  const right=familyFor([rightVariant]);
  const proposal=proposeFamilyMerge({eventId:'america-250',families:[left,right],evidenceRefs:['review:1'],reason:'Overlapping geometry review',nowMs:NOW});
  const result=applyProvisionalMerge({proposal,families:[left,right],variants:[leftVariant,rightVariant],nowMs:NOW});
  assert.equal(proposal.lifecycle,'provisional');
  assert.equal(result.targetFamily.lineage[0].kind,'merge-applied');
  assert.equal(result.supersededFamilyRevisions.length,2);
  assert.ok(result.supersededFamilyRevisions.every(item=>item.lifecycle==='superseded'));
  assert.equal(left.lifecycle,'provisional');
});

test('provisional split is reversible and retains source lineage',()=>{
  const one=traversal('one');
  const two=Object.freeze({...traversal('two'),variantId:'variant_second',revisionId:'variantRevision_second'});
  const family=familyFor([one,two]);
  const proposal=proposeFamilySplit({eventId:'america-250',family,variantGroups:[[one.variantId],[two.variantId]],evidenceRefs:['review:split'],reason:'Distinct corridors',nowMs:NOW});
  const result=applyProvisionalSplit({proposal,family,variants:[one,two],nowMs:NOW});
  assert.equal(result.targetFamilies.length,2);
  assert.equal(result.supersededFamilyRevision.lifecycle,'superseded');
  assert.equal(result.lineage.kind,'split-applied');
  assert.equal(family.lifecycle,'provisional');
});

test('shadow handler ignores validated observations without route traversal',async()=>{
  const handler=createUpdateRouteVariantHandler({repository:{},clock:()=>NOW});
  assert.deepEqual(await handler({eventId:'e',observation:{observationId:'o'}}),{status:'ignored',reason:'missing-route-traversal'});
});

test('shadow handler is idempotent and advances variant and family revisions',async()=>{
  const variants=new Map(),families=new Map(),diagnostics=[];
  const receipts=new Map();
  const repository={
    projectionReceipt:async(_event,id)=>receipts.get(id)||null,
    persistProjectionReceipt:async(_event,id,receipt)=>receipts.set(id,receipt),
    variantHead:async(_event,id)=>variants.get(id)||null,
    familyHead:async(_event,id)=>families.get(id)||null,
    familyVariants:async(_event,id)=>[...variants.values()].filter(item=>item.familyId===id),
    persistVariantRevision:async(record,expected)=>{
      const prior=variants.get(record.variantId);
      if((prior?.revisionId||null)!==expected)throw new Error('contention');
      const replay=prior?.revisionId===record.revisionId;
      variants.set(record.variantId,record);
      return {created:!replay};
    },
    persistFamilyRevision:async(record,expected)=>{
      const prior=families.get(record.familyId);
      assert.equal(prior?.revisionId||null,expected);
      families.set(record.familyId,record);
    },
    diagnostic:async(...args)=>diagnostics.push(args)
  };
  const handler=createUpdateRouteVariantHandler({repository,clock:()=>NOW});
  const observation={observationId:'obs-1',routeTraversal:{fromCheckpointId:'cp-1',toCheckpointId:'cp-2',points,distanceMeters:1600,durationSeconds:120}};
  const first=await handler({eventId:'america-250',observation});
  const second=await handler({eventId:'america-250',observation});
  assert.equal(first.status,'projected');
  assert.equal(second.replayed,true);
  assert.equal(variants.get(first.variant.variantId).revision,1);
  assert.equal(families.get(first.family.familyId).revision,1);
  assert.equal(diagnostics.length,1);
});

test('transaction conflicts are surfaced without destructive overwrite',async()=>{
  const repository={
    projectionReceipt:async()=>null,
    variantHead:async()=>({ ...traversal(),revisionId:'unexpected-head' }),
    familyHead:async()=>null,familyVariants:async()=>[],
    persistVariantRevision:async(_record,expected)=>{assert.equal(expected,'unexpected-head');throw new Error('Route projection contention exceeded 5 attempts');}
  };
  const handler=createUpdateRouteVariantHandler({repository,clock:()=>NOW});
  const observation={observationId:'obs-contention',routeTraversal:{fromCheckpointId:'cp-1',toCheckpointId:'cp-2',points,distanceMeters:1600,durationSeconds:120}};
  await assert.rejects(()=>handler({eventId:'america-250',observation}),/contention exceeded/);
});

test('repository retries transient head contention within its fixed bound',async()=>{
  let attempts=0;
  const database={
    ref:path=>({
      transaction:async update=>{
        if(path.startsWith('routeVariantRevisions/')){update(null);return {committed:true};}
        attempts++;
        if(attempts<3)return {committed:false};
        const head=update(null);
        assert.equal(head.revisionId,'revision-1');
        assert.match(head.updatedAt,/Z$/);
        return {committed:true};
      },
      get:async()=>({val:()=>null})
    })
  };
  const repository=createRealtimeRouteRepository(database,{maxContentionRetries:3});
  const record={...traversal(),revisionId:'revision-1'};
  const result=await repository.persistVariantRevision(record,null);
  assert.equal(result.contention.attempts,3);
});
