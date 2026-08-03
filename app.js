import {createCoreCompatibility} from './src/core/compatibility.js';
import * as geometry from './src/domain/geo/geometry.js';
import {createMapEngine} from './src/ui/map/map-engine.js';
import {createProjectWorkflows} from './src/application/project-workflows.js';
import * as checkpoints from './src/domain/checkpoints/workflow.js';
import {evaluateArrivalSample} from './src/domain/checkpoints/arrival.js';
import {renderRally as presentRally} from './src/ui/rally/presenter.js';
import {wireRallyController} from './src/ui/rally/controller.js';
import {wireProjectController} from './src/ui/project/controller.js';
import {createFeatureFlags} from './src/core/feature-flags.js';
import {createObservationCapture,OBSERVATION_CAPTURE_FEATURE_FLAG} from './src/application/observation-capture.js';
import {createSecureObservationUploader,SECURE_INGESTION_FEATURE_FLAG} from './src/application/secure-observation-upload.js';
import {createRallyAnalyticsService,RALLY_ANALYTICS_FEATURE_FLAG} from './src/application/rally-analytics-service.js';
import {createRallyJournalService} from './src/application/rally-journal-service.js';
import {createProjectLifecycleManager} from './src/application/project-lifecycle-manager.js';
import {createProjectRepositoryScope} from './src/application/project-repository-scope.js';
import {createCheckpointCameraWorkflow} from './src/application/checkpoint-camera-workflow.js';
import {createGpsFollowController} from './src/application/gps-follow-controller.js';
import {createRallyDebugLog} from './src/application/rally-debug-log.js';
import {createRideExportSource} from './src/application/ride-export-source.js';
import {
  createAnalyticsRepository,createJournalRepository,createLegacyCurrentProjectRepository,
  createObservationCaptureRepository,createProjectDeletionRepository,createProjectLifecycleRepository,
  createProjectRepository,createSearchRepository,createMissionMediaRepository,openIndexedDbV2,V2_FEATURE_FLAG
} from './src/infrastructure/indexeddb/index.js';
import {createFirebaseAuthentication} from './src/infrastructure/firebase/authentication.js';
import {createObservationIngressClient} from './src/infrastructure/firebase/observation-ingress-client.js';

const APP_VERSION = '0.7.1';
const BUILD_ID = '2026.07.27.m11g';
const SETTINGS_KEY = 'cannonmap.settings.v6';
const SNAPSHOT_KEY = 'cannonmap.snapshots.v1';
const DB_NAME = 'CannonMapDB';
const DB_STORE = 'projects';
const PROHIBITED_FEATURE_NAMES = new Set(['old coast road']);
const REQUIRED_RUNTIME_DEPENDENCIES = [
  {name:'Leaflet',available:scope=>typeof scope.L?.map==='function'},
  {name:'Leaflet-Geoman',available:scope=>Boolean(scope.L?.PM)}
];
const OPTIONAL_RUNTIME_DEPENDENCIES = [
  {name:'SheetJS',available:scope=>Boolean(scope.XLSX?.utils)},
  {name:'Firebase Realtime Database',available:scope=>typeof scope.firebase?.database==='function'}
];

const COLORS = {
  track: '#f97316', route: '#38bdf8', waypoint: '#facc15', checkpoint: '#22c55e',
  fuel: '#a78bfa', hotel: '#fb7185', backbone: '#94a3b8', competitor: '#ef4444', traffic: '#facc15', weather: '#38bdf8'
};

const core=createCoreCompatibility({appVersion:APP_VERSION});
const state=core.state;
let mapEngine=null;
let observationCapture=null;
let secureObservationUploader=null;
let observationDatabase=null;
let observationRepository=null;
let rallyAnalytics=null;
let analyticsDatabase=null;
let foundationDatabase=null;
let projectLifecycle=null;
let activeLifecycleProjectId=null;
let rallyJournal=null;
let checkpointCamera=null;
let missionMedia=null;
let rideExportSource=null;
let cameraCountdownTimer=null;
let gpsFollow=null;
let pendingPhotoCheckpointId=null;
let checkpointCompletionInFlight=false;
let projectSaveQueue=Promise.resolve();
let observationSequence=0;
const observationSessionId=`device-${core.ids.create()}`;
const featureFlags=createFeatureFlags({read:key=>key===RALLY_ANALYTICS_FEATURE_FLAG||globalThis.__CANNONMAP_FEATURE_FLAGS__?.[key]===true});
const rallyDebug=createRallyDebugLog({storage:localStorage,clock:core.clock});

const $ = id => document.getElementById(id);
const uid=core.ids.create;
const haversine=geometry.haversineMeters;
const lineDistanceMiles=geometry.lineDistanceMiles;
const validPoint=geometry.validPoint;
const distancePointToSegmentMiles=geometry.distancePointToSegmentMiles;
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
function stableUuid(value){
  let a=0x811c9dc5,b=0x9e3779b9;for(const character of String(value)){a=Math.imul(a^character.charCodeAt(0),0x01000193);b=Math.imul(b+character.charCodeAt(0),0x85ebca6b);}
  const hex=(number,length=8)=>(number>>>0).toString(16).padStart(length,'0').slice(-length);
  return `${hex(a)}-${hex(b,4)}-4${hex(a^b,3)}-8${hex(Math.imul(a,b),3)}-${hex(b^0xa5a5a5a5)}${hex(a^0x5a5a5a5a,4)}`;
}
const deepClean = obj => JSON.parse(JSON.stringify(obj, (key, value) => key === '_layer' ? undefined : value));
const projectWorkflows=createProjectWorkflows({
  createId:uid,
  now:()=>new Date().toISOString(),
  parseXml:text=>new DOMParser().parseFromString(text,'application/xml'),
  normalizeCheckpoint:checkpoints.normalizeCheckpoint,
  rallyCheckpointNumber:checkpoints.rallyCheckpointNumber,
  filterFeatures:filterProhibitedFeatures
});
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
  return checkpoints.normalizeCheckpoint(feature,index);
}
function rallyCheckpointNumber(value){return checkpoints.rallyCheckpointNumber(value);}
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
  if(!el)return;
  el.textContent = message;
  el.classList.toggle('editing-banner', message.startsWith('Editing '));
  el.style.background = isError ? '#450a0a' : '';
  el.style.borderColor = isError ? '#991b1b' : '';
}

