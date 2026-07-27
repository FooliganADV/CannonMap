import {assertCheckpointAggregate,CHECKPOINT_ALGORITHM_VERSION,CHECKPOINT_SCHEMA_VERSION} from './contract.js';
import {deterministicIntelligenceId,stableIntelligenceValue} from './identity.js';

const freeze=value=>Object.freeze(value);
const unique=values=>freeze([...new Set((values||[]).filter(Boolean))].sort());
const mean=values=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;
const stats=values=>freeze({sampleCount:values.length,meanMs:mean(values),minMs:values.length?Math.min(...values):null,maxMs:values.length?Math.max(...values):null});
const qualityWeight=value=>Number.isFinite(value)?Math.max(0,Math.min(1,value)):1;

function normalizeEvidence(evidence){
  if(!evidence||typeof evidence!=='object'||!evidence.evidenceId)throw new TypeError('Checkpoint evidence requires evidenceId.');
  if(!['success','failure'].includes(evidence.outcome))throw new TypeError('Checkpoint evidence outcome must be success or failure.');
  return freeze({...evidence,qualityWeight:qualityWeight(evidence.qualityWeight)});
}

export function rebuildCheckpointAggregate({eventId,checkpointId,evidence=[],sourceRevisionRefs=[],routeFamilyRefs=[],confidenceRefs=[],priorAggregate=null,evaluationTime}={}){
  if(!eventId||!checkpointId||!Number.isInteger(evaluationTime))throw new TypeError('eventId, checkpointId, and integer evaluationTime are required.');
  const byId=new Map();
  for(const item of evidence.map(normalizeEvidence)){
    if(item.eventId!==eventId||item.checkpointId!==checkpointId)continue;
    const prior=byId.get(item.evidenceId);
    if(prior&&stableIntelligenceValue(prior)!==stableIntelligenceValue(item))throw new Error(`Conflicting evidence replay: ${item.evidenceId}`);
    byId.set(item.evidenceId,item);
  }
  const ordered=[...byId.values()].sort((a,b)=>a.evidenceId.localeCompare(b.evidenceId));
  const successes=ordered.filter(item=>item.outcome==='success');
  const failures=ordered.filter(item=>item.outcome==='failure');
  const dwell=ordered.filter(item=>Number.isFinite(item.dwellMs)).map(item=>item.dwellMs);
  const transitions={};
  for(const item of ordered){
    for(const target of item.transitionToCheckpointIds||[])transitions[target]=(transitions[target]||0)+1;
  }
  const weighted=freeze({
    success:successes.reduce((sum,item)=>sum+item.qualityWeight,0),
    failure:failures.reduce((sum,item)=>sum+item.qualityWeight,0)
  });
  const aggregateId=deterministicIntelligenceId('checkpoint',[eventId,checkpointId]);
  const inputs={evidenceRefs:ordered.map(item=>item.evidenceId),sourceRevisionRefs:unique(sourceRevisionRefs),routeFamilyRefs:unique(routeFamilyRefs),confidenceRefs:unique(confidenceRefs)};
  const content=stableIntelligenceValue({inputs,successCount:successes.length,failureCount:failures.length,dwell,transitions,weighted});
  if(priorAggregate?.inputFingerprint===content)return priorAggregate;
  const revision=(priorAggregate?.revision||0)+1;
  const record={
    eventId,checkpointId,aggregateId,revision,schemaVersion:CHECKPOINT_SCHEMA_VERSION,algorithmVersion:CHECKPOINT_ALGORITHM_VERSION,
    createdAt:priorAggregate?.createdAt??evaluationTime,updatedAt:evaluationTime,evidenceRefs:freeze(inputs.evidenceRefs),
    sourceRevisionRefs:inputs.sourceRevisionRefs,successCount:successes.length,failureCount:failures.length,
    successEvidenceRefs:freeze(successes.map(item=>item.evidenceId)),failureEvidenceRefs:freeze(failures.map(item=>item.evidenceId)),
    dwellStatistics:stats(dwell),transitionStatistics:freeze(Object.fromEntries(Object.entries(transitions).sort())),
    weightedEvidence:weighted,routeFamilyRefs:inputs.routeFamilyRefs,confidenceRefs:inputs.confidenceRefs,
    provenance:freeze(ordered.map(item=>freeze({evidenceRef:item.evidenceId,qualityWeight:item.qualityWeight,assertionKind:'observed'}))),
    explanation:`${successes.length} successful and ${failures.length} failed observations retained; low-quality evidence is retained with explicit weight.`,
    priorRevisionRef:priorAggregate?.revisionId||null,inputFingerprint:content
  };
  record.revisionId=deterministicIntelligenceId('checkpointRevision',[aggregateId,revision,content]);
  assertCheckpointAggregate(record);
  return freeze(record);
}
