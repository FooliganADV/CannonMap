export const NETWORK_SCHEMA_VERSION=1;
export const NETWORK_COMMANDS=Object.freeze(['AddMember','RemoveMember','UpdateWeight','UpdateNotes']);

export function validateNetworkCommand(command){
  const errors=[];
  if(!command||command.schemaVersion!==NETWORK_SCHEMA_VERSION)errors.push('schemaVersion');
  if(!NETWORK_COMMANDS.includes(command?.type))errors.push('type');
  for(const field of ['commandId','uid','eventId','memberId','issuedAt'])if(command?.[field]===undefined||command[field]===null||command[field]==='')errors.push(field);
  if(command?.type==='UpdateWeight'&&(!Number.isFinite(command.weight)||command.weight<0||command.weight>1))errors.push('weight');
  if(command?.notes!==undefined&&(typeof command.notes!=='string'||command.notes.length>500))errors.push('notes');
  if(command?.actorUid!==command?.uid)errors.push('ownership');
  if(command?.authorization!=='explicit-user-command')errors.push('authorization');
  if(command?.eventMembershipVerified!==true)errors.push('event-membership');
  return Object.freeze({valid:errors.length===0,errors:Object.freeze(errors)});
}

export function assertNetworkCommand(command){
  const result=validateNetworkCommand(command);
  if(!result.valid)throw new TypeError(`Invalid network command: ${result.errors.join(', ')}`);
  return command;
}
