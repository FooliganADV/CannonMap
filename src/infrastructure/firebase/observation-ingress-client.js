import {MAX_INGESTION_BYTES} from '../../domain/observations/ingestion-contract.js';

export function createObservationIngressClient({endpoint,fetchImpl=globalThis.fetch,timeoutMs=15000}={}){
  if(typeof fetchImpl!=='function')throw new TypeError('fetch is required.');
  return Object.freeze({
    async ingest({observation,idempotencyKey,credentials}){
      if(!endpoint)throw new Error('Secure ingestion endpoint is not configured.');
      if(!credentials?.authToken)throw new Error('Authentication token is required.');
      const body=JSON.stringify({observation});
      if(new TextEncoder().encode(body).byteLength>MAX_INGESTION_BYTES)throw new Error('Secure ingestion request exceeds size limit.');
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
      try{
        const response=await fetchImpl(endpoint,{
          method:'POST',
          mode:'cors',
          cache:'no-store',
          credentials:'omit',
          headers:{
            'Content-Type':'application/json',
            'Authorization':`Bearer ${credentials.authToken}`,
            'X-Firebase-AppCheck':credentials.appCheckToken||'',
            'Idempotency-Key':idempotencyKey
          },
          body,
          signal:controller.signal
        });
        const payload=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(payload.error||`Secure ingestion failed (${response.status}).`);
        return Object.freeze(payload.receipt);
      }finally{clearTimeout(timer);}
    }
  });
}
