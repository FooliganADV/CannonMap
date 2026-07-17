'use strict';

const APP_VERSION = '0.5.0';
const BUILD_ID = '2026.07.17.01';
const SETTINGS_KEY = 'cannonmap.settings.v5';
const SNAPSHOT_KEY = 'cannonmap.snapshots.v1';
const DB_NAME = 'CannonMapDB';
const DB_STORE = 'projects';

const COLORS = {
  track: '#f97316', route: '#38bdf8', waypoint: '#facc15', checkpoint: '#22c55e',
  fuel: '#a78bfa', hotel: '#fb7185', competitor: '#ef4444'
};

const state = {
  map: null, baseLayers: {}, featureGroup: null, gpsLayer: null, gpsAccuracyLayer: null,
  gpsWatchId: null, pendingLayer: null, pendingImport: null, selectedId: null, editingLayer: null, history: [],
  project: {
    version: APP_VERSION, name: 'America 250 – 2026', createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), features: [], competitors: []
  },
  settings: { dayFilter: 'all', inreachUrl: '', baseLayer: 'Streets', lineOpacity:90, typeVisibility:{track:true,route:true,waypoint:true,checkpoint:true,fuel:true,hotel:true} }
};

const $ = id => document.getElementById(id);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const deepClean = obj => JSON.parse(JSON.stringify(obj, (key, value) => key === '_layer' ? undefined : value));

function setStatus(message, isError = false) {
  const el = $('status');
  el.textContent = message;
  el.classList.toggle('editing-banner', message.startsWith('Editing '));
  el.style.background = isError ? '#450a0a' : '';
  el.style.borderColor = isError ? '#991b1b' : '';
}

function snapshot() {
  state.history.push(deepClean(state.project));
  if (state.history.length > 20) state.history.shift();
}

function undo() {
  const previous = state.history.pop();
  if (!previous) return setStatus('Nothing to undo.');
  stopEditing();
  state.project = previous;
  clearSelection();
  saveProject(false);
  renderAll();
  setStatus('Last change undone.');
}

