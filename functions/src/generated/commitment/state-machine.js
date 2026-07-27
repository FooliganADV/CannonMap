const TRANSITIONS=Object.freeze({
  pending:new Set(['candidate','rejected','expired']),
  candidate:new Set(['confirmed','rejected','expired']),
  confirmed:new Set(['expired']),
  rejected:new Set(),
  expired:new Set()
});

export function transitionCommitment(current,next){
  if(!TRANSITIONS[current])throw new Error(`Unknown commitment lifecycle state: ${current}`);
  if(!TRANSITIONS[current].has(next))throw new Error(`Invalid commitment transition: ${current} -> ${next}`);
  return next;
}

export function canTransitionCommitment(current,next){
  return Boolean(TRANSITIONS[current]?.has(next));
}
