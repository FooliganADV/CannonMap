const TRANSITIONS=Object.freeze({
  idle:new Set(['assessing']),
  assessing:new Set(['rejected','suppressed','persisting']),
  persisting:new Set(['persisted','failed']),
  rejected:new Set(['idle']),
  suppressed:new Set(['idle']),
  persisted:new Set(['idle']),
  failed:new Set(['idle'])
});

export function transitionCaptureState(current,next){
  if(!TRANSITIONS[current]?.has(next))throw new Error(`Invalid observation capture transition: ${current} -> ${next}`);
  return next;
}
