'use strict';

const APP_VERSION = '0.8.0';
const BUILD_ID = '2026.07.21.08';
const SETTINGS_KEY = 'cannonmap.settings.v6';
const SNAPSHOT_KEY = 'cannonmap.snapshots.v1';
const DB_NAME = 'CannonMapDB';
const DB_STORE = 'projects';
const PROHIBITED_FEATURE_NAMES = new Set(['old coast road']);
const CHECKPOINT_STATUSES = new Set(['planned','next','completed','deferred','skipped','unreachable']);

const COLORS = {
  track: '#f97316', route: '#38bdf8', waypoint: '#facc15', checkpoint: '#22c55e',
  fuel: '#a78bfa', hotel: '#fb7185', backbone: '#94a3b8', competitor: '#ef4444', traffic: '#facc15', weather: '#38bdf8'
};

const state = {
  map: null, baseLayers: {}, featureGroup: null, competitorGroup: null, trafficGroup: null, weatherGroup: null,
  gpsLayer: null, gpsAccuracyLayer: null, gpsWatchId: null, lastGpsPosition: null,
  arrivalCandidateId:null, arrivalEnteredAt:0,
  pendingLayer: null, pendingImport: null, selectedId: null, editingLayer: null, history: [],
  rallyPollTimer: null, rallySync: { running:false, lastSync:null, lastError:'', pointsAdded:0 },
  weatherData: null, weatherPoint: null, trafficIncidents: [],
  radarLayer: null, radarNextLayer: null, radarFrames: [], radarFrameIndex: -1, radarTimer: null, radarLoadTimer: null, radarPlaying:false, radarAnimationToken:0,
  hotelBailoutActive:false,
  project: {
    version: APP_VERSION, name: 'America 250 – 2026', createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), features: [], competitors: []
  },
  settings: {
    dayFilter: 'all', inreachUrl: '', baseLayer: 'Streets', lineOpacity:90,
    typeVisibility:{track:true,route:true,backbone:true,waypoint:true,checkpoint:true,fuel:true,hotel:true},
    leaderboardUrl:'https://gpscheckpoints.com/admin/leaderboard.html?id_event=15', rallyEndpointUrl:'', rallyEventId:'15', rallyPollSeconds:30,
    showCompetitorTrails:true, showCompetitorMarkers:true, competitorFreshMinutes:15,
    trafficProvider:'none', tomtomApiKey:'', wazeFeedUrl:'', radarOpacity:65, radarCoverage:'active-day', routeWeatherSpeed:45,
    usableFuelCapacity:0,expectedPavedRange:0,expectedMixedRange:0,reserveDistance:25,fuelProfile:'mixed'
  }
};