function initMap() {
  state.map = L.map('map', { zoomControl: true, preferCanvas: true }).setView([38.5, -98.5], 4);
  const layers = {
    Streets: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19, attribution:'© OpenStreetMap contributors' }),
    Topographic: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom:17, attribution:'© OpenStreetMap contributors, SRTM · OpenTopoMap' }),
    Satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom:19, attribution:'Tiles © Esri' }),
    CyclOSM: L.tileLayer('https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', { maxZoom:20, attribution:'© OpenStreetMap contributors · CyclOSM' }),
    'USGS Topo': L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', { maxZoom:16, attribution:'USGS The National Map' })
  };
  state.baseLayers = layers;
  (layers[state.settings.baseLayer] || layers.Streets).addTo(state.map);
  L.control.layers(layers, {}, { position:'topright', collapsed:true }).addTo(state.map);
  state.map.on('baselayerchange', e => { state.settings.baseLayer = e.name; saveProject(false); });

  state.featureGroup = L.featureGroup().addTo(state.map);
  state.map.pm.addControls({
    position:'topleft', drawMarker:true, drawPolyline:true, drawPolygon:false, drawRectangle:false,
    drawCircle:false, drawCircleMarker:false, editMode:false, dragMode:false, cutPolygon:false,
    removalMode:false, rotateMode:false
  });
  state.map.pm.setGlobalOptions({ snappable:true, snapDistance:20, layerGroup:state.featureGroup });

  state.map.on('pm:create', event => {
    state.pendingLayer = event.layer;
    const activeDay = state.settings.dayFilter === 'all' ? '0' : state.settings.dayFilter;
    $('createDay').value = activeDay;
    $('createType').value = event.shape === 'Marker' ? 'checkpoint' : 'track';
    $('createName').value = event.shape === 'Marker' ? 'New checkpoint' : 'New track';
    $('createNotes').value = '';
    $('createDialog').showModal();
  });
  state.map.on('mousemove', e => $('cursorCoordinates').textContent = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`);
}

function normalizeLatLngs(latlngs) {
  if (!Array.isArray(latlngs)) return [];
  let source = latlngs;
  while (Array.isArray(source[0])) source = source[0];
  return source.map(p => ({ lat:Number(p.lat), lon:Number(p.lng) }));
}
function layerToGeometry(layer) {
  if (layer instanceof L.Marker || layer instanceof L.CircleMarker) {
    const p = layer.getLatLng();
    return { kind:'point', coordinates:[{lat:p.lat, lon:p.lng}] };
  }
  return { kind:'line', coordinates:normalizeLatLngs(layer.getLatLngs()) };
}
function featureMatchesDay(feature) { return state.settings.dayFilter === 'all' || String(feature.day ?? 0) === String(state.settings.dayFilter); }
function featureStyle(feature) {
  const color = COLORS[feature.type] || COLORS.track;
  return { color, fillColor:color, weight:feature.type === 'route' ? 5 : 4, opacity:(state.settings.lineOpacity||90)/100, fillOpacity:.9 };
}
function markerIcon(feature) {
  const color = COLORS[feature.type] || COLORS.waypoint;
  const label = feature.type === 'fuel' ? 'F' : feature.type === 'hotel' ? 'H' : feature.type === 'checkpoint' ? 'C' : '•';
  return L.divIcon({ className:'', html:`<div style="width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:${color};color:#07111f;border:2px solid white;font-weight:900;font-size:12px;box-shadow:0 2px 8px #0008">${label}</div>`, iconSize:[24,24], iconAnchor:[12,12] });
}
function createLeafletLayer(feature) {
  let layer;
  if (feature.geometry.kind === 'point') {
    const p = feature.geometry.coordinates[0];
    layer = L.marker([p.lat,p.lon], { icon:markerIcon(feature), draggable:false });
  } else {
    layer = L.polyline(feature.geometry.coordinates.map(p => [p.lat,p.lon]), featureStyle(feature));
  }
  layer._cannonId = feature.id;
  layer.bindTooltip(feature.name || feature.type, {sticky:true});
  layer.on('click', () => selectFeature(feature.id));
  layer.on('contextmenu', e => { L.DomEvent.preventDefault(e); openContextMenu(feature.id, e.originalEvent.clientX, e.originalEvent.clientY); });
  layer.on('pm:edit', () => syncGeometryFromLayer(layer));
  layer.on('pm:dragend', () => syncGeometryFromLayer(layer));
  layer.on('dragend', () => syncGeometryFromLayer(layer));
  return layer;
}
function syncGeometryFromLayer(layer) {
  const feature = state.project.features.find(f => f.id === layer._cannonId);
  if (!feature) return;
  snapshot();
  feature.geometry = layerToGeometry(layer);
  feature.updatedAt = new Date().toISOString();
  state.project.updatedAt = feature.updatedAt;
  saveProject(false); renderStats(); populateFeatureForm(feature);
}
function renderMapFeatures() {
  stopEditing(false);
  state.featureGroup.clearLayers();
  state.project.features.forEach(feature => {
    delete feature._layer;
    if (!feature.visible || !featureMatchesDay(feature) || state.settings.typeVisibility?.[feature.type]===false) return;
    const layer = createLeafletLayer(feature);
    state.featureGroup.addLayer(layer);
    feature._layer = layer;
  });
  renderCompetitors();
}
function renderCompetitors() {
  state.project.competitors.forEach(comp => {
    if (!Array.isArray(comp.points) || !comp.points.length) return;
    const line = L.polyline(comp.points.map(p => [p.lat,p.lon]), {color:COLORS.competitor,weight:3,dashArray:'7 7',opacity:.75});
    line.bindTooltip(`${comp.name || comp.id} competitor trail`);
    state.featureGroup.addLayer(line);
    const last = comp.points.at(-1);
    const marker = L.circleMarker([last.lat,last.lon], {radius:6,color:COLORS.competitor,fillColor:COLORS.competitor,fillOpacity:1});
    marker.bindPopup(`<strong>${escapeHtml(comp.name || comp.id)}</strong><br>${escapeHtml(last.time || 'Latest position')}`);
    state.featureGroup.addLayer(marker);
  });
}
function renderLayerList() {
  const box = $('layerList');
  const filtered = state.project.features.filter(featureMatchesDay);
  if (!filtered.length) { box.className='layer-list empty'; box.textContent='No map features for this day.'; return; }
  box.className='layer-list';
  box.innerHTML = filtered.map(feature => `
    <div class="layer-row">
      <span class="swatch" style="background:${COLORS[feature.type] || COLORS.track}"></span>
      <button type="button" data-select-id="${feature.id}"><strong>${escapeHtml(feature.name)}</strong>
      <small>${escapeHtml(feature.type)} · ${feature.day ? `Day ${feature.day}` : 'Unassigned'}</small></button>
      <input class="visibility" type="checkbox" data-visible-id="${feature.id}" ${feature.visible?'checked':''}/>
    </div>`).join('');
  box.querySelectorAll('[data-select-id]').forEach(btn => btn.addEventListener('click', () => selectFeature(btn.dataset.selectId)));
  box.querySelectorAll('[data-visible-id]').forEach(input => input.addEventListener('change', () => {
    const feature = state.project.features.find(f => f.id === input.dataset.visibleId);
    if (feature) { snapshot(); feature.visible=input.checked; saveProject(false); renderMapFeatures(); }
  }));
}
function renderStats() {
  const visible = state.project.features.filter(featureMatchesDay);
  $('trackCount').textContent = visible.filter(f => f.type==='track').length;
  $('routeCount').textContent = visible.filter(f => f.type==='route').length;
  $('waypointCount').textContent = visible.filter(f => ['waypoint','checkpoint','fuel','hotel'].includes(f.type)).length;
  const miles = visible.filter(f => f.geometry.kind==='line').reduce((s,f)=>s+lineDistanceMiles(f.geometry.coordinates),0);
  $('distanceTotal').textContent = `${miles.toFixed(1)} mi`;
}
function renderAll() {
  $('projectName').value=state.project.name; $('dayFilter').value=state.settings.dayFilter;
  $('inreachUrl').value=state.settings.inreachUrl||'';
  renderMapFeatures(); renderLayerList(); renderStats(); renderCompetitorSummary(); renderMissionControl(); renderTypeLayerControls(); renderSearch();
}
function lineDistanceMiles(points) {
  let meters=0; for(let i=1;i<points.length;i++) meters += haversine(points[i-1],points[i]);
  return meters/1609.344;
}
function haversine(a,b) {
  const R=6371000,toRad=x=>x*Math.PI/180,dLat=toRad(b.lat-a.lat),dLon=toRad(b.lon-a.lon);
  const q=Math.sin(dLat/2)**2+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(q));
}
function validPoint(p){return Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180;}

function openDatabase() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(DB_STORE))db.createObjectStore(DB_STORE);};
    request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error||new Error('IndexedDB could not be opened.'));
  });
}
async function saveProject(showMessage=true) {
  try {
    state.project.name=$('projectName')?.value.trim()||state.project.name||'CannonMap Project';
    state.project.version=APP_VERSION; state.project.updatedAt=new Date().toISOString();
    const clean=deepClean(state.project),db=await openDatabase();
    await new Promise((resolve,reject)=>{const tx=db.transaction(DB_STORE,'readwrite');tx.objectStore(DB_STORE).put(clean,'current');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
    db.close(); localStorage.setItem(SETTINGS_KEY,JSON.stringify(state.settings));
    if(showMessage)setStatus(`Saved locally at ${new Date().toLocaleTimeString()}.`);
  } catch(error){setStatus(`Save failed: ${error.message}`,true);}
}
async function loadProject() {
  try {
    const db=await openDatabase();
    const saved=await new Promise((resolve,reject)=>{const tx=db.transaction(DB_STORE,'readonly');const req=tx.objectStore(DB_STORE).get('current');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
    db.close();
    if(saved){state.project=saved;state.project.features ||= [];state.project.competitors ||= [];}
  } catch(_){}
  try {
    const raw = localStorage.getItem(SETTINGS_KEY) || localStorage.getItem('cannonmap.settings.v4') || localStorage.getItem('cannonmap.settings.v3') || '{}';
    Object.assign(state.settings, JSON.parse(raw));
  } catch(_){}
}

function inferDay(text,fallback=0) {
  const value=String(text||'').replace(/<[^>]*>/g,' ').trim();
  const wordDays={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8};
  const patterns=[
    /\bday[\s_:#-]*0?([1-8])\b/i,
    /\bd[\s_:#-]*0?([1-8])\b/i,
    /^\s*0?([1-8])\s*[.\-_]/,
    /\b0?([1-8])\s*[.\-_]\s*\d+\b/,
    /\b0?([1-8])[\s_-]*(?:start|finish|route|track|checkpoint|cp)\b/i
  ];
  for(const p of patterns){const m=value.match(p);if(m)return Number(m[1]);}
  const wordMatch=value.match(/\bday\s+(one|two|three|four|five|six|seven|eight)\b/i);
  if(wordMatch)return wordDays[wordMatch[1].toLowerCase()]||fallback;
  return fallback;
}
function textOf(element,tag){const node=element.getElementsByTagName(tag)[0];return node?node.textContent.trim():'';}
function distancePointToSegmentMiles(p,a,b) {
  const x=p.lon,y=p.lat,x1=a.lon,y1=a.lat,x2=b.lon,y2=b.lat;
  const dx=x2-x1,dy=y2-y1;
  const t=(dx||dy)?Math.max(0,Math.min(1,((x-x1)*dx+(y-y1)*dy)/(dx*dx+dy*dy))):0;
  return lineDistanceMiles([p,{lat:y1+t*dy,lon:x1+t*dx}]);
}
function nearestAssignedDay(point,lines) {
  let best={day:0,d:Infinity};
  for(const line of lines){
    const pts=line.geometry.coordinates;
    const stride=Math.max(1,Math.floor(pts.length/500));
    for(let i=stride;i<pts.length;i+=stride){
      const a=pts[Math.max(0,i-stride)],b=pts[i];
      const d=distancePointToSegmentMiles(point,a,b);
      if(d<best.d)best={day:line.day,d};
    }
  }
  return best.d<=45?best.day:0;
}
function assignLineDays(features) {
  let changed=0;
  const lines=features.filter(f=>f.geometry.kind==='line');
  for(const f of lines){
    if(f.day)continue;
    const explicit=inferDay(`${f.name} ${f.notes} ${f.source}`,0);
    if(explicit){f.day=explicit;f.assignmentMethod='explicit';changed++;}
  }
  const remaining=lines.filter(f=>!f.day);
  if(remaining.length===8){
    remaining.forEach((f,index)=>{f.day=index+1;f.assignmentMethod='line-order';changed++;});
  }
  return changed;
}
function assignWaypointDays(features,onlyUnassigned=true) {
  let changed=assignLineDays(features);
  const assignedLines=features.filter(f=>f.geometry.kind==='line'&&f.day>=1&&f.day<=8);
  for(const f of features.filter(f=>f.geometry.kind==='point'&&(!onlyUnassigned||!f.day))){
    if(onlyUnassigned&&f.day)continue;
    const explicit=inferDay(`${f.name} ${f.notes} ${f.source}`,0);
    if(explicit){
      if(f.day!==explicit){f.day=explicit;changed++;}
      f.assignmentMethod='explicit';
      continue;
    }
    const day=nearestAssignedDay(f.geometry.coordinates[0],assignedLines);
    if(day){
      if(f.day!==day){f.day=day;changed++;}
      f.assignmentMethod='route-proximity';
    }
  }
  return changed;
}
function classifyPoint(name,notes,sym='') {
  const lc=`${name} ${notes} ${sym}`.toLowerCase();
  if(/\bfuel\b|\bgas\b|gasoline|service station/.test(lc))return 'fuel';
  if(/\bhotel\b|\bmotel\b|\blodging\b|\binn\b/.test(lc))return 'hotel';
  if(/checkpoint|\bcp\s*\d*\b|\bstart\b|\bfinish\b|\bdirt\b|\bextreme\b|type\s+(standard|dirt|extreme|finish)/.test(lc))return 'checkpoint';
  return 'waypoint';
}
function parseGpx(xmlText,filename) {
  const doc=new DOMParser().parseFromString(xmlText,'application/xml');
  if(doc.querySelector('parsererror'))throw new Error('The file is not valid GPX/XML.');
  const features=[];
  let sourceOrder=0;
  [...doc.getElementsByTagName('rte')].forEach((rte,index)=>{
    const name=textOf(rte,'name')||`${filename} route ${index+1}`;
    const notes=textOf(rte,'desc')||textOf(rte,'cmt');
    const coordinates=[...rte.getElementsByTagName('rtept')].map(p=>({lat:Number(p.getAttribute('lat')),lon:Number(p.getAttribute('lon'))})).filter(validPoint);
    if(coordinates.length)features.push({id:uid(),name,type:'route',day:inferDay(`${name} ${notes} ${filename}`),assignmentMethod:'',notes,visible:true,source:filename,sourceOrder:sourceOrder++,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),geometry:{kind:'line',coordinates}});
  });
  [...doc.getElementsByTagName('trk')].forEach((trk,index)=>{
    const baseName=textOf(trk,'name')||`${filename} track ${index+1}`,notes=textOf(trk,'desc')||textOf(trk,'cmt');
    const segments=[...trk.getElementsByTagName('trkseg')];
    segments.forEach((segment,segIndex)=>{
      const coordinates=[...segment.getElementsByTagName('trkpt')].map(p=>({lat:Number(p.getAttribute('lat')),lon:Number(p.getAttribute('lon'))})).filter(validPoint);
      if(coordinates.length)features.push({id:uid(),name:segments.length>1?`${baseName} segment ${segIndex+1}`:baseName,type:'track',day:inferDay(`${baseName} ${notes} ${filename}`),assignmentMethod:'',notes,visible:true,source:filename,sourceOrder:sourceOrder++,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),geometry:{kind:'line',coordinates}});
    });
  });
  [...doc.getElementsByTagName('wpt')].forEach((wpt,index)=>{
    const name=textOf(wpt,'name')||`${filename} waypoint ${index+1}`;
    const notes=textOf(wpt,'desc')||textOf(wpt,'cmt');
    const sym=textOf(wpt,'sym');
    const p={lat:Number(wpt.getAttribute('lat')),lon:Number(wpt.getAttribute('lon'))};
    if(validPoint(p))features.push({id:uid(),name,type:classifyPoint(name,notes,sym),day:inferDay(`${name} ${notes} ${filename}`),assignmentMethod:'',notes,visible:true,source:filename,sourceOrder:sourceOrder++,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),geometry:{kind:'point',coordinates:[p]}});
  });
  const auto=assignWaypointDays(features,true);
  return {features,auto};
}
function normalizedName(value){return String(value||'').toLowerCase().replace(/<[^>]*>/g,' ').replace(/[^a-z0-9]+/g,' ').trim();}
function featureDuplicate(imported,existing) {
  if(imported.geometry.kind!==existing.geometry.kind)return false;
  const sameName=normalizedName(imported.name)===normalizedName(existing.name);
  if(imported.geometry.kind==='point'){
    const distance=haversine(imported.geometry.coordinates[0],existing.geometry.coordinates[0]);
    return distance<=40 || (sameName&&distance<=805);
  }
  if(imported.type!==existing.type&&!sameName)return false;
  const ia=imported.geometry.coordinates[0],ib=imported.geometry.coordinates.at(-1);
  const ea=existing.geometry.coordinates[0],eb=existing.geometry.coordinates.at(-1);
  const direct=haversine(ia,ea)+haversine(ib,eb);
  const reverse=haversine(ia,eb)+haversine(ib,ea);
  return sameName&&Math.min(direct,reverse)<=1609;
}
function findDuplicate(feature,pool=state.project.features){return pool.find(existing=>featureDuplicate(feature,existing));}
function buildImportReport(features,files,auto) {
  const byType=type=>features.filter(f=>f.type===type).length;
  const unassigned=features.filter(f=>!f.day).length;
  const duplicates=features.filter(f=>findDuplicate(f)).length;
  const unnamed=features.filter(f=>!f.name||/^.+ (route|track|waypoint) \d+$/i.test(f.name)).length;
  const shortLines=features.filter(f=>f.geometry.kind==='line'&&f.geometry.coordinates.length<2).length;
  const warnings=[]; if(unassigned)warnings.push(`${unassigned} features still need day review.`); if(duplicates)warnings.push(`${duplicates} probable duplicates match the current project.`); if(unnamed)warnings.push(`${unnamed} features use generated or weak names.`); if(shortLines)warnings.push(`${shortLines} line features have insufficient geometry.`);
  return {
    files,features,auto,unassigned,duplicates,unnamed,shortLines,warnings,
    counts:{tracks:byType('track'),routes:byType('route'),points:features.filter(f=>f.geometry.kind==='point').length,checkpoints:byType('checkpoint')}
  };
}
async function importGpxFiles(files) {
  const imported=[];let auto=0;const names=[];const errors=[];
  for(const file of files){
    try{const parsed=parseGpx(await file.text(),file.name);imported.push(...parsed.features);auto+=parsed.auto;names.push(file.name);}
    catch(error){errors.push(`${file.name}: ${error.message}`);}
  }
  if(!imported.length)return setStatus(errors.length?errors.join(' | '):'No GPX features were found.',true);
  state.pendingImport=buildImportReport(imported,names,auto);
  const r=state.pendingImport;
  $('importReport').innerHTML=`
    <div><strong>${escapeHtml(r.files.join(', '))}</strong></div>
    <div class="import-summary-grid">
      <article><span>Total features</span><strong>${r.features.length}</strong></article>
      <article><span>Assigned days</span><strong>${r.features.length-r.unassigned}</strong></article>
      <article><span>Still unassigned</span><strong>${r.unassigned}</strong></article>
      <article><span>Duplicates found</span><strong>${r.duplicates}</strong></article>
      <article><span>Tracks / Routes</span><strong>${r.counts.tracks} / ${r.counts.routes}</strong></article>
      <article><span>Points / Checkpoints</span><strong>${r.counts.points} / ${r.counts.checkpoints}</strong></article>
      <article><span>Weak names</span><strong>${r.unnamed}</strong></article>
      <article><span>Geometry warnings</span><strong>${r.shortLines}</strong></article>
    </div>
    ${r.warnings.length?`<ul class="inspector-warnings">${r.warnings.map(w=>`<li>${escapeHtml(w)}</li>`).join('')}</ul>`:'<div class="notice muted">Inspector found no major structural warnings.</div>'}
    ${errors.length?`<ul class="import-warnings">${errors.map(e=>`<li>${escapeHtml(e)}</li>`).join('')}</ul>`:''}`;
  $('importDialog').showModal();
}
async function applyPendingImport(mode) {
  const pending=state.pendingImport;if(!pending)return;
  createNamedSnapshot(`Before GPX ${mode}`,true);snapshot();
  let added=0,updated=0,skipped=0;
  if(mode==='replace'){
    state.project.features=pending.features;
    added=pending.features.length;
  } else if(mode==='add'){
    state.project.features.push(...pending.features);
    added=pending.features.length;
  } else {
    for(const incoming of pending.features){
      const existing=findDuplicate(incoming);
      if(existing){
        existing.name=incoming.name||existing.name;
        existing.type=incoming.type||existing.type;
        existing.notes=incoming.notes||existing.notes;
        existing.source=incoming.source||existing.source;
        existing.geometry=incoming.geometry;
        if(incoming.day)existing.day=incoming.day;
        existing.updatedAt=new Date().toISOString();
        updated++;
      } else {
        state.project.features.push(incoming);added++;
      }
    }
  }
  assignWaypointDays(state.project.features,true);
  state.pendingImport=null;
  await saveProject(false);renderAll();fitMap();
  setStatus(`GPX ${mode}: ${added} added, ${updated} updated, ${skipped} skipped. ${state.project.features.filter(f=>!f.day).length} features remain unassigned.`);
}
function reassignExistingDays() {
  const targets=state.project.features.filter(f=>!f.day);
  if(!targets.length)return setStatus('No unassigned features remain.');
  snapshot();
  const changed=assignWaypointDays(state.project.features,true);
  state.project.features.forEach(f=>{if(f.day)f.updatedAt=new Date().toISOString();});
  saveProject(false);renderAll();
  setStatus(`Reassigned ${changed} features. ${state.project.features.filter(f=>!f.day).length} remain unassigned.`);
}
function exportProjectFile() {
  const payload={
    format:'CannonMap Project',
    schemaVersion:1,
    appVersion:APP_VERSION,
    build:BUILD_ID,
    exportedAt:new Date().toISOString(),
    project:deepClean(state.project),
    settings:deepClean(state.settings)
  };
  downloadBlob(JSON.stringify(payload,null,2),`${safeFilename(state.project.name)}.cmap`,'application/json');
  setStatus('Saved portable .cmap project file.');
}
async function openProjectFile(file) {
  try{
    const payload=JSON.parse(await file.text());
    const project=payload.project||payload;
    if(!project||!Array.isArray(project.features))throw new Error('This is not a valid CannonMap project file.');
    snapshot();
    state.project=project;
    state.project.features ||= [];
    state.project.competitors ||= [];
    state.project.version=APP_VERSION;
    if(payload.settings)Object.assign(state.settings,payload.settings);
    clearSelection();
    await saveProject(false);
    renderAll();fitMap();
    setStatus(`Opened ${file.name}: ${state.project.features.length} features.`);
  }catch(error){setStatus(`Project open failed: ${error.message}`,true);}
}


function getSnapshots(){try{return JSON.parse(localStorage.getItem(SNAPSHOT_KEY)||'[]');}catch(_){return[];}}
function writeSnapshots(items){localStorage.setItem(SNAPSHOT_KEY,JSON.stringify(items.slice(0,12)));}
function createNamedSnapshot(label='Manual snapshot',quiet=false){
  const items=getSnapshots();items.unshift({id:uid(),label,createdAt:new Date().toISOString(),project:deepClean(state.project),settings:deepClean(state.settings)});writeSnapshots(items);renderSnapshots();if(!quiet)setStatus(`Snapshot created: ${label}.`);
}
function restoreSnapshot(id){const item=getSnapshots().find(x=>x.id===id);if(!item)return;snapshot();state.project=item.project;if(item.settings)Object.assign(state.settings,item.settings);saveProject(false);clearSelection();renderAll();fitMap();setStatus(`Restored snapshot from ${new Date(item.createdAt).toLocaleString()}.`);}
function deleteSnapshot(id){writeSnapshots(getSnapshots().filter(x=>x.id!==id));renderSnapshots();}
function renderSnapshots(){const box=$('snapshotList');if(!box)return;const items=getSnapshots();if(!items.length){box.className='snapshot-list empty';box.textContent='No snapshots yet.';return;}box.className='snapshot-list';box.innerHTML=items.map(x=>`<div class="snapshot-row"><div><strong>${escapeHtml(x.label)}</strong><small>${new Date(x.createdAt).toLocaleString()} · ${x.project.features?.length||0} features</small></div><button class="button secondary" data-restore="${x.id}">Restore</button><button class="button danger-outline" data-drop="${x.id}">×</button></div>`).join('');box.querySelectorAll('[data-restore]').forEach(b=>b.onclick=()=>restoreSnapshot(b.dataset.restore));box.querySelectorAll('[data-drop]').forEach(b=>b.onclick=()=>deleteSnapshot(b.dataset.drop));}
function renderMissionControl(){
  const fs=state.project.features,miles=fs.filter(f=>f.geometry.kind==='line').reduce((s,f)=>s+lineDistanceMiles(f.geometry.coordinates),0);
  $('missionProjectName').textContent=state.project.name;$('missionUpdated').textContent=`Updated ${new Date(state.project.updatedAt||Date.now()).toLocaleString()}`;
  $('missionFeatureCount').textContent=fs.length;$('missionCheckpointCount').textContent=fs.filter(f=>f.type==='checkpoint').length;$('missionFuelCount').textContent=fs.filter(f=>f.type==='fuel').length;$('missionHotelCount').textContent=fs.filter(f=>f.type==='hotel').length;$('missionUnassignedCount').textContent=fs.filter(f=>!f.day).length;$('missionMileage').textContent=`${miles.toFixed(1)} mi`;
  $('dailyReadiness').innerHTML=[1,2,3,4,5,6,7,8].map(day=>{const rows=fs.filter(f=>f.day===day),cp=rows.filter(f=>f.type==='checkpoint').length,fuel=rows.filter(f=>f.type==='fuel').length,hotel=rows.filter(f=>f.type==='hotel').length,dm=rows.filter(f=>f.geometry.kind==='line').reduce((s,f)=>s+lineDistanceMiles(f.geometry.coordinates),0),score=Math.min(100,(rows.length?40:0)+(cp?25:0)+(fuel?15:0)+(hotel?20:0));return `<div class="day-card" data-day-card="${day}"><header><strong>Day ${day}</strong><span>${dm.toFixed(0)} mi</span></header><small>${cp} checkpoints · ${fuel} fuel · ${hotel} hotel · ${rows.length} features</small><div class="day-meter"><i style="width:${score}%"></i></div></div>`}).join('');
  $('dailyReadiness').querySelectorAll('[data-day-card]').forEach(c=>c.onclick=()=>{state.settings.dayFilter=c.dataset.dayCard;$('dayFilter').value=state.settings.dayFilter;document.querySelector('[data-tab="project"]').click();saveProject(false);renderAll();});renderSnapshots();
}
function renderTypeLayerControls(){const box=$('typeLayerControls');if(!box)return;const labels={track:'Tracks',route:'Routes',waypoint:'Waypoints',checkpoint:'Checkpoints',fuel:'Fuel',hotel:'Hotels'};box.innerHTML=Object.entries(labels).map(([type,label])=>`<label class="type-toggle"><input type="checkbox" data-type-visible="${type}" ${state.settings.typeVisibility?.[type]!==false?'checked':''}><span class="swatch" style="background:${COLORS[type]}"></span>${label}</label>`).join('');box.querySelectorAll('[data-type-visible]').forEach(input=>input.onchange=()=>{state.settings.typeVisibility[input.dataset.typeVisible]=input.checked;saveProject(false);renderMapFeatures();});$('lineOpacity').value=state.settings.lineOpacity||90;}
function renderSearch(){const box=$('searchResults');if(!box)return;const q=$('globalSearch').value.trim().toLowerCase(),type=$('searchType').value,day=$('searchDay').value;let rows=state.project.features.filter(f=>(type==='all'||f.type===type)&&(day==='all'||String(f.day||0)===day));if(q)rows=rows.filter(f=>`${f.name} ${f.notes||''} ${f.source||''}`.toLowerCase().includes(q));rows=rows.slice(0,100);if(!q&&type==='all'&&day==='all'){box.className='search-results empty';box.textContent='Enter a search term or choose filters.';return;}if(!rows.length){box.className='search-results empty';box.textContent='No matching features.';return;}box.className='search-results';box.innerHTML=rows.map(f=>`<button class="search-result" data-search-id="${f.id}"><strong>${f.favorite?'<span class="favorite-star">★</span> ':''}${escapeHtml(f.name)}</strong><small>${f.type} · ${f.day?`Day ${f.day}`:'Unassigned'}${f.notes?` · ${escapeHtml(f.notes.slice(0,90))}`:''}</small></button>`).join('');box.querySelectorAll('[data-search-id]').forEach(b=>b.onclick=()=>{selectFeature(b.dataset.searchId);zoomSelected();document.querySelector('[data-tab="features"]').click();});}
function openContextMenu(id,x,y){state.selectedId=id;const menu=$('contextMenu');menu.hidden=false;menu.style.left=`${Math.min(x,window.innerWidth-190)}px`;menu.style.top=`${Math.min(y,window.innerHeight-260)}px`;}
function closeContextMenu(){$('contextMenu').hidden=true;}
function reverseSelected(){const f=state.project.features.find(x=>x.id===state.selectedId);if(!f||f.geometry.kind!=='line')return setStatus('Only routes and tracks can be reversed.');snapshot();f.geometry.coordinates.reverse();f.updatedAt=new Date().toISOString();saveProject(false);renderAll();selectFeature(f.id);setStatus(`Reversed ${f.name}.`);}
function toggleFavorite(){const f=state.project.features.find(x=>x.id===state.selectedId);if(!f)return;snapshot();f.favorite=!f.favorite;saveProject(false);renderAll();setStatus(`${f.favorite?'Favorited':'Removed favorite from'} ${f.name}.`);}
function clearSelection() {
  stopEditing();
  state.selectedId=null; $('selectedFeatureId').value='';
  ['featureName','featureType','featureDay','featureNotes','featureLatitude','featureLongitude'].forEach(id=>$(id).disabled=true);
  ['updateFeatureButton','zoomFeatureButton','duplicateFeatureButton','deleteFeatureButton','editGeometryButton','stopEditButton'].forEach(id=>$(id).disabled=true);
}
function populateFeatureForm(feature) {
  $('selectedFeatureId').value=feature.id;$('featureName').value=feature.name;$('featureType').value=feature.type;
  $('featureDay').value=String(feature.day||0);$('featureNotes').value=feature.notes||'';
  const isPoint=feature.geometry.kind==='point';
  $('pointCoordinates').classList.toggle('hidden',!isPoint);
  if(isPoint){$('featureLatitude').value=feature.geometry.coordinates[0].lat.toFixed(6);$('featureLongitude').value=feature.geometry.coordinates[0].lon.toFixed(6);}
  ['featureName','featureType','featureDay','featureNotes'].forEach(id=>$(id).disabled=false);
  $('featureLatitude').disabled=!isPoint;$('featureLongitude').disabled=!isPoint;
  ['updateFeatureButton','zoomFeatureButton','duplicateFeatureButton','deleteFeatureButton','editGeometryButton'].forEach(id=>$(id).disabled=false);
}
function selectFeature(id) {
  stopEditing();
  const feature=state.project.features.find(f=>f.id===id);if(!feature)return;
  state.selectedId=id;populateFeatureForm(feature);
  document.querySelectorAll('.tab,.panel').forEach(el=>el.classList.remove('active'));
  document.querySelector('[data-tab="features"]').classList.add('active');$('featuresPanel').classList.add('active');
  if(window.innerWidth<=840)setSidebarOpen(true);
}
function updateSelectedFeature(event) {
  event.preventDefault();
  const feature=state.project.features.find(f=>f.id===state.selectedId);if(!feature)return;
  snapshot();
  feature.name=$('featureName').value.trim()||feature.name;feature.type=$('featureType').value;feature.day=Number($('featureDay').value);feature.notes=$('featureNotes').value.trim();
  if(feature.geometry.kind==='point'){
    const lat=Number($('featureLatitude').value),lon=Number($('featureLongitude').value);
    if(validPoint({lat,lon}))feature.geometry.coordinates=[{lat,lon}];
  }
  feature.updatedAt=new Date().toISOString();saveProject(false);renderAll();selectFeature(feature.id);setStatus(`Updated ${feature.name}.`);
}
function editSelectedGeometry() {
  stopEditing();
  const feature=state.project.features.find(f=>f.id===state.selectedId);if(!feature||!feature._layer)return;
  state.editingLayer=feature._layer;snapshot();
  if(feature.geometry.kind==='point'){
    state.editingLayer.dragging?.enable();
    state.editingLayer.on('dragend.cannonedit',()=>syncGeometryFromLayer(state.editingLayer));
  }else{
    state.editingLayer.pm.enable({allowSelfIntersection:true,snappable:true});
  }
  $('stopEditButton').disabled=false;
  setStatus(`Editing ${feature.name}. Drag the point or line vertices, then select Finish edit.`);
}
function stopEditing(save=true) {
  const layer=state.editingLayer;if(!layer)return;
  const feature=state.project.features.find(f=>f.id===layer._cannonId);
  if(layer.pm?.enabled())layer.pm.disable();
  layer.dragging?.disable();
  layer.off('dragend.cannonedit');
  if(save&&feature){feature.geometry=layerToGeometry(layer);feature.updatedAt=new Date().toISOString();saveProject(false);}
  state.editingLayer=null;
  if($('stopEditButton'))$('stopEditButton').disabled=true;
}
function zoomSelected() {
  const feature=state.project.features.find(f=>f.id===state.selectedId);if(!feature)return;
  if(feature.geometry.kind==='point'){const p=feature.geometry.coordinates[0];state.map.setView([p.lat,p.lon],15);}
  else state.map.fitBounds(feature.geometry.coordinates.map(p=>[p.lat,p.lon]),{padding:[30,30]});
}
function duplicateSelected() {
  const feature=state.project.features.find(f=>f.id===state.selectedId);if(!feature)return;snapshot();
  const copy=deepClean(feature);copy.id=uid();copy.name=`${copy.name} copy`;copy.createdAt=new Date().toISOString();copy.updatedAt=copy.createdAt;
  copy.geometry.coordinates=copy.geometry.coordinates.map(p=>({lat:p.lat+.002,lon:p.lon+.002}));state.project.features.push(copy);
  saveProject(false);renderAll();selectFeature(copy.id);
}
function deleteSelected() {
  const feature=state.project.features.find(f=>f.id===state.selectedId);if(!feature||!confirm(`Delete “${feature.name}”?`))return;
  snapshot();state.project.features=state.project.features.filter(f=>f.id!==state.selectedId);clearSelection();saveProject(false);renderAll();setStatus(`Deleted ${feature.name}.`);
}
function bulkAssign() {
  const day=Number($('bulkDay').value),targets=state.project.features.filter(f=>f.geometry.kind==='point'&&!f.day);
  if(!targets.length)return setStatus('No unassigned point features remain.');
  snapshot();targets.forEach(f=>{f.day=day;f.updatedAt=new Date().toISOString();});saveProject(false);renderAll();setStatus(`Assigned ${targets.length} unassigned point features to Day ${day}.`);
}
function fitMap() {
  const layers=state.featureGroup.getLayers();if(!layers.length)return;
  const bounds=state.featureGroup.getBounds();if(bounds.isValid())state.map.fitBounds(bounds,{padding:[25,25]});
}

function xmlEscape(value){return String(value??'').replace(/[<>&'"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]));}
function safeFilename(name){return String(name||'cannonmap').trim().replace(/[^a-z0-9_-]+/gi,'-').replace(/^-|-$/g,'').toLowerCase();}
function downloadBlob(content,filename,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),500);}
function exportGpx() {
  const fs=state.project.features.filter(featureMatchesDay);
  const w=fs.filter(f=>f.geometry.kind==='point').map(f=>{const p=f.geometry.coordinates[0];return `  <wpt lat="${p.lat.toFixed(8)}" lon="${p.lon.toFixed(8)}"><name>${xmlEscape(f.name)}</name><desc>${xmlEscape(f.notes||'')}</desc><type>${xmlEscape(f.type)}</type></wpt>`;}).join('\n');
  const r=fs.filter(f=>f.type==='route'&&f.geometry.kind==='line').map(f=>`  <rte><name>${xmlEscape(f.name)}</name><desc>${xmlEscape(f.notes||'')}</desc>\n${f.geometry.coordinates.map(p=>`    <rtept lat="${p.lat.toFixed(8)}" lon="${p.lon.toFixed(8)}" />`).join('\n')}\n  </rte>`).join('\n');
  const t=fs.filter(f=>f.type!=='route'&&f.geometry.kind==='line').map(f=>`  <trk><name>${xmlEscape(f.name)}</name><desc>${xmlEscape(f.notes||'')}</desc><trkseg>\n${f.geometry.coordinates.map(p=>`    <trkpt lat="${p.lat.toFixed(8)}" lon="${p.lon.toFixed(8)}" />`).join('\n')}\n  </trkseg></trk>`).join('\n');
  const xml=`<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="CannonMap ${APP_VERSION}" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>${xmlEscape(state.project.name)}</name><time>${new Date().toISOString()}</time></metadata>\n${w}\n${r}\n${t}\n</gpx>`;
  downloadBlob(xml,`${safeFilename(state.project.name)}${state.settings.dayFilter==='all'?'':`-day-${state.settings.dayFilter}`}.gpx`,'application/gpx+xml');setStatus(`Exported ${fs.length} features to GPX.`);
}
function manifestRows() {
  const fs=state.project.features.filter(featureMatchesDay);
  const typeOrder={checkpoint:1,fuel:2,hotel:3,waypoint:4,route:5,track:6};
  return fs.map((f,index)=>{
    const p=f.geometry.coordinates[0]||{},distance=f.geometry.kind==='line'?lineDistanceMiles(f.geometry.coordinates):0;
    return {
      Day:f.day||'Unassigned', Sequence:index+1, Name:f.name, Type:f.type,
      Latitude:Number.isFinite(p.lat)?p.lat:'', Longitude:Number.isFinite(p.lon)?p.lon:'',
      'Point Count':f.geometry.coordinates.length, 'Distance (mi)':Number(distance.toFixed(2)),
      Status:'Planned', Notes:f.notes||'', 'Source GPX':f.source||'', Visible:f.visible?'Yes':'No',
      'Assignment Method':f.assignmentMethod||'', 'Updated At':f.updatedAt||''
    };
  }).sort((a,b)=>(Number(a.Day)||99)-(Number(b.Day)||99)||(typeOrder[a.Type]||99)-(typeOrder[b.Type]||99)||a.Sequence-b.Sequence);
}
function exportExcel() {
  if(typeof XLSX==='undefined')return setStatus('Excel library did not load. Check the internet connection and reload.',true);
  const manifest=manifestRows(),wb=XLSX.utils.book_new();
  const add=(name,rows)=>{const ws=XLSX.utils.json_to_sheet(rows.length?rows:[{Message:'No records'}]);ws['!autofilter']={ref:ws['!ref']};ws['!freeze']={xSplit:0,ySplit:1};ws['!cols']=[18,10,34,14,14,14,12,14,12,45,28,10,20,24].map(w=>({wch:w}));XLSX.utils.book_append_sheet(wb,ws,name);};
  add('Master Manifest',manifest);
  add('Daily Summary',[1,2,3,4,5,6,7,8].map(day=>{const rows=manifest.filter(r=>r.Day===day);return {Day:day,Features:rows.length,Checkpoints:rows.filter(r=>r.Type==='checkpoint').length,Routes:rows.filter(r=>r.Type==='route').length,Tracks:rows.filter(r=>r.Type==='track').length,'Line Miles':Number(rows.reduce((s,r)=>s+(Number(r['Distance (mi)'])||0),0).toFixed(2))};}));
  for(const [sheet,type] of [['Checkpoints','checkpoint'],['Routes','route'],['Tracks','track'],['Fuel Stops','fuel'],['Hotels','hotel'],['Waypoints','waypoint']])add(sheet,manifest.filter(r=>r.Type===type));
  const comp=[];state.project.competitors.forEach(c=>c.points.forEach((p,i)=>comp.push({Rider:c.name||c.id,Sequence:i+1,Latitude:p.lat,Longitude:p.lon,Time:p.time||''})));add('Competitor Trails',comp);
  XLSX.writeFile(wb,`${safeFilename(state.project.name)}-manifest${state.settings.dayFilter==='all'?'':`-day-${state.settings.dayFilter}`}.xlsx`);
  setStatus(`Exported ${manifest.length} manifest rows to Excel.`);
}
function csvEscape(v){const s=String(v??'');return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
function exportCsv() {
  const rows=manifestRows();if(!rows.length)return setStatus('No features to export.');
  const headers=Object.keys(rows[0]);const csv=[headers.join(','),...rows.map(r=>headers.map(h=>csvEscape(r[h])).join(','))].join('\n');
  downloadBlob(csv,`${safeFilename(state.project.name)}-manifest.csv`,'text/csv;charset=utf-8');setStatus(`Exported ${rows.length} manifest rows to CSV.`);
}

function startGps() {
  if(!navigator.geolocation)return setStatus('This browser does not support GPS.',true);
  if(state.gpsWatchId!==null){navigator.geolocation.clearWatch(state.gpsWatchId);state.gpsWatchId=null;$('gpsButton').textContent='Start GPS';$('gpsStatus').textContent='GPS off';return;}
  state.gpsWatchId=navigator.geolocation.watchPosition(position=>{
    const ll=[position.coords.latitude,position.coords.longitude];state.gpsLayer?.remove();state.gpsAccuracyLayer?.remove();
    state.gpsAccuracyLayer=L.circle(ll,{radius:position.coords.accuracy,color:'#38bdf8',weight:1,fillOpacity:.08}).addTo(state.map);
    state.gpsLayer=L.circleMarker(ll,{radius:8,color:'#fff',weight:3,fillColor:'#38bdf8',fillOpacity:1}).addTo(state.map);
    $('gpsStatus').textContent=`GPS ±${Math.round(position.coords.accuracy*3.28084)} ft`;
  },error=>setStatus(`GPS error: ${error.message}`,true),{enableHighAccuracy:true,maximumAge:2000,timeout:15000});
  $('gpsButton').textContent='Stop GPS';
}
async function importCompetitorJson(file) {
  try {
    const data=JSON.parse(await file.text()),entries=Array.isArray(data)?data:data.competitors;
    if(!Array.isArray(entries))throw new Error('Expected an array or a competitors array.');
    snapshot();state.project.competitors=entries.map((entry,index)=>({id:entry.id||entry.riderId||`rider-${index+1}`,name:entry.name||entry.riderName||`Rider ${index+1}`,points:(entry.points||entry.positions||[]).map(p=>({lat:Number(p.lat??p.latitude),lon:Number(p.lon??p.longitude),time:p.time||p.timestamp||''})).filter(validPoint)}));
    saveProject(false);renderAll();fitMap();setStatus(`Imported ${state.project.competitors.length} competitor trails.`);
  } catch(error){setStatus(`Competitor import failed: ${error.message}`,true);}
}
function renderCompetitorSummary() {
  const box=$('competitorSummary');if(!state.project.competitors.length){box.className='layer-list empty';box.textContent='No competitor data loaded.';return;}
  box.className='layer-list';box.innerHTML=state.project.competitors.map(c=>`<div class="layer-row"><span class="swatch" style="background:${COLORS.competitor}"></span><div><strong>${escapeHtml(c.name)}</strong><small>${c.points.length} breadcrumb points</small></div><span></span></div>`).join('');
}
function newProject() {
  if(!confirm('Create a new empty project? The currently saved local project will be replaced.'))return;
  createNamedSnapshot('Before new project',true);snapshot();state.project={version:APP_VERSION,name:'America 250 – 2026',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),features:[],competitors:[]};
  clearSelection();saveProject(false);renderAll();setStatus('New project created.');
}
function setSidebarOpen(open) {
  $('sidebar').classList.toggle('open',open);$('sidebarBackdrop').classList.toggle('visible',open);$('sidebarToggle').setAttribute('aria-expanded',String(open));$('sidebarToggle').textContent=open?'Close':'Planner';
}
function wireUi() {
  document.querySelectorAll('.tab').forEach(tab=>tab.addEventListener('click',()=>{document.querySelectorAll('.tab,.panel').forEach(el=>el.classList.remove('active'));tab.classList.add('active');$(`${tab.dataset.tab}Panel`).classList.add('active');}));
  $('sidebarToggle').addEventListener('click',()=>setSidebarOpen(!$('sidebar').classList.contains('open')));$('sidebarClose').addEventListener('click',()=>setSidebarOpen(false));$('sidebarBackdrop').addEventListener('click',()=>setSidebarOpen(false));
  document.addEventListener('keydown',event=>{if(event.key==='Escape')setSidebarOpen(false);});
  $('gpxInput').addEventListener('change',event=>{importGpxFiles([...event.target.files]);event.target.value='';});
  $('projectInput').addEventListener('change',event=>{const file=event.target.files[0];if(file)openProjectFile(file);event.target.value='';});
  $('missionFitButton').addEventListener('click',fitMap);$('missionUnassignedButton').addEventListener('click',()=>{state.settings.dayFilter='0';$('dayFilter').value='0';document.querySelector('[data-tab="project"]').click();saveProject(false);renderAll();});$('missionSnapshotButton').addEventListener('click',()=>createNamedSnapshot('Manual snapshot'));
  ['globalSearch','searchType','searchDay'].forEach(id=>$(id).addEventListener(id==='globalSearch'?'input':'change',renderSearch));
  $('lineOpacity').addEventListener('input',()=>{state.settings.lineOpacity=Number($('lineOpacity').value);renderMapFeatures();});$('lineOpacity').addEventListener('change',()=>saveProject(false));
  document.addEventListener('click',event=>{if(!$('contextMenu').contains(event.target))closeContextMenu();});$('contextMenu').querySelectorAll('[data-context]').forEach(btn=>btn.addEventListener('click',()=>{const a=btn.dataset.context;closeContextMenu();if(a==='zoom')zoomSelected();if(a==='edit'){selectFeature(state.selectedId);editSelectedGeometry();}if(a==='duplicate')duplicateSelected();if(a==='reverse')reverseSelected();if(a==='favorite')toggleFavorite();if(a==='delete')deleteSelected();}));
  $('saveButton').addEventListener('click',()=>saveProject(true));
  $('saveProjectFileButton').addEventListener('click',exportProjectFile);
  $('reassignDaysButton').addEventListener('click',reassignExistingDays);
  $('exportAllButton').addEventListener('click',exportGpx);$('exportExcelButton').addEventListener('click',exportExcel);$('exportCsvButton').addEventListener('click',exportCsv);
  $('fitButton').addEventListener('click',fitMap);$('newProjectButton').addEventListener('click',newProject);$('gpsButton').addEventListener('click',startGps);
  $('projectName').addEventListener('change',()=>saveProject(false));$('dayFilter').addEventListener('change',()=>{state.settings.dayFilter=$('dayFilter').value;saveProject(false);renderAll();});
  $('featureForm').addEventListener('submit',updateSelectedFeature);$('zoomFeatureButton').addEventListener('click',zoomSelected);$('duplicateFeatureButton').addEventListener('click',duplicateSelected);
  $('deleteFeatureButton').addEventListener('click',deleteSelected);$('editGeometryButton').addEventListener('click',editSelectedGeometry);$('stopEditButton').addEventListener('click',()=>{stopEditing();renderAll();selectFeature(state.selectedId);setStatus('Geometry edit saved.');});
  $('undoButton').addEventListener('click',undo);$('bulkAssignButton').addEventListener('click',bulkAssign);
  $('saveTrackingSettings').addEventListener('click',()=>{state.settings.inreachUrl=$('inreachUrl').value.trim();saveProject(true);});
  $('competitorInput').addEventListener('change',e=>e.target.files[0]&&importCompetitorJson(e.target.files[0]));
  $('importForm').addEventListener('submit',event=>{
    event.preventDefault();
    const mode=event.submitter?.value||'cancel';
    $('importDialog').close(mode);
    if(mode!=='cancel')applyPendingImport(mode);else state.pendingImport=null;
  });
  $('createDialog').addEventListener('close',()=>{if($('createDialog').returnValue!=='default'&&state.pendingLayer){state.pendingLayer.remove();state.pendingLayer=null;}});
  $('createForm').addEventListener('submit',event=>{
    event.preventDefault();
    if(event.submitter&&event.submitter.value==='cancel'){state.pendingLayer?.remove();state.pendingLayer=null;$('createDialog').close('cancel');return;}
    if(!state.pendingLayer)return;snapshot();
    const feature={id:uid(),name:$('createName').value.trim()||'New feature',type:$('createType').value,day:Number($('createDay').value),assignmentMethod:'manual',notes:$('createNotes').value.trim(),visible:true,source:'CannonMap drawing',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),geometry:layerToGeometry(state.pendingLayer)};
    state.pendingLayer.remove();state.pendingLayer=null;state.project.features.push(feature);saveProject(false);renderAll();selectFeature(feature.id);$('createDialog').close('default');setStatus(`Created ${feature.name}.`);
  });
}
async function init() {
  await loadProject();
  state.project.features.forEach(f=>{f.assignmentMethod ||= '';f.favorite ||= false;});
  state.settings.typeVisibility=Object.assign({track:true,route:true,waypoint:true,checkpoint:true,fuel:true,hotel:true},state.settings.typeVisibility||{});
  initMap();wireUi();
  $('buildLabel').textContent=`Beta ${APP_VERSION}`;
  $('appVersion').textContent=`v${APP_VERSION} · ${BUILD_ID}`;
  renderAll();setTimeout(()=>{if(state.project.features.length)fitMap();},200);
  if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
}
init();
