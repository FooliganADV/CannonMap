export const CONFIDENCE_SCHEMA_VERSION=1;
export const CONFIDENCE_ALGORITHM_VERSION='m9-confidence-evolution-v1';
export const CONFIDENCE_DIMENSIONS=Object.freeze([
  'quality','evidenceStrength','inference','historical','current','recency','stability'
]);
export const PROHIBITED_CONFIDENCE_FIELDS=Object.freeze([
  'overallConfidence','totalConfidence','aggregateConfidence','compositeConfidence',
  'weightedConfidence','normalizedConfidence','combinedConfidence'
]);

const requiredVectorFields=['eventId','subjectType','subjectId','revision','revisionId','schemaVersion','algorithmVersion','createdAt','updatedAt','dimensions','evidenceRefs','provenance','inputs'];
const requiredDimensionFields=['value','method','methodVersion','updatedAt','evidenceRefs','provenance','policyId','policyVersion','priorValue','changeReason'];
const integer=value=>Number.isInteger(value)&&value>=0;
const identifier=value=>typeof value==='string'&&value.length>0;
const confidenceValue=value=>value===null||(Number.isFinite(value)&&value>=0&&value<=1);

export function findProhibitedConfidenceFields(value,path='$',found=[]){
  if(!value||typeof value!=='object')return found;
  for(const [key,child] of Object.entries(value)){
    if(PROHIBITED_CONFIDENCE_FIELDS.includes(key))found.push(`${path}.${key}`);
    findProhibitedConfidenceFields(child,`${path}.${key}`,found);
  }
  return found;
}

export function validateConfidenceVector(vector){
  const errors=[];
  for(const field of requiredVectorFields)if(vector?.[field]===undefined||vector[field]===null)errors.push(`missing:${field}`);
  if(vector?.schemaVersion!==CONFIDENCE_SCHEMA_VERSION)errors.push('schemaVersion');
  if(vector?.algorithmVersion!==CONFIDENCE_ALGORITHM_VERSION)errors.push('algorithmVersion');
  if(!identifier(vector?.eventId)||!identifier(vector?.subjectType)||!identifier(vector?.subjectId)||!identifier(vector?.revisionId))errors.push('identity');
  if(!Number.isInteger(vector?.revision)||vector.revision<1)errors.push('revision');
  if(!integer(vector?.createdAt)||!integer(vector?.updatedAt)||vector?.updatedAt<vector?.createdAt)errors.push('timestamps');
  if(vector?.priorRevisionRef!==undefined&&vector.priorRevisionRef!==null&&!identifier(vector.priorRevisionRef))errors.push('priorRevisionRef');
  if(!Array.isArray(vector?.evidenceRefs))errors.push('evidenceRefs');
  if(!Array.isArray(vector?.provenance)||!vector?.inputs||typeof vector.inputs!=='object')errors.push('provenance-inputs');
  if(findProhibitedConfidenceFields(vector).length)errors.push('combined-confidence-field');
  const keys=Object.keys(vector?.dimensions||{}).sort();
  if(JSON.stringify(keys)!==JSON.stringify([...CONFIDENCE_DIMENSIONS].sort()))errors.push('dimensions');
  for(const name of CONFIDENCE_DIMENSIONS){
    const dimension=vector?.dimensions?.[name];
    for(const field of requiredDimensionFields)if(dimension?.[field]===undefined)errors.push(`${name}:missing:${field}`);
    if(!confidenceValue(dimension?.value)||!confidenceValue(dimension?.priorValue))errors.push(`${name}:bounds`);
    if(!integer(dimension?.updatedAt)||!Array.isArray(dimension?.evidenceRefs)||!Array.isArray(dimension?.provenance))errors.push(`${name}:metadata`);
    if(!identifier(dimension?.method)||!Number.isInteger(dimension?.methodVersion)||!identifier(dimension?.policyId)||!Number.isInteger(dimension?.policyVersion))errors.push(`${name}:policy`);
  }
  return Object.freeze({valid:errors.length===0,errors:Object.freeze(errors)});
}

export function assertConfidenceVector(vector){
  const result=validateConfidenceVector(vector);
  if(!result.valid)throw new TypeError(`Invalid ConfidenceVector: ${result.errors.join(', ')}`);
  return vector;
}
