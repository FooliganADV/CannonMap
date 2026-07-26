export function createClock({now=()=>Date.now()}={}){
  return Object.freeze({
    now,
    iso:()=>new Date(now()).toISOString(),
    date:value=>new Date(value===undefined?now():value)
  });
}

export const systemClock=createClock();
