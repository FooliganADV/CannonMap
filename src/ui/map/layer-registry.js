function requireKey(value){
  const key=String(value??'');
  if(!key)throw new TypeError('Layer registry keys must be non-empty.');
  return key;
}

export function createLayerRegistry({map,L,layerTypes=[]}={}){
  if(!map||!L?.featureGroup)throw new TypeError('A Leaflet map and factory are required.');
  const groups=new Map();
  const entries=new Map();

  const ensureType=type=>{
    const key=requireKey(type);
    if(!groups.has(key)){
      groups.set(key,L.featureGroup().addTo(map));
      entries.set(key,new Map());
    }
    return groups.get(key);
  };
  layerTypes.forEach(ensureType);

  function upsert(type,key,{fingerprint='',create,update}={}){
    const group=ensureType(type),id=requireKey(key),bucket=entries.get(String(type));
    const current=bucket.get(id);
    if(current&&current.fingerprint===fingerprint)return current.layer;
    if(current&&typeof update==='function'){
      const updated=update(current.layer);
      if(updated!==false){
        current.fingerprint=fingerprint;
        return current.layer;
      }
    }
    if(typeof create!=='function')throw new TypeError('Layer creation callback is required.');
    if(current)group.removeLayer(current.layer);
    const layer=create();
    if(!layer)throw new TypeError(`Layer creation failed for ${type}:${id}.`);
    group.addLayer(layer);
    bucket.set(id,{layer,fingerprint});
    return layer;
  }

  function remove(type,key){
    const typeKey=String(type),bucket=entries.get(typeKey);
    if(!bucket)return false;
    const current=bucket.get(String(key));
    if(!current)return false;
    groups.get(typeKey).removeLayer(current.layer);
    bucket.delete(String(key));
    return true;
  }

  function reconcile(type,items,{key,fingerprint=()=>'',create,update}={}){
    if(!Array.isArray(items)||typeof key!=='function'||typeof create!=='function')throw new TypeError('Reconciliation requires items, key, and create.');
    ensureType(type);
    const retained=new Set(),layers=new Map();
    for(const item of items){
      const id=requireKey(key(item));
      if(retained.has(id))throw new Error(`Duplicate layer key ${type}:${id}.`);
      retained.add(id);
      layers.set(id,upsert(type,id,{
        fingerprint:String(fingerprint(item)??''),
        create:()=>create(item),
        update:update?layer=>update(layer,item):undefined
      }));
    }
    for(const id of [...entries.get(String(type)).keys()])if(!retained.has(id))remove(type,id);
    return layers;
  }

  function clear(type){
    const typeKey=String(type),group=groups.get(typeKey);
    if(!group)return;
    group.clearLayers();
    entries.get(typeKey).clear();
  }

  function destroy(){
    for(const group of groups.values()){
      group.clearLayers();
      if(map.hasLayer?.(group))map.removeLayer(group);
    }
    groups.clear();entries.clear();
  }

  return Object.freeze({
    ensureType,
    group:type=>ensureType(type),
    upsert,
    remove,
    reconcile,
    clear,
    destroy,
    get:(type,key)=>entries.get(String(type))?.get(String(key))?.layer||null,
    count:type=>entries.get(String(type))?.size||0,
    counts:()=>Object.freeze(Object.fromEntries([...entries].map(([type,bucket])=>[type,bucket.size])))
  });
}
