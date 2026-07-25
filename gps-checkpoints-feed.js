(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.GPSCheckpointsFeed=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const API='https://checkpointserver.com/admin';
const DB='https://gps-checkpoint-events-default-rtdb.firebaseio.com';
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
function applyFirebaseUpdate(current,message){
  const next=current&&typeof current==='object'?clone(current):{};
  const path=String(message?.path||'/').split('/').filter(Boolean);
  if(!path.length)return message?.data??{};
  let target=next;
  for(let i=0;i<path.length-1;i++){target[path[i]]=target[path[i]]&&typeof target[path[i]]==='object'?target[path[i]]:{};target=target[path[i]];}
  const key=path.at(-1);
  if(message?.data===null)delete target[key];
  else if(message?.data&&typeof message.data==='object'&&!Array.isArray(message.data))target[key]={...(target[key]&&typeof target[key]==='object'?target[key]:{}),...message.data};
  else target[key]=message?.data;
  return next;
}
function buildStandings(competitors,checkpoints,achievements){
  const names=new Map(checkpoints.map(x=>[String(x.id),x.name])),totals={},counts={},last={};
  Object.entries(achievements||{}).forEach(([checkpointId,records])=>Object.entries(records||{}).forEach(([id,d])=>{
    if(typeof d?.points==='number'){totals[id]=(totals[id]||0)+d.points;counts[id]=(counts[id]||0)+1;}
    if(d?.date&&(!last[id]||d.date>last[id].date))last[id]={date:d.date,checkpointId};
  }));
  return competitors.map(c=>{const id=String(c.id);return{id,number:c.competitor_number,name:c.name,team:c.team||'',vehicle:c.vehicle||'',points:totals[id]||0,countAchieved:counts[id]||0,lastDate:last[id]?.date||0,lastCheckpoint:last[id]?names.get(String(last[id].checkpointId))||'':''};}).sort((a,b)=>b.points-a.points||b.lastDate-a.lastDate);
}
function normalizeLocations(locations,competitors){
  const names=new Map(competitors.map(x=>[String(x.id),x.name]));
  return Object.entries(locations||{}).flatMap(([id,d])=>{const lat=Number(d?.latitude),lon=Number(d?.longitude);return Number.isFinite(lat)&&Number.isFinite(lon)?[{id,name:names.get(id)||`Rider ${id}`,lat,lon,time:d.date||''}]:[];});
}
function createGPSCheckpointsFeed(options={}){
  const eventId=String(options.eventId||'').trim();
  if(!/^\d+$/.test(eventId))throw new TypeError('eventId must be numeric');
  const fetchImpl=options.fetch||globalThis.fetch,EventSourceImpl=options.EventSource||globalThis.EventSource;
  if(typeof fetchImpl!=='function'||typeof EventSourceImpl!=='function')throw new TypeError('fetch and EventSource are required');
  const apiBase=(options.apiBase||API).replace(/\/$/,''),databaseUrl=(options.databaseUrl||DB).replace(/\/$/,'');
  const refreshMs=Math.max(30000,Number(options.metadataRefreshMs)||300000),timeoutMs=Math.max(1000,Number(options.requestTimeoutMs)||15000);
  const listeners=new Map(),streams=new Map(),retryTimers=new Map();
  let timer=null,stopped=true,attempt=0,state={event:null,checkpoints:[],competitors:[],achievements:{},locations:{}};
  const emit=(type,detail)=>(listeners.get(type)||[]).forEach(fn=>fn(detail));
  const on=(type,fn)=>{listeners.set(type,[...(listeners.get(type)||[]),fn]);return()=>listeners.set(type,(listeners.get(type)||[]).filter(x=>x!==fn));};
  const snapshot=()=>({event:state.event,checkpoints:state.checkpoints,competitors:state.competitors,standings:buildStandings(state.competitors,state.checkpoints,state.achievements),locations:normalizeLocations(state.locations,state.competitors)});
  const publish=()=>emit('snapshot',snapshot());
  async function getJson(path){const controller=new AbortController(),t=setTimeout(()=>controller.abort(),timeoutMs);try{const headers={Accept:'application/json'};if(options.authToken)headers.Authorization=`Bearer ${options.authToken}`;const r=await fetchImpl(`${apiBase}${path}`,{headers,cache:'no-store',signal:controller.signal});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();}finally{clearTimeout(t);}}
  async function refreshMetadata(){try{const[event,checkpoints,competitors]=await Promise.all([getJson(`/events/${eventId}`),getJson(`/events/${eventId}/checkpoints`),getJson(`/events/${eventId}/competitors`)]);state={...state,event,checkpoints,competitors};attempt=0;publish();}catch(error){emit('error',{source:'metadata',error});throw error;}}
  function openStream(name,path,key){
    if(stopped)return;streams.get(name)?.close();
    const stream=new EventSourceImpl(`${databaseUrl}/${path}/${eventId}.json`);streams.set(name,stream);
    const update=e=>{try{state={...state,[key]:applyFirebaseUpdate(state[key],JSON.parse(e.data))};attempt=0;publish();}catch(error){emit('error',{source:name,error});}};
    stream.addEventListener('put',update);stream.addEventListener('patch',update);
    stream.onopen=()=>emit('status',{source:name,connected:true});
    stream.onerror=()=>{stream.close();if(stopped)return;const delay=Math.min(30000,1000*(2**attempt++));emit('status',{source:name,connected:false,retryInMs:delay});clearTimeout(retryTimers.get(name));retryTimers.set(name,setTimeout(()=>openStream(name,path,key),delay));};
  }
  async function start(){if(!stopped)return snapshot();stopped=false;try{await refreshMetadata();}catch(_){}if(stopped)return snapshot();openStream('achievements','events','achievements');openStream('locations','locations','locations');timer=setInterval(()=>refreshMetadata().catch(()=>{}),refreshMs);return snapshot();}
  function stop(){stopped=true;clearInterval(timer);timer=null;streams.forEach(s=>s.close());streams.clear();retryTimers.forEach(clearTimeout);retryTimers.clear();emit('status',{connected:false,stopped:true});}
  return{on,start,stop,refreshMetadata,snapshot};
}
return{createGPSCheckpointsFeed,applyFirebaseUpdate,buildStandings,normalizeLocations};
});
