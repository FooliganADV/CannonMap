const DEFAULT_LIMIT=400;
const clone=value=>JSON.parse(JSON.stringify(value));

/** Bounded, serializable field log. Image contents and files are never accepted. */
export function createRallyDebugLog({storage,key='cannonmap.rally.debug.v1',limit=DEFAULT_LIMIT,clock={iso:()=>new Date().toISOString()}}={}){
  let entries=[];
  try{entries=JSON.parse(storage?.getItem(key)||'[]');if(!Array.isArray(entries))entries=[];}catch(_){entries=[];}
  const persist=()=>{try{storage?.setItem(key,JSON.stringify(entries));}catch(_){}};
  return Object.freeze({
    record(type,details={}){
      const safe=clone(details);for(const name of ['blob','file','image','data'])delete safe[name];
      const entry=Object.freeze({timestamp:clock.iso(),type:String(type),...safe});entries.push(entry);
      if(entries.length>limit)entries=entries.slice(-limit);persist();return entry;
    },
    entries:()=>entries.map(clone),
    exportJson:()=>JSON.stringify({schemaVersion:1,exportedAt:clock.iso(),entries},null,2),
    clear(){entries=[];persist();}
  });
}
