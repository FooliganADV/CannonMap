const encode=value=>{
  if(value===null)return 'null';
  if(Array.isArray(value))return `[${value.map(encode).join(',')}]`;
  if(typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${encode(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};

export function stableIntelligenceValue(value){
  return encode(value);
}

export function deterministicIntelligenceId(prefix,parts){
  const text=encode(parts);
  let a=2166136261,b=0x9e3779b9;
  for(let index=0;index<text.length;index++){
    a=Math.imul(a^text.charCodeAt(index),16777619)>>>0;
    b=Math.imul(b+text.charCodeAt(index)+index,2246822519)>>>0;
  }
  return `${prefix}-${a.toString(16).padStart(8,'0')}${b.toString(16).padStart(8,'0')}`;
}
