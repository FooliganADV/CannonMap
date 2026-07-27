import {ROUTE_SCHEMA_VERSION,assertRouteRecord} from './contract.js';
import {geometryFingerprint} from './geometry.js';
import {deterministicRouteId,stableRouteValue} from './identity.js';
import {accumulateVariantStats,aggregateFamilyStats,emptyVariantStats} from './statistics.js';

const freeze=value=>Object.freeze(value);
const unique=values=>[...new Set(values)].sort();
const timestamp=value=>new Date(value).toISOString();
const lineageEntry=({kind,at,sourceIds=[],targetIds=[],proposalId=null,reason='',evidenceRefs=[]})=>freeze({
  lineageId:deterministicRouteId('lineage',[kind,sourceIds,targetIds,proposalId,reason,evidenceRefs]),
  kind,at:timestamp(at),sourceIds:freeze(unique(sourceIds)),targetIds:freeze(unique(targetIds)),proposalId,reason,evidenceRefs:freeze(unique(evidenceRefs))
});

export function projectTraversal({eventId,fromCheckpointId,toCheckpointId,points,distanceMeters,durationSeconds,evidenceRefs=[],priorVariant=null,nowMs=Date.now()}={}){
  const fingerprint=geometryFingerprint({eventId,fromCheckpointId,toCheckpointId,points});
  const familyId=priorVariant?.familyId||deterministicRouteId('family',[eventId,fromCheckpointId,toCheckpointId,fingerprint]);
  const variantId=priorVariant?.variantId||deterministicRouteId('variant',[eventId,fromCheckpointId,toCheckpointId,fingerprint]);
  if(priorVariant&&priorVariant.geometryFingerprint!==fingerprint)throw new Error('A variant revision cannot change its geometry fingerprint.');
  const refs=unique([...(priorVariant?.evidenceRefs||[]),...evidenceRefs]);
  const independentStats=accumulateVariantStats(priorVariant?.independentStats||emptyVariantStats(),{distanceMeters,durationSeconds,evidenceRefs});
  const revision=(priorVariant?.revision||0)+1;
  const record={
    schemaVersion:ROUTE_SCHEMA_VERSION,eventId,fromCheckpointId,toCheckpointId,variantId,familyId,
    geometryFingerprint:fingerprint,lifecycle:priorVariant?.lifecycle||'provisional',
    independentStats,evidenceRefs:freeze(refs),revision,createdAt:priorVariant?.createdAt||timestamp(nowMs),updatedAt:timestamp(nowMs),
    supersedesRevision:priorVariant?.revision||null
  };
  record.revisionId=deterministicRouteId('variantRevision',[variantId,revision,stableRouteValue(independentStats),refs]);
  assertRouteRecord(record,'variant');
  return freeze(record);
}

export function projectFamily({eventId,familyId,variants,priorFamily=null,lifecycle,nowMs=Date.now(),lineage=[]}={}){
  const ordered=[...(variants||[])].sort((a,b)=>a.variantId.localeCompare(b.variantId));
  if(ordered.some(item=>item.familyId!==familyId))throw new Error('Family projection received a variant assigned to another family.');
  const revision=(priorFamily?.revision||0)+1;
  const record={
    schemaVersion:ROUTE_SCHEMA_VERSION,eventId,familyId,lifecycle:lifecycle||priorFamily?.lifecycle||'provisional',
    aggregateStats:aggregateFamilyStats(ordered),memberVariantIds:freeze(ordered.map(item=>item.variantId)),
    lineage:freeze([...(priorFamily?.lineage||[]),...lineage]),revision,
    createdAt:priorFamily?.createdAt||timestamp(nowMs),updatedAt:timestamp(nowMs),supersedesRevision:priorFamily?.revision||null
  };
  record.revisionId=deterministicRouteId('familyRevision',[familyId,revision,record.memberVariantIds,record.aggregateStats,record.lineage.map(item=>item.lineageId)]);
  assertRouteRecord(record,'family');
  return freeze(record);
}

export function proposeFamilyMerge({eventId,families,evidenceRefs=[],reason,nowMs=Date.now()}={}){
  if(!Array.isArray(families)||families.length<2)throw new TypeError('A merge proposal requires at least two families.');
  const sourceFamilyIds=unique(families.map(item=>item.familyId));
  const proposalId=deterministicRouteId('mergeProposal',[eventId,sourceFamilyIds,unique(evidenceRefs),reason]);
  const targetFamilyId=deterministicRouteId('family',[eventId,'merge',sourceFamilyIds]);
  return freeze({schemaVersion:ROUTE_SCHEMA_VERSION,proposalId,kind:'merge',lifecycle:'provisional',eventId,sourceFamilyIds:freeze(sourceFamilyIds),targetFamilyIds:freeze([targetFamilyId]),evidenceRefs:freeze(unique(evidenceRefs)),reason:String(reason||'Geometry and evidence review.'),createdAt:timestamp(nowMs)});
}

