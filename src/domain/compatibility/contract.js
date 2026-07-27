export const COMPATIBILITY_SCHEMA_VERSION=1;
export const COMPATIBILITY_ALGORITHM_VERSION='m10-compatibility-v1';
export const SUGGESTION_ALGORITHM_VERSION='m10-suggestion-v1';
export const COMPATIBILITY_SUGGESTIONS_FLAG='architecture.intelligence.compatibility-suggestions';
export const SUGGESTION_STATUSES=Object.freeze(['Proposed','Viewed','Accepted','Rejected','Expired']);

const prohibitedConfidenceFields=['overallConfidence','combinedConfidence','aggregateConfidence','totalConfidence','confidenceScore'];
const required=(value,fields)=>fields.filter(field=>value?.[field]===undefined||value[field]===null);

export function validateCompatibilityResult(result){
  const errors=required(result,['compatibilityId','eventId','riderA','candidateId','createdAt','updatedAt','schemaVersion','algorithmVersion','status','evidenceRefs','inputs','explanation','limitations','provenance','traceId','revision']);
  if(result?.schemaVersion!==COMPATIBILITY_SCHEMA_VERSION||result?.algorithmVersion!==COMPATIBILITY_ALGORITHM_VERSION)errors.push('version');
  if(result?.status==='Scored'&&(!Number.isFinite(result.score)||result.score<0||result.score>1))errors.push('score');
  if(result?.status==='InsufficientEvidence'&&result.score!==null)errors.push('insufficient-score');
  if(!Array.isArray(result?.evidenceRefs)||!Array.isArray(result?.limitations)||!Array.isArray(result?.provenance))errors.push('metadata');
  if(prohibitedConfidenceFields.some(field=>Object.prototype.hasOwnProperty.call(result||{},field)))errors.push('confidence-separation');
  return Object.freeze({valid:errors.length===0,errors:Object.freeze(errors)});
}

export function assertCompatibilityResult(result){
  const validation=validateCompatibilityResult(result);
  if(!validation.valid)throw new TypeError(`Invalid compatibility result: ${validation.errors.join(', ')}`);
  return result;
}

export function validateSuggestion(suggestion){
  const errors=required(suggestion,['suggestionId','eventId','userId','candidateId','compatibilityRef','createdAt','schemaVersion','algorithmVersion','evidenceRefs','explanation','status','provenance']);
  if(suggestion?.schemaVersion!==COMPATIBILITY_SCHEMA_VERSION||suggestion?.algorithmVersion!==SUGGESTION_ALGORITHM_VERSION)errors.push('version');
  if(!SUGGESTION_STATUSES.includes(suggestion?.status))errors.push('status');
  if(suggestion?.expiresAt!==null&&suggestion?.expiresAt!==undefined&&(!Number.isInteger(suggestion.expiresAt)||suggestion.expiresAt<suggestion.createdAt))errors.push('expiresAt');
  return Object.freeze({valid:errors.length===0,errors:Object.freeze(errors)});
}

export function assertSuggestion(value){
  const validation=validateSuggestion(value);
  if(!validation.valid)throw new TypeError(`Invalid suggestion: ${validation.errors.join(', ')}`);
  return value;
}
