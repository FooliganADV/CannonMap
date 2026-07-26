export function createIdFactory({randomUUID,now=()=>Date.now(),random=Math.random}={}){
  const uuid=randomUUID===undefined?globalThis.crypto?.randomUUID?.bind(globalThis.crypto):randomUUID;
  return ()=>uuid?uuid():`${now()}-${random().toString(16).slice(2)}`;
}

export const createId=createIdFactory();