const $ = id => document.getElementById(id);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const deepClean = obj => JSON.parse(JSON.stringify(obj, (key, value) => key === '_layer' ? undefined : value));
const normalizedFeatureName = value => String(value||'').trim().replace(/\s+/g,' ').toLowerCase();
function isProhibitedFeature(value){return PROHIBITED_FEATURE_NAMES.has(normalizedFeatureName(value?.name||value?.title||value?.label));}
function filterProhibitedFeatures(features,source='event import'){
  const kept=[];
  for(const feature of Array.isArray(features)?features:[]){
    if(isProhibitedFeature(feature)){console.warn(`[CannonMap] Removed prohibited feature from ${source}: ${feature.name||feature.title||feature.label}`);continue;}
    kept.push(feature);
  }
  return kept;
}
function normalizeCheckpoint(feature,index=0){
  if(feature?.type!=='checkpoint')return feature;
  feature.extreme=feature.extreme===true||/\bextreme\b/i.test(`${feature.name||''} ${feature.notes||''}`);
  feature.points=Number.isFinite(Number(feature.points))?Number(feature.points):(feature.extreme?21:10);
  feature.status=CHECKPOINT_STATUSES.has(feature.status)?feature.status:'planned';
  feature.sequence=Number.isFinite(Number(feature.sequence))?Number(feature.sequence):(Number(feature.sourceOrder)||index)+1;
  for(const key of ['completedAt','deferredAt','deferReason','restoredAt'])feature[key]=feature[key]??null;
  return feature;
}
function rallyCheckpointNumber(value){const match=String(value||'').trim().match(/^(?:day\s*)?([1-8])\s*[.\-_]\s*(\d{1,3})\b/i);return match?{day:Number(match[1]),sequence:Number(match[2])}:null;}
function sanitizeProjectData(project,source='project import'){
  const safe=project&&typeof project==='object'?project:{};
  safe.features=filterProhibitedFeatures(safe.features,source).map((feature,index)=>{const numbered=feature?.geometry?.kind==='point'&&feature.type==='waypoint'?rallyCheckpointNumber(feature.name):null;if(numbered){feature.type='checkpoint';feature.day=Number(feature.day)||numbered.day;feature.sequence=Number(feature.sequence)||numbered.sequence;console.info(`[CannonMap] Recognized numbered rally checkpoint: ${feature.name}`);}return normalizeCheckpoint(feature,index);});
  safe.competitors=Array.isArray(safe.competitors)?safe.competitors:[];
  return safe;
}
function sanitizeEventPayload(payload,source='event JSON'){
  if(Array.isArray(payload))return filterProhibitedFeatures(payload,source).map(item=>sanitizeEventPayload(item,source));
  if(!payload||typeof payload!=='object')return payload;
  const copy={...payload};
  for(const key of ['features','checkpoints','routes','tracks','waypoints'])if(Array.isArray(copy[key]))copy[key]=filterProhibitedFeatures(copy[key],source).map(item=>sanitizeEventPayload(item,source));
  if(Array.isArray(copy.competitors))copy.competitors=filterProhibitedFeatures(copy.competitors,source);
  return copy;
}

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
  state.hotelBailoutActive=false;
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
  state.featureGroup = L.featureGroup().addTo(state.map);
  state.competitorGroup = L.featureGroup().addTo(state.map);
  state.trafficGroup = L.featureGroup().addTo(state.map);
  state.weatherGroup = L.featureGroup().addTo(state.map);
  L.control.layers(layers, {
    'Competitor trails': state.competitorGroup,
    'Traffic incidents': state.trafficGroup,
    'Weather': state.weatherGroup
  }, { position:'topright', collapsed:true }).addTo(state.map);
  state.map.on('baselayerchange', e => { state.settings.baseLayer = e.name; saveProject(false); });
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
  const isBackbone = feature.type === 'backbone';
  return {
    color, fillColor:color, weight:feature.type === 'route' ? 5 : isBackbone ? 3 : 4,
    opacity:isBackbone ? Math.min(.65,(state.settings.lineOpacity||90)/100) : (state.settings.lineOpacity||90)/100,
    fillOpacity:.9, dashArray:isBackbone ? '10 8' : null
  };
}
function markerIcon(feature) {
  const color = COLORS[feature.type] || COLORS.waypoint;
  const label = feature.type === 'fuel' ? 'F' : feature.type === 'hotel' ? 'H' : feature.type === 'checkpoint' ? String(Number(feature.sequence)||'C') : '•';
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
    if (!feature.visible || !featureMatchesDay(feature) || state.settings.typeVisibility?.[feature.type]===false || (matchMedia('(max-width:900px)').matches&&state.settings.hideCompletedCheckpoints!==false&&feature.type==='checkpoint'&&feature.status==='completed')) return;
    const layer = createLeafletLayer(feature);
    state.featureGroup.addLayer(layer);
    feature._layer = layer;
  });
  renderCompetitors();
}
function pointTimestamp(point) {
  const value = point?.time || point?.timestamp || '';
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}
function competitorFreshness(comp) {
  const last = comp.points?.at(-1);
  const time = pointTimestamp(last);
  if (!time) return { fresh:false, ageMinutes:null };
  const ageMinutes = Math.max(0,(Date.now()-time)/60000);
  return { fresh:ageMinutes <= Number(state.settings.competitorFreshMinutes||15), ageMinutes };
}
function renderCompetitors() {
  state.competitorGroup?.clearLayers();
  state.project.competitors.forEach(comp => {
    if (!Array.isArray(comp.points) || !comp.points.length) return;
    const freshness = competitorFreshness(comp);
    const opacity = freshness.fresh ? .88 : .28;
    const points = comp.points.filter(validPoint);
    if (state.settings.showCompetitorTrails !== false && points.length > 1) {
      const line = L.polyline(points.map(p => [p.lat,p.lon]), {color:COLORS.competitor,weight:freshness.fresh?4:3,dashArray:freshness.fresh?null:'7 7',opacity});
      line.bindTooltip(`${comp.name || comp.id} · ${freshness.ageMinutes===null?'unknown age':`${Math.round(freshness.ageMinutes)} min old`}`);
      state.competitorGroup.addLayer(line);
    }
    if (state.settings.showCompetitorMarkers !== false) {
      const last = points.at(-1);
      const marker = L.circleMarker([last.lat,last.lon], {radius:freshness.fresh?7:5,color:'#fff',weight:2,fillColor:COLORS.competitor,fillOpacity:opacity});
      marker.bindPopup(`<strong>${escapeHtml(comp.name || comp.id)}</strong><br>${escapeHtml(last.time || 'Time unavailable')}<br>${freshness.fresh?'Fresh':'Stale or undated'} trail`);
      state.competitorGroup.addLayer(marker);
    }
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
function planningMileage(features) {
  const lines = features.filter(f => f.geometry?.kind==='line' && f.type !== 'backbone');
  return lines.reduce((miles,line,index)=>{
    if(line.type==='route'){
      const duplicate=lines.some((candidate,candidateIndex)=>candidateIndex!==index&&candidate.type==='track'&&String(candidate.day||0)===String(line.day||0)&&lineGeometriesMatch(line.geometry.coordinates,candidate.geometry.coordinates));
      if(duplicate)return miles;
    }
    return miles+lineDistanceMiles(line.geometry.coordinates);
  },0);
}
function renderStats() {
  const visible = state.project.features.filter(featureMatchesDay);
  $('trackCount').textContent = visible.filter(f => f.type==='track').length;
  $('routeCount').textContent = visible.filter(f => f.type==='route').length;
  $('waypointCount').textContent = visible.filter(f => ['waypoint','checkpoint','fuel','hotel'].includes(f.type)).length;
  $('distanceTotal').textContent = `${planningMileage(visible).toFixed(1)} mi`;
}
function renderAll() {
  $('projectName').value=state.project.name; $('dayFilter').value=state.settings.dayFilter;
  const fields={
    inreachUrl:'inreachUrl', leaderboardUrl:'leaderboardUrl', rallyEndpointUrl:'rallyEndpointUrl', rallyEventId:'rallyEventId',
    rallyPollSeconds:'rallyPollSeconds', competitorFreshMinutes:'competitorFreshMinutes', trafficProvider:'trafficProvider',
    tomtomApiKey:'tomtomApiKey', wazeFeedUrl:'wazeFeedUrl'
  };
  Object.entries(fields).forEach(([key,id])=>{if($(id))$(id).value=state.settings[key]??'';});
  if($('showCompetitorTrails'))$('showCompetitorTrails').checked=state.settings.showCompetitorTrails!==false;
  if($('showCompetitorMarkers'))$('showCompetitorMarkers').checked=state.settings.showCompetitorMarkers!==false;
  renderMapFeatures(); renderLayerList(); renderStats(); renderCompetitorSummary(); renderMissionControl(); renderTypeLayerControls(); renderSearch(); renderIntelSummary(); renderRallyMode();
  if(typeof renderPlannerRouteBuilder==='function')renderPlannerRouteBuilder();
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
function pointToLineMiles(point,line){
  let best=Infinity;
  for(let i=1;i<line.length;i++)best=Math.min(best,distancePointToSegmentMiles(point,line[i-1],line[i]));
  return best;
}
function evenlySampleLine(points,count=24){
  if(points.length<=2)return points.slice();
  const cumulative=[0];for(let i=1;i<points.length;i++)cumulative.push(cumulative.at(-1)+haversine(points[i-1],points[i]));
  const total=cumulative.at(-1);if(!total)return [points[0]];
  const samples=[];
  for(let s=0;s<count;s++){
    const target=total*s/(count-1);let i=1;while(i<cumulative.length&&cumulative[i]<target)i++;
    if(i>=points.length){samples.push(points.at(-1));continue;}
    const span=cumulative[i]-cumulative[i-1]||1,t=(target-cumulative[i-1])/span;
    samples.push({lat:points[i-1].lat+(points[i].lat-points[i-1].lat)*t,lon:points[i-1].lon+(points[i].lon-points[i-1].lon)*t});
  }
  return samples;
}
function lineGeometriesMatch(a,b){
  if(!Array.isArray(a)||!Array.isArray(b)||a.length<2||b.length<2)return false;
  const aMiles=lineDistanceMiles(a),bMiles=lineDistanceMiles(b);
  if(Math.abs(aMiles-bMiles)>Math.max(.25,Math.max(aMiles,bMiles)*.03))return false;
  const direct=haversine(a[0],b[0])+haversine(a.at(-1),b.at(-1));
  const reversed=haversine(a[0],b.at(-1))+haversine(a.at(-1),b[0]);
  if(Math.min(direct,reversed)/1609.344>.3)return false;
  const distances=[...evenlySampleLine(a).map(p=>pointToLineMiles(p,b)),...evenlySampleLine(b).map(p=>pointToLineMiles(p,a))];
  return Math.max(...distances)<=.12&&distances.reduce((sum,d)=>sum+d,0)/distances.length<=.04;
}

function openDatabase() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(DB_STORE))db.createObjectStore(DB_STORE);};
    request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error||new Error('IndexedDB could not be opened.'));
  });
}
async function saveProject(showMessage=true) {
  try {
    sanitizeProjectData(state.project,'save boundary');
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
    if(saved)state.project=sanitizeProjectData(saved,'local project restore');
  } catch(_){}
  try {
    const raw = localStorage.getItem(SETTINGS_KEY) || localStorage.getItem('cannonmap.settings.v5') || localStorage.getItem('cannonmap.settings.v4') || localStorage.getItem('cannonmap.settings.v3') || '{}';
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
function textOf(element,tag){const node=element.getElementsByTagName(tag)[0]||element.getElementsByTagNameNS?.('*',tag)?.[0];return node?node.textContent.trim():'';}
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
  if(rallyCheckpointNumber(name))return 'checkpoint';
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
    if(coordinates.length)features.push({id:uid(),name,type:'route',day:Number(textOf(rte,'day'))||inferDay(`${name} ${notes} ${filename}`),assignmentMethod:'',notes,visible:true,source:filename,sourceOrder:sourceOrder++,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),geometry:{kind:'line',coordinates},planRole:textOf(rte,'planRole')||'',alternativeName:textOf(rte,'alternative')||'',pairId:textOf(rte,'pairId')||'',exportEnabled:textOf(rte,'exportEnabled')!=='false'});
  });
  [...doc.getElementsByTagName('trk')].forEach((trk,index)=>{
    const baseName=textOf(trk,'name')||`${filename} track ${index+1}`,notes=textOf(trk,'desc')||textOf(trk,'cmt');
    const segments=[...trk.getElementsByTagName('trkseg')];
    segments.forEach((segment,segIndex)=>{
      const coordinates=[...segment.getElementsByTagName('trkpt')].map(p=>({lat:Number(p.getAttribute('lat')),lon:Number(p.getAttribute('lon'))})).filter(validPoint);
      if(coordinates.length)features.push({id:uid(),name:segments.length>1?`${baseName} segment ${segIndex+1}`:baseName,type:'track',day:Number(textOf(trk,'day'))||inferDay(`${baseName} ${notes} ${filename}`),assignmentMethod:'',notes,visible:true,source:filename,sourceOrder:sourceOrder++,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),geometry:{kind:'line',coordinates},planRole:textOf(trk,'planRole')||'',alternativeName:textOf(trk,'alternative')||'',pairId:textOf(trk,'pairId')||'',exportEnabled:textOf(trk,'exportEnabled')!=='false'});
    });
  });
  [...doc.getElementsByTagName('wpt')].forEach((wpt,index)=>{
    const name=textOf(wpt,'name')||`${filename} waypoint ${index+1}`;
    const notes=textOf(wpt,'desc')||textOf(wpt,'cmt');
    const sym=textOf(wpt,'sym');
    const p={lat:Number(wpt.getAttribute('lat')),lon:Number(wpt.getAttribute('lon'))};
    if(validPoint(p)){
      const type=classifyPoint(name,notes,sym);
      const read=tag=>textOf(wpt,tag);
      const feature={id:uid(),name,type,day:Number(read('day'))||inferDay(`${name} ${notes} ${filename}`),assignmentMethod:'',notes,visible:true,source:filename,sourceOrder:sourceOrder++,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),geometry:{kind:'point',coordinates:[p]},planIncluded:read('planned')?read('planned')!=='false':undefined,planOrder:read('planOrder')?Number(read('planOrder')):undefined,plannerRole:read('plannerRole')||''};
      if(type==='checkpoint')Object.assign(feature,{status:read('status')||'planned',points:read('points')?Number(read('points')):undefined,extreme:/^(true|1|yes)$/i.test(read('extreme')),sequence:read('sequence')?Number(read('sequence')):undefined,completedAt:read('completedAt')||null,deferredAt:read('deferredAt')||null,deferReason:read('deferReason')||null,restoredAt:read('restoredAt')||null});
      features.push(feature);
    }
  });
  const safeFeatures=filterProhibitedFeatures(features,`GPX ${filename}`).map((feature,index)=>normalizeCheckpoint(feature,index));
  const auto=assignWaypointDays(safeFeatures,true);
  return {features:safeFeatures,auto};
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
    state.project.features=filterProhibitedFeatures(pending.features,'GPX replace').map((feature,index)=>normalizeCheckpoint(feature,index));
    added=pending.features.length;
  } else if(mode==='add'){
    state.project.features.push(...filterProhibitedFeatures(pending.features,'GPX add').map((feature,index)=>normalizeCheckpoint(feature,index)));
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
        if(!isProhibitedFeature(incoming)){state.project.features.push(normalizeCheckpoint(incoming,state.project.features.length));added++;}
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
    settings:safeExportSettings()
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
    state.project=sanitizeProjectData(project,`.cmap ${file.name}`);
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
function restoreSnapshot(id){const item=getSnapshots().find(x=>x.id===id);if(!item)return;snapshot();state.project=sanitizeProjectData(item.project,'restored snapshot');if(item.settings)Object.assign(state.settings,item.settings);saveProject(false);clearSelection();renderAll();fitMap();setStatus(`Restored snapshot from ${new Date(item.createdAt).toLocaleString()}.`);}
function deleteSnapshot(id){writeSnapshots(getSnapshots().filter(x=>x.id!==id));renderSnapshots();}
function renderSnapshots(){const box=$('snapshotList');if(!box)return;const items=getSnapshots();if(!items.length){box.className='snapshot-list empty';box.textContent='No snapshots yet.';return;}box.className='snapshot-list';box.innerHTML=items.map(x=>`<div class="snapshot-row"><div><strong>${escapeHtml(x.label)}</strong><small>${new Date(x.createdAt).toLocaleString()} · ${x.project.features?.length||0} features</small></div><button class="button secondary" data-restore="${x.id}">Restore</button><button class="button danger-outline" data-drop="${x.id}">×</button></div>`).join('');box.querySelectorAll('[data-restore]').forEach(b=>b.onclick=()=>restoreSnapshot(b.dataset.restore));box.querySelectorAll('[data-drop]').forEach(b=>b.onclick=()=>deleteSnapshot(b.dataset.drop));}
function renderMissionControl(){
  const fs=state.project.features,miles=planningMileage(fs);
  $('missionProjectName').textContent=state.project.name;$('missionUpdated').textContent=`Updated ${new Date(state.project.updatedAt||Date.now()).toLocaleString()}`;
  $('missionFeatureCount').textContent=fs.length;$('missionCheckpointCount').textContent=fs.filter(f=>f.type==='checkpoint').length;$('missionFuelCount').textContent=fs.filter(f=>f.type==='fuel').length;$('missionHotelCount').textContent=fs.filter(f=>f.type==='hotel').length;$('missionUnassignedCount').textContent=fs.filter(f=>!f.day).length;$('missionMileage').textContent=`${miles.toFixed(1)} mi`;
  $('dailyReadiness').innerHTML=[1,2,3,4,5,6,7,8].map(day=>{const rows=fs.filter(f=>f.day===day),cp=rows.filter(f=>f.type==='checkpoint').length,fuel=rows.filter(f=>f.type==='fuel').length,hotel=rows.filter(f=>f.type==='hotel').length,dm=planningMileage(rows),score=Math.min(100,(rows.length?40:0)+(cp?25:0)+(fuel?15:0)+(hotel?20:0));return `<div class="day-card" data-day-card="${day}"><header><strong>Day ${day}</strong><span>${dm.toFixed(0)} mi</span></header><small>${cp} checkpoints · ${fuel} fuel · ${hotel} hotel · ${rows.length} features</small><div class="day-meter"><i style="width:${score}%"></i></div></div>`}).join('');
  $('dailyReadiness').querySelectorAll('[data-day-card]').forEach(c=>c.onclick=()=>{state.settings.dayFilter=c.dataset.dayCard;$('dayFilter').value=state.settings.dayFilter;document.querySelector('[data-tab="project"]').click();saveProject(false);renderAll();});renderSnapshots();
}
function renderTypeLayerControls(){const box=$('typeLayerControls');if(!box)return;const labels={track:'Tracks',route:'Routes',backbone:'Backbone',waypoint:'Waypoints',checkpoint:'Checkpoints',fuel:'Fuel',hotel:'Hotels'};box.innerHTML=Object.entries(labels).map(([type,label])=>`<label class="type-toggle"><input type="checkbox" data-type-visible="${type}" ${state.settings.typeVisibility?.[type]!==false?'checked':''}><span class="swatch" style="background:${COLORS[type]}"></span>${label}</label>`).join('');box.querySelectorAll('[data-type-visible]').forEach(input=>input.onchange=()=>{state.settings.typeVisibility[input.dataset.typeVisible]=input.checked;saveProject(false);renderMapFeatures();});$('lineOpacity').value=state.settings.lineOpacity||90;}
function renderSearch(){const box=$('searchResults');if(!box)return;const q=$('globalSearch').value.trim().toLowerCase(),type=$('searchType').value,day=$('searchDay').value;let rows=state.project.features.filter(f=>(type==='all'||f.type===type)&&(day==='all'||String(f.day||0)===day));if(q)rows=rows.filter(f=>`${f.name} ${f.notes||''} ${f.source||''}`.toLowerCase().includes(q));rows=rows.slice(0,100);if(!q&&type==='all'&&day==='all'){box.className='search-results empty';box.textContent='Enter a search term or choose filters.';return;}if(!rows.length){box.className='search-results empty';box.textContent='No matching features.';return;}box.className='search-results';box.innerHTML=rows.map(f=>`<button class="search-result" data-search-id="${f.id}"><strong>${f.favorite?'<span class="favorite-star">★</span> ':''}${escapeHtml(f.name)}</strong><small>${f.type} · ${f.day?`Day ${f.day}`:'Unassigned'}${f.notes?` · ${escapeHtml(f.notes.slice(0,90))}`:''}</small></button>`).join('');box.querySelectorAll('[data-search-id]').forEach(b=>b.onclick=()=>{selectFeature(b.dataset.searchId);zoomSelected();document.querySelector('[data-tab="features"]').click();});}
function openContextMenu(id,x,y){state.selectedId=id;const menu=$('contextMenu');menu.hidden=false;menu.style.left=`${Math.min(x,window.innerWidth-190)}px`;menu.style.top=`${Math.min(y,window.innerHeight-260)}px`;}
function closeContextMenu(){$('contextMenu').hidden=true;}
function reverseSelected(){const f=state.project.features.find(x=>x.id===state.selectedId);if(!f||f.geometry.kind!=='line')return setStatus('Only routes and tracks can be reversed.');snapshot();f.geometry.coordinates.reverse();f.updatedAt=new Date().toISOString();saveProject(false);renderAll();selectFeature(f.id);setStatus(`Reversed ${f.name}.`);}
function toggleFavorite(){const f=state.project.features.find(x=>x.id===state.selectedId);if(!f)return;snapshot();f.favorite=!f.favorite;saveProject(false);renderAll();setStatus(`${f.favorite?'Favorited':'Removed favorite from'} ${f.name}.`);}
function clearSelection() {
  stopEditing();
  state.selectedId=null; $('selectedFeatureId').value='';
  ['featureName','featureType','featureDay','featureNotes','featureLatitude','featureLongitude','featurePlannerRole','featureAlternativeName','featurePlanIncluded'].forEach(id=>$(id).disabled=true);
  ['updateFeatureButton','zoomFeatureButton','duplicateFeatureButton','deleteFeatureButton','editGeometryButton','stopEditButton'].forEach(id=>$(id).disabled=true);
}
function populateFeatureForm(feature) {
  $('selectedFeatureId').value=feature.id;$('featureName').value=feature.name;$('featureType').value=feature.type;
  $('featureDay').value=String(feature.day||0);$('featureNotes').value=feature.notes||'';
  $('featurePlannerRole').value=feature.plannerRole||feature.planRole||'';$('featureAlternativeName').value=feature.alternativeName||'';$('featurePlanIncluded').checked=feature.planIncluded!==false;
  const isPoint=feature.geometry.kind==='point';
  $('pointCoordinates').classList.toggle('hidden',!isPoint);
  if(isPoint){$('featureLatitude').value=feature.geometry.coordinates[0].lat.toFixed(6);$('featureLongitude').value=feature.geometry.coordinates[0].lon.toFixed(6);}
  ['featureName','featureType','featureDay','featureNotes','featurePlannerRole','featureAlternativeName','featurePlanIncluded'].forEach(id=>$(id).disabled=false);
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
  feature.name=$('featureName').value.trim()||feature.name;feature.type=$('featureType').value;feature.day=Number($('featureDay').value);feature.notes=$('featureNotes').value.trim();feature.planIncluded=$('featurePlanIncluded').checked;feature.alternativeName=$('featureAlternativeName').value.trim();
  const plannerRole=$('featurePlannerRole').value;if(feature.geometry.kind==='line'){feature.planRole=plannerRole==='primary'||plannerRole==='alternative'?plannerRole:(feature.planRole||'');feature.primaryForDay=feature.planRole==='primary';feature.plannerRole='';}else{feature.plannerRole=plannerRole==='start'||plannerRole==='finish'?plannerRole:'';}
  if(feature.geometry.kind==='point'){
    const lat=Number($('featureLatitude').value),lon=Number($('featureLongitude').value);
    if(validPoint({lat,lon}))feature.geometry.coordinates=[{lat,lon}];
  }
  normalizeCheckpoint(feature,state.project.features.indexOf(feature));feature.updatedAt=new Date().toISOString();saveProject(false);renderAll();selectFeature(feature.id);setStatus(`Updated ${feature.name}.`);
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
  const w=fs.filter(f=>f.geometry.kind==='point').map(f=>{const p=f.geometry.coordinates[0];const extensions=f.type==='checkpoint'?`<extensions><cannonmap:status>${xmlEscape(f.status||'planned')}</cannonmap:status><cannonmap:points>${Number(f.points)||10}</cannonmap:points><cannonmap:extreme>${f.extreme?'true':'false'}</cannonmap:extreme><cannonmap:sequence>${Number(f.sequence)||0}</cannonmap:sequence>${f.completedAt?`<cannonmap:completedAt>${xmlEscape(f.completedAt)}</cannonmap:completedAt>`:''}${f.deferredAt?`<cannonmap:deferredAt>${xmlEscape(f.deferredAt)}</cannonmap:deferredAt>`:''}${f.deferReason?`<cannonmap:deferReason>${xmlEscape(f.deferReason)}</cannonmap:deferReason>`:''}${f.restoredAt?`<cannonmap:restoredAt>${xmlEscape(f.restoredAt)}</cannonmap:restoredAt>`:''}</extensions>`:'';return `  <wpt lat="${p.lat.toFixed(8)}" lon="${p.lon.toFixed(8)}"><name>${xmlEscape(f.name)}</name><desc>${xmlEscape(f.notes||'')}</desc><type>${xmlEscape(f.type)}</type>${extensions}</wpt>`;}).join('\n');
  const r=fs.filter(f=>f.type==='route'&&f.geometry.kind==='line').map(f=>`  <rte><name>${xmlEscape(f.name)}</name><desc>${xmlEscape(f.notes||'')}</desc>\n${f.geometry.coordinates.map(p=>`    <rtept lat="${p.lat.toFixed(8)}" lon="${p.lon.toFixed(8)}" />`).join('\n')}\n  </rte>`).join('\n');
  const t=fs.filter(f=>f.type!=='route'&&f.geometry.kind==='line').map(f=>`  <trk><name>${xmlEscape(f.name)}</name><desc>${xmlEscape(f.notes||'')}</desc><trkseg>\n${f.geometry.coordinates.map(p=>`    <trkpt lat="${p.lat.toFixed(8)}" lon="${p.lon.toFixed(8)}" />`).join('\n')}\n  </trkseg></trk>`).join('\n');
  const xml=`<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="CannonMap ${APP_VERSION}" xmlns="http://www.topografix.com/GPX/1/1" xmlns:cannonmap="https://cannonmap.pages.dev/schema/1">\n<metadata><name>${xmlEscape(state.project.name)}</name><time>${new Date().toISOString()}</time></metadata>\n${w}\n${r}\n${t}\n</gpx>`;
  downloadBlob(xml,`${safeFilename(state.project.name)}${state.settings.dayFilter==='all'?'':`-day-${state.settings.dayFilter}`}.gpx`,'application/gpx+xml');setStatus(`Exported ${fs.length} features to GPX.`);
}
function manifestRows() {
  const fs=state.project.features.filter(featureMatchesDay);
  const typeOrder={checkpoint:1,fuel:2,hotel:3,waypoint:4,route:5,track:6,backbone:7};
  return fs.map((f,index)=>{
    const p=f.geometry.coordinates[0]||{},distance=f.geometry.kind==='line'?lineDistanceMiles(f.geometry.coordinates):0;
    return {
      Day:f.day||'Unassigned', Sequence:f.sequence||index+1, Name:f.name, Type:f.type,
      Latitude:Number.isFinite(p.lat)?p.lat:'', Longitude:Number.isFinite(p.lon)?p.lon:'',
      'Point Count':f.geometry.coordinates.length, 'Distance (mi)':Number(distance.toFixed(2)),
      Status:f.type==='checkpoint'?(f.status||'planned'):'', Points:f.type==='checkpoint'?(Number(f.points)||(f.extreme?21:10)):'', Extreme:f.type==='checkpoint'?(f.extreme?'Yes':'No'):'',
      'Completed At':f.completedAt||'', 'Deferred At':f.deferredAt||'', 'Defer Reason':f.deferReason||'', 'Restored At':f.restoredAt||'', Notes:f.notes||'', 'Source GPX':f.source||'', Visible:f.visible?'Yes':'No',
      'Assignment Method':f.assignmentMethod||'', 'Updated At':f.updatedAt||'', 'Planned':f.planIncluded===false?'No':'Yes', 'Plan Order':f.planOrder||'', 'Plan Role':f.planRole||'', 'Alternative':f.alternativeName||'', 'Pair ID':f.pairId||''
    };
  }).sort((a,b)=>(Number(a.Day)||99)-(Number(b.Day)||99)||(typeOrder[a.Type]||99)-(typeOrder[b.Type]||99)||a.Sequence-b.Sequence);
}
function exportExcel() {
  if(typeof XLSX==='undefined')return setStatus('Excel library did not load. Check the internet connection and reload.',true);
  const manifest=manifestRows(),wb=XLSX.utils.book_new();
  const add=(name,rows)=>{const ws=XLSX.utils.json_to_sheet(rows.length?rows:[{Message:'No records'}]);ws['!autofilter']={ref:ws['!ref']};ws['!freeze']={xSplit:0,ySplit:1};ws['!cols']=[18,10,34,14,14,14,12,14,12,45,28,10,20,24].map(w=>({wch:w}));XLSX.utils.book_append_sheet(wb,ws,name);};
  add('Master Manifest',manifest);
  add('Daily Summary',[1,2,3,4,5,6,7,8].map(day=>{const rows=manifest.filter(r=>r.Day===day);return {Day:day,Features:rows.length,Checkpoints:rows.filter(r=>r.Type==='checkpoint').length,Routes:rows.filter(r=>r.Type==='route').length,Tracks:rows.filter(r=>r.Type==='track').length,'Line Miles':Number(rows.reduce((s,r)=>s+(Number(r['Distance (mi)'])||0),0).toFixed(2))};}));
  for(const [sheet,type] of [['Checkpoints','checkpoint'],['Routes','route'],['Tracks','track'],['Backbone','backbone'],['Fuel Stops','fuel'],['Hotels','hotel'],['Waypoints','waypoint']])add(sheet,manifest.filter(r=>r.Type===type));
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
    const ll=[position.coords.latitude,position.coords.longitude],accuracyFeet=position.coords.accuracy*3.28084;state.lastGpsPosition={lat:ll[0],lon:ll[1],accuracyFeet,time:new Date(position.timestamp||Date.now()).toISOString()};state.gpsLayer?.remove();state.gpsAccuracyLayer?.remove();
    state.gpsAccuracyLayer=L.circle(ll,{radius:position.coords.accuracy,color:'#38bdf8',weight:1,fillOpacity:.08}).addTo(state.map);
    state.gpsLayer=L.circleMarker(ll,{radius:8,color:'#fff',weight:3,fillColor:'#38bdf8',fillOpacity:1}).addTo(state.map);
    $('gpsStatus').textContent=`GPS ±${Math.round(accuracyFeet)} ft`;ensureNextCheckpoint();evaluateCheckpointArrival(accuracyFeet);renderRallyMode();
  },error=>setStatus(`GPS error: ${error.message}`,true),{enableHighAccuracy:true,maximumAge:2000,timeout:15000});
  $('gpsButton').textContent='Stop GPS';
}
async function importCompetitorJson(file) {
  try {
    const data=sanitizeEventPayload(JSON.parse(await file.text()),`competitor/event JSON ${file.name}`),entries=Array.isArray(data)?data:data.competitors;
    if(!Array.isArray(entries))throw new Error('Expected an array or a competitors array.');
    snapshot();state.project.competitors=normalizeCompetitorPayload(data);
    saveProject(false);renderAll();fitIntelligence();setStatus(`Imported ${state.project.competitors.length} competitor trails.`);
  } catch(error){setStatus(`Competitor import failed: ${error.message}`,true);}
}
function renderCompetitorSummary() {
  const box=$('competitorSummary');if(!state.project.competitors.length){box.className='layer-list empty';box.textContent='No competitor data loaded.';return;}
  box.className='layer-list';box.innerHTML=state.project.competitors.map(c=>{const fresh=competitorFreshness(c);const age=fresh.ageMinutes===null?'undated':`${Math.round(fresh.ageMinutes)} min`;return `<div class="layer-row"><span class="swatch" style="background:${fresh.fresh?COLORS.competitor:'#64748b'}"></span><button type="button" data-rider-id="${escapeHtml(c.id)}"><strong>${escapeHtml(c.name)}</strong><small>${c.points.length} breadcrumbs · ${age}</small></button><span class="fresh-dot ${fresh.fresh?'is-fresh':''}" title="${fresh.fresh?'Fresh':'Stale'}"></span></div>`}).join('');
  box.querySelectorAll('[data-rider-id]').forEach(button=>button.onclick=()=>zoomCompetitor(button.dataset.riderId));
}

