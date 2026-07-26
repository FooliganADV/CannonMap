import {validateObservationIngress} from '../domain/observations/ingestion-contract.js';

export const SECURE_INGESTION_FEATURE_FLAG='architecture.auth.secure-ingestion';

export function createSecureObservationUploader({featureFlags,authentication,transport,observations,clock}={}){
  if(!featureFlags||!authentication||!transport||!observations||!clock)throw new TypeError('featureFlags, authentication, transport, observations, and clock are required.');
  let initialized=false;
  const enabled=()=>featureFlags.isEnabled(SECURE_INGESTION_FEATURE_FLAG);
  const initialize=async()=>{
    if(!enabled())return Object.freeze({status:'disabled'});
    await authentication.initialize();
    initialized=true;
    return Object.freeze({status:'ready'});
  };
  return Object.freeze({
    isEnabled:enabled,initialize,
    async deliver(outboxItem){
      if(!enabled())throw new Error('Secure ingestion is disabled.');
      if(!initialized)await initialize();
      const observation=await observations.get([outboxItem.eventId,outboxItem.observationId]);
      if(!observation)throw new Error('Observation not found for outbox item.');
      const validation=validateObservationIngress(observation,{nowMs:clock.now(),idempotencyKey:outboxItem.idempotencyKey});
      if(!validation.valid)throw new Error(`Observation failed preflight validation: ${validation.errors.join(', ')}`);
      const credentials=await authentication.credentials();
      return transport.ingest({observation,idempotencyKey:outboxItem.idempotencyKey,credentials});
    }
  });
}
