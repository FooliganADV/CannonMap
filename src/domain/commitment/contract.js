export const COMMITMENT_SCHEMA_VERSION=1;
export const COMMITMENT_ALGORITHM_VERSION='commitment-v1';
export const COMMITMENT_STATES=Object.freeze(['pending','candidate','confirmed','rejected','expired']);
export const COMMITMENT_RECORD_KIND='inferred';

const identifier=/^[A-Za-z0-9._:-]{1,160}$/;
const finite=value=>typeof value==='number'&&Number.isFinite(value);

export function validateCommitmentInference(inference){
  const errors=[];
  if(!inference||typeof inference!=='object'||Array.isArray(inference))return {valid:false,errors:['inference must be an object']};
  for(const key of ['inferenceId','competitorId','eventId','checkpointId','traceId']){
    if(typeof inference[key]!=='string'||!identifier.test(inference[key]))errors.push(`${key} is invalid`);
  }
  if(inference.schemaVersion!==COMMITMENT_SCHEMA_VERSION)errors.push('schemaVersion is invalid');
  if(inference.algorithmVersion!==COMMITMENT_ALGORITHM_VERSION)errors.push('algorithmVersion is invalid');
  if(inference.assertionKind!==COMMITMENT_RECORD_KIND)errors.push('commitment must be marked inferred');
  if(!COMMITMENT_STATES.includes(inference.lifecycleState))errors.push('lifecycleState is invalid');
  for(const key of ['createdAt','updatedAt'])if(typeof inference[key]!=='string'||!Number.isFinite(Date.parse(inference[key])))errors.push(`${key} is invalid`);
  if(!Array.isArray(inference.evidenceRefs)||inference.evidenceRefs.length<2||new Set(inference.evidenceRefs).size!==inference.evidenceRefs.length)errors.push('evidenceRefs are invalid');
  const dimensions=inference.confidenceDimensions;
  if(!dimensions||typeof dimensions!=='object'||Array.isArray(dimensions)||Object.keys(dimensions).length!==3)errors.push('confidenceDimensions are invalid');
  for(const key of ['evidenceStrength','spatialConsistency','temporalConsistency']){
    const dimension=dimensions?.[key];
    if(!dimension||!finite(dimension.score)||dimension.score<0||dimension.score>1||typeof dimension.method!=='string'||dimension.version!==1)errors.push(`${key} is invalid`);
  }
  const explanation=inference.explanation;
  if(!explanation||typeof explanation.summary!=='string'||!Array.isArray(explanation.signals)||explanation.signals.length<2)errors.push('explanation is invalid');
  for(const signal of explanation?.signals||[]){
    if(typeof signal.signal!=='string'||typeof signal.statement!=='string'||!Array.isArray(signal.evidenceRefs)||!signal.evidenceRefs.length)errors.push('explanation signal is invalid');
    else if(signal.evidenceRefs.some(ref=>!inference.evidenceRefs.includes(ref)))errors.push('explanation references unknown evidence');
  }
  if('observed' in inference||inference.assertionKind==='observed')errors.push('inferences cannot be observed facts');
  return Object.freeze({valid:errors.length===0,errors:Object.freeze(errors)});
}