function safeExportSettings() {
  const settings=deepClean(state.settings);
  delete settings.tomtomApiKey;
  return settings;
}
function formatAge(minutes) {
  if(minutes===null || !Number.isFinite(minutes))return 'Unknown';
  if(minutes<1)return '<1 min';
  if(minutes<60)return `${Math.round(minutes)} min`;
  return `${Math.floor(minutes/60)}h ${Math.round(minutes%60)}m`;
}
function formatClock(value) {
  if(!value)return 'Never';
  const date=new Date(value);
  return Number.isNaN(date.getTime())?'Never':date.toLocaleTimeString([],{hour:'numeric',minute:'2-digit',second:'2-digit'});
}
function getNestedCandidates(payload) {
  if(Array.isArray(payload))return payload;
  if(!payload || typeof payload!=='object')return [];
  const candidates=[payload.competitors,payload.riders,payload.positions,payload.locations,payload.features,payload.data?.competitors,payload.data?.riders,payload.data?.positions,payload.data?.locations,payload.data,payload.results,payload.items];
  return candidates.find(Array.isArray)||[];
}
function normalizeFeedPoint(source) {
  if(!source || typeof source!=='object')return null;
  const nested=source.location||source.position||source.coords||source.coordinate||source.lastPosition||source.last_location||source;
  let lat=Number(nested.lat??nested.latitude??nested.y??source.lat??source.latitude);
  let lon=Number(nested.lon??nested.lng??nested.longitude??nested.x??source.lon??source.lng??source.longitude);
  const geometry=source.geometry||nested.geometry;
  if((!Number.isFinite(lat)||!Number.isFinite(lon)) && geometry?.type==='Point' && Array.isArray(geometry.coordinates)){
    lon=Number(geometry.coordinates[0]);lat=Number(geometry.coordinates[1]);
  }
  const point={lat,lon,time:source.time||source.timestamp||source.recordedAt||source.updatedAt||source.lastUpdate||source.datetime||nested.time||nested.timestamp||''};
  return validPoint(point)?point:null;
}
function competitorIdentity(entry,index=0) {
  const props=entry?.properties||{};
  const competitor=entry?.competitor||entry?.rider||{};
  const id=entry?.id??entry?.competitorId??entry?.id_competitor??entry?.riderId??entry?.number??props.id??props.competitorId??competitor.id??competitor.number??`rider-${index+1}`;
  const name=entry?.name||entry?.riderName||entry?.competitorName||props.name||props.riderName||competitor.name||`Rider ${id}`;
  return {id:String(id),name:String(name)};
}
function normalizeCompetitorPayload(payload) {
  const entries=getNestedCandidates(payload);
  const grouped=new Map();
  entries.forEach((entry,index)=>{
    const identity=competitorIdentity(entry,index);
    if(!grouped.has(identity.id))grouped.set(identity.id,{...identity,points:[]});
    const target=grouped.get(identity.id);
    if(identity.name && !/^Rider rider-/.test(identity.name))target.name=identity.name;
    const sourcePoints=entry?.points||entry?.positions||entry?.locations||entry?.history||entry?.trail||entry?.breadcrumbs;
    if(Array.isArray(sourcePoints))sourcePoints.forEach(raw=>{const point=normalizeFeedPoint(raw);if(point)target.points.push(point);});
    else {const point=normalizeFeedPoint(entry);if(point)target.points.push(point);}
  });
  return [...grouped.values()].map(comp=>{
    const seen=new Set();
    comp.points=comp.points.filter(point=>{const key=`${point.lat.toFixed(6)}|${point.lon.toFixed(6)}|${point.time||''}`;if(seen.has(key))return false;seen.add(key);return true;}).sort((a,b)=>(pointTimestamp(a)||0)-(pointTimestamp(b)||0));
    return comp;
  }).filter(comp=>comp.points.length);
}
function mergeCompetitorData(incoming) {
  let added=0, riders=0;
  incoming.forEach(next=>{
    let current=state.project.competitors.find(comp=>String(comp.id)===String(next.id));
    if(!current){current={id:String(next.id),name:next.name||`Rider ${next.id}`,points:[]};state.project.competitors.push(current);riders++;}
    if(next.name)current.name=next.name;
    const keys=new Set(current.points.map(point=>`${point.lat.toFixed(6)}|${point.lon.toFixed(6)}|${point.time||''}`));
    next.points.forEach(point=>{const key=`${point.lat.toFixed(6)}|${point.lon.toFixed(6)}|${point.time||''}`;if(!keys.has(key)){current.points.push(point);keys.add(key);added++;}});
    current.points.sort((a,b)=>(pointTimestamp(a)||0)-(pointTimestamp(b)||0));
    if(current.points.length>10000)current.points=current.points.slice(-10000);
  });
  return {added,riders};
}
async function fetchWithTimeout(url,options={},timeout=15000) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  try{return await fetch(url,{...options,signal:controller.signal,cache:'no-store'});}finally{clearTimeout(timer);}
}
async function syncRallyFeed() {
  const endpoint=(state.settings.rallyEndpointUrl||'').trim();
  if(!endpoint){
    state.rallySync.lastError='Live endpoint not captured yet.';
    renderIntelSummary();
    setStatus('Live trail sync needs the JSON/location endpoint from a live leaderboard HAR capture.',true);
    return;
  }
  if(/leaderboard\.html|cmp_checkpoints\.html/i.test(endpoint)){
    state.rallySync.lastError='This is a web page, not the data endpoint.';renderIntelSummary();
    setStatus('Use the live JSON/location request from Developer Tools, not the leaderboard page URL.',true);return;
  }
  state.rallySync.running=true;state.rallySync.lastError='';renderIntelSummary();
  try{
    const response=await fetchWithTimeout(endpoint,{headers:{Accept:'application/json, text/plain;q=0.9, */*;q=0.5'}});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const text=await response.text();
    if(/^\s*</.test(text))throw new Error('Endpoint returned HTML instead of location JSON.');
    let payload;try{payload=JSON.parse(text);}catch(_){throw new Error('Endpoint did not return valid JSON.');}
    const incoming=normalizeCompetitorPayload(payload);
    if(!incoming.length)throw new Error('No competitor coordinates were recognized in the response.');
    const result=mergeCompetitorData(incoming);
    state.rallySync.lastSync=new Date().toISOString();state.rallySync.pointsAdded=result.added;state.rallySync.lastError='';
    await saveProject(false);renderMapFeatures();renderCompetitorSummary();renderIntelSummary();
    setStatus(`Trail sync complete: ${incoming.length} riders, ${result.added} new breadcrumbs.`);
  }catch(error){
    state.rallySync.lastError=error.name==='AbortError'?'Feed request timed out.':error.message;
    setStatus(`Trail sync failed: ${state.rallySync.lastError}`,true);renderIntelSummary();
  }finally{state.rallySync.running=false;renderIntelSummary();}
}
function stopRallyPolling() {
  if(state.rallyPollTimer){clearInterval(state.rallyPollTimer);state.rallyPollTimer=null;}
  if($('toggleRallyPollingButton'))$('toggleRallyPollingButton').textContent='Start live polling';
  renderIntelSummary();
}
async function toggleRallyPolling() {
  if(state.rallyPollTimer){stopRallyPolling();setStatus('Live trail polling stopped.');return;}
  if(!state.settings.rallyEndpointUrl)return syncRallyFeed();
  await syncRallyFeed();
  if(state.rallySync.lastError)return;
  const seconds=Math.max(10,Number(state.settings.rallyPollSeconds)||30);
  state.rallyPollTimer=setInterval(syncRallyFeed,seconds*1000);
  $('toggleRallyPollingButton').textContent='Stop live polling';
  setStatus(`Live trail polling started every ${seconds} seconds.`);renderIntelSummary();
}
function saveIntegrationSettings() {
  state.settings.inreachUrl=$('inreachUrl').value.trim();
  state.settings.leaderboardUrl=$('leaderboardUrl').value.trim();
  state.settings.rallyEndpointUrl=$('rallyEndpointUrl').value.trim();
  state.settings.rallyEventId=$('rallyEventId').value.trim();
  state.settings.rallyPollSeconds=Number($('rallyPollSeconds').value)||30;
  state.settings.competitorFreshMinutes=Number($('competitorFreshMinutes').value)||15;
  state.settings.showCompetitorTrails=$('showCompetitorTrails').checked;
  state.settings.showCompetitorMarkers=$('showCompetitorMarkers').checked;
  state.settings.trafficProvider=$('trafficProvider').value;
  state.settings.tomtomApiKey=$('tomtomApiKey').value.trim();
  state.settings.wazeFeedUrl=$('wazeFeedUrl').value.trim();
  saveProject(true);renderMapFeatures();renderIntelSummary();
}
function openLeaderboard() {
  const url=(state.settings.leaderboardUrl||$('leaderboardUrl').value||'').trim();
  if(!url)return setStatus('Enter the public leaderboard URL first.',true);
  window.open(url,'_blank','noopener,noreferrer');
}
function exportCompetitorData() {
  if(!state.project.competitors.length)return setStatus('No competitor trails to export.');
  const payload={format:'CannonMap Competitor Trails',appVersion:APP_VERSION,exportedAt:new Date().toISOString(),eventId:state.settings.rallyEventId||'',competitors:deepClean(state.project.competitors)};
  downloadBlob(JSON.stringify(payload,null,2),`${safeFilename(state.project.name)}-competitor-trails.json`,'application/json');
  setStatus(`Exported ${state.project.competitors.length} competitor trails.`);
}
function clearCompetitors() {
  if(!state.project.competitors.length)return;
  if(!confirm('Clear all captured competitor trails from this project?'))return;
  snapshot();state.project.competitors=[];stopRallyPolling();saveProject(false);renderAll();setStatus('Competitor trails cleared.');
}
function zoomCompetitor(id) {
  const comp=state.project.competitors.find(item=>String(item.id)===String(id));
  if(!comp?.points?.length)return;
  const bounds=L.latLngBounds(comp.points.map(point=>[point.lat,point.lon]));
  if(bounds.isValid())state.map.fitBounds(bounds,{padding:[35,35],maxZoom:14});
}
function fitIntelligence() {
  const groups=[state.competitorGroup,state.trafficGroup,state.weatherGroup].filter(Boolean);
  const bounds=L.latLngBounds([]);groups.forEach(group=>group.eachLayer(layer=>{if(layer.getBounds)bounds.extend(layer.getBounds());else if(layer.getLatLng)bounds.extend(layer.getLatLng());}));
  if(bounds.isValid())state.map.fitBounds(bounds,{padding:[30,30],maxZoom:14});
}
function clearIntelligenceLayers() {
  state.competitorGroup?.clearLayers();state.trafficGroup?.clearLayers();state.weatherGroup?.clearLayers();state.weatherData=null;state.weatherPoint=null;state.trafficIncidents=[];hideRadar();
}
function currentIntelPoint() {
  if(state.lastGpsPosition)return {lat:state.lastGpsPosition.lat,lon:state.lastGpsPosition.lon,label:'GPS position'};
  const selected=state.project.features.find(feature=>feature.id===state.selectedId&&feature.geometry?.kind==='point');
  if(selected){const point=selected.geometry.coordinates[0];return {...point,label:selected.name};}
  const center=state.map.getCenter();return {lat:center.lat,lon:center.lng,label:'Map center'};
}
const WEATHER_CODES={0:'Clear',1:'Mostly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Rime fog',51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',56:'Freezing drizzle',57:'Heavy freezing drizzle',61:'Light rain',63:'Rain',65:'Heavy rain',66:'Freezing rain',67:'Heavy freezing rain',71:'Light snow',73:'Snow',75:'Heavy snow',77:'Snow grains',80:'Rain showers',81:'Rain showers',82:'Heavy showers',85:'Snow showers',86:'Heavy snow showers',95:'Thunderstorm',96:'Thunderstorm with hail',99:'Severe thunderstorm with hail'};
async function loadWeatherHere() {
  const point=currentIntelPoint();
  $('weatherSummary').className='intel-card loading';$('weatherSummary').textContent='Loading weather…';
  try{
    const params=new URLSearchParams({latitude:point.lat.toFixed(5),longitude:point.lon.toFixed(5),current:'temperature_2m,apparent_temperature,precipitation,rain,weather_code,wind_speed_10m,wind_gusts_10m',hourly:'temperature_2m,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m',forecast_hours:'6',temperature_unit:'fahrenheit',wind_speed_unit:'mph',precipitation_unit:'inch',timezone:'auto'});
    const response=await fetchWithTimeout(`https://api.open-meteo.com/v1/forecast?${params}`);
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const data=await response.json();
    state.weatherData=data;state.weatherPoint=point;renderWeather();renderIntelSummary();setStatus(`Weather loaded for ${point.label}.`);
  }catch(error){$('weatherSummary').className='intel-card error';$('weatherSummary').textContent=`Weather failed: ${error.message}`;setStatus(`Weather failed: ${error.message}`,true);}
}
function renderWeather() {
  state.weatherGroup?.clearLayers();
  const data=state.weatherData,point=state.weatherPoint;if(!data||!point)return;
  const current=data.current||{};const hourly=data.hourly||{};
  const precip=Array.isArray(hourly.precipitation_probability)?Math.max(...hourly.precipitation_probability.filter(Number.isFinite),0):0;
  const gusts=weatherMaxGustMph(data);
  const condition=WEATHER_CODES[current.weather_code]||`Code ${current.weather_code??'—'}`;
  const warning=(current.weather_code>=95||precip>=60||gusts>=35);
  const html=`<strong>${Math.round(current.temperature_2m??0)}°F · ${escapeHtml(condition)}</strong><small>Feels ${Math.round(current.apparent_temperature??current.temperature_2m??0)}°F · Wind ${Math.round(current.wind_speed_10m??0)} mph · Gusts up to ${Math.round(gusts)} mph · Rain chance ${Math.round(precip)}%</small>${warning?'<em>Weather could affect the next decision.</em>':''}`;
  $('weatherSummary').className=`intel-card${warning?' warning':''}`;$('weatherSummary').innerHTML=html;
  const marker=L.circleMarker([point.lat,point.lon],{radius:9,color:'#fff',weight:2,fillColor:COLORS.weather,fillOpacity:.95});
  marker.bindPopup(`<strong>${escapeHtml(point.label)}</strong><br>${Math.round(current.temperature_2m??0)}°F · ${escapeHtml(condition)}<br>Gusts ${Math.round(gusts)} mph · Rain ${Math.round(precip)}%`);state.weatherGroup.addLayer(marker);
}
function weatherMaxGustMph(data) {
  const current=Number(data?.current?.wind_gusts_10m)||0;
  const hourly=Array.isArray(data?.hourly?.wind_gusts_10m)?data.hourly.wind_gusts_10m.filter(Number.isFinite):[];
  return Math.max(...hourly,current);
}
function clearWeather() {state.weatherData=null;state.weatherPoint=null;state.weatherGroup?.clearLayers();$('weatherSummary').className='intel-card empty';$('weatherSummary').textContent='No weather loaded.';renderIntelSummary();}

const RAINVIEWER_MAPS_URL='https://api.rainviewer.com/public/weather-maps.json';
function radarTileUrl(frame) {return `${frame.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;}
function radarFrameTime(frame) {return new Date(Number(frame.time)*1000);}
async function showRadar() {
  $('radarSummary').className='intel-card loading';$('radarSummary').textContent='Loading recent radar frames…';
  try{
    const response=await fetchWithTimeout(RAINVIEWER_MAPS_URL);
    if(!response.ok)throw new Error(`RainViewer HTTP ${response.status}`);
    const data=await response.json();
    const host=String(data.host||'');const frames=(data.radar?.past||[]).filter(frame=>frame?.path&&Number.isFinite(Number(frame.time))).map(frame=>({...frame,host}));
    if(!host||!frames.length)throw new Error('No radar frames are currently available.');
    state.radarFrames=frames;state.radarFrameIndex=frames.length-1;renderRadarFrame();
    $('radarPlayButton').disabled=frames.length<2;$('radarToggleButton').textContent='Hide radar';setStatus('Weather radar loaded.');
  }catch(error){hideRadar(false);$('radarSummary').className='intel-card error';$('radarSummary').textContent=`Radar failed: ${error.message}`;setStatus(`Radar failed: ${error.message}`,true);}
}
function radarCoverageFeatures() {
  const scope=state.settings.radarCoverage||'active-day';if(scope==='map')return [];
  const selected=state.project.features.find(feature=>feature.id===state.selectedId&&feature.geometry?.kind==='line');
  if(scope==='selected')return selected?[selected]:[];
  const day=Number(state.settings.dayFilter);
  if(day>=1&&day<=8)return state.project.features.filter(feature=>feature.geometry?.kind==='line'&&Number(feature.day)===day);
  return selected?[selected]:[];
}
function radarCoverageBounds() {
  const features=radarCoverageFeatures();if(!features.length)return null;
  const points=features.flatMap(feature=>feature.geometry.coordinates||[]).filter(validPoint);if(!points.length)return null;
  const bounds=L.latLngBounds(points.map(point=>[point.lat,point.lon]));const center=bounds.getCenter();const latPad=30/69;const lonPad=30/(69*Math.max(.2,Math.cos(center.lat*Math.PI/180)));
  bounds.extend([bounds.getSouth()-latPad,bounds.getWest()-lonPad]);bounds.extend([bounds.getNorth()+latPad,bounds.getEast()+lonPad]);return bounds;
}
function radarCoverageLabel() {
  const scope=state.settings.radarCoverage||'active-day';if(scope==='map')return 'current map view';
  const features=radarCoverageFeatures();if(!features.length)return 'current map view (no matching route selected)';
  if(scope==='selected')return `${features[0].name} corridor`;
  return `Day ${state.settings.dayFilter} corridor`;
}
function createRadarLayer(frame,opacity=0) {
  const options={opacity,maxNativeZoom:7,maxZoom:19,zIndex:450,className:'cannon-radar-layer',attribution:'Radar data © <a href="https://www.rainviewer.com/">RainViewer</a>'};
  const bounds=radarCoverageBounds();if(bounds)options.bounds=bounds;return L.tileLayer(radarTileUrl(frame),options);
}
function updateRadarSummary() {
  const frame=state.radarFrames[state.radarFrameIndex];if(!frame)return;const time=radarFrameTime(frame);
  $('radarSummary').className='intel-card';$('radarSummary').innerHTML=`<strong>Radar ${escapeHtml(time.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}))}</strong><small>Recent observed precipitation · frame ${state.radarFrameIndex+1} of ${state.radarFrames.length} · ${escapeHtml(radarCoverageLabel())}</small>`;
}
function renderRadarFrame() {
  const frame=state.radarFrames[state.radarFrameIndex];if(!frame)return;if(state.radarLayer)state.map.removeLayer(state.radarLayer);
  state.radarLayer=createRadarLayer(frame,Number(state.settings.radarOpacity||65)/100).addTo(state.map);updateRadarSummary();
}
function scheduleRadarNext() {
  if(!state.radarPlaying)return;state.radarTimer=setTimeout(()=>{state.radarTimer=null;transitionRadarFrame((state.radarFrameIndex+1)%state.radarFrames.length);},1050);
}
function transitionRadarFrame(index) {
  if(!state.radarPlaying)return;const frame=state.radarFrames[index];if(!frame)return;const token=++state.radarAnimationToken;const next=createRadarLayer(frame,0);state.radarNextLayer=next;let revealed=false;
  const reveal=()=>{if(revealed||token!==state.radarAnimationToken)return;revealed=true;if(state.radarLoadTimer){clearTimeout(state.radarLoadTimer);state.radarLoadTimer=null;}const previous=state.radarLayer;next.setOpacity(Number(state.settings.radarOpacity||65)/100);previous?.setOpacity(0);state.radarLayer=next;state.radarNextLayer=null;state.radarFrameIndex=index;updateRadarSummary();setTimeout(()=>{if(previous&&state.map.hasLayer(previous))state.map.removeLayer(previous);},360);scheduleRadarNext();};
  next.once('load',reveal).addTo(state.map);state.radarLoadTimer=setTimeout(reveal,2800);
}
function stopRadarLoop() {
  state.radarPlaying=false;state.radarAnimationToken++;if(state.radarTimer){clearTimeout(state.radarTimer);state.radarTimer=null;}if(state.radarLoadTimer){clearTimeout(state.radarLoadTimer);state.radarLoadTimer=null;}if(state.radarNextLayer&&state.map.hasLayer(state.radarNextLayer))state.map.removeLayer(state.radarNextLayer);state.radarNextLayer=null;if($('radarPlayButton'))$('radarPlayButton').textContent='Play loop';
}
function toggleRadarLoop() {
  if(state.radarPlaying)return stopRadarLoop();if(state.radarFrames.length<2)return;state.radarPlaying=true;$('radarPlayButton').textContent='Pause loop';transitionRadarFrame(0);
}
function hideRadar(save=true) {
  stopRadarLoop();if(state.radarLayer&&state.map)state.map.removeLayer(state.radarLayer);state.radarLayer=null;state.radarFrames=[];state.radarFrameIndex=-1;
  if($('radarToggleButton'))$('radarToggleButton').textContent='Show radar';if($('radarPlayButton'))$('radarPlayButton').disabled=true;
  if($('radarSummary')){$('radarSummary').className='intel-card empty';$('radarSummary').textContent='Weather radar is off.';}
  if(save)saveProject(false);
}
function toggleRadar() {if(state.radarLayer)hideRadar();else showRadar();}
function setRadarOpacity() {state.settings.radarOpacity=Number($('radarOpacity').value)||65;state.radarLayer?.setOpacity(state.settings.radarOpacity/100);saveProject(false);}
function setRadarCoverage() {state.settings.radarCoverage=$('radarCoverage').value;saveProject(false);if(state.radarLayer){stopRadarLoop();renderRadarFrame();setStatus(`Radar limited to ${radarCoverageLabel()}.`);}}
function activeWeatherLine() {
  const selected=state.project.features.find(feature=>feature.id===state.selectedId&&feature.geometry?.kind==='line');if(selected)return selected;
  const day=Number(state.settings.dayFilter);const candidates=state.project.features.filter(feature=>feature.geometry?.kind==='line'&&feature.visible!==false&&(!day||day===Number(feature.day)));
  return candidates.find(feature=>feature.type==='track')||candidates.find(feature=>feature.type==='route')||candidates[0]||null;
}
function routeSamples(feature,maxSamples=10) {
  const points=feature?.geometry?.coordinates?.filter(validPoint)||[];if(!points.length)return [];
  let start=0;if(state.lastGpsPosition){let best=Infinity;points.forEach((point,index)=>{const distance=haversine(point,state.lastGpsPosition);if(distance<best){best=distance;start=index;}});}
  const ahead=points.slice(start);if(ahead.length<=maxSamples)return ahead;
  return Array.from({length:maxSamples},(_,index)=>ahead[Math.round(index*(ahead.length-1)/(maxSamples-1))]);
}
async function loadRouteWeather() {
  const feature=activeWeatherLine();if(!feature)return setRouteWeatherError('Select a route/track or choose an active day first.');
  const samples=routeSamples(feature);if(samples.length<2)return setRouteWeatherError('The selected route/track does not contain enough points.');
  const speed=Number($('routeWeatherSpeed').value)||45;state.settings.routeWeatherSpeed=speed;saveProject(false);
  $('routeWeatherSummary').className='intel-card loading';$('routeWeatherSummary').textContent='Checking rain along the track…';
  try{
    const coordinates={latitude:samples.map(p=>p.lat.toFixed(5)).join(','),longitude:samples.map(p=>p.lon.toFixed(5)).join(',')};
    const params=new URLSearchParams({...coordinates,minutely_15:'temperature_2m,precipitation,rain,snowfall,weather_code,wind_gusts_10m,visibility',forecast_minutely_15:'48',temperature_unit:'fahrenheit',wind_speed_unit:'mph',precipitation_unit:'inch',timezone:'GMT'});
    const airParams=new URLSearchParams({...coordinates,hourly:'dust,pm2_5,us_aqi,uv_index',forecast_hours:'12',timezone:'GMT'});
    const [weatherResponse,airResponse]=await Promise.all([fetchWithTimeout(`https://api.open-meteo.com/v1/forecast?${params}`),fetchWithTimeout(`https://air-quality-api.open-meteo.com/v1/air-quality?${airParams}`).catch(()=>null)]);
    if(!weatherResponse.ok)throw new Error(`Open-Meteo HTTP ${weatherResponse.status}`);
    const payload=await weatherResponse.json();const airPayload=airResponse?.ok?await airResponse.json():[];const rows=Array.isArray(payload)?payload:[payload];const airRows=Array.isArray(airPayload)?airPayload:[airPayload];let miles=0,wet=null,totalRain=0;const hazards=[];
    for(let i=0;i<Math.min(samples.length,rows.length);i++){
      if(i)miles+=haversine(samples[i-1],samples[i])/1609.344;
      const arrivalMinutes=Math.round(miles/speed*60);const data=rows[i]?.minutely_15||{};const times=data.time||[];
      let weatherIndex=times.findIndex(time=>Date.parse(`${time}Z`)>=Date.now()+arrivalMinutes*60000);if(weatherIndex<0)weatherIndex=times.length-1;
      const precipitation=Number(data.precipitation?.[weatherIndex])||0;const rain=Number(data.rain?.[weatherIndex])||0;const snow=Number(data.snowfall?.[weatherIndex])||0;const code=Number(data.weather_code?.[weatherIndex])||0;const gust=Number(data.wind_gusts_10m?.[weatherIndex])||0;const visibility=Number(data.visibility?.[weatherIndex]);const temperature=Number(data.temperature_2m?.[weatherIndex]);
      const rainCode=(code>=51&&code<=67)||(code>=80&&code<=82)||(code>=95&&code<=99);
      totalRain+=precipitation;if(!wet&&(precipitation>=0.01||rain>=0.01||rainCode))wet={miles,arrivalMinutes,precipitation,code};
      const air=airRows[i]?.hourly||{};let airIndex=(air.time||[]).findIndex(time=>Date.parse(`${time}Z`)>=Date.now()+arrivalMinutes*60000);if(airIndex<0)airIndex=(air.time||[]).length-1;const dust=Number(air.dust?.[airIndex])||0;const pm25=Number(air.pm2_5?.[airIndex])||0;const aqi=Number(air.us_aqi?.[airIndex])||0;const uv=Number(air.uv_index?.[airIndex])||0;
      const labels=[];if(gust>=35)labels.push(`gusts ${Math.round(gust)} mph`);if(precipitation>=0.15)labels.push(`heavy precipitation ${precipitation.toFixed(2)} in/15 min`);if(snow>0)labels.push(`snow ${snow.toFixed(2)} in/15 min`);if(Number.isFinite(temperature)&&temperature<=32&&precipitation>0)labels.push('freezing precipitation risk');else if(Number.isFinite(temperature)&&temperature<=20)labels.push(`extreme cold ${Math.round(temperature)}°F`);if(Number.isFinite(temperature)&&temperature>=95)labels.push(`high heat ${Math.round(temperature)}°F`);if(code>=95)labels.push(code>=96?'thunderstorm/hail':'thunderstorm');if(Number.isFinite(visibility)&&visibility<3219)labels.push(`low visibility ${Math.max(.1,visibility/1609.344).toFixed(1)} mi`);if(dust>=25)labels.push(`elevated dust ${Math.round(dust)} µg/m³`);if(pm25>=35||aqi>=101)labels.push(`poor air quality AQI ${Math.round(aqi)}`);if(uv>=8)labels.push(`very high UV ${uv.toFixed(0)}`);
      if(labels.length)hazards.push({miles,arrivalMinutes,labels});
    }
    $('routeWeatherSummary').className=`intel-card${wet?' warning':''}`;
    const firstHazard=hazards[0];const hazardText=firstHazard?hazards.slice(0,3).map(item=>`<em>${item.arrivalMinutes} min / ${item.miles.toFixed(0)} mi ahead: ${escapeHtml(item.labels.join(', '))}.</em>`).join(''):'<small>No unusual wind, precipitation, temperature, snow, storm, visibility, dust, air-quality, or UV hazard detected at sampled points.</small>';
    $('routeWeatherSummary').className=`intel-card${wet||firstHazard?' warning':''}`;
    $('routeWeatherSummary').innerHTML=(wet?`<strong>Rain likely in about ${wet.arrivalMinutes} minutes</strong><small>Approximately ${wet.miles.toFixed(0)} miles ahead on ${escapeHtml(feature.name)} at ${speed} mph. First wet sample: ${wet.precipitation.toFixed(2)} in/15 min. Estimated rainfall exposure across sampled track: ${totalRain.toFixed(2)} in.</small>`:`<strong>No rain indicated along the sampled track</strong><small>${escapeHtml(feature.name)} · next ${Math.round(miles)} miles sampled at ${speed} mph · estimated rainfall exposure ${totalRain.toFixed(2)} in.</small>`)+hazardText+'<small>Forecast estimate only—check radar, alerts, and current conditions.</small>';
    setStatus(`Route rain outlook checked for ${feature.name}.`);
  }catch(error){setRouteWeatherError(`Route weather failed: ${error.message}`);}
}
function setRouteWeatherError(message) {$('routeWeatherSummary').className='intel-card error';$('routeWeatherSummary').textContent=message;setStatus(message,true);}
function bboxAreaKm2(bounds) {
  const south=bounds.getSouth(),north=bounds.getNorth(),west=bounds.getWest(),east=bounds.getEast();
  const height=Math.abs(north-south)*111.32;const width=Math.abs(east-west)*111.32*Math.cos(((north+south)/2)*Math.PI/180);return height*width;
}
const TRAFFIC_CATEGORY={0:'Unknown',1:'Accident',2:'Fog',3:'Dangerous conditions',4:'Rain',5:'Ice',6:'Traffic jam',7:'Lane closed',8:'Road closed',9:'Road work',10:'Wind',11:'Flooding',14:'Broken-down vehicle'};
function trafficStyle(category) {
  if([1,8,11].includes(Number(category)))return {color:'#ef4444',fillColor:'#ef4444'};
  if([7,9,14].includes(Number(category)))return {color:'#f97316',fillColor:'#f97316'};
  return {color:COLORS.traffic,fillColor:COLORS.traffic};
}
async function loadTrafficHere() {
  state.settings.trafficProvider=$('trafficProvider').value;state.settings.tomtomApiKey=$('tomtomApiKey').value.trim();state.settings.wazeFeedUrl=$('wazeFeedUrl').value.trim();saveProject(false);
  if(state.settings.trafficProvider==='none')return setStatus('Choose TomTom or Waze for Cities first.',true);
  $('trafficSummary').className='intel-card loading';$('trafficSummary').textContent='Loading traffic…';
  try{
    if(state.settings.trafficProvider==='tomtom')await loadTomTomTraffic();else await loadWazeTraffic();
    renderTraffic();renderIntelSummary();setStatus(`Loaded ${state.trafficIncidents.length} traffic incidents.`);
  }catch(error){$('trafficSummary').className='intel-card error';$('trafficSummary').textContent=`Traffic failed: ${error.message}`;setStatus(`Traffic failed: ${error.message}`,true);}
}
async function loadTomTomTraffic() {
  const key=state.settings.tomtomApiKey;if(!key)throw new Error('TomTom API key is required.');
  const bounds=state.map.getBounds();const area=bboxAreaKm2(bounds);if(area>10000)throw new Error('Zoom in. TomTom limits one incident request to 10,000 km².');
  const bbox=[bounds.getWest(),bounds.getSouth(),bounds.getEast(),bounds.getNorth()].map(value=>value.toFixed(6)).join(',');
  const fields='{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code,iconCategory},startTime,endTime,from,to,length,delay,roadNumbers,timeValidity,probabilityOfOccurrence,numberOfReports,lastReportTime}}}';
  const params=new URLSearchParams({key,bbox,fields,language:'en-US',timeValidityFilter:'present'});
  const response=await fetchWithTimeout(`https://api.tomtom.com/traffic/services/5/incidentDetails?${params}`);
  if(!response.ok)throw new Error(`TomTom HTTP ${response.status}`);
  const data=await response.json();state.trafficIncidents=(data.incidents||[]).map(item=>({...item,source:'TomTom'}));
}
function parseWazeJson(data) {
  const rows=[...(data.alerts||[]),...(data.jams||[]),...(data.irregularities||[]),...(Array.isArray(data)?data:[])];
  return rows.map((row,index)=>{
    let geometry=null;
    if(Array.isArray(row.line)&&row.line.length)geometry={type:'LineString',coordinates:row.line.map(point=>[Number(point.x??point.lon??point.lng),Number(point.y??point.lat)]).filter(pair=>pair.every(Number.isFinite))};
    else {const loc=row.location||row.position||row;const lon=Number(loc.x??loc.lon??loc.lng??loc.longitude),lat=Number(loc.y??loc.lat??loc.latitude);if(Number.isFinite(lat)&&Number.isFinite(lon))geometry={type:'Point',coordinates:[lon,lat]};}
    return geometry?{type:'Feature',geometry,properties:{id:row.uuid||row.id||`waze-${index}`,iconCategory:row.type||row.subtype||'Waze report',events:[{description:row.subtype||row.type||row.street||'Waze traffic report'}],from:row.street||'',delay:Number(row.delay)||0},source:'Waze'}:null;
  }).filter(Boolean);
}
function parseWazeXml(text) {
  const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.querySelector('parsererror'))throw new Error('Waze feed was not valid XML/JSON.');
  const items=[...doc.querySelectorAll('item, entry')];
  return items.map((item,index)=>{
    const title=item.querySelector('title')?.textContent?.trim()||'Waze traffic report';
    const point=item.getElementsByTagNameNS('*','point')[0]?.textContent?.trim();const line=item.getElementsByTagNameNS('*','line')[0]?.textContent?.trim();let geometry=null;
    if(line){const values=line.split(/[\s,]+/).map(Number).filter(Number.isFinite);const coordinates=[];for(let i=0;i+1<values.length;i+=2)coordinates.push([values[i+1],values[i]]);geometry={type:'LineString',coordinates};}
    else if(point){const [lat,lon]=point.split(/[\s,]+/).map(Number);if(Number.isFinite(lat)&&Number.isFinite(lon))geometry={type:'Point',coordinates:[lon,lat]};}
    return geometry?{type:'Feature',geometry,properties:{id:`waze-${index}`,iconCategory:'Waze report',events:[{description:title}],from:'',delay:0},source:'Waze'}:null;
  }).filter(Boolean);
}
async function loadWazeTraffic() {
  const url=state.settings.wazeFeedUrl;if(!url)throw new Error('A Waze for Cities partner GeoRSS URL is required.');
  const response=await fetchWithTimeout(url);if(!response.ok)throw new Error(`Waze feed HTTP ${response.status}`);const text=await response.text();
  let data=null;try{data=JSON.parse(text);}catch(_){}
  state.trafficIncidents=data?parseWazeJson(data):parseWazeXml(text);
}
function renderTraffic() {
  state.trafficGroup?.clearLayers();
  let severe=0;
  state.trafficIncidents.forEach((incident,index)=>{
    const geometry=incident.geometry;if(!geometry)return;const p=incident.properties||{};const category=Number(p.iconCategory);if([1,8,11].includes(category))severe++;
    const style=trafficStyle(category);let layer;
    if(geometry.type==='Point')layer=L.circleMarker([geometry.coordinates[1],geometry.coordinates[0]],{radius:7,color:'#fff',weight:2,fillColor:style.fillColor,fillOpacity:.95});
    else if(geometry.type==='LineString')layer=L.polyline(geometry.coordinates.map(pair=>[pair[1],pair[0]]),{color:style.color,weight:6,opacity:.8});
    if(!layer)return;
    const description=p.events?.[0]?.description||TRAFFIC_CATEGORY[category]||String(p.iconCategory||'Traffic incident');const delay=Number(p.delay)||0;const road=[p.from,p.to].filter(Boolean).join(' → ')||p.roadNumbers?.join(', ')||'';
    layer.bindPopup(`<strong>${escapeHtml(description)}</strong><br>${escapeHtml(road)}${delay?`<br>Reported delay: ${Math.round(delay/60)} min`:''}<br><small>${escapeHtml(incident.source||'Traffic provider')}</small>`);state.trafficGroup.addLayer(layer);
  });
  $('trafficSummary').className=`intel-card${severe?' warning':''}`;$('trafficSummary').innerHTML=`<strong>${state.trafficIncidents.length} current incidents</strong><small>${severe} severe · Map viewport only · ${escapeHtml(state.settings.trafficProvider==='tomtom'?'TomTom':'Waze for Cities')}</small>`;
}
function clearTraffic() {state.trafficIncidents=[];state.trafficGroup?.clearLayers();$('trafficSummary').className='intel-card empty';$('trafficSummary').textContent='No traffic loaded.';renderIntelSummary();}

