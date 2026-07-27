import {assertSuggestion,COMPATIBILITY_SCHEMA_VERSION,SUGGESTION_ALGORITHM_VERSION,SUGGESTION_STATUSES} from './contract.js';
import {deterministicIntelligenceId} from '../checkpoints/identity.js';

const freeze=value=>Object.freeze(value);

export function createCompatibilitySuggestion({eventId,userId,candidateId,compatibility,createdAt,expiresAt=null}={}){
  if(compatibility?.status!=='Scored'||!Number.isInteger(createdAt))return null;
  const suggestionId=deterministicIntelligenceId('suggestion',[eventId,userId,candidateId,compatibility.revisionId]);
  const record={
    suggestionId,eventId,userId,candidateId,compatibilityRef:compatibility.revisionId,createdAt,expiresAt,
    schemaVersion:COMPATIBILITY_SCHEMA_VERSION,algorithmVersion:SUGGESTION_ALGORITHM_VERSION,
    evidenceRefs:compatibility.evidenceRefs,explanation:compatibility.explanation,status:'Proposed',
    provenance:freeze([{kind:'compatibility-projection',traceId:compatibility.traceId}]),revision:1,priorRevisionRef:null
  };
  assertSuggestion(record);
  return freeze(record);
}

export function transitionSuggestion({suggestion,status,at}={}){
  if(!suggestion||!SUGGESTION_STATUSES.includes(status)||!Number.isInteger(at))throw new TypeError('Suggestion, valid status, and timestamp are required.');
  const allowed={Proposed:['Viewed','Accepted','Rejected','Expired'],Viewed:['Accepted','Rejected','Expired'],Accepted:[],Rejected:[],Expired:[]};
  if(!allowed[suggestion.status]?.includes(status))throw new Error(`Invalid suggestion transition: ${suggestion.status} -> ${status}`);
  if(status==='Expired'&&suggestion.expiresAt!==null&&at<suggestion.expiresAt)throw new Error('Suggestion cannot expire before expiresAt.');
  const record={...suggestion,status,updatedAt:at,revision:suggestion.revision+1,priorRevisionRef:suggestion.revisionId||`${suggestion.suggestionId}:1`};
  record.revisionId=deterministicIntelligenceId('suggestionRevision',[suggestion.suggestionId,record.revision,status,at]);
  assertSuggestion(record);
  return freeze(record);
}