function runtimeDependencyReport(scope=globalThis){
  const forcedMissing=String(scope.__CANNONMAP_TEST_MISSING_DEPENDENCY||'');
  const missingRequired=REQUIRED_RUNTIME_DEPENDENCIES.filter(item=>item.name===forcedMissing||!item.available(scope)).map(item=>item.name);
  const missingOptional=OPTIONAL_RUNTIME_DEPENDENCIES.filter(item=>!item.available(scope)).map(item=>item.name);
  return {missingRequired,missingOptional};
}
function setStartupState(stateName,message='',missing=[]){
  document.documentElement.dataset.cannonmapStartupState=stateName;
  document.documentElement.dataset.cannonmapReady=stateName==='ready'?'true':'false';
  if(missing.length)document.documentElement.dataset.cannonmapMissingDependencies=missing.join(',');
  else delete document.documentElement.dataset.cannonmapMissingDependencies;
  if(message)setStatus(message,stateName==='failed');
}
function registerServiceWorker(){
  if(!('serviceWorker'in navigator))return Promise.resolve(null);
  return navigator.serviceWorker.register('./sw.js')
    .then(registration=>{registration.update();return registration;})
    .catch(error=>{console.error(`[CannonMap startup] Service worker registration failed: ${error.message}`);return null;});
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
  mapEngine=createMapEngine({
    L,
    container:'map',
    preferredBaseLayer:state.settings.baseLayer,
    onBaseLayerChange:name=>{state.settings.baseLayer=name;saveProject(false);}
  });
  state.map=mapEngine.map;
  gpsFollow=createGpsFollowController({map:state.map,debugLog:rallyDebug});
  window.addEventListener('orientationchange',()=>setTimeout(()=>gpsFollow?.orientationChanged(),100));
  state.baseLayers=mapEngine.baseLayers;
  state.featureGroup=mapEngine.group('features');
  state.competitorGroup=mapEngine.group('competitors');
  state.stationaryEventGroup=mapEngine.group('stationaryEvents');
  state.trafficGroup=mapEngine.group('traffic');
  state.weatherGroup=mapEngine.group('weather');
  state.map.pm.addControls({
    position:'topleft', drawMarker:true, drawPolyline:true, drawPolygon:false, drawRectangle:false,
    drawCircle:false, drawCircleMarker:false, editMode:false, dragMode:false, cutPolygon:false,
    removalMode:false, rotateMode:false
  });
  state.map.pm.setGlobalOptions({ snappable:true, snapDistance:20, layerGroup:state.featureGroup });

  state.map.on('pm:create', event => {
    state.pendingLayer = event.layer;
    const activeDay = state.settings.dayFilter === 'all' ? '0' : state.settings.dayFilter;
    if($('createDay')) $('createDay').value = activeDay;
    if($('createType')) $('createType').value = event.shape === 'Marker' ? 'checkpoint' : 'track';
    if($('createName')) $('createName').value = event.shape === 'Marker' ? 'New checkpoint' : 'New track';
    if($('createNotes')) $('createNotes').value = '';
    $('createDialog')?.showModal();
  });
  state.map.on('mousemove', e => { if($('cursorCoordinates')) $('cursorCoordinates').textContent = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`; });
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
  const color = ['checkpoint','hotel'].includes(feature.type)?checkpoints.CHECKPOINT_COLOR[checkpoints.checkpointState(feature.status)]:(COLORS[feature.type] || COLORS.waypoint);
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
  updateStationaryDetection();
  state.project.features.forEach(feature=>delete feature._layer);
  const visible=state.project.features.filter(feature=>
    feature.visible&&featureMatchesDay(feature)&&state.settings.typeVisibility?.[feature.type]!==false&&
    !(matchMedia('(max-width:900px)').matches&&state.settings.hideCompletedCheckpoints!==false&&feature.type==='checkpoint'&&feature.status==='completed')
  ).map(feature=>({feature,key:feature.id||`legacy-index:${state.project.features.indexOf(feature)}`}));
  const layers=mapEngine.layers.reconcile('features',visible,{
    key:model=>model.key,
    fingerprint:model=>JSON.stringify({feature:deepClean(model.feature),lineOpacity:state.settings.lineOpacity}),
    create:model=>createLeafletLayer(model.feature)
  });
  visible.forEach(model=>model.feature._layer=layers.get(String(model.key)));
  renderCompetitors();
  renderStationaryEvents();
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
  const models=[];
  state.project.competitors.forEach((comp,index) => {
    if (!Array.isArray(comp.points) || !comp.points.length) return;
    const competitorKey=comp.id||comp.name||`legacy-index:${index}`;
    const freshness = competitorFreshness(comp);
    const opacity = freshness.fresh ? .88 : .28;
    const points = comp.points.filter(validPoint);
    if (state.settings.showCompetitorTrails !== false && comp.trailHidden!==true && points.length > 1) {
      models.push({key:`trail:${competitorKey}`,kind:'trail',comp,freshness,opacity,points});
    }
    if (state.settings.showCompetitorMarkers !== false) {
      models.push({key:`marker:${competitorKey}`,kind:'marker',comp,freshness,opacity,points});
    }
  });
  mapEngine.layers.reconcile('competitors',models,{
    key:model=>model.key,
    fingerprint:model=>JSON.stringify({
      kind:model.kind,id:model.comp.id,name:model.comp.name,points:model.points,
      fresh:model.freshness.fresh,age:model.freshness.ageMinutes===null?null:Math.round(model.freshness.ageMinutes)
    }),
    create:model=>{
      if(model.kind==='trail'){
        const line=L.polyline(model.points.map(p=>[p.lat,p.lon]),{color:COLORS.competitor,weight:model.freshness.fresh?4:3,dashArray:model.freshness.fresh?null:'7 7',opacity:model.opacity});
        line.bindTooltip(`${model.comp.name||model.comp.id} · ${model.freshness.ageMinutes===null?'unknown age':`${Math.round(model.freshness.ageMinutes)} min old`}`);
        return line;
      }
      const last=model.points.at(-1);
      const marker=L.circleMarker([last.lat,last.lon],{radius:model.freshness.fresh?7:5,color:'#fff',weight:2,fillColor:COLORS.competitor,fillOpacity:model.opacity});
      marker.bindPopup(`<strong>${escapeHtml(model.comp.name||model.comp.id)}</strong><br>${escapeHtml(last.time||'Time unavailable')}<br>${model.freshness.fresh?'Fresh':'Stale or undated'} trail`);
      return marker;
    }
  });
  const followed=state.project.competitors.find(comp=>String(state.followedCompetitorId)===String(comp.id));
  const last=followed?.points?.at(-1);
  if(last)state.map.setView([last.lat,last.lon],Math.max(14,state.map.getZoom()));
}
function formatStationaryDuration(ms) {
  const minutes=Math.max(0,Math.floor(Number(ms||0)/60000)),hours=Math.floor(minutes/60);
  return hours?`${hours}h ${minutes%60}m`:`${minutes} min`;
}
function stationaryPopupHtml(event) {
  const distance=state.lastGpsPosition?window.CannonMapStationaryEvents.distanceMeters(state.lastGpsPosition,event.center)/1609.344:null;
  return `<section class="stationary-event-popup">
    <strong>${escapeHtml(event.signature)} · Stationary event</strong>
    <dl><dt>Competitor</dt><dd>${escapeHtml(event.competitorNumber||'—')} · ${escapeHtml(event.riderName)}</dd>
    <dt>Duration</dt><dd>${escapeHtml(formatStationaryDuration(event.durationMs))}</dd>
    <dt>Started</dt><dd>${escapeHtml(new Date(event.startTime).toLocaleString())}</dd>
    <dt>Last update</dt><dd>${escapeHtml(new Date(event.lastUpdateTime).toLocaleString())}</dd>
    <dt>Approx. radius</dt><dd>${Math.round(event.radiusMeters)} m</dd>
    ${distance===null?'':`<dt>Distance from you</dt><dd>${distance.toFixed(1)} mi</dd>`}</dl>
    <div class="stationary-event-actions">
      <button type="button" data-stationary-action="zoom">Zoom to event</button>
      <button type="button" data-stationary-action="follow">Follow rider</button>
      <button type="button" data-stationary-action="hide-trail">Hide rider trail</button>
      <button type="button" data-stationary-action="close">Close popup</button>
    </div>
    <small>Cause unknown. This marker does not classify fuel or any other cause.</small>
  </section>`;
}
function handleStationaryAction(action,event) {
  if(action==='zoom')window.CannonMapStationaryEvents.zoomToStationaryEvent(state.map,event);
  if(action==='follow')followCompetitor(event.competitorId);
  if(action==='hide-trail'){
    const competitor=state.project.competitors.find(item=>String(item.id)===String(event.competitorId));
    if(competitor){competitor.trailHidden=true;saveProject(false);renderCompetitors();}
  }
  if(action==='close')state.map.closePopup();
}
function followCompetitor(id) {
  state.followedCompetitorId=String(id);
  const competitor=state.project.competitors.find(item=>String(item.id)===String(id)),last=competitor?.points?.at(-1);
  if(last)state.map.setView([last.lat,last.lon],Math.max(14,state.map.getZoom()));
  setStatus(`Following ${competitor?.name||`Rider ${id}`}.`);
}
function renderStationaryEvents() {
  if(!window.CannonMapStationaryEvents){mapEngine.layers.clear('stationaryEvents');return;}
  const eventId=String(state.settings.rallyEventId||'');
  const events=window.CannonMapStationaryEvents.spreadNearbyEvents((state.project.stationaryEvents||[]).filter(event=>String(event.rallyEventId)===eventId&&!event.hidden));
  mapEngine.layers.reconcile('stationaryEvents',events,{
    key:event=>event.id,
    fingerprint:event=>JSON.stringify(event),
    create:event=>{
      const spec=window.CannonMapStationaryEvents.signatureIconSpec(event);
      const color=event.status==='active'?'#f59e0b':'#475569';
      const icon=L.divIcon({className:spec.className,html:`<div class="stationary-signature-face" title="${escapeHtml(spec.title)}" style="background:${color}">${escapeHtml(spec.label)}</div>`, iconSize:[spec.size,spec.size],iconAnchor:[spec.size/2,spec.size/2],popupAnchor:[0,-spec.size/2]});
      const marker=L.marker([event.displayCenter.lat,event.displayCenter.lon],{icon,riseOnHover:true,zIndexOffset:700});
      marker.bindPopup(stationaryPopupHtml(event),{maxWidth:330,closeButton:false});
      marker.on('popupopen',()=>{
        const popup=marker.getPopup().getElement();
        popup?.querySelectorAll('[data-stationary-action]').forEach(button=>button.addEventListener('click',()=>handleStationaryAction(button.dataset.stationaryAction,event)));
      });
      return marker;
    }
  });
}
function updateStationaryDetection() {
  if(!window.CannonMapStationaryEvents||!state.settings.rallyEventId)return;
  window.CannonMapStationaryEvents.updateStationaryEvents(state.project,String(state.settings.rallyEventId));
}
function renderLayerList() {
  const box = $('layerList');
  if(!box)return;
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
  if($('trackCount')) $('trackCount').textContent = visible.filter(f => f.type==='track').length;
  if($('routeCount')) $('routeCount').textContent = visible.filter(f => f.type==='route').length;
  if($('waypointCount')) $('waypointCount').textContent = visible.filter(f => ['waypoint','checkpoint','fuel','hotel'].includes(f.type)).length;
  if($('distanceTotal')) $('distanceTotal').textContent = `${planningMileage(visible).toFixed(1)} mi`;
}
function renderAll() {
  if($('projectName')) $('projectName').value=state.project.name;
  if($('dayFilter')) $('dayFilter').value=state.settings.dayFilter;
  const fields={
    inreachUrl:'inreachUrl', leaderboardUrl:'leaderboardUrl', rallyEndpointUrl:'rallyEndpointUrl', rallyEventId:'rallyEventId',
    rallyPollSeconds:'rallyPollSeconds', competitorFreshMinutes:'competitorFreshMinutes', trafficProvider:'trafficProvider',
    tomtomApiKey:'tomtomApiKey', wazeFeedUrl:'wazeFeedUrl'
  };
  Object.entries(fields).forEach(([key,id])=>{if($(id))$(id).value=state.settings[key]??'';});
  if($('showCompetitorTrails'))$('showCompetitorTrails').checked=state.settings.showCompetitorTrails!==false;
  if($('showCompetitorMarkers'))$('showCompetitorMarkers').checked=state.settings.showCompetitorMarkers!==false;
  renderMapFeatures(); renderLayerList(); renderStats(); renderCompetitorSummary(); renderMissionControl(); renderTypeLayerControls(); renderSearch(); renderIntelSummary(); renderRallyMode();
}
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
    const request=indexedDB.open(DB_NAME);
    request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(DB_STORE))db.createObjectStore(DB_STORE);};
    request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error||new Error('IndexedDB could not be opened.'));
  });
}
function saveProject(showMessage=true) {
  sanitizeProjectData(state.project,'save boundary');
  state.project.name=$('projectName')?.value.trim()||state.project.name||'CannonMap Project';
  state.project.version=APP_VERSION;state.project.updatedAt=new Date().toISOString();
  const clean=deepClean(state.project),settings=deepClean(state.settings);
  localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));
  const persist=async()=>{
    const activeProjectId=activeLifecycleProjectId;
    if(activeProjectId&&activeProjectId===clean.projectId){
      await projectLifecycle.saveActiveProject(clean);
    }else{
      const db=await openDatabase();
      await new Promise((resolve,reject)=>{const tx=db.transaction(DB_STORE,'readwrite');tx.objectStore(DB_STORE).put(clean,'current');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
      db.close();
    }
    if(showMessage)setStatus(`Saved locally at ${new Date().toLocaleTimeString()}.`);
  };
  const result=projectSaveQueue.then(persist);
  projectSaveQueue=result.catch(error=>setStatus(`Save failed: ${error.message}`,true));
  return result;
}
async function initializeMissionControlFoundations(){
  foundationDatabase=await openIndexedDbV2({
    indexedDB,featureFlags:{isEnabled:key=>key===V2_FEATURE_FLAG||featureFlags.isEnabled(key)}
  });
  const projectRepository=createProjectRepository({database:foundationDatabase,createId:uid,now:core.clock.iso});
  const journalRepository=createJournalRepository({database:foundationDatabase});
  const analyticsRepository=createAnalyticsRepository(foundationDatabase);
  const searchRepository=createSearchRepository({database:foundationDatabase});
  projectLifecycle=createProjectLifecycleManager({
    projectRepository,
    projectDeletionRepository:createProjectDeletionRepository({database:foundationDatabase}),
    lifecycleRepository:createProjectLifecycleRepository({database:foundationDatabase}),
    legacyCurrentRepository:createLegacyCurrentProjectRepository({database:foundationDatabase}),
    scopeFactory:projectId=>createProjectRepositoryScope({
      projectId,journalRepository,analyticsRepository,searchRepository
    }),
    eventBus:core.events,clock:core.clock,createId:uid
  });
  const activeProject=await projectLifecycle.initialize();
  if(activeProject){activeLifecycleProjectId=activeProject.projectId;state.project=sanitizeProjectData(activeProject,'active Project restore');}
  rallyJournal=createRallyJournalService({repository:journalRepository,createId:uid,clock:core.clock});
  missionMedia=createMissionMediaRepository({database:foundationDatabase,createId:uid,clock:core.clock});
  checkpointCamera=createCheckpointCameraWorkflow({
    mediaRepository:missionMedia,
    journal:rallyJournal,clock:core.clock,onState:renderCheckpointCameraState
  });
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
  return projectWorkflows.inferDay(text,fallback);
}
function nearestAssignedDay(point,lines) {
  return projectWorkflows.nearestAssignedDay(point,lines);
}
function assignLineDays(features) {
  return projectWorkflows.assignLineDays(features);
}
function assignWaypointDays(features,onlyUnassigned=true) {
  return projectWorkflows.assignWaypointDays(features,onlyUnassigned);
}
function classifyPoint(name,notes,sym='') {
  return projectWorkflows.classifyPoint(name,notes,sym);
}
function parseGpx(xmlText,filename) {
  return projectWorkflows.parseGpx(xmlText,filename);
}
function featureDuplicate(imported,existing) {
  return projectWorkflows.featureDuplicate(imported,existing);
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
  if($('importReport')) $('importReport').innerHTML=`
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
  $('importDialog')?.showModal();
}
async function applyPendingImport(mode) {
  const pending=state.pendingImport;if(!pending)return;
  createNamedSnapshot(`Before GPX ${mode}`,true);snapshot();
  const {added,updated,skipped,unassigned}=projectWorkflows.applyImport(state.project,pending.features,mode);
  state.project.projectId ||= uid();state.project.id=state.project.projectId;
  state.pendingImport=null;
  await saveProject(false);renderAll();fitMap();
  setStatus(`GPX ${mode}: ${added} added, ${updated} updated, ${skipped} skipped. ${unassigned} features remain unassigned.`);
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
  const payload=projectWorkflows.createPortableProject({project:state.project,settings:state.settings,appVersion:APP_VERSION,build:BUILD_ID,exportedAt:new Date().toISOString()});
  downloadBlob(JSON.stringify(payload,null,2),`${safeFilename(state.project.name)}.cmap`,'application/json');
  setStatus('Saved portable .cmap project file.');
}
async function openProjectFile(file) {
  try{
    const payload=JSON.parse(await file.text());
    const portable=projectWorkflows.readPortableProject(payload),project=portable.project;
    snapshot();
    state.project=sanitizeProjectData(project,`.cmap ${file.name}`);
    state.project.projectId ||= uid();
    state.project.version=APP_VERSION;
    if(portable.settings)Object.assign(state.settings,portable.settings);
    if(projectLifecycle){
      const exists=(await projectLifecycle.listProjects()).some(item=>item.projectId===state.project.projectId);
      if(exists){await projectLifecycle.openProject(state.project.projectId);await projectLifecycle.saveActiveProject(state.project);}
      else state.project=await projectLifecycle.createProject(state.project,{activate:true});
      activeLifecycleProjectId=state.project.projectId;
    }
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
  if($('missionProjectName')) $('missionProjectName').textContent=state.project.name;
  if($('missionUpdated')) $('missionUpdated').textContent=`Updated ${new Date(state.project.updatedAt||Date.now()).toLocaleString()}`;
  if($('missionFeatureCount')) $('missionFeatureCount').textContent=fs.length;
  if($('missionCheckpointCount')) $('missionCheckpointCount').textContent=fs.filter(f=>f.type==='checkpoint').length;
  if($('missionHotelCount')) $('missionHotelCount').textContent=fs.filter(f=>f.type==='hotel').length;
  if($('missionUnassignedCount')) $('missionUnassignedCount').textContent=fs.filter(f=>!f.day).length;
  if($('missionMileage')) $('missionMileage').textContent=`${miles.toFixed(1)} mi`;
  if($('dailyReadiness')){
    $('dailyReadiness').innerHTML=[1,2,3,4,5,6,7,8].map(day=>{
      const rows=fs.filter(f=>f.day===day);
      const cp=rows.filter(f=>f.type==='checkpoint').length;
      const hotel=rows.filter(f=>f.type==='hotel').length;
      const dm=planningMileage(rows);
      const score=Math.min(100,(rows.length?40:0)+(cp?25:0)+(hotel?20:0));
      return `<div class="day-card" data-day-card="${day}"><header><strong>Day ${day}</strong><span>${dm.toFixed(0)} mi</span></header><small>${cp} checkpoints · ${hotel} hotel · ${rows.length} features</small><div class="day-meter"><i style="width:${score}%"></i></div></div>`;
    }).join('');
    $('dailyReadiness').querySelectorAll('[data-day-card]').forEach(c=>c.onclick=()=>{state.settings.dayFilter=c.dataset.dayCard;$('dayFilter').value=state.settings.dayFilter;document.querySelector('[data-tab="project"]')?.click();saveProject(false);renderAll();});
  }
  renderSnapshots();
}
function renderTypeLayerControls(){const box=$('typeLayerControls');if(!box)return;const labels={track:'Tracks',route:'Routes',backbone:'Backbone',waypoint:'Waypoints',checkpoint:'Checkpoints',hotel:'Hotels'};box.innerHTML=Object.entries(labels).map(([type,label])=>`<label class="type-toggle"><input type="checkbox" data-type-visible="${type}" ${state.settings.typeVisibility?.[type]!==false?'checked':''}><span class="swatch" style="background:${COLORS[type]||'#64748b'}"></span>${label}</label>`).join('');box.querySelectorAll('[data-type-visible]').forEach(input=>input.onchange=()=>{state.settings.typeVisibility[input.dataset.typeVisible]=input.checked;saveProject(false);renderMapFeatures();});if($('lineOpacity'))$('lineOpacity').value=state.settings.lineOpacity||90;}
function renderSearch(){const box=$('searchResults');if(!box)return;const q=$('globalSearch')?.value.trim().toLowerCase()||'',type=$('searchType')?.value||'all',day=$('searchDay')?.value||'all';let rows=state.project.features.filter(f=>(type==='all'||f.type===type)&&(day==='all'||String(f.day||0)===day));if(q)rows=rows.filter(f=>`${f.name} ${f.notes||''} ${f.source||''}`.toLowerCase().includes(q));rows=rows.slice(0,100);if(!q&&type==='all'&&day==='all'){box.className='search-results empty';box.textContent='Enter a search term or choose filters.';return;}if(!rows.length){box.className='search-results empty';box.textContent='No matching features.';return;}box.className='search-results';box.innerHTML=rows.map(f=>`<button class="search-result" data-search-id="${f.id}"><strong>${f.favorite?'<span class="favorite-star">★</span> ':''}${escapeHtml(f.name)}</strong><small>${f.type} · ${f.day?`Day ${f.day}`:'Unassigned'}${f.notes?` · ${escapeHtml(f.notes.slice(0,90))}`:''}</small></button>`).join('');box.querySelectorAll('[data-search-id]').forEach(b=>b.onclick=()=>{selectFeature(b.dataset.searchId);zoomSelected();document.querySelector('[data-tab="features"]')?.click();});}
function openContextMenu(id,x,y){state.selectedId=id;const menu=$('contextMenu');if(!menu)return;menu.hidden=false;menu.style.left=`${Math.min(x,window.innerWidth-190)}px`;menu.style.top=`${Math.min(y,window.innerHeight-260)}px`;}
function closeContextMenu(){const menu=$('contextMenu');if(menu)menu.hidden=true;}
function reverseSelected(){const f=state.project.features.find(x=>x.id===state.selectedId);if(!f||f.geometry.kind!=='line')return setStatus('Only routes and tracks can be reversed.');snapshot();f.geometry.coordinates.reverse();f.updatedAt=new Date().toISOString();saveProject(false);renderAll();selectFeature(f.id);setStatus(`Reversed ${f.name}.`);}
function toggleFavorite(){const f=state.project.features.find(x=>x.id===state.selectedId);if(!f)return;snapshot();f.favorite=!f.favorite;saveProject(false);renderAll();setStatus(`${f.favorite?'Favorited':'Removed favorite from'} ${f.name}.`);}
function clearSelection() {
  stopEditing();
  state.selectedId=null; if($('selectedFeatureId')) $('selectedFeatureId').value='';
  ['featureName','featureType','featureDay','featureNotes','featureLatitude','featureLongitude'].forEach(id=>{if($(id))$(id).disabled=true;});
  ['updateFeatureButton','zoomFeatureButton','duplicateFeatureButton','deleteFeatureButton','editGeometryButton','stopEditButton'].forEach(id=>{if($(id))$(id).disabled=true;});
}
function populateFeatureForm(feature) {
  if($('selectedFeatureId')) $('selectedFeatureId').value=feature.id;
  if($('featureName')) $('featureName').value=feature.name;
  if($('featureType')) $('featureType').value=feature.type;
  if($('featureDay')) $('featureDay').value=String(feature.day||0);
  if($('featureNotes')) $('featureNotes').value=feature.notes||'';
  const isPoint=feature.geometry.kind==='point';
  if($('pointCoordinates')) $('pointCoordinates').classList.toggle('hidden',!isPoint);
  if(isPoint){if($('featureLatitude')) $('featureLatitude').value=feature.geometry.coordinates[0].lat.toFixed(6);if($('featureLongitude')) $('featureLongitude').value=feature.geometry.coordinates[0].lon.toFixed(6);}
  ['featureName','featureType','featureDay','featureNotes'].forEach(id=>{if($(id))$(id).disabled=false;});
  if($('featureLatitude')) $('featureLatitude').disabled=!isPoint;if($('featureLongitude')) $('featureLongitude').disabled=!isPoint;
  ['updateFeatureButton','zoomFeatureButton','duplicateFeatureButton','deleteFeatureButton','editGeometryButton'].forEach(id=>{if($(id))$(id).disabled=false;});
}
function selectFeature(id) {
  stopEditing();
  const feature=state.project.features.find(f=>f.id===id);if(!feature)return;
  state.selectedId=id;populateFeatureForm(feature);
  document.querySelectorAll('.tab,.panel').forEach(el=>el.classList.remove('active'));
  document.querySelector('[data-tab="features"]')?.classList.add('active');$('featuresPanel')?.classList.add('active');
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
  if($('stopEditButton')) $('stopEditButton').disabled=false;
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
  const copy=projectWorkflows.duplicateFeature(feature);state.project.features.push(copy);
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
  mapEngine.fitLayerType('features');
}

function safeFilename(name){return String(name||'cannonmap').trim().replace(/[^a-z0-9_-]+/gi,'-').replace(/^-|-$/g,'').toLowerCase();}
function downloadBlob(content,filename,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),500);}
function exportGpx() {
  const fs=state.project.features.filter(featureMatchesDay);
  const xml=projectWorkflows.buildGpx({project:state.project,features:fs,appVersion:APP_VERSION,exportedAt:new Date().toISOString()});
  downloadBlob(xml,`${safeFilename(state.project.name)}${state.settings.dayFilter==='all'?'':`-day-${state.settings.dayFilter}`}.gpx`,'application/gpx+xml');setStatus(`Exported ${fs.length} features to GPX.`);
}
function manifestRows() {
  return projectWorkflows.buildManifestRows(state.project.features.filter(featureMatchesDay));
}
function exportExcel() {
  if(typeof XLSX==='undefined')return setStatus('SheetJS dependency is unavailable. Reload CannonMap to restore Excel export.',true);
  const manifest=manifestRows(),wb=XLSX.utils.book_new();
  const add=(name,rows)=>{const ws=XLSX.utils.json_to_sheet(rows.length?rows:[{Message:'No records'}]);ws['!autofilter']={ref:ws['!ref']};ws['!freeze']={xSplit:0,ySplit:1};ws['!cols']=[18,10,34,14,14,14,12,14,12,45,28,10,20,24].map(w=>({wch:w}));XLSX.utils.book_append_sheet(wb,ws,name);};
  add('Master Manifest',manifest);
  add('Daily Summary',[1,2,3,4,5,6,7,8].map(day=>{const rows=manifest.filter(r=>r.Day===day);return {Day:day,Features:rows.length,Checkpoints:rows.filter(r=>r.Type==='checkpoint').length,Routes:rows.filter(r=>r.Type==='route').length,Tracks:rows.filter(r=>r.Type==='track').length,'Line Miles':Number(rows.reduce((s,r)=>s+(Number(r['Distance (mi)'])||0),0).toFixed(2))};}));
  for(const [sheet,type] of [['Checkpoints','checkpoint'],['Routes','route'],['Tracks','track'],['Backbone','backbone'],['Hotels','hotel'],['Waypoints','waypoint']])add(sheet,manifest.filter(r=>r.Type===type));
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
  if(!navigator.geolocation){
    setStatus('This browser does not support GPS.',true);
    return;
  }
  if(state.gpsWatchId!==null){
    navigator.geolocation.clearWatch(state.gpsWatchId);
    state.gpsWatchId=null;
    stopRallyAnalytics('gps-stopped');
    if($('gpsButton')) $('gpsButton').textContent='Start GPS';
    if($('gpsStatus')) $('gpsStatus').textContent='GPS off';
    rallyDebug.record('follow_mode_changed',{enabled:false,reason:'gps-stopped'});
    renderRallyMode();
    return;
  }
  if($('gpsStatus')) $('gpsStatus').textContent='GPS starting…';
  if($('gpsButton')) $('gpsButton').textContent='Stop GPS';
  renderRallyMode();
  startRallyAnalytics();
  gpsFollow?.restore('gps-started');
  state.gpsWatchId=navigator.geolocation.watchPosition(position=>{
    rallyDebug.record('gps_update_received',{accuracyFeet:position.coords.accuracy*3.28084,timestamp:new Date(position.timestamp||Date.now()).toISOString()});
    const followed=gpsFollow?.update({lat:position.coords.latitude,lon:position.coords.longitude,heading:position.coords.heading});
    const ll=[followed?.lat??position.coords.latitude,followed?.lon??position.coords.longitude];
    const accuracyFeet=position.coords.accuracy*3.28084;
    state.lastGpsPosition={lat:ll[0],lon:ll[1],heading:followed?.heading??null,accuracyFeet,elevationFeet:Number.isFinite(position.coords.altitude)?position.coords.altitude*3.28084:null,time:new Date(position.timestamp||Date.now()).toISOString()};
    state.gpsLayer?.remove();
    state.gpsAccuracyLayer?.remove();
    state.gpsAccuracyLayer=L.circle(ll,{radius:position.coords.accuracy,color:'#38bdf8',weight:1,fillOpacity:.08}).addTo(state.map);
    state.gpsLayer=L.circleMarker(ll,{radius:8,color:'#fff',weight:3,fillColor:'#38bdf8',fillOpacity:1,className:'rider-position-marker'}).addTo(state.map);
    state.gpsLayer.getElement()?.classList.add('rider-position-marker');
    if($('gpsStatus')) $('gpsStatus').textContent=`GPS ±${Math.round(accuracyFeet)} ft`;
    ensureNextCheckpoint();
    evaluateCheckpointArrival(accuracyFeet);
    renderRallyMode();
    captureGpsObservation(position);
    recordRallyTelemetry(position);
  },error=>{
    state.gpsWatchId=null;
    stopRallyAnalytics('gps-error');
    if($('gpsButton')) $('gpsButton').textContent='Start GPS';
    if($('gpsStatus')) $('gpsStatus').textContent='GPS off';
    setStatus(`GPS error: ${error.message}`,true);
    rallyDebug.record('gps_error',{code:error.code,message:error.message});
    renderRallyMode();
  },{enableHighAccuracy:true,maximumAge:2000,timeout:15000});
}
function observationContext(overrides={}){
  return {
    eventId:String(state.settings.rallyEventId||'local'),
    riderId:'local-rider',
    checkpointId:currentCheckpoint()?.id||null,
    deviceSessionId:observationSessionId,
    sequence:++observationSequence,
    captureSource:'browser.geolocation',
    ...overrides
  };
}
async function captureGpsObservation(position,context){
  if(!observationCapture)return {status:'disabled'};
  return observationCapture.capture(position,context||observationContext());
}
function analyticsRouteProgress(){
  const checkpoint=currentCheckpoint();
  return {
    activeDay:activeRallyDay(),checkpointId:checkpoint?.id||null,
    checkpointSequence:checkpoint?.sequence??null,distanceToCheckpointMiles:distanceFromCurrent(checkpoint)
  };
}
async function startRallyAnalytics(){
  if(!rallyAnalytics)return {status:'disabled'};
  try{return await rallyAnalytics.startSession({
    rallyEventId:String(state.settings.rallyEventId||'local'),riderId:'local-rider',
    extensions:{projectName:state.project.name||'',captureLifecycle:'gps-watch'}
  });}catch(error){console.warn(`[CannonMap analytics] Session start failed: ${error?.message||error}`);return {status:'failed'};}
}
async function stopRallyAnalytics(reason){
  if(!rallyAnalytics)return {status:'disabled'};
  try{return await rallyAnalytics.stopSession({reason});}catch(error){console.warn(`[CannonMap analytics] Session stop failed: ${error?.message||error}`);return {status:'failed'};}
}
async function recordRallyTelemetry(position){
  if(!rallyAnalytics)return {status:'disabled'};
  try{return await rallyAnalytics.recordGpsSample(position,{routeProgress:analyticsRouteProgress()});}
  catch(error){console.warn(`[CannonMap analytics] GPS sample failed: ${error?.message||error}`);return {status:'failed'};}
}
function recordAnalyticsCheckpoint(checkpoint,action){
  rallyAnalytics?.recordCheckpointEvent({
    checkpointId:checkpoint.id,action,points:checkpoint.points,
    extensions:{day:checkpoint.day??null,sequence:checkpoint.sequence??null,type:checkpoint.type||'checkpoint'}
  }).catch(error=>console.warn(`[CannonMap analytics] Checkpoint event failed: ${error?.message||error}`));
}
async function initializeMissionControlFoundationsWithRetry(attempts=3){
  let failure=null;
  for(let attempt=1;attempt<=attempts;attempt+=1){
    try{return await initializeMissionControlFoundations();}
    catch(error){failure=error;if(attempt<attempts)await new Promise(resolve=>setTimeout(resolve,100*attempt));}
  }
  throw failure||new Error('Mission Control foundations are unavailable.');
}
function rallyExecution(){return state.project.rallyExecution||={schemaVersion:1,days:{}};}
function reconcileCompletedRallyDays(){
  let changed=false;
  for(const dayState of Object.values(rallyExecution().days||{})){
    if(dayState?.status!=='complete')continue;
    const nextDay=checkpoints.nextRallyDay(state.project,Number(dayState.dayNumber));
    if(Number(dayState.nextDay)!==nextDay){dayState.nextDay=nextDay;changed=true;}
  }
  return changed;
}
function rallyDayState(day=activeRallyDay()){
  const normalizedDay=Number(day)||state.project.features.map(feature=>Number(feature.day)).filter(Boolean).sort((a,b)=>a-b)[0]||1,execution=rallyExecution(),key=String(normalizedDay);
  const dayState=execution.days[key]||=( {dayNumber:normalizedDay,dayId:`day-${normalizedDay}`,status:'active',startedAt:new Date().toISOString(),completedAt:null,nextDay:0,summary:null} );
  if(dayState.status==='complete')dayState.nextDay=checkpoints.nextRallyDay(state.project,normalizedDay);
  return dayState;
}
async function appendRallyJournalEvent(eventType,checkpoint,metadata={},timestamp=new Date().toISOString()){
  if(!rallyJournal||!state.project.projectId)return null;
  const day=Number(checkpoint?.day)||activeRallyDay(),dayState=rallyDayState(day);
  const identity=metadata.eventIdentity||`${eventType}:${checkpoint?.id||'day'}:${day}:${metadata.transitionAt||timestamp}`;
  try{
    const event=await rallyJournal.appendEventIdempotent({
      eventId:stableUuid(`${state.project.projectId}:${identity}`),projectId:state.project.projectId,timestamp,eventType,source:metadata.source||'mission_control',
      title:metadata.title||checkpoint?.name||`Day ${day}`,summary:metadata.summary||'',
      metadata:{rallyId:String(state.settings.rallyEventId||state.project.projectId),dayId:dayState.dayId,dayNumber:day,dayStartTimestamp:dayState.startedAt,
        objectiveId:checkpoint?.id||null,objectiveType:checkpoint?.type||null,checkpointId:checkpoint?.id||null,riderNotes:checkpoint?.notes||'',
        photoRequired:Boolean(checkpoint?.photoRequired),gpsAccuracyFeet:state.lastGpsPosition?.accuracyFeet??null,
        collectionCoordinates:state.lastGpsPosition?{lat:state.lastGpsPosition.lat,lon:state.lastGpsPosition.lon}:null,...metadata},
      references:{checkpointId:checkpoint?.id||null,dayId:dayState.dayId},attachments:{}
    });
    rallyDebug.record('journal_write_success',{eventType,eventId:event.eventId,checkpointId:checkpoint?.id||null});return event;
  }catch(error){rallyDebug.record('journal_write_failure',{eventType,checkpointId:checkpoint?.id||null,error:error?.message||String(error)});throw error;}
}
function recordJournalCheckpoint(checkpoint,automatic){
  const hotel=checkpoint.type==='hotel',timestamp=checkpoint.completedAt||new Date().toISOString();
  return appendRallyJournalEvent(hotel?'hotel_arrival':'checkpoint_completed',checkpoint,{
    eventIdentity:`collected:${checkpoint.id}`,source:automatic?'gps_capture':'manual_fallback',checkpointArrivalTimestamp:checkpoint.arrivedAt,
    checkpointCollectedTimestamp:timestamp,objectiveCompletion:true,points:Number(checkpoint.points)||0,score:rallyScore(),
    title:checkpoint.name,summary:automatic?'Captured automatically inside the configured GPS radius.':'Completed with the manual fallback control.'
  },timestamp).catch(error=>{console.warn(`[CannonMap journal] Checkpoint event failed: ${error?.message||error}`);return null;});
}
function renderCheckpointCameraState(cameraState){
  const section=$('rallyCameraWorkflow');if(!section)return;
  const active=cameraState&&cameraState.status!=='idle';section.hidden=!active;
  if(cameraCountdownTimer){clearInterval(cameraCountdownTimer);cameraCountdownTimer=null;}
  if(!active)return;
  const update=()=>{const seconds=Math.max(0,Math.ceil((cameraState.deadline-Date.now())/1000));if($('rallyCameraCountdown'))$('rallyCameraCountdown').textContent=String(seconds);};
  update();cameraCountdownTimer=setInterval(update,1000);
  if($('rallyCameraPhotoCount'))$('rallyCameraPhotoCount').textContent=cameraState.photos.length?`${cameraState.photos.length} photo${cameraState.photos.length===1?'':'s'} captured`:'No photos captured';
  if($('rallyCameraError')){$('rallyCameraError').textContent=cameraState.error||'';$('rallyCameraError').hidden=!cameraState.error;}
  if($('rallyCameraRetry'))$('rallyCameraRetry').hidden=!['failed','awaiting_photo'].includes(cameraState.status);
}
async function addCheckpointCameraFiles(files){
  if(!files?.length||!checkpointCamera)return;
  try{
    const photos=await checkpointCamera.addFiles(files);if($('rallyCameraInput'))$('rallyCameraInput').value='';
    rallyDebug.record('photo_completed',{checkpointId:pendingPhotoCheckpointId,count:photos.length});
    if(pendingPhotoCheckpointId&&photos.length){
      const checkpoint=state.project.features.find(feature=>feature.id===pendingPhotoCheckpointId);
      if(checkpoint?.photoRequired)await finalizePendingPhotoCheckpoint();else{checkpointCamera.finish();pendingPhotoCheckpointId=null;}
    }
  }catch(error){
    const checkpoint=state.project.features.find(feature=>feature.id===pendingPhotoCheckpointId);
    rallyDebug.record('photo_failed',{checkpointId:pendingPhotoCheckpointId,error:error.message});
    if(checkpoint)await appendRallyJournalEvent('photo_failed',checkpoint,{eventIdentity:`photo-failed:${checkpoint.id}`,photoRequired:Boolean(checkpoint.photoRequired),photoStatus:'failed',failureReason:error.message});
    setStatus(`Photo capture failed: ${error.message}`,true);
  }
}
async function cancelCheckpointCamera(){
  const checkpoint=state.project.features.find(feature=>feature.id===pendingPhotoCheckpointId);
  checkpointCamera?.cancel();rallyDebug.record('photo_failed',{checkpointId:pendingPhotoCheckpointId,reason:'canceled'});
  if(checkpoint)await appendRallyJournalEvent('photo_canceled',checkpoint,{eventIdentity:`photo-canceled:${checkpoint.id}`,photoRequired:Boolean(checkpoint.photoRequired),photoStatus:'canceled'});
}
async function rideExportSnapshot(){return rideExportSource?.snapshot()||null;}
async function missionControlJournalEvents(){
  if(!rallyJournal||!state.project.projectId)return [];
  return (await rallyJournal.getProjectJournal(state.project.projectId)).events;
}
async function initializeObservationCapture(){
  if(!featureFlags.isEnabled(OBSERVATION_CAPTURE_FEATURE_FLAG))return null;
  observationDatabase=await openIndexedDbV2({
    indexedDB,
    featureFlags:{isEnabled:key=>key===V2_FEATURE_FLAG||featureFlags.isEnabled(key)}
  });
  observationRepository=createObservationCaptureRepository(observationDatabase);
  observationCapture=createObservationCapture({
    clock:core.clock,
    featureFlags,
    persistence:observationRepository
  });
  await observationCapture.recover();
  return observationCapture;
}
async function initializeSecureObservationIngestion(){
  if(!featureFlags.isEnabled(SECURE_INGESTION_FEATURE_FLAG))return null;
  if(!observationCapture||!observationRepository)throw new Error('Local observation capture must be initialized before secure ingestion.');
  secureObservationUploader=createSecureObservationUploader({
    featureFlags,
    clock:core.clock,
    observations:observationRepository,
    authentication:createFirebaseAuthentication({
      firebase:globalThis.firebase,
      config:globalThis.__CANNONMAP_FIREBASE_CONFIG__,
      appCheckSiteKey:globalThis.__CANNONMAP_APP_CHECK_SITE_KEY__
    }),
    transport:createObservationIngressClient({endpoint:globalThis.__CANNONMAP_SECURE_INGESTION_URL__})
  });
  await secureObservationUploader.initialize();
  return secureObservationUploader;
}
async function initializeRallyAnalytics(){
  if(!featureFlags.isEnabled(RALLY_ANALYTICS_FEATURE_FLAG))return null;
  analyticsDatabase=observationDatabase||await openIndexedDbV2({
    indexedDB,
    featureFlags:{isEnabled:key=>key===V2_FEATURE_FLAG||featureFlags.isEnabled(key)}
  });
  rallyAnalytics=createRallyAnalyticsService({
    clock:core.clock,createId:uid,featureFlags,
    persistence:projectLifecycle?.getActiveRepositories()?.analytics||createAnalyticsRepository(analyticsDatabase)
  });
  await rallyAnalytics.recover({rallyEventId:String(state.settings.rallyEventId||'local')});
  return rallyAnalytics;
}
async function replaySecureObservations(options){
  if(!observationCapture||!secureObservationUploader)return {status:'disabled',delivered:0};
  return observationCapture.replay({deliver:item=>secureObservationUploader.deliver(item),...options});
}
function observationCaptureDiagnostics(){
  return {
    enabled:featureFlags.isEnabled(OBSERVATION_CAPTURE_FEATURE_FLAG),
    initialized:Boolean(observationCapture),
    secureIngestionEnabled:featureFlags.isEnabled(SECURE_INGESTION_FEATURE_FLAG),
    secureIngestionInitialized:Boolean(secureObservationUploader),
    entries:observationCapture?.diagnostics()||[]
  };
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
  const box=$('competitorSummary');if(!box)return;if(!state.project.competitors.length){box.className='layer-list empty';box.textContent='No competitor data loaded.';return;}
  box.className='layer-list';box.innerHTML=state.project.competitors.map(c=>{const fresh=competitorFreshness(c);const age=fresh.ageMinutes===null?'undated':`${Math.round(fresh.ageMinutes)} min`;return `<div class="layer-row"><span class="swatch" style="background:${fresh.fresh?COLORS.competitor:'#64748b'}"></span><button type="button" data-rider-id="${escapeHtml(c.id)}"><strong>${escapeHtml(c.name)}</strong><small>${c.points.length} breadcrumbs · ${age}</small></button><span class="fresh-dot ${fresh.fresh?'is-fresh':''}" title="${fresh.fresh?'Fresh':'Stale'}"></span></div>`;}).join('');
  box.querySelectorAll('[data-rider-id]').forEach(button=>button.onclick=()=>zoomCompetitor(button.dataset.riderId));
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
    if(next.number!==undefined&&next.number!==null)current.number=next.number;
    if(next.signature)current.signature=next.signature;
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
    updateStationaryDetection();
    state.rallySync.lastSync=new Date().toISOString();state.rallySync.pointsAdded=result.added;state.rallySync.lastError='';
    await saveProject(false);renderMapFeatures();renderCompetitorSummary();renderIntelSummary();
    setStatus(`Trail sync complete: ${incoming.length} riders, ${result.added} new breadcrumbs.`);
  }catch(error){
    state.rallySync.lastError=error.name==='AbortError'?'Feed request timed out.':error.message;
    setStatus(`Trail sync failed: ${state.rallySync.lastError}`,true);renderIntelSummary();
  }finally{state.rallySync.running=false;renderIntelSummary();}
}
function stopRallyPolling() {
  if(state.rallyLiveFeed){state.rallyLiveFeed.stop();state.rallyLiveFeed=null;}
  if(state.rallyPollTimer){clearInterval(state.rallyPollTimer);state.rallyPollTimer=null;}
  if($('toggleRallyPollingButton'))$('toggleRallyPollingButton').textContent='Start live polling';
  renderIntelSummary();
}
async function toggleRallyPolling() {
  if(state.rallyLiveFeed||state.rallyPollTimer){stopRallyPolling();setStatus('Live trail sync stopped.');return;}
  if(!state.settings.rallyEndpointUrl&&window.GPSCheckpointsFeed&&state.settings.rallyEventId){
    const feed=window.GPSCheckpointsFeed.createGPSCheckpointsFeed({eventId:state.settings.rallyEventId});
    feed.on('snapshot',async payload=>{
      const standingById=new Map((payload.standings||[]).map(row=>[String(row.id),row]));
      const incoming=normalizeCompetitorPayload({locations:payload.locations}).map(competitor=>{
        const standing=standingById.get(String(competitor.id));
        return {...competitor,number:standing?.number,signature:window.CannonMapStationaryEvents?.competitorSignature({id:competitor.id,number:standing?.number,name:competitor.name})};
      });
      const result=mergeCompetitorData(incoming);
      updateStationaryDetection();
      state.rallySync.lastSync=new Date().toISOString();state.rallySync.pointsAdded=result.added;state.rallySync.lastError='';
      await saveProject(false);renderMapFeatures();renderCompetitorSummary();renderIntelSummary();
    });
    feed.on('error',detail=>{state.rallySync.lastError=detail.error?.message||'Live feed error.';renderIntelSummary();});
    state.rallyLiveFeed=feed;state.rallySync.running=true;renderIntelSummary();
    await feed.start();
    state.rallySync.running=false;if($('toggleRallyPollingButton'))$('toggleRallyPollingButton').textContent='Stop live sync';
    setStatus('Official GPS Checkpoints live feed connected.');renderIntelSummary();return;
  }
  if(!state.settings.rallyEndpointUrl)return syncRallyFeed();
  await syncRallyFeed();
  if(state.rallySync.lastError)return;
  const seconds=Math.max(10,Number(state.settings.rallyPollSeconds)||30);
  state.rallyPollTimer=setInterval(syncRallyFeed,seconds*1000);
  if($('toggleRallyPollingButton'))$('toggleRallyPollingButton').textContent='Stop live polling';
  setStatus(`Live trail polling started every ${seconds} seconds.`);renderIntelSummary();
}
function saveIntegrationSettings() {
  state.settings.inreachUrl=$('inreachUrl')?.value.trim()||'';
  state.settings.leaderboardUrl=$('leaderboardUrl')?.value.trim()||'';
  state.settings.rallyEndpointUrl=$('rallyEndpointUrl')?.value.trim()||'';
  state.settings.rallyEventId=$('rallyEventId')?.value.trim()||'';
  state.settings.rallyPollSeconds=Number($('rallyPollSeconds')?.value)||30;
  state.settings.competitorFreshMinutes=Number($('competitorFreshMinutes')?.value)||15;
  state.settings.showCompetitorTrails=$('showCompetitorTrails')?.checked!==false;
  state.settings.showCompetitorMarkers=$('showCompetitorMarkers')?.checked!==false;
  state.settings.trafficProvider=$('trafficProvider')?.value||'none';
  state.settings.tomtomApiKey=$('tomtomApiKey')?.value.trim()||'';
  state.settings.wazeFeedUrl=$('wazeFeedUrl')?.value.trim()||'';
  saveProject(true);renderMapFeatures();renderIntelSummary();
}
function openLeaderboard() {
  const url=(state.settings.leaderboardUrl||$('leaderboardUrl')?.value||'').trim();
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
  mapEngine.fitLayerTypes(['competitors','stationaryEvents','traffic','weather']);
}
function clearIntelligenceLayers() {
  for(const type of ['competitors','stationaryEvents','traffic','weather'])mapEngine.layers.clear(type);
  state.weatherData=null;state.weatherPoint=null;state.trafficIncidents=[];hideRadar();
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
  if($('weatherSummary')){$('weatherSummary').className='intel-card loading';$('weatherSummary').textContent='Loading weather…';}
  try{
    const params=new URLSearchParams({latitude:point.lat.toFixed(5),longitude:point.lon.toFixed(5),current:'temperature_2m,apparent_temperature,precipitation,rain,weather_code,wind_speed_10m,wind_gusts_10m',hourly:'temperature_2m,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m',forecast_hours:'6',temperature_unit:'fahrenheit',wind_speed_unit:'mph',precipitation_unit:'inch',timezone:'auto'});
    const response=await fetchWithTimeout(`https://api.open-meteo.com/v1/forecast?${params}`);
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const data=await response.json();
    state.weatherData=data;state.weatherPoint=point;renderWeather();renderIntelSummary();setStatus(`Weather loaded for ${point.label}.`);
    rallyAnalytics?.recordWeatherSnapshot(data.current||{},{
      location:{latitude:point.lat,longitude:point.lon,label:point.label},
      extensions:{units:data.current_units||{},source:'open-meteo'}
    }).catch(error=>console.warn(`[CannonMap analytics] Weather snapshot failed: ${error?.message||error}`));
  }catch(error){if($('weatherSummary')){$('weatherSummary').className='intel-card error';$('weatherSummary').textContent=`Weather failed: ${error.message}`;}setStatus(`Weather failed: ${error.message}`,true);}
}
function renderWeather() {
  const data=state.weatherData,point=state.weatherPoint;
  if(!data||!point){mapEngine.layers.clear('weather');return;}
  const current=data.current||{};const hourly=data.hourly||{};
  const precip=Array.isArray(hourly.precipitation_probability)?Math.max(...hourly.precipitation_probability.filter(Number.isFinite),0):0;
  const gusts=weatherMaxGustMph(data);
  const condition=WEATHER_CODES[current.weather_code]||`Code ${current.weather_code??'—'}`;
  const warning=(current.weather_code>=95||precip>=60||gusts>=35);
  const html=`<strong>${Math.round(current.temperature_2m??0)}°F · ${escapeHtml(condition)}</strong><small>Feels ${Math.round(current.apparent_temperature??current.temperature_2m??0)}°F · Wind ${Math.round(current.wind_speed_10m??0)} mph · Gusts up to ${Math.round(gusts)} mph · Rain chance ${Math.round(precip)}%</small>${warning?'<em>Weather could affect the next decision.</em>':''}`;
  if($('weatherSummary')){$('weatherSummary').className=`intel-card${warning?' warning':''}`;$('weatherSummary').innerHTML=html;}
  mapEngine.layers.reconcile('weather',[{key:'current',point,current,condition,gusts,precip}],{
    key:model=>model.key,
    fingerprint:model=>JSON.stringify(model),
    create:model=>{
      const marker=L.circleMarker([model.point.lat,model.point.lon],{radius:9,color:'#fff',weight:2,fillColor:COLORS.weather,fillOpacity:.95});
      marker.bindPopup(`<strong>${escapeHtml(model.point.label)}</strong><br>${Math.round(model.current.temperature_2m??0)}°F · ${escapeHtml(model.condition)}<br>Gusts ${Math.round(model.gusts)} mph · Rain ${Math.round(model.precip)}%`);
      return marker;
    }
  });
}
function weatherMaxGustMph(data) {
  const current=Number(data?.current?.wind_gusts_10m)||0;
  const hourly=Array.isArray(data?.hourly?.wind_gusts_10m)?data.hourly.wind_gusts_10m.filter(Number.isFinite):[];
  return Math.max(...hourly,current);
}
function clearWeather() {state.weatherData=null;state.weatherPoint=null;mapEngine.layers.clear('weather');if($('weatherSummary')){$('weatherSummary').className='intel-card empty';$('weatherSummary').textContent='No weather loaded.';}renderIntelSummary();}

