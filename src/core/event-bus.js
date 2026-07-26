import {InvariantError} from './errors.js';

const requiredFields=['eventId','entityId','occurredAt','correlationId','causationId','schemaVersion','payload'];

export function createEventBus({onError=error=>queueMicrotask(()=>{throw error;}),detectDuplicateKeys=false}={}){
  const handlers=new Map(),subscriptionKeys=new Set();
  return Object.freeze({
    subscribe(type,handler,{key}={}){
      if(typeof type!=='string'||!type)throw new InvariantError('Event type is required.');
      if(typeof handler!=='function')throw new InvariantError('Event handler must be a function.');
      if(key&&detectDuplicateKeys&&subscriptionKeys.has(key))throw new InvariantError(`Duplicate event subscription key: ${key}`);
      if(key)subscriptionKeys.add(key);
      const entries=handlers.get(type)??new Set();
      entries.add(handler);handlers.set(type,entries);
      let active=true;
      return ()=>{
        if(!active)return;
        active=false;entries.delete(handler);
        if(!entries.size)handlers.delete(type);
        if(key)subscriptionKeys.delete(key);
      };
    },
    publish(event){
      if(!event||typeof event.type!=='string'||!event.type)throw new InvariantError('Event type is required.');
      for(const field of requiredFields)if(!(field in event))throw new InvariantError(`Event field is required: ${field}`);
      const immutable=Object.freeze({...event,payload:Object.freeze({...event.payload})});
      for(const handler of [...(handlers.get(event.type)??[])]){
        try{
          const result=handler(immutable);
          if(result&&typeof result.then==='function')result.catch(onError);
        }catch(error){onError(error);}
      }
      return immutable;
    },
    clear(){handlers.clear();subscriptionKeys.clear();}
  });
}
