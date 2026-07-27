import {assertSequenceAggregate,CHECKPOINT_SCHEMA_VERSION,SEQUENCE_ALGORITHM_VERSION} from './contract.js';
import {deterministicIntelligenceId,stableIntelligenceValue} from './identity.js';

const freeze=value=>Object.freeze(value);
const unique=values=>freeze([...new Set((values||[]).filter(Boolean))].sort());
const distribution=values=>freeze({sampleCount:values.length,meanMs:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,minMs:values.length?Math.min(...values):null,maxMs:values.length?Math.max(...values):null});

export function rebuildSequenceAggregate({eventId,orderedCheckpointIds,evidence=[],sourceCheckpointRevisionRefs=[],routeFamilyRefs=[],routeVariantRefs=[],confidenceRefs=[],priorAggregate=null,evaluationTime}={}){
  if(!eventId||!Array.isArray(orderedCheckpointIds)||orderedCheckpointIds.length<2||!Number.isInteger(evaluationTime))throw new TypeError('A supported ordered checkpoint sequence and evaluationTime are required.');
  const sequenceId=deterministicIntelligenceId('sequence',[eventId,orderedCheckpointIds]);
  const relevant=evidence.filter(item=>item?.sequenceId===sequenceId||stableIntelligenceValue(item?.orderedCheckpointIds)===stableIntelligenceValue(orderedCheckpointIds));
  const byId=new Map();
  for(const item of relevant){
    if(!item.evidenceId)throw new TypeError('Sequence evidence requires evidenceId.');
    const prior=byId.get(item.evidenceId);
    if(prior&&stableIntelligenceValue(prior)!==stableIntelligenceValue(item))throw new Error(`Conflicting evidence replay: ${item.evidenceId}`);
    byId.set(item.evidenceId,freeze({...item}));
  }
  const ordered=[...byId.values()].sort((a,b)=>a.evidenceId.localeCompare(b.evidenceId));
  const success=ordered.filter(item=>item.outcome==='success'),failure=ordered.filter(item=>item.outcome==='failure');
  const elapsed=ordered.filter(item=>Number.isFinite(item.elapsedMs)).map(item=>item.elapsedMs);
  const transitions={};
  for(let index=0;index<orderedCheckpointIds.length-1;index++)transitions[`${orderedCheckpointIds[index]}->${orderedCheckpointIds[index+1]}`]=ordered.length;
  const inputs={evidenceRefs:ordered.map(item=>item.evidenceId),sourceCheckpointRevisionRefs:unique(sourceCheckpointRevisionRefs),routeFamilyRefs:unique(routeFamilyRefs),routeVariantRefs:unique(routeVariantRefs),confidenceRefs:unique(confidenceRefs)};
  const fingerprint=stableIntelligenceValue({orderedCheckpointIds,inputs,success:success.length,failure:failure.length,elapsed});
  if(priorAggregate?.inputFingerprint===fingerprint)return priorAggregate;
  const revision=(priorAggregate?.revision||0)+1;
  const record={
    eventId,sequenceId,orderedCheckpointIds:freeze([...orderedCheckpointIds]),revision,schemaVersion:CHECKPOINT_SCHEMA_VERSION,algorithmVersion:SEQUENCE_ALGORITHM_VERSION,
    createdAt:priorAggregate?.createdAt??evaluationTime,updatedAt:evaluationTime,evidenceRefs:freeze(inputs.evidenceRefs),sourceCheckpointRevisionRefs:inputs.sourceCheckpointRevisionRefs,
    aggregateProfile:freeze({observationCount:ordered.length,complete:ordered.length>0}),transitionCounts:freeze(transitions),
    statistics:freeze({successCount:success.length,failureCount:failure.length,elapsedTime:distribution(elapsed)}),
    routeFamilyRefs:inputs.routeFamilyRefs,routeVariantRefs:inputs.routeVariantRefs,confidenceRefs:inputs.confidenceRefs,
    provenance:freeze(ordered.map(item=>freeze({evidenceRef:item.evidenceId,assertionKind:'observed'}))),
    explanation:ordered.length?`Sequence is supported by ${ordered.length} observations; variant references remain independent from family references.`:'No evidence supports this sequence.',
    priorRevisionRef:priorAggregate?.revisionId||null,inputFingerprint:fingerprint
  };
  record.revisionId=deterministicIntelligenceId('sequenceRevision',[sequenceId,revision,fingerprint]);
  assertSequenceAggregate(record);
  return freeze(record);
}
