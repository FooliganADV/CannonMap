const TRANSITIONS=Object.freeze({
  provisional:Object.freeze(['active','rejected','superseded']),
  active:Object.freeze(['superseded','rejected']),
  superseded:Object.freeze([]),
  rejected:Object.freeze([])
});

export function canTransitionRouteLifecycle(from,to){
  return from===to||Boolean(TRANSITIONS[from]?.includes(to));
}

export function transitionRouteLifecycle(record,to,{nowMs=Date.now(),reason='Lifecycle review'}={}){
  if(!record||!canTransitionRouteLifecycle(record.lifecycle,to))throw new Error(`Invalid route lifecycle transition: ${record?.lifecycle||'missing'} -> ${to}`);
  if(record.lifecycle===to)return record;
  const revision=record.revision+1;
  return Object.freeze({...record,lifecycle:to,revision,supersedesRevision:record.revision,updatedAt:new Date(nowMs).toISOString(),lifecycleReason:String(reason),revisionId:deterministicRouteId('routeRevision',[record.familyId,record.variantId||null,revision,to,reason])});
}
import {deterministicRouteId} from './identity.js';
