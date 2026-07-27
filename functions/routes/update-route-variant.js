import {geometryFingerprint,projectFamily,projectTraversal} from '../src/generated/routes/index.js';

const routeEvidence=observation=>observation?.routeTraversal||observation?.observed?.routeTraversal||null;

export function createUpdateRouteVariantHandler({repository,clock=()=>Date.now(),project=projectTraversal}={}){
  if(!repository)throw new TypeError('repository is required.');
  return async function update({eventId,observation}={}){
    const traversal=routeEvidence(observation);
    if(!eventId||!observation?.observationId||!traversal)return Object.freeze({status:'ignored',reason:'missing-route-traversal'});
    const receipt=await repository.projectionReceipt(eventId,observation.observationId);
    if(receipt)return Object.freeze({status:'projected',replayed:true,receipt});
    const input={
      eventId,fromCheckpointId:traversal.fromCheckpointId,toCheckpointId:traversal.toCheckpointId,
      points:traversal.points,distanceMeters:traversal.distanceMeters,durationSeconds:traversal.durationSeconds,
      evidenceRefs:[...(traversal.evidenceRefs||[]),`observation:${observation.observationId}`],nowMs:clock()
    };
    const fingerprint=geometryFingerprint(input);
    const candidate=project(input);
    const prior=await repository.variantHead(eventId,candidate.variantId);
    const revision=prior?project({...input,priorVariant:prior}):candidate;
    const persisted=await repository.persistVariantRevision(revision,prior?.revisionId||null);
    const variants=await repository.familyVariants(eventId,revision.familyId);
    const members=[...variants.filter(item=>item.variantId!==revision.variantId),revision];
    const priorFamily=await repository.familyHead(eventId,revision.familyId);
    const family=projectFamily({eventId,familyId:revision.familyId,variants:members,priorFamily,nowMs:clock()});
    await repository.persistFamilyRevision(family,priorFamily?.revisionId||null);
    const projectionReceipt={schemaVersion:1,eventId,observationId:observation.observationId,variantId:revision.variantId,variantRevisionId:revision.revisionId,familyId:family.familyId,familyRevisionId:family.revisionId,projectedAt:new Date(clock()).toISOString(),shadowMode:true};
    await repository.persistProjectionReceipt(eventId,observation.observationId,projectionReceipt);
    await repository.diagnostic(eventId,observation.observationId,{status:'projected',variantId:revision.variantId,familyId:family.familyId,geometryFingerprint:fingerprint});
    return Object.freeze({status:'projected',replayed:!persisted.created,variant:revision,family,receipt:projectionReceipt});
  };
}
