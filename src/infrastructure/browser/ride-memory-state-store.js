const DEFAULT_PREFIX='cannonmap.ride-memory.v1';

const required=value=>{
  const normalized=String(value||'').trim();
  if(!normalized)throw new TypeError('sessionId is required.');
  return normalized;
};

/** Small durable schedule store. It contains metadata only; JPEG bytes remain in IndexedDB. */
export function createRideMemoryStateStore({storage=globalThis.localStorage,keyPrefix=DEFAULT_PREFIX}={}){
  const key=sessionId=>`${keyPrefix}.${encodeURIComponent(required(sessionId))}`;
  return Object.freeze({
    async load(sessionId){
      if(!storage?.getItem)return null;
      const raw=storage.getItem(key(sessionId));
      if(!raw)return null;
      try{
        const value=JSON.parse(raw);
        return value&&String(value.sessionId)===required(sessionId)?structuredClone(value):null;
      }catch{return null;}
    },
    async save(value){
      if(!storage?.setItem)throw new Error('Ride Memory durable schedule storage is unavailable.');
      const sessionId=required(value?.sessionId),copy=structuredClone(value);
      storage.setItem(key(sessionId),JSON.stringify(copy));
      return copy;
    },
    async remove(sessionId){storage?.removeItem?.(key(sessionId));},
    keyForSession:sessionId=>key(sessionId)
  });
}
