import {assertNetworkCommand,NETWORK_SCHEMA_VERSION} from './contract.js';
import {deterministicIntelligenceId} from '../checkpoints/identity.js';

const freeze=value=>Object.freeze(value);
const cloneMembers=members=>new Map((members||[]).map(member=>[member.memberId,{...member}]));

export function emptyNetwork({uid,eventId}={}){
  return freeze({schemaVersion:NETWORK_SCHEMA_VERSION,uid,eventId,revision:0,members:freeze([]),audit:freeze([]),updatedAt:null});
}

export function applyNetworkCommand({snapshot,command}={}){
  assertNetworkCommand(command);
  const current=snapshot||emptyNetwork({uid:command.uid,eventId:command.eventId});
  if(current.uid!==command.uid||current.eventId!==command.eventId)throw new Error('Network command scope mismatch.');
  if(current.audit.some(item=>item.commandId===command.commandId))return current;
  const members=cloneMembers(current.members),existing=members.get(command.memberId);
  if(command.type==='AddMember'){
    if(existing)throw new Error('Member already exists.');
    members.set(command.memberId,{memberId:command.memberId,weight:command.weight??1,notes:command.notes??'',addedAt:command.issuedAt,updatedAt:command.issuedAt});
  }else if(command.type==='RemoveMember'){
    if(!existing)throw new Error('Member does not exist.');
    members.delete(command.memberId);
  }else{
    if(!existing)throw new Error('Member does not exist.');
    members.set(command.memberId,{...existing,...(command.type==='UpdateWeight'?{weight:command.weight}:{notes:command.notes}),updatedAt:command.issuedAt});
  }
  const revision=current.revision+1;
  const audit=freeze([...current.audit,freeze({commandId:command.commandId,type:command.type,actorUid:command.actorUid,memberId:command.memberId,issuedAt:command.issuedAt,attribution:'explicit-user-command'})]);
  return freeze({schemaVersion:NETWORK_SCHEMA_VERSION,uid:current.uid,eventId:current.eventId,revision,revisionId:deterministicIntelligenceId('networkRevision',[current.uid,current.eventId,revision,command.commandId]),priorRevisionRef:current.revisionId||null,members:freeze([...members.values()].sort((a,b)=>a.memberId.localeCompare(b.memberId)).map(freeze)),audit,updatedAt:command.issuedAt});
}

export const listNetworkMembers=snapshot=>freeze([...(snapshot?.members||[])]);
export const readNetworkSnapshot=snapshot=>snapshot;

export function acceptSuggestion({snapshot,suggestion,command}={}){
  if(suggestion?.status!=='Accepted')throw new Error('Only an explicitly accepted suggestion may accompany a network command.');
  if(command?.type!=='AddMember'||command.memberId!==suggestion.candidateId)throw new Error('Suggestion acceptance requires a separate matching AddMember command.');
  return applyNetworkCommand({snapshot,command});
}

export function assertSuggestionDoesNotMutateNetwork({snapshot,suggestions}={}){
  void suggestions;
  return snapshot;
}
