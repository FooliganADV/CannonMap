import {
  CONFIDENCE_ALGORITHM_VERSION,CONFIDENCE_DIMENSIONS,CONFIDENCE_SCHEMA_VERSION,assertConfidenceVector
} from '../../../shared/contracts/confidence-vector.js';
import {confidenceId,stableConfidenceValue} from './identity.js';
import {M9_DIMENSION_POLICIES} from './policies/index.js';

const freeze=value=>Object.freeze(value);
const unique=values=>[...new Set(values)].sort();
const dimensionEvidence=(evidence,name)=>evidence.filter(item=>item.effects?.[name]).map(item=>freeze({
  evidenceId:item.evidenceId,occurredAt:item.occurredAt,...item.effects[name]
}));
const same=(left,right)=>stableConfidenceValue(left)===stableConfidenceValue(right);

function initialDimension(policy,nowMs){
  return freeze({
    value:null,method:policy.method,methodVersion:policy.methodVersion,updatedAt:nowMs,
    evidenceRefs:freeze([]),provenance:freeze([]),policyId:policy.policyId,policyVersion:policy.policyVersion,
    priorValue:null,changeReason:'uninitialized'
  });
}

function evolveDimension({name,policy,prior,evidence,nowMs,priorRevisionRef,algorithmVersion,isInitial}){
  const relevant=dimensionEvidence(evidence,name);
  const elapsedMs=nowMs-prior.updatedAt;
  if(elapsedMs<0)throw new RangeError('Confidence evaluation time cannot move backward.');
  const result=policy.evolve({priorValue:prior.value,priorDimension:prior,evidence:relevant,elapsedMs,nowMs});
  const refs=unique([...prior.evidenceRefs,...relevant.map(item=>item.evidenceId)]);
  const changed=isInitial||result.value!==prior.value||refs.length!==prior.evidenceRefs.length;
  if(!changed)return prior;
  const provenanceEntry=freeze({
    algorithmVersion,policyId:policy.policyId,policyVersion:policy.policyVersion,
    evaluatedAt:nowMs,priorRevisionRef,evidenceRefs:freeze(relevant.map(item=>item.evidenceId).sort()),
    effects:freeze(relevant.map(item=>freeze({evidenceId:item.evidenceId,kind:item.kind,value:item.value??null}))),
    changeReason:result.changeReason
  });
  const dimension={
    value:result.value,method:policy.method,methodVersion:policy.methodVersion,updatedAt:nowMs,
    evidenceRefs:freeze(refs),provenance:freeze([...prior.provenance,provenanceEntry]),
    policyId:policy.policyId,policyVersion:policy.policyVersion,priorValue:prior.value,
    changeReason:result.changeReason
  };
  if(result.decayBasis)dimension.decayBasis=result.decayBasis;
  if(result.reinforcementBasis)dimension.reinforcementBasis=result.reinforcementBasis;
  return freeze(dimension);
}

export function evolveConfidenceVector({
  eventId,subjectType,subjectId,priorVector=null,evidence=[],evaluationTime,
  policies=M9_DIMENSION_POLICIES,migrationInput=null
}={}){
  if(!eventId||!subjectType||!subjectId)throw new TypeError('Confidence evolution requires event and subject identity.');
  if(!Number.isInteger(evaluationTime)||evaluationTime<0)throw new TypeError('evaluationTime must be a non-negative integer timestamp.');
  if(priorVector){
    assertConfidenceVector(priorVector);
    if(priorVector.eventId!==eventId||priorVector.subjectType!==subjectType||priorVector.subjectId!==subjectId)throw new Error('Prior ConfidenceVector belongs to another subject.');
    if(evaluationTime<priorVector.updatedAt)throw new RangeError('Confidence evaluation time cannot move backward.');
  }
  const priorEvidence=new Set(priorVector?.evidenceRefs||[]);
  const freshEvidence=(Array.isArray(evidence)?evidence:[])
    .filter(item=>item&&typeof item.evidenceId==='string'&&!priorEvidence.has(item.evidenceId))
    .sort((left,right)=>left.occurredAt-right.occurredAt||left.evidenceId.localeCompare(right.evidenceId));
  for(const item of freshEvidence){
    if(!Number.isInteger(item.occurredAt)||item.occurredAt<0||item.occurredAt>evaluationTime)throw new RangeError('Evidence timestamps must be integer milliseconds no later than evaluationTime.');
  }
  const priorRevisionRef=priorVector?.revisionId||null;
  const dimensions={};
  for(const name of CONFIDENCE_DIMENSIONS){
    const policy=policies[name];
    if(!policy||policy.name!==name)throw new TypeError(`Missing independent policy for ${name}.`);
    dimensions[name]=evolveDimension({
      name,policy,prior:priorVector?.dimensions?.[name]||initialDimension(policy,evaluationTime),
      evidence:freshEvidence,nowMs:evaluationTime,priorRevisionRef,algorithmVersion:CONFIDENCE_ALGORITHM_VERSION,isInitial:!priorVector
    });
  }
  const changed=!priorVector||CONFIDENCE_DIMENSIONS.some(name=>dimensions[name]!==priorVector.dimensions[name])||(!priorVector?.migrationSource&&migrationInput);
  if(!changed)return priorVector;
  const revision=(priorVector?.revision||0)+1;
  const evidenceRefs=unique([...(priorVector?.evidenceRefs||[]),...freshEvidence.map(item=>item.evidenceId)]);
  const provenanceEntry=freeze({
    kind:migrationInput&&!priorVector?'legacy-migration-initialization':'confidence-evolution',
    algorithmVersion:CONFIDENCE_ALGORITHM_VERSION,evaluatedAt:evaluationTime,priorRevisionRef,
    evidenceRefs:freeze(freshEvidence.map(item=>item.evidenceId).sort())
  });
  const inputs=freeze({
    evaluationTime,
    evidenceIds:freeze(freshEvidence.map(item=>item.evidenceId)),
    policyVersions:freeze(Object.fromEntries(CONFIDENCE_DIMENSIONS.map(name=>[name,`${policies[name].policyId}@${policies[name].policyVersion}`])))
  });
  const vector={
    eventId,subjectType,subjectId,revision,schemaVersion:CONFIDENCE_SCHEMA_VERSION,
    algorithmVersion:CONFIDENCE_ALGORITHM_VERSION,createdAt:priorVector?.createdAt??evaluationTime,updatedAt:evaluationTime,
    dimensions:freeze(dimensions),evidenceRefs:freeze(evidenceRefs),
    provenance:freeze([...(priorVector?.provenance||[]),provenanceEntry]),inputs,
    priorRevisionRef
  };
  if(priorVector?.migrationSource)vector.migrationSource=priorVector.migrationSource;
  if(migrationInput&&!priorVector)vector.migrationSource=freeze({
    kind:migrationInput.kind,originalValue:migrationInput.originalValue,source:migrationInput.source,
    readAt:migrationInput.readAt,authoritative:false,dimensionMappings:freeze({})
  });
  vector.revisionId=confidenceId('confidenceRevision',[
    eventId,subjectType,subjectId,revision,priorRevisionRef,evaluationTime,evidenceRefs,
    CONFIDENCE_DIMENSIONS.map(name=>dimensions[name])
  ]);
  assertConfidenceVector(vector);
  return freeze(vector);
}
