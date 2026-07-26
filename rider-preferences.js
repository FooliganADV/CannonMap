(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CannonMapRiderPreferences=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const STORAGE_KEY='cannonmap.riderPreferences.v1';
  const STORAGE_VERSION=1;
  const DEFAULT_PREFERENCE=Object.freeze({markerVisible:true,breadcrumbVisible:false,selected:false});
  const cleanId=value=>String(value??'').trim();
  const cleanPreference=value=>({
    markerVisible:typeof value?.markerVisible==='boolean'?value.markerVisible:true,
    breadcrumbVisible:typeof value?.breadcrumbVisible==='boolean'?value.breadcrumbVisible:false,
    selected:typeof value?.selected==='boolean'?value.selected:false
  });
  const emptyState=()=>({version:STORAGE_VERSION,events:{}});

  function normalizeState(value){
    if(!value||typeof value!=='object'||Array.isArray(value))return emptyState();
    let events;
    if(value.version===STORAGE_VERSION&&value.events&&typeof value.events==='object'&&!Array.isArray(value.events))events=value.events;
    else if(value.version===undefined)events=value;
    else return emptyState();
    const normalized=emptyState();
    for(const [eventId,riders] of Object.entries(events)){
      if(!cleanId(eventId)||!riders||typeof riders!=='object'||Array.isArray(riders))continue;
      normalized.events[cleanId(eventId)]={};
      for(const [competitorId,preference] of Object.entries(riders)){
        if(cleanId(competitorId))normalized.events[cleanId(eventId)][cleanId(competitorId)]=cleanPreference(preference);
      }
    }
    return normalized;
  }

  function createRiderPreferenceStore(options={}){
    const storage=options.storage||(typeof localStorage!=='undefined'?localStorage:null);
    const key=options.key||STORAGE_KEY;
    let data=emptyState();
    try{data=normalizeState(JSON.parse(storage?.getItem(key)||'null'));}catch(_){data=emptyState();}
    const persist=()=>{try{storage?.setItem(key,JSON.stringify(data));}catch(_){}};
    persist();
    const eventBucket=eventId=>{
      const id=cleanId(eventId);
      if(!id)return null;
      data.events[id] ||= {};
      return data.events[id];
    };
    const ensure=(eventId,competitorIds=[])=>{
      const bucket=eventBucket(eventId);
      if(!bucket)return {};
      let changed=false;
      for(const value of competitorIds){
        const id=cleanId(value);
        if(id&&!bucket[id]){bucket[id]={...DEFAULT_PREFERENCE};changed=true;}
      }
      if(changed)persist();
      return Object.fromEntries(Object.entries(bucket).map(([id,value])=>[id,{...value}]));
    };
    const get=(eventId,competitorId)=>{
      const id=cleanId(competitorId);
      const bucket=eventBucket(eventId);
      if(!bucket||!id)return {...DEFAULT_PREFERENCE};
      if(!bucket[id]){bucket[id]={...DEFAULT_PREFERENCE};persist();}
      return {...bucket[id]};
    };
    const update=(eventId,competitorId,patch={})=>{
      const id=cleanId(competitorId),bucket=eventBucket(eventId);
      if(!bucket||!id)return {...DEFAULT_PREFERENCE};
      bucket[id]=cleanPreference({...get(eventId,id),...patch});
      persist();
      return {...bucket[id]};
    };
    const updateTrails=(eventId,competitorIds,selectedOnly)=>{
      const ids=[...new Set((competitorIds||[]).map(cleanId).filter(Boolean))];
      ensure(eventId,ids);
      const bucket=eventBucket(eventId);
      for(const id of ids)bucket[id]={...bucket[id],breadcrumbVisible:selectedOnly?bucket[id].selected:false};
      persist();
      return Object.fromEntries(ids.map(id=>[id,{...bucket[id]}]));
    };
    return {
      get,ensure,update,
      hideAllTrails:(eventId,ids)=>updateTrails(eventId,ids,false),
      showSelectedTrailsOnly:(eventId,ids)=>updateTrails(eventId,ids,true),
      snapshot:()=>JSON.parse(JSON.stringify(data))
    };
  }

  return {STORAGE_KEY,STORAGE_VERSION,DEFAULT_PREFERENCE,normalizeState,createRiderPreferenceStore};
});