function openWazeAtMapCenter() {
  const point=currentIntelPoint();
  const url=`https://www.waze.com/ul?ll=${encodeURIComponent(`${point.lat.toFixed(6)},${point.lon.toFixed(6)}`)}&navigate=no&utm_source=CannonMap`;
  window.open(url,'_blank','noopener,noreferrer');
  setStatus(`Opened Waze near ${point.label}.`);
}
function renderIntelSummary() {
  const riders=state.project.competitors||[];const fresh=riders.filter(comp=>competitorFreshness(comp).fresh).length;const points=riders.reduce((sum,comp)=>sum+(comp.points?.length||0),0);
  if($('intelRiderCount'))$('intelRiderCount').textContent=riders.length;if($('intelFreshCount'))$('intelFreshCount').textContent=fresh;if($('intelPointCount'))$('intelPointCount').textContent=points;if($('intelLastSync'))$('intelLastSync').textContent=formatClock(state.rallySync.lastSync);
  const running=Boolean(state.rallyPollTimer);const badge=$('feedBadge');if(badge){badge.textContent=state.rallySync.running?'SYNCING':running?'LIVE':state.rallySync.lastError?'CHECK':'READY';badge.className=`badge ${state.rallySync.lastError?'warning':running?'live':'neutral'}`;}
  if($('rallyFeedNotice')){$('rallyFeedNotice').textContent=state.rallySync.lastError?state.rallySync.lastError:state.settings.rallyEndpointUrl?`${running?'Polling':'Connector ready'} · ${riders.length} riders · ${points} breadcrumbs`:'The public leaderboard URL is saved. Live trail polling needs the JSON/location endpoint captured from a live event. Polling runs only while CannonMap is open and active.';}
  if($('mobileRiderCount'))$('mobileRiderCount').textContent=riders.length;if($('mobileFreshCount'))$('mobileFreshCount').textContent=fresh;if($('mobileTrafficCount'))$('mobileTrafficCount').textContent=state.trafficIncidents.length;
  if($('mobileIntelStatus'))$('mobileIntelStatus').textContent=running?`Live · last ${formatClock(state.rallySync.lastSync)}`:state.rallySync.lastSync?`Last sync ${formatClock(state.rallySync.lastSync)}`:'No live feed';
  if($('mobileWeatherSummary')){if(state.weatherData){const c=state.weatherData.current||{};$('mobileWeatherSummary').textContent=`${Math.round(c.temperature_2m??0)}°F · ${WEATHER_CODES[c.weather_code]||'Weather'} · Gusts ${Math.round(weatherMaxGustMph(state.weatherData))} mph`;}else $('mobileWeatherSummary').textContent='Weather not loaded';}
}
function activeRallyDay(){const value=Number(state.settings.dayFilter);return value>=1&&value<=8?value:0;}
function dayCheckpoints(){const day=activeRallyDay();return state.project.features.filter(feature=>feature.type==='checkpoint'&&(!day||Number(feature.day)===day)).map(normalizeCheckpoint).sort((a,b)=>(Number(a.sequence)||9999)-(Number(b.sequence)||9999));}
function currentCheckpoint(){const rows=dayCheckpoints();return rows.find(feature=>feature.status==='next')||rows.find(feature=>feature.status==='planned')||null;}
function currentHotel(){const day=activeRallyDay();return state.project.features.find(feature=>feature.type==='hotel'&&(!day||Number(feature.day)===day))||null;}
function distanceFromCurrent(feature){const point=feature?.geometry?.coordinates?.[0];const from=state.lastGpsPosition;if(!point||!from)return null;return haversine(from,point)/1609.344;}
function rallyScore(){return state.project.features.filter(feature=>feature.type==='checkpoint'&&feature.status==='completed').reduce((score,feature)=>score+(Number(feature.points)||(feature.extreme?21:10)),0);}
function hotelEta(){const hotel=currentHotel(),miles=distanceFromCurrent(hotel);if(miles===null)return {hotel,miles:null,label:'Hotel ETA —'};const minutes=miles/(Number(state.settings.routeWeatherSpeed)||45)*60;return {hotel,miles,label:`Hotel ${miles.toFixed(0)} mi · ${new Date(Date.now()+minutes*60000).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}`};}
function fuelEstimate(){const configured=state.settings.fuelProfile==='paved'?Number(state.settings.expectedPavedRange):Number(state.settings.expectedMixedRange);const remaining=Math.max(0,configured-Number(state.settings.reserveDistance||0));const checkpointMiles=distanceFromCurrent(currentCheckpoint()),hotelMiles=distanceFromCurrent(currentHotel());const required=Math.min(...[checkpointMiles,hotelMiles].filter(Number.isFinite));return {remaining,warning:Number.isFinite(required)&&remaining>0&&required>remaining,label:remaining?`${remaining.toFixed(0)} mi usable estimate${Number.isFinite(required)&&required>remaining?' · WARNING':''}`:'Fuel range not configured'};}
function renderRallyMode(){
  if(!$('rallyMode'))return;const next=currentCheckpoint(),hotel=hotelEta(),fuel=fuelEstimate(),last=state.rallySync.lastSync;
  $('rallyDay').textContent=activeRallyDay()?`DAY ${activeRallyDay()}`:'SELECT A DAY';$('rallyConnectivity').textContent=`${navigator.onLine?'Online':'Offline'} · ${$('gpsStatus')?.textContent||'GPS off'}`;$('rallyScore').textContent=rallyScore();
  $('rallyNextName').textContent=next?.name||'No checkpoint selected';const distance=distanceFromCurrent(next);$('rallyNextDistance').textContent=distance===null?'Distance unavailable':`${distance.toFixed(1)} mi away`;$('rallyNextPoints').textContent=next?`${next.extreme?'EXTREME · ':''}${next.points} points · ${next.status}`:'—';
  $('rallyHotelEta').textContent=hotel.label;$('rallyFuelStatus').textContent=fuel.label;$('rallyFuelStatus').classList.toggle('warning',fuel.warning);$('rallyFeedAge').textContent=last?`Feed ${formatClock(last)}`:'Feed never updated';
  const hasDeferred=dayCheckpoints().some(feature=>feature.status==='deferred');$('rallyDeferButton').disabled=!next;$('rallyCompleteButton').disabled=!next;$('rallySkipButton').disabled=!next;$('rallyRestoreButton').hidden=!hasDeferred;$('rallyRestoreButton').disabled=!hasDeferred;$('goHotelButton').disabled=!hotel.hotel&&!state.hotelBailoutActive;$('goHotelButton').textContent=state.hotelBailoutActive?'UNDO HOTEL BAILOUT':'GO TO HOTEL';
  if($('autoCompleteCheckpoints'))$('autoCompleteCheckpoints').checked=state.settings.autoCompleteCheckpoints!==false;if($('checkpointArrivalRadius'))$('checkpointArrivalRadius').value=state.settings.checkpointArrivalRadius||500;if($('checkpointMaxAccuracy'))$('checkpointMaxAccuracy').value=state.settings.checkpointMaxAccuracy||200;
}
function setRallyMoreOpen(open){$('rallyMode').classList.toggle('more-open',open);$('rallyMoreSheet').setAttribute('aria-hidden',String(!open));$('rallyMoreButton').setAttribute('aria-expanded',String(open));$('rallyMoreButton').textContent=open?'Close':'More';}
function activateNextPlannedCheckpoint(){const next=dayCheckpoints().find(feature=>feature.status==='planned');if(!next)return null;next.status='next';state.selectedId=next.id;return next;}
function ensureNextCheckpoint(){if(dayCheckpoints().some(feature=>feature.status==='next'))return currentCheckpoint();const next=activateNextPlannedCheckpoint();if(next)saveProject(false);return next;}
function evaluateCheckpointArrival(accuracyFeet){if(state.settings.autoCompleteCheckpoints===false)return;const checkpoint=ensureNextCheckpoint();if(!checkpoint)return;const radius=Math.max(100,Number(state.settings.checkpointArrivalRadius)||500),maxAccuracy=Math.max(25,Number(state.settings.checkpointMaxAccuracy)||200);const distance=distanceFromCurrent(checkpoint);if(distance===null||accuracyFeet>maxAccuracy||distance*5280>radius){state.arrivalCandidateId=null;state.arrivalEnteredAt=0;return;}const now=Date.now();if(state.arrivalCandidateId!==checkpoint.id){state.arrivalCandidateId=checkpoint.id;state.arrivalEnteredAt=now;return;}if(now-state.arrivalEnteredAt<2000)return;state.arrivalCandidateId=null;state.arrivalEnteredAt=0;completeCurrentCheckpoint(true);}
function selectNextCheckpoint(){const rows=dayCheckpoints(),current=rows.find(feature=>feature.status==='next');snapshot();if(current)current.status='planned';const next=rows.find(feature=>feature.status==='planned');if(next){next.status='next';state.selectedId=next.id;const point=next.geometry.coordinates[0];state.map.setView([point.lat,point.lon],14);setStatus(`${next.name} is the next checkpoint.`);}else setStatus('No planned checkpoints remain for the active day.');saveProject(false);renderAll();}
function completeCurrentCheckpoint(automatic=false){const checkpoint=currentCheckpoint();if(!checkpoint)return setStatus('No active checkpoint.',true);snapshot();checkpoint.status='completed';checkpoint.completedAt=new Date().toISOString();checkpoint.deferredAt=null;checkpoint.deferReason=null;const next=activateNextPlannedCheckpoint();saveProject(false);renderAll();setStatus(`${automatic?'Arrival detected. ':''}Completed ${checkpoint.name} for ${checkpoint.points} points.${next?` Next: ${next.name}.`:''}`);}
function deferCurrentCheckpoint(reason='Rider deferred'){const checkpoint=currentCheckpoint();if(!checkpoint)return setStatus('No active checkpoint.',true);snapshot();checkpoint.status='deferred';checkpoint.deferredAt=new Date().toISOString();checkpoint.deferReason=reason;const next=activateNextPlannedCheckpoint();saveProject(false);renderAll();setStatus(`Deferred ${checkpoint.name}; it remains in the daily sequence.${next?` Next: ${next.name}.`:''}`);}
function restoreDeferredCheckpoint(){const checkpoint=dayCheckpoints().find(feature=>feature.status==='deferred');if(!checkpoint)return setStatus('No deferred checkpoint to restore.',true);snapshot();const current=dayCheckpoints().find(feature=>feature.status==='next');if(current)current.status='planned';checkpoint.status='next';checkpoint.restoredAt=new Date().toISOString();state.selectedId=checkpoint.id;saveProject(false);renderAll();setStatus(`Restored ${checkpoint.name} as the next checkpoint.`);}
function skipCurrentCheckpoint(){const checkpoint=currentCheckpoint();if(!checkpoint)return setStatus('No active checkpoint.',true);if(!confirm(`Skip ${checkpoint.name}? It will remain in the project as skipped.`))return;snapshot();checkpoint.status='skipped';const next=activateNextPlannedCheckpoint();saveProject(false);renderAll();setStatus(`Skipped ${checkpoint.name}.${next?` Next: ${next.name}.`:''}`);}
function launchNavigation(feature){const point=feature?.geometry?.coordinates?.[0];if(!point)return;window.open(`https://www.google.com/maps/dir/?api=1&destination=${point.lat},${point.lon}`,'_blank','noopener,noreferrer');}
function goToHotel(){const hotel=currentHotel();if(!hotel)return setStatus('No hotel is assigned to the active day.',true);const info=hotelEta();if(!confirm(`Go to ${hotel.name}? ${info.miles===null?'Distance unavailable':`${info.miles.toFixed(1)} miles`}. Unfinished checkpoints will be deferred, not deleted.`))return;snapshot();const now=new Date().toISOString();dayCheckpoints().filter(feature=>['planned','next'].includes(feature.status)).forEach(feature=>{feature.status='deferred';feature.deferredAt=now;feature.deferReason='Hotel bailout';});state.hotelBailoutActive=true;saveProject(false);renderAll();launchNavigation(hotel);setStatus(`Hotel bailout active. Unfinished checkpoints were deferred. Tap Undo Hotel Bailout to reverse.`);}
function toggleHotelBailout(){if(state.hotelBailoutActive)return undo();goToHotel();}
function openFuelSettings(){for(const id of ['usableFuelCapacity','expectedPavedRange','expectedMixedRange','reserveDistance'])$(id).value=state.settings[id]||0;$('fuelProfile').value=state.settings.fuelProfile||'mixed';$('fuelDialog').showModal();}
function saveFuelSettings(event){event.preventDefault();for(const id of ['usableFuelCapacity','expectedPavedRange','expectedMixedRange','reserveDistance'])state.settings[id]=Math.max(0,Number($(id).value)||0);state.settings.fuelProfile=$('fuelProfile').value;saveProject(false);$('fuelDialog').close();renderRallyMode();setStatus('Fuel planning estimates saved.');}
function setIntelSheetOpen(open) {
  const sheet=$('intelSheet');sheet.classList.toggle('open',open);sheet.setAttribute('aria-hidden',String(!open));$('intelButton').setAttribute('aria-expanded',String(open));
}
function newProject() {
  if(!confirm('Create a new empty project? The currently saved local project will be replaced.'))return;
  createNamedSnapshot('Before new project',true);snapshot();state.project={version:APP_VERSION,name:'America 250 – 2026',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),features:[],competitors:[]};clearIntelligenceLayers();
  clearSelection();saveProject(false);renderAll();setStatus('New project created.');
}
function setSidebarOpen(open) {
  $('sidebar').classList.toggle('open',open);$('sidebarBackdrop').classList.toggle('visible',open);$('sidebarToggle').setAttribute('aria-expanded',String(open));$('sidebarToggle').textContent=open?'Close':'Planner';
}
function wireUi() {
  document.querySelectorAll('.tab').forEach(tab=>tab.addEventListener('click',()=>{document.querySelectorAll('.tab,.panel').forEach(el=>el.classList.remove('active'));tab.classList.add('active');$(`${tab.dataset.tab}Panel`).classList.add('active');}));
  $('sidebarToggle').addEventListener('click',()=>setSidebarOpen(!$('sidebar').classList.contains('open')));$('sidebarClose').addEventListener('click',()=>setSidebarOpen(false));$('sidebarBackdrop').addEventListener('click',()=>setSidebarOpen(false));
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){setSidebarOpen(false);setIntelSheetOpen(false);}});
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
  $('saveTrackingSettings').addEventListener('click',saveIntegrationSettings);
  $('openLeaderboardButton').addEventListener('click',openLeaderboard);
  $('syncRallyButton').addEventListener('click',syncRallyFeed);
  $('toggleRallyPollingButton').addEventListener('click',toggleRallyPolling);
  $('exportCompetitorButton').addEventListener('click',exportCompetitorData);
  $('clearCompetitorButton').addEventListener('click',clearCompetitors);
  $('showCompetitorTrails').addEventListener('change',()=>{state.settings.showCompetitorTrails=$('showCompetitorTrails').checked;saveProject(false);renderCompetitors();});
  $('showCompetitorMarkers').addEventListener('change',()=>{state.settings.showCompetitorMarkers=$('showCompetitorMarkers').checked;saveProject(false);renderCompetitors();});
  $('competitorFreshMinutes').addEventListener('change',()=>{state.settings.competitorFreshMinutes=Number($('competitorFreshMinutes').value)||15;saveProject(false);renderCompetitors();renderCompetitorSummary();renderIntelSummary();});
  $('weatherHereButton').addEventListener('click',loadWeatherHere);$('clearWeatherButton').addEventListener('click',clearWeather);
  $('radarToggleButton').addEventListener('click',toggleRadar);$('radarPlayButton').addEventListener('click',toggleRadarLoop);$('radarOpacity').addEventListener('input',setRadarOpacity);$('radarCoverage').addEventListener('change',setRadarCoverage);$('routeWeatherButton').addEventListener('click',loadRouteWeather);$('routeWeatherSpeed').addEventListener('change',()=>{state.settings.routeWeatherSpeed=Number($('routeWeatherSpeed').value)||45;saveProject(false);});
  $('trafficHereButton').addEventListener('click',loadTrafficHere);$('openWazeButton').addEventListener('click',openWazeAtMapCenter);$('clearTrafficButton').addEventListener('click',clearTraffic);
  $('trafficProvider').addEventListener('change',()=>{state.settings.trafficProvider=$('trafficProvider').value;saveProject(false);});
  $('competitorInput').addEventListener('change',e=>{if(e.target.files[0])importCompetitorJson(e.target.files[0]);e.target.value='';});
  $('intelButton').addEventListener('click',()=>setIntelSheetOpen(!$('intelSheet').classList.contains('open')));$('intelCloseButton').addEventListener('click',()=>setIntelSheetOpen(false));
  $('mobileSyncButton').addEventListener('click',syncRallyFeed);$('mobileWeatherButton').addEventListener('click',loadWeatherHere);$('mobileTrafficButton').addEventListener('click',loadTrafficHere);
  $('rallyNextButton').addEventListener('click',selectNextCheckpoint);$('rallyIntelButton').addEventListener('click',()=>setIntelSheetOpen(true));$('rallyDeferButton').addEventListener('click',()=>deferCurrentCheckpoint());$('rallyFuelButton').addEventListener('click',openFuelSettings);$('rallyWeatherButton').addEventListener('click',()=>setIntelSheetOpen(true));$('rallyHotelButton').addEventListener('click',()=>{const hotel=currentHotel();if(hotel){const point=hotel.geometry.coordinates[0];state.map.setView([point.lat,point.lon],14);setRallyMoreOpen(false);}else setStatus('No hotel is assigned to the active day.',true);});$('rallyCenterButton').addEventListener('click',()=>{if(state.lastGpsPosition)state.map.setView([state.lastGpsPosition.lat,state.lastGpsPosition.lon],15);else fitMap();});$('rallyMoreButton').addEventListener('click',()=>setRallyMoreOpen(!$('rallyMode').classList.contains('more-open')));$('rallyPlannerButton').addEventListener('click',()=>{setRallyMoreOpen(false);setSidebarOpen(true);});$('goHotelButton').addEventListener('click',toggleHotelBailout);$('fuelForm').addEventListener('submit',saveFuelSettings);
  $('rallyCompleteButton').addEventListener('click',()=>completeCurrentCheckpoint(false));$('rallyRestoreButton').addEventListener('click',restoreDeferredCheckpoint);$('rallySkipButton').addEventListener('click',skipCurrentCheckpoint);
  for(const id of ['autoCompleteCheckpoints','checkpointArrivalRadius','checkpointMaxAccuracy'])$(id).addEventListener('change',()=>{state.settings.autoCompleteCheckpoints=$('autoCompleteCheckpoints').checked;state.settings.checkpointArrivalRadius=Math.max(100,Number($('checkpointArrivalRadius').value)||500);state.settings.checkpointMaxAccuracy=Math.max(25,Number($('checkpointMaxAccuracy').value)||200);saveProject(false);renderRallyMode();});
  window.addEventListener('online',renderRallyMode);window.addEventListener('offline',renderRallyMode);
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
    const feature=normalizeCheckpoint({id:uid(),name:$('createName').value.trim()||'New feature',type:$('createType').value,day:Number($('createDay').value),assignmentMethod:'manual',notes:$('createNotes').value.trim(),visible:true,source:'CannonMap drawing',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),geometry:layerToGeometry(state.pendingLayer)},state.project.features.length);
    state.pendingLayer.remove();state.pendingLayer=null;state.project.features.push(feature);saveProject(false);renderAll();selectFeature(feature.id);$('createDialog').close('default');setStatus(`Created ${feature.name}.`);
  });
}
async function init() {
  await loadProject();
  state.project.features.forEach(f=>{f.assignmentMethod ||= '';f.favorite ||= false;});
  state.settings.typeVisibility=Object.assign({track:true,route:true,backbone:true,waypoint:true,checkpoint:true,fuel:true,hotel:true},state.settings.typeVisibility||{});
  state.settings=Object.assign({leaderboardUrl:'https://gpscheckpoints.com/admin/leaderboard.html?id_event=15',rallyEndpointUrl:'',rallyEventId:'15',rallyPollSeconds:30,showCompetitorTrails:true,showCompetitorMarkers:true,competitorFreshMinutes:15,trafficProvider:'none',tomtomApiKey:'',wazeFeedUrl:'',radarOpacity:65,radarCoverage:'active-day',routeWeatherSpeed:45,usableFuelCapacity:0,expectedPavedRange:0,expectedMixedRange:0,reserveDistance:25,fuelProfile:'mixed',autoCompleteCheckpoints:true,checkpointArrivalRadius:500,checkpointMaxAccuracy:200,hideCompletedCheckpoints:true},state.settings);
  state.project.competitors ||= [];
  initMap();wireUi();if(typeof wirePlannerRouteBuilder==='function')wirePlannerRouteBuilder();$('radarOpacity').value=state.settings.radarOpacity||65;$('radarCoverage').value=state.settings.radarCoverage||'active-day';$('routeWeatherSpeed').value=String(state.settings.routeWeatherSpeed||45);
  $('buildLabel').textContent=`Beta ${APP_VERSION}`;
  $('appVersion').textContent=`v${APP_VERSION} · ${BUILD_ID}`;
  renderAll();document.documentElement.dataset.cannonmapReady='true';setTimeout(()=>{if(state.project.features.length)fitMap();},200);
  if('serviceWorker'in navigator&&!new URLSearchParams(location.search).has('e2e')){let refreshing=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(refreshing)return;refreshing=true;location.reload();});navigator.serviceWorker.register('./sw.js').then(registration=>registration.update()).catch(()=>{});}
}
window.CannonMapTest={filterProhibitedFeatures,sanitizeProjectData,lineGeometriesMatch,lineDistanceMiles,planningMileage,normalizeCheckpoint,rallyCheckpointNumber,selectNextCheckpoint,completeCurrentCheckpoint,deferCurrentCheckpoint,restoreDeferredCheckpoint,skipCurrentCheckpoint,goToHotel,rallyScore,restoreSnapshot,evaluateCheckpointArrival};
init();
