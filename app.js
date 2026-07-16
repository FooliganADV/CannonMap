
const state = {
  map:null, trackLayers:[], waypointLayers:[], positionLayer:null, accuracyLayer:null,
  checkpoints: JSON.parse(localStorage.getItem('cannonmap_checkpoints') || '[]'),
  files: JSON.parse(localStorage.getItem('cannonmap_files') || '[]'),
  tracks: JSON.parse(localStorage.getItem('cannonmap_tracks') || '[]'),
  position:null, watchId:null, alerted:{}
};

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function save(){
  localStorage.setItem('cannonmap_checkpoints', JSON.stringify(state.checkpoints));
  localStorage.setItem('cannonmap_files', JSON.stringify(state.files));
  localStorage.setItem('cannonmap_tracks', JSON.stringify(state.tracks));
}
function miles(m){return m/1609.344}
function hav(a,b){
  const R=6371000, p=Math.PI/180;
  const dLat=(b.lat-a.lat)*p,dLon=(b.lon-a.lon)*p;
  const q=Math.sin(dLat/2)**2+Math.cos(a.lat*p)*Math.cos(b.lat*p)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(q));
}
function pathMiles(points){let d=0;for(let i=1;i<points.length;i++)d+=hav(points[i-1],points[i]);return miles(d)}
function textOf(el,name){const n=el.getElementsByTagName(name)[0];return n?n.textContent.trim():''}
function initMap(){
  state.map=L.map('map',{zoomControl:true}).setView([38.8,-98.5],4);
  const tiles=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:19, attribution:'© OpenStreetMap contributors'
  }).addTo(state.map);
  tiles.on('tileerror',()=>{$('offlineNotice').hidden=false});
  renderMap();
}
function parseGPX(xmlText,fileName){
  const xml=new DOMParser().parseFromString(xmlText,'application/xml');
  if(xml.querySelector('parsererror')) throw new Error('Invalid GPX/XML file');
  const cps=[...xml.getElementsByTagName('wpt')].map((w,i)=>({
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${i}`,
    file:fileName, name:textOf(w,'name')||`Waypoint ${i+1}`,
    desc:textOf(w,'desc')||textOf(w,'cmt'), lat:+w.getAttribute('lat'), lon:+w.getAttribute('lon'),
    complete:false, completedAt:null, completedPosition:null
  })).filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lon));
  const tracks=[];
  [...xml.getElementsByTagName('trk')].forEach((trk,ti)=>{
    const name=textOf(trk,'name')||`${fileName} Track ${ti+1}`;
    [...trk.getElementsByTagName('trkseg')].forEach((seg,si)=>{
      const pts=[...seg.getElementsByTagName('trkpt')].map(p=>({lat:+p.getAttribute('lat'),lon:+p.getAttribute('lon')}))
        .filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lon));
      if(pts.length)tracks.push({id:`${fileName}-t-${ti}-${si}-${Date.now()}`,file:fileName,name,points:pts});
    });
  });
  [...xml.getElementsByTagName('rte')].forEach((rte,ri)=>{
    const pts=[...rte.getElementsByTagName('rtept')].map(p=>({lat:+p.getAttribute('lat'),lon:+p.getAttribute('lon')}))
      .filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lon));
    if(pts.length)tracks.push({id:`${fileName}-r-${ri}-${Date.now()}`,file:fileName,name:textOf(rte,'name')||`${fileName} Route ${ri+1}`,points:pts});
  });
  return {cps,tracks};
}
async function importFiles(fileList){
  for(const f of fileList){
    try{
      const txt=await f.text(), parsed=parseGPX(txt,f.name);
      state.checkpoints.push(...parsed.cps); state.tracks.push(...parsed.tracks);
      state.files.push({name:f.name, importedAt:new Date().toISOString(), checkpoints:parsed.cps.length, tracks:parsed.tracks.length});
      $('status').textContent=`Imported ${f.name}: ${parsed.tracks.length} track/route segments and ${parsed.cps.length} waypoints.`;
    }catch(e){$('status').textContent=`Could not import ${f.name}: ${e.message}`}
  }
  save(); renderAll(); fitAll();
}
function renderMap(){
  if(!state.map)return;
  state.trackLayers.forEach(x=>x.remove()); state.waypointLayers.forEach(x=>x.remove());
  state.trackLayers=[];state.waypointLayers=[];
  state.tracks.forEach((t,i)=>{
    const line=L.polyline(t.points.map(p=>[p.lat,p.lon]),{weight:5,opacity:.85}).addTo(state.map);
    line.bindPopup(`<b>${esc(t.name)}</b><br>${pathMiles(t.points).toFixed(1)} mi`);
    state.trackLayers.push(line);
  });
  const showDone=$('showCompleted')?.checked ?? true;
  state.checkpoints.forEach(cp=>{
    if(cp.complete&&!showDone)return;
    const marker=L.circleMarker([cp.lat,cp.lon],{radius:cp.complete?6:8,weight:2,fillOpacity:.9});
    marker.bindPopup(`<b>${esc(cp.name)}</b><br>${cp.complete?'Completed':'Pending'}<br><button onclick="toggleCheckpoint('${cp.id}')">${cp.complete?'Reopen':'Complete'}</button>`);
    marker.addTo(state.map); state.waypointLayers.push(marker);
  });
}
function fitAll(){
  const coords=[...state.tracks.flatMap(t=>t.points),...state.checkpoints.map(c=>({lat:c.lat,lon:c.lon}))];
  if(coords.length)state.map.fitBounds(coords.map(p=>[p.lat,p.lon]),{padding:[20,20]});
}
function renderCheckpoints(){
  const q=$('cpSearch').value.toLowerCase(), filter=$('cpFilter').value;
  const arr=state.checkpoints.filter(cp=>(!q||cp.name.toLowerCase().includes(q))&&(filter==='all'||(filter==='complete')===cp.complete));
  const box=$('checkpointList');
  if(!arr.length){box.className='list empty';box.textContent=state.checkpoints.length?'No matching checkpoints.':'No checkpoints imported.';return}
  box.className='list';
  box.innerHTML=arr.map(cp=>{
    let dist=state.position?`${miles(hav(state.position,cp)).toFixed(1)} mi away`:'Distance unavailable';
    return `<article class="item ${cp.complete?'complete':''}">
      <div class="itemTop"><div><h3>${esc(cp.name)}</h3><div class="meta">${esc(cp.file)} · ${dist}</div></div>
      <span class="badge ${cp.complete?'done':''}">${cp.complete?'DONE':'PENDING'}</span></div>
      ${cp.desc?`<div class="meta">${esc(cp.desc)}</div>`:''}
      <div class="actions"><button onclick="focusCheckpoint('${cp.id}')">Map</button><button onclick="toggleCheckpoint('${cp.id}')">${cp.complete?'Reopen':'Complete'}</button></div>
    </article>`;
  }).join('');
}
function renderFiles(){
  const b=$('fileList');
  if(!state.files.length){b.className='list empty';b.textContent='No GPX files imported.';return}
  b.className='list'; b.innerHTML=state.files.map(f=>`<article class="item"><h3>${esc(f.name)}</h3><div class="meta">${f.tracks} track/route segments · ${f.checkpoints} waypoints</div></article>`).join('');
}
function renderStats(){
  $('cpProgress').textContent=`${state.checkpoints.filter(x=>x.complete).length} / ${state.checkpoints.length}`;
  $('trackDistance').textContent=`${state.tracks.reduce((a,t)=>a+pathMiles(t.points),0).toFixed(1)} mi`;
  if(state.position&&state.checkpoints.length){
    const pending=state.checkpoints.filter(c=>!c.complete), pool=pending.length?pending:state.checkpoints;
    const near=pool.map(c=>({c,d:hav(state.position,c)})).sort((a,b)=>a.d-b.d)[0];
    $('nearestCp').textContent=`${near.c.name} (${miles(near.d).toFixed(1)} mi)`;
  }else $('nearestCp').textContent='—';
}
function renderAll(){renderMap();renderCheckpoints();renderFiles();renderStats()}
window.toggleCheckpoint=id=>{
  const cp=state.checkpoints.find(x=>x.id===id);if(!cp)return;
  cp.complete=!cp.complete; cp.completedAt=cp.complete?new Date().toISOString():null;
  cp.completedPosition=cp.complete&&state.position?{...state.position}:null;
  save();renderAll();
};
window.focusCheckpoint=id=>{
  const cp=state.checkpoints.find(x=>x.id===id);if(!cp)return;
  state.map.setView([cp.lat,cp.lon],15); document.querySelector('[data-panel="dashboard"]').click();
};
function startGPS(){
  if(!navigator.geolocation){$('status').textContent='GPS is not supported by this browser.';return}
  if(state.watchId!==null){navigator.geolocation.clearWatch(state.watchId);state.watchId=null;$('gpsBtn').textContent='Start GPS';return}
  state.watchId=navigator.geolocation.watchPosition(pos=>{
    state.position={lat:pos.coords.latitude,lon:pos.coords.longitude,accuracy:pos.coords.accuracy};
    $('gpsAccuracy').textContent=`±${Math.round(pos.coords.accuracy*3.28084)} ft`;
    if(state.positionLayer)state.positionLayer.remove(); if(state.accuracyLayer)state.accuracyLayer.remove();
    state.accuracyLayer=L.circle([state.position.lat,state.position.lon],{radius:state.position.accuracy,weight:1,fillOpacity:.08}).addTo(state.map);
    state.positionLayer=L.circleMarker([state.position.lat,state.position.lon],{radius:9,weight:3,fillOpacity:1}).addTo(state.map).bindPopup('Current position');
    if($('followGps').checked)state.map.panTo([state.position.lat,state.position.lon]);
    checkAlerts();renderCheckpoints();renderStats();
  },err=>{$('status').textContent=`GPS error: ${err.message}`},{enableHighAccuracy:true,maximumAge:2000,timeout:15000});
  $('gpsBtn').textContent='Stop GPS';
}
function checkAlerts(){
  const threshold=+$('alertDistance').value;
  state.checkpoints.filter(c=>!c.complete).forEach(cp=>{
    const d=hav(state.position,cp);
    if(d<=threshold&&!state.alerted[cp.id]){
      state.alerted[cp.id]=true;
      navigator.vibrate?.([250,150,250]);
      $('status').textContent=`Checkpoint nearby: ${cp.name} — ${miles(d).toFixed(2)} mi`;
      if('Notification' in window&&Notification.permission==='granted')new Notification('CannonMap checkpoint nearby',{body:cp.name});
    }
  });
}
function exportProgress(){
  const data={app:'CannonMap Beta',exportedAt:new Date().toISOString(),files:state.files,checkpoints:state.checkpoints};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`cannonmap-progress-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);
}
document.querySelectorAll('nav button').forEach(btn=>btn.onclick=()=>{
  document.querySelectorAll('nav button,.panel').forEach(x=>x.classList.remove('active'));
  btn.classList.add('active');$(btn.dataset.panel).classList.add('active');setTimeout(()=>state.map.invalidateSize(),50);
});
$('gpxInput').onchange=e=>importFiles(e.target.files);$('gpxInput2').onchange=e=>importFiles(e.target.files);
$('gpsBtn').onclick=startGPS;$('fitBtn').onclick=fitAll;$('exportBtn').onclick=exportProgress;
$('cpSearch').oninput=renderCheckpoints;$('cpFilter').onchange=renderCheckpoints;
$('showCompleted').onchange=renderMap;
$('clearBtn').onclick=()=>{if(confirm('Delete all imported GPX and checkpoint progress from this device?')){state.checkpoints=[];state.tracks=[];state.files=[];save();renderAll();}};
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
if('Notification' in window&&Notification.permission==='default')Notification.requestPermission().catch(()=>{});
initMap();renderAll();
