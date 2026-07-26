(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.GPSCheckpointsFeed=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const API='https://checkpointserver.com/admin';
const FIREBASE_CONFIG=Object.freeze({
  apiKey:'AIzaSyB8iClbcQfxjXvljtGJsaWLgrPwFcWcq-M',
  authDomain:'gps-checkpoint-events.firebaseapp.com',
  databaseURL:'https://gps-checkpoint-events-default-rtdb.firebaseio.com',
  projectId:'gps-checkpoint-events',
  storageBucket:'gps-checkpoint-events.firebasestorage.app',
  messagingSenderId:'735233589275',
  appId:'1:735233589275:web:8abad8113708419e41b8be'
});
const pick=(source,keys)=>Object.fromEntries(keys.filter(key=>source?.[key]!==undefined).map(key=>[key,source[key]]));
const sanitizeEvent=value=>pick(value,['id','company','name','rally_type','start_date','end_date','home_url','tracking_url','max_competitors','created_at','updated_at']);
const sanitizeCheckpoint=value=>pick(value,['id','event_id','name','chk_type','latitude','longitude','radius_m','points','description','orden','created_at','updated_at']);
const sanitizeCompetitor=value=>pick(value,['id','event_id','competitor_number','name','team','vehicle','created_at','updated_at']);
function buildStandings(competitors,checkpoints,achievements){
  const names=new Map(checkpoints.map(x=>[String(x.id),x.name])),totals={},counts={},last={};
  Object.entries(achievements||{}).forEach(([checkpointId,records])=>Object.entries(records||{}).forEach(([id,d])=>{
    if(typeof d?.points==='number'){totals[id]=(totals[id]||0)+d.points;counts[id]=(counts[id]||0)+1;}
    if(d?.date&&(!last[id]||d.date>last[id].date))last[id]={date:d.date,checkpointId};
  }));
  return competitors.map(c=>{const id=String(c.id);return{id,number:c.competitor_number,name:c.name,team:c.team||'',vehicle:c.vehicle||'',points:totals[id]||0,countAchieved:counts[id]||0,lastDate:last[id]?.date||0,lastCheckpoint:last[id]?names.get(String(last[id].checkpointId))||'':''};}).sort((a,b)=>b.points-a.points||b.lastDate-a.lastDate||Number(a.number||0)-Number(b.number||0));
}
function normalizeLocations(locations,competitors){
  const names=new Map(competitors.map(x=>[String(x.id),x.name]));
  return Object.entries(locations||{}).flatMap(([id,d])=>{const lat=Number(d?.latitude),lon=Number(d?.longitude);return Number.isFinite(lat)&&Number.isFinite(lon)?[{id,name:names.get(id)||`Rider ${id}`,lat,lon,time:d.date||''}]:[];});
}
function getFirebaseApp(firebaseImpl,config){
  const name='cannonmap-gps-checkpoints';
  try{return firebaseImpl.app(name);}catch(_){return firebaseImpl.initializeApp(config,name);}
}
function createGPSCheckpointsFeed(options={}){
  const eventId=String(options.eventId||'').trim();
  if(!/^\d+$/.test(eventId))throw new TypeError('eventId must be numeric');
  const fetchImpl=options.fetch||globalThis.fetch,firebaseImpl=options.firebase||globalThis.firebase;
  if(typeof fetchImpl!=='function')throw new TypeError('fetch is required');
  if(!firebaseImpl?.initializeApp)throw new TypeError('Firebase Realtime Database SDK is required');
  const apiBase=(options.apiBase||API).replace(/\/$/,''),refreshMs=Math.max(30000,Number(options.metadataRefreshMs)||300000),timeoutMs=Math.max(1000,Number(options.requestTimeoutMs)||15000);
  const listeners=new Map(),subscriptions=[];
  let timer=null,stopped=true,state={event:null,checkpoints:[],competitors:[],achievements:{},locations:{}};
  const emit=(type,detail)=>(listeners.get(type)||[]).forEach(fn=>fn(detail));
  const on=(type,fn)=>{listeners.set(type,[...(listeners.get(type)||[]),fn]);return()=>listeners.set(type,(listeners.get(type)||[]).filter(x=>x!==fn));};
  const snapshot=()=>({event:state.event,checkpoints:state.checkpoints,competitors:state.competitors,standings:buildStandings(state.competitors,state.checkpoints,state.achievements),locations:normalizeLocations(state.locations,state.competitors)});
  const publish=()=>emit('snapshot',snapshot());
  async function getJson(path){const controller=new AbortController(),t=setTimeout(()=>controller.abort(),timeoutMs);try{const r=await fetchImpl(`${apiBase}${path}`,{headers:{Accept:'application/json'},cache:'no-store',signal:controller.signal});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();}finally{clearTimeout(t);}}
  async function refreshMetadata(){try{const[event,checkpoints,competitors]=await Promise.all([getJson(`/events/${eventId}`),getJson(`/events/${eventId}/checkpoints`),getJson(`/events/${eventId}/competitors`)]);state={...state,event:sanitizeEvent(event),checkpoints:(checkpoints||[]).map(sanitizeCheckpoint),competitors:(competitors||[]).map(sanitizeCompetitor)};publish();}catch(error){emit('error',{source:'metadata',error});throw error;}}
  function subscribe(ref,event,handler,source){
    const failure=error=>emit('error',{source,error});
    ref.on(event,handler,failure);
    subscriptions.push(()=>ref.off(event,handler));
  }
  function subscribeFirebase(){
    const app=getFirebaseApp(firebaseImpl,options.firebaseConfig||FIREBASE_CONFIG),database=app.database();
    const achievementsRef=database.ref(`events/${eventId}`),locationsRef=database.ref(`locations/${eventId}`);
    subscribe(achievementsRef,'value',snap=>{state={...state,achievements:snap.val()||{}};publish();emit('status',{source:'achievements',connected:true});},'achievements');
    const upsert=snap=>{const value=snap.val()||{};state={...state,locations:{...state.locations,[String(snap.key)]:value}};publish();};
    subscribe(locationsRef,'child_added',upsert,'locations');
    subscribe(locationsRef,'child_changed',upsert,'locations');
    subscribe(locationsRef,'child_removed',snap=>{emit('status',{source:'locations',removed:String(snap.key),preserved:true});},'locations');
  }
  async function start(){if(!stopped)return snapshot();stopped=false;try{await refreshMetadata();}catch(_){}if(stopped)return snapshot();subscribeFirebase();timer=setInterval(()=>refreshMetadata().catch(()=>{}),refreshMs);return snapshot();}
  function stop(){stopped=true;clearInterval(timer);timer=null;subscriptions.splice(0).forEach(unsubscribe=>unsubscribe());emit('status',{connected:false,stopped:true});}
  return{on,start,stop,refreshMetadata,snapshot};
}
return{FIREBASE_CONFIG,createGPSCheckpointsFeed,buildStandings,normalizeLocations,sanitizeEvent,sanitizeCheckpoint,sanitizeCompetitor};
});
