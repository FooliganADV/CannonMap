const stable=value=>{
  if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};

export function deterministicRouteId(prefix,parts){
  const source=stable(parts);
  let hash=2166136261;
  for(let index=0;index<source.length;index++){
    hash^=source.charCodeAt(index);
    hash=Math.imul(hash,16777619);
  }
  return `${prefix}_${(hash>>>0).toString(16).padStart(8,'0')}`;
}

export {stable as stableRouteValue};
