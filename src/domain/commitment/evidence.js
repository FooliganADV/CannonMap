const stableHash=value=>{
  let hash=2166136261;
  for(const character of String(value)){hash^=character.charCodeAt(0);hash=Math.imul(hash,16777619);}
  return (hash>>>0).toString(16).padStart(8,'0');
};

export const deterministicId=(prefix,parts)=>`${prefix}-${stableHash(parts.join('|'))}`;

export function createObservationEvidence({eventId,competitorId,observation}){
  const evidenceId=deterministicId('evidence',[eventId,competitorId,observation.observationId]);
  return Object.freeze({
    schemaVersion:1,evidenceId,eventId,competitorId,
    sourceType:'validated-observation',sourceId:observation.observationId,
    occurredAt:observation.occurredAt,assertionKind:'observed',
    immutable:true
  });
}

export function evidenceRef(evidence){
  return `evidence:${evidence.eventId}:${evidence.evidenceId}`;
}
