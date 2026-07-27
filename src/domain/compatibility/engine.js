import {assertCompatibilityResult,COMPATIBILITY_ALGORITHM_VERSION,COMPATIBILITY_SCHEMA_VERSION} from './contract.js';
import {deterministicIntelligenceId,stableIntelligenceValue} from '../checkpoints/identity.js';

const freeze=value=>Object.freeze(value);
const clamp=value=>Math.max(0,Math.min(1,value));
const unique=values=>freeze([...new Set(values||[])].sort());
const FEATURE_POLICIES=freeze({
  speedDistribution:freeze({weight:.25,version:1}),
  failurePattern:freeze({weight:.2,version:1}),
  checkpointDwell:freeze({weight:.2,version:1}),
  routePreference:freeze({weight:.2,version:1}),
  sequenceBehavior:freeze({weight:.15,version:1})
});

function similarity(feature,a,b){
  if(feature==='routePreference'){
    const left=new Set(a),right=new Set(b),union=new Set([...left,...right]);
    return union.size?[...union].filter(value=>left.has(value)&&right.has(value)).length/union.size:null;
  }
  if(!Number.isFinite(a)||!Number.isFinite(b))return null;
  const scale=Math.max(Math.abs(a),Math.abs(b),1);
  return clamp(1-Math.abs(a-b)/scale);
}

export function compareCompatibility({eventId,riderA,candidateId,profileA,profileB,priorResult=null,evaluationTime,minFeatures=2}={}){
  if(!eventId||!riderA||!candidateId||!profileA||!profileB||!Number.isInteger(evaluationTime))throw new TypeError('Compatibility identity, profiles, and integer evaluationTime are required.');
  const comparisons=[],missing=[],evidence=[];
  for(const [feature,policy] of Object.entries(FEATURE_POLICIES)){
    const left=profileA.features?.[feature],right=profileB.features?.[feature];
    const value=similarity(feature,left?.value,right?.value);
    if(value===null){missing.push(feature);continue;}
    const refs=unique([...(left?.evidenceRefs||[]),...(right?.evidenceRefs||[])]);
    evidence.push(...refs);
    comparisons.push(freeze({feature,similarity:value,weight:policy.weight,policyVersion:policy.version,evidenceRefs:refs,direction:value>=.5?'increased':'decreased'}));
  }
  const enough=comparisons.length>=minFeatures;
  const score=enough?clamp(comparisons.reduce((sum,item)=>sum+item.similarity*item.weight,0)/comparisons.reduce((sum,item)=>sum+item.weight,0)):null;
  const compatibilityId=deterministicIntelligenceId('compatibility',[eventId,riderA,candidateId]);
  const inputFingerprint=stableIntelligenceValue({comparisons,missing,profileARevision:profileA.revision,profileBRevision:profileB.revision});
  if(priorResult?.inputFingerprint===inputFingerprint)return priorResult;
  const revision=(priorResult?.revision||0)+1;
  const result={
    compatibilityId,eventId,riderA,candidateId,createdAt:priorResult?.createdAt??evaluationTime,updatedAt:evaluationTime,
    schemaVersion:COMPATIBILITY_SCHEMA_VERSION,algorithmVersion:COMPATIBILITY_ALGORITHM_VERSION,
    status:enough?'Scored':'InsufficientEvidence',score,evidenceRefs:unique(evidence),
    inputs:freeze({profileARevision:profileA.revision,profileBRevision:profileB.revision,featureComparisons:freeze(comparisons),unavailableFeatures:freeze(missing)}),
    explanation:enough?`Compared ${comparisons.length} evidence-backed features; ${comparisons.filter(item=>item.direction==='increased').length} increased compatibility and ${comparisons.filter(item=>item.direction==='decreased').length} decreased it.`:`Only ${comparisons.length} evidence-backed features were available; ${minFeatures} are required.`,
    limitations:freeze([...missing.map(feature=>`Unavailable feature: ${feature}`),...(profileA.lowQuality||profileB.lowQuality?['Some supporting evidence is low quality.']:[])]),
    provenance:freeze(comparisons.map(item=>freeze({feature:item.feature,evidenceRefs:item.evidenceRefs,policyVersion:item.policyVersion}))),
    traceId:deterministicIntelligenceId('compatibilityTrace',[compatibilityId,revision,inputFingerprint]),revision,
    priorRevisionRef:priorResult?.revisionId||null,inputFingerprint
  };
  result.revisionId=deterministicIntelligenceId('compatibilityRevision',[compatibilityId,revision,inputFingerprint]);
  assertCompatibilityResult(result);
  return freeze(result);
}

export {FEATURE_POLICIES};