export function applyProvisionalMerge({proposal,families,variants,nowMs=Date.now()}={}){
  if(proposal?.kind!=='merge'||proposal.lifecycle!=='provisional')throw new TypeError('A provisional merge proposal is required.');
  const targetFamilyId=proposal.targetFamilyIds[0];
  const reassigned=variants.map(item=>freeze({...item,familyId:targetFamilyId,revision:item.revision+1,lifecycle:'provisional',supersedesRevision:item.revision,updatedAt:timestamp(nowMs),revisionId:deterministicRouteId('variantRevision',[item.variantId,item.revision+1,targetFamilyId,proposal.proposalId])}));
  const entry=lineageEntry({kind:'merge-applied',at:nowMs,sourceIds:proposal.sourceFamilyIds,targetIds:[targetFamilyId],proposalId:proposal.proposalId,reason:proposal.reason,evidenceRefs:proposal.evidenceRefs});
  const target=projectFamily({eventId:proposal.eventId,familyId:targetFamilyId,variants:reassigned,nowMs,lineage:[entry]});
  const superseded=families.map(family=>projectFamily({eventId:proposal.eventId,familyId:family.familyId,variants:variants.filter(item=>item.familyId===family.familyId),priorFamily:family,lifecycle:'superseded',nowMs,lineage:[entry]}));
  return freeze({proposal,targetFamily:target,variantRevisions:freeze(reassigned),supersededFamilyRevisions:freeze(superseded),lineage:entry});
}

export function proposeFamilySplit({eventId,family,variantGroups,evidenceRefs=[],reason,nowMs=Date.now()}={}){
  if(!family||!Array.isArray(variantGroups)||variantGroups.length<2||variantGroups.some(group=>!Array.isArray(group)||!group.length))throw new TypeError('A split proposal requires a family and at least two non-empty variant groups.');
  const groups=variantGroups.map(group=>unique(group)).sort((a,b)=>a.join('|').localeCompare(b.join('|')));
  const proposalId=deterministicRouteId('splitProposal',[eventId,family.familyId,groups,unique(evidenceRefs),reason]);
  return freeze({schemaVersion:ROUTE_SCHEMA_VERSION,proposalId,kind:'split',lifecycle:'provisional',eventId,sourceFamilyIds:freeze([family.familyId]),targetFamilyIds:freeze(groups.map(group=>deterministicRouteId('family',[eventId,'split',family.familyId,group]))),variantGroups:freeze(groups.map(freeze)),evidenceRefs:freeze(unique(evidenceRefs)),reason:String(reason||'Independent route evidence review.'),createdAt:timestamp(nowMs)});
}

export function applyProvisionalSplit({proposal,family,variants,nowMs=Date.now()}={}){
  if(proposal?.kind!=='split'||proposal.lifecycle!=='provisional')throw new TypeError('A provisional split proposal is required.');
  const entry=lineageEntry({kind:'split-applied',at:nowMs,sourceIds:[family.familyId],targetIds:proposal.targetFamilyIds,proposalId:proposal.proposalId,reason:proposal.reason,evidenceRefs:proposal.evidenceRefs});
  const variantById=new Map(variants.map(item=>[item.variantId,item]));
  const targetFamilies=[],variantRevisions=[];
  proposal.variantGroups.forEach((group,index)=>{
    const targetFamilyId=proposal.targetFamilyIds[index];
    const members=group.map(id=>{
      const item=variantById.get(id);
      if(!item)throw new Error(`Split proposal references missing variant: ${id}`);
      const revised=freeze({...item,familyId:targetFamilyId,revision:item.revision+1,lifecycle:'provisional',supersedesRevision:item.revision,updatedAt:timestamp(nowMs),revisionId:deterministicRouteId('variantRevision',[item.variantId,item.revision+1,targetFamilyId,proposal.proposalId])});
      variantRevisions.push(revised);
      return revised;
    });
    targetFamilies.push(projectFamily({eventId:proposal.eventId,familyId:targetFamilyId,variants:members,nowMs,lineage:[entry]}));
  });
  const sourceRevision=projectFamily({eventId:proposal.eventId,familyId:family.familyId,variants,priorFamily:family,lifecycle:'superseded',nowMs,lineage:[entry]});
  return freeze({proposal,targetFamilies:freeze(targetFamilies),variantRevisions:freeze(variantRevisions),supersededFamilyRevision:sourceRevision,lineage:entry});
}