const RAINVIEWER_MAPS_URL='https://api.rainviewer.com/public/weather-maps.json';
function radarTileUrl(frame) {return `${frame.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;}
function radarFrameTime(frame) {return new Date(Number(frame.time)*1000);}
async function showRadar() {
  if($('radarSummary')){$('radarSummary').className='intel-card loading';$('radarSummary').textContent='Loading recent radar frames…';}
  try{
    const response=await fetchWithTimeout(RAINVIEWER_MAPS_URL);
    if(!response.ok)throw new Error(`RainViewer HTTP ${response.status}`);
    const data=await response.json();
    const host=String(data.host||'');const frames=(data.radar?.past||[]).filter(frame=>frame?.path&&Number.isFinite(Number(frame.time))).map(frame=>({...frame,host}));
    if(!host||!frames.length)throw new Error('No radar frames are currently available.');
    state.radarFrames=frames;state.radarFrameIndex=frames.length-1;renderRadarFrame();
    if($('radarPlayButton')) $('radarPlayButton').disabled=frames.length<2;
    if($('radarToggleButton')) $('radarToggleButton').textContent='Hide radar';
    setStatus('Weather radar loaded.');
  }catch(error){hideRadar(false);if($('radarSummary')){$('radarSummary').className='intel-card error';$('radarSummary').textContent=`Radar failed: ${error.message}`;}setStatus(`Radar failed: ${error.message}`,true);}
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
  if($('radarSummary')){$('radarSummary').className='intel-card';$('radarSummary').innerHTML=`<strong>Radar ${escapeHtml(time.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}))}</strong><small>Recent observed precipitation · frame ${state.radarFrameIndex+1} of ${state.radarFrames.length} · ${escapeHtml(radarCoverageLabel())}</small>`;}
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
  if(state.radarPlaying)return stopRadarLoop();if(state.radarFrames.length<2)return;state.radarPlaying=true;if($('radarPlayButton'))$('radarPlayButton').textContent='Pause loop';transitionRadarFrame(0);
}
function hideRadar(save=true) {
  stopRadarLoop();if(state.radarLayer&&state.map)state.map.removeLayer(state.radarLayer);state.radarLayer=null;state.radarFrames=[];state.radarFrameIndex=-1;
  if($('radarToggleButton'))$('radarToggleButton').textContent='Show radar';if($('radarPlayButton'))$('radarPlayButton').disabled=true;
  if($('radarSummary')){$('radarSummary').className='intel-card empty';$('radarSummary').textContent='Weather radar is off.';}
  if(save)saveProject(false);
}
function toggleRadar() {if(state.radarLayer)hideRadar();else showRadar();}
function setRadarOpacity() {state.settings.radarOpacity=Number($('radarOpacity')?.value)||65;state.radarLayer?.setOpacity(state.settings.radarOpacity/100);saveProject(false);}
function setRadarCoverage() {state.settings.radarCoverage=$('radarCoverage')?.value||'active-day';saveProject(false);if(state.radarLayer){stopRadarLoop();renderRadarFrame();setStatus(`Radar limited to ${radarCoverageLabel()}.`);}}
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
  const speed=Number($('routeWeatherSpeed')?.value)||45;state.settings.routeWeatherSpeed=speed;saveProject(false);
  if($('routeWeatherSummary')){$('routeWeatherSummary').className='intel-card loading';$('routeWeatherSummary').textContent='Checking rain along the track…';}
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
    if($('routeWeatherSummary')){
      const firstHazard=hazards[0];const hazardText=firstHazard?hazards.slice(0,3).map(item=>`<em>${item.arrivalMinutes} min / ${item.miles.toFixed(0)} mi ahead: ${escapeHtml(item.labels.join(', '))}.</em>`).join(''):'<small>No unusual wind, precipitation, temperature, snow, storm, visibility, dust, air-quality, or UV hazard detected at sampled points.</small>';
      $('routeWeatherSummary').className=`intel-card${wet||firstHazard?' warning':''}`;
      $('routeWeatherSummary').innerHTML=(wet?`<strong>Rain likely in about ${wet.arrivalMinutes} minutes</strong><small>Approximately ${wet.miles.toFixed(0)} miles ahead on ${escapeHtml(feature.name)} at ${speed} mph. First wet sample: ${wet.precipitation.toFixed(2)} in/15 min. Estimated rainfall exposure across sampled track: ${totalRain.toFixed(2)} in.</small>`:`<strong>No rain indicated along the sampled track</strong><small>${escapeHtml(feature.name)} · next ${Math.round(miles)} miles sampled at ${speed} mph · estimated rainfall exposure ${totalRain.toFixed(2)} in.</small>`)+hazardText+'<small>Forecast estimate only—check radar, alerts, and current conditions.</small>';
    }
    setStatus(`Route rain outlook checked for ${feature.name}.`);
  }catch(error){setRouteWeatherError(`Route weather failed: ${error.message}`);}
}
function setRouteWeatherError(message) {if($('routeWeatherSummary')){$('routeWeatherSummary').className='intel-card error';$('routeWeatherSummary').textContent=message;}setStatus(message,true);}
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
  state.settings.trafficProvider=$('trafficProvider')?.value||'none';state.settings.tomtomApiKey=$('tomtomApiKey')?.value.trim()||'';state.settings.wazeFeedUrl=$('wazeFeedUrl')?.value.trim()||'';saveProject(false);
  if(state.settings.trafficProvider==='none')return setStatus('Choose TomTom or Waze for Cities first.',true);
  if($('trafficSummary')){$('trafficSummary').className='intel-card loading';$('trafficSummary').textContent='Loading traffic…';}
  try{
    if(state.settings.trafficProvider==='tomtom')await loadTomTomTraffic();else await loadWazeTraffic();
    renderTraffic();renderIntelSummary();setStatus(`Loaded ${state.trafficIncidents.length} traffic incidents.`);
  }catch(error){if($('trafficSummary')){$('trafficSummary').className='intel-card error';$('trafficSummary').textContent=`Traffic failed: ${error.message}`;}setStatus(`Traffic failed: ${error.message}`,true);}
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
  let severe=0;
  const models=state.trafficIncidents.map((incident,index)=>{
    const geometry=incident.geometry;if(!['Point','LineString'].includes(geometry?.type))return null;const p=incident.properties||{};const category=Number(p.iconCategory);if([1,8,11].includes(category))severe++;
    return {key:String(p.id||incident.id||index),incident,geometry,p,category};
  }).filter(Boolean);
  mapEngine.layers.reconcile('traffic',models,{
    key:model=>model.key,
    fingerprint:model=>JSON.stringify(model.incident),
    create:model=>{
      const style=trafficStyle(model.category);let layer;
      if(model.geometry.type==='Point')layer=L.circleMarker([model.geometry.coordinates[1],model.geometry.coordinates[0]],{radius:7,color:'#fff',weight:2,fillColor:style.fillColor,fillOpacity:.95});
      else if(model.geometry.type==='LineString')layer=L.polyline(model.geometry.coordinates.map(pair=>[pair[1],pair[0]]),{color:style.color,weight:6,opacity:.8});
      if(!layer)return null;
      const description=model.p.events?.[0]?.description||TRAFFIC_CATEGORY[model.category]||String(model.p.iconCategory||'Traffic incident');const delay=Number(model.p.delay)||0;const road=[model.p.from,model.p.to].filter(Boolean).join(' → ')||model.p.roadNumbers?.join(', ')||'';
      layer.bindPopup(`<strong>${escapeHtml(description)}</strong><br>${escapeHtml(road)}${delay?`<br>Reported delay: ${Math.round(delay/60)} min`:''}<br><small>${escapeHtml(model.incident.source||'Traffic provider')}</small>`);
      return layer;
    }
  });
  if($('trafficSummary')){$('trafficSummary').className=`intel-card${severe?' warning':''}`;$('trafficSummary').innerHTML=`<strong>${state.trafficIncidents.length} current incidents</strong><small>${severe} severe · Map viewport only · ${escapeHtml(state.settings.trafficProvider==='tomtom'?'TomTom':'Waze for Cities')}</small>`;}
}
function clearTraffic() {state.trafficIncidents=[];mapEngine.layers.clear('traffic');if($('trafficSummary')){$('trafficSummary').className='intel-card empty';$('trafficSummary').textContent='No traffic loaded.';}renderIntelSummary();}

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
function activeRallyDay(){return checkpoints.activeRallyDay(state.settings);}
function dayCheckpoints(){return checkpoints.dayCheckpoints(state.project,state.settings);}
function moveCheckpointInOrder(id,direction){const rows=dayCheckpoints();snapshot();const moved=checkpoints.moveCheckpoint(rows,id,direction);if(!moved){state.history.pop();return;}saveProject(false);renderAll();setStatus(`Moved ${moved.name} ${direction<0?'earlier':'later'} in the checkpoint order.`);}
function makeCheckpointNext(id){const rows=dayCheckpoints();snapshot();const target=checkpoints.makeCheckpointNext(rows,id,new Date().toISOString());if(!target){state.history.pop();return;}state.selectedId=target.id;saveProject(false);renderAll();setStatus(`${target.name} is now the next checkpoint.`);}
function restoreImportedCheckpointOrder(){const rows=dayCheckpoints();if(!rows.length)return;snapshot();checkpoints.restoreImportedOrder(rows);saveProject(false);renderAll();setStatus('Restored the imported checkpoint order for this day.');}
function currentCheckpoint(){return checkpoints.currentCheckpoint(state.project,state.settings);}
function currentHotel(){return checkpoints.currentHotel(state.project,state.settings);}
function distanceFromCurrent(feature){const point=feature?.geometry?.coordinates?.[0];const from=state.lastGpsPosition;if(!point||!from)return null;return haversine(from,point)/1609.344;}
function rallyScore(){return checkpoints.rallyScore(state.project);}
function hotelEta(){const hotel=currentHotel(),miles=distanceFromCurrent(hotel);if(miles===null)return {hotel,miles:null,label:'Hotel ETA —'};const minutes=miles/(Number(state.settings.routeWeatherSpeed)||45)*60;return {hotel,miles,label:`Hotel ${miles.toFixed(0)} mi · ${new Date(Date.now()+minutes*60000).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}`};}
function navigationGuidance(next,distance){
  if(!next)return rallyDayState(activeRallyDay()).status==='complete'?'Day Complete':'No objectives available';
  const explicit=next.navigationGuidance||next.routeInstruction||next.turnInstruction;if(explicit)return String(explicit);
  if(distance===null)return 'Navigation position unavailable';
  const feet=Math.round(distance*5280),radius=Math.max(100,Number(state.settings.checkpointArrivalRadius)||500);
  if(feet<=radius)return 'Checkpoint Ahead';
  return feet<1000?`Continue ${feet}'`:`Continue ${distance.toFixed(1)} mi`;
}
function cannonRouteStatus(next){
  const explicit=next?.routeIntelligence||next?.cannonRouteIntelligence;if(explicit)return String(explicit);
  if(!navigator.onLine)return 'Offline Navigation';
  if(next?.followingRider)return `Following Rider ${next.followingRider}`;
  if(next?.cannonRouteActive)return 'Dynamic Route';
  return next?'Backbone Route Active':'';
}
function warningVisible(warning,next){
  const item=state.settings.missionWarningSuppressions?.[warning.id];if(!item)return true;
  if(item.mode==='dismiss')return item.signature!==warning.message;
  if(item.mode==='until'&&Number(item.until)>Date.now())return false;
  if(item.mode==='checkpoint'&&item.checkpointId===next?.id)return false;
  return true;
}
function currentOperationalWarnings(next){
  const warnings=[];
  if(!navigator.onLine)warnings.push({id:'offline',message:'Offline — live intelligence is paused.'});
  if(/error/i.test($('gpsStatus')?.textContent||''))warnings.push({id:'gps',message:'GPS unavailable — automatic capture may require manual completion.'});
  if(state.trafficIncidents.length)warnings.push({id:'traffic',message:`${state.trafficIncidents.length} traffic alert${state.trafficIncidents.length===1?'':'s'} nearby.`});
  if(Number(state.weatherData?.current?.weather_code)>=51)warnings.push({id:'weather',message:'Active weather may affect the approach.'});
  return warnings.filter(warning=>warningVisible(warning,next));
}
function suppressWarning(id,action){
  const warning=currentOperationalWarnings(currentCheckpoint()).find(item=>item.id===id);if(!warning)return;
  const suppressions=state.settings.missionWarningSuppressions||={};
  if(action==='dismiss')suppressions[id]={mode:'dismiss',signature:warning.message};
  else if(action==='checkpoint')suppressions[id]={mode:'checkpoint',checkpointId:currentCheckpoint()?.id||null};
  else suppressions[id]={mode:'until',until:Date.now()+Number(action)*60000};
  saveProject(false);renderRallyMode();
}
function renderRallyMode(){
  const next=currentCheckpoint(),hotel=hotelEta(),last=state.rallySync.lastSync,rows=dayCheckpoints(),distance=distanceFromCurrent(next);
  const dayState=rallyDayState(activeRallyDay());
  const deferredCount=rows.filter(feature=>feature.type!=='hotel'&&feature.status==='deferred').length;
  const hasRunnable=rows.some(feature=>feature.type!=='hotel'&&[checkpoints.CHECKPOINT_STATE.UPCOMING,checkpoints.CHECKPOINT_STATE.ACTIVE,checkpoints.CHECKPOINT_STATE.PHOTO_REQUIRED].includes(feature.status));
  presentRally({getElement:$,escapeHtml,model:{
    day:activeRallyDay(),online:navigator.onLine,gpsStatus:$('gpsStatus')?.textContent||'GPS off',
    gpsAccuracy:state.lastGpsPosition?`GPS ±${Math.round(state.lastGpsPosition.accuracyFeet)} ft`:'GPS off',
    elevation:Number.isFinite(state.lastGpsPosition?.elevationFeet)?`Elev ${Math.round(state.lastGpsPosition.elevationFeet).toLocaleString()} ft`:'Elev —',
    gpsActive:state.gpsWatchId!==null,followMode:gpsFollow?.state().mode||'following',score:rallyScore(),next,distance,navigationGuidance:navigationGuidance(next,distance),
    emptyLabel:dayState.status==='complete'?'Day Complete':rows.length?'No objectives available':'Rally ready',hotelLabel:hotel.label,feedAge:last?`Feed ${formatClock(last)}`:'Feed never updated',
    deferredCount,showDeferredPrompt:deferredCount>0&&!hasRunnable&&!next,hasHotel:Boolean(hotel.hotel),hotelBailoutActive:state.hotelBailoutActive,
    autoComplete:state.settings.autoCompleteCheckpoints!==false,arrivalRadius:state.settings.checkpointArrivalRadius||500,maxAccuracy:state.settings.checkpointMaxAccuracy||200,
    checkpoints:rows,hasPlanned:rows.some(feature=>feature.status===checkpoints.CHECKPOINT_STATE.UPCOMING),warnings:currentOperationalWarnings(next),
    routeIntelligence:cannonRouteStatus(next),dayComplete:dayState.status==='complete',nextDay:dayState.nextDay,daySummary:dayState.summary
  }});
}
function setRallyMoreOpen(open){$('rallyMode')?.classList.toggle('more-open',open);$('rallyMoreSheet')?.setAttribute('aria-hidden',String(!open));$('rallyMoreButton')?.setAttribute('aria-expanded',String(open));if($('rallyMoreButton'))$('rallyMoreButton').textContent=open?'Close':'More';}
function activateNextPlannedCheckpoint(){const next=checkpoints.activateNextPlanned(dayCheckpoints());if(next)state.selectedId=next.id;return next;}
function ensureNextCheckpoint(){
  if(rallyDayState(activeRallyDay()).status==='complete')return null;
  if(dayCheckpoints().some(feature=>[checkpoints.CHECKPOINT_STATE.ACTIVE,checkpoints.CHECKPOINT_STATE.PHOTO_REQUIRED].includes(feature.status)))return currentCheckpoint();
  const next=activateNextPlannedCheckpoint();if(next){saveProject(false);rallyDebug.record('objective_selected',{objectiveId:next.id,day:activeRallyDay(),reason:'next-upcoming'});}return next;
}
function checkpointDiagnostic(checkpoint,priorState,newState,distanceFeet,radius,accuracyFeet,decision,rejectionReason=''){
  rallyDebug.record('checkpoint_collection_decision',{checkpointId:checkpoint?.id||null,priorState,newState,activeObjectiveId:currentCheckpoint()?.id||null,
    distanceFeet:Number.isFinite(distanceFeet)?Math.round(distanceFeet):null,collectionRadiusFeet:radius,gpsAccuracyFeet:Number.isFinite(accuracyFeet)?Math.round(accuracyFeet):null,decision,rejectionReason});
}
function evaluateCheckpointArrival(accuracyFeet){
  if(state.settings.autoCompleteCheckpoints===false)return;
  const checkpoint=ensureNextCheckpoint(),radius=Math.max(100,Number(state.settings.checkpointArrivalRadius)||500),maxAccuracy=Math.max(25,Number(state.settings.checkpointMaxAccuracy)||200);
  if(!checkpoint){rallyDebug.record('objective_selection_failed',{reason:rallyDayState(activeRallyDay()).status==='complete'?'day-complete':'no-objective'});return;}
  if(checkpoint.status===checkpoints.CHECKPOINT_STATE.PHOTO_REQUIRED)return;
  const distance=distanceFromCurrent(checkpoint),distanceFeet=distance===null?null:distance*5280,prior=checkpoint.status;
  const result=evaluateArrivalSample({checkpointId:checkpoint.id,distanceFeet,accuracyFeet,radiusFeet:radius,maxAccuracyFeet:maxAccuracy,
    candidate:state.arrivalCandidateId?{checkpointId:state.arrivalCandidateId,enteredAt:state.arrivalEnteredAt}:null,now:Date.now()});
  state.arrivalCandidateId=result.candidate?.checkpointId||null;state.arrivalEnteredAt=result.candidate?.enteredAt||0;
  checkpointDiagnostic(checkpoint,prior,result.decision==='accepted'?(checkpoint.photoRequired?checkpoints.CHECKPOINT_STATE.PHOTO_REQUIRED:checkpoints.CHECKPOINT_STATE.COLLECTED):prior,distanceFeet,radius,accuracyFeet,result.decision,result.reason);
  if(result.decision==='accepted')completeCurrentCheckpoint(true);
}
function selectNextCheckpoint(){const rows=dayCheckpoints();snapshot();const next=checkpoints.selectNext(rows);if(next){state.selectedId=next.id;const point=next.geometry.coordinates[0];state.map.setView([point.lat,point.lon],14);setStatus(`${next.name} is the next checkpoint.`);}else setStatus('No planned checkpoints remain for the active day.');saveProject(false);renderAll();}
async function finalizeDay(checkpoint){
  const day=Number(checkpoint?.day)||activeRallyDay(),rows=dayCheckpoints(),dayState=rallyDayState(day);if(dayState.status==='complete')return dayState;
  await rallyAnalytics?.flush?.();const completedAt=new Date().toISOString(),summary={
    totalCollected:rows.filter(item=>item.status===checkpoints.CHECKPOINT_STATE.COLLECTED).length,
    totalDeferred:rows.filter(item=>item.status===checkpoints.CHECKPOINT_STATE.DEFERRED).length,
    score:rallyScore(),distanceTraveledMiles:rallyAnalytics?.snapshot?.()?.metrics?.distanceMiles??null
  };
  dayState.status='complete';dayState.completedAt=completedAt;dayState.nextDay=checkpoints.nextRallyDay(state.project,day);dayState.summary=summary;
  await appendRallyJournalEvent('day_finished',checkpoint,{eventIdentity:`day-finished:${day}`,dayCompletionTimestamp:completedAt,...summary,
    title:`Day ${day} Complete`,summary:`Day finalized${checkpoint?` at ${checkpoint.name}`:''}.`},completedAt);
  await saveProject(false);rallyDebug.record('day_finalized',{day,nextDay:dayState.nextDay,...summary});renderAll();return dayState;
}
async function beginPhotoWorkflow(checkpoint,automatic){
  if(!checkpointCamera||!rallyJournal)throw new Error('The durable photo and Journal services are unavailable. Reload CannonMap and retry this checkpoint.');
  const timestamp=checkpoint.arrivedAt||new Date().toISOString();
  const arrival=await appendRallyJournalEvent('checkpoint_arrival',checkpoint,{eventIdentity:`arrival:${checkpoint.id}`,checkpointArrivalTimestamp:timestamp,
    photoRequired:Boolean(checkpoint.photoRequired),photoStatus:checkpoint.photoStatus,source:automatic?'gps_capture':'manual_fallback',summary:'Checkpoint arrival recorded.'},timestamp);
  pendingPhotoCheckpointId=checkpoint.id;rallyDebug.record('photo_requested',{checkpointId:checkpoint.id,required:Boolean(checkpoint.photoRequired)});
  checkpointCamera?.start({projectId:state.project.projectId,checkpoint,journalEvent:arrival,required:Boolean(checkpoint.photoRequired)});setTimeout(()=>$('rallyCameraInput')?.click(),0);
}
async function finalizePendingPhotoCheckpoint(){
  const checkpoint=state.project.features.find(feature=>feature.id===pendingPhotoCheckpointId);if(!checkpoint)return;
  const result=checkpointCamera?.finish();if(!result)return;pendingPhotoCheckpointId=null;await completeCurrentCheckpoint(true,{photoRecorded:true,checkpoint});
}
async function completeCurrentCheckpoint(automatic=false,{photoRecorded=false,checkpoint:specified}={}){
  if(checkpointCompletionInFlight)return;
  const checkpoint=specified||currentCheckpoint();if(!checkpoint||checkpoint.status===checkpoints.CHECKPOINT_STATE.COLLECTED)return setStatus('No active checkpoint.',true);
  checkpointCompletionInFlight=true;
  try{
    snapshot();const rows=dayCheckpoints(),now=new Date().toISOString(),priorState=checkpoint.status;
    if(checkpoint.status===checkpoints.CHECKPOINT_STATE.UPCOMING)checkpoint.status=checkpoints.CHECKPOINT_STATE.ACTIVE;
    if(!checkpoint.arrivedAt){checkpoints.recordArrival(checkpoint,now);await appendRallyJournalEvent('checkpoint_arrival',checkpoint,{eventIdentity:`arrival:${checkpoint.id}`,checkpointArrivalTimestamp:checkpoint.arrivedAt,source:automatic?'gps_capture':'manual_fallback',summary:'Checkpoint arrival recorded.'},checkpoint.arrivedAt);}
    rallyDebug.record('checkpoint_state_transition',{checkpointId:checkpoint.id,priorState,newState:checkpoint.status,activeObjectiveId:checkpoint.id,reason:'arrival'});
    if(checkpoint.photoRequired&&!photoRecorded){await saveProject(false);renderAll();await beginPhotoWorkflow(checkpoint,automatic);setStatus(`Photo required for ${checkpoint.name}.`);return;}
    const next=checkpoints.completeCheckpoint(rows,checkpoint,now,{photoRecorded});if(checkpoint.status!==checkpoints.CHECKPOINT_STATE.COLLECTED)return;
    rallyDebug.record('checkpoint_state_transition',{checkpointId:checkpoint.id,priorState,newState:checkpoint.status,activeObjectiveId:checkpoint.id,reason:'collected'});
    recordAnalyticsCheckpoint(checkpoint,'completed');await recordJournalCheckpoint(checkpoint,automatic);rallyDebug.record('objective_completed',{objectiveId:checkpoint.id,type:checkpoint.type});
    if(!checkpoint.photoRequired&&automatic)await beginPhotoWorkflow(checkpoint,automatic);
    if(checkpoint.type==='hotel'||(!next&&!rows.some(item=>item.status===checkpoints.CHECKPOINT_STATE.DEFERRED))){await finalizeDay(checkpoint);setStatus(`Day ${activeRallyDay()} complete.`);return;}
    if(next){state.selectedId=next.id;rallyDebug.record('objective_selected',{objectiveId:next.id,day:activeRallyDay(),reason:'prior-completed'});}
    await saveProject(false);renderAll();setStatus(`${automatic?'Arrival detected. ':''}Completed ${checkpoint.name}.${next?` Next: ${next.name}.`:''}`);
  }finally{checkpointCompletionInFlight=false;}
}
async function deferCurrentCheckpoint(reason='Rider deferred'){
  const checkpoint=currentCheckpoint();if(!checkpoint)return setStatus('No active checkpoint.',true);if(checkpoint.type==='hotel')return setStatus('The official hotel is mandatory and cannot be deferred.',true);
  snapshot();const prior=checkpoint.status,now=new Date().toISOString(),next=checkpoints.deferCheckpoint(dayCheckpoints(),checkpoint,reason,now);if(!next&&checkpoint.status!==checkpoints.CHECKPOINT_STATE.DEFERRED)return;
  recordAnalyticsCheckpoint(checkpoint,'deferred');await appendRallyJournalEvent('checkpoint_deferred',checkpoint,{eventIdentity:`deferred:${checkpoint.id}:${now}`,deferredStatus:true,deferredAt:now,transitionAt:now,reason});
  rallyDebug.record('deferred_action',{checkpointId:checkpoint.id,priorState:prior,newState:checkpoint.status,nextObjectiveId:next?.id||null});if(next)state.selectedId=next.id;await saveProject(false);renderAll();setStatus(`Deferred ${checkpoint.name}; it remains in the daily sequence.${next?` Next: ${next.name}.`:''}`);
}
async function resumeDeferredQueue(){
  const now=new Date().toISOString(),checkpoint=checkpoints.resumeDeferred(dayCheckpoints(),now);if(!checkpoint)return;
  state.selectedId=checkpoint.id;await appendRallyJournalEvent('checkpoint_resumed',checkpoint,{eventIdentity:`resumed:${checkpoint.id}:${now}`,resumedDeferredStatus:true,resumedAt:now,transitionAt:now});
  rallyDebug.record('deferred_action',{action:'resume',checkpointId:checkpoint.id,newState:checkpoint.status});await saveProject(false);renderAll();setStatus(`Resumed deferred checkpoint ${checkpoint.name}.`);
}
async function finishDayFromDeferredQueue(){
  const rows=dayCheckpoints(),now=new Date().toISOString(),unresolved=rows.filter(item=>item.status===checkpoints.CHECKPOINT_STATE.DEFERRED),hotel=checkpoints.finishDayWithHotel(rows,now);
  if(!hotel)return setStatus('No official hotel is assigned to this day.',true);
  await appendRallyJournalEvent('deferred_finish_decision',hotel,{eventIdentity:`finish-deferred:${activeRallyDay()}`,transitionAt:now,deferredCheckpointIds:unresolved.map(item=>item.id),totalDeferred:unresolved.length,summary:'Rider chose to finish the day with deferred checkpoints uncollected.'},now);
  rallyDebug.record('finish_action',{day:activeRallyDay(),deferredCheckpointIds:unresolved.map(item=>item.id),hotelId:hotel.id});state.selectedId=hotel.id;await saveProject(false);renderAll();setStatus(`Proceed to mandatory hotel: ${hotel.name}. Deferred checkpoints remain uncollected.`);
}
async function startNextRallyDay(){
  const currentDay=activeRallyDay(),completed=rallyDayState(currentDay),nextDay=checkpoints.nextRallyDay(state.project,currentDay);
  completed.nextDay=nextDay;if(completed.status!=='complete'||!nextDay)return null;
  const next=checkpoints.startRallyDay(state.project,state.settings,nextDay);if(!next)return setStatus(`Day ${nextDay} could not be started.`,true);
  const dayState=rallyDayState(nextDay);dayState.status='active';dayState.startedAt=new Date().toISOString();state.selectedId=next.id;if($('dayFilter'))$('dayFilter').value=String(nextDay);
  await appendRallyJournalEvent('day_started',next,{eventIdentity:`day-started:${nextDay}`,dayStartTimestamp:dayState.startedAt,title:`Day ${nextDay} Started`},dayState.startedAt);
  rallyDebug.record('next_day_request',{day:nextDay,accepted:true});await saveProject(false);renderAll();setTimeout(()=>{fitMap();gpsFollow?.restore('day-started');},0);return next;
}
function launchNavigation(feature){const point=feature?.geometry?.coordinates?.[0];if(!point)return;window.open(`https://www.google.com/maps/dir/?api=1&destination=${point.lat},${point.lon}`,'_blank','noopener,noreferrer');}
async function goToHotel(){
  const hotel=currentHotel();if(!hotel)return setStatus('No hotel is assigned to the active day.',true);const info=hotelEta();if(!confirm(`Go to ${hotel.name}? ${info.miles===null?'Distance unavailable':`${info.miles.toFixed(1)} miles`}. Unfinished checkpoints will be deferred, not deleted.`))return;
  snapshot();const now=new Date().toISOString(),deferred=checkpoints.deferForHotel(dayCheckpoints(),now);state.hotelBailoutActive=true;
  await Promise.all(deferred.map(checkpoint=>appendRallyJournalEvent('checkpoint_deferred',checkpoint,{eventIdentity:`hotel-bailout:${checkpoint.id}:${now}`,deferredStatus:true,deferredAt:now,transitionAt:now,reason:'Hotel bailout'})));
  rallyDebug.record('finish_action',{action:'hotel-bailout',hotelId:hotel.id,deferredCheckpointIds:deferred.map(item=>item.id)});await saveProject(false);renderAll();launchNavigation(hotel);setStatus(`Hotel bailout active. Unfinished checkpoints were deferred. Tap Undo Hotel Bailout to reverse.`);
}
function toggleHotelBailout(){if(state.hotelBailoutActive)return undo();return goToHotel();}
function setIntelSheetOpen(open) {
  const sheet=$('intelSheet');if(!sheet)return;sheet.classList.toggle('open',open);sheet.setAttribute('aria-hidden',String(!open));$('intelButton')?.setAttribute('aria-expanded',String(open));
}
function newProject() {
  if(!confirm('Create a new empty project? The currently saved local project will be replaced.'))return;
  createNamedSnapshot('Before new project',true);snapshot();state.project={version:APP_VERSION,name:'America 250 – 2026',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),features:[],competitors:[]};clearIntelligenceLayers();
  clearSelection();saveProject(false);renderAll();setStatus('New project created.');
}
function setSidebarOpen(open) {
  $('sidebar')?.classList.toggle('open',open);$('sidebarBackdrop')?.classList.toggle('visible',open);$('sidebarToggle')?.setAttribute('aria-expanded',String(open));if($('sidebarToggle'))$('sidebarToggle').textContent=open?'Close':'Planner';
}
function wireUi() {
  document.querySelectorAll('.tab').forEach(tab=>tab.addEventListener('click',()=>{document.querySelectorAll('.tab,.panel').forEach(el=>el.classList.remove('active'));tab.classList.add('active');$(`${tab.dataset.tab}Panel`)?.classList.add('active');}));
  $('sidebarToggle')?.addEventListener('click',()=>setSidebarOpen(!$('sidebar').classList.contains('open')));
  $('sidebarClose')?.addEventListener('click',()=>setSidebarOpen(false));
  $('sidebarBackdrop')?.addEventListener('click',()=>setSidebarOpen(false));
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){setSidebarOpen(false);setIntelSheetOpen(false);}});
  wireProjectController({getElement:$,actions:{
    importGpx:importGpxFiles,openProject:openProjectFile,saveProject,exportProject:exportProjectFile,reassignDays:reassignExistingDays,
    exportGpx,exportExcel,exportCsv,applyImport:applyPendingImport,cancelImport:()=>state.pendingImport=null
  }});
  $('missionFitButton')?.addEventListener('click',fitMap);
  $('missionUnassignedButton')?.addEventListener('click',()=>{state.settings.dayFilter='0';if($('dayFilter'))$('dayFilter').value='0';document.querySelector('[data-tab="project"]')?.click();saveProject(false);renderAll();});
  $('missionSnapshotButton')?.addEventListener('click',()=>createNamedSnapshot('Manual snapshot'));
  ['globalSearch','searchType','searchDay'].forEach(id=>$(id)?.addEventListener(id==='globalSearch'?'input':'change',renderSearch));
  $('lineOpacity')?.addEventListener('input',()=>{state.settings.lineOpacity=Number($('lineOpacity').value);renderMapFeatures();});
  $('lineOpacity')?.addEventListener('change',()=>saveProject(false));
  document.addEventListener('click',event=>{if(!$('contextMenu')?.contains(event.target))closeContextMenu();});
  $('contextMenu')?.querySelectorAll('[data-context]').forEach(btn=>btn.addEventListener('click',()=>{const a=btn.dataset.context;closeContextMenu();if(a==='zoom')zoomSelected();if(a==='edit'){selectFeature(state.selectedId);editSelectedGeometry();}if(a==='duplicate')duplicateSelected();if(a==='reverse')reverseSelected();if(a==='favorite')toggleFavorite();if(a==='delete')deleteSelected();}));
  $('fitButton')?.addEventListener('click',fitMap);
  $('newProjectButton')?.addEventListener('click',newProject);
  $('gpsButton')?.addEventListener('click',startGps);
  $('projectName')?.addEventListener('change',()=>saveProject(false));
  $('dayFilter')?.addEventListener('change',()=>{state.settings.dayFilter=$('dayFilter').value;saveProject(false);renderAll();});
  $('featureForm')?.addEventListener('submit',updateSelectedFeature);
  $('zoomFeatureButton')?.addEventListener('click',zoomSelected);
  $('duplicateFeatureButton')?.addEventListener('click',duplicateSelected);
  $('deleteFeatureButton')?.addEventListener('click',deleteSelected);
  $('editGeometryButton')?.addEventListener('click',editSelectedGeometry);
  $('stopEditButton')?.addEventListener('click',()=>{stopEditing();renderAll();selectFeature(state.selectedId);setStatus('Geometry edit saved.');});
  $('undoButton')?.addEventListener('click',undo);
  $('bulkAssignButton')?.addEventListener('click',bulkAssign);
  $('saveTrackingSettings')?.addEventListener('click',saveIntegrationSettings);
  $('openLeaderboardButton')?.addEventListener('click',openLeaderboard);
  $('syncRallyButton')?.addEventListener('click',syncRallyFeed);
  $('toggleRallyPollingButton')?.addEventListener('click',toggleRallyPolling);
  $('exportCompetitorButton')?.addEventListener('click',exportCompetitorData);
  $('clearCompetitorButton')?.addEventListener('click',clearCompetitors);
  $('showCompetitorTrails')?.addEventListener('change',()=>{state.settings.showCompetitorTrails=$('showCompetitorTrails').checked;saveProject(false);renderCompetitors();});
  $('showCompetitorMarkers')?.addEventListener('change',()=>{state.settings.showCompetitorMarkers=$('showCompetitorMarkers').checked;saveProject(false);renderCompetitors();});
  $('competitorFreshMinutes')?.addEventListener('change',()=>{state.settings.competitorFreshMinutes=Number($('competitorFreshMinutes').value)||15;saveProject(false);renderCompetitors();renderCompetitorSummary();renderIntelSummary();});
  $('weatherHereButton')?.addEventListener('click',loadWeatherHere);
  $('clearWeatherButton')?.addEventListener('click',clearWeather);
  $('radarToggleButton')?.addEventListener('click',toggleRadar);
  $('radarPlayButton')?.addEventListener('click',toggleRadarLoop);
  $('radarOpacity')?.addEventListener('input',setRadarOpacity);
  $('radarCoverage')?.addEventListener('change',setRadarCoverage);
  $('routeWeatherButton')?.addEventListener('click',loadRouteWeather);
  $('routeWeatherSpeed')?.addEventListener('change',()=>{state.settings.routeWeatherSpeed=Number($('routeWeatherSpeed').value)||45;saveProject(false);});
  $('trafficHereButton')?.addEventListener('click',loadTrafficHere);
  $('openWazeButton')?.addEventListener('click',openWazeAtMapCenter);
  $('clearTrafficButton')?.addEventListener('click',clearTraffic);
  $('trafficProvider')?.addEventListener('change',()=>{state.settings.trafficProvider=$('trafficProvider').value;saveProject(false);});
  $('competitorInput')?.addEventListener('change',e=>{if(e.target.files[0])importCompetitorJson(e.target.files[0]);e.target.value='';});
  $('intelButton')?.addEventListener('click',()=>setIntelSheetOpen(!$('intelSheet').classList.contains('open')));
  $('intelCloseButton')?.addEventListener('click',()=>setIntelSheetOpen(false));
  $('mobileSyncButton')?.addEventListener('click',syncRallyFeed);
  $('mobileWeatherButton')?.addEventListener('click',loadWeatherHere);
  $('mobileTrafficButton')?.addEventListener('click',loadTrafficHere);
  wireRallyController({getElement:$,actions:{
    selectNext:selectNextCheckpoint,setIntelOpen:setIntelSheetOpen,defer:()=>deferCurrentCheckpoint(),
    focusHotel:()=>{const hotel=currentHotel();if(hotel){const point=hotel.geometry.coordinates[0];state.map.setView([point.lat,point.lon],14);setRallyMoreOpen(false);}else setStatus('No hotel is assigned to the active day.',true);},
    center:()=>{if(state.lastGpsPosition)gpsFollow?.restore('gps-button');else fitMap();},
    startGps,
    toggleMore:()=>setRallyMoreOpen(!$('rallyMode').classList.contains('more-open')),
    openPlanner:()=>{setRallyMoreOpen(false);setSidebarOpen(true);},toggleHotelBailout,
    complete:()=>completeCurrentCheckpoint(false),resumeDeferred:resumeDeferredQueue,finishDay:finishDayFromDeferredQueue,
    addCameraFiles:addCheckpointCameraFiles,cancelCamera:cancelCheckpointCamera,retryCamera:()=>checkpointCamera?.retry(),startNextDay:startNextRallyDay,warning:suppressWarning,
    exportDebug:()=>downloadBlob(rallyDebug.exportJson(),`${safeFilename(state.project.name)}-rally-debug.json`,'application/json'),
    exportJournal:async()=>downloadBlob(JSON.stringify(await missionControlJournalEvents(),null,2),`${safeFilename(state.project.name)}-daily-journal.json`,'application/json'),
    saveArrivalSettings:()=>{state.settings.autoCompleteCheckpoints=$('autoCompleteCheckpoints')?.checked!==false;state.settings.checkpointArrivalRadius=Math.max(100,Number($('checkpointArrivalRadius')?.value)||500);state.settings.checkpointMaxAccuracy=Math.max(25,Number($('checkpointMaxAccuracy')?.value)||200);saveProject(false);renderRallyMode();},
    order:(id,action)=>{if(action==='up')moveCheckpointInOrder(id,-1);else if(action==='down')moveCheckpointInOrder(id,1);else if(action==='next')makeCheckpointNext(id);},
    resetOrder:restoreImportedCheckpointOrder,render:renderRallyMode
  }});
  $('createDialog')?.addEventListener('close',()=>{if($('createDialog').returnValue!=='default'&&state.pendingLayer){state.pendingLayer.remove();state.pendingLayer=null;}});
  $('createForm')?.addEventListener('submit',event=>{
    event.preventDefault();
    if(event.submitter&&event.submitter.value==='cancel'){state.pendingLayer?.remove();state.pendingLayer=null;$('createDialog')?.close('cancel');return;}
    if(!state.pendingLayer)return;snapshot();
    const feature=normalizeCheckpoint({id:uid(),name:$('createName')?.value.trim()||'New feature',type:$('createType')?.value||'track',day:Number($('createDay')?.value)||0,assignmentMethod:'manual',notes:$('createNotes')?.value.trim()||'',visible:true,source:'CannonMap drawing',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),geometry:layerToGeometry(state.pendingLayer)},state.project.features.length);
    state.pendingLayer.remove();state.pendingLayer=null;state.project.features.push(feature);saveProject(false);renderAll();selectFeature(feature.id);$('createDialog')?.close('default');setStatus(`Created ${feature.name}.`);
  });
}
async function initializeApplication() {
  await loadProject();
  await initializeMissionControlFoundationsWithRetry();
  state.project.features.forEach(f=>{f.assignmentMethod ||= '';f.favorite ||= false;});
  state.settings.typeVisibility=Object.assign({track:true,route:true,backbone:true,waypoint:true,checkpoint:true,fuel:true,hotel:true},state.settings.typeVisibility||{});
  state.settings=Object.assign({leaderboardUrl:'https://gpscheckpoints.com/admin/leaderboard.html?id_event=15',rallyEndpointUrl:'',rallyEventId:'15',rallyPollSeconds:30,showCompetitorTrails:true,showCompetitorMarkers:true,competitorFreshMinutes:15,trafficProvider:'none',tomtomApiKey:'',wazeFeedUrl:'',radarOpacity:65,radarCoverage:'active-day',routeWeatherSpeed:45,usableFuelCapacity:0,expectedPavedRange:0,expectedMixedRange:0,reserveDistance:25,fuelProfile:'mixed',autoCompleteCheckpoints:true,checkpointArrivalRadius:500,checkpointMaxAccuracy:200,hideCompletedCheckpoints:true},state.settings);
  state.project.competitors ||= [];
  state.project.stationaryEvents ||= [];
  rallyExecution();
  if(reconcileCompletedRallyDays())await saveProject(false);
  try{await initializeObservationCapture();}catch(error){console.warn(`[CannonMap observation capture] ${error?.message||error}`);}
  try{await initializeSecureObservationIngestion();}catch(error){console.warn(`[CannonMap secure ingestion] ${error?.message||error}`);}
  try{await initializeRallyAnalytics();}catch(error){console.warn(`[CannonMap analytics] ${error?.message||error}`);}
  if(rallyJournal)rideExportSource=createRideExportSource({
    getActiveProject:()=>deepClean(state.project),journal:rallyJournal,
    analytics:rallyAnalytics||{flush:async()=>({status:'disabled'}),snapshot:()=>null}
  });
  initMap();wireUi();if($('radarOpacity'))$('radarOpacity').value=state.settings.radarOpacity||65;if($('radarCoverage'))$('radarCoverage').value=state.settings.radarCoverage||'active-day';if($('routeWeatherSpeed'))$('routeWeatherSpeed').value=String(state.settings.routeWeatherSpeed||45);
  if($('buildLabel'))$('buildLabel').textContent=`Beta ${APP_VERSION}`;
  if($('appVersion'))$('appVersion').textContent=`v${APP_VERSION} · ${BUILD_ID}`;
  renderAll();
  const pendingPhoto=state.project.features.find(feature=>checkpoints.checkpointState(feature.status)===checkpoints.CHECKPOINT_STATE.PHOTO_REQUIRED);
  if(pendingPhoto){
    const durablePhotos=await missionMedia.listCheckpointPhotos(state.project.projectId,pendingPhoto.id);
    const journalEvents=(await rallyJournal.getProjectJournal(state.project.projectId)).events;
    const journalPhotos=journalEvents.filter(event=>event.eventType==='photo_added'&&event.references?.checkpointId===pendingPhoto.id).flatMap(event=>event.attachments?.photos||[]);
    const recordedPhotos=journalPhotos.filter(reference=>durablePhotos.some(record=>record.mediaId===reference.mediaId));
    if(recordedPhotos.length){
      pendingPhotoCheckpointId=pendingPhoto.id;
      checkpointCamera.start({projectId:state.project.projectId,checkpoint:pendingPhoto,journalEvent:await appendRallyJournalEvent('checkpoint_arrival',pendingPhoto,{eventIdentity:`arrival:${pendingPhoto.id}`}),required:true});
      for(const photo of recordedPhotos)checkpointCamera.restorePhoto(photo);
      await finalizePendingPhotoCheckpoint();
    }else await beginPhotoWorkflow(pendingPhoto,true);
  }
  rallyDebug.record('application_restored',{day:activeRallyDay(),dayStatus:rallyDayState(activeRallyDay()).status,activeObjectiveId:currentCheckpoint()?.id||null,pendingPhotoCheckpointId:pendingPhoto?.id||null});
  setTimeout(()=>{if(state.project.features.length&&rallyDayState(activeRallyDay()).status!=='complete')fitMap();},200);
}
async function startApplication(){
  setStartupState('initializing','Starting CannonMap…');
  const serviceWorkerRegistration=registerServiceWorker();
  const dependencies=runtimeDependencyReport();
  if(dependencies.missingOptional.length){
    document.documentElement.dataset.cannonmapOptionalMissing=dependencies.missingOptional.join(',');
    console.warn(`[CannonMap startup] Optional integration unavailable: ${dependencies.missingOptional.join(', ')}`);
  }else delete document.documentElement.dataset.cannonmapOptionalMissing;
  if(dependencies.missingRequired.length){
    const message=`CannonMap could not start. Missing required dependency: ${dependencies.missingRequired.join(', ')}.`;
    console.error(`[CannonMap startup] ${message}`);
    setStartupState('failed',message,dependencies.missingRequired);
    await serviceWorkerRegistration;
    return false;
  }
  try{
    await initializeApplication();
    setStartupState('ready');
    return true;
  }catch(error){
    const message=`CannonMap initialization failed: ${error?.message||error}`;
    console.error(`[CannonMap startup] ${message}`);
    setStartupState('failed',message);
    await serviceWorkerRegistration;
    return false;
  }
}
function mapEngineDiagnostics(){
  const types=['features','competitors','stationaryEvents','traffic','weather'];
  return {
    mapContainers:document.querySelectorAll('.leaflet-container').length,
    registry:mapEngine?.layers.counts()||{},
    groups:Object.fromEntries(types.map(type=>[type,mapEngine?.group(type).getLayers().length||0]))
  };
}
window.CannonMapTest={filterProhibitedFeatures,sanitizeProjectData,lineGeometriesMatch,lineDistanceMiles,planningMileage,normalizeCheckpoint,rallyCheckpointNumber,selectNextCheckpoint,completeCurrentCheckpoint,deferCurrentCheckpoint,resumeDeferredQueue,finishDayFromDeferredQueue,startNextRallyDay,finalizePendingPhotoCheckpoint,goToHotel,rallyScore,restoreSnapshot,evaluateCheckpointArrival,moveCheckpointInOrder,makeCheckpointNext,restoreImportedCheckpointOrder,handleStationaryAction,renderStationaryEvents,updateStationaryDetection,renderMapFeatures,mapEngineDiagnostics,observationCaptureDiagnostics,captureGpsObservation,replaySecureObservations,observationContext,missionControlJournalEvents,rideExportSnapshot,rallyDebugEntries:()=>rallyDebug.entries(),gpsFollowState:()=>gpsFollow?.state(),simulateManualMapPan:()=>state.map?.fire('dragstart',{originalEvent:{type:'field-test'}}),gpsMarkerBounds:()=>{if(!state.lastGpsPosition||!state.map)return null;const point=state.map.latLngToContainerPoint([state.lastGpsPosition.lat,state.lastGpsPosition.lon]),mapRect=$('map')?.getBoundingClientRect();return mapRect?{x:mapRect.left+point.x,y:mapRect.top+point.y}:null;},runtimeDependencyReport,startApplication,registerServiceWorker};
startApplication();
