import {createCoreCompatibility} from './src/core/compatibility.js';
import * as geometry from './src/domain/geo/geometry.js';
import {createMapEngine} from './src/ui/map/map-engine.js';
import {createProjectWorkflows} from './src/application/project-workflows.js';
import * as checkpoints from './src/domain/checkpoints/workflow.js';
import {renderRally as presentRally} from './src/ui/rally/presenter.js';
import {wireRallyController} from './src/ui/rally/controller.js';
import {wireProjectController} from './src/ui/project/controller.js';
import {createFeatureFlags} from './src/core/feature-flags.js';
import {RALLY_FEED_DEFAULTS,RALLY_FEED_DEFAULT_REVISION,migrateRallyFeedDefaults,preserveExplicitRallyFeedSettings} from './src/core/rally-feed-defaults.js';
import {createObservationCapture,OBSERVATION_CAPTURE_FEATURE_FLAG} from './src/application/observation-capture.js';
import {createSecureObservationUploader,SECURE_INGESTION_FEATURE_FLAG} from './src/application/secure-observation-upload.js';
import {createRallyAnalyticsService,RALLY_ANALYTICS_FEATURE_FLAG} from './src/application/rally-analytics-service.js';
import {createRallyJournalService} from './src/application/rally-journal-service.js';
import {createProjectLifecycleManager} from './src/application/project-lifecycle-manager.js';
import {createProjectRepositoryScope} from './src/application/project-repository-scope.js';
import {createCheckpointCameraWorkflow} from './src/application/checkpoint-camera-workflow.js';
import {createCheckpointEvidenceReconciliationService} from './src/application/checkpoint-evidence-reconciliation-service.js';
import {createPairedMediaCaptureService,isNativeCameraCaptureFailure,PairedMediaCaptureError} from './src/application/paired-media-capture-service.js';
import {createCameraReadinessService,AutomaticCameraNotReadyError} from './src/application/camera-readiness-service.js';
import {createRallyDayPreflightService,PREFLIGHT_CAPABILITY,PREFLIGHT_STATUS} from './src/application/rally-day-preflight-service.js';
import {captureNativeCameraStill} from './src/infrastructure/browser/native-camera-still-capture.js';
import {createBrowserCameraReadinessAdapter} from './src/infrastructure/browser/camera-readiness-adapter.js';
import {createCameraSession} from './src/infrastructure/browser/camera-session.js';
import {createBrowserRallyDayPreflightAdapter} from './src/infrastructure/browser/rally-day-preflight-adapter.js';
import {createFileSystemBackupAdapter} from './src/infrastructure/browser/file-system-backup-adapter.js';
import {createRideMemoryStateStore} from './src/infrastructure/browser/ride-memory-state-store.js';
import {createCheckpointArrivalCoordinator} from './src/application/checkpoint-arrival-coordinator.js';
import {
  activeSession as activeRallySessionRecord,inspectRallySessions,listDaySessions,migrateRallyExecution,
  resumeSession as resumeRallySessionRecord,startNewSession as startNewRallySessionRecord,
  syncActiveSession,RALLY_SESSION_STATUS,CHECKPOINT_EXECUTION_FIELDS
} from './src/domain/rally/session.js';
import {createSessionArtifactFilename} from './src/domain/rally/artifacts.js';
import {
  createPendingEvidenceQueue,listActivePendingEvidence,listExpiredPendingEvidence,
  pendingEvidenceEntry,recordPendingEvidenceAction,reconcilePendingEvidenceQueue,resolvePendingEvidence,
  upsertPendingEvidence,PENDING_EVIDENCE_ACTION
} from './src/domain/checkpoints/pending-evidence-queue.js';
import {createScreenWakeLockController} from './src/application/screen-wake-lock-controller.js';
import {createAutomaticBackupService,AUTOMATIC_BACKUP_TRIGGER,EXTERNAL_BACKUP_STATUS} from './src/application/automatic-backup-service.js';
import {createBackupSchedulerHealth} from './src/application/backup-scheduler-health.js';
import {createCameraCaptureArbiter} from './src/application/camera-capture-arbiter.js';
import {createCoalescingWriteScheduler} from './src/application/coalescing-write-scheduler.js';
import {createGpsWatchdog} from './src/application/gps-watchdog.js';
import {createLivePollController} from './src/application/live-poll-controller.js';
import {createRideMemoryCaptureService,DEFAULT_RIDE_MEMORY_INTERVAL_MS} from './src/application/ride-memory-capture-service.js';
import {inferSignificantRouteTurns,selectNavigationFocus,decideNavigationZoom} from './src/domain/geo/navigation-focus.js';
import {normalizeCameraPreference,cameraCaptureAttribute,cameraSelectionMetadata} from './src/domain/media/camera-preference.js';
import {createGpsFollowController} from './src/application/gps-follow-controller.js';
import {createRallyDebugLog} from './src/application/rally-debug-log.js';
import {createRideExportSource} from './src/application/ride-export-source.js';
import {createPhotoEvidenceService} from './src/application/photo-evidence-service.js';
import {createPhotoExportService,createSessionProjectSnapshot} from './src/application/photo-export-service.js';
import {resolveRallyExportDay,journalEventsForDay} from './src/application/day-export-context.js';
import {createMissionStorageService,formatPreferredMissionMediaBudget} from './src/application/mission-storage-service.js';
import {createJourneyMediaService} from './src/application/journey-media-service.js';
import {createJourneyPackageRestoreService} from './src/application/journey-package-restore.js';
import {discoverJourneyProjects,journeyProjectManifest} from './src/application/journey-archive-context.js';
import {captureArrivalEvidence} from './src/application/arrival-evidence.js';
import {createWeatherMaintenance} from './src/application/weather-maintenance.js';
import {createFinalizedProjectService} from './src/application/finalized-project-service.js';
import {createFinalizedProjectRepository} from './src/infrastructure/indexeddb/finalized-project-repository.js';
import {stableCompetitorId,breadcrumbKey,deriveTacticalTrail,compactTrailSegmentsForRender,trailStatus,mergeCompetitorSnapshots,buildTacticalClusters} from './src/domain/competitors/trails.js';
import {competitorMarkerIconSpec,competitorTrailStyle,compactRiderListHtml,shouldShowTacticalCluster,riderSourceLabel} from './src/ui/trail-intel/tactical-presentation.js';
import {buildTargetActivity,mergeRecentTargetActivity} from './src/domain/competitors/target-intelligence.js';
import {
  createAnalyticsRepository,createJournalRepository,createLegacyCurrentProjectRepository,
  createObservationCaptureRepository,createProjectDeletionRepository,createProjectLifecycleRepository,
  createProjectRepository,createSearchRepository,createMissionMediaRepository,createJourneyRestoreRepository,
  createRecoverySnapshotRepository,createBackupDirectoryHandleRepository,openIndexedDbV2,V2_FEATURE_FLAG
} from './src/infrastructure/indexeddb/index.js';
import {createFirebaseAuthentication} from './src/infrastructure/firebase/authentication.js';
import {createObservationIngressClient} from './src/infrastructure/firebase/observation-ingress-client.js';

const APP_VERSION = '0.7.14';
const BUILD_ID = '2026.08.21.trail-intel-tactical-1';
const SETTINGS_KEY = 'cannonmap.settings.v6';
const SNAPSHOT_KEY = 'cannonmap.snapshots.v1';
const CAMERA_SETUP_HINT_KEY = 'cannonmap.camera-setup-succeeded.v1';
const APP_SHELL_CACHE = 'cannonmap-v0.7.14-20260821-trail-intel-tactical-1';
const PREFLIGHT_SHELL_ASSETS = Object.freeze(['./index.html','./app.js?v=20260821-trail-intel-tactical-1','./app.css?v=20260821-trail-intel-tactical-1']);
const AUTOMATIC_BACKUP_INTERVAL_MS=2*60*60*1000;
const RELIABILITY_HEALTH_INTERVAL_MS=5*60*1000;
const GPS_FOREGROUND_STALL_MS=45*1000;
const DEFAULT_RIDE_MEMORY_INTERVAL_MINUTES=DEFAULT_RIDE_MEMORY_INTERVAL_MS/60000;
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
let analyticsExecutionSessionId=null;
let analyticsDatabase=null;
let foundationDatabase=null;
let projectLifecycle=null;
let activeLifecycleProjectId=null;
let rallyJournal=null;
let checkpointCamera=null;
let checkpointEvidenceReconciliation=null;
let pairedMediaCapture=null;
let cameraReadiness=null;
let cameraReadinessAdapter=null;
let cameraSession=null;
let rallyDayPreflight=null;
let rallyDayPreflightAdapter=null;
let checkpointArrivalCoordinator=null;
let screenWakeLock=null;
let gpsWatchdog=null;
let cameraCaptureArbiter=null;
let rideMemoryCapture=null;
let automaticBackup=null;
let externalBackup=null;
let backupSchedulerHealth=null;
let livePollController=null;
let livePollWriteScheduler=null;
let rallyPollRestoreTimer=null;
let rallyPollGeneration=0;
let rallyManualSyncController=null;
let rallyOfficialSnapshotTimer=null;
let rallyOfficialPendingSnapshot=null;
let rallyOfficialLastAppliedAt=0;
let rallyPollHealthTimer=null;
let rallyOfficialHealthRefreshAt=0;
let missionMedia=null;
let photoEvidence=null;
let photoExports=null;
let missionStorage=null;
let journeyMedia=null;
let journeyRestore=null;
let finalizedProjects=null;
let pendingFinalizedMasterId=null;
let pendingFinalizedExport=null;
let restoredDayReview=null;
let lastRestoreResult=null;
let competitorPopupSelection=null;
let selectedCompetitorId=null;
const competitorTacticalProjectionCache=new WeakMap();
const competitorTacticalProjectionMetrics={hits:0,misses:0,compactions:0};
let weatherMaintenance=null;
let photoViewerGroups=[];
let photoViewerIndex=0;
let photoViewerRole='evidence';
let photoViewerUrl=null;
let photoViewerZoom=1;
let photoViewerUrls=[];
let rideExportSource=null;
let gpsFollow=null;
let pendingPhotoCheckpointId=null;
let pendingMediaObjective=null;
let mediaRecoveryTask=null;
let manualFallbackTimer=null;
let manualFallbackResolver=null;
let manualFallbackExpiryTask=null;
let navigationZoomState=null;
let navigationRouteCache=null;
let automaticCaptureOverride=null;
let automaticCaptureAbortController=null;
let cameraSetupDismissed=false;
let resumeGpsAfterCameraSetup=false;
let acceptedPreflightScopeKey=null;
let acceptedRallySessionId=null;
let pendingRallySessionId=null;
let pendingEvidenceQueue=createPendingEvidenceQueue(),pendingEvidenceQueueOwner=null;
let hotelBailoutUndo=null;
let preflightInspectionPending=false;
let gpsPreflightError=null;
let gpsWatchStartedAt=null;
let gpsFixReceivedAt=null;
let lastGpsWatchUiKey=null;
let lastCameraEligibility=null;
let checkpointCompletionInFlight=false;
let rallyScopeGeneration=0;
let rallyScopeSuspended=false;
let projectSaveQueue=Promise.resolve();
let projectSaveFence=null;
let projectMutationLock=null;
let rallyAnalyticsTransition=Promise.resolve();
const activeRallyMutationTasks=new Set();
const activeJournalWrites=new Set();
let defaultProjectSettings=null;
let automaticBackupUiState={internal:'Not started',external:'Checking…',attention:false};
let rideMemoryUiState={status:'Off',attention:false};
let lastReliabilityHealthCheckAt=0;
let reliabilityHealthTask=null;
let reliabilityHealthTimer=null;

function acquireProjectMutation(reason,token=null){
  if(token&&projectMutationLock?.token===token)return {token,release:()=>{}};
  if(!token&&rallyScopeSuspended){setStatus('Wait for the current Rally state transition to finish before changing Projects.',true);return null;}
  if(projectMutationLock){setStatus(`Wait for ${projectMutationLock.reason} to finish before changing Projects.`,true);return null;}
  const ownedToken=Symbol(reason),lock={token:ownedToken,reason:String(reason||'Project change')};projectMutationLock=lock;
  return {token:ownedToken,release:()=>{if(projectMutationLock===lock)projectMutationLock=null;}};
}

function rejectRallyMutationWhileQuiesced(action='change Rally state'){
  if(!rallyScopeSuspended&&!projectMutationLock)return false;
  setStatus(`Wait for ${projectMutationLock?.reason||'the current restore'} to finish before you ${action}.`,true);return true;
}

function trackRallyMutationTask(value){
  const task=Promise.resolve(value);activeRallyMutationTasks.add(task);task.then(()=>activeRallyMutationTasks.delete(task),()=>activeRallyMutationTasks.delete(task));return task;
}
function trackedRallyAction(handler){return (...args)=>{try{return trackRallyMutationTask(handler(...args));}catch(error){return Promise.reject(error);}};}
async function drainTrackedRallyMutations(){
  const errors=[];while(activeRallyMutationTasks.size){const results=await Promise.allSettled([...activeRallyMutationTasks]);for(const result of results)if(result.status==='rejected')errors.push(result.reason);}
  if(errors.length)throw errors[0];
}
async function drainActiveJournalWrites(){while(activeJournalWrites.size)await Promise.all([...activeJournalWrites]);}

function performProgrammaticMapChange(reason,operation){
  if(gpsFollow?.performProgrammaticMapChange)return gpsFollow.performProgrammaticMapChange(operation,{reason});
  return operation();
}
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
  const filtered=filterProhibitedFeatures(safe.features,source).map(feature=>{const numbered=feature?.geometry?.kind==='point'&&feature.type==='waypoint'?rallyCheckpointNumber(feature.name):null;if(numbered){feature.type='checkpoint';feature.day=Number(feature.day)||numbered.day;console.info(`[CannonMap] Recognized numbered rally checkpoint: ${feature.name}`);}return feature;});
  checkpoints.resolveImportedCheckpointOrder(filtered,{preserveResolved:true});safe.features=filtered.map(normalizeCheckpoint);
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

async function undo() {
  if(rejectRallyMutationWhileQuiesced('undo a change'))return;
  const previous = state.history.pop();
  if (!previous) return setStatus('Nothing to undo.');
  const acceptedSessionBeforeUndo=acceptedRallySessionId;
  await suspendPendingEvidenceRuntime('undo-project-state');
  try{
    stopEditing();
    state.project = previous;
    rallyExecution();const restoredSession=currentRallySession({matchActiveDay:false});
    if(acceptedSessionBeforeUndo&&restoredSession?.sessionId===acceptedSessionBeforeUndo){acceptedRallySessionId=acceptedSessionBeforeUndo;pendingRallySessionId=null;acceptedPreflightScopeKey=null;loadPendingEvidenceForSession(restoredSession);}
    else resetRallySessionSelection();
    state.hotelBailoutActive=false;
    clearSelection();
    resumeRallyScopeRuntime('undo-project-state-complete');
    await saveProject(false);
    renderAll();
    void reconcilePendingCheckpointEvidence({interactive:false});
    setStatus('Last change undone.');
  }finally{if(rallyScopeSuspended)resumeRallyScopeRuntime('undo-project-state-recovered');}
}

function initMap() {
  mapEngine=createMapEngine({
    L,
    container:'map',
    preferredBaseLayer:state.settings.baseLayer,
    onBaseLayerChange:name=>{state.settings.baseLayer=name;saveProject(false);}
  });
  state.map=mapEngine.map;
  gpsFollow=createGpsFollowController({map:state.map,debugLog:rallyDebug,followScreenY:()=>{const rect=$('map')?.getBoundingClientRect(),viewport=window.innerHeight;if(!rect?.height||!viewport)return .62;return (viewport*.62-rect.top)/rect.height;}});
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
  const active=(state.project.recentTargetActivity||[]).some(item=>String(item.objectiveId)===String(feature.id)&&Date.now()-Date.parse(item.closestApproachTimestamp)<=30*60*1000);
  return L.divIcon({ className:active?'checkpoint-recent-activity':'', html:`<div style="width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:${color};color:#07111f;border:2px solid white;font-weight:900;font-size:12px;box-shadow:0 2px 8px #0008">${label}</div>`, iconSize:[24,24], iconAnchor:[12,12] });
}
function createLeafletLayer(feature) {
  let layer;
  if (feature.geometry.kind === 'point') {
    const p = feature.geometry.coordinates[0];
    layer = L.marker([p.lat,p.lon], { icon:markerIcon(feature), draggable:false,pane:'checkpointPane' });
  } else {
    layer = L.polyline(feature.geometry.coordinates.map(p => [p.lat,p.lon]), {...featureStyle(feature),pane:'routePane'});
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
    fingerprint:model=>JSON.stringify({feature:deepClean(model.feature),lineOpacity:state.settings.lineOpacity,targetActivity:(state.project.recentTargetActivity||[]).some(item=>String(item.objectiveId)===String(model.feature.id)&&Date.now()-Date.parse(item.closestApproachTimestamp)<=30*60*1000)}),
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
function competitorTacticalProjection(comp,{now=Date.now(),includeRenderSegments=false}={}) {
  const points=Array.isArray(comp?.points)?comp.points:[],historyMs=Math.max(15,Number(state.settings.competitorTrailMinutes)||480)*60000;
  if(!points.length)return {tactical:{points:[],segments:[],latest:null,pending:null,quarantined:[]},segments:[]};
  const signature=`${points.length}|${breadcrumbKey(points[0])}|${breadcrumbKey(points.at(-1))}|${historyMs}|${Math.floor(now/60000)}`;
  let cached=competitorTacticalProjectionCache.get(points);
  if(cached?.signature!==signature){competitorTacticalProjectionMetrics.misses++;cached={signature,tactical:deriveTacticalTrail(points,{now,historyMs}),segments:null};competitorTacticalProjectionCache.set(points,cached);}else competitorTacticalProjectionMetrics.hits++;
  if(includeRenderSegments&&!cached.segments){competitorTacticalProjectionMetrics.compactions++;cached.segments=compactTrailSegmentsForRender(cached.tactical.segments,{now});}
  return {tactical:cached.tactical,segments:includeRenderSegments?cached.segments:[]};
}
function competitorFreshness(comp,tacticalTrail=null,now=Date.now()) {
  const tactical=tacticalTrail||competitorTacticalProjection(comp,{now}).tactical,status=trailStatus(comp.points,{now,freshMs:Number(state.settings.competitorFreshMinutes||15)*60000,tacticalTrail:tactical});
  return {fresh:status.status==='live',ageMinutes:status.ageMs===null?null:status.ageMs/60000,...status};
}
function renderCompetitors() {
  const models=[],tacticalByCompetitorId=new Map(),now=Date.now();
  state.project.competitors.forEach((comp,index) => {
    if (!Array.isArray(comp.points) || !comp.points.length) return;
    const competitorKey=comp.id||comp.name||`legacy-index:${index}`;
    const projection=competitorTacticalProjection(comp,{now,includeRenderSegments:true}),tactical=projection.tactical,segments=projection.segments,freshness=competitorFreshness(comp,tactical,now);
    const opacity=Number(state.settings.competitorTrailOpacity??100)/100;
    tacticalByCompetitorId.set(String(comp.id),tactical);
    if (state.settings.showCompetitorTrails !== false && comp.trailHidden!==true) {
      segments.filter(segment=>segment.length>1).forEach((segment,segmentIndex)=>models.push({key:`trail:${competitorKey}:${segmentIndex}:${pointTimestamp(segment[0])}`,kind:'trail',comp,freshness,opacity,points:segment}));
    }
    if (state.settings.showCompetitorMarkers !== false && tactical.latest) {
      models.push({key:`marker:${competitorKey}`,kind:'marker',comp,freshness,opacity,point:tactical.latest});
    }
  });
  mapEngine.layers.reconcile('competitors',models,{
    key:model=>model.key,
    fingerprint:model=>JSON.stringify({
      kind:model.kind,id:model.comp.id,name:model.comp.name,points:model.points,point:model.point,
      fresh:model.freshness.fresh,age:model.freshness.ageMinutes===null?null:Math.round(model.freshness.ageMinutes),selectedCompetitorId
    }),
    create:model=>{
      if(model.kind==='trail'){
        const line=L.polyline(model.points.map(p=>[p.lat,p.lon]),competitorTrailStyle(model.comp,{fresh:model.freshness.fresh,opacity:model.opacity,selectedRiderId:selectedCompetitorId}));
        line.bindTooltip(`${model.comp.name||model.comp.id} · ${model.freshness.ageMinutes===null?'unknown age':`${Math.round(model.freshness.ageMinutes)} min old`}`);
        line.on('click',()=>selectCompetitor(model.comp.id));
        line._cannonMapRender={key:model.key,kind:model.kind,competitorId:String(model.comp.id),points:model.points};
        return line;
      }
      const last=model.point;
      const iconSpec=competitorMarkerIconSpec(model.comp,{selectedRiderId:selectedCompetitorId}),marker=L.marker([last.lat,last.lon],{pane:selectedCompetitorId===String(model.comp.id)?'activeRiderPane':'competitorTrailsPane',icon:L.divIcon({className:iconSpec.className,html:iconSpec.html,iconSize:[iconSpec.size,iconSpec.size],iconAnchor:[iconSpec.size/2,iconSpec.size/2]}),zIndexOffset:iconSpec.zIndexOffset});
      const value=value=>value===null||value===undefined?'—':`${Number(value).toFixed(1)} mph`;
      marker.bindPopup(`<strong>Rider ${escapeHtml(riderSourceLabel(model.comp))} · ${escapeHtml(model.comp.name||'')}</strong><br>${escapeHtml(last.time||'Time unavailable')}<br>${escapeHtml(model.freshness.status)} · ${escapeHtml(model.freshness.motion)}<br>Current ${value(model.freshness.currentSpeedMph)}<br>3-minute pace ${value(model.freshness.rollingPaceMph)}<br>15-minute pace ${value(model.freshness.sustainedPaceMph)}<br>Heading ${escapeHtml(model.freshness.headingCardinal||'—')}`);
      marker.on('click',()=>selectCompetitor(model.comp.id));
      marker.on('popupopen',()=>competitorPopupSelection={type:'competitor',id:String(model.comp.id),openedAt:Date.now()});marker.on('popupclose',()=>{if(competitorPopupSelection?.id===String(model.comp.id))competitorPopupSelection=null;});
      marker._cannonMapRender={key:model.key,kind:model.kind,competitorId:String(model.comp.id),points:[last]};
      return marker;
    }
  });
  renderCompetitorClusters(tacticalByCompetitorId,now);
  if(competitorPopupSelection?.type==='competitor'){const marker=mapEngine.layers.get('competitors',`marker:${competitorPopupSelection.id}`);if(marker&&!marker.isPopupOpen?.())marker.openPopup();}
  const followed=state.project.competitors.find(comp=>String(state.followedCompetitorId)===String(comp.id));
  const last=followed?tacticalByCompetitorId.get(String(followed.id))?.latest:null;
  if(last)performProgrammaticMapChange('competitor-follow',()=>state.map.setView([last.lat,last.lon],Math.max(14,state.map.getZoom()),{animate:false}));
}
function selectCompetitor(id){selectedCompetitorId=id===null?null:String(id);renderCompetitors();renderCompetitorSummary();}
function formatStationaryDuration(ms) {
  const minutes=Math.max(0,Math.floor(Number(ms||0)/60000)),hours=Math.floor(minutes/60);
  return hours?`${hours}h ${minutes%60}m`:`${minutes} min`;
}
function stationaryPopupHtml(event) {
  const distance=state.lastGpsPosition?window.CannonMapStationaryEvents.distanceMeters(state.lastGpsPosition,event.center)/1609.344:null;
  const nearby=state.project.features.filter(feature=>['checkpoint','hotel'].includes(feature.type)&&feature.geometry?.kind==='point').map(feature=>({feature,distance:window.CannonMapStationaryEvents.distanceMeters(event.center,feature.geometry.coordinates[0])})).filter(item=>item.distance<=500).sort((a,b)=>a.distance-b.distance)[0]?.feature;
  const nearbyStopped=(state.project.stationaryEvents||[]).filter(item=>item.status==='active'&&window.CannonMapStationaryEvents.distanceMeters(event.center,item.center)<=150).length;
  return `<section class="stationary-event-popup">
    <strong>${escapeHtml(event.signature)} · Stationary event</strong>
    <dl><dt>Competitor</dt><dd>${escapeHtml(event.competitorNumber||'—')} · ${escapeHtml(event.riderName)}</dd>
    <dt>Duration</dt><dd>${escapeHtml(formatStationaryDuration(event.durationMs))}</dd>
    <dt>Started</dt><dd>${escapeHtml(new Date(event.startTime).toLocaleString())}</dd>
    <dt>Last update</dt><dd>${escapeHtml(new Date(event.lastUpdateTime).toLocaleString())}</dd>
    <dt>Coordinates</dt><dd>${Number(event.center.lat).toFixed(5)}, ${Number(event.center.lon).toFixed(5)}</dd>
    <dt>Nearby checkpoint</dt><dd>${escapeHtml(nearby?.name||'None within 500 m')}</dd>
    <dt>Riders stopped nearby</dt><dd>${nearbyStopped}</dd>
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
  const competitor=state.project.competitors.find(item=>String(item.id)===String(id)),last=competitor?competitorTacticalProjection(competitor).tactical.latest:null;
  if(last)performProgrammaticMapChange('competitor-follow',()=>state.map.setView([last.lat,last.lon],Math.max(14,state.map.getZoom()),{animate:false}));
  setStatus(`Following ${competitor?.name||`Rider ${id}`}.`);
}
function renderStationaryEvents() {
  if(!window.CannonMapStationaryEvents||state.settings.showStationaryEvents===false){mapEngine.layers.clear('stationaryEvents');return;}
  const eventId=String(state.settings.rallyEventId||'');
  const events=window.CannonMapStationaryEvents.spreadNearbyEvents((state.project.stationaryEvents||[]).filter(event=>String(event.rallyEventId)===eventId&&!event.hidden));
  mapEngine.layers.reconcile('stationaryEvents',events,{
    key:event=>event.id,
    fingerprint:event=>JSON.stringify(event),
    create:event=>{
      const spec=window.CannonMapStationaryEvents.signatureIconSpec(event);
      const color=event.status==='active'?'#f59e0b':'#475569';
      const icon=L.divIcon({className:spec.className,html:`<div class="stationary-signature-face" title="${escapeHtml(spec.title)}" style="background:${color}">${escapeHtml(spec.label)}</div>`, iconSize:[spec.size,spec.size],iconAnchor:[spec.size/2,spec.size/2],popupAnchor:[0,-spec.size/2]});
      const marker=L.marker([event.displayCenter.lat,event.displayCenter.lon],{pane:'stationaryPane',icon,riseOnHover:true,zIndexOffset:700});
      marker.bindPopup(stationaryPopupHtml(event),{maxWidth:330,closeButton:false});
      marker.on('popupopen',()=>{
        competitorPopupSelection={type:'stationary',id:String(event.id),openedAt:Date.now()};
        const popup=marker.getPopup().getElement();
        popup?.querySelectorAll('[data-stationary-action]').forEach(button=>button.addEventListener('click',()=>handleStationaryAction(button.dataset.stationaryAction,event)));
      });
      return marker;
    }
  });
  if(competitorPopupSelection?.type==='stationary'){const marker=mapEngine.layers.get('stationaryEvents',competitorPopupSelection.id);if(marker&&!marker.isPopupOpen?.())marker.openPopup();}
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
  populateDaySelectors();
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
  if($('showStationaryEvents'))$('showStationaryEvents').checked=state.settings.showStationaryEvents!==false;
  if($('showCompetitorClusters'))$('showCompetitorClusters').checked=state.settings.showCompetitorClusters!==false;
  if($('competitorTrailMinutes'))$('competitorTrailMinutes').value=String(state.settings.competitorTrailMinutes||480);
  if($('competitorTrailOpacity'))$('competitorTrailOpacity').value=String(state.settings.competitorTrailOpacity??100);
  renderMapFeatures(); renderLayerList(); renderStats(); renderCompetitorSummary(); renderMissionControl(); renderTypeLayerControls(); renderSearch(); renderIntelSummary(); renderRallyMode();
}
function renderCompetitorClusters(tacticalByCompetitorId=null,now=Date.now()){
  if(state.settings.showCompetitorClusters===false||selectedCompetitorId!==null||!shouldShowTacticalCluster({zoom:state.map?.getZoom?.(),riderCount:state.project.competitors.length})){mapEngine.layers.clear('competitorClusters');return;}
  const clusters=buildTacticalClusters(state.project.competitors,{now,tacticalByCompetitorId});mapEngine.layers.reconcile('competitorClusters',clusters,{key:cluster=>cluster.id,fingerprint:cluster=>JSON.stringify(cluster),create:cluster=>{
    const marker=L.circleMarker([cluster.center.lat,cluster.center.lon],{pane:'stationaryPane',radius:12,color:'#fff',weight:2,fillColor:'#7c3aed',fillOpacity:.86});
    const nearby=state.project.features.filter(feature=>['checkpoint','hotel'].includes(feature.type)&&feature.geometry?.kind==='point').map(feature=>({feature,distance:haversine(cluster.center,feature.geometry.coordinates[0])})).filter(item=>item.distance<=500).sort((a,b)=>a.distance-b.distance)[0]?.feature;
    marker.bindPopup(`<strong>${cluster.riders.length} competitors nearby</strong><br>${cluster.riders.map(r=>`${escapeHtml(r.name||r.id)} · ${escapeHtml(r.motion)} · ${escapeHtml(r.status)}`).join('<br>')}<br>Latest ${escapeHtml(cluster.latestUpdate||'Unavailable')}<br>Nearby checkpoint: ${escapeHtml(nearby?.name||'None within 500 m')}<br><small>Observed convergence only; cause unknown.</small>`);return marker;
  }});
}
function populateDaySelectors(){
  const configured=[...new Set(state.project.features.map(feature=>Number(feature.day)).filter(day=>Number.isInteger(day)&&day>0))],highest=Math.max(60,...configured),days=Array.from({length:highest},(_,index)=>index+1);
  const fill=(id,{all=false,unassigned=false}={})=>{const select=$(id);if(!select)return;const value=select.value;select.innerHTML=`${all?'<option value="all">All days</option>':''}${days.map(day=>`<option value="${day}">Day ${day}</option>`).join('')}${unassigned?'<option value="0">Unassigned</option>':''}`;if([...select.options].some(option=>option.value===value))select.value=value;};
  fill('dayFilter',{all:true,unassigned:true});fill('featureDay',{unassigned:true});fill('bulkDay');fill('searchDay',{all:true,unassigned:true});fill('createDay',{unassigned:true});fill('editDay',{unassigned:true});
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
  if(projectSaveFence){const fence=projectSaveFence.promise;return fence.then(()=>saveProject(showMessage));}
  syncCurrentRallySessionProjection();
  sanitizeProjectData(state.project,'save boundary');
  state.project.name=$('projectName')?.value.trim()||state.project.name||'CannonMap Project';
  state.project.version=APP_VERSION;state.project.updatedAt=new Date().toISOString();
  const clean=deepClean(state.project),settings=deepClean(state.settings);
  localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));
  if(clean.projectId)localStorage.setItem(`${SETTINGS_KEY}.${clean.projectId}`,JSON.stringify(settings));
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
function beginProjectSaveFence(reason='external-project-mutation'){
  if(projectSaveFence)throw new Error(`Project saves are already fenced (${projectSaveFence.reason}).`);
  let resolve;const promise=new Promise(done=>{resolve=done;});const fence={reason,promise,release:()=>{if(projectSaveFence===fence)projectSaveFence=null;resolve();}};projectSaveFence=fence;return fence.release;
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
  photoEvidence=createPhotoEvidenceService({repository:missionMedia,createId:uid});
  checkpointEvidenceReconciliation=createCheckpointEvidenceReconciliationService({mediaRepository:missionMedia,photoEvidence});
  photoExports=createPhotoExportService({repository:missionMedia});
  missionStorage=createMissionStorageService({mediaRepository:missionMedia,settingsProvider:()=>state.settings});
  externalBackup=createFileSystemBackupAdapter({handleRepository:createBackupDirectoryHandleRepository({database:foundationDatabase}),clock:core.clock});
  backupSchedulerHealth=createBackupSchedulerHealth({expectedHeartbeatMs:AUTOMATIC_BACKUP_INTERVAL_MS,backupDueAfterMs:AUTOMATIC_BACKUP_INTERVAL_MS+15*60*1000,onStateChange:()=>renderReliabilityStatus()});
  automaticBackup=createAutomaticBackupService({
    exporter:photoExports,snapshotRepository:createRecoverySnapshotRepository({database:foundationDatabase}),mediaRepository:missionMedia,
    externalBackup,journal:rallyJournal,clock:core.clock,createId:uid,intervalMs:AUTOMATIC_BACKUP_INTERVAL_MS,
    onResult:handleAutomaticBackupResult,onHeartbeat:()=>backupSchedulerHealth?.heartbeat?.()
  });
  cameraCaptureArbiter=createCameraCaptureArbiter({clock:{now:()=>Date.now()},onEvent:event=>rallyDebug.record(event.eventType,event)});
  rideMemoryCapture=createRideMemoryCaptureService({
    captureStill:(camera,options)=>{cameraReadiness?.assertAutomaticCaptureEligible?.();return captureNativeCameraStill(camera,{...options,cameraSession,scopeToken:preflightScopeKey()});},
    mediaRepository:missionMedia,journal:rallyJournal,createId:uid,stateStore:createRideMemoryStateStore({storage:localStorage}),cameraArbiter:cameraCaptureArbiter,
    sessionProvider:rideMemorySessionContext,positionProvider:()=>state.lastGpsPosition,
    checkpointActivity:()=>({active:Boolean(pendingPhotoCheckpointId||automaticCaptureAbortController||cameraCaptureArbiter?.state?.().currentKind==='checkpoint')}),
    documentRef:document,clock:{now:()=>Date.now()},intervalMs:rideMemoryIntervalMs(),onState:handleRideMemoryState,
    onDiagnostic:event=>rallyDebug.record(event.eventType,event)
  });
  journeyMedia=createJourneyMediaService({mediaRepository:missionMedia,projectLifecycle});
  journeyRestore=createJourneyPackageRestoreService({repository:createJourneyRestoreRepository({database:foundationDatabase}),projectLifecycle});
  finalizedProjects=createFinalizedProjectService({repository:createFinalizedProjectRepository({database:foundationDatabase}),projectLifecycle,createId:uid,clock:core.clock,applicationVersion:APP_VERSION,buildId:BUILD_ID});
  checkpointCamera=createCheckpointCameraWorkflow({
    mediaRepository:missionMedia,photoEvidence,
    journal:rallyJournal,clock:core.clock,createId:uid,onState:renderCheckpointCameraState,
    onDiagnostic:details=>{const diagnostic={...details,cannonMapVersion:APP_VERSION,buildId:BUILD_ID};rallyDebug.record('media_storage_diagnostic',diagnostic);console.error('[CannonMap media storage]',diagnostic);}
  });
  pairedMediaCapture=createPairedMediaCaptureService({
    captureStill:(camera,options)=>automaticCaptureOverride?automaticCaptureOverride(camera,options):captureNativeCameraStill(camera,{...options,cameraSession,scopeToken:preflightScopeKey()}),
    photoEvidence,createId:uid,clock:core.clock
  });
  initializeCheckpointArrivalCoordinator();
  initializeGpsWatchdog();
  screenWakeLock=createScreenWakeLockController({wakeLock:navigator.wakeLock,documentRef:document,debugLog:rallyDebug});
}

function initializeCheckpointArrivalCoordinator(){
  checkpointArrivalCoordinator?.destroy?.();
  checkpointArrivalCoordinator=createCheckpointArrivalCoordinator({
    dwellMs:2000,maxAccuracyFeet:200,
    persistArrival:persistDetectedCheckpointArrival,
    processArrival:processDetectedCheckpointArrival,
    onError:(error,arrival)=>{
      rallyDebug.record('checkpoint_arrival_processing_failed',{checkpointId:arrival?.checkpointId||null,error:error?.message||String(error)});
      console.error('[CannonMap checkpoint arrival]',error);
    }
  });
  return checkpointArrivalCoordinator;
}
function resetCheckpointArrivalCoordinator(reason='scope-change'){
  rallyScopeGeneration+=1;initializeCheckpointArrivalCoordinator();
  rallyDebug.record('checkpoint_arrival_scope_reset',{reason,scopeGeneration:rallyScopeGeneration,projectId:state.project.projectId||null,day:activeRallyDay()||null});
}
function restoreRallyPollingIntent(){
  if(rallyPollRestoreTimer!==null)clearTimeout(rallyPollRestoreTimer);rallyPollRestoreTimer=setTimeout(()=>{rallyPollRestoreTimer=null;if(!rallyScopeSuspended&&!projectMutationLock&&state.settings.rallyLivePollingEnabled===true&&!state.rallyLiveFeed&&!livePollController)void startRallyPolling({silent:true,persist:false});},0);
}
function resumeRallyScopeRuntime(reason='scope-change-complete'){
  resetCheckpointArrivalCoordinator(reason);rallyScopeSuspended=false;
  rallyDebug.record('checkpoint_arrival_scope_resumed',{reason,scopeGeneration:rallyScopeGeneration,projectId:state.project.projectId||null,day:activeRallyDay()||null});
  restoreRallyPollingIntent();
}
function recordCameraDiagnostic(event={}){
  const eventType=String(event.eventType||'').trim();if(!eventType)return;
  const details={...event};delete details.eventType;delete details.occurredAt;
  rallyDebug.record(eventType,details);
  if(/failed|denied|unavailable|interrupted/.test(eventType))console.warn(`[CannonMap camera] ${eventType}`,details);
}
function cameraSetupHint(){
  try{return Boolean(localStorage.getItem(CAMERA_SETUP_HINT_KEY));}catch{return false;}
}
function persistCameraSetupHint(succeeded){
  try{
    if(succeeded)localStorage.setItem(CAMERA_SETUP_HINT_KEY,core.clock.iso());
    else localStorage.removeItem(CAMERA_SETUP_HINT_KEY);
  }catch{/* Camera readiness is authoritative in memory; this device-local hint is optional. */}
}
function initializeCameraReadiness(){
  cameraSession=createCameraSession({mediaDevices:navigator.mediaDevices,imageCaptureFactory:track=>new globalThis.ImageCapture(track),scopeProvider:()=>preflightScopeKey(),onDiagnostic:recordCameraDiagnostic});
  cameraReadinessAdapter=createBrowserCameraReadinessAdapter({
    mediaDevices:navigator.mediaDevices,permissions:navigator.permissions,
    imageCaptureFactory:typeof globalThis.ImageCapture==='function'?track=>new globalThis.ImageCapture(track):null,
    secureContext:globalThis.isSecureContext!==false,onDiagnostic:recordCameraDiagnostic,cameraSession,sessionScopeProvider:()=>preflightScopeKey()
  });
  cameraReadiness=createCameraReadinessService({
    adapter:cameraReadinessAdapter,priorSetupSucceeded:cameraSetupHint(),clock:core.clock,onDiagnostic:recordCameraDiagnostic,
    persistSetupSucceeded:persistCameraSetupHint,
    onStateChange:cameraState=>{
      if(lastCameraEligibility!==cameraState.automaticCaptureEligible){lastCameraEligibility=cameraState.automaticCaptureEligible;rallyDebug.record('camera_auto_capture_eligibility',{eligible:cameraState.automaticCaptureEligible,permission:cameraState.permission,capability:cameraState.capability,reasonCode:cameraState.reasonCode});}
      renderRallyMode();
    }
  });
  return cameraReadiness;
}
function preflightScope(){
  const day=activeRallyDay(),rows=day?dayCheckpoints():[],resume=rows.some(feature=>Boolean(feature.arrivedAt)||![checkpoints.CHECKPOINT_STATE.UPCOMING,checkpoints.CHECKPOINT_STATE.ACTIVE].includes(checkpoints.checkpointState(feature.status)));
  if(day&&!currentRallySessionId())pendingRallySessionId||=uid();
  return {projectId:String(state.project.projectId||state.project.id||'current'),dayNumber:day,sessionId:currentRallySessionId()||pendingRallySessionId||'pending-new-session',mode:resume?'resume':'start'};
}
function preflightScopeKey(scope=preflightScope()){return `${scope.projectId}:${Number(scope.dayNumber)||'none'}:${scope.sessionId||'pending-new-session'}`;}
async function durableStorageProbe(){
  if(!foundationDatabase)return {ready:false,reasonCode:'foundation-database-unavailable'};
  try{
    const probeKey=`__cannonmap_preflight_write_probe__:${uid()}`,transaction=foundationDatabase.transaction('projectRecords','readwrite'),store=transaction.objectStore('projectRecords');
    const write=store.put({projectId:probeKey,id:probeKey,name:'Storage readiness probe',version:APP_VERSION,features:[],competitors:[],createdAt:core.clock.iso(),updatedAt:core.clock.iso()});
    write.onsuccess=()=>store.delete(probeKey);
    await new Promise((resolve,reject)=>{transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error||new Error('Local storage write probe failed.'));transaction.onabort=()=>reject(transaction.error||new Error('Local storage write probe aborted.'));});
    return {ready:true,reasonCode:'indexeddb-atomic-write-verified'};
  }catch(error){return {ready:false,reasonCode:'indexeddb-write-failed',error};}
}
async function prepareOfflineApplication(){
  const registration=await registerServiceWorker();if(!registration)throw new Error('Service worker registration failed.');
  await registration.update?.();
  if(navigator.serviceWorker?.ready)await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Offline app preparation timed out.')),8000))]);
  return registration;
}
function initializeRallyDayPreflight(){
  rallyDayPreflightAdapter=createBrowserRallyDayPreflightAdapter({
    permissions:navigator.permissions,geolocation:navigator.geolocation,
    gpsStateProvider:()=>{
      const watch=gpsWatchdog?.state?.(),desired=watch?.desired===true,healthy=watch?.status==='healthy'&&watch.watchActive===true,fresh=healthy&&watch.lastFixAt!==null&&watch.watchStartedAt!==null&&watch.lastFixAt>=watch.watchStartedAt&&Number(watch.fixAgeMs)<GPS_FOREGROUND_STALL_MS;
      return {active:desired,fixReceived:Boolean(fresh&&state.lastGpsPosition),lastFixAt:fresh?new Date(watch.lastFixAt).toISOString():null,accuracyFeet:fresh?state.lastGpsPosition?.accuracyFeet??null:null,errorCode:gpsPreflightError?.code??null,errorMessage:gpsPreflightError?.message??null};
    },
    startGps:()=>startGps({preflightAction:true}),storageManager:navigator.storage,durableStorageProbe,
    serviceWorkerContainer:navigator.serviceWorker,cacheStorage:globalThis.caches,currentCacheName:APP_SHELL_CACHE,requiredShellAssets:PREFLIGHT_SHELL_ASSETS,
    online:()=>navigator.onLine!==false,prepareOffline:prepareOfflineApplication
  });
  rallyDayPreflight=createRallyDayPreflightService({adapter:rallyDayPreflightAdapter,cameraReadiness,clock:core.clock});
  return rallyDayPreflight;
}
function currentPreflightState(){
  const snapshot=rallyDayPreflight?.state?.(),scope=preflightScope();
  return snapshot?.scope?.key===preflightScopeKey(scope)?snapshot:null;
}
function showDayPreflight(){
  const scope=preflightScope();if(!scope.dayNumber||restoredDayReview||rallyDayState(scope.dayNumber).status==='complete')return false;
  return !showRallySessionChoice()&&acceptedPreflightScopeKey!==preflightScopeKey(scope);
}
const PREFLIGHT_ACTION_LABELS=Object.freeze({ENABLE_GPS:'ENABLE GPS',START_GPS:'START GPS',ENABLE_CAMERA:'ENABLE CAMERA',RETRY_CAMERA:'RETRY CAMERA',PROTECT_STORAGE:'PROTECT STORAGE',PREPARE_OFFLINE:'PREPARE OFFLINE'});
function dayPreflightPresenterModel(){
  const snapshot=currentPreflightState(),scope=preflightScope(),checking=preflightInspectionPending||!snapshot;
  if(checking)return {status:'CHECKING',ready:false,checking:true,resume:scope.mode==='resume',capabilities:{}};
  const capabilities=Object.fromEntries(Object.entries(snapshot.capabilities).map(([id,item])=>[id,{...item,actionLabel:PREFLIGHT_ACTION_LABELS[item.action]||null,actionDisabled:false}]));
  const notice=snapshot.ready?'GPS, camera, local storage, and the current offline app shell are ready.':snapshot.degradedAcknowledged?'Degraded operation acknowledged. Missing capabilities remain visible in the Journal.':'Resolve available actions before riding, or deliberately continue in degraded mode.';
  return {...snapshot,checking:false,resume:scope.mode==='resume',capabilities,notice};
}
async function refreshDayPreflight(){
  if(!rallyDayPreflight||!activeRallyDay())return null;
  preflightInspectionPending=true;renderRallyMode();
  try{return await rallyDayPreflight.inspect(preflightScope());}
  finally{preflightInspectionPending=false;renderRallyMode();}
}
async function runPreflightAction(capability){
  if(rejectRallyMutationWhileQuiesced('change readiness settings'))return null;
  if(!rallyDayPreflight)return null;
  try{
    preflightInspectionPending=true;renderRallyMode();
    const result=await rallyDayPreflight.act(capability,{userGesture:true,scope:preflightScope()});
    if(capability===PREFLIGHT_CAPABILITY.GPS&&result.capabilities.gps.status!==PREFLIGHT_STATUS.READY)setStatus('GPS started. Waiting for a trustworthy location fix.');
    return result;
  }catch(error){setStatus(`Readiness action failed: ${error.message}`,true);return currentPreflightState();}
  finally{preflightInspectionPending=false;renderRallyMode();}
}
function preflightJournalSnapshot(snapshot){
  return Object.fromEntries(Object.entries(snapshot?.capabilities||{}).map(([id,item])=>[id,{status:item.status,reasonCode:item.reasonCode,detail:item.detail,permission:item.permission??null,automaticCaptureEligible:item.automaticCaptureEligible??null,durableReady:item.durableReady??null,persistenceStatus:item.persistenceStatus??null,shellReady:item.shellReady??null}]));
}
function localCalendarDate(value=new Date()){
  const date=value instanceof Date?value:new Date(value);return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
}
async function startNewRallySession(day=activeRallyDay(),{refreshPreflight=true}={}){
  if(rejectRallyMutationWhileQuiesced('start a new rally session'))return null;
  const dayNumber=Number(day);if(!dayNumber)return null;
  const replacingSession=Boolean(activeRallySessionRecord(state.project)||pendingPhotoCheckpointId);if(replacingSession)await suspendPendingEvidenceRuntime('start-new-rally-session');
  try{
    const startedAt=core.clock.iso(),session=startNewRallySessionRecord(state.project,{dayNumber,calendarDate:localCalendarDate(startedAt),startedAt,sessionId:pendingRallySessionId||undefined,createId:uid,rallyId:String(state.settings.rallyEventId||state.project.projectId)});pendingRallySessionId=null;
    state.settings.dayFilter=String(dayNumber);if($('dayFilter'))$('dayFilter').value=String(dayNumber);
    bindPendingEvidenceQueue(session);acceptedRallySessionId=session.sessionId;acceptedPreflightScopeKey=null;cameraSetupDismissed=false;state.history=[];state.hotelBailoutActive=false;hotelBailoutUndo=null;rallyDayPreflight?.clearAcknowledgement?.();
    const next=checkpoints.startRallyDay(state.project,state.settings,dayNumber);if(next)state.selectedId=next.id;
    resumeRallyScopeRuntime('start-new-rally-session-complete');
    const journalWrite=appendRallyJournalEvent('rally_session_started',next||{id:`day-${dayNumber}`,type:'day',day:dayNumber,name:`Day ${dayNumber}`},{eventIdentity:'session-started',source:'rally_session',sessionStartedAt:session.startedAt,calendarDate:session.calendarDate,runNumber:session.runNumber,title:`Day ${dayNumber} · Run ${session.runNumber} Started`,summary:'Rider deliberately started a new isolated rally-day session.'},session.startedAt),projectWrite=saveProject(false);
    await Promise.all([journalWrite,projectWrite]);renderAll();if(refreshPreflight)void refreshDayPreflight();return currentRallySession();
  }finally{if(rallyScopeSuspended)resumeRallyScopeRuntime('start-new-rally-session-recovered');}
}
async function resumeExistingRallySession(sessionId=rallySessionChoiceState().session?.sessionId){
  if(rejectRallyMutationWhileQuiesced('resume a rally session'))return null;
  if(!sessionId)return null;
  await suspendPendingEvidenceRuntime('resume-rally-session');
  try{
    const stored=rallyExecution().sessions?.[sessionId];if(!stored)throw new Error('The selected rally session is unavailable.');
    state.settings.dayFilter=String(stored.dayNumber);if($('dayFilter'))$('dayFilter').value=String(stored.dayNumber);
    const session=resumeRallySessionRecord(state.project,sessionId,{resumedAt:core.clock.iso()});bindPendingEvidenceQueue(session);
    acceptedRallySessionId=session.sessionId;acceptedPreflightScopeKey=null;cameraSetupDismissed=false;state.history=[];state.hotelBailoutActive=false;hotelBailoutUndo=null;rallyDayPreflight?.clearAcknowledgement?.();state.selectedId=session.activeObjectiveId||currentCheckpoint()?.id||null;
    resumeRallyScopeRuntime('resume-rally-session-complete');
    const resumedAt=core.clock.iso(),journalWrite=appendRallyJournalEvent('rally_session_resumed',currentCheckpoint()||{id:`day-${session.dayNumber}`,type:'day',day:session.dayNumber,name:`Day ${session.dayNumber}`},{eventIdentity:`session-resumed:${resumedAt}`,source:'rally_session',sessionResumedAt:resumedAt,calendarDate:session.calendarDate,runNumber:session.runNumber,title:`Day ${session.dayNumber} · Run ${session.runNumber} Resumed`,summary:'Rider deliberately resumed this existing rally-day session.'},resumedAt),projectWrite=saveProject(false);
    await Promise.all([journalWrite,projectWrite]);renderAll();void refreshDayPreflight();void reconcilePendingCheckpointEvidence({interactive:false});return session;
  }catch(error){setStatus(`Session resume failed: ${error.message}`,true);return null;}
  finally{if(rallyScopeSuspended)resumeRallyScopeRuntime('resume-rally-session-recovered');}
}
async function proceedFromDayPreflight({degraded=false}={}){
  if(rejectRallyMutationWhileQuiesced('start riding'))return null;
  const snapshot=currentPreflightState(),scope=preflightScope();
  if(!snapshot)return setStatus('Readiness inspection is still running.',true);
  if(!snapshot.ready&&!degraded)return setStatus('Complete the available readiness actions or choose Continue Degraded.',true);
  if(degraded)rallyDayPreflight.continueDegraded({userGesture:true,scope});
  let session=currentRallySession();if(!session)session=await startNewRallySession(scope.dayNumber,{refreshPreflight:false});
  const acceptedScope=preflightScope();acceptedRallySessionId=session?.sessionId||acceptedRallySessionId;acceptedPreflightScopeKey=preflightScopeKey(acceptedScope);cameraSetupDismissed=degraded&&!snapshot.capabilities.camera?.automaticCaptureEligible;
  const gpsAlreadyActive=state.gpsWatchId!==null;if(!gpsAlreadyActive)startGps({preflightAction:true});else void startRallyAnalytics();
  const checkpoint=currentCheckpoint()||currentHotel()||{id:`day-${acceptedScope.dayNumber}`,type:'day',day:acceptedScope.dayNumber,name:`Day ${acceptedScope.dayNumber}`},timestamp=core.clock.iso();
  await appendRallyJournalEvent('day_preflight_completed',checkpoint,{eventIdentity:`day-preflight:${timestamp}`,source:'rally_day_preflight',preflightStatus:snapshot.status,degradedContinuation:Boolean(degraded),capabilities:preflightJournalSnapshot(snapshot),title:`Day ${acceptedScope.dayNumber} Readiness`,summary:degraded?'Rider deliberately continued with one or more degraded capabilities.':'All checked capabilities were ready before riding.'},timestamp);
  await releaseExpiredPendingEvidence();await saveProject(false);await startRallyReliabilityServices({triggerSessionBackup:true});renderAll();return snapshot;
}
function rideMemoryIntervalMinutes(){return Math.max(1,Math.min(360,Number(state.settings.rideMemoryIntervalMinutes)||DEFAULT_RIDE_MEMORY_INTERVAL_MINUTES));}
function rideMemoryIntervalMs(){return rideMemoryIntervalMinutes()*60*1000;}
function rideMemorySessionContext(){
  const session=currentRallySession(),day=session?.dayNumber;if(!session||acceptedRallySessionId!==session.sessionId||showRallySessionChoice()||showDayPreflight()||rallyScopeSuspended||rallyDayState(day).status==='complete')return null;
  return {active:true,projectId:String(state.project.projectId),projectName:state.project.name||'CannonMap',rallyName:state.project.name||'CannonMap',sessionId:session.sessionId,dayNumber:Number(day),sessionRunNumber:session.runNumber,sessionCalendarDate:session.calendarDate,sessionStartedAt:session.startedAt};
}
async function restoreRideMemoryCheckpointCoverage(context=rideMemorySessionContext()){
  if(!context||!missionMedia||!rideMemoryCapture)return null;
  rideMemoryCapture.noteCheckpointCapture?.({capturedAt:0,checkpointId:null,mediaIds:[]});
  try{
    const rows=typeof missionMedia.listProjectSessionPhotos==='function'?await missionMedia.listProjectSessionPhotos(context.projectId,context.sessionId):await missionMedia.listProjectPhotos(context.projectId),sessionId=String(context.sessionId),groups=new Map();
    for(const record of rows||[]){
      const recordSessionId=String(record.sessionId||record.metadata?.sessionId||''),captureType=String(record.metadata?.captureType||record.metadata?.objectiveType||record.objectiveType||'').toLowerCase(),checkpointId=String(record.checkpointId||''),pairId=String(record.pairId||record.metadata?.pairId||'');
      if(recordSessionId!==sessionId||captureType==='ride_memory'||captureType==='journey'||checkpointId.startsWith('ride-memory:')||record.pairStatus!=='complete'||!pairId||!checkpointId||!record.mediaId)continue;
      const capturedAt=Date.parse(record.capturedAt||record.metadata?.captureTimestamp||record.metadata?.capturedAt||'');if(!Number.isFinite(capturedAt))continue;
      const key=`${checkpointId}:${pairId}`;if(!groups.has(key))groups.set(key,{checkpointId,pairId,capturedAt:0,mediaIds:[],roles:new Set()});const group=groups.get(key);group.capturedAt=Math.max(group.capturedAt,capturedAt);group.mediaIds.push(String(record.mediaId));group.roles.add(`${record.cameraRole||record.metadata?.cameraRole||''}:${record.role||''}`);
    }
    const requiredRoles=['front:original','front:evidence','rear:original','rear:evidence'],newest=[...groups.values()].filter(group=>requiredRoles.every(role=>group.roles.has(role))).sort((a,b)=>b.capturedAt-a.capturedAt)[0];
    if(!newest)return null;
    const restored=rideMemoryCapture.noteCheckpointCapture?.({capturedAt:newest.capturedAt,checkpointId:newest.checkpointId,mediaIds:[...new Set(newest.mediaIds)]})||null;rallyDebug.record('ride_memory_checkpoint_coverage_restored',{sessionId,checkpointId:newest.checkpointId,capturedAt:new Date(newest.capturedAt).toISOString(),mediaCount:newest.mediaIds.length});return restored;
  }catch(error){rallyDebug.record('ride_memory_checkpoint_coverage_restore_failed',{sessionId:context.sessionId,error:error?.message||String(error)});return null;}
}
function handleRideMemoryState(snapshot){
  const schedule=snapshot?.schedule,outcome=schedule?.lastOutcome?.outcome;
  if(!snapshot?.running)rideMemoryUiState={status:'Off',attention:false};
  else if(schedule?.persistenceStatus==='failed')rideMemoryUiState={status:'ACTION REQUIRED · Ride Memory schedule is not protected',attention:true};
  else if(schedule?.status==='deferred'||schedule?.status==='missed')rideMemoryUiState={status:'DELAYED · checkpoint camera has priority',attention:false};
  else if(outcome==='failed')rideMemoryUiState={status:'Last memory photo failed · will try the next slot',attention:true};
  else rideMemoryUiState={status:schedule?.nextScheduledAt?`ON · next ${new Date(schedule.nextScheduledAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`:'ON',attention:false};
  renderReliabilityStatus();
}
function handleAutomaticBackupResult(result){
  if(!result)return;
  if(result.status==='failed'){
    automaticBackupUiState={...automaticBackupUiState,internal:'Internal recovery retry needed',attention:true};backupSchedulerHealth?.backupFailed?.(result.error||'Automatic recovery failed.');
  }else{
    const count=result.manifest?.mediaCount;automaticBackupUiState={...automaticBackupUiState,internal:`Internal recovery verified${Number.isFinite(Number(count))?` · ${count} media`:''}`,attention:false};
    const external=result.external||{};
    if(external.status===EXTERNAL_BACKUP_STATUS.READY){automaticBackupUiState.external=`External backup verified · ${external.filename}`;backupSchedulerHealth?.backupCompleted?.({filename:external.filename});}
    else if(external.status===EXTERNAL_BACKUP_STATUS.FAILED){automaticBackupUiState.external='EXTERNAL BACKUP FAILED · internal recovery is safe';automaticBackupUiState.attention=true;backupSchedulerHealth?.backupFailed?.(external.error||'External backup failed.');}
    else if(external.status===EXTERNAL_BACKUP_STATUS.NEEDS_PERMISSION)automaticBackupUiState.external='EXTERNAL BACKUP NEEDS PERMISSION';
    else if(external.status===EXTERNAL_BACKUP_STATUS.UNSUPPORTED)automaticBackupUiState.external='External folder backup unavailable in this browser';
    else if(external.status===EXTERNAL_BACKUP_STATUS.DEFERRED)automaticBackupUiState.external='External backup current · next checkpoint write deferred';
    if(external.status!==EXTERNAL_BACKUP_STATUS.FAILED)backupSchedulerHealth?.backupCompleted?.({filename:external.filename||null});
  }
  renderReliabilityStatus();
}
function renderReliabilityStatus(){
  if($('rallyInternalRecoveryStatus')){$('rallyInternalRecoveryStatus').textContent=automaticBackupUiState.internal;$('rallyInternalRecoveryStatus').classList.toggle('attention',automaticBackupUiState.attention);}
  if($('rallyExternalBackupStatus')){$('rallyExternalBackupStatus').textContent=automaticBackupUiState.external;$('rallyExternalBackupStatus').classList.toggle('attention',/NEEDS PERMISSION|FAILED/.test(automaticBackupUiState.external));}
  if($('rallyRideMemoryStatus')){$('rallyRideMemoryStatus').textContent=rideMemoryUiState.status;$('rallyRideMemoryStatus').classList.toggle('attention',rideMemoryUiState.attention);}
  if($('rideMemoryIntervalMinutes'))$('rideMemoryIntervalMinutes').value=String(rideMemoryIntervalMinutes());
  const supported=typeof globalThis.showDirectoryPicker==='function';if($('rallyChooseBackupFolder')){$('rallyChooseBackupFolder').textContent=supported?'CHOOSE BACKUP FOLDER':'EXTERNAL FOLDER UNSUPPORTED';$('rallyChooseBackupFolder').disabled=!supported;}
}
async function automaticBackupContext(){
  const session=currentRallySession(),scope=rallyScopeSnapshot();if(!session||acceptedRallySessionId!==session.sessionId||showRallySessionChoice()||showDayPreflight()||rallyScopeSuspended)return null;
  const projectId=String(state.project.projectId),dayNumber=Number(session.dayNumber),sessionCopy=deepClean(session);sessionCopy.projectId=projectId;
  const events=journalEventsForSession(journalEventsForDay((await rallyJournal.getProjectJournal(projectId)).events,dayNumber),sessionCopy);
  if(!rallyScopeMatches(scope.token)||acceptedRallySessionId!==sessionCopy.sessionId)return null;
  const competitors=(state.project.competitors||[]).map(competitor=>({...competitor,points:(competitor.points||[]).slice(-2)})),source={...state.project,competitors,stationaryEvents:(state.project.stationaryEvents||[]).slice(-100),rallyExecution:{...(state.project.rallyExecution||{}),activeSessionId:sessionCopy.sessionId,sessions:{[sessionCopy.sessionId]:sessionCopy},daySessions:{[String(dayNumber)]:[sessionCopy.sessionId]}}},project=createSessionProjectSnapshot(source,dayNumber,sessionCopy),settings=deepClean(state.settings);
  return {projectId,dayNumber,session:sessionCopy,project,settings,journal:events,rallyName:project.name||'CannonMap',tripId:project.tripId||projectId,rallyId:String(state.settings.rallyEventId||sessionCopy.rallyId||projectId),buildIdentity:{applicationVersion:APP_VERSION,buildId:BUILD_ID,serviceWorkerCacheId:APP_SHELL_CACHE}};
}
async function requestAutomaticBackup(trigger){
  if(!automaticBackup)return null;
  try{const context=await automaticBackupContext();if(!context)return null;backupSchedulerHealth?.backupStarted?.();const queued=automaticBackup.enqueue(context,{trigger});return queued.task;}
  catch(error){backupSchedulerHealth?.backupFailed?.(error);automaticBackupUiState={...automaticBackupUiState,internal:'Internal recovery retry needed',attention:true};renderReliabilityStatus();rallyDebug.record('automatic_backup_context_failed',{trigger,error:error?.message||String(error)});return null;}
}
async function refreshExternalBackupState(){
  try{const external=await automaticBackup?.externalState?.();if(!external)return null;if(external.status===EXTERNAL_BACKUP_STATUS.READY)automaticBackupUiState.external=`External folder ready · ${external.directoryName||'selected'}`;else if(external.status===EXTERNAL_BACKUP_STATUS.NEEDS_PERMISSION)automaticBackupUiState.external='EXTERNAL BACKUP NEEDS PERMISSION';else if(external.status===EXTERNAL_BACKUP_STATUS.UNSUPPORTED)automaticBackupUiState.external='External folder backup unavailable in this browser';renderReliabilityStatus();return external;}
  catch(error){automaticBackupUiState.external='External backup status unavailable';renderReliabilityStatus();return null;}
}
async function chooseExternalBackupDirectory(){
  if(rejectRallyMutationWhileQuiesced('choose a backup folder'))return null;
  try{const result=await automaticBackup?.chooseExternalDirectoryFromUserGesture?.();await refreshExternalBackupState();if(result?.status===EXTERNAL_BACKUP_STATUS.READY){setStatus(`External backup folder ready: ${result.directoryName||'selected folder'}.`);void requestAutomaticBackup(AUTOMATIC_BACKUP_TRIGGER.SCHEDULED);}else setStatus('External backup needs directory permission. Internal recovery remains active.',true);return result;}
  catch(error){if(error?.name==='AbortError'){setStatus('Backup folder selection canceled. Internal recovery remains active.');return null;}setStatus(`External backup folder could not be configured: ${error.message}`,true);return null;}
}
async function changeRideMemoryInterval(){
  const minutes=Math.max(1,Math.min(360,Number($('rideMemoryIntervalMinutes')?.value)||DEFAULT_RIDE_MEMORY_INTERVAL_MINUTES));state.settings.rideMemoryIntervalMinutes=minutes;await saveProject(false);await rideMemoryCapture?.setInterval?.(minutes*60*1000);renderReliabilityStatus();setStatus(`Ride Memory interval set to ${minutes} minute${minutes===1?'':'s'}.`);
}
async function startRallyReliabilityServices({triggerSessionBackup=false}={}){
  const context=rideMemorySessionContext();if(!context)return false;
  const health=backupSchedulerHealth?.state?.();if(health?.sessionId!==context.sessionId)backupSchedulerHealth?.beginSession?.({sessionId:context.sessionId,startedAt:currentRallySession()?.startedAt||Date.now()});
  automaticBackup?.start?.(automaticBackupContext);if(reliabilityHealthTimer===null)reliabilityHealthTimer=setInterval(()=>{if(document.visibilityState==='visible')void runReliabilityHealthCheck({force:true});},RELIABILITY_HEALTH_INTERVAL_MS);lastReliabilityHealthCheckAt=Date.now();await restoreRideMemoryCheckpointCoverage(context);await rideMemoryCapture?.start?.();if(Number(rideMemoryCapture?.state?.().schedule?.intervalMs)!==rideMemoryIntervalMs())await rideMemoryCapture?.setInterval?.(rideMemoryIntervalMs());void refreshExternalBackupState();if(triggerSessionBackup)void requestAutomaticBackup(AUTOMATIC_BACKUP_TRIGGER.SESSION_START);renderReliabilityStatus();return true;
}
async function stopRallyReliabilityServices(reason='session-stopped'){
  if(reliabilityHealthTimer!==null)clearInterval(reliabilityHealthTimer);reliabilityHealthTimer=null;automaticBackup?.stop?.();rideMemoryCapture?.stop?.(reason);cameraCaptureArbiter?.cancelMemory?.(reason);await Promise.all([rideMemoryCapture?.whenIdle?.(),automaticBackup?.drain?.(),reliabilityHealthTask].filter(Boolean));backupSchedulerHealth?.clear?.();lastReliabilityHealthCheckAt=0;renderReliabilityStatus();
}
function runReliabilityHealthCheck({force=false}={}){
  if(reliabilityHealthTask)return reliabilityHealthTask;
  const context=rideMemorySessionContext(),now=Date.now();if(!context||!force&&now-lastReliabilityHealthCheckAt<5*60*1000)return null;lastReliabilityHealthCheckAt=now;
  reliabilityHealthTask=(async()=>{
    const backupState=automaticBackup?.state?.();
    if(backupState&&!backupState.running){automaticBackup.start(automaticBackupContext);rallyDebug.record('backup_scheduler_restarted',{sessionId:context.sessionId,foreground:document.visibilityState==='visible'});}
    const health=backupSchedulerHealth?.state?.();if(health?.backupStatus==='overdue'&&!automaticBackup?.state?.().pendingSessions?.length)void requestAutomaticBackup(AUTOMATIC_BACKUP_TRIGGER.SCHEDULED);
    if(state.settings.rallyLivePollingEnabled===true&&!state.rallyLiveFeed&&!livePollController)restoreRallyPollingIntent();
    if(cameraReadinessState().capability==='interrupted'&&cameraReadinessState().permission==='granted')void refreshCameraReadiness();
    renderReliabilityStatus();
  })().finally(()=>{reliabilityHealthTask=null;});return reliabilityHealthTask;
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
    const migration=migrateRallyFeedDefaults(JSON.parse(raw));
    Object.assign(state.settings,migration.settings);
    if(migration.changed)localStorage.setItem(SETTINGS_KEY,JSON.stringify(migration.settings));
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
function buildImportReport(features,files,auto,ordering={}) {
  const byType=type=>features.filter(f=>f.type===type).length;
  const unassigned=features.filter(f=>!f.day).length;
  const duplicates=features.filter(f=>findDuplicate(f)).length;
  const unnamed=features.filter(f=>!f.name||/^.+ (route|track|waypoint) \d+$/i.test(f.name)).length;
  const shortLines=features.filter(f=>f.geometry.kind==='line'&&f.geometry.coordinates.length<2).length;
  const warnings=[]; if(unassigned)warnings.push(`${unassigned} features still need day review.`); if(duplicates)warnings.push(`${duplicates} probable duplicates match the current project.`); if(unnamed)warnings.push(`${unnamed} features use generated or weak names.`); if(shortLines)warnings.push(`${shortLines} line features have insufficient geometry.`);
  return {
    files,features,auto,unassigned,duplicates,unnamed,shortLines,warnings,ordering,
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
  const ordering=checkpoints.resolveImportedCheckpointOrder(imported,{preserveResolved:true});
  state.pendingImport=buildImportReport(imported,names,auto,ordering);
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
      <article><span>Explicit sequence</span><strong>${r.ordering.sortedByExplicitSequence+r.ordering.sortedByCannonMapSequence}</strong></article>
      <article><span>Numeric name prefix</span><strong>${r.ordering.sortedByNumericNamePrefix}</strong></article>
      <article><span>Original order retained</span><strong>${r.ordering.retainedOriginalOrder}</strong></article>
      <article><span>Duplicate prefixes</span><strong>${r.ordering.duplicateNumericPrefixes.length}</strong></article>
    </div>
    ${r.ordering.ambiguousNames.length?`<div class="notice muted"><strong>No sortable numeric prefix:</strong> ${r.ordering.ambiguousNames.map(escapeHtml).join(', ')}</div>`:''}
    ${r.ordering.duplicateNumericPrefixes.length?`<ul class="inspector-warnings">${r.ordering.duplicateNumericPrefixes.map(item=>`<li>Duplicate ${escapeHtml(item.prefix)}: ${item.names.map(escapeHtml).join(', ')}</li>`).join('')}</ul>`:''}
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
  const payload=projectWorkflows.createPortableProject({project:planningOnlyPortableProject(state.project,{projectId:state.project.projectId}),settings:planningOnlyPortableSettings(state.settings),appVersion:APP_VERSION,build:BUILD_ID,exportedAt:new Date().toISOString()});
  downloadBlob(JSON.stringify(payload,null,2),`${safeFilename(state.project.name)}.cmap`,'application/json');
  setStatus('Saved portable .cmap project file.');
}
async function openProjectFile(file,{mutationToken=null}={}) {
  const mutation=acquireProjectMutation('open another Project',mutationToken);if(!mutation)return;
  let releaseSaveFence=beginProjectSaveFence('portable-project-open');
  try{
    await projectSaveQueue;
    const payload=JSON.parse(await file.text());
    const portable=projectWorkflows.readPortableProject(payload),knownProjects=projectLifecycle?await projectLifecycle.listProjects():[],requestedProjectId=String(portable.project?.projectId||portable.project?.id||uid()),collision=knownProjects.some(item=>String(item.projectId)===requestedProjectId),project=planningOnlyPortableProject(portable.project,{projectId:collision?uid():requestedProjectId,nameSuffix:collision?' · Imported Copy':''});
    await suspendPendingEvidenceRuntime('portable-project-open');
    await releaseRallyAnalyticsProjectScope('portable-project-open');
    snapshot();
    state.project=sanitizeProjectData(project,`.cmap ${file.name}`);
    state.project.projectId ||= uid();
    state.project.version=APP_VERSION;
    if($('projectName'))$('projectName').value=state.project.name;
    state.settings=Object.assign({},planningOnlyPortableSettings(defaultProjectSettings||state.settings),planningOnlyPortableSettings(portable.settings||{}));restoredDayReview=null;
    if(projectLifecycle){
      state.project=await projectLifecycle.createProject(state.project,{activate:true});
      activeLifecycleProjectId=state.project.projectId;
    }
    rallyExecution();resetRallySessionSelection();await bindRallyAnalyticsToActiveProject();
    resumeRallyScopeRuntime('portable-project-open-complete');
    clearSelection();
    releaseSaveFence?.();releaseSaveFence=null;
    await saveProject(false);
    renderAll();fitMap();
    setStatus(`Opened ${file.name}${collision?' as an independent Project copy':''}: ${state.project.features.length} features.`);
  }catch(error){setStatus(`Project open failed: ${error.message}`,true);}
  finally{if(rallyScopeSuspended)resumeRallyScopeRuntime('portable-project-open-recovered');releaseSaveFence?.();mutation.release();}
}


function getSnapshots(){try{return JSON.parse(localStorage.getItem(SNAPSHOT_KEY)||'[]');}catch(_){return[];}}
function writeSnapshots(items){localStorage.setItem(SNAPSHOT_KEY,JSON.stringify(items.slice(0,12)));}
function createNamedSnapshot(label='Manual snapshot',quiet=false){
  const items=getSnapshots();items.unshift({id:uid(),label,createdAt:new Date().toISOString(),project:deepClean(state.project),settings:deepClean(state.settings)});writeSnapshots(items);renderSnapshots();if(!quiet)setStatus(`Snapshot created: ${label}.`);
}
function preserveRallyExecutionHistory(restored,current){
  if(!restored||!current)return restored;const sessions=current.rallyExecution?.sessions||{};if(!Object.keys(sessions).length)return restored;
  restored.rallyExecution=deepClean(current.rallyExecution);const currentFeatures=new Map((current.features||[]).map(feature=>[String(feature.id),feature]));
  for(const feature of restored.features||[]){const live=currentFeatures.get(String(feature.id));if(!live)continue;for(const key of CHECKPOINT_EXECUTION_FIELDS){if(Object.prototype.hasOwnProperty.call(live,key))feature[key]=deepClean(live[key]);else delete feature[key];}}
  const restoredIds=new Set((restored.features||[]).map(feature=>String(feature.id)));for(const live of current.features||[]){if(restoredIds.has(String(live.id))||!['checkpoint','hotel'].includes(live.type))continue;if(CHECKPOINT_EXECUTION_FIELDS.some(key=>Object.prototype.hasOwnProperty.call(live,key)))restored.features.push(deepClean(live));}
  return restored;
}
const RALLY_EXECUTION_SETTING_KEYS=Object.freeze(['mediaBackups','mediaBackupProgress','mediaBackupReminderDay','lastMediaExportAt','restoredDayReview']);
function planningOnlyPortableSettings(settings){const copy=deepClean(settings||{});for(const key of RALLY_EXECUTION_SETTING_KEYS)delete copy[key];return copy;}
function preserveRallyExecutionSettings(restored,current){const copy=deepClean(restored||{});for(const key of RALLY_EXECUTION_SETTING_KEYS){if(Object.prototype.hasOwnProperty.call(current||{},key))copy[key]=deepClean(current[key]);else delete copy[key];}return copy;}
function planningOnlyPortableProject(project,{projectId=project?.projectId||project?.id||uid(),nameSuffix=''}={}){
  const copy=deepClean(project);copy.projectId=projectId;copy.id=projectId;copy.name=`${copy.name||'CannonMap'}${nameSuffix}`;delete copy.rallyExecution;delete copy.executionId;
  for(const feature of copy.features||[])for(const key of CHECKPOINT_EXECUTION_FIELDS)delete feature[key];
  return copy;
}
async function restoreSnapshot(id,{mutationToken=null}={}){
  const mutation=acquireProjectMutation('restore a snapshot',mutationToken);if(!mutation)return;
  try{
    const item=getSnapshots().find(x=>x.id===id);if(!item)return;
    const snapshotProjectId=String(item.project?.projectId||item.project?.id||''),currentProjectId=String(state.project?.projectId||state.project?.id||'');
    if(!snapshotProjectId||snapshotProjectId!==currentProjectId||snapshotProjectId!==String(activeLifecycleProjectId||''))return setStatus('This snapshot belongs to a different Project and cannot replace the active rally session. Open that Project before restoring its snapshot.',true);
    await suspendPendingEvidenceRuntime('snapshot-restore');snapshot();state.project=sanitizeProjectData(preserveRallyExecutionHistory(deepClean(item.project),state.project),'restored snapshot');if(item.settings)state.settings=Object.assign({},state.settings,preserveRallyExecutionSettings(item.settings,state.settings));rallyExecution();resetRallySessionSelection();await rebindRallyAnalyticsForActiveProject('snapshot-restore');resumeRallyScopeRuntime('snapshot-restore-complete');await saveProject(false);clearSelection();renderAll();fitMap();setStatus(`Restored planning snapshot from ${new Date(item.createdAt).toLocaleString()}. Rally session history and evidence state were preserved.`);
  }finally{if(rallyScopeSuspended)resumeRallyScopeRuntime('snapshot-restore-recovered');mutation.release();}
}
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
    const configuredDays=[...new Set(state.project.features.map(feature=>Number(feature.day)).filter(day=>Number.isInteger(day)&&day>0))].sort((a,b)=>a-b);
    $('dailyReadiness').innerHTML=configuredDays.map(day=>{
      const rows=fs.filter(f=>f.day===day);
      const cp=rows.filter(f=>f.type==='checkpoint').length;
      const hotel=rows.filter(f=>f.type==='hotel').length;
      const dm=planningMileage(rows);
      const score=Math.min(100,(rows.length?40:0)+(cp?25:0)+(hotel?20:0));
      return `<div class="day-card" data-day-card="${day}"><header><strong>Day ${day}</strong><span>${dm.toFixed(0)} mi</span></header><small>${cp} checkpoints · ${hotel} hotel · ${rows.length} features</small><div class="day-meter"><i style="width:${score}%"></i></div></div>`;
    }).join('');
    $('dailyReadiness').querySelectorAll('[data-day-card]').forEach(c=>c.onclick=trackedRallyAction(async()=>{if(rejectRallyMutationWhileQuiesced('change rally days'))return;await suspendPendingEvidenceRuntime('daily-readiness-selection');try{state.settings.dayFilter=c.dataset.dayCard;$('dayFilter').value=state.settings.dayFilter;resetRallySessionSelection();resumeRallyScopeRuntime('daily-readiness-selection-complete');document.querySelector('[data-tab="project"]')?.click();await saveProject(false);renderAll();void refreshDayPreflight();}finally{if(rallyScopeSuspended)resumeRallyScopeRuntime('daily-readiness-selection-recovered');}}));
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
  if(feature.geometry.kind==='point'){const p=feature.geometry.coordinates[0];performProgrammaticMapChange('feature-focus',()=>state.map.setView([p.lat,p.lon],15,{animate:false}));}
  else performProgrammaticMapChange('feature-focus',()=>state.map.fitBounds(feature.geometry.coordinates.map(p=>[p.lat,p.lon]),{padding:[30,30],animate:false}));
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
  return performProgrammaticMapChange('fit-map',()=>mapEngine.fitLayerType('features',{padding:[25,25],animate:false}));
}

function safeFilename(name){return String(name||'cannonmap').trim().replace(/[^a-z0-9_-]+/gi,'-').replace(/^-|-$/g,'').toLowerCase();}
function downloadBlob(content,filename,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),500);}
function downloadStoredBlob(blob,filename){const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=filename;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
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
  const manifestDays=[...new Set(manifest.map(row=>Number(row.Day)).filter(day=>Number.isInteger(day)&&day>0))].sort((a,b)=>a-b);
  add('Daily Summary',manifestDays.map(day=>{const rows=manifest.filter(r=>r.Day===day);return {Day:day,Features:rows.length,Checkpoints:rows.filter(r=>r.Type==='checkpoint').length,Routes:rows.filter(r=>r.Type==='route').length,Tracks:rows.filter(r=>r.Type==='track').length,'Line Miles':Number(rows.reduce((s,r)=>s+(Number(r['Distance (mi)'])||0),0).toFixed(2))};}));
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

function cameraReadinessState(){return cameraReadiness?.state?.()||{permission:'unknown',capability:'uninitialized',automaticCaptureEligible:false,reasonCode:'not-initialized',permissionQuerySupported:false,getUserMediaSupported:Boolean(navigator.mediaDevices?.getUserMedia),imageCaptureSupported:typeof globalThis.ImageCapture==='function',lastVerifiedAt:null,setupAttemptedThisSession:false,priorSetupSucceeded:false};}
function cameraSetupRequired(){const camera=cameraReadinessState();return camera.permission==='denied'||['uninitialized','checking','setup-required','interrupted'].includes(camera.capability);}
function showCameraSetup(){const day=activeRallyDay();return Boolean(day&&!showRallySessionChoice()&&rallyDayState(day).status!=='complete'&&!restoredDayReview&&!showDayPreflight()&&state.gpsWatchId===null&&!cameraSetupDismissed&&cameraSetupRequired());}
async function refreshCameraReadiness(){const result=await cameraReadiness?.inspect?.({force:true});if(rallyDayPreflight&&activeRallyDay())await refreshDayPreflight();else renderRallyMode();return result||cameraReadinessState();}
async function enableCameraForRally(){
  if(rejectRallyMutationWhileQuiesced('enable the camera'))return null;
  if(showDayPreflight())return runPreflightAction(PREFLIGHT_CAPABILITY.CAMERA);
  cameraSetupDismissed=false;
  const result=await cameraReadiness?.setupFromUserGesture?.();
  renderRallyMode();
  if(result?.automaticCaptureEligible){
    setStatus('Camera ready for automatic checkpoint capture.');
    const resume=resumeGpsAfterCameraSetup;resumeGpsAfterCameraSetup=false;if(resume)startGps();
  }else if(result?.permission==='denied')setStatus('Camera permission is blocked. Use browser site settings to enable it, or continue with manual checkpoint capture.',true);
  else setStatus('Automatic camera setup did not complete. Retry while stationary or continue with manual checkpoint capture.',true);
  return result;
}
function continueWithManualCamera(){
  const camera=cameraReadinessState();cameraSetupDismissed=true;
  rallyDebug.record('camera_manual_mode_acknowledged',{permission:camera.permission,capability:camera.capability,reasonCode:camera.reasonCode});renderRallyMode();
  const resume=resumeGpsAfterCameraSetup;resumeGpsAfterCameraSetup=false;if(resume)startGps();
}

function gpsTrackingRequested(){return Boolean(gpsWatchdog?.state?.().desired||state.gpsWatchId!==null);}
function handleGpsPosition(position){
  gpsPreflightError=null;gpsFixReceivedAt=Date.now();
  const rawPoint={lat:position.coords.latitude,lon:position.coords.longitude},zoom=navigationZoomForPosition(rawPoint),followed=gpsFollow?.update({...rawPoint,heading:position.coords.heading},{targetZoom:zoom.targetZoom,zoomReason:zoom.zoomReason});
  const ll=[followed?.lat??position.coords.latitude,followed?.lon??position.coords.longitude],accuracyFeet=position.coords.accuracy*3.28084;
  state.lastGpsPosition={lat:ll[0],lon:ll[1],heading:followed?.heading??null,speedMps:Number.isFinite(position.coords.speed)?position.coords.speed:null,accuracyFeet,elevationFeet:Number.isFinite(position.coords.altitude)?position.coords.altitude*3.28084:null,time:new Date(position.timestamp||Date.now()).toISOString()};
  if(showDayPreflight()&&currentPreflightState()?.capabilities?.gps?.status!==PREFLIGHT_STATUS.READY)void refreshDayPreflight();
  void runReliabilityHealthCheck();
  weatherMaintenance?.onGps(state.lastGpsPosition,{moving:Number(position.coords.speed)>=.44704}).catch(()=>{});
  if(state.gpsAccuracyLayer){state.gpsAccuracyLayer.setLatLng(ll);state.gpsAccuracyLayer.setRadius(position.coords.accuracy);}else state.gpsAccuracyLayer=L.circle(ll,{radius:position.coords.accuracy,color:'#38bdf8',weight:1,fillOpacity:.08}).addTo(state.map);
  if(state.gpsLayer)state.gpsLayer.setLatLng(ll);else state.gpsLayer=L.circleMarker(ll,{pane:'activeRiderPane',radius:8,color:'#fff',weight:3,fillColor:'#38bdf8',fillOpacity:1,className:'rider-position-marker'}).addTo(state.map);state.gpsLayer.getElement()?.classList.add('rider-position-marker');
  if($('gpsStatus'))$('gpsStatus').textContent=`GPS ±${Math.round(accuracyFeet)} ft`;
  evaluateCheckpointArrival(accuracyFeet);renderRallyMode();captureGpsObservation(position);recordRallyTelemetry(position);
}
function handleGpsWatchError(error){
  gpsPreflightError={code:Number(error?.code)||null,message:error?.message||'Location access failed.'};
  rallyDebug.record('gps_error',{code:error?.code||null,message:error?.message||String(error)});
  if(Number(error?.code)===1)setStatus('GPS permission is blocked. Enable Location for CannonMap, then tap START GPS.',true);
  else setStatus('GPS signal stopped; CannonMap is restarting the location watch.',true);
  if(showDayPreflight())void refreshDayPreflight();renderRallyMode();
}
function handleGpsWatchState(snapshot){
  const requested=Boolean(snapshot?.desired),blocked=snapshot?.status==='blocked';state.gpsWatchId=requested&&!blocked?'watchdog':null;
  if(blocked){gpsWatchStartedAt=null;gpsFixReceivedAt=null;void stopRallyAnalytics('gps-permission-blocked');void screenWakeLock?.stop('gps-permission-blocked');}
  const uiKey=`${requested}:${snapshot?.status||'unknown'}:${blocked}`;if(uiKey===lastGpsWatchUiKey)return;lastGpsWatchUiKey=uiKey;
  if($('gpsButton'))$('gpsButton').textContent=requested&&!blocked?'Stop GPS':'Start GPS';
  if($('gpsStatus')){
    if(blocked)$('gpsStatus').textContent='GPS blocked';
    else if(['backoff','stalled'].includes(snapshot?.status))$('gpsStatus').textContent='GPS reconnecting…';
    else if(snapshot?.status==='starting')$('gpsStatus').textContent='GPS starting…';
    else if(!requested)$('gpsStatus').textContent='GPS off';
  }
  renderRallyMode();
}
function handleGpsWatchRestart(details){
  rallyDebug.record('gps_watch_restart',{...details,foreground:document.visibilityState==='visible'});
  const session=currentRallySession();if(!session||acceptedRallySessionId!==session.sessionId||showDayPreflight())return;
  const timestamp=core.clock.iso();void appendRallyJournalEvent('gps_watch_restarted',currentCheckpoint()||null,{eventIdentity:`gps-watch-restart:${timestamp}`,source:'gps_watchdog',restartReason:details.reason,restartAttempt:details.attempt,retryDelayMs:details.delay,title:'GPS Watch Restarted',summary:'CannonMap detected a foreground GPS stall and safely restarted its single location watch.'},timestamp).catch(()=>{});
}
function initializeGpsWatchdog(){
  gpsWatchdog?.destroy?.();
  if(!navigator.geolocation)return null;
  gpsWatchdog=createGpsWatchdog({geolocation:navigator.geolocation,visible:()=>document.visibilityState==='visible',stallAfterMs:GPS_FOREGROUND_STALL_MS,onPosition:handleGpsPosition,onError:handleGpsWatchError,onStateChange:handleGpsWatchState,onRestart:handleGpsWatchRestart});return gpsWatchdog;
}
function stopGpsTracking(reason='gps-stopped'){
  gpsWatchdog?.stop?.(reason);state.gpsWatchId=null;gpsWatchStartedAt=null;gpsFixReceivedAt=null;lastGpsWatchUiKey=null;void stopRallyAnalytics(reason);void screenWakeLock?.stop(reason);
  if($('gpsButton'))$('gpsButton').textContent='Start GPS';if($('gpsStatus'))$('gpsStatus').textContent='GPS off';rallyDebug.record('follow_mode_changed',{enabled:false,reason});renderRallyMode();
}
function startGps(options={}) {
  if(rejectRallyMutationWhileQuiesced('start GPS'))return;
  const preflightAction=options?.preflightAction===true;
  if(!navigator.geolocation){
    setStatus('This browser does not support GPS.',true);
    return;
  }
  const priorWatch=gpsWatchdog?.state?.();if(priorWatch?.desired&&priorWatch.status!=='blocked'){
    if(preflightAction){gpsWatchdog?.checkNow?.();return priorWatch;}
    stopGpsTracking();return;
  }
  if(activeRallyDay()&&showRallySessionChoice()&&!preflightAction){renderRallyMode();setStatus('Choose Resume Existing or Start New before riding.');return;}
  if(activeRallyDay()&&showDayPreflight()&&!preflightAction){
    void refreshDayPreflight();renderRallyMode();setStatus('Review day readiness before riding, or deliberately continue degraded.');return;
  }
  const rallyDay=activeRallyDay(),activeDayNeedsSetup=Boolean(rallyDay&&rallyDayState(rallyDay).status!=='complete'&&!restoredDayReview);
  if(activeDayNeedsSetup&&cameraSetupRequired()&&!cameraSetupDismissed&&!preflightAction){
    resumeGpsAfterCameraSetup=true;renderRallyMode();setStatus('Enable the camera once before starting the rally, or choose manual camera mode.');setTimeout(()=>{const enable=$('rallyEnableCameraButton');if(enable&&!enable.hidden)enable.focus();else $('rallyCameraContinueManualButton')?.focus();},0);return;
  }
  void missionStorage?.requestPersistence?.().then(()=>renderStorageAndProjects()).catch(()=>{});
  void screenWakeLock?.start('gps-started');
  if($('gpsStatus')) $('gpsStatus').textContent='GPS starting…';
  if($('gpsButton')) $('gpsButton').textContent='Stop GPS';
  renderRallyMode();
  startRallyAnalytics();
  gpsFollow?.restore('gps-started');
  gpsWatchStartedAt=Date.now();gpsFixReceivedAt=null;
  if(!gpsWatchdog)initializeGpsWatchdog();
  if(priorWatch?.status==='blocked')gpsWatchdog?.restart?.('permission-retry');else gpsWatchdog?.start?.();
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
function quarantineRallyAnalytics(reason,error){
  rallyDebug.record('analytics_session_quarantined',{reason,executionSessionId:analyticsExecutionSessionId,error:error?.message||String(error||'unknown')});rallyAnalytics=null;analyticsExecutionSessionId=null;refreshRideExportSource();
}
function enqueueRallyAnalyticsTransition(operation){const result=rallyAnalyticsTransition.then(operation);rallyAnalyticsTransition=result.catch(()=>{});return result;}
async function startRallyAnalyticsInternal({allowRecovery=true}={}){
  if(!rallyAnalytics)await bindRallyAnalyticsToActiveProject();if(!rallyAnalytics)return {status:'disabled'};
  const session=currentRallySession();if(!session||acceptedRallySessionId!==session.sessionId)return {status:'session-not-accepted'};
  const requestedSessionId=session.sessionId,service=rallyAnalytics;
  try{
    if(analyticsExecutionSessionId&&analyticsExecutionSessionId!==requestedSessionId){const stopped=await stopRallyAnalyticsInternal('rally-execution-session-changed');if(stopped.status==='failed'){if(!allowRecovery)return stopped;await bindRallyAnalyticsToActiveProject();return startRallyAnalyticsInternal({allowRecovery:false});}}
    const result=await service.startSession({
      rallyEventId:`${String(state.settings.rallyEventId||'local')}:${session.sessionId}`,riderId:'local-rider',startedAt:session.startedAt,
      extensions:{projectName:state.project.name||'',captureLifecycle:'gps-watch',executionSessionId:session.sessionId,dayNumber:session.dayNumber,runNumber:session.runNumber}
    });
    if(result.status!=='disabled'&&(result.executionSessionId!==requestedSessionId||rallyScopeSuspended||acceptedRallySessionId!==requestedSessionId||currentRallySessionId()!==requestedSessionId)){
      try{await service.stopSession({reason:'stale-rally-analytics-start'});}catch(_){ }
      const error=new Error('Analytics started for a stale or mismatched rally session.');quarantineRallyAnalytics('session-identity-mismatch',error);return {status:'stale-session'};
    }
    analyticsExecutionSessionId=requestedSessionId;return result;
  }catch(error){console.warn(`[CannonMap analytics] Session start failed: ${error?.message||error}`);quarantineRallyAnalytics('session-start-failed',error);if(allowRecovery){await bindRallyAnalyticsToActiveProject();return startRallyAnalyticsInternal({allowRecovery:false});}return {status:'failed'};}
}
function startRallyAnalytics(options={}){return enqueueRallyAnalyticsTransition(()=>startRallyAnalyticsInternal(options));}
async function stopRallyAnalyticsInternal(reason){
  if(!rallyAnalytics)return {status:'disabled'};
  try{const result=await rallyAnalytics.stopSession({reason});analyticsExecutionSessionId=null;return result;}catch(error){console.warn(`[CannonMap analytics] Session stop failed: ${error?.message||error}`);quarantineRallyAnalytics('session-stop-failed',error);return {status:'failed'};}
}
function stopRallyAnalytics(reason){return enqueueRallyAnalyticsTransition(()=>stopRallyAnalyticsInternal(reason));}
async function recordRallyTelemetry(position){
  if(!rallyAnalytics)return {status:'disabled'};
  const session=currentRallySession();if(!session||acceptedRallySessionId!==session.sessionId||analyticsExecutionSessionId!==session.sessionId||rallyScopeSuspended||showRallySessionChoice()||showDayPreflight())return {status:'session-not-accepted'};
  try{return await rallyAnalytics.recordGpsSample(position,{routeProgress:analyticsRouteProgress(),extensions:{executionSessionId:session.sessionId,dayNumber:session.dayNumber}});}
  catch(error){console.warn(`[CannonMap analytics] GPS sample failed: ${error?.message||error}`);return {status:'failed'};}
}
function recordAnalyticsCheckpoint(checkpoint,action){
  const session=currentRallySession();if(!rallyAnalytics||!session||acceptedRallySessionId!==session.sessionId||analyticsExecutionSessionId!==session.sessionId||rallyScopeSuspended||showRallySessionChoice()||showDayPreflight())return;
  rallyAnalytics?.recordCheckpointEvent({
    checkpointId:checkpoint.id,action,points:checkpoint.points,
    extensions:{day:checkpoint.day??null,sequence:checkpoint.sequence??null,type:checkpoint.type||'checkpoint',executionSessionId:session.sessionId}
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
function rallyExecution(){
  state.project.projectId||=state.project.id||stableUuid(`project:${state.project.name||'CannonMap'}:${state.project.createdAt||'legacy'}`);
  return migrateRallyExecution(state.project,{migratedAt:state.project.updatedAt||state.project.createdAt||core.clock.iso()});
}
function currentRallySession({matchActiveDay=true}={}){
  if(!state.project?.projectId&&!state.project?.id)return null;
  const session=activeRallySessionRecord(state.project);if(!session)return null;
  return matchActiveDay&&Number(session.dayNumber)!==Number(activeRallyDay())?null:session;
}
function currentRallySessionId(){return currentRallySession()?.sessionId||null;}
function sessionScopedIdentity(value){return `${currentRallySessionId()||'no-session'}:${value}`;}
function resetRallySessionSelection(){
  acceptedRallySessionId=null;pendingRallySessionId=null;acceptedPreflightScopeKey=null;cameraSetupDismissed=false;state.history=[];state.hotelBailoutActive=false;hotelBailoutUndo=null;
  pendingEvidenceQueue=createPendingEvidenceQueue();pendingEvidenceQueueOwner=null;rallyDayPreflight?.clearAcknowledgement?.();
}
function pendingEvidenceOwnerFor(session,project=state.project){return session&&project?.projectId?`${project.projectId}:${session.sessionId}`:null;}
function bindPendingEvidenceQueue(session=currentRallySession({matchActiveDay:false})){
  pendingEvidenceQueue=createPendingEvidenceQueue(session?.pendingEvidence||{});pendingEvidenceQueueOwner=pendingEvidenceOwnerFor(session);return pendingEvidenceQueue;
}
function ensurePendingEvidenceQueueForSession(session=currentRallySession({matchActiveDay:false})){
  return pendingEvidenceQueueOwner===pendingEvidenceOwnerFor(session)?pendingEvidenceQueue:bindPendingEvidenceQueue(session);
}
function syncCurrentRallySessionProjection(){
  if(!state.project?.projectId&&!state.project?.id)return null;
  const session=activeRallySessionRecord(state.project);if(!session)return null;
  if(acceptedRallySessionId!==session.sessionId)return session;
  const dayState=rallyExecution().days?.[String(session.dayNumber)]||{},completed=dayState.status==='complete'||session.status===RALLY_SESSION_STATUS.COMPLETED,queueOwned=pendingEvidenceQueueOwner===pendingEvidenceOwnerFor(session);
  return syncActiveSession(state.project,{
    activeObjectiveId:state.project.features.find(feature=>Number(feature.day)===Number(session.dayNumber)&&feature.status===checkpoints.CHECKPOINT_STATE.ACTIVE)?.id||null,
    pendingEvidence:queueOwned?pendingEvidenceQueue:undefined,status:completed?RALLY_SESSION_STATUS.COMPLETED:RALLY_SESSION_STATUS.ACTIVE,
    completedAt:completed?(dayState.completedAt||session.completedAt||core.clock.iso()):null,summary:dayState.summary??session.summary??null,nextDay:dayState.nextDay??session.nextDay??0,syncedAt:core.clock.iso()
  });
}
function loadPendingEvidenceForSession(session=currentRallySession({matchActiveDay:false})){
  return bindPendingEvidenceQueue(session);
}
function rallySessionChoiceState(){
  const day=activeRallyDay();if(!day)return {show:false,dayNumber:null,session:null,unfinished:[]};
  const inspection=inspectRallySessions(state.project,{dayNumber:day}),unfinished=inspection.unfinishedSessions||[];
  const active=inspection.activeSession&&Number(inspection.activeSession.dayNumber)===Number(day)&&inspection.activeSession.status!==RALLY_SESSION_STATUS.COMPLETED?inspection.activeSession:null;
  const session=active||unfinished.at(-1)||null,accepted=Boolean(session&&acceptedRallySessionId===session.sessionId);
  return {show:Boolean(session&&!accepted),dayNumber:day,session,unfinished,canResume:Boolean(session),canStartNew:true};
}
function showRallySessionChoice(){return rallySessionChoiceState().show;}
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
  const dayState=execution.days[key]||=( {dayNumber:normalizedDay,dayId:`day-${normalizedDay}`,sessionId:null,status:'not-started',startedAt:null,completedAt:null,nextDay:0,summary:null} );
  if(dayState.status==='complete')dayState.nextDay=checkpoints.nextRallyDay(state.project,normalizedDay);
  return dayState;
}
async function appendRallyJournalEvent(eventType,checkpoint,metadata={},timestamp=new Date().toISOString()){
  if(!rallyJournal||!state.project.projectId)return null;let settleWrite;const writeMarker=new Promise(resolve=>{settleWrite=resolve;});activeJournalWrites.add(writeMarker);
  const journalService=rallyJournal,projectId=String(state.project.projectId),rallyId=String(state.settings.rallyEventId||projectId),position=state.lastGpsPosition?deepClean(state.lastGpsPosition):null;
  const day=Number(checkpoint?.day)||activeRallyDay(),dayState=rallyDayState(day),session=currentRallySession({matchActiveDay:false}),sessionMatches=Boolean(session&&Number(session.dayNumber)===Number(day));
  const sessionAccepted=sessionMatches&&acceptedRallySessionId===session.sessionId&&metadata.sessionScope!==false,sessionId=sessionAccepted?session.sessionId:null,identity=metadata.eventIdentity||`${eventType}:${checkpoint?.id||'day'}:${day}:${metadata.transitionAt||timestamp}`;
  try{
    const event=await journalService.appendEventIdempotent({
      eventId:stableUuid(`${projectId}:${sessionId||'unscoped'}:${identity}`),projectId,sessionId,timestamp,eventType,source:metadata.source||'mission_control',
      title:metadata.title||checkpoint?.name||`Day ${day}`,summary:metadata.summary||'',
      metadata:{...metadata,rallyId,sessionId,sessionRunNumber:sessionAccepted?session.runNumber:null,sessionCalendarDate:sessionAccepted?session.calendarDate:null,sessionStartTimestamp:sessionAccepted?session.startedAt:null,dayId:sessionAccepted?session.dayId:dayState.dayId,dayNumber:day,dayStartTimestamp:sessionAccepted?session.startedAt:dayState.startedAt,
        objectiveId:checkpoint?.id||null,objectiveType:checkpoint?.type||null,checkpointId:checkpoint?.id||null,riderNotes:checkpoint?.notes||'',
        photoRequired:Boolean(checkpoint?.photoRequired),gpsAccuracyFeet:position?.accuracyFeet??null,
        collectionCoordinates:position?{lat:position.lat,lon:position.lon}:null},
      references:{checkpointId:checkpoint?.id||null,dayId:sessionAccepted?session.dayId:dayState.dayId,sessionId},attachments:{}
    });
    rallyDebug.record('journal_write_success',{eventType,eventId:event.eventId,checkpointId:checkpoint?.id||null});return event;
  }catch(error){rallyDebug.record('journal_write_failure',{eventType,checkpointId:checkpoint?.id||null,error:error?.message||String(error)});throw error;}
  finally{activeJournalWrites.delete(writeMarker);settleWrite();}
}
async function appendFailureJournalBestEffort(eventType,checkpoint,metadata={},timestamp=new Date().toISOString()){
  try{return await appendRallyJournalEvent(eventType,checkpoint,metadata,timestamp);}
  catch(error){
    try{rallyDebug.record('failure_policy_journal_unavailable',{eventType,checkpointId:checkpoint?.id||null,error:error?.message||String(error)});}catch(_){/* Failure policy must continue even when diagnostics are unavailable. */}
    return null;
  }
}
function checkpointEvidenceSnapshot(checkpoint){return checkpoints.reconcileCheckpointEvidenceState(checkpoint);}
function activePendingEvidenceEntries(){const session=currentRallySession();return session?listActivePendingEvidence(ensurePendingEvidenceQueueForSession(session),{sessionId:session.sessionId}):[];}
function reconcileCurrentPendingEvidenceQueue(at=core.clock.iso()){
  const session=currentRallySession();if(!session)return pendingEvidenceQueue;ensurePendingEvidenceQueueForSession(session);
  pendingEvidenceQueue=reconcilePendingEvidenceQueue(pendingEvidenceQueue,{sessionId:session.sessionId,checkpoints:dayCheckpoints(),at}).queue;return pendingEvidenceQueue;
}
function upsertCheckpointPendingEvidence(checkpoint,{at=core.clock.iso(),fallbackExpiresAt}={}){
  const session=currentRallySession();if(!session||!checkpoint)return null;ensurePendingEvidenceQueueForSession(session);
  const result=upsertPendingEvidence(pendingEvidenceQueue,{sessionId:session.sessionId,checkpoint,at,fallbackExpiresAt});pendingEvidenceQueue=result.queue;return result.entry;
}
function resolveCheckpointPendingEvidence(checkpoint,{at=core.clock.iso(),reason='evidence-complete'}={}){
  const session=currentRallySession();if(!session||!checkpoint)return null;ensurePendingEvidenceQueueForSession(session);
  const result=resolvePendingEvidence(pendingEvidenceQueue,{sessionId:session.sessionId,checkpointId:checkpoint.id,at,reason});pendingEvidenceQueue=result.queue;return result.entry;
}
function arrivalJournalMetadata(checkpoint,arrival){
  const evidence=checkpointEvidenceSnapshot(checkpoint).arrival;
  return {
    eventIdentity:`arrival:${checkpoint.id}`,checkpointArrivalTimestamp:evidence.timestamp,arrivalState:evidence.state,arrivalEvidence:evidence,
    source:evidence.source||'gps_capture',photoEvidenceState:checkpoint.photoEvidenceState,finalCompletionState:checkpoint.finalCompletionState,
    pointsWithheld:Boolean(checkpoint.photoRequired),offline:Boolean(evidence.offline),background:Boolean(evidence.background),interruptionContext:evidence.interruptionContext,
    outOfOrder:Boolean(arrival?.outOfOrder),priorTargetId:arrival?.priorTargetId||null,speedAtDetectionMph:evidence.speedMph,
    title:checkpoint.type==='hotel'?'Hotel Reached':checkpoint.name,
    summary:checkpoint.photoRequired?
      (arrival?.outOfOrder?'Out-of-order GPS arrival confirmed; required photo evidence remains a separate completion gate.':'GPS arrival confirmed; required photo evidence remains a separate completion gate.'):
      (arrival?.outOfOrder?'Out-of-order GPS arrival confirmed; this objective does not require photo evidence.':'GPS arrival confirmed; this objective does not require photo evidence.')
  };
}
function recordAuthoritativeCheckpointArrival(checkpoint,arrival){
  const evidence=arrival?.evidence?.detection||captureArrivalEvidence(state.lastGpsPosition,arrival?.detectedAt||Date.now()),timestamp=arrival?.detectedAtIso||evidence.sampleTimestamp||core.clock.iso(),day=Number(checkpoint.day)||activeRallyDay(),dayState=rallyDayState(day),session=currentRallySession();
  return checkpoints.recordCheckpointArrivalEvidence(checkpoint,{
    arrivalId:stableUuid(`${state.project.projectId}:${session?.sessionId||'unscoped'}:arrival:${checkpoint.id}`),journalEventId:stableUuid(`${state.project.projectId}:${session?.sessionId||'unscoped'}:arrival:${checkpoint.id}`),
    checkpointId:checkpoint.id,objectiveId:checkpoint.id,objectiveType:checkpoint.type,sessionId:session?.sessionId||null,dayId:session?.dayId||dayState.dayId,dayNumber:day,timestamp,
    latitude:evidence.latitude??evidence.lat,longitude:evidence.longitude??evidence.lon,gpsAccuracyFeet:evidence.gpsAccuracyFeet??evidence.accuracyFeet??arrival?.accuracyFeet,speedMph:evidence.speedMph??arrival?.speedMph,motionState:evidence.motion??evidence.motionState,
    heading:evidence.heading,sampleTimestamp:evidence.sampleTimestamp||timestamp,sampleAgeMs:evidence.sampleAgeMs,source:'gps_capture',offline:navigator.onLine===false,
    background:document.visibilityState!=='visible',interruptionContext:{visibilityState:document.visibilityState||'unknown',gpsWatchActive:state.gpsWatchId!==null,online:navigator.onLine!==false},trustworthy:true
  });
}
function transitionPhotoEvidenceSafely(checkpoint,nextState,details={}){
  const current=checkpointEvidenceSnapshot(checkpoint);if(current.photo.state===checkpoints.CHECKPOINT_PHOTO_EVIDENCE_STATE.COMPLETE&&nextState!==checkpoints.CHECKPOINT_PHOTO_EVIDENCE_STATE.COMPLETE)return current;
  return checkpoints.transitionCheckpointPhotoEvidence(checkpoint,nextState,{...details,updatedAt:details.updatedAt||core.clock.iso()}).state;
}
function workflowMissingSides(){const sides=checkpointCamera?.getState?.()?.sides||{};return ['front','rear'].filter(role=>!sides[role]);}
function failurePhotoState({readiness=cameraReadinessState(),partial={},error=null}={}){
  if(partial?.road||partial?.rider||checkpointCamera?.getState?.()?.sides?.front||checkpointCamera?.getState?.()?.sides?.rear)return checkpoints.CHECKPOINT_PHOTO_EVIDENCE_STATE.PARTIAL;
  if(readiness.permission==='denied'||/permission|notallowed/i.test(`${error?.name||''} ${error?.code||''} ${error?.message||''}`))return checkpoints.CHECKPOINT_PHOTO_EVIDENCE_STATE.PERMISSION_BLOCKED;
  if(/abort|interrupt|visibility|suspend/i.test(`${error?.name||''} ${error?.code||''} ${error?.message||''}`))return checkpoints.CHECKPOINT_PHOTO_EVIDENCE_STATE.INTERRUPTED;
  return checkpoints.CHECKPOINT_PHOTO_EVIDENCE_STATE.FAILED;
}
async function preserveIncompletePhotoEvidence(checkpoint,{state:photoState,reasonCode,failureReason,pairId=null,priorTargetId=null,source='camera_failure'}={}){
  const workflow=checkpointCamera?.getState?.()||{},resolvedPairId=pairId||workflow.pairId||checkpoint.pendingPhotoPair?.pairId||null,missingSides=workflowMissingSides();
  transitionPhotoEvidenceSafely(checkpoint,photoState,{pairId:resolvedPairId,pairJournalEventId:workflow.pairJournalEventId||checkpoint.pendingPhotoPair?.pairJournalEventId||null,reasonCode,failureReason,missingSides});
  checkpoint.status=checkpoints.CHECKPOINT_STATE.PHOTO_REQUIRED;checkpoint.completedAt=null;checkpoint.scoreAwarded=0;checkpoint.finalCompletionState='pending';checkpoint.photoFailureDisposition=reasonCode||null;
  if(resolvedPairId)checkpoint.pendingPhotoPair={...(checkpoint.pendingPhotoPair||{}),pairId:resolvedPairId,pairJournalEventId:workflow.pairJournalEventId||checkpoint.pendingPhotoPair?.pairJournalEventId||null,status:photoState,missingSides};
  const arrival=checkpointEvidenceSnapshot(checkpoint).arrival,arrivalTrustworthy=arrival.state===checkpoints.CHECKPOINT_ARRIVAL_STATE.CONFIRMED&&arrival.trustworthy;
  await appendFailureJournalBestEffort('checkpoint_photo_evidence_incomplete',checkpoint,{eventIdentity:`photo-incomplete:${checkpoint.id}:${arrival.timestamp||checkpoint.manualPhotoStartedAt||resolvedPairId||'pending'}:${photoState}`,source,arrivalState:arrivalTrustworthy?checkpoints.CHECKPOINT_ARRIVAL_STATE.CONFIRMED:checkpoints.CHECKPOINT_ARRIVAL_STATE.NOT_CONFIRMED,arrivalEvidence:arrivalTrustworthy?arrival:null,photoEvidenceState:photoState,pairId:resolvedPairId,missingSides,reasonCode,failureReason,pointsWithheld:true,pointsAwarded:0,normalCompletionEmitted:false,title:checkpoint.name,summary:arrivalTrustworthy?'GPS arrival is confirmed. Required photo evidence is incomplete, so normal completion points were withheld.':'Required photo evidence is incomplete. No authoritative GPS arrival is claimed, and normal completion points were withheld.'},core.clock.iso());
  if(arrivalTrustworthy)upsertCheckpointPendingEvidence(checkpoint);
  const priorTarget=state.project.features.find(feature=>feature.id===priorTargetId&&feature.id!==checkpoint.id&&feature.status===checkpoints.CHECKPOINT_STATE.ACTIVE);if(priorTarget)state.selectedId=priorTarget.id;
  await saveProject(false);renderAll();return checkpointEvidenceSnapshot(checkpoint);
}
async function preserveQueuedPhotoEvidence(checkpoint,{reasonCode='evidence-workflow-busy',failureReason='Another checkpoint evidence workflow is already using the camera.'}={}){
  const evidence=checkpointEvidenceSnapshot(checkpoint),photoState=evidence.photo.state===checkpoints.CHECKPOINT_PHOTO_EVIDENCE_STATE.NOT_ATTEMPTED?checkpoints.CHECKPOINT_PHOTO_EVIDENCE_STATE.NOT_ATTEMPTED:evidence.photo.state;
  transitionPhotoEvidenceSafely(checkpoint,photoState,{reasonCode,failureReason,missingSides:['front','rear']});
  checkpoint.status=checkpoints.CHECKPOINT_STATE.PHOTO_REQUIRED;checkpoint.completedAt=null;checkpoint.scoreAwarded=0;checkpoint.finalCompletionState='pending';
  const arrival=checkpointEvidenceSnapshot(checkpoint).arrival;upsertCheckpointPendingEvidence(checkpoint);
  await appendFailureJournalBestEffort('checkpoint_photo_evidence_incomplete',checkpoint,{eventIdentity:`photo-incomplete:${checkpoint.id}:${arrival.timestamp||'pending'}:${reasonCode}`,source:'pending_evidence_queue',arrivalState:arrival.state,arrivalEvidence:arrival.trustworthy?arrival:null,photoEvidenceState:photoState,pairId:null,missingSides:['front','rear'],reasonCode,failureReason,pointsWithheld:true,pointsAwarded:0,normalCompletionEmitted:false,title:checkpoint.name,summary:'GPS arrival is confirmed. Required photo evidence is queued independently while route monitoring continues.'});
  await saveProject(false);renderAll();return checkpointEvidenceSnapshot(checkpoint);
}
function recordJournalCheckpoint(checkpoint,automatic){
  const hotel=checkpoint.type==='hotel',timestamp=checkpoint.completedAt||new Date().toISOString(),evidence=checkpointEvidenceSnapshot(checkpoint),arrivalTrustworthy=evidence.arrival.state===checkpoints.CHECKPOINT_ARRIVAL_STATE.CONFIRMED&&evidence.arrival.trustworthy;
  return appendRallyJournalEvent(hotel?'hotel_arrival':'checkpoint_completed',checkpoint,{
    eventIdentity:`collected:${checkpoint.id}`,source:arrivalTrustworthy?'gps_evidence_gate':automatic?'automatic_evidence_gate':'manual_evidence_gate',checkpointArrivalTimestamp:arrivalTrustworthy?evidence.arrival.timestamp:null,
    checkpointCollectedTimestamp:timestamp,objectiveCompletion:true,arrivalState:arrivalTrustworthy?checkpoints.CHECKPOINT_ARRIVAL_STATE.CONFIRMED:checkpoints.CHECKPOINT_ARRIVAL_STATE.NOT_CONFIRMED,arrivalEvidence:arrivalTrustworthy?evidence.arrival:null,photoEvidenceState:checkpoint.photoEvidenceState,finalCompletionState:checkpoint.finalCompletionState,points:Number(checkpoint.scoreAwarded)||Number(checkpoint.points)||0,score:rallyScore(),photoStatus:checkpoint.photoStatus||null,photoFailureDisposition:null,
    title:checkpoint.name,summary:arrivalTrustworthy?'Authoritative GPS arrival and the required evidence gate were both completed.':'Completed through the normal evidence gate. No authoritative GPS arrival is claimed by this completion action.'
  },timestamp).catch(error=>{console.warn(`[CannonMap journal] Checkpoint event failed: ${error?.message||error}`);return null;});
}
function renderCheckpointCameraState(cameraState){
  const section=$('rallyCameraWorkflow');if(!section)return;
  const active=cameraState&&cameraState.status!=='idle'&&cameraState.visibility!=='silent';section.hidden=!active;
  if(!active)return;
  const checkpoint=pendingObjectiveCheckpoint(),heading=$('rallyCameraHeading');if(heading)heading.textContent=checkpoint?.type==='hotel'?'Hotel Reached':checkpoint?.type==='journey'?'Journey Photo':'Checkpoint Reached';
  if($('rallyCameraFailObjective'))$('rallyCameraFailObjective').hidden=checkpoint?.type==='journey';
  if($('rallyCameraContinueRoute')){$('rallyCameraContinueRoute').hidden=false;$('rallyCameraContinueRoute').textContent=checkpoint?.type==='journey'?'CANCEL JOURNEY PHOTO':'CONTINUE ROUTE';}
  const front=Boolean(cameraState.sides?.front),rear=Boolean(cameraState.sides?.rear),count=$('rallyCameraPhotoCount');
  if(count){const intentionalManual=Boolean(pendingMediaObjective?.fallbackReason);count.textContent=front&&rear?'Front captured ✓\nRear captured ✓':front?'Front captured ✓\nRear required':rear?'Front required\nRear captured ✓':intentionalManual?'Tap anywhere to open the camera':'No photos captured';}
  if($('rallyCameraError')){$('rallyCameraError').textContent=cameraState.error||'';$('rallyCameraError').hidden=!cameraState.error;}
  if($('rallyCameraDebugInputs'))$('rallyCameraDebugInputs').hidden=!(new URLSearchParams(location.search).has('debugPhotos')||globalThis.__CANNONMAP_PHOTO_DEBUG__===true);
}
function preferredCamera(){return normalizeCameraPreference(state.settings.preferredCamera);}
function applyCameraPreference(){
  const preference=preferredCamera(),capture=cameraCaptureAttribute(preference),selfie=preference==='front';
  for(const id of ['rallyCameraInput'])$(id)?.setAttribute('capture',capture);
  for(const id of ['rallyCameraSelfie','rallyJourneySelfieButton'])$(id)?.classList.toggle('is-active',selfie);
  for(const id of ['rallyCameraForward','rallyJourneyForwardButton'])$(id)?.classList.toggle('is-active',!selfie);
}
async function setPreferredCamera(value){if(rejectRallyMutationWhileQuiesced('change camera preference'))return;state.settings.preferredCamera=normalizeCameraPreference(value);applyCameraPreference();await saveProject(false);rallyDebug.record('camera_preference_changed',{requestedCamera:state.settings.preferredCamera});}
function triggerCameraCapture(value,inputId,objectiveType){
  const preference=normalizeCameraPreference(value),input=$(inputId);if(!input)return;
  state.settings.preferredCamera=preference;applyCameraPreference();input.value='';
  rallyDebug.record('photo_requested',{objectiveType,requestedCamera:preference,captureMethod:'file-input'});
  input.click();void saveProject(false);
}
async function addCheckpointCameraSide(role,file){
  if(rejectRallyMutationWhileQuiesced('save photo evidence'))return;
  if(!(file instanceof Blob)||!checkpointCamera)return;
  try{
    const metadata=cameraSelectionMetadata(role,file),result=await checkpointCamera.addSide(role,{blob:file,metadata:{...metadata,sourceKind:'file-input-native',nativeStill:'unknown',derivedFromVideoFrame:false,upscaled:false,mimeType:file.type||'application/octet-stream',byteLength:file.size||0}});const input=$(role==='front'?'rallyCameraFrontInput':'rallyCameraRearInput');if(input)input.value='';
    rallyDebug.record('photo_side_completed',{checkpointId:pendingPhotoCheckpointId,pairId:result?.pairId,role});
    const checkpoint=pendingObjectiveCheckpoint();if(checkpoint&&checkpoint.type!=='journey'&&result?.status!=='ready'){transitionPhotoEvidenceSafely(checkpoint,checkpoints.CHECKPOINT_PHOTO_EVIDENCE_STATE.PARTIAL,{pairId:result?.pairId||checkpoint.pendingPhotoPair?.pairId||null,pairJournalEventId:result?.pairJournalEventId||checkpoint.pendingPhotoPair?.pairJournalEventId||null,missingSides:workflowMissingSides(),reasonCode:'pair-partial'});checkpoint.pendingPhotoPair={...(checkpoint.pendingPhotoPair||{}),status:'partial',missingSides:workflowMissingSides()};await saveProject(false);}
    if(pendingPhotoCheckpointId&&result?.status==='ready'){
      if(checkpoint&&checkpoint.type!=='journey')await finalizePendingPhotoCheckpoint();else{checkpointCamera.finish();pendingPhotoCheckpointId=null;resolveManualFallback({status:'captured'});}
    }
  }catch(error){
    const checkpoint=state.project.features.find(feature=>feature.id===pendingPhotoCheckpointId);
    rallyDebug.record('photo_failed',{checkpointId:pendingPhotoCheckpointId,exceptionName:error?.name||'Error',error:error?.message||String(error)});
    if(checkpoint){transitionPhotoEvidenceSafely(checkpoint,checkpoints.CHECKPOINT_PHOTO_EVIDENCE_STATE.FAILED,{pairId:checkpointCamera?.getState()?.pairId||checkpoint.pendingPhotoPair?.pairId||null,missingSides:workflowMissingSides(),reasonCode:'photo-storage-failed',failureReason:error?.message||String(error)});await appendRallyJournalEvent('photo_failed',checkpoint,{eventIdentity:`photo-failed:${checkpoint.id}`,photoRequired:Boolean(checkpoint.photoRequired),photoEvidenceState:checkpoint.photoEvidenceState,failureReason:'Photo storage failed; retry required.'});await saveProject(false);}
    setStatus('Photo could not be saved. Your checkpoint has NOT been completed. Please retry the photo. If the problem continues you may mark the objective as failed.',true);
  }
}
async function addTestCheckpointCameraPair(file){if(!(file instanceof Blob)||!new URLSearchParams(location.search).has('e2e'))return;await addCheckpointCameraSide('front',file);await addCheckpointCameraSide('rear',file);}
async function cancelCheckpointCamera(role){
  if(rejectRallyMutationWhileQuiesced('cancel photo evidence'))return;
  const checkpoint=pendingObjectiveCheckpoint();
  checkpointCamera?.cancel(role);rallyDebug.record('photo_failed',{checkpointId:pendingPhotoCheckpointId,reason:'canceled',cameraRole:role});
  if(checkpoint){transitionPhotoEvidenceSafely(checkpoint,checkpoints.CHECKPOINT_PHOTO_EVIDENCE_STATE.INTERRUPTED,{pairId:checkpointCamera?.getState()?.pairId||checkpoint.pendingPhotoPair?.pairId||null,missingSides:workflowMissingSides(),reasonCode:'capture-canceled'});await appendRallyJournalEvent('photo_canceled',checkpoint,{eventIdentity:`photo-canceled:${checkpoint.id}:${role}`,photoRequired:Boolean(checkpoint.photoRequired),photoEvidenceState:checkpoint.photoEvidenceState,cameraRole:role,pairId:checkpointCamera?.getState()?.pairId});await saveProject(false);}
}

function resolveManualFallback(result){
  if(manualFallbackTimer)clearTimeout(manualFallbackTimer);manualFallbackTimer=null;
  const resolve=manualFallbackResolver;manualFallbackResolver=null;pendingMediaObjective=null;
  if(resolve)resolve(result);
}

function applyPendingEvidenceActionProjection(checkpoint,action,{at,reasonCode=null,metadata={}}={}){
  const normalized=String(action||'').toUpperCase(),timestamp=at||core.clock.iso();
  if(normalized===PENDING_EVIDENCE_ACTION.DEFER){checkpoint.status=checkpoints.CHECKPOINT_STATE.DEFERRED;checkpoint.deferredAt=timestamp;checkpoint.deferReason=metadata.deferReason||'Required photo evidence deferred';}
  if(normalized===PENDING_EVIDENCE_ACTION.FAIL){checkpoint.status=checkpoints.CHECKPOINT_STATE.FAILED;checkpoint.photoStatus='failed';checkpoint.failedAt=timestamp;checkpoint.failReason=metadata.failureReason||reasonCode||'Required photo evidence failed';checkpoint.scoreAwarded=0;checkpoint.completedAt=null;checkpoint.finalCompletionState=checkpoints.CHECKPOINT_FINAL_COMPLETION_STATE.PENDING;}
  return checkpoint;
}
async function persistPendingEvidenceActionFor(checkpoint,action,{reasonCode=null,metadata={},at=core.clock.iso()}={}){
  const session=currentRallySession();if(!session||!checkpoint)throw new Error('An active rally session and checkpoint are required.');ensurePendingEvidenceQueueForSession(session);
  const normalized=String(action).toUpperCase();
  await appendRallyJournalEvent('checkpoint_pending_evidence_action',checkpoint,{eventIdentity:`pending-evidence-action:${checkpoint.id}:${normalized}:${at}`,source:'pending_evidence_queue',pendingEvidenceAction:normalized,pendingEvidenceActionAt:at,reasonCode,...metadata,title:checkpoint.name,summary:`Rider selected ${normalized} for unresolved required photo evidence.`},at);
  const result=recordPendingEvidenceAction(pendingEvidenceQueue,{sessionId:session.sessionId,checkpointId:checkpoint.id,action:normalized,at,reasonCode,metadata});pendingEvidenceQueue=result.queue;
  applyPendingEvidenceActionProjection(checkpoint,normalized,{at,reasonCode,metadata});await saveProject(false);return {...result,at};
}
async function continuePendingPhotoRoute(checkpointId=pendingPhotoCheckpointId,{reasonCode='rider-continued-route'}={}){
  if(rejectRallyMutationWhileQuiesced('continue the route'))return false;
  const workflowCheckpoint=pendingObjectiveCheckpoint();
  if(workflowCheckpoint?.type==='journey'&&workflowCheckpoint.id===checkpointId){const canceledAt=core.clock.iso();await appendFailureJournalBestEffort('journey_photo_canceled',workflowCheckpoint,{eventIdentity:`journey-photo-canceled:${workflowCheckpoint.id}`,source:'mission_control',canceledAt,reasonCode:'rider-canceled',title:'Journey Photo Canceled',summary:'Rider canceled the optional Journey Photo and returned immediately to Rally Mode.'},canceledAt);checkpointCamera?.abandon();pendingPhotoCheckpointId=null;resolveManualFallback({status:'canceled'});pendingMediaObjective=null;renderAll();setStatus('Journey Photo canceled.');return true;}
  const checkpoint=state.project.features.find(feature=>feature.id===checkpointId);if(!checkpoint)return false;
  await persistPendingEvidenceActionFor(checkpoint,PENDING_EVIDENCE_ACTION.CONTINUE,{reasonCode});
  if(pendingPhotoCheckpointId===checkpoint.id){checkpointCamera?.abandon();pendingPhotoCheckpointId=null;resolveManualFallback({status:'continued'});pendingMediaObjective=null;}
  renderAll();setStatus(`${checkpoint.name} remains in Pending Evidence. GPS route monitoring continues.`);return true;
}
async function deferPendingPhotoEvidence(checkpointId){
  if(rejectRallyMutationWhileQuiesced('defer photo evidence'))return false;
  const checkpoint=state.project.features.find(feature=>feature.id===checkpointId);if(!checkpoint)return false;
  await persistPendingEvidenceActionFor(checkpoint,PENDING_EVIDENCE_ACTION.DEFER,{reasonCode:'rider-deferred-evidence',metadata:{deferReason:'Required photo evidence deferred'}});
  if(pendingPhotoCheckpointId===checkpoint.id){checkpointCamera?.abandon();pendingPhotoCheckpointId=null;resolveManualFallback({status:'deferred'});pendingMediaObjective=null;}
  await saveProject(false);renderAll();setStatus(`${checkpoint.name} evidence deferred with no points awarded.`);return true;
}
async function retryPendingPhotoEvidence(checkpointId,{action=PENDING_EVIDENCE_ACTION.RETRY}={}){
  if(rejectRallyMutationWhileQuiesced('retry photo evidence'))return false;
  const checkpoint=state.project.features.find(feature=>feature.id===checkpointId);if(!checkpoint)return false;
  const readinessPromise=!cameraReadinessState().automaticCaptureEligible?cameraReadiness?.setupFromUserGesture?.():Promise.resolve(cameraReadinessState());
  await persistPendingEvidenceActionFor(checkpoint,action,{reasonCode:'rider-requested-recovery'});
  const readiness=await readinessPromise;renderRallyMode();
  if(!readiness?.automaticCaptureEligible&&readiness?.permission==='denied'){setStatus('Camera access is still blocked. The arrival remains preserved; enable camera in site settings or choose Fail/Continue.',true);return false;}
  if(pendingPhotoCheckpointId&&pendingPhotoCheckpointId!==checkpoint.id){setStatus(`Camera recovery is currently open for ${pendingObjectiveCheckpoint()?.name||pendingPhotoCheckpointId}. Continue or finish it first.`,true);return false;}
  const recovery=await reconcilePendingCheckpointEvidence({checkpointId:checkpoint.id,interactive:true});
  if(!recovery?.handled&&!pendingPhotoCheckpointId)await beginPhotoWorkflow(checkpoint,false,{visibility:'manual'});
  renderAll();return true;
}
async function handlePendingEvidenceAction(checkpointId,action){
  if(action==='retry')return retryPendingPhotoEvidence(checkpointId,{action:PENDING_EVIDENCE_ACTION.RETRY});
  if(action==='resume')return retryPendingPhotoEvidence(checkpointId,{action:PENDING_EVIDENCE_ACTION.RESUME});
  if(action==='continue')return continuePendingPhotoRoute(checkpointId);
  if(action==='defer')return deferPendingPhotoEvidence(checkpointId);
  if(action==='fail')return failPendingPhotoObjective(checkpointId);
  return false;
}

async function suspendPendingEvidenceRuntime(reason='scope-change'){
  rallyScopeSuspended=true;
  const priorReliabilityTask=stopRallyReliabilityServices(reason);
  const priorPollingTask=stopRallyPolling({preserveIntent:true,flush:true});
  cameraSession?.teardown(reason);
  const priorArrivalCoordinator=checkpointArrivalCoordinator,priorReconciliationTask=checkpointEvidenceReconciliationTask?.promise||null,priorMediaRecoveryTask=mediaRecoveryTask,priorManualFallbackExpiryTask=manualFallbackExpiryTask,priorCheckpointCompletionTask=checkpointCompletionInFlight?.settled||null,priorAnalyticsTransition=rallyAnalyticsTransition,priorRallyMutationDrain=drainTrackedRallyMutations(),priorJournalWrites=drainActiveJournalWrites();
  resetCheckpointArrivalCoordinator(reason);
  if(automaticCaptureAbortController)automaticCaptureAbortController.abort(new DOMException('Rally evidence scope changed.','AbortError'));
  let quiescenceError=null;try{await Promise.all([priorReliabilityTask,priorPollingTask,priorArrivalCoordinator?.whenIdle?.(),priorReconciliationTask,priorMediaRecoveryTask,priorManualFallbackExpiryTask,priorCheckpointCompletionTask,priorAnalyticsTransition,priorRallyMutationDrain,priorJournalWrites].filter(Boolean));}catch(error){quiescenceError=error;rallyDebug.record('checkpoint_evidence_quiescence_failed',{reason,error:error?.message||String(error)});}
  const workflow=checkpointCamera?.getState?.()||{status:'idle',sides:{}},checkpoint=pendingObjectiveCheckpoint();
  const priorCheckpointId=pendingPhotoCheckpointId;
  let preservationError=quiescenceError,durableStatePreserved=false;
  try{
    if(!preservationError&&checkpoint&&checkpoint.type!=='journey'&&workflow.status!=='idle'){
      const current=checkpointEvidenceSnapshot(checkpoint),hasCapturedSide=Boolean(workflow.sides?.front||workflow.sides?.rear),nextState=hasCapturedSide?
        checkpoints.CHECKPOINT_PHOTO_EVIDENCE_STATE.PARTIAL:
        [checkpoints.CHECKPOINT_PHOTO_EVIDENCE_STATE.PERMISSION_BLOCKED,checkpoints.CHECKPOINT_PHOTO_EVIDENCE_STATE.FAILED].includes(current.photo.state)?current.photo.state:checkpoints.CHECKPOINT_PHOTO_EVIDENCE_STATE.INTERRUPTED;
      await preserveIncompletePhotoEvidence(checkpoint,{state:nextState,reasonCode:'scope-changed',failureReason:`Photo evidence capture was suspended because the Rally scope changed (${reason}).`,pairId:workflow.pairId||current.photo.pairId||null,priorTargetId:pendingMediaObjective?.priorTargetId||null,source:'scope_change'});durableStatePreserved=true;
    }
  }catch(error){preservationError=error;rallyDebug.record('checkpoint_evidence_scope_preservation_failed',{reason,checkpointId:priorCheckpointId,pairId:workflow.pairId||null,error:error?.message||String(error)});}
  finally{checkpointCamera?.abandon();pendingPhotoCheckpointId=null;resolveManualFallback({status:'scope-changed',reason});pendingMediaObjective=null;}
  rallyDebug.record('checkpoint_evidence_runtime_suspended',{reason,checkpointId:priorCheckpointId,pairId:workflow.pairId||null,durableStatePreserved,preservationFailed:Boolean(preservationError)});
  if(preservationError){resumeRallyScopeRuntime(`${reason}-preservation-failed`);throw preservationError;}
  return {durableStatePreserved,preservationError};
}

function pendingObjectiveCheckpoint(){return state.project.features.find(feature=>feature.id===pendingPhotoCheckpointId)||pendingMediaObjective?.checkpoint||null;}

function manualFallbackMissingRole(){
  const sides=checkpointCamera?.getState()?.sides||{};
  return !sides.rear?'rear':!sides.front?'front':null;
}

function triggerManualFallbackCapture(){
  if(rejectRallyMutationWhileQuiesced('capture photo evidence'))return;
  const role=manualFallbackMissingRole();if(!role){void retryManualPairFinalization();return;}
  const input=$(role==='front'?'rallyCameraFrontInput':'rallyCameraRearInput');if(!input)return;
  input.value='';rallyDebug.record('manual_tap_capture',{checkpointId:pendingPhotoCheckpointId,cameraRole:role});
  const checkpoint=pendingObjectiveCheckpoint();if(checkpoint)void appendRallyJournalEvent('manual_tap_capture',checkpoint,{eventIdentity:`manual-tap:${checkpoint.id}:${role}:${core.clock.iso()}`,pairId:checkpointCamera?.getState()?.pairId||null,cameraRole:role,captureStatus:'manual_fallback_capture_requested'}).catch(()=>{});
  input.click();
}

async function retryManualPairFinalization(){
  const item=pendingObjectiveCheckpoint();if(!item||!checkpointCamera)return false;
  try{
    await checkpointCamera.finalizeRestoredPair();
    if(item.type==='journey'){checkpointCamera.finish();pendingPhotoCheckpointId=null;resolveManualFallback({status:'captured'});}
    else await finalizePendingPhotoCheckpoint();
    return true;
  }catch(error){
    rallyDebug.record('pair_finalization_retry_failed',{checkpointId:item.id,pairId:checkpointCamera.getState()?.pairId||null,error:error?.message||String(error)});
    setStatus('Captured photos are preserved, but their pair could not be finalized. Tap the capture view to retry.',true);return false;
  }
}

async function expireManualFallbackInternal({scopeToken=pendingMediaObjective?.scopeToken||null}={}){
  if(!rallyScopeMatches(scopeToken)||!pendingMediaObjective||!manualFallbackResolver)return false;
  const context={...pendingMediaObjective},item=pendingObjectiveCheckpoint(),checkpointId=context.checkpointId;
  rallyDebug.record('manual_fallback_expired',{checkpointId});
  if(item){await appendFailureJournalBestEffort('camera_failure',item,{eventIdentity:`manual-fallback-expired:${checkpointId}:${item.arrivedAt}`,captureStatus:'manual_fallback_expired',speedAtFailureMph:context.speedMph??null});if(!rallyScopeMatches(scopeToken))return false;await preserveIncompletePhotoEvidence(item,{state:workflowMissingSides().length===1?checkpoints.CHECKPOINT_PHOTO_EVIDENCE_STATE.PARTIAL:checkpoints.CHECKPOINT_PHOTO_EVIDENCE_STATE.FAILED,reasonCode:'manual_fallback_expired',failureReason:'Manual photo recovery was not completed within 60 seconds.',pairId:checkpointCamera?.getState()?.pairId||null,priorTargetId:context.priorTargetId,source:'manual_fallback'});if(!rallyScopeMatches(scopeToken))return false;await persistPendingEvidenceActionFor(item,PENDING_EVIDENCE_ACTION.CONTINUE,{reasonCode:'manual-fallback-expired'});if(!rallyScopeMatches(scopeToken))return false;}
  checkpointCamera?.abandon();pendingPhotoCheckpointId=null;resolveManualFallback({status:'expired'});return true;
}

async function expireManualFallback(options={}){
  if(manualFallbackExpiryTask)return manualFallbackExpiryTask;
  const task=expireManualFallbackInternal(options);manualFallbackExpiryTask=task;
  try{return await task;}finally{if(manualFallbackExpiryTask===task)manualFallbackExpiryTask=null;}
}

async function releaseExpiredPendingEvidence(){
  const session=currentRallySession();if(!session||acceptedRallySessionId!==session.sessionId||showRallySessionChoice()||showDayPreflight()||rallyScopeSuspended)return [];ensurePendingEvidenceQueueForSession(session);
  const expired=listExpiredPendingEvidence(pendingEvidenceQueue,{sessionId:session.sessionId,now:core.clock.iso()});
  for(const entry of expired){
    if(entry.lastAction===PENDING_EVIDENCE_ACTION.CONTINUE&&Date.parse(entry.lastActionAt||0)>=Date.parse(entry.fallbackExpiresAt||0))continue;
    if(entry.checkpointId===pendingPhotoCheckpointId&&manualFallbackResolver){await expireManualFallback();continue;}
    const checkpoint=state.project.features.find(feature=>feature.id===entry.checkpointId);if(checkpoint)await persistPendingEvidenceActionFor(checkpoint,PENDING_EVIDENCE_ACTION.CONTINUE,{reasonCode:'manual-fallback-expired-while-suspended'});
  }
  if(expired.length)renderAll();return expired;
}

function beginManualFallback(checkpoint,{priorTargetId=null,partial=null,captureKind='checkpoint',speedMph=null,timeoutMs=60000,fallbackReason='automatic-capture-failed'}={}){
  const scopeToken=rallyScopeSnapshot().token;
  if(partial?.road?.media&&!checkpointCamera.getState().sides?.rear)checkpointCamera.restoreSide('rear',partial.road.media);
  if(partial?.rider?.media&&!checkpointCamera.getState().sides?.front)checkpointCamera.restoreSide('front',partial.rider.media);
  pendingMediaObjective={checkpointId:checkpoint.id,checkpoint:checkpoint.type==='journey'?checkpoint:null,priorTargetId,captureKind,mode:'manual-fallback',fallbackReason,speedMph:Number.isFinite(Number(speedMph))?Number(speedMph):null,expiresAt:Date.now()+timeoutMs,scopeToken};
  if(checkpoint.type!=='journey'){upsertCheckpointPendingEvidence(checkpoint,{fallbackExpiresAt:new Date(pendingMediaObjective.expiresAt).toISOString()});void saveProject(false);}
  checkpointCamera.setVisibility('manual',manualFallbackMissingRole()==='rear'?'rear_required':'awaiting_pair');
  rallyDebug.record('slow_speed_manual_fallback',{checkpointId:checkpoint.id,speedMph:pendingMediaObjective.speedMph,fallbackReason,expiresAt:new Date(pendingMediaObjective.expiresAt).toISOString()});
  void appendRallyJournalEvent('manual_fallback_started',checkpoint,{eventIdentity:`manual-fallback:${checkpoint.id}:${checkpoint.arrivedAt||core.clock.iso()}`,pairId:checkpointCamera?.getState()?.pairId||null,captureStatus:'manual_fallback_required',fallbackReason,speedAtFailureMph:pendingMediaObjective.speedMph,expiresAt:new Date(pendingMediaObjective.expiresAt).toISOString()}).catch(()=>{});
  return new Promise(resolve=>{
    manualFallbackResolver=resolve;
    manualFallbackTimer=setTimeout(()=>{void expireManualFallback({scopeToken});},timeoutMs);
  });
}

async function restartUnsafeCapturePair(checkpoint,arrivalEvent,captureKind,failedPairId){
  checkpointCamera?.abandon();delete checkpoint.pendingPhotoPair;
  const restarted=await beginPhotoWorkflow(checkpoint,true,{arrivalEvent,visibility:'silent',captureKind});
  rallyDebug.record('capture_pair_quarantined',{checkpointId:checkpoint.id,failedPairId,newPairId:restarted.workflow.pairId,reason:'original_cleanup_not_confirmed'});
  return restarted.workflow;
}
async function failPendingPhotoObjective(requestedCheckpointId=null){
  if(rejectRallyMutationWhileQuiesced('fail an objective'))return false;
  const checkpointId=typeof requestedCheckpointId==='string'?requestedCheckpointId:pendingPhotoCheckpointId,checkpoint=state.project.features.find(feature=>feature.id===checkpointId);if(!checkpoint)return;const reason=prompt('Required reason for marking this objective failed');if(!String(reason||'').trim())return setStatus('A reason is required to mark the objective failed.',true);
  const priorTargetId=pendingPhotoCheckpointId===checkpoint.id?pendingMediaObjective?.priorTargetId||null:null,priorTarget=state.project.features.find(feature=>feature.id===priorTargetId&&feature.id!==checkpoint.id&&feature.status===checkpoints.CHECKPOINT_STATE.ACTIVE)||null;
  const timestamp=new Date().toISOString();await persistPendingEvidenceActionFor(checkpoint,PENDING_EVIDENCE_ACTION.FAIL,{reasonCode:'rider-marked-failed',metadata:{failureReason:String(reason).trim()},at:timestamp});
  const next=checkpoints.skipCheckpoint(dayCheckpoints(),checkpoint,{preserveActiveTarget:true});if(priorTarget)state.selectedId=priorTarget.id;else if(next)state.selectedId=next.id;await appendRallyJournalEvent('objective_failed',checkpoint,{eventIdentity:`photo-objective-failed:${checkpoint.id}:${timestamp}`,photoRequired:true,photoStatus:'failed',failureReason:String(reason).trim(),recoveryAction:'mark_objective_failed',failedOutOfOrder:Boolean(priorTarget),restoredPriorTargetId:priorTarget?.id||null},timestamp);
  if(pendingPhotoCheckpointId===checkpoint.id){checkpointCamera?.abandon();pendingPhotoCheckpointId=null;resolveManualFallback({status:'objective-failed'});}await saveProject(false);renderAll();setStatus(`${checkpoint.name} marked failed. Reason recorded in the Journal.`);
}
function travelDirection(heading){
  if(!Number.isFinite(Number(heading)))return null;
  return ['N','NE','E','SE','S','SW','W','NW'][Math.round(((Number(heading)%360)+360)%360/45)%8];
}
function photoEvidenceContext(checkpoint,journalEvent){
  const session=currentRallySession(),gps=checkpoint.arrivalEvidence||captureArrivalEvidence(state.lastGpsPosition,Date.parse(journalEvent.timestamp)||Date.now()),weather=weatherMaintenance?.getContext(),weatherNearCapture=gps&&weather?.requestCoordinates&&haversine({lat:gps.latitude,lon:gps.longitude},weather.requestCoordinates)<=5000;
  const temperature=weatherNearCapture?weather?.temperature:null,weatherAge=weather?.fetchedAt?Math.max(0,Date.parse(journalEvent.timestamp)-Date.parse(weather.fetchedAt)):null;
  const numbered=rallyCheckpointNumber(checkpoint.name),checkpointNumber=numbered?`${numbered.day}.${numbered.sequence}`:(Number.isFinite(Number(checkpoint.sequence))?String(checkpoint.sequence):null);
  return {eventName:checkpoint.type==='hotel'?'Hotel Arrival':'America 250 ADV Cannonball',objectiveType:checkpoint.type||'checkpoint',rallyName:state.project.name||null,dayNumber:Number(checkpoint.day)||null,
    sessionId:session?.sessionId||null,sessionRunNumber:session?.runNumber||null,sessionCalendarDate:session?.calendarDate||null,sessionStartedAt:session?.startedAt||null,
    checkpointName:checkpoint.name||null,checkpointNumber,
    points:checkpoint.points===null||checkpoint.points===undefined?null:Number(checkpoint.points),capturedAt:journalEvent.timestamp,
    latitude:gps?.latitude??null,longitude:gps?.longitude??null,elevation:gps?.elevationFeet??null,temperature:Number.isFinite(Number(temperature))?Number(temperature):null,
    weatherContext:weatherNearCapture?`${weather.condition||'Unavailable'} · ${weather.cached||weather.offline?'Cached':'Live'} · ${weatherAge===null?'age unavailable':`${Math.round(weatherAge/60000)} min old`}`:null,
    speedMph:gps?.speedMph??null,motion:gps?.motion??null,gpsSampleTimestamp:gps?.sampleTimestamp??null,gpsSampleAgeMs:gps?.sampleAgeMs??null,
    gpsAccuracy:gps?.gpsAccuracyFeet??null,deviceHeading:gps?.heading??null,travelDirection:gps?.headingFresh?travelDirection(gps.heading):null,
    photoJournalEventId:stableUuid(`${state.project.projectId}:${session?.sessionId||'unscoped'}:photo:${checkpoint.id}:${journalEvent.eventId}`),cameraMetadata:file=>cameraSelectionMetadata(preferredCamera(),file)};
}
function closePhotoViewer(){
  $('rallyPhotoViewer').hidden=true;for(const url of photoViewerUrls)URL.revokeObjectURL(url);photoViewerUrls=[];
  if(photoViewerUrl)URL.revokeObjectURL(photoViewerUrl);photoViewerUrl=null;photoViewerGroups=[];setRallyMoreOpen(false);
}
async function renderPhotoStage(){
  const group=photoViewerGroups[photoViewerIndex];if(!group)return;
  const record=group[photoViewerRole]||group.original||group.evidence;if(!record)return;
  if(photoViewerUrl)URL.revokeObjectURL(photoViewerUrl);photoViewerUrl=URL.createObjectURL(record.blob);$('rallyPhotoImage').src=photoViewerUrl;$('rallyPhotoGalleryShell').hidden=true;
  photoViewerZoom=1;$('rallyPhotoImage').style.setProperty('--photo-zoom','1');
  $('rallyPhotoMetadata').textContent=JSON.stringify(record.metadata||{},null,2);$('rallyPhotoStage').hidden=false;
  $('rallyPhotoOriginal').disabled=!group.original;$('rallyPhotoEvidence').disabled=!group.evidence;$('rallyExportOriginal').disabled=!group.original;$('rallyExportEvidence').disabled=!group.evidence;
}
async function openPhotoViewer(allProjects=false){
  if(!missionMedia||!state.project.projectId)return setStatus('Photo storage is unavailable.',true);
  const selectedSession=allProjects?null:currentRallySession({matchActiveDay:false}),projects=allProjects?await projectLifecycle.listProjects():[state.project],allRecords=allProjects?await missionMedia.listAllPhotos():await missionMedia.listProjectPhotos(state.project.projectId),records=allProjects?allRecords:(selectedSession?allRecords.filter(record=>journalEventMatchesSession(record,selectedSession)):[]),journals=await Promise.all(projects.map(project=>rallyJournal.getProjectJournal(project.projectId))),allJournal=journals.flatMap(item=>item.events),journal=allProjects?allJournal:(selectedSession?journalEventsForSession(allJournal,selectedSession):[]),byId=new Map(records.map(record=>[record.mediaId,record])),referenced=new Set(),items=[],projectById=new Map(projects.map(project=>[String(project.projectId),project]));
  const journalById=new Map(journal.map(event=>[event.eventId,event]));
  for(const event of journal.filter(item=>item.eventType==='photo_added')){
    const pairRoles=event.references?.pairId?['front','rear']:[null];
    for(const cameraRole of pairRoles){
      const roleTitle=cameraRole?`${cameraRole[0].toUpperCase()}${cameraRole.slice(1)} `:'';
      const originalId=cameraRole?event.references?.[`${cameraRole}OriginalMediaId`]:(event.references?.originalMediaId||event.attachments?.original?.mediaId||event.attachments?.photos?.find(photo=>photo.role==='original')?.mediaId||event.attachments?.photos?.[0]?.mediaId);
      const evidenceId=cameraRole?event.references?.[`${cameraRole}EvidenceMediaId`]:(event.references?.evidenceMediaId||event.attachments?.evidence?.mediaId||event.attachments?.photos?.find(photo=>photo.role==='evidence')?.mediaId);
      if(originalId)referenced.add(originalId);if(evidenceId)referenced.add(evidenceId);
      const original=byId.get(originalId),evidence=byId.get(evidenceId),record=original||evidence,parent=journalById.get(event.references?.parentEventId),checkpointId=event.references?.checkpointId||record?.checkpointId;
      const project=projectById.get(String(event.projectId||record?.projectId)),checkpoint=project?.features?.find(feature=>feature.id===checkpointId),numbered=rallyCheckpointNumber(checkpoint?.name),day=Number(record?.metadata?.dayNumber||parent?.metadata?.dayNumber||checkpoint?.day)||0,sessionId=event.metadata?.sessionId||event.references?.sessionId||record?.sessionId||record?.metadata?.sessionId||null,sessionRecord=sessionId?project?.rallyExecution?.sessions?.[sessionId]:null;
      items.push({mediaGroupId:event.references?.pairId||event.references?.mediaGroupId||record?.mediaGroupId||event.eventId,projectId:project?.projectId||record?.projectId,projectName:project?.name||'Unknown Project',sessionId,sessionRunNumber:sessionRecord?.runNumber??record?.metadata?.sessionRunNumber??event.metadata?.sessionRunNumber??null,original,evidence,checkpointId,day,objectiveType:event.metadata?.objectiveType||checkpoint?.type||'checkpoint',checkpointName:`${roleTitle}${checkpoint?.name||record?.metadata?.checkpointName||event.metadata?.caption||'Unknown checkpoint'}`,checkpointNumber:record?.metadata?.checkpointNumber||(numbered?`${numbered.day}.${numbered.sequence}`:'Unavailable'),capturedAt:record?.capturedAt||event.timestamp,missing:[originalId&&!original?`${roleTitle}Original`:null,evidenceId&&!evidence?`${roleTitle}Evidence`:null].filter(Boolean),journalEventId:event.eventId,cameraRole});
    }
  }
  const orphanGroups=new Map();for(const record of records.filter(row=>!referenced.has(row.mediaId))){const key=record.mediaGroupId||record.mediaId;if(!orphanGroups.has(key))orphanGroups.set(key,{mediaGroupId:key});orphanGroups.get(key)[record.role||'original']=record;}
  for(const item of orphanGroups.values()){const record=item.original||item.evidence,project=projectById.get(String(record.projectId)),checkpoint=project?.features?.find(feature=>feature.id===record.checkpointId),numbered=rallyCheckpointNumber(checkpoint?.name),sessionId=record.sessionId||record.metadata?.sessionId||null,sessionRecord=sessionId?project?.rallyExecution?.sessions?.[sessionId]:null;items.push({...item,projectId:record.projectId,projectName:project?.name||'Unknown Project',sessionId,sessionRunNumber:sessionRecord?.runNumber??record.metadata?.sessionRunNumber??null,checkpointId:record.checkpointId,day:Number(record.metadata?.dayNumber||checkpoint?.day)||0,objectiveType:record.metadata?.objectiveType||record.metadata?.captureType||(String(record.checkpointId).startsWith('journey:')?'journey':checkpoint?.type),checkpointName:checkpoint?.name||record.metadata?.checkpointName||(record.metadata?.captureType==='ride_memory'?'Ride Memory':'Unknown checkpoint'),checkpointNumber:record.metadata?.checkpointNumber||(numbered?`${numbered.day}.${numbered.sequence}`:'Unavailable'),capturedAt:record.capturedAt,missing:[],journalEventId:record.journalEventId});}
  photoViewerGroups=items.sort((a,b)=>String(a.projectName).localeCompare(String(b.projectName))||a.day-b.day||String(a.checkpointNumber).localeCompare(String(b.checkpointNumber))||String(a.capturedAt).localeCompare(String(b.capturedAt)));
  const gallery=$('rallyPhotoGallery'),checkpointGroups=new Map();gallery.innerHTML='';photoViewerGroups.forEach((item,index)=>{const key=`${item.projectId}:${item.sessionId||'legacy'}:${item.day}:${item.checkpointId}`;if(!checkpointGroups.has(key))checkpointGroups.set(key,{...item,items:[]});checkpointGroups.get(key).items.push({...item,index});});
  let renderedKind='';for(const group of checkpointGroups.values()){
    const kind=group.objectiveType==='ride_memory'?'Ride Memories':group.objectiveType==='journey'?'Journey Photos':group.objectiveType==='hotel'?'Hotels':'Checkpoints',sectionKind=`${group.projectName} · ${kind}`;if(sectionKind!==renderedKind){const heading=document.createElement('h3');heading.className='rally-photo-kind';heading.textContent=sectionKind;gallery.appendChild(heading);renderedKind=sectionKind;}
    const section=document.createElement('section');section.className='rally-photo-group';const missing=group.items.flatMap(item=>item.missing),run=group.sessionRunNumber?` · Run ${group.sessionRunNumber}`:'';section.innerHTML=`<header><div><small>${escapeHtml(group.projectName)} · Day ${group.day||'Unavailable'}${run} · ${kind==='Journey Photos'?'General':`Checkpoint ${escapeHtml(group.checkpointNumber)}`}</small><strong>${escapeHtml(group.checkpointName)}</strong></div><small>${group.items.length} photo${group.items.length===1?'':'s'}<br>${new Date(group.capturedAt).toLocaleString()}</small></header>${missing.length?`<p class="rally-photo-missing">Missing locally stored media: ${escapeHtml([...new Set(missing)].join(', '))}</p>`:''}<div class="rally-photo-group-grid"></div>`;
    const grid=section.querySelector('.rally-photo-group-grid');for(const item of group.items){const record=item.evidence||item.original,button=document.createElement('button');button.type='button';button.className='rally-photo-card';button.dataset.photoIndex=String(item.index);if(record){const url=URL.createObjectURL(record.blob);photoViewerUrls.push(url);button.innerHTML=`<img src="${url}" alt="${escapeHtml(item.checkpointName)}" /><small>${new Date(item.capturedAt).toLocaleTimeString()}</small><small>Original: ${item.original?'Available':'Missing'}<br>Evidence: ${item.evidence?'Available':'Missing'}</small>`;}else{button.disabled=true;button.innerHTML='<strong>Media unavailable</strong>';}grid.appendChild(button);}gallery.appendChild(section);
  }
  $('rallyPhotoGalleryShell').hidden=false;gallery.hidden=!photoViewerGroups.length;$('rallyPhotoStage').hidden=true;$('rallyPhotoViewer').hidden=false;if(!photoViewerGroups.length)gallery.textContent='No journey photos have been captured.';
}
const openJourneyPhotoViewer=()=>openPhotoViewer(true);
async function exportPhotoSelection(role){const group=photoViewerGroups[photoViewerIndex],record=group?.[role];if(!record)return setStatus(`${role==='original'?'Original':'Evidence'} photo is unavailable.`,true);const file=await photoExports.single(record.mediaId);downloadStoredBlob(file.blob,file.filename);}
function captureRallyExportContext(){
  const session=currentRallySession(),scope=rallyScopeSnapshot(),project=deepClean(state.project),settings=deepClean(state.settings),day=resolveRallyExportDay({settings,project});
  return {scopeToken:scope.token,projectId:String(project.projectId||''),day,session:session?deepClean(session):null,project,settings,rallyName:project.name||'CannonMap'};
}
function rallyExportContextMatches(context){return Boolean(context&&String(state.project?.projectId||'')===context.projectId&&rallyScopeMatches(context.scopeToken)&&(!context.session||currentRallySessionId()===context.session.sessionId));}
async function exportPhotoArchive(scope){
  const mutation=acquireProjectMutation(scope==='day'?'export Day photos':'export Rally photos');if(!mutation)return;
  const context=captureRallyExportContext(),{day,session}=context,exportedAt=new Date();
  try{
    if(scope==='day'&&!day)throw Object.assign(new Error('Photo export stopped: CannonMap could not identify the rally day for the stored media.'),{code:'PHOTO_EXPORT_DAY_UNKNOWN'});
    if(scope==='day'&&!session)throw new Error('Choose a rally session before exporting Day photos.');
    const journal=(await rallyJournal.getProjectJournal(context.projectId)).events;
    const file=scope==='day'?await photoExports.day(context.projectId,day,{journal,project:context.project,session,exportedAt,rallyName:context.rallyName,buildIdentity:{applicationVersion:APP_VERSION,buildId:BUILD_ID,serviceWorkerCacheId:APP_SHELL_CACHE}}):await photoExports.rally(context.projectId,{journal});
    if(file.manifest.entryCount<1)throw new Error('Photo export failed because the verified archive contains no media files.');
    if(!rallyExportContextMatches(context))throw new Error('The rally session changed while the archive was being prepared. No backup status was changed.');
    downloadStoredBlob(file.blob,file.filename);state.settings.lastMediaExportAt=new Date().toISOString();if(scope==='day')await markDayBackupProgress(day,'photos',{session,scopeToken:context.scopeToken});else await saveProject(false);setStatus(`Exported ${file.manifest.entryCount} verified media files${scope==='day'?` for Day ${day}`:''}.`);
  }catch(error){rallyDebug.record('photo_export_failed',{scope,day,errorCode:error?.code||'PHOTO_EXPORT_FAILED',error:error?.message||String(error)});setStatus(error?.message||'Photo export failed.',true);}finally{mutation.release();}
}
async function exportEntireJourney(){
  const createdAt=new Date().toISOString(),projects=discoverJourneyProjects(await projectLifecycle.listProjects(),state.project),manifest={format:'cannonmap-journey-archive-set',version:2,createdAt,projects:[]};
  for(const project of projects){
    const media=await missionMedia.listProjectPhotos(project.projectId);manifest.projects.push(journeyProjectManifest(project,media,createdAt));
  }
  downloadBlob(JSON.stringify(manifest,null,2),'CannonMap_Entire_Journey_Manifest.json','application/json');
  for(const project of projects){try{const journal=(await rallyJournal.getProjectJournal(project.projectId)).events,file=await photoExports.projectBackup(project.projectId,{journal,project,settings:project.projectId===state.project.projectId?state.settings:{}});downloadStoredBlob(file.blob,file.filename);}catch(error){setStatus(`Journey export stopped safely at ${project.name}: ${error.message}`,true);return;}}
  state.settings.lastMediaExportAt=new Date().toISOString();await saveProject(false);setStatus('Journey archive set exported by project with a journey manifest.');
}
function dayBackupProgressKey(day=activeRallyDay(),session=currentRallySession()){return session?.sessionId||`legacy-day-${Number(day)||0}`;}
function dayBackupStatus(day=activeRallyDay()){
  const key=dayBackupProgressKey(day),progress=state.settings.mediaBackupProgress?.[key]||state.settings.mediaBackupProgress?.[day];if(!progress){if(state.settings.mediaBackups?.[key]||state.settings.mediaBackups?.[day])return 'Backup package exported';return 'Not backed up';}
  if(progress.photos&&progress.journal&&progress.package)return 'Backup complete';if(progress.package)return 'Backup package exported';if(progress.photos&&progress.journal)return 'Backup complete';if(progress.photos)return 'Photos exported';if(progress.journal)return 'Journal exported';return 'Not backed up';
}
async function markDayBackupProgress(day,kind,{session=currentRallySession(),scopeToken=null}={}){
  if(scopeToken&&!rallyScopeMatches(scopeToken))return false;
  state.settings.mediaBackupProgress||={};const key=dayBackupProgressKey(day,session),progress=state.settings.mediaBackupProgress[key]||={};progress.dayNumber=Number(day)||null;progress.sessionId=session?.sessionId||null;progress[kind]=new Date().toISOString();state.settings.lastMediaExportAt=progress[kind];await saveProject(false);if(scopeToken&&!rallyScopeMatches(scopeToken))return false;renderRallyMode();if($('rallyBackupSheetStatus'))$('rallyBackupSheetStatus').textContent=dayBackupStatus(day);renderStorageAndProjects();return true;
}
function openDayBackupSheet(){setRallyMoreOpen(false);$('rallyBackupSheet').hidden=false;$('rallyMode')?.classList.add('backup-open');$('rallyBackupSheetStatus').textContent=dayBackupStatus();setTimeout(()=>$('rallyBackupDayPhotos')?.focus(),0);}
function closeDayBackupSheet(){$('rallyBackupSheet').hidden=true;$('rallyMode')?.classList.remove('backup-open');}
async function exportDayJournal(){
  const mutation=acquireProjectMutation('export a Day Journal');if(!mutation)return;
  const context=captureRallyExportContext(),{day,session}=context,exportedAt=new Date();
  try{const events=session?journalEventsForSession(journalEventsForDay((await rallyJournal.getProjectJournal(context.projectId)).events,day),session):[];
  if(!day||!events.length){const message=!day?'Journal export stopped: CannonMap could not identify the rally day.':`Journal export failed. No Journal events were found for Day ${day}.`;rallyDebug.record('journal_export_failed',{day,error:message});return setStatus(message,true);}
  if(!rallyExportContextMatches(context))throw new Error('The rally session changed while the Journal was being prepared.');
  const filename=createSessionArtifactFilename({rallyName:context.rallyName,dayNumber:day,runNumber:session.runNumber,exportedAt,artifactType:'Journal',extension:'json'});
  downloadBlob(JSON.stringify(events,null,2),filename,'application/json;charset=utf-8');await markDayBackupProgress(day,'journal',{session,scopeToken:context.scopeToken});setStatus(`Exported ${events.length} Journal events for Day ${day} · Run ${session.runNumber}.`);
  }catch(error){rallyDebug.record('journal_export_failed',{day,error:error?.message||String(error)});setStatus(error?.message||'Journal export failed.',true);}finally{mutation.release();}
}
async function exportDayBackupPackage(){
  const mutation=acquireProjectMutation('export a Day backup');if(!mutation)return;
  const context=captureRallyExportContext(),projectId=context.projectId;let day=null;
  const log=(event,details={})=>rallyDebug.record(event,{projectId,day,...details});log('backup_started');
  try{
    if(!projectId)throw new Error('No active Project is available for backup.');log('backup_project_resolved',{projectName:context.project.name,executionId:context.project.executionId||context.project.rallyExecution?.executionId||null});
    day=context.day;if(!day)throw new Error('CannonMap could not identify the rally day.');const session=context.session;if(!session)throw new Error('Choose a rally session before creating a Day backup.');log('backup_day_resolved',{sessionId:session.sessionId,runNumber:session.runNumber});
    const events=journalEventsForSession(journalEventsForDay(await missionControlJournalEvents(),day),session);log('backup_journal_loaded',{journalEventCount:events.length});
    const storedMedia=await missionMedia.listProjectPhotos(projectId),dayMedia=storedMedia.filter(item=>Number(item.metadata?.dayNumber)===Number(day)&&String(item.metadata?.sessionId||'')===session.sessionId);log('backup_media_loaded',{storedMediaCount:storedMedia.length,dayMediaCount:dayMedia.length});
    const file=await photoExports.dayBackup(projectId,day,{journal:events,project:context.project,settings:context.settings,session,exportedAt:new Date(),rallyName:context.rallyName,buildIdentity:{applicationVersion:APP_VERSION,buildId:BUILD_ID,serviceWorkerCacheId:APP_SHELL_CACHE}});log('backup_manifest_created',{mediaCount:file.manifest.mediaCount,journalEventCount:file.manifest.journalEventCount});log('backup_zip_created',{entryCount:file.entryCount,archiveBytes:file.blob.size});
    if(!file.verified)throw new Error('The generated day package was not verified.');log('backup_verified',{mediaCount:file.manifest.mediaCount});if(!rallyExportContextMatches(context))throw new Error('The rally session changed while the Day backup was being prepared. No backup status was changed.');downloadStoredBlob(file.blob,file.filename);log('backup_download_requested',{filename:file.filename});
    const timestamp=new Date().toISOString();state.settings.mediaBackups||={};state.settings.mediaBackups[dayBackupProgressKey(day,session)]={completedAt:timestamp,dayNumber:day,sessionId:session.sessionId,filename:file.filename,mediaCount:file.manifest.mediaCount};
    await appendRallyJournalEvent('day_backup_exported',null,{eventIdentity:`day-backup:${session.sessionId}:${timestamp}`,dayNumber:day,title:`Day ${day} Backup Exported`,summary:file.filename,mediaCount:file.manifest.mediaCount},timestamp);await markDayBackupProgress(day,'package',{session,scopeToken:context.scopeToken});log('backup_completed',{filename:file.filename});setStatus(`Verified Day ${day} backup with ${file.manifest.mediaCount} media files and ${file.manifest.journalEventCount} Journal events.`);
  }catch(error){log('backup_failed',{errorCode:error?.code||'DAY_BACKUP_FAILED',error:error?.message||String(error)});setStatus(`Day backup failed verification. Your ride data is still stored on this device. ${error?.message||''}`.trim(),true);}finally{mutation.release();}
}
async function requestJourneyPhoto(){
  if(rejectRallyMutationWhileQuiesced('capture a Journey photo'))return;
  const speed=Number.isFinite(Number(state.lastGpsPosition?.speedMps))?Number(state.lastGpsPosition.speedMps)*2.23694:null;if(speed!==null&&speed>1)return setStatus('Journey photos are available only while stationary.',true);
  if(pendingPhotoCheckpointId)return setStatus('Finish the current rally evidence capture first.',true);
  const session=currentRallySession();if(!session||acceptedRallySessionId!==session.sessionId)return setStatus('Choose or start a rally session before capturing Journey media.',true);
  const scopeToken=rallyScopeSnapshot().token,capturedAt=new Date().toISOString(),day=activeRallyDay()||Number(state.settings.dayFilter)||null,eventId=stableUuid(`${state.project.projectId}:${session.sessionId}:journey-photo:${capturedAt}`),checkpoint={id:`journey:${eventId}`,type:'journey',name:'Journey Photo',day,points:0,photoRequired:false,arrivedAt:capturedAt,arrivalEvidence:captureArrivalEvidence(state.lastGpsPosition,Date.now())};
  const arrival=await appendRallyJournalEvent('journey_photo_started',checkpoint,{eventIdentity:`journey-photo:${capturedAt}`,source:'mission_control',capturedAt,captureTimestamp:capturedAt,location:checkpoint.arrivalEvidence,title:'Journey Photo',summary:'Automatic paired road and rider capture started.'},capturedAt);
  if(!rallyScopeMatches(scopeToken))return;
  pendingPhotoCheckpointId=checkpoint.id;pendingMediaObjective={checkpointId:checkpoint.id,checkpoint,captureKind:'journey',mode:'automatic',priorTargetId:null};
  let workflow=checkpointCamera.start({projectId:state.project.projectId,checkpoint,journalEvent:arrival,required:false,evidenceContext:photoEvidenceContext(checkpoint,arrival),visibility:'silent',captureKind:'journey'});
  try{
    await captureAutomaticPair(checkpoint,arrival,workflow);if(!rallyScopeMatches(scopeToken))return;const result=checkpointCamera.finish();pendingPhotoCheckpointId=null;pendingMediaObjective=null;
    rallyDebug.record('journey_photo_completed',{pairId:result?.pairId||workflow.pairId});await renderStorageAndProjects();
  }catch(error){
    let partial=error instanceof PairedMediaCaptureError?error.partial:{};const failedPairId=workflow.pairId,requestedCamera=error?.failedSide==='rider'?'front':error?.failedSide==='road'?'rear':null;
    if(isNativeCameraCaptureFailure(error)&&!automaticCaptureOverride){cameraSession?.stop(requestedCamera,'capture-failure-recovery');await cameraReadiness?.noteCaptureFailure?.(error?.cause||error,{requestedCamera});}
    if(!rallyScopeMatches(scopeToken))return;
    const failure=cameraFailureDetails(error),fallbackReason=cameraFallbackReason(error),readiness=cameraReadinessState();
    rallyDebug.record('camera_failure',{checkpointId:checkpoint.id,pairId:failedPairId,failedSide:error?.failedSide||null,speedMph:speed,disposition:'manual_fallback_required',fallbackReason,permission:readiness.permission,capability:readiness.capability,...failure});
    rallyDebug.record('camera_fallback_selected',{checkpointId:checkpoint.id,reason:fallbackReason,disposition:'manual_fallback_required',speedMph:speed,permission:readiness.permission,capability:readiness.capability});
    await appendFailureJournalBestEffort('camera_failure',checkpoint,{eventIdentity:`journey-camera-failure:${eventId}`,pairId:failedPairId,failedSide:error?.failedSide||null,captureStatus:'manual_fallback_required',fallbackReason,permissionState:readiness.permission,cameraCapability:readiness.capability,partialRoadCaptured:Boolean(partial.road),partialRiderCaptured:Boolean(partial.rider),...failure});
    if(!rallyScopeMatches(scopeToken))return;
    if(error?.requiresNewPair){workflow=await restartUnsafeCapturePair(checkpoint,arrival,'journey',failedPairId);if(!rallyScopeMatches(scopeToken))return;partial={};}
    void beginManualFallback(checkpoint,{partial,captureKind:'journey',speedMph:speed,fallbackReason}).then(async outcome=>{
      if(!rallyScopeMatches(scopeToken))return;
      if(outcome?.status==='captured')rallyDebug.record('journey_photo_completed',{pairId:workflow.pairId,captureMethod:'manual-fallback'});
      await renderStorageAndProjects();
    }).catch(error=>rallyDebug.record('journey_photo_fallback_failed',{checkpointId:checkpoint.id,error:error?.message||String(error)}));
  }
}
async function rideExportSnapshot(){return rideExportSource?.snapshot()||null;}
async function missionControlJournalEvents(){
  if(!rallyJournal||!state.project.projectId)return [];
  return (await rallyJournal.getProjectJournal(state.project.projectId)).events;
}
function journalEventMatchesSession(event,session=currentRallySession()){
  if(!session)return false;const eventSession=String(event?.sessionId||event?.metadata?.sessionId||event?.references?.sessionId||'');
  return eventSession===session.sessionId||(session.legacy&&!eventSession);
}
function journalEventsForSession(events,session=currentRallySession()){return (events||[]).filter(event=>journalEventMatchesSession(event,session));}
function replayPendingEvidenceActions(events,session=currentRallySession()){
  if(!session)return {queue:pendingEvidenceQueue,changed:false};ensurePendingEvidenceQueueForSession(session);let changed=false;
  for(const event of journalEventsForSession(events,session).filter(item=>item.eventType==='checkpoint_pending_evidence_action')){
    const checkpointId=event.metadata?.checkpointId||event.references?.checkpointId,action=event.metadata?.pendingEvidenceAction,at=event.metadata?.pendingEvidenceActionAt||event.timestamp;if(!checkpointId||!action||!pendingEvidenceEntry(pendingEvidenceQueue,{sessionId:session.sessionId,checkpointId}))continue;
    const replay=recordPendingEvidenceAction(pendingEvidenceQueue,{sessionId:session.sessionId,checkpointId,action,at,reasonCode:event.metadata?.reasonCode||null,metadata:event.metadata||{}});pendingEvidenceQueue=replay.queue;changed=changed||replay.changed;
    const checkpoint=state.project.features.find(feature=>feature.id===checkpointId&&Number(feature.day)===Number(session.dayNumber));if(checkpoint){const before=JSON.stringify({status:checkpoint.status,deferredAt:checkpoint.deferredAt,deferReason:checkpoint.deferReason,failedAt:checkpoint.failedAt,failReason:checkpoint.failReason,photoStatus:checkpoint.photoStatus});applyPendingEvidenceActionProjection(checkpoint,action,{at,reasonCode:event.metadata?.reasonCode||null,metadata:event.metadata||{}});changed=changed||JSON.stringify({status:checkpoint.status,deferredAt:checkpoint.deferredAt,deferReason:checkpoint.deferReason,failedAt:checkpoint.failedAt,failReason:checkpoint.failReason,photoStatus:checkpoint.photoStatus})!==before;}
  }
  return {queue:pendingEvidenceQueue,changed};
}
function replaySessionExecutionActions(events,session=currentRallySession()){
  if(!session)return false;let changed=false;
  for(const event of journalEventsForSession(events,session).slice().sort((left,right)=>String(left.timestamp||'').localeCompare(String(right.timestamp||''))||String(left.eventId||'').localeCompare(String(right.eventId||'')))){
    const checkpointId=event.metadata?.checkpointId||event.references?.checkpointId,checkpoint=state.project.features.find(feature=>feature.id===checkpointId&&Number(feature.day)===Number(session.dayNumber));if(!checkpoint)continue;
    const eventAt=Date.parse(event.timestamp||''),projectionAt=Math.max(0,...[checkpoint.arrivedAt,checkpoint.completedAt,checkpoint.collectedAt,checkpoint.deferredAt,checkpoint.restoredAt,checkpoint.failedAt,checkpoint.checkpointEvidence?.photo?.updatedAt,checkpoint.checkpointEvidence?.completion?.completedAt].map(value=>Date.parse(value||'')||0));if(Number.isFinite(eventAt)&&eventAt<=projectionAt)continue;
    const before=JSON.stringify({status:checkpoint.status,deferredAt:checkpoint.deferredAt,deferReason:checkpoint.deferReason,failedAt:checkpoint.failedAt,failReason:checkpoint.failReason,photoStatus:checkpoint.photoStatus});
    if(event.eventType==='checkpoint_deferred'&&checkpointEvidenceSnapshot(checkpoint).completion.state!==checkpoints.CHECKPOINT_FINAL_COMPLETION_STATE.COMPLETED){checkpoint.status=checkpoints.CHECKPOINT_STATE.DEFERRED;checkpoint.deferredAt=event.metadata?.deferredAt||event.timestamp;checkpoint.deferReason=event.metadata?.reason||event.metadata?.failureReason||'Rider deferred';}
    if(event.eventType==='checkpoint_resumed'&&checkpointEvidenceSnapshot(checkpoint).completion.state!==checkpoints.CHECKPOINT_FINAL_COMPLETION_STATE.COMPLETED&&checkpoint.status!==checkpoints.CHECKPOINT_STATE.FAILED){checkpoint.status=checkpoints.CHECKPOINT_STATE.ACTIVE;checkpoint.restoredAt=event.metadata?.resumedAt||event.timestamp;}
    if(event.eventType==='objective_failed')applyPendingEvidenceActionProjection(checkpoint,PENDING_EVIDENCE_ACTION.FAIL,{at:event.metadata?.failedAt||event.timestamp,reasonCode:'journal-replay',metadata:{failureReason:event.metadata?.failureReason||'Required photo evidence failed'}});
    if(JSON.stringify({status:checkpoint.status,deferredAt:checkpoint.deferredAt,deferReason:checkpoint.deferReason,failedAt:checkpoint.failedAt,failReason:checkpoint.failReason,photoStatus:checkpoint.photoStatus})!==before)changed=true;
  }
  return changed;
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
  const activeRepositories=activeLifecycleProjectId===state.project.projectId?projectLifecycle?.getActiveRepositories?.():null;
  rallyAnalytics=createRallyAnalyticsService({
    clock:core.clock,createId:uid,featureFlags,
    persistence:activeRepositories?.analytics||createAnalyticsRepository(analyticsDatabase)
  });
  return rallyAnalytics;
}
function refreshRideExportSource(){
  if(!rallyJournal)return null;rideExportSource=createRideExportSource({getActiveProject:()=>deepClean(state.project),journal:rallyJournal,analytics:rallyAnalytics||{flush:async()=>({status:'disabled'}),snapshot:()=>null}});return rideExportSource;
}
async function releaseRallyAnalyticsProjectScope(reason='project-scope-changing'){
  await stopRallyAnalytics(reason);rallyAnalytics=null;analyticsExecutionSessionId=null;refreshRideExportSource();
}
async function bindRallyAnalyticsToActiveProject(){
  try{const service=await initializeRallyAnalytics();refreshRideExportSource();return service;}catch(error){console.warn(`[CannonMap analytics] Project scope bind failed: ${error?.message||error}`);refreshRideExportSource();return null;}
}
async function rebindRallyAnalyticsForActiveProject(reason='project-scope-changed'){
  await releaseRallyAnalyticsProjectScope(reason);return bindRallyAnalyticsToActiveProject();
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
  const boxes=[$('competitorSummary'),$('mobileCompetitorSummary')].filter(Boolean),now=Date.now();if(!boxes.length)return;
  for(const box of boxes){if(!state.project.competitors.length){box.className='layer-list empty';box.textContent='No competitor data loaded.';continue;}box.className='tactical-competitor-summary';box.innerHTML=compactRiderListHtml(state.project.competitors,{selectedRiderId:selectedCompetitorId,statusForRider:rider=>competitorFreshness(rider,competitorTacticalProjection(rider,{now}).tactical,now)});box.querySelectorAll('[data-rider-id]').forEach(button=>button.onclick=()=>selectCompetitor(button.dataset.riderId));box.querySelector('[data-rider-view-all]')?.addEventListener('click',()=>selectCompetitor(null));}
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
  const point={lat,lon,time:source.time||source.timestamp||source.recordedAt||source.updatedAt||source.lastUpdate||source.datetime||nested.time||nested.timestamp||'',sessionId:source.sessionId||source.session_id||source.deviceSessionId||'',observationId:source.observationId||source.locationId||source.pointId||'',speedMph:Number.isFinite(Number(source.speedMph))?Number(source.speedMph):Number.isFinite(Number(source.speed))?Number(source.speed):null,heading:Number.isFinite(Number(source.heading??source.course))?Number(source.heading??source.course):null};
  return validPoint(point)?point:null;
}
function competitorIdentity(entry,index=0) {
  const props=entry?.properties||{};
  const competitor=entry?.competitor||entry?.rider||{};
  const id=stableCompetitorId(entry,index);
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
  const priorIds=new Set(state.project.competitors.map(item=>String(item.id))),result=mergeCompetitorSnapshots(state.project.competitors,incoming,{historyMs:Math.max(15,Number(state.settings.competitorTrailMinutes)||480)*60000,maxPoints:12000});state.project.competitors=result.competitors;const target=currentCheckpoint();if(target)state.project.recentTargetActivity=mergeRecentTargetActivity(state.project.recentTargetActivity,buildTargetActivity(result.competitors,target));return {added:result.added,riders:result.competitors.filter(item=>!priorIds.has(String(item.id))).length};
}
async function fetchWithTimeout(url,options={},timeout=15000) {
  const controller=new AbortController(),upstream=options.signal,relay=()=>controller.abort(upstream?.reason);if(upstream?.aborted)relay();else upstream?.addEventListener?.('abort',relay,{once:true});
  const timer=setTimeout(()=>controller.abort(),timeout);
  try{return await fetch(url,{...options,signal:controller.signal,cache:'no-store'});}finally{clearTimeout(timer);upstream?.removeEventListener?.('abort',relay);}
}
async function fetchRallyFeedSnapshot({signal=null}={}){
  const endpoint=(state.settings.rallyEndpointUrl||'').trim();
  if(!endpoint)throw new Error('Live endpoint not captured yet.');
  if(/leaderboard\.html|cmp_checkpoints\.html/i.test(endpoint))throw new Error('This is a web page, not the data endpoint.');
  const response=await fetchWithTimeout(endpoint,{signal,headers:{Accept:'application/json, text/plain;q=0.9, */*;q=0.5'}});if(!response.ok)throw new Error(`HTTP ${response.status}`);
  const text=await response.text();if(/^\s*</.test(text))throw new Error('Endpoint returned HTML instead of location JSON.');
  let payload;try{payload=JSON.parse(text);}catch(_){throw new Error('Endpoint did not return valid JSON.');}
  const incoming=normalizeCompetitorPayload(payload);if(!incoming.length)throw new Error('No competitor coordinates were recognized in the response.');return incoming;
}
function ensureLivePollWriteScheduler(){
  if(!livePollWriteScheduler)livePollWriteScheduler=createCoalescingWriteScheduler({write:()=>saveProject(false),delayMs:30000,maxWaitMs:60000,onStateChange:snapshot=>{if(snapshot.lastError){state.rallySync.lastError=`Trail storage retry: ${snapshot.lastError}`;renderIntelSummary();}}});return livePollWriteScheduler;
}
function rallyPollScope(){return Object.freeze({generation:rallyPollGeneration,projectId:String(state.project.projectId||'')});}
function rallyPollScopeMatches(scope){return Boolean(scope&&scope.generation===rallyPollGeneration&&scope.projectId===String(state.project.projectId||'')&&!rallyScopeSuspended);}
function clearOfficialRallySnapshotBatch(){if(rallyOfficialSnapshotTimer!==null)clearTimeout(rallyOfficialSnapshotTimer);rallyOfficialSnapshotTimer=null;rallyOfficialPendingSnapshot=null;}
function officialSnapshotCompetitors(payload){
  const standingById=new Map((payload?.standings||[]).map(row=>[String(row.id),row]));return normalizeCompetitorPayload({locations:payload?.locations}).map(competitor=>{
    const standing=standingById.get(String(competitor.id));return {...competitor,number:standing?.number,signature:window.CannonMapStationaryEvents?.competitorSignature({id:competitor.id,number:standing?.number,name:competitor.name})};
  });
}
function queueOfficialRallySnapshot(payload,scope){
  if(!rallyPollScopeMatches(scope))return false;rallyOfficialPendingSnapshot={payload,scope};if(rallyOfficialSnapshotTimer!==null)return true;
  const delay=Math.max(0,1000-(Date.now()-rallyOfficialLastAppliedAt));rallyOfficialSnapshotTimer=setTimeout(async()=>{
    rallyOfficialSnapshotTimer=null;const pending=rallyOfficialPendingSnapshot;rallyOfficialPendingSnapshot=null;if(!pending||!rallyPollScopeMatches(pending.scope))return;
    rallyOfficialLastAppliedAt=Date.now();await applyRallyFeedSnapshot(officialSnapshotCompetitors(pending.payload),{scope:pending.scope});
  },delay);return true;
}
function startRallyPollHealth(scope){
  if(rallyPollHealthTimer!==null)return;rallyPollHealthTimer=setInterval(()=>{
    if(!rallyPollScopeMatches(scope)||state.settings.rallyLivePollingEnabled!==true)return;
    const status=rallyPollingState();renderIntelSummary();
    if(state.rallyLiveFeed&&navigator.onLine!==false&&status.status==='stale'&&Date.now()-rallyOfficialHealthRefreshAt>=120000){rallyOfficialHealthRefreshAt=Date.now();void state.rallyLiveFeed.refreshMetadata?.().catch(error=>{if(rallyPollScopeMatches(scope)){state.rallySync.lastError=error?.message||'Official competitor feed is stale.';renderIntelSummary();}});}
  },30000);
}
function stopRallyPollHealth(){if(rallyPollHealthTimer!==null)clearInterval(rallyPollHealthTimer);rallyPollHealthTimer=null;rallyOfficialHealthRefreshAt=0;}
async function applyRallyFeedSnapshot(incoming,{announce=false,scope=null}={}){
  if(scope&&!rallyPollScopeMatches(scope))return {ignored:true,reason:'scope-changed',added:0,riders:0};
  const result=mergeCompetitorData(incoming);state.rallySync.lastSnapshotAt=new Date().toISOString();state.rallySync.pointsAdded=result.added;state.rallySync.lastError='';
  if(result.added>0){updateStationaryDetection();state.rallySync.lastSync=state.rallySync.lastSnapshotAt;ensureLivePollWriteScheduler().markDirty('competitor-feed');}
  renderCompetitors();renderStationaryEvents();renderCompetitorSummary();renderIntelSummary();if(announce)setStatus(`Trail sync complete: ${incoming.length} riders, ${result.added} new breadcrumbs.`);return result;
}
async function syncRallyFeed({announce=true}={}){
  if(rallyManualSyncController)return null;
  const scope=rallyPollScope(),controller=new AbortController();rallyManualSyncController=controller;
  state.rallySync.running=true;state.rallySync.lastError='';renderIntelSummary();
  try{const incoming=await fetchRallyFeedSnapshot({signal:controller.signal});if(!rallyPollScopeMatches(scope))return null;const result=await applyRallyFeedSnapshot(incoming,{announce,scope});await ensureLivePollWriteScheduler().flush('manual-sync');return result;}
  catch(error){if(!rallyPollScopeMatches(scope))return null;state.rallySync.lastError=error.name==='AbortError'?'Feed request timed out.':error.message;if(announce)setStatus(`Trail sync failed: ${state.rallySync.lastError}`,true);renderIntelSummary();return null;}
  finally{if(rallyManualSyncController===controller)rallyManualSyncController=null;if(rallyPollScopeMatches(scope)){state.rallySync.running=false;renderIntelSummary();}}
}
function rallyPollingState(){
  const desired=state.settings.rallyLivePollingEnabled===true;if(!desired)return {status:'off',desired:false};if(navigator.onLine===false)return {status:'offline',desired:true};
  if(livePollController)return livePollController.state();
  if(state.rallyLiveFeed){const last=Date.parse(state.rallySync.lastSync||''),stale=!Number.isFinite(last)||Date.now()-last>Math.max(90_000,Number(state.settings.rallyPollSeconds||30)*3000);return {status:stale?'stale':'live',desired:true};}
  return {status:'reconnecting',desired:true};
}
async function stopRallyPolling({preserveIntent=false,flush=true}={}) {
  rallyPollGeneration++;rallyManualSyncController?.abort(new DOMException('Competitor feed scope changed.','AbortError'));rallyManualSyncController=null;clearOfficialRallySnapshotBatch();stopRallyPollHealth();
  if(state.rallyLiveFeed){state.rallyLiveFeed.stop();state.rallyLiveFeed=null;}
  livePollController?.stop?.();livePollController=null;const storage=flush?await livePollWriteScheduler?.stop?.({flush:true}):await livePollWriteScheduler?.stop?.({flush:false});livePollWriteScheduler=null;if(storage?.lastError)state.rallySync.lastError=`Trail storage retry stopped: ${storage.lastError}`;
  state.rallyPollTimer=null;if(!preserveIntent)state.settings.rallyLivePollingEnabled=false;
  if($('toggleRallyPollingButton'))$('toggleRallyPollingButton').textContent='Start live polling';
  renderIntelSummary();
}
async function startRallyPolling({silent=false,persist=true}={}){
  if(state.rallyLiveFeed||livePollController)return rallyPollingState();state.settings.rallyLivePollingEnabled=true;ensureLivePollWriteScheduler();const scope={generation:++rallyPollGeneration,projectId:String(state.project.projectId||'')};
  if(!state.settings.rallyEndpointUrl&&window.GPSCheckpointsFeed&&state.settings.rallyEventId){
    const feed=window.GPSCheckpointsFeed.createGPSCheckpointsFeed({eventId:state.settings.rallyEventId});
    feed.on('snapshot',payload=>queueOfficialRallySnapshot(payload,scope));
    feed.on('error',detail=>{if(!rallyPollScopeMatches(scope))return;state.rallySync.lastError=navigator.onLine===false?'OFFLINE · showing saved competitor trails':detail.error?.message||'Live feed error.';renderIntelSummary();});
    state.rallyLiveFeed=feed;state.rallySync.running=true;renderIntelSummary();
    await feed.start();
    if(!rallyPollScopeMatches(scope)){feed.stop();return {status:'stopped',desired:false};}
    startRallyPollHealth(scope);
    state.rallySync.running=false;if($('toggleRallyPollingButton'))$('toggleRallyPollingButton').textContent='Stop live sync';
    if(!silent)setStatus('Official GPS Checkpoints live feed connected.');renderIntelSummary();if(persist)await saveProject(false);return rallyPollingState();
  }
  if(!state.settings.rallyEndpointUrl){state.settings.rallyLivePollingEnabled=false;state.rallySync.lastError='Live feed needs an Event ID or custom JSON endpoint.';renderIntelSummary();if(!silent)setStatus(state.rallySync.lastError,true);return rallyPollingState();}
  const seconds=Math.max(10,Number(state.settings.rallyPollSeconds)||30);
  livePollController=createLivePollController({
    poll:({signal})=>fetchRallyFeedSnapshot({signal}),intervalMs:seconds*1000,staleAfterMs:Math.max(90_000,seconds*3000),
    onSnapshot:incoming=>applyRallyFeedSnapshot(incoming,{scope}),onStateChange:snapshot=>{if(!rallyPollScopeMatches(scope))return;state.rallySync.running=snapshot.status==='polling';if(['error','offline','stale'].includes(snapshot.status))state.rallySync.lastError=snapshot.status==='offline'?'OFFLINE · showing saved competitor trails':snapshot.lastError||'Competitor feed is stale.';else if(['live','polling','reconnecting','starting'].includes(snapshot.status))state.rallySync.lastError='';renderIntelSummary();}
  });livePollController.start();state.rallyPollTimer='controller';
  if($('toggleRallyPollingButton'))$('toggleRallyPollingButton').textContent='Stop live polling';
  if(!silent)setStatus(`Live trail polling started every ${seconds} seconds.`);renderIntelSummary();if(persist)await saveProject(false);return rallyPollingState();
}
async function toggleRallyPolling() {
  if(state.settings.rallyLivePollingEnabled===true||state.rallyLiveFeed||livePollController){await stopRallyPolling();await saveProject(false);setStatus('Live trail sync stopped.');return;}
  await startRallyPolling();
}
async function saveIntegrationSettings() {
  const resumePolling=state.settings.rallyLivePollingEnabled===true;
  state.settings.inreachUrl=$('inreachUrl')?.value.trim()||'';
  state.settings.leaderboardUrl=$('leaderboardUrl')?.value.trim()||'';
  state.settings.rallyEndpointUrl=$('rallyEndpointUrl')?.value.trim()||'';
  state.settings.rallyEventId=$('rallyEventId')?.value.trim()||'';
  state.settings.rallyPollSeconds=Number($('rallyPollSeconds')?.value)||30;
  state.settings.competitorFreshMinutes=Number($('competitorFreshMinutes')?.value)||15;
  state.settings.showCompetitorTrails=$('showCompetitorTrails')?.checked!==false;
  state.settings.showCompetitorMarkers=$('showCompetitorMarkers')?.checked!==false;
  state.settings.showStationaryEvents=$('showStationaryEvents')?.checked!==false;
  state.settings.showCompetitorClusters=$('showCompetitorClusters')?.checked!==false;
  state.settings.competitorTrailMinutes=Number($('competitorTrailMinutes')?.value)||480;
  state.settings.competitorTrailOpacity=Number($('competitorTrailOpacity')?.value)||100;
  state.settings.trafficProvider=$('trafficProvider')?.value||'none';
  state.settings.tomtomApiKey=$('tomtomApiKey')?.value.trim()||'';
  state.settings.wazeFeedUrl=$('wazeFeedUrl')?.value.trim()||'';
  if(resumePolling)await stopRallyPolling({preserveIntent:true,flush:true});await saveProject(true);renderMapFeatures();renderIntelSummary();if(resumePolling)await startRallyPolling({silent:true,persist:false});
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
async function clearCompetitors() {
  if(!state.project.competitors.length)return;
  if(!confirm('Clear all captured competitor trails from this project?'))return;
  snapshot();await stopRallyPolling();state.project.competitors=[];await saveProject(false);renderAll();setStatus('Competitor trails cleared.');
}
function zoomCompetitor(id) {
  const comp=state.project.competitors.find(item=>String(item.id)===String(id));
  if(!comp?.points?.length)return;
  const points=competitorTacticalProjection(comp).tactical.points;if(!points.length)return;
  const bounds=L.latLngBounds(points.map(point=>[point.lat,point.lon]));
  if(bounds.isValid())performProgrammaticMapChange('fit-map',()=>state.map.fitBounds(bounds,{padding:[35,35],maxZoom:14,animate:false}));
}
function fitIntelligence() {
  return performProgrammaticMapChange('fit-intelligence',()=>mapEngine.fitLayerTypes(['competitors','stationaryEvents','traffic','weather'],{padding:[30,30],maxZoom:14,animate:false}));
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
async function fetchWeatherContext(point){
  const params=new URLSearchParams({latitude:point.lat.toFixed(5),longitude:point.lon.toFixed(5),current:'temperature_2m,apparent_temperature,precipitation,rain,weather_code,wind_speed_10m,wind_gusts_10m',hourly:'temperature_2m,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m',forecast_hours:'6',temperature_unit:'fahrenheit',wind_speed_unit:'mph',precipitation_unit:'inch',timezone:'auto'});
  const response=await fetchWithTimeout(`https://api.open-meteo.com/v1/forecast?${params}`);if(!response.ok)throw new Error(`HTTP ${response.status}`);
  const data=await response.json(),current=data.current||{},probabilities=(data.hourly?.precipitation_probability||[]).filter(Number.isFinite);
  return {data,temperature:current.temperature_2m??null,condition:WEATHER_CODES[current.weather_code]||null,precipitationProbability:probabilities.length?Math.max(...probabilities):null,observationTimestamp:current.time||null,provider:'Open-Meteo'};
}
function applyWeatherContext(context){if(!context)return;state.weatherData=context.data;state.weatherPoint={...context.requestCoordinates,label:context.cached?'Cached GPS weather':'GPS position'};renderWeather();renderIntelSummary();}
async function loadWeatherHere() {
  const point=currentIntelPoint();
  if($('weatherSummary')){$('weatherSummary').className='intel-card loading';$('weatherSummary').textContent='Loading weather…';}
  try{
    const context=await weatherMaintenance.refresh(point,'manual');const data=context.data;
    applyWeatherContext(context);setStatus(`Weather loaded for ${point.label}.`);
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
const RADAR_CACHE_KEY='cannonmap.radar.frames.v1',RADAR_MAX_AGE_MS=90*60*1000;
function radarTileUrl(frame) {return `${frame.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;}
function radarFrameTime(frame) {return new Date(Number(frame.time)*1000);}
function cachedRadarFrames(){try{const cached=JSON.parse(localStorage.getItem(RADAR_CACHE_KEY)||'null');return cached?.savedAt&&Date.now()-Date.parse(cached.savedAt)<=RADAR_MAX_AGE_MS?cached:null;}catch{return null;}}
function saveRadarFrames(frames){try{localStorage.setItem(RADAR_CACHE_KEY,JSON.stringify({savedAt:new Date().toISOString(),frames:frames.slice(-12)}));}catch{}}
async function showRadar({silent=false}={}) {
  state.settings.radarEnabled=true;saveProject(false);
  if($('radarSummary')){$('radarSummary').className='intel-card loading';$('radarSummary').textContent='Loading recent radar frames…';}
  try{
    const response=await fetchWithTimeout(RAINVIEWER_MAPS_URL);
    if(!response.ok)throw new Error(`RainViewer HTTP ${response.status}`);
    const data=await response.json();
    const host=String(data.host||'');const frames=(data.radar?.past||[]).filter(frame=>frame?.path&&Number.isFinite(Number(frame.time))).map(frame=>({...frame,host}));
    if(!host||!frames.length)throw new Error('No radar frames are currently available.');
    state.radarFrames=frames.slice(-12);saveRadarFrames(state.radarFrames);state.radarFrameIndex=state.radarFrames.length-1;renderRadarFrame();
    if($('radarPlayButton')) $('radarPlayButton').disabled=frames.length<2;
    if($('radarToggleButton')) $('radarToggleButton').textContent='Hide radar';
    if(!silent)setStatus('Weather radar loaded.');
  }catch(error){const cached=cachedRadarFrames();if(cached?.frames?.length){state.radarFrames=cached.frames;state.radarFrameIndex=state.radarFrames.length-1;renderRadarFrame();if($('radarPlayButton'))$('radarPlayButton').disabled=state.radarFrames.length<2;if($('radarToggleButton'))$('radarToggleButton').textContent='Hide radar';if($('radarSummary')){$('radarSummary').className='intel-card warning';$('radarSummary').querySelector('small').textContent=`Cached radar · ${Math.round((Date.now()-Date.parse(cached.savedAt))/60000)} min old`;}return;}hideRadar(false,false);if($('radarSummary')){$('radarSummary').className='intel-card error';$('radarSummary').textContent=`Radar unavailable: ${error.message}`;}if(!silent)setStatus(`Radar failed: ${error.message}`,true);}
}
function radarCoverageFeatures() {
  const scope=state.settings.radarCoverage||'active-day';if(scope==='map')return [];
  const selected=state.project.features.find(feature=>feature.id===state.selectedId&&feature.geometry?.kind==='line');
  if(scope==='selected')return selected?[selected]:[];
  const day=Number(state.settings.dayFilter);
  if(Number.isInteger(day)&&day>=1)return state.project.features.filter(feature=>feature.geometry?.kind==='line'&&Number(feature.day)===day);
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
  const bounds=radarCoverageBounds();if(bounds)options.bounds=bounds;return L.tileLayer(radarTileUrl(frame),{...options,pane:'radarPane'});
}
function updateRadarSummary(cached=false) {
  const frame=state.radarFrames[state.radarFrameIndex];if(!frame)return;const time=radarFrameTime(frame);
  const age=Math.max(0,Date.now()-time.valueOf()),stale=age>20*60*1000;
  if($('radarSummary')){$('radarSummary').className='intel-card';$('radarSummary').innerHTML=`<strong>Radar ${escapeHtml(time.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}))}</strong><small>Recent observed precipitation · frame ${state.radarFrameIndex+1} of ${state.radarFrames.length} · ${escapeHtml(radarCoverageLabel())}</small>`;}
}
function renderRadarFrame() {
  const frame=state.radarFrames[state.radarFrameIndex];if(!frame)return;if(state.radarLayer)state.map.removeLayer(state.radarLayer);
  state.radarLayer=createRadarLayer(frame,Number(state.settings.radarOpacity||65)/100);mapEngine.group('radar').addLayer(state.radarLayer);updateRadarSummary();
  const age=Math.max(0,Date.now()-radarFrameTime(frame).valueOf());if(age>20*60*1000&&$('radarSummary')){$('radarSummary').className='intel-card warning';$('radarSummary').querySelector('small').textContent=`Stale · ${Math.round(age/60000)} min old · ${radarCoverageLabel()}`;}
}
function scheduleRadarNext() {
  if(!state.radarPlaying)return;state.radarTimer=setTimeout(()=>{state.radarTimer=null;transitionRadarFrame((state.radarFrameIndex+1)%state.radarFrames.length);},1050);
}
function transitionRadarFrame(index) {
  if(!state.radarPlaying)return;const frame=state.radarFrames[index];if(!frame)return;const token=++state.radarAnimationToken;const next=createRadarLayer(frame,0);state.radarNextLayer=next;let revealed=false;
  const reveal=()=>{if(revealed||token!==state.radarAnimationToken)return;revealed=true;if(state.radarLoadTimer){clearTimeout(state.radarLoadTimer);state.radarLoadTimer=null;}const previous=state.radarLayer;next.setOpacity(Number(state.settings.radarOpacity||65)/100);previous?.setOpacity(0);state.radarLayer=next;state.radarNextLayer=null;state.radarFrameIndex=index;updateRadarSummary();setTimeout(()=>{if(previous&&state.map.hasLayer(previous))state.map.removeLayer(previous);},360);scheduleRadarNext();};
  next.once('load',reveal);mapEngine.group('radar').addLayer(next);state.radarLoadTimer=setTimeout(reveal,2800);
}
function stopRadarLoop() {
  state.radarPlaying=false;state.radarAnimationToken++;if(state.radarTimer){clearTimeout(state.radarTimer);state.radarTimer=null;}if(state.radarLoadTimer){clearTimeout(state.radarLoadTimer);state.radarLoadTimer=null;}if(state.radarNextLayer&&state.map.hasLayer(state.radarNextLayer))state.map.removeLayer(state.radarNextLayer);state.radarNextLayer=null;if($('radarPlayButton'))$('radarPlayButton').textContent='Play loop';
}
function toggleRadarLoop() {
  if(state.radarPlaying)return stopRadarLoop();if(state.radarFrames.length<2)return;state.radarPlaying=true;if($('radarPlayButton'))$('radarPlayButton').textContent='Pause loop';transitionRadarFrame(0);
}
function hideRadar(save=true,disable=true) {
  stopRadarLoop();if(state.radarLayer&&state.map)state.map.removeLayer(state.radarLayer);state.radarLayer=null;state.radarFrames=[];state.radarFrameIndex=-1;
  if($('radarToggleButton'))$('radarToggleButton').textContent='Show radar';if($('radarPlayButton'))$('radarPlayButton').disabled=true;
  if($('radarSummary')){$('radarSummary').className='intel-card empty';$('radarSummary').textContent='Weather radar is off.';}
  if(disable)state.settings.radarEnabled=false;if(save)saveProject(false);
}
function toggleRadar() {if(state.radarLayer)hideRadar();else showRadar();}
function setRadarOpacity() {state.settings.radarOpacity=Math.min(90,Math.max(20,Number($('radarOpacity')?.value)||65));state.radarLayer?.setOpacity(state.settings.radarOpacity/100);saveProject(false);}
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
  const polling=rallyPollingState(),status=state.rallySync.running?'polling':polling.status,label={polling:'SYNCING',live:'LIVE',stale:'STALE',offline:'OFFLINE',paused:'STALE',error:'STALE',reconnecting:'CONNECTING',starting:'CONNECTING',off:'OFF'}[status]||'READY',running=polling.desired===true;const badge=$('feedBadge');if(badge){badge.textContent=label;badge.className=`badge ${status==='live'?'live':['stale','offline','paused','error'].includes(status)?'warning':'neutral'}`;}
  if($('rallyFeedNotice')){$('rallyFeedNotice').textContent=state.rallySync.lastError?state.rallySync.lastError:running?`${label} · ${riders.length} riders · ${points} bounded breadcrumbs`:'The built-in official feed uses the Event ID. The custom JSON/location endpoint is optional. Live updates resume automatically when enabled.';}
  if($('mobileRiderCount'))$('mobileRiderCount').textContent=riders.length;if($('mobileFreshCount'))$('mobileFreshCount').textContent=fresh;if($('mobileTrafficCount'))$('mobileTrafficCount').textContent=state.trafficIncidents.length;
  if($('mobileIntelStatus'))$('mobileIntelStatus').textContent=running?`${label} · last ${formatClock(state.rallySync.lastSync)}`:state.rallySync.lastSync?`OFF · last sync ${formatClock(state.rallySync.lastSync)}`:'OFF';
  if($('mobileObjectiveIntel'))$('mobileObjectiveIntel').textContent=objectiveTrailIntel(currentCheckpoint())||'No recent competitor activity near the active objective.';
  if($('mobileWeatherSummary')){if(state.weatherData){const c=state.weatherData.current||{};$('mobileWeatherSummary').textContent=`${Math.round(c.temperature_2m??0)}°F · ${WEATHER_CODES[c.weather_code]||'Weather'} · Gusts ${Math.round(weatherMaxGustMph(state.weatherData))} mph`;}else $('mobileWeatherSummary').textContent='Weather not loaded';}
}
function activeRallyDay(){return checkpoints.activeRallyDay(state.settings);}
function rallyScopeSnapshot(){
  const projectId=String(state.project.projectId||state.project.id||'current'),dayNumber=activeRallyDay(),sessionId=currentRallySessionId();
  return Object.freeze({projectId,dayNumber,sessionId,generation:rallyScopeGeneration,token:`${rallyScopeGeneration}:${projectId}:${dayNumber||'none'}:${sessionId||'no-session'}`});
}
function rallyScopeMatches(token){return Boolean(!rallyScopeSuspended&&token&&token===rallyScopeSnapshot().token);}
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
  if(!next)return '';
  const explicit=next.navigationGuidance||next.routeInstruction||next.turnInstruction;if(explicit)return String(explicit);
  if(distance===null)return 'Navigation position unavailable';
  const feet=Math.round(distance*5280),radius=Math.max(100,Number(state.settings.checkpointArrivalRadius)||500);
  if(feet<=radius)return 'Checkpoint Ahead';
  return feet<1000?`Continue ${feet}'`:`Continue ${distance.toFixed(1)} mi`;
}
function warningVisible(warning,next){
  const item=state.settings.missionWarningSuppressions?.[warning.id];if(!item)return true;
  if(item.mode==='dismiss')return item.signature!==warning.message;
  if(item.mode==='until'&&Number(item.until)>Date.now())return false;
  if(item.mode==='checkpoint'&&item.checkpointId===next?.id)return false;
  return true;
}
function currentOperationalWarnings(next){
  const warnings=[],camera=cameraReadinessState();
  if(!navigator.onLine)warnings.push({id:'offline',message:'Offline — live intelligence is paused.'});
  if(state.gpsWatchId===null)warnings.push({id:'gps',message:'GPS REQUIRED — Start GPS for automatic checkpoint arrival.'});
  else if(contextualGpsLabel().startsWith('GPS POOR'))warnings.push({id:'gps',message:`${contextualGpsLabel()} — automatic arrival is waiting for better accuracy.`});
  if(cameraSetupRequired()&&!cameraSetupDismissed)warnings.push({id:'camera',message:'CAMERA SETUP REQUIRED — enable once before riding.'});
  else if(!camera.automaticCaptureEligible&&camera.capability!=='uninitialized'&&camera.capability!=='checking')warnings.push({id:'camera',message:'Manual camera mode — tap the full capture screen when requested.'});
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
  const nextEvidence=next?checkpointEvidenceSnapshot(next):null,nextModel=next?{...next,arrivalState:nextEvidence.arrival.state,arrivalTrustworthy:Boolean(nextEvidence.arrival.trustworthy),photoEvidenceState:nextEvidence.photo.state,finalCompletionState:nextEvidence.completion.state,
    photoRecoveryAction:next.photoRequired&&nextEvidence.photo.state!==checkpoints.CHECKPOINT_PHOTO_EVIDENCE_STATE.COMPLETE?
      (['partial','capture_started','interrupted'].includes(nextEvidence.photo.state)?'RESUME PAIR':nextEvidence.photo.pairId?'RETRY EVIDENCE':'CAPTURE PHOTO'):null}:null;
  const dayState=rallyDayState(activeRallyDay()),sessionChoice=rallySessionChoiceState(),pendingEvidence=activePendingEvidenceEntries().map(entry=>({...entry,checkpointName:state.project.features.find(feature=>feature.id===entry.checkpointId)?.name||entry.checkpointName||entry.checkpointId,recoveryAction:['partial','capture_started','interrupted'].includes(entry.photoState)||entry.pairId?'RESUME PAIR':'RETRY EVIDENCE'}));
  const reviewMode=Boolean(restoredDayReview&&restoredDayReview.projectId===state.project.projectId&&restoredDayReview.dayNumber===activeRallyDay());
  const deferredCount=rows.filter(feature=>feature.type!=='hotel'&&feature.status==='deferred').length;
  const hasRunnable=rows.some(feature=>feature.type!=='hotel'&&[checkpoints.CHECKPOINT_STATE.UPCOMING,checkpoints.CHECKPOINT_STATE.ACTIVE].includes(feature.status));
  const empty=rallyEmptyState(rows,dayState,reviewMode),objectiveIntel=objectiveTrailIntel(next);
  presentRally({getElement:$,escapeHtml,model:{
    projectName:state.project.name,day:activeRallyDay(),online:navigator.onLine,gpsStatus:$('gpsStatus')?.textContent||'GPS off',
    gpsAccuracy:contextualGpsLabel(),
    elevation:Number.isFinite(state.lastGpsPosition?.elevationFeet)?`Elev ${Math.round(state.lastGpsPosition.elevationFeet).toLocaleString()} ft`:'Elev —',
    gpsActive:state.gpsWatchId!==null,followMode:gpsFollow?.state().mode||'following',score:rallyScore(),next:nextModel,distance,navigationGuidance:next?navigationGuidance(next,distance):empty.guidance,
    emptyLabel:empty.label,hotelLabel:hotel.label,feedAge:last?`Feed ${formatClock(last)}`:'Feed never updated',
    deferredCount,showDeferredPrompt:deferredCount>0&&!hasRunnable&&!next,hasHotel:Boolean(hotel.hotel),hotelBailoutActive:state.hotelBailoutActive,
    autoComplete:state.settings.autoCompleteCheckpoints!==false,arrivalRadius:state.settings.checkpointArrivalRadius||500,maxAccuracy:state.settings.checkpointMaxAccuracy||200,
    checkpoints:rows,hasPlanned:rows.some(feature=>feature.status===checkpoints.CHECKPOINT_STATE.UPCOMING),warnings:currentOperationalWarnings(next),
    objectiveIntel,dayComplete:dayState.status==='complete',nextDay:dayState.nextDay,daySummary:dayState.summary,backupStatus:dayBackupStatus(),reviewMode,
    cameraReadiness:cameraReadinessState(),sessionChoice,pendingEvidence,showCameraSetup:showCameraSetup(),showDayPreflight:showDayPreflight(),dayPreflight:dayPreflightPresenterModel()
  }});
  renderRallyLayerControls();
}
function renderRallyLayerControls(){
  const values={rallyLayerCompetitors:state.settings.showCompetitorMarkers!==false,rallyLayerBreadcrumbs:state.settings.showCompetitorTrails!==false,rallyLayerCheckpoints:state.settings.typeVisibility?.checkpoint!==false,rallyLayerRoute:state.settings.typeVisibility?.route!==false||state.settings.typeVisibility?.track!==false,rallyLayerRadar:Boolean(state.radarLayer)};
  for(const [id,active] of Object.entries(values))$(''+id)?.setAttribute('aria-pressed',String(active));
}
function toggleRallyLayer(kind){
  if(kind==='competitors')state.settings.showCompetitorMarkers=state.settings.showCompetitorMarkers===false;
  if(kind==='breadcrumbs')state.settings.showCompetitorTrails=state.settings.showCompetitorTrails===false;
  if(kind==='checkpoints')state.settings.typeVisibility.checkpoint=state.settings.typeVisibility.checkpoint===false;
  if(kind==='route'){const active=state.settings.typeVisibility.route!==false||state.settings.typeVisibility.track!==false;state.settings.typeVisibility.route=!active;state.settings.typeVisibility.track=!active;state.settings.typeVisibility.backbone=!active;}
  if(kind==='radar'){toggleRadar();renderRallyLayerControls();return;}
  saveProject(false);renderMapFeatures();renderCompetitors();renderRallyLayerControls();
}
function markRallyNavigation(active){for(const [id,name] of [['rallyMissionButton','mission'],['rallyTrailIntelButton','intel'],['rallyJournalButton','journal'],['rallyMoreButton','more']])$(''+id)?.classList.toggle('active',active===name);}
async function renderRallyJournal(){
  const timeline=$('rallyJournalTimeline');if(!timeline||!rallyJournal)return;
  const events=journalEventsForSession((await rallyJournal.getProjectJournal(state.project.projectId)).events).filter(event=>Number(event.metadata?.dayNumber||event.dayNumber||activeRallyDay())===activeRallyDay()).sort((a,b)=>Date.parse(b.timestamp)-Date.parse(a.timestamp));
  timeline.innerHTML=events.length?events.map(event=>`<article class="rally-journal-event"><strong>${escapeHtml(event.title||event.eventType||'Journal event')}</strong><small>${escapeHtml(new Date(event.timestamp).toLocaleString())}${event.summary?` · ${escapeHtml(event.summary)}`:''}</small></article>`).join(''):'<p>No Journal events for this day yet. GPS, checkpoints, photos, weather, hotels, and score are recorded automatically.</p>';
}
function setRallyJournalOpen(open){
  $('rallyMode')?.classList.toggle('journal-open',open);$('rallyJournalSheet')?.setAttribute('aria-hidden',String(!open));
  if(open){$('rallyMode')?.classList.remove('more-open');setIntelSheetOpen(false);markRallyNavigation('journal');renderRallyJournal().catch(error=>setStatus(`Journal unavailable: ${error.message}`,true));}
  else if(!$('rallyMode')?.classList.contains('more-open')&&!$('intelSheet')?.classList.contains('open'))markRallyNavigation('mission');
}
function setRallyMoreOpen(open){
  $('rallyMode')?.classList.toggle('more-open',open);$('rallyMoreSheet')?.setAttribute('aria-hidden',String(!open));$('rallyMoreButton')?.setAttribute('aria-expanded',String(open));
  if(open){$('rallyMode')?.classList.remove('journal-open');$('rallyJournalSheet')?.setAttribute('aria-hidden','true');setIntelSheetOpen(false);markRallyNavigation('more');renderStorageAndProjects().catch(error=>setStatus(`Storage status unavailable: ${error.message}`,true));}
  else if(!$('rallyMode')?.classList.contains('journal-open')&&!$('intelSheet')?.classList.contains('open'))markRallyNavigation('mission');
}
function showMissionSurface(){setRallyMoreOpen(false);setRallyJournalOpen(false);setIntelSheetOpen(false);markRallyNavigation('mission');}
async function addRiderObservation(){
  if(rejectRallyMutationWhileQuiesced('add a rider observation'))return;
  const observation=String(prompt('Rider observation, mechanical note, fuel note, or memory')||'').trim();if(!observation)return;
  await appendRallyJournalEvent('rider_observation',currentCheckpoint(),{eventIdentity:`rider-observation:${uid()}`,title:'Rider Observation',summary:observation,dayNumber:activeRallyDay()});await renderRallyJournal();setStatus('Rider observation added to the Journal.');
}
const formatStorageBytes=value=>{const amount=Number(value)||0;if(amount<1024)return `${amount} B`;if(amount<1048576)return `${(amount/1024).toFixed(1)} KB`;if(amount<1073741824)return `${(amount/1048576).toFixed(1)} MB`;return `${(amount/1073741824).toFixed(1)} GB`;};
async function renderStorageAndProjects(){
  if(!missionStorage||!projectLifecycle)return;
  const [estimate,projects]=await Promise.all([missionStorage.estimate(state.project.projectId),projectLifecycle.listProjects()]),summary=$('rallyStorageSummary'),select=$('rallyProjectSelect');
  if(summary)summary.innerHTML=`<strong>Browser storage: ${estimate.actualUsageBytes===null?'Unavailable':formatStorageBytes(estimate.actualUsageBytes)}${estimate.actualQuotaBytes===null?' / quota unavailable':` of ${formatStorageBytes(estimate.actualQuotaBytes)}`}</strong><small>Preferred mission-media budget: ${formatPreferredMissionMediaBudget(estimate.preferredMissionMediaBudgetBytes)} (planning target, not guaranteed capacity)</small><small>Current project: ${estimate.projectPhotoCount} originals / ${estimate.pairCount} complete paired captures · ${formatStorageBytes(estimate.projectMediaSize)} · Estimated remaining paired captures: ${estimate.estimatedRemainingCapturePairs??'Unavailable'} · Persistent storage: ${escapeHtml(String(estimate.persistence?.status||'unsupported').replace(/-/g,' '))} · Unresolved failures: ${estimate.unresolvedFailures}</small>${estimate.warningLevel==='critical'?'<b class="storage-critical">Storage critically low. Export now; captures may fail.</b>':estimate.warningLevel==='warning'?'<b>Storage is nearing the configured warning threshold.</b>':''}`;
  if(select){select.innerHTML=projects.map(project=>`<option value="${escapeHtml(project.projectId)}" ${project.projectId===state.project.projectId?'selected':''}>${escapeHtml(project.name)}${project.lifecycleStatus==='archived'?' (Archived)':''}</option>`).join('');}
  const completed=Object.values(rallyExecution().sessions||{}).filter(session=>session?.status===RALLY_SESSION_STATUS.COMPLETED),backups=state.settings.mediaBackups||{},unbacked=completed.filter(session=>!backups[session.sessionId]&&!(session.legacy&&backups[session.dayNumber]));
  if($('rallyUnbackedDays'))$('rallyUnbackedDays').textContent=unbacked.length?`Unbacked sessions: ${unbacked.map(session=>`Day ${session.dayNumber} Run ${session.runNumber}`).join(', ')}`:`Last successful export: ${state.settings.lastMediaExportAt?new Date(state.settings.lastMediaExportAt).toLocaleString():'None recorded'}`;
}
async function retryFailedEvidence(){
  if(mediaRecoveryTask)return mediaRecoveryTask;
  if(rallyScopeSuspended||showRallySessionChoice())return setStatus('Choose or resume a rally session before retrying Evidence.',true);
  const promise=(async()=>{const session=currentRallySession({matchActiveDay:false});if(!session||acceptedRallySessionId!==session.sessionId)return setStatus('Choose a rally session before retrying Evidence.',true);
    const failed=(await missionMedia.listProjectPhotos(state.project.projectId)).filter(item=>journalEventMatchesSession(item,session)&&item.role==='original'&&item.evidenceStatus==='failed');if(!failed.length)return setStatus('No failed Evidence images require retry in this session.');
    for(const original of failed){try{const evidence=await photoEvidence.retryEvidence(original.mediaId),sessionId=original.metadata?.sessionId||null;await rallyJournal.appendEventIdempotent({eventId:stableUuid(`${original.mediaId}:${sessionId||'legacy'}:evidence-retried`),projectId:original.projectId,sessionId,eventType:'media_recovered',source:'mission_control',title:'Evidence Image Recovered',summary:evidence.name,references:{checkpointId:original.checkpointId,sessionId,originalMediaId:original.mediaId,evidenceMediaId:evidence.mediaId},metadata:{dayNumber:original.metadata?.dayNumber,sessionId,sessionRunNumber:original.metadata?.sessionRunNumber??null,sessionCalendarDate:original.metadata?.sessionCalendarDate??null,status:'evidence_complete',recoveryAction:'retry_evidence_generation'}});}catch(error){setStatus(`Evidence retry remains unresolved: ${error.message}`,true);return;}}
    await renderStorageAndProjects();setStatus('Failed Evidence images were regenerated at native dimensions. Objective completion remains a separate rider action.');})();
  mediaRecoveryTask=promise;try{return await promise;}finally{if(mediaRecoveryTask===promise)mediaRecoveryTask=null;}
}
function loadPersistedRestoredDayReview(){
  const value=state.settings.restoredDayReview,day=Number(value?.dayNumber);restoredDayReview=value&&String(value.projectId)===String(state.project.projectId)&&Number.isInteger(day)?{projectId:state.project.projectId,dayNumber:day,recoveryCopy:Boolean(value.recoveryCopy)}:null;if(restoredDayReview)state.settings.dayFilter=String(day);return restoredDayReview;
}
function contextualGpsLabel(){
  if(state.gpsWatchId===null)return 'GPS OFF';
  const accuracy=Number(state.lastGpsPosition?.accuracyFeet);
  if(!Number.isFinite(accuracy))return 'GPS WAITING';
  const maximum=Math.max(25,Number(state.settings.checkpointMaxAccuracy)||200);
  return accuracy>maximum?`GPS POOR · ±${Math.round(accuracy)} ft`:'GPS ✓';
}
function objectiveTrailIntel(next){
  const objective=next?.geometry?.coordinates?.[0];if(!objective)return '';
  const activity=buildTargetActivity(state.project.competitors||[],next),recent=mergeRecentTargetActivity(state.project.recentTargetActivity,activity).filter(item=>String(item.objectiveId)===String(next.id));
  if(recent.length){const counts=recent.reduce((all,item)=>(all[item.state]=(all[item.state]||0)+1,all),{}),parts=[];if(counts['approaching-target'])parts.push(`${counts['approaching-target']} approaching`);if(counts['stopped-near-target'])parts.push(`${counts['stopped-near-target']} stopped near target`);if(counts['passed-target-vicinity'])parts.push(`${counts['passed-target-vicinity']} passed vicinity`);if(counts['departed-target'])parts.push(`${counts['departed-target']} departed`);if(parts.length)return parts.join(' · ');}
  const now=Date.now(),radius=1609.344,freshWindow=Math.max(5,Number(state.settings.competitorFreshMinutes)||15)*60000,cutoff=now-freshWindow;
  let nearby=0,recentTrails=0,newest=0;
  for(const rider of state.project.competitors||[]){
    const points=competitorTacticalProjection(rider,{now}).tactical.points,last=points.at(-1);if(last&&haversine(last,objective)<=radius)nearby++;
    let riderRecent=false;for(let index=points.length-1;index>=0;index--){const point=points[index],time=Date.parse(point.time||point.timestamp||point.updatedAt||'');if(Number.isFinite(time)&&time<cutoff)break;if(Number.isFinite(time)&&haversine(point,objective)<=radius){riderRecent=true;newest=Math.max(newest,time);}}
    if(riderRecent)recentTrails++;
  }
  if(!nearby&&!recentTrails)return '';
  const age=newest?Math.max(0,Math.round((now-newest)/60000)):null;
  return `${nearby} rider${nearby===1?'':'s'} near objective · ${recentTrails} recent trail${recentTrails===1?'':'s'} within 1 mi${age===null?'':` · Newest activity ${age} min ago`}`;
}
function rallyEmptyState(rows,dayState,reviewMode){
  const day=activeRallyDay();
  if(reviewMode)return {label:'RECOVERY REVIEW',guidance:`Day ${day} Complete · Read-only`};
  if(dayState.status==='complete')return dayState.nextDay?{label:'DAY COMPLETE',guidance:'Review Day · Prepare Next Day'}:{label:'RALLY COMPLETE',guidance:'View Debrief'};
  const allCheckpoints=state.project.features.filter(feature=>['checkpoint','hotel'].includes(feature.type));
  if(!allCheckpoints.length)return {label:'NO CHECKPOINTS LOADED',guidance:'Select or import a project in Planner'};
  if(!rows.length)return {label:'PROJECT NOT READY',guidance:`No checkpoints assigned to Day ${day}`};
  if(rows.every(feature=>feature.status==='deferred'||feature.status==='skipped'||feature.status==='unreachable'))return {label:'ALL REMAINING CHECKPOINTS DEFERRED',guidance:'Resume Deferred · Finish Day'};
  return {label:'PROJECT NOT READY',guidance:'Review checkpoint state in Planner'};
}
function loadSettingsForProject(projectId,base=state.settings){
  try{const key=`${SETTINGS_KEY}.${projectId}`,migration=migrateRallyFeedDefaults(JSON.parse(localStorage.getItem(key)||'{}'));if(migration.changed)localStorage.setItem(key,JSON.stringify(migration.settings));return Object.assign({},base,migration.settings);}catch(_){return Object.assign({},base);}
}
function persistCurrentSettings(){localStorage.setItem(`${SETTINGS_KEY}.${state.project.projectId}`,JSON.stringify(preserveExplicitRallyFeedSettings(state.settings)));}
async function enterRestoredDayReview(payload,{persist=true}={}){
  const result=payload.verification;restoredDayReview={projectId:result.projectId,dayNumber:result.dayNumber,recoveryCopy:Boolean(payload.recoveryCopy)};state.settings.restoredDayReview=deepClean(restoredDayReview);state.settings.dayFilter=String(result.dayNumber);resetRallySessionSelection();if(persist)persistCurrentSettings();if($('dayFilter'))$('dayFilter').value=String(result.dayNumber);renderAll();fitMap();rallyDebug.record('restore_review_day_selected',{projectId:result.projectId,dayNumber:result.dayNumber,recoveryCopy:Boolean(payload.recoveryCopy)});
}
async function switchProject(projectId,{recordOpen=true,mutationToken=null}={}){
  const mutation=acquireProjectMutation('switch Projects',mutationToken);if(!mutation)return null;
  const ownsScopeSuspension=!rallyScopeSuspended;
  try{
  if(ownsScopeSuspension)await suspendPendingEvidenceRuntime('project-switch');restoredDayReview=null;lastRestoreResult=null;
  await releaseRallyAnalyticsProjectScope('project-switch');
  const project=await projectLifecycle.openProject(projectId);activeLifecycleProjectId=project.projectId;state.project=sanitizeProjectData(project,'project switch');
  state.settings=loadSettingsForProject(project.projectId,defaultProjectSettings||state.settings);
  state.settings.preferredCamera=normalizeCameraPreference(state.settings.preferredCamera);loadPersistedRestoredDayReview();applyCameraPreference();
  weatherMaintenance=createProjectWeatherMaintenance();weatherMaintenance.restore();clearSelection();rallyExecution();resetRallySessionSelection();await bindRallyAnalyticsToActiveProject();if(ownsScopeSuspension)resumeRallyScopeRuntime('project-switch-complete');renderAll();fitMap();if(recordOpen&&!restoredDayReview)await appendRallyJournalEvent('project_opened',null,{eventIdentity:`project-opened:${project.projectId}:${Date.now()}`,sessionScope:false,title:`Project Opened · ${project.name}`});await renderStorageAndProjects();if(activeRallyDay())await refreshDayPreflight();setStatus(`Opened ${project.name}. Choose Resume Existing or Start New before riding.`);
  }finally{if(ownsScopeSuspension&&rallyScopeSuspended)resumeRallyScopeRuntime('project-switch-recovered');mutation.release();}
}
async function createIndependentProject({mutationToken=null}={}){
  const mutation=acquireProjectMutation('create a Project',mutationToken);if(!mutation)return;
  const ownsScopeSuspension=!rallyScopeSuspended;
  try{
  const name=prompt('New project name');if(!String(name||'').trim())return;
  if(ownsScopeSuspension)await suspendPendingEvidenceRuntime('new-project');await saveProject(false);await releaseRallyAnalyticsProjectScope('new-project');const now=new Date().toISOString(),projectId=uid(),project=await projectLifecycle.createProject({projectId,id:projectId,version:APP_VERSION,name:String(name).trim(),createdAt:now,updatedAt:now,features:[],competitors:[]},{activate:true});
  activeLifecycleProjectId=project.projectId;state.project=sanitizeProjectData(project,'new project');state.settings=Object.assign({},defaultProjectSettings||state.settings,RALLY_FEED_DEFAULTS,{rallyFeedDefaultRevision:RALLY_FEED_DEFAULT_REVISION,dayFilter:'all'});weatherMaintenance=createProjectWeatherMaintenance();clearSelection();rallyExecution();resetRallySessionSelection();await bindRallyAnalyticsToActiveProject();if(ownsScopeSuspension)resumeRallyScopeRuntime('new-project-complete');renderAll();fitMap();await renderStorageAndProjects();setStatus(`Created ${project.name}.`);
  }finally{if(ownsScopeSuspension&&rallyScopeSuspended)resumeRallyScopeRuntime('new-project-recovered');mutation.release();}
}
async function renameActiveProject({mutationToken=null}={}){const mutation=acquireProjectMutation('rename a Project',mutationToken);if(!mutation)return;try{const name=prompt('Project name',state.project.name);if(!String(name||'').trim())return;state.project=await projectLifecycle.renameProject(state.project.projectId,name);state.project=await projectLifecycle.saveActiveProject(state.project);renderAll();await renderStorageAndProjects();setStatus(`Renamed project to ${state.project.name}.`);}finally{mutation.release();}}
async function archiveActiveProject({mutationToken=null}={}){
  const mutation=acquireProjectMutation('archive a Project',mutationToken);if(!mutation)return;
  try{if(!confirm(`Archive ${state.project.name}? Its Journal and full-resolution photos remain stored and exportable.`))return;
  const id=state.project.projectId;await suspendPendingEvidenceRuntime('project-archive');await releaseRallyAnalyticsProjectScope('project-archive');await projectLifecycle.archiveProject(id);const next=(await projectLifecycle.listProjects()).find(project=>project.lifecycleStatus!=='archived');
  if(next)await switchProject(next.projectId,{mutationToken:mutation.token});else await createIndependentProject({mutationToken:mutation.token});}finally{if(rallyScopeSuspended)resumeRallyScopeRuntime('project-archive-recovered');mutation.release();}
}
async function deleteActiveProject({mutationToken=null}={}){
  const mutation=acquireProjectMutation('delete a Project',mutationToken);if(!mutation)return;
  try{const id=state.project.projectId,name=state.project.name;if(!confirm(`Permanently delete ${name}? This removes its execution state, Journal, analytics, search data, and locally stored media from this device.`))return;
  if(prompt(`Type DELETE to confirm deletion of ${name}.`)!=='DELETE')return;await suspendPendingEvidenceRuntime('project-delete');await releaseRallyAnalyticsProjectScope('project-delete');await projectLifecycle.deleteProject(id);const next=(await projectLifecycle.listProjects()).find(project=>project.lifecycleStatus!=='archived');if(next)await switchProject(next.projectId,{mutationToken:mutation.token});else await createIndependentProject({mutationToken:mutation.token});}finally{if(rallyScopeSuspended)resumeRallyScopeRuntime('project-delete-recovered');mutation.release();}
}
function finalizationReportHtml(report,manifest=null){const counts=report.counts||manifest?.counts||{},errors=report.errors||[],warnings=report.warnings||[];return `<dl><dt>Project</dt><dd>${escapeHtml(manifest?.projectName||state.project.name)}</dd><dt>Days</dt><dd>${counts.days||0}</dd><dt>Checkpoints</dt><dd>${counts.checkpoints||0}</dd><dt>Hotels</dt><dd>${counts.hotels||0}</dd><dt>Routes</dt><dd>${counts.routes||0}</dd><dt>Tracks</dt><dd>${counts.tracks||0}</dd>${manifest?`<dt>Package version</dt><dd>${manifest.packageVersion}</dd><dt>Finalized</dt><dd>${escapeHtml(new Date(manifest.finalizedAt).toLocaleString())}</dd><dt>Integrity</dt><dd>Verified</dd>`:''}</dl>${errors.length?`<h3>Errors</h3><ul>${errors.map(item=>`<li>${escapeHtml(item.message)}</li>`).join('')}</ul>`:''}${warnings.length?`<h3>Warnings</h3><ul>${warnings.map(item=>`<li>${escapeHtml(item.message)}</li>`).join('')}</ul>`:''}`;}
async function finalizeProjectPlan(){
  try{await saveProject(false);const report=await finalizedProjects.validate(state.project,state.settings);if(!report.valid){$('finalizedProjectReport').innerHTML=finalizationReportHtml(report);pendingFinalizedMasterId=null;$('createExecutionCopyButton').hidden=true;$('finalizedProjectDialog').showModal();return setStatus(`Finalization blocked by ${report.errors.length} validation error(s).`,true);}if(report.warnings.length&&!confirm(`Finalization found ${report.warnings.length} warning(s). Continue without changing the planned order?`))return;pendingFinalizedExport=await finalizedProjects.exportFinalized(state.project,state.settings);$('exportFinalizedProjectButton').disabled=false;$('finalizedProjectReport').innerHTML=finalizationReportHtml(report,pendingFinalizedExport.manifest);$('createExecutionCopyButton').hidden=true;$('finalizedProjectDialog').showModal();setStatus('Finalized master created. Use Export Finalized Project to transfer it.');}catch(error){setStatus(`Finalization failed: ${error.message}`,true);}
}
function exportFinalizedProject(){if(!pendingFinalizedExport)return setStatus('Finalize the Project before exporting.',true);downloadBlob(pendingFinalizedExport.blob,pendingFinalizedExport.filename,'application/zip');setStatus(`Exported immutable finalized plan: ${pendingFinalizedExport.filename}`);}
async function importFinalizedProject(file){
  if(!file)return;try{const result=await finalizedProjects.importMaster(file);pendingFinalizedMasterId=result.masterId;$('finalizedProjectReport').innerHTML=finalizationReportHtml(result.currentValidation,result.manifest);$('createExecutionCopyButton').hidden=false;$('finalizedProjectDialog').showModal();setStatus(`${result.manifest.projectName} verified as an immutable finalized master.`);}catch(error){pendingFinalizedMasterId=null;setStatus(`Finalized Project import rejected: ${error.message}`,true);}
}
async function createActiveExecutionCopy({mutationToken=null}={}){const mutation=acquireProjectMutation('create an execution copy',mutationToken);if(!mutation)return;try{if(!pendingFinalizedMasterId)return;await suspendPendingEvidenceRuntime('execution-copy-create');await releaseRallyAnalyticsProjectScope('execution-copy-create');const project=await finalizedProjects.createExecutionCopy(pendingFinalizedMasterId,{activate:true});activeLifecycleProjectId=project.projectId;state.project=sanitizeProjectData(project,'finalized execution copy');state.settings=Object.assign({},defaultProjectSettings||state.settings,preserveExplicitRallyFeedSettings(project.settings||{}));weatherMaintenance=createProjectWeatherMaintenance();rallyExecution();resetRallySessionSelection();await bindRallyAnalyticsToActiveProject();resumeRallyScopeRuntime('execution-copy-create-complete');renderAll();fitMap();$('finalizedProjectDialog').close();await renderStorageAndProjects();setStatus(`Created active execution copy of ${project.name}. The finalized master remains unchanged.`);}finally{if(rallyScopeSuspended)resumeRallyScopeRuntime('execution-copy-create-recovered');mutation.release();}}
function createProjectWeatherMaintenance(){
  const projectId=state.project.projectId||'legacy',storage={getItem:key=>localStorage.getItem(`${key}.${projectId}`),setItem:(key,value)=>localStorage.setItem(`${key}.${projectId}`,value)};
  return createWeatherMaintenance({fetchWeather:fetchWeatherContext,storage,distanceMeters:haversine,onContext:applyWeatherContext});
}
async function restoreProjectPackage(file,{mutationToken=null}={}){
  const mutation=acquireProjectMutation('restore another Project package',mutationToken);if(!mutation)return;
  try{
    if(!file)return;
    if(!/\.cmapproject$/i.test(file.name))return await openProjectFile(file,{mutationToken:mutation.token});
    const payload=await journeyRestore.restore(file);localStorage.setItem(`${SETTINGS_KEY}.${payload.project.projectId}`,JSON.stringify(preserveExplicitRallyFeedSettings(payload.settings||{})));await switchProject(payload.project.projectId,{mutationToken:mutation.token});setStatus(`Restored ${payload.project.name} with ${payload.manifest.mediaCount} full-resolution media records.`);
  }catch(error){setStatus(`Project restore failed without partial changes: ${error.message}`,true);}finally{mutation.release();}
}
function activateNextPlannedCheckpoint(){const next=checkpoints.activateNextPlanned(dayCheckpoints());if(next)state.selectedId=next.id;return next;}
function ensureNextCheckpoint(){
  if(rallyDayState(activeRallyDay()).status==='complete')return null;
  if(dayCheckpoints().some(feature=>feature.status===checkpoints.CHECKPOINT_STATE.ACTIVE))return currentCheckpoint();
  const next=activateNextPlannedCheckpoint();if(next){saveProject(false);rallyDebug.record('objective_selected',{objectiveId:next.id,day:activeRallyDay(),reason:'next-upcoming'});}return next;
}
async function missionControlAppendTestPhotoReference({checkpointId,originalMediaId,evidenceMediaId}){
  const checkpoint=state.project.features.find(feature=>feature.id===checkpointId)||(checkpointId?null:currentCheckpoint());if(!checkpoint||!rallyJournal)throw new Error('Checkpoint Journal is unavailable.');
  const session=currentRallySession(),sessionId=session?.sessionId||null;return rallyJournal.appendEvent({eventId:uid(),projectId:state.project.projectId,sessionId,timestamp:new Date().toISOString(),eventType:'photo_added',source:'field_test',title:`Photo · ${checkpoint.name}`,summary:'Reference reconciliation test.',metadata:{checkpointId:checkpoint.id,dayNumber:Number(checkpoint.day)||null,sessionId},references:{checkpointId:checkpoint.id,sessionId,originalMediaId,evidenceMediaId,mediaGroupId:uid()},attachments:{}});
}
function checkpointDiagnostic(checkpoint,priorState,newState,distanceFeet,radius,accuracyFeet,decision,rejectionReason=''){
  rallyDebug.record('checkpoint_collection_decision',{checkpointId:checkpoint?.id||null,priorState,newState,activeObjectiveId:currentCheckpoint()?.id||null,
    distanceFeet:Number.isFinite(distanceFeet)?Math.round(distanceFeet):null,collectionRadiusFeet:radius,gpsAccuracyFeet:Number.isFinite(accuracyFeet)?Math.round(accuracyFeet):null,decision,rejectionReason});
}
function evaluateCheckpointArrival(accuracyFeet){
  if(rallyScopeSuspended||restoredDayReview||state.settings.autoCompleteCheckpoints===false||!activeRallyDay()||!checkpointArrivalCoordinator)return;
  if(showRallySessionChoice()||!currentRallySession()||acceptedRallySessionId!==currentRallySessionId())return;
  if(showDayPreflight())return;
  if(rallyDayState(activeRallyDay()).status==='complete')return;
  const active=ensureNextCheckpoint(),scope=rallyScopeSnapshot(),radius=Math.max(100,Number(state.settings.checkpointArrivalRadius)||500),maxAccuracy=Math.max(25,Number(state.settings.checkpointMaxAccuracy)||200),speedMph=Number.isFinite(Number(state.lastGpsPosition?.speedMps))?Number(state.lastGpsPosition.speedMps)*2.23694:null;
  const rows=dayCheckpoints(),detections=rows.filter(checkpoint=>{
    if(checkpoint.type==='hotel')return checkpoint.id===active?.id;
    return [checkpoints.CHECKPOINT_STATE.UPCOMING,checkpoints.CHECKPOINT_STATE.ACTIVE,checkpoints.CHECKPOINT_STATE.DEFERRED].includes(checkpoints.checkpointState(checkpoint.status));
  }).map(checkpoint=>{
    const distance=distanceFromCurrent(checkpoint);return {checkpointId:checkpoint.id,checkpoint,distanceFeet:distance===null?null:distance*5280,accuracyFeet,radiusFeet:radius,maxAccuracyFeet:maxAccuracy,eligible:true,collected:false,metadata:{rallyScopeToken:scope.token,projectId:scope.projectId,dayNumber:scope.dayNumber,sessionId:scope.sessionId}};
  });
  const observedAt=Date.now(),gpsEvidence=captureArrivalEvidence(state.lastGpsPosition,observedAt),result=checkpointArrivalCoordinator.observe({detections,observedAt,speedMph,priorTargetId:active?.id||null,gpsEvidence});
  for(const arrival of result.accepted){const checkpoint=state.project.features.find(feature=>feature.id===arrival.checkpointId);checkpointDiagnostic(checkpoint,checkpoint?.status,checkpoint?.photoRequired?checkpoints.CHECKPOINT_STATE.PHOTO_REQUIRED:checkpoints.CHECKPOINT_STATE.COLLECTED,arrival.distanceFeet,radius,accuracyFeet,'accepted',arrival.outOfOrder?'out-of-order':'');}
}
function activeNavigationLine(){
  const day=activeRallyDay(),priority={route:0,track:1,backbone:2},line=(state.project.features||[]).filter(feature=>day&&Number(feature.day)===day&&feature.visible!==false&&feature.geometry?.kind==='line'&&priority[feature.type]!==undefined).sort((a,b)=>priority[a.type]-priority[b.type]||(Number(a.sequence)||0)-(Number(b.sequence)||0))[0];
  if(!line)return null;const projectId=state.project.projectId||null;if(navigationRouteCache?.projectId===projectId&&navigationRouteCache?.id===line.id&&navigationRouteCache?.updatedAt===line.updatedAt)return navigationRouteCache;
  const points=line.geometry.coordinates||[];navigationRouteCache={projectId,id:line.id,updatedAt:line.updatedAt,points,turns:inferSignificantRouteTurns(points)};return navigationRouteCache;
}
function navigationZoomForPosition(position){
  const line=activeNavigationLine(),next=currentCheckpoint(),point=next?.geometry?.coordinates?.[0],routePoints=line?.points||[];
  let currentRouteIndex=-1,best=Infinity;routePoints.forEach((routePoint,index)=>{const distance=haversine(position,routePoint);if(distance<best){best=distance;currentRouteIndex=index;}});
  const focus=selectNavigationFocus({position,checkpoint:next?{...next,point}:null,routePoints,routeTurns:line?.turns||[],currentRouteIndex}),decision=decideNavigationZoom({focus,currentZoom:state.map?.getZoom?.(),previous:navigationZoomState,now:Date.now()});navigationZoomState=decision;
  return {targetZoom:decision.zoom,zoomReason:`${focus.kind}:${decision.reason}`,focus};
}
function deepestCameraCause(error){let current=error,depth=0;const seen=new Set();while(current?.cause&&depth<6&&!seen.has(current.cause)){seen.add(current);current=current.cause;depth++;}return current||error;}
function cameraFailureDetails(error){const cause=deepestCameraCause(error);return {exceptionName:error?.name||'Error',exceptionCode:error?.code||null,exceptionMessage:error?.message||String(error),causeName:cause?.name||null,causeCode:cause?.code||null,causeMessage:cause?.message||null};}
function cameraFallbackReason(error){const readiness=error instanceof AutomaticCameraNotReadyError?error.readinessState:cameraReadinessState();return readiness?.reasonCode||String(deepestCameraCause(error)?.code||deepestCameraCause(error)?.name||'automatic-capture-failed').toLowerCase().replaceAll('_','-');}

async function persistDetectedCheckpointArrival(arrival){
  const scopeToken=arrival?.evidence?.metadata?.rallyScopeToken;
  if(!rallyScopeMatches(scopeToken))throw new Error('Checkpoint arrival belongs to an inactive Rally scope.');
  const project=state.project,projectId=String(project.projectId||project.id||'current'),session=currentRallySession(),checkpoint=project.features.find(feature=>feature.id===arrival.checkpointId),day=activeRallyDay();
  if(!session||arrival?.evidence?.metadata?.sessionId!==session.sessionId)return {ignored:true,reason:'session-mismatch',scopeToken,checkpointId:arrival.checkpointId};
  if(!checkpoint||Number(checkpoint.day)!==day||[checkpoints.CHECKPOINT_STATE.COLLECTED,checkpoints.CHECKPOINT_STATE.FAILED,checkpoints.CHECKPOINT_STATE.UNAVAILABLE].includes(checkpoints.checkpointState(checkpoint.status)))return {ignored:true,scopeToken,checkpointId:arrival.checkpointId};
  const priorTarget=state.project.features.find(feature=>feature.id===arrival.priorTargetId&&feature.id!==checkpoint.id&&feature.status===checkpoints.CHECKPOINT_STATE.ACTIVE)||null;
  snapshot();recordAuthoritativeCheckpointArrival(checkpoint,{...arrival,priorTargetId:priorTarget?.id||null});
  if(checkpoint.type==='hotel')checkpoints.recordArrival(checkpoint,arrival.detectedAtIso);else checkpoints.recordDetectedArrival(checkpoint,arrival.detectedAtIso);
  let routeTarget=priorTarget;
  if(checkpoint.photoRequired){routeTarget=checkpoints.advanceRouteAfterDetectedArrival(dayCheckpoints(),checkpoint)||priorTarget;if(routeTarget)state.selectedId=routeTarget.id;upsertCheckpointPendingEvidence(checkpoint,{at:arrival.detectedAtIso});}
  // Start both durable writes before media work. All accepted nearby arrivals
  // reach this point immediately, even while an earlier capture is still open.
  const journalWrite=appendRallyJournalEvent('checkpoint_arrival',checkpoint,arrivalJournalMetadata(checkpoint,{...arrival,priorTargetId:priorTarget?.id||null}),arrival.detectedAtIso),projectWrite=saveProject(false);
  const [arrivalEvent]=await Promise.all([journalWrite,projectWrite]);
  if(!rallyScopeMatches(scopeToken))return {ignored:true,reason:'scope-changed',scopeToken,projectId,dayNumber:day,checkpointId:checkpoint.id,arrivalEvent};
  rallyDebug.record('checkpoint_detected',{checkpointId:checkpoint.id,outOfOrder:arrival.outOfOrder,priorTargetId:priorTarget?.id||null,speedMph:arrival.speedMph,arrivalPersistedBeforeMedia:true});
  return {ignored:false,scopeToken,projectId,sessionId:session.sessionId,dayNumber:day,checkpointId:checkpoint.id,priorTargetId:priorTarget?.id||null,routeTargetId:routeTarget?.id||null,arrivalEvent};
}

async function processDetectedCheckpointArrival(arrival,persisted){
  if(persisted?.ignored)return;
  const scopeToken=persisted?.scopeToken||arrival?.evidence?.metadata?.rallyScopeToken;if(!rallyScopeMatches(scopeToken))return;
  const checkpoint=state.project.features.find(feature=>feature.id===arrival.checkpointId),day=activeRallyDay();
  if(!checkpoint||Number(checkpoint.day)!==day||[checkpoints.CHECKPOINT_STATE.COLLECTED,checkpoints.CHECKPOINT_STATE.FAILED,checkpoints.CHECKPOINT_STATE.UNAVAILABLE].includes(checkpoints.checkpointState(checkpoint.status)))return;
  const priorTarget=state.project.features.find(feature=>feature.id===(persisted?.priorTargetId||arrival.priorTargetId)&&feature.id!==checkpoint.id&&feature.status===checkpoints.CHECKPOINT_STATE.ACTIVE)||null,arrivalEvent=persisted?.arrivalEvent;
  if(!arrivalEvent)return;
  if(!checkpoint.photoRequired){
    await completeCurrentCheckpoint(true,{checkpoint,preserveActiveTarget:Boolean(priorTarget),silent:true,scopeToken});
    return;
  }
  if(pendingPhotoCheckpointId&&pendingPhotoCheckpointId!==checkpoint.id){
    await preserveQueuedPhotoEvidence(checkpoint,{reasonCode:'camera-workflow-busy',failureReason:`Photo recovery for ${pendingPhotoCheckpointId} is still pending; this arrival was queued independently.`});
    return;
  }
  let workflow=null;
  try{
    if(!rallyScopeMatches(scopeToken))return;
    ({workflow}=await beginPhotoWorkflow(checkpoint,true,{arrivalEvent,visibility:'silent',captureKind:checkpoint.type==='hotel'?'hotel':'checkpoint'}));
    if(!rallyScopeMatches(scopeToken))return;
    pendingMediaObjective={checkpointId:checkpoint.id,priorTargetId:priorTarget?.id||null,captureKind:checkpoint.type==='hotel'?'hotel':'checkpoint',mode:'automatic',arrival};
    await captureAutomaticPair(checkpoint,arrivalEvent,workflow);
    if(!rallyScopeMatches(scopeToken))return;
    await finalizePendingPhotoCheckpoint({scopeToken});
  }catch(error){
    if(!rallyScopeMatches(scopeToken))return;
    workflow=workflow||((pendingPhotoCheckpointId===checkpoint.id&&checkpointCamera?.getState?.()?.status!=='idle')?checkpointCamera.getState():null);
    let partial=error instanceof PairedMediaCaptureError?error.partial:{};const disposition=checkpoints.captureFailureDisposition(arrival.speedMph),failedPairId=workflow?.pairId||checkpoint.pendingPhotoPair?.pairId||null,requestedCamera=error?.failedSide==='rider'?'front':error?.failedSide==='road'?'rear':null;
    if(isNativeCameraCaptureFailure(error)&&!automaticCaptureOverride){cameraSession?.stop(requestedCamera,'capture-failure-recovery');await cameraReadiness?.noteCaptureFailure?.(error?.cause||error,{requestedCamera});}
    if(!rallyScopeMatches(scopeToken))return;
    const failure=cameraFailureDetails(error),fallbackReason=cameraFallbackReason(error),readiness=cameraReadinessState();
    rallyDebug.record('camera_failure',{checkpointId:checkpoint.id,pairId:failedPairId,failedSide:error?.failedSide||null,speedMph:arrival.speedMph,disposition,fallbackReason,permission:readiness.permission,capability:readiness.capability,...failure});
    rallyDebug.record('camera_fallback_selected',{checkpointId:checkpoint.id,reason:fallbackReason,disposition,speedMph:arrival.speedMph,permission:readiness.permission,capability:readiness.capability});
    await appendFailureJournalBestEffort('camera_failure',checkpoint,{eventIdentity:`camera-failure:${checkpoint.id}:${arrival.detectedAt}`,pairId:failedPairId,failedSide:error?.failedSide||null,speedAtFailureMph:arrival.speedMph,captureStatus:disposition,fallbackReason,permissionState:readiness.permission,cameraCapability:readiness.capability,partialRoadCaptured:Boolean(partial.road),partialRiderCaptured:Boolean(partial.rider),preservedOriginalMediaId:error?.recoverableOriginal?.mediaId||null,evidenceRetryable:Boolean(error?.evidenceRetryable),...failure});
    if(!rallyScopeMatches(scopeToken))return;
    if(disposition==='camera_unavailable_high_speed'){
      await preserveIncompletePhotoEvidence(checkpoint,{state:failurePhotoState({readiness,partial,error}),reasonCode:disposition,failureReason:error?.message||'Automatic camera capture was unavailable while moving.',pairId:failedPairId,priorTargetId:priorTarget?.id||null,source:'automatic_camera'});
      if(!rallyScopeMatches(scopeToken))return;
      if(pendingPhotoCheckpointId===checkpoint.id){checkpointCamera.abandon();pendingPhotoCheckpointId=null;pendingMediaObjective=null;}
    }else{
      if(error?.requiresNewPair&&workflow){workflow=await restartUnsafeCapturePair(checkpoint,arrivalEvent,checkpoint.type==='hotel'?'hotel':'checkpoint',failedPairId);if(!rallyScopeMatches(scopeToken))return;partial={};}
      if(workflow){
        await preserveIncompletePhotoEvidence(checkpoint,{state:failurePhotoState({readiness,partial,error}),reasonCode:fallbackReason,failureReason:error?.message||String(error),pairId:workflow.pairId,priorTargetId:priorTarget?.id||null,source:'automatic_camera'});
        if(!rallyScopeMatches(scopeToken))return;
        void beginManualFallback(checkpoint,{priorTargetId:priorTarget?.id||null,partial,captureKind:checkpoint.type==='hotel'?'hotel':'checkpoint',speedMph:arrival.speedMph,fallbackReason});
      }else{
        await preserveIncompletePhotoEvidence(checkpoint,{state:failurePhotoState({readiness,partial,error}),reasonCode:fallbackReason,failureReason:error?.message||'Photo workflow initialization failed.',pairId:failedPairId,priorTargetId:priorTarget?.id||null,source:'automatic_camera_setup'});
        if(!rallyScopeMatches(scopeToken))return;
        pendingPhotoCheckpointId=null;pendingMediaObjective=null;setStatus(`Arrival confirmed for ${checkpoint.name}; photo recovery could not start and remains required.`,true);
      }
    }
  }
}
function selectNextCheckpoint(){const rows=dayCheckpoints();snapshot();const next=checkpoints.selectNext(rows);if(next){state.selectedId=next.id;const point=next.geometry.coordinates[0];performProgrammaticMapChange('checkpoint-focus',()=>state.map.setView([point.lat,point.lon],14,{animate:false}));setStatus(`${next.name} is the next checkpoint.`);}else setStatus('No planned checkpoints remain for the active day.');saveProject(false);renderAll();}
async function finalizeDay(checkpoint,{scopeToken=rallyScopeSnapshot().token}={}){
  if(!rallyScopeMatches(scopeToken))return null;
  const project=state.project,day=Number(checkpoint?.day)||activeRallyDay(),rows=dayCheckpoints(),dayState=rallyDayState(day);if(dayState.status==='complete')return dayState;
  const completedRows=rows.filter(item=>item.status===checkpoints.CHECKPOINT_STATE.COLLECTED&&checkpointEvidenceSnapshot(item).completion.state===checkpoints.CHECKPOINT_FINAL_COMPLETION_STATE.COMPLETED);
  await rallyAnalytics?.flush?.();if(!rallyScopeMatches(scopeToken))return null;const completedAt=new Date().toISOString(),summary={
    totalCollected:completedRows.length,
    totalDeferred:rows.filter(item=>item.status===checkpoints.CHECKPOINT_STATE.DEFERRED).length,
    score:completedRows.reduce((total,item)=>total+(Number(checkpointEvidenceSnapshot(item).completion.pointsAwarded)||0),0),distanceTraveledMiles:rallyAnalytics?.snapshot?.()?.metrics?.distanceMiles??null
  };
  dayState.status='complete';dayState.completedAt=completedAt;dayState.nextDay=checkpoints.nextRallyDay(project,day);dayState.summary=summary;
  void screenWakeLock?.stop('day-finished');
  await appendRallyJournalEvent('day_finished',checkpoint,{eventIdentity:`day-finished:${day}`,dayCompletionTimestamp:completedAt,...summary,
    title:`Day ${day} Complete`,summary:`Day finalized${checkpoint?` at ${checkpoint.name}`:''}.`},completedAt);
  if(!rallyScopeMatches(scopeToken))return null;
  await saveProject(false);if(!rallyScopeMatches(scopeToken))return null;rallyDebug.record('day_finalized',{day,nextDay:dayState.nextDay,...summary});rideMemoryCapture?.stop?.('day-complete');automaticBackup?.stop?.();void requestAutomaticBackup(AUTOMATIC_BACKUP_TRIGGER.DAY_COMPLETED);renderAll();return dayState;
}
async function beginPhotoWorkflow(checkpoint,automatic,{arrivalEvent=null,visibility=automatic?'silent':'manual',captureKind=checkpoint?.type==='hotel'?'hotel':'checkpoint'}={}){
  if(restoredDayReview)return setStatus('Completed-day review is read-only.',true);
  if(!checkpointCamera||!rallyJournal)throw new Error('The durable photo and Journal services are unavailable. Reload CannonMap and retry this checkpoint.');
  cameraCaptureArbiter?.cancelMemory?.('checkpoint-workflow-started');
  const evidence=checkpointEvidenceSnapshot(checkpoint),gpsArrival=evidence.arrival.state===checkpoints.CHECKPOINT_ARRIVAL_STATE.CONFIRMED&&evidence.arrival.trustworthy;
  const timestamp=evidence.arrival.timestamp||checkpoint.manualPhotoStartedAt||new Date().toISOString(),captureContext=gpsArrival?evidence.arrival:captureArrivalEvidence(state.lastGpsPosition,Date.parse(timestamp)||Date.now());checkpoint.manualPhotoStartedAt||=gpsArrival?null:timestamp;
  weatherMaintenance?.onArrival({lat:captureContext.latitude??state.lastGpsPosition?.lat,lon:captureContext.longitude??state.lastGpsPosition?.lon}).catch(()=>{});
  const arrival=arrivalEvent||(gpsArrival?
    await appendRallyJournalEvent('checkpoint_arrival',checkpoint,arrivalJournalMetadata(checkpoint,{outOfOrder:false}),evidence.arrival.timestamp):
    await appendRallyJournalEvent('checkpoint_photo_capture_started',checkpoint,{eventIdentity:`photo-capture-started:${checkpoint.id}:${timestamp}`,photoRequired:Boolean(checkpoint.photoRequired),photoEvidenceState:evidence.photo.state,source:'manual_completion_action',title:checkpoint.name,summary:'Rider opened the required photo workflow. No GPS arrival is claimed by this action.'},timestamp));
  applyCameraPreference();pendingPhotoCheckpointId=checkpoint.id;
  const pairState=checkpoint.pendingPhotoPair||{};const workflow=checkpointCamera?.start({projectId:state.project.projectId,checkpoint,journalEvent:arrival,required:Boolean(checkpoint.photoRequired),evidenceContext:photoEvidenceContext(checkpoint,arrival),pairId:pairState.pairId,pairJournalEventId:pairState.pairJournalEventId,visibility,captureKind});
  checkpoint.pendingPhotoPair={pairId:workflow.pairId,pairJournalEventId:workflow.pairJournalEventId,status:'capture_started',missingSides:workflowMissingSides()};
  if(checkpoint.type!=='journey')transitionPhotoEvidenceSafely(checkpoint,checkpoints.CHECKPOINT_PHOTO_EVIDENCE_STATE.CAPTURE_STARTED,{pairId:workflow.pairId,pairJournalEventId:workflow.pairJournalEventId,missingSides:workflowMissingSides(),reasonCode:null});
  await saveProject(false);
  return {arrival,workflow};
}

async function recordMediaAutomationEvent(event,checkpoint,arrivalEvent){
  if(!event?.eventType)return null;
  const details=structuredClone(event);delete details.eventType;delete details.occurredAt;
  try{
    return await appendRallyJournalEvent(event.eventType,checkpoint,{
      eventIdentity:`media:${event.eventType}:${event.pairId||checkpoint.id}:${event.side||''}:${event.occurredAt||core.clock.iso()}`,
      source:'automatic_camera',parentEventId:arrivalEvent?.eventId||null,...details
    },event.occurredAt||core.clock.iso());
  }catch(error){
    rallyDebug.record('camera_automation_journal_failed',{cameraEventType:event.eventType,pairId:event.pairId||null,checkpointId:checkpoint?.id||null,exceptionName:error?.name||'Error',message:error?.message||String(error)});
    return null;
  }
}

async function captureAutomaticPair(checkpoint,arrivalEvent,workflow){
  const run=async({signal:prioritySignal}={})=>{
    if(!automaticCaptureOverride){
      if(cameraReadiness?.state?.().capability==='interrupted'&&cameraReadiness?.state?.().permission==='granted')await cameraReadiness?.prepareAutomaticCapture?.();
      cameraReadiness?.assertAutomaticCaptureEligible?.();
    }
    const controller=new AbortController(),relayAbort=()=>controller.abort(prioritySignal?.reason||new DOMException('Checkpoint camera capture canceled.','AbortError'));if(prioritySignal?.aborted)relayAbort();else prioritySignal?.addEventListener?.('abort',relayAbort,{once:true});automaticCaptureAbortController=controller;
    try{
      const result=await pairedMediaCapture.capturePair({
        signal:controller.signal,projectId:state.project.projectId,checkpointId:checkpoint.id,journalEventId:workflow.pairJournalEventId,
        pairJournalEventId:workflow.pairJournalEventId,pairId:workflow.pairId,context:photoEvidenceContext(checkpoint,arrivalEvent),
        onEvent:event=>recordMediaAutomationEvent(event,checkpoint,arrivalEvent)
      });
      checkpointCamera.restoreSide('rear',result.sides.rear.media);checkpointCamera.restoreSide('front',result.sides.front.media);
      try{await checkpointCamera.finalizeRestoredPair();if(!automaticCaptureOverride)cameraReadiness?.noteCaptureSuccess?.();return result;}
      catch(error){throw new PairedMediaCaptureError('Captured media could not be finalized.',{cause:error,pairId:result.pairId,failedSide:'pair-finalization',failureStage:'pair-finalization',partial:{road:result.road,rider:result.rider}});}
    }finally{prioritySignal?.removeEventListener?.('abort',relayAbort);if(automaticCaptureAbortController===controller)automaticCaptureAbortController=null;}
  };
  return cameraCaptureArbiter?.runCheckpoint?cameraCaptureArbiter.runCheckpoint(run):run({signal:null});
}
function showRestoreResult(payload){
  const result=payload.verification,copy=Boolean(payload.recoveryCopy),complete=String(result.status).toLowerCase()==='complete',dialog=$('restoreResultDialog');if(!dialog)return;
  $('restoreResultTitle').textContent=complete?'DAY BACKUP VERIFIED / RESTORED':`DAY ${result.dayNumber} RESTORED`;$('restoreResultCopy').hidden=!copy;$('restoreResultCopy').textContent=copy?`RECOVERY COPY · ${result.projectName}`:'';
  $('restoreResultSummary').innerHTML=`<dl><dt>Project</dt><dd>${escapeHtml(result.projectName)}</dd><dt>Day</dt><dd>${result.dayNumber}</dd><dt>Status</dt><dd>${escapeHtml(complete?'Complete':String(result.status||'Restored').replace(/_/g,' '))}</dd><dt>Collected</dt><dd>${result.collected}</dd><dt>Deferred</dt><dd>${result.deferred}</dd><dt>Failed</dt><dd>${result.failed}</dd><dt>Score</dt><dd>${result.score}</dd><dt>Journal event count</dt><dd>${result.journalEventCount}</dd><dt>Capture Pair count</dt><dd>${result.pairCount}</dd><dt>Media count</dt><dd>${result.mediaCount}</dd><dt>Integrity</dt><dd>Verified</dd></dl>`;
  $('restoreViewDay').textContent=complete?'VIEW SUMMARY':'RESUME RESTORED DAY';$('restoreSwitchProject').hidden=!complete||!copy;$('restoreSwitchProject').textContent='SWITCH TO RECOVERY COPY';dialog.hidden=false;$('restoreViewDay')?.focus();
}
function hideRestoreResult(){const dialog=$('restoreResultDialog');if(dialog)dialog.hidden=true;}
async function viewRestoredDay(){if(!lastRestoreResult)return;const result=lastRestoreResult.verification,complete=String(result.status).toLowerCase()==='complete';if(complete){showRestoreResult(lastRestoreResult);return setStatus(`Verified completed Day ${result.dayNumber}. Historical state is read-only.`);}const fromProjectId=activeLifecycleProjectId;rallyDebug.record('restore_active_project_switch_started',{fromProjectId,toProjectId:result.projectId});await switchProject(result.projectId,{recordOpen:false});rallyDebug.record('restore_active_project_switch_completed',{fromProjectId,toProjectId:result.projectId});hideRestoreResult();setStatus(`Resumed restored Day ${result.dayNumber}.`);}
async function viewRestoredPhotos(){if(!lastRestoreResult)return;hideRestoreResult();await openPhotoViewer(true);}
async function viewRestoredJournal(){if(!lastRestoreResult)return;const day=lastRestoreResult.verification.dayNumber,events=lastRestoreResult.journal||[];$('restoreJournalTitle').textContent=`Day ${day} Journal · ${events.length} events`;$('restoreJournalContent').textContent=JSON.stringify(events,null,2);$('restoreJournalDialog').showModal();}
async function switchAfterRestore(){if(!lastRestoreResult?.recoveryCopy)return;const result=lastRestoreResult.verification;await switchProject(result.projectId,{recordOpen:false});hideRestoreResult();setStatus(`Switched to recovery copy of completed Day ${result.dayNumber}. Historical state is read-only.`);}
async function restoreDayBackupPackage(file,{mutationToken=null}={}){
  if(!file)return;const mutation=acquireProjectMutation('restore a Day backup',mutationToken);if(!mutation)return;
  let stage='validation',mode='cancel',inspected=null,activeRestoreSuspended=false,activeRestoreAnalyticsReleased=false,activeRestoreProjectId=null,releaseActiveRestoreSaveFence=null,activeRestoreSafeToResume=true;try{
    inspected=await journeyRestore.inspectDay(file);const summary=`${inspected.manifest.projectName||'CannonMap'} · Day ${inspected.manifest.dayNumber}\n${inspected.manifest.journalEventCount} Journal events\n${inspected.manifest.mediaCount} media files`;
    if(!confirm(`Verified day backup:\n\n${summary}\n\nRestore this package?`))return setStatus('Day backup restore canceled.');
    const complete=String(inspected.manifest.dayState?.status||'').toLowerCase()==='complete',projects=await projectLifecycle.listProjects(),exists=projects.some(project=>String(project.projectId)===String(inspected.manifest.projectId));
    if(exists){const replacement=`Project: ${inspected.manifest.projectName}\nDay: ${inspected.manifest.dayNumber}\nCheckpoints: ${inspected.manifest.checkpointStates.length}\nJournal: ${inspected.manifest.journalEventCount} events\nMedia: ${inspected.manifest.mediaCount} files`,options=complete?'VERIFY EXISTING DATA, COPY, REPLACE, or CANCEL':'RESUME, COPY, REPLACE, or CANCEL';const choice=String(prompt(`This Project/day already exists.\n\n${replacement}\n\nChoose ${options}. REPLACE requires another confirmation.`,`CANCEL`)||'CANCEL').trim().toUpperCase();if(choice==='VERIFY'||choice==='VERIFY EXISTING DATA'){lastRestoreResult=await journeyRestore.verifyExistingDay(file);showRestoreResult(lastRestoreResult);return setStatus(`Existing Day ${inspected.manifest.dayNumber} data verified without changes.`);}if(choice==='REPLACE'){if(!confirm(`REPLACE EXISTING DAY ${inspected.manifest.dayNumber}? This destructive action overwrites matching day records.`))return setStatus('Day backup replacement canceled with no changes.');mode='replace';}else if(choice==='COPY')mode='recovery-copy';else if(choice==='RESUME'&&!complete)mode='replace';else return setStatus('Day backup restore canceled with no changes.');}
    else mode=complete?'recovery-copy':'cancel';
    if(mode==='recovery-copy'){rallyDebug.record('restore_copy_started',{sourceProjectId:inspected.manifest.projectId,sourceDay:inspected.manifest.dayNumber});rallyDebug.record('restore_package_identity',{sourceProjectId:inspected.manifest.projectId,sourceDay:inspected.manifest.dayNumber,journalCount:inspected.manifest.journalEventCount,mediaCount:inspected.manifest.mediaCount});}
    const restoringActiveProject=mode==='replace'&&String(inspected.manifest.projectId)===String(activeLifecycleProjectId);
    if(restoringActiveProject){activeRestoreProjectId=String(activeLifecycleProjectId);await suspendPendingEvidenceRuntime('day-backup-restore');activeRestoreSuspended=true;releaseActiveRestoreSaveFence=beginProjectSaveFence('day-backup-restore');await projectSaveQueue;await releaseRallyAnalyticsProjectScope('day-backup-restore');activeRestoreAnalyticsReleased=true;}
    stage='persistence';const payload=await journeyRestore.restoreDay(file,{mode,onProgress:(event,details)=>{stage=event;rallyDebug.record(event,details);}}),projectId=payload.manifest.projectId;localStorage.setItem(`${SETTINGS_KEY}.${projectId}`,JSON.stringify(preserveExplicitRallyFeedSettings(payload.projectMetadata.settings||{})));
    if(!payload.verification?.verified)throw new Error('Restored records did not pass post-write verification.');
    const targetSettings=preserveExplicitRallyFeedSettings(payload.projectMetadata.settings||{});if(complete)targetSettings.restoredDayReview={projectId,dayNumber:payload.verification.dayNumber,recoveryCopy:Boolean(payload.recoveryCopy)};localStorage.setItem(`${SETTINGS_KEY}.${projectId}`,JSON.stringify(targetSettings));
    if(restoringActiveProject){const refreshedProject=projectLifecycle.getActiveProject();if(!refreshedProject||String(refreshedProject.projectId)!==String(projectId))throw new Error('Active Project did not reload after Day restore.');activeLifecycleProjectId=refreshedProject.projectId;state.project=sanitizeProjectData(refreshedProject,'restored Day refresh');rallyExecution();resetRallySessionSelection();await bindRallyAnalyticsToActiveProject();activeRestoreAnalyticsReleased=false;resumeRallyScopeRuntime('day-backup-restore-complete');activeRestoreSuspended=false;renderAll();}
    lastRestoreResult=payload;stage='restore_summary_presented';showRestoreResult(payload);rallyDebug.record('restore_summary_presented',{projectId,dayNumber:payload.verification.dayNumber,activeProjectPreserved:complete});if(payload.recoveryCopy)rallyDebug.record('restore_copy_completed',{projectId,dayNumber:payload.verification.dayNumber});await renderStorageAndProjects();setStatus(`Verified restore: ${payload.verification.projectName} Day ${payload.verification.dayNumber}.${complete?' Current Mission Control project preserved.':''}`);
  }catch(error){if(mode==='recovery-copy')rallyDebug.record('restore_copy_failed',{stage,exceptionName:error?.name||'Error',message:error?.message||String(error)});setStatus(`Day backup restore could not be verified: ${error.message}. No restored session was activated; review durable data before resuming.`,true);}
  finally{
    if(activeRestoreSuspended){try{const refreshedProject=projectLifecycle.getActiveProject();if(refreshedProject&&String(refreshedProject.projectId)===activeRestoreProjectId){activeLifecycleProjectId=refreshedProject.projectId;state.project=sanitizeProjectData(refreshedProject,'Day restore recovery refresh');rallyExecution();resetRallySessionSelection();}else activeRestoreSafeToResume=false;}catch(error){activeRestoreSafeToResume=false;rallyDebug.record('restore_active_project_refresh_failed',{projectId:activeRestoreProjectId,exceptionName:error?.name||'Error',message:error?.message||String(error)});}}
    if(activeRestoreSafeToResume){if(activeRestoreAnalyticsReleased)await bindRallyAnalyticsToActiveProject();if(activeRestoreSuspended&&rallyScopeSuspended)resumeRallyScopeRuntime('day-backup-restore-recovered');releaseActiveRestoreSaveFence?.();mutation.release();}
    else{document.documentElement.dataset.cannonmapRestoreState='paused';setStatus('Day restore could not safely reopen local Project storage. CannonMap remains paused to protect evidence; reload the app before making changes.',true);}
  }
}
async function finalizePendingPhotoCheckpoint({scopeToken=rallyScopeSnapshot().token}={}){
  if(!rallyScopeMatches(scopeToken))return {status:'scope-changed'};
  const checkpoint=state.project.features.find(feature=>feature.id===pendingPhotoCheckpointId);if(!checkpoint)return;
  const context=pendingMediaObjective,priorEvidence=checkpointEvidenceSnapshot(checkpoint),result=checkpointCamera?.finish();if(!result)return;
  checkpoint.photoPair={pairId:result.pairId,journalEventId:result.journalPairEvent?.eventId,status:'complete',frontOriginalMediaId:result.sides.front.original.mediaId,frontEvidenceMediaId:result.sides.front.evidence.mediaId,rearOriginalMediaId:result.sides.rear.original.mediaId,rearEvidenceMediaId:result.sides.rear.evidence.mediaId};delete checkpoint.pendingPhotoPair;
  transitionPhotoEvidenceSafely(checkpoint,checkpoints.CHECKPOINT_PHOTO_EVIDENCE_STATE.COMPLETE,{pairId:result.pairId,pairJournalEventId:result.journalPairEvent?.eventId||priorEvidence.photo.pairJournalEventId,reasonCode:null,failureReason:null,missingSides:[],mediaReferences:{frontOriginalMediaId:result.sides.front.original.mediaId,frontEvidenceMediaId:result.sides.front.evidence.mediaId,rearOriginalMediaId:result.sides.rear.original.mediaId,rearEvidenceMediaId:result.sides.rear.evidence.mediaId}});
  checkpoint.photoStatus='recorded';pendingPhotoCheckpointId=null;
  resolveCheckpointPendingEvidence(checkpoint,{reason:'photo-evidence-complete'});
  const arrivalTrustworthy=priorEvidence.arrival.state===checkpoints.CHECKPOINT_ARRIVAL_STATE.CONFIRMED&&priorEvidence.arrival.trustworthy;
  if(arrivalTrustworthy&&priorEvidence.photo.state!==checkpoints.CHECKPOINT_PHOTO_EVIDENCE_STATE.COMPLETE){
    await appendRallyJournalEvent('checkpoint_photo_evidence_recovered',checkpoint,{eventIdentity:`photo-recovered:${checkpoint.id}:${result.pairId}`,source:'evidence_recovery',arrivalState:checkpoint.arrivalState,photoEvidenceState:checkpoint.photoEvidenceState,pairId:result.pairId,mediaReferences:checkpoint.photoPair,pointsPreviouslyWithheld:true,title:checkpoint.name,summary:'Required photo evidence was recovered after a confirmed GPS arrival; normal completion can now proceed.'});
    if(!rallyScopeMatches(scopeToken))return {status:'scope-changed',result};
  }
  await saveProject(false);
  if(!rallyScopeMatches(scopeToken))return {status:'scope-changed',result};
  rideMemoryCapture?.noteCheckpointCapture?.({capturedAt:result.journalPairEvent?.timestamp||core.clock.iso(),checkpointId:checkpoint.id,mediaIds:[result.sides.front.original.mediaId,result.sides.front.evidence.mediaId,result.sides.rear.original.mediaId,result.sides.rear.evidence.mediaId]});
  await completeCurrentCheckpoint(arrivalTrustworthy,{photoRecorded:true,checkpoint,preserveActiveTarget:Boolean(context?.priorTargetId),silent:Boolean(context?.mode),scopeToken});
  if(!rallyScopeMatches(scopeToken))return {status:'scope-changed',result};
  resolveManualFallback({status:'captured'});return result;
}
let checkpointEvidenceReconciliationTask=null;
async function reconcilePendingCheckpointEvidence({checkpointId=null,interactive=false}={}){
  if(!checkpointEvidenceReconciliation||!rallyJournal||!checkpointCamera)return {handled:false,reason:'services-unavailable'};
  if(rallyScopeSuspended)return {handled:false,reason:'scope-suspended'};
  if(!checkpointId&&!activeRallyDay())return {handled:false,reason:'no-active-day'};
  const scope=rallyScopeSnapshot(),project=state.project,projectId=scope.projectId,activeDay=scope.dayNumber,session=currentRallySession();
  if(!session||acceptedRallySessionId!==session.sessionId)return {handled:false,reason:'session-not-accepted'};
  if(checkpointEvidenceReconciliationTask?.scopeToken===scope.token){
    if(checkpointEvidenceReconciliationTask.checkpointId===checkpointId&&checkpointEvidenceReconciliationTask.interactive===interactive)return checkpointEvidenceReconciliationTask.promise;
    await checkpointEvidenceReconciliationTask.promise;if(!rallyScopeMatches(scope.token))return {handled:false,reason:'scope-changed'};return reconcilePendingCheckpointEvidence({checkpointId,interactive});
  }
  const promise=(async()=>{
    let journal=journalEventsForSession((await rallyJournal.getProjectJournal(projectId)).events,session),handled=false,finalized=false;
    if(!rallyScopeMatches(scope.token))return {handled:false,reason:'scope-changed'};
    reconcileCurrentPendingEvidenceQueue();const pendingActionsReplayed=replayPendingEvidenceActions(journal,session).changed,executionActionsReplayed=replaySessionExecutionActions(journal,session);
    const candidates=project.features.filter(feature=>{
      if(!['checkpoint','hotel'].includes(feature.type)||!feature.photoRequired)return false;
      if(checkpointId&&feature.id!==checkpointId)return false;
      if(!checkpointId&&activeDay&&Number(feature.day)!==activeDay)return false;
      const evidence=checkpointEvidenceSnapshot(feature);
      return evidence.completion.state!==checkpoints.CHECKPOINT_FINAL_COMPLETION_STATE.COMPLETED;
    });
    for(const checkpoint of candidates){
      let report=await checkpointEvidenceReconciliation.reconcile({projectId,checkpoint,journalEvents:journal,sessionId:session.sessionId,includeLegacyUnscoped:Boolean(session.legacy),recoverEvidence:true});
      if(!rallyScopeMatches(scope.token))return {handled:false,reason:'scope-changed'};
      const beforeArrival=checkpointEvidenceSnapshot(checkpoint).arrival;
      if(report.trustworthyArrivalEvent&&!(beforeArrival.state===checkpoints.CHECKPOINT_ARRIVAL_STATE.CONFIRMED&&beforeArrival.trustworthy)){
        const stored=report.trustworthyArrivalEvent.metadata?.arrivalEvidence||{};
        checkpoints.recordCheckpointArrivalEvidence(checkpoint,{...stored,source:stored.source||report.trustworthyArrivalEvent.metadata?.source||report.trustworthyArrivalEvent.source,arrivalId:stored.arrivalId||stableUuid(`${projectId}:${session.sessionId}:arrival:${checkpoint.id}`),journalEventId:report.trustworthyArrivalEvent.eventId,timestamp:stored.timestamp||report.trustworthyArrivalEvent.metadata?.checkpointArrivalTimestamp||report.trustworthyArrivalEvent.timestamp,checkpointId:checkpoint.id,objectiveId:checkpoint.id,objectiveType:checkpoint.type,sessionId:session.sessionId,dayNumber:Number(checkpoint.day)||null});
      }
      let evidence=checkpointEvidenceSnapshot(checkpoint),arrivalEvent=report.trustworthyArrivalEvent||report.manualWorkflowEvent||null;
      if(evidence.arrival.state===checkpoints.CHECKPOINT_ARRIVAL_STATE.CONFIRMED&&evidence.arrival.trustworthy&&!report.trustworthyArrivalEvent){
        arrivalEvent=await appendRallyJournalEvent('checkpoint_arrival',checkpoint,arrivalJournalMetadata(checkpoint,{outOfOrder:false}),evidence.arrival.timestamp);journal=[...journal,arrivalEvent];
        if(!rallyScopeMatches(scope.token))return {handled:false,reason:'scope-changed'};
        report=await checkpointEvidenceReconciliation.reconcile({projectId,checkpoint,journalEvents:journal,sessionId:session.sessionId,includeLegacyUnscoped:Boolean(session.legacy),recoverEvidence:true});
        if(!rallyScopeMatches(scope.token))return {handled:false,reason:'scope-changed'};
      }
      if(report.action!=='none'&&!arrivalEvent){
        const startedAt=checkpoint.manualPhotoStartedAt||evidence.photo.updatedAt||core.clock.iso();
        arrivalEvent=await appendRallyJournalEvent('checkpoint_photo_capture_started',checkpoint,{eventIdentity:`photo-recovery:${checkpoint.id}:${report.pairId||startedAt}`,source:'evidence_recovery',photoRequired:true,photoEvidenceState:report.photoEvidenceState,pairId:report.pairId||null,title:checkpoint.name,summary:'Required photo evidence recovery resumed. No authoritative GPS arrival is claimed by this recovery action.'},startedAt);journal=[...journal,arrivalEvent];
        if(!rallyScopeMatches(scope.token))return {handled:false,reason:'scope-changed'};
        report=await checkpointEvidenceReconciliation.reconcile({projectId,checkpoint,journalEvents:journal,sessionId:session.sessionId,includeLegacyUnscoped:Boolean(session.legacy),recoverEvidence:true});
        if(!rallyScopeMatches(scope.token))return {handled:false,reason:'scope-changed'};
      }
      if(report.projectionPatch?.photoEvidenceState){
        transitionPhotoEvidenceSafely(checkpoint,report.projectionPatch.photoEvidenceState,{pairId:report.pairId,pairJournalEventId:report.pairJournalEventId,missingSides:report.missingSides,reasonCode:report.reason});
      }
      if(report.action==='none')continue;
      handled=true;checkpoint.status=checkpoints.CHECKPOINT_STATE.PHOTO_REQUIRED;checkpoint.completedAt=null;checkpoint.scoreAwarded=0;checkpoint.finalCompletionState=checkpoints.CHECKPOINT_FINAL_COMPLETION_STATE.PENDING;
      if(report.pairId)checkpoint.pendingPhotoPair={...(checkpoint.pendingPhotoPair||{}),pairId:report.pairId,pairJournalEventId:report.pairJournalEventId,status:report.photoEvidenceState,missingSides:[...report.missingSides]};
      upsertCheckpointPendingEvidence(checkpoint);
      const workflowBusy=pendingPhotoCheckpointId&&pendingPhotoCheckpointId!==checkpoint.id;
      if(workflowBusy||(!interactive&&checkpointId&&Number(checkpoint.day)!==activeDay))continue;
      if(!interactive&&report.action!=='finalize_pair')continue;
      if(!['resume_pair','finalize_pair'].includes(report.action))continue;
      if(!rallyScopeMatches(scope.token))return {handled:false,reason:'scope-changed'};
      report=await checkpointEvidenceReconciliation.restoreWorkflow({projectId,checkpoint,journalEvents:journal,sessionId:session.sessionId,includeLegacyUnscoped:Boolean(session.legacy),inspection:report,cameraWorkflow:checkpointCamera,evidenceContext:photoEvidenceContext(checkpoint,arrivalEvent),visibility:interactive?'manual':'silent'});
      if(!rallyScopeMatches(scope.token)){checkpointCamera?.abandon();return {handled:false,reason:'scope-changed'};}
      pendingPhotoCheckpointId=checkpoint.id;pendingMediaObjective={checkpointId:checkpoint.id,priorTargetId:arrivalEvent.metadata?.priorTargetId||null,captureKind:checkpoint.type==='hotel'?'hotel':'checkpoint',mode:'recovery',arrival:null};
      if(interactive)checkpointCamera.setVisibility?.('manual',report.missingSides?.[0]==='rear'?'rear_required':'awaiting_pair');
      if(report.action==='finalize_pair'&&checkpointCamera.getState?.().status==='ready'){
        const finalization=await finalizePendingPhotoCheckpoint({scopeToken:scope.token});
        if(!rallyScopeMatches(scope.token)||finalization?.status==='scope-changed')return {handled:false,reason:'scope-changed'};
        finalized=true;
      }
      if(interactive||!finalized)break;
    }
    if((handled&&!finalized)||pendingActionsReplayed||executionActionsReplayed){await saveProject(false);renderAll();}
    return {handled,finalized};
  })().catch(error=>{rallyDebug.record('checkpoint_evidence_reconciliation_failed',{checkpointId,error:error?.message||String(error)});return {handled:false,reason:'reconciliation-failed',error};}).finally(()=>{if(checkpointEvidenceReconciliationTask?.promise===promise)checkpointEvidenceReconciliationTask=null;});
  checkpointEvidenceReconciliationTask={scopeToken:scope.token,checkpointId,interactive,promise};
  return promise;
}
async function completeCurrentCheckpoint(automatic=false,{photoRecorded=false,photoDisposition=null,preserveActiveTarget=false,silent=false,checkpoint:specified,scopeToken:requestedScopeToken=null}={}){
  if(rejectRallyMutationWhileQuiesced('complete an objective'))return;
  if(restoredDayReview)return setStatus('Completed-day review is read-only.',true);
  const scopeToken=requestedScopeToken||rallyScopeSnapshot().token;
  if(!rallyScopeMatches(scopeToken))return;
  if(checkpointCompletionInFlight&&rallyScopeMatches(checkpointCompletionInFlight.scopeToken))return;
  const checkpoint=specified||currentCheckpoint();if(!checkpoint||checkpoint.status===checkpoints.CHECKPOINT_STATE.COLLECTED)return setStatus('No active checkpoint.',true);
  let settleCompletion;const completionGuard={scopeToken,settled:new Promise(resolve=>{settleCompletion=resolve;})};checkpointCompletionInFlight=completionGuard;
  try{
    snapshot();const rows=dayCheckpoints(),now=new Date().toISOString(),priorState=checkpoint.status;
    if(checkpoint.status===checkpoints.CHECKPOINT_STATE.UPCOMING)checkpoint.status=checkpoints.CHECKPOINT_STATE.ACTIVE;
    const priorEvidence=checkpointEvidenceSnapshot(checkpoint);
    if(priorEvidence.arrival.state!==checkpoints.CHECKPOINT_ARRIVAL_STATE.CONFIRMED||!priorEvidence.arrival.trustworthy){checkpoint.manualCompletionRequestedAt||=now;if(checkpoint.photoRequired){checkpoint.status=checkpoints.CHECKPOINT_STATE.PHOTO_REQUIRED;checkpoint.photoStatus='required_pending';}}
    rallyDebug.record('checkpoint_state_transition',{checkpointId:checkpoint.id,priorState,newState:checkpoint.status,activeObjectiveId:checkpoint.id,reason:'arrival'});
    const evidence=checkpointEvidenceSnapshot(checkpoint);let photoComplete=evidence.photo.state===checkpoints.CHECKPOINT_PHOTO_EVIDENCE_STATE.COMPLETE;
    if(checkpoint.photoRequired&&!photoRecorded&&!photoComplete){
      checkpoint.status=checkpoints.CHECKPOINT_STATE.PHOTO_REQUIRED;checkpoint.completedAt=null;checkpoint.scoreAwarded=0;
      await saveProject(false);if(!rallyScopeMatches(scopeToken))return;renderAll();
      let recovered=null;
      if(pendingPhotoCheckpointId===checkpoint.id){
        if(checkpointCamera?.getState?.().status==='ready')await finalizePendingPhotoCheckpoint({scopeToken});
        else checkpointCamera?.setVisibility?.('manual',workflowMissingSides()[0]==='rear'?'rear_required':'awaiting_pair');
      }else if(pendingPhotoCheckpointId){
        setStatus('Finish the current rally evidence capture first.',true);return;
      }else{
        recovered=await reconcilePendingCheckpointEvidence({checkpointId:checkpoint.id,interactive:true});
        if(!rallyScopeMatches(scopeToken))return;
        if(!recovered?.handled&&!pendingPhotoCheckpointId)await beginPhotoWorkflow(checkpoint,automatic,{visibility:'manual'});
        if(!rallyScopeMatches(scopeToken))return;
      }
      const afterRecovery=checkpointEvidenceSnapshot(checkpoint);photoComplete=afterRecovery.photo.state===checkpoints.CHECKPOINT_PHOTO_EVIDENCE_STATE.COMPLETE;
      if(photoComplete)photoRecorded=true;
      else{
        const arrivalTrustworthy=afterRecovery.arrival.state===checkpoints.CHECKPOINT_ARRIVAL_STATE.CONFIRMED&&afterRecovery.arrival.trustworthy;
        setStatus(arrivalTrustworthy?(checkpoint.type==='hotel'?'Arrival confirmed. Required hotel photo evidence is still missing.':`Arrival confirmed for ${checkpoint.name}; required photo evidence is still missing.`):`Required photo evidence for ${checkpoint.name} is still missing.`);return;
      }
    }
    const preserveRouteTarget=preserveActiveTarget||rows.some(item=>item.id!==checkpoint.id&&item.status===checkpoints.CHECKPOINT_STATE.ACTIVE),next=checkpoints.completeCheckpoint(rows,checkpoint,now,{photoRecorded,preserveActiveTarget:preserveRouteTarget});if(checkpoint.status!==checkpoints.CHECKPOINT_STATE.COLLECTED){setStatus(`Required evidence for ${checkpoint.name} is incomplete.`,true);return;}
    rallyDebug.record('checkpoint_state_transition',{checkpointId:checkpoint.id,priorState,newState:checkpoint.status,activeObjectiveId:checkpoint.id,reason:'collected'});
    recordAnalyticsCheckpoint(checkpoint,'completed');await recordJournalCheckpoint(checkpoint,automatic);if(!rallyScopeMatches(scopeToken))return;rallyDebug.record('objective_completed',{objectiveId:checkpoint.id,type:checkpoint.type});
    if(checkpoint.type==='hotel'||(!next&&!rows.some(item=>item.status===checkpoints.CHECKPOINT_STATE.DEFERRED))){await finalizeDay(checkpoint,{scopeToken});if(!rallyScopeMatches(scopeToken))return;if(!silent)setStatus(`Day ${activeRallyDay()} complete.`);return;}
    if(next){state.selectedId=next.id;const restoredPrior=preserveRouteTarget&&next.id!==checkpoint.id;rallyDebug.record('objective_selected',{objectiveId:next.id,day:activeRallyDay(),reason:restoredPrior?'out-of-order-prior-restored':'prior-completed'});if(restoredPrior)await appendRallyJournalEvent('prior_target_restored',next,{eventIdentity:`prior-target-restored:${checkpoint.id}:${next.id}:${now}`,collectedOutOfOrderCheckpointId:checkpoint.id,restoredPriorTargetId:next.id,source:'checkpoint_arrival_queue'},now);}
    await saveProject(false);if(!rallyScopeMatches(scopeToken))return;void requestAutomaticBackup(AUTOMATIC_BACKUP_TRIGGER.CHECKPOINT_COMPLETED);renderAll();if(!silent)setStatus(`${automatic?'Arrival detected. ':''}Completed ${checkpoint.name}.${next?` Next: ${next.name}.`:''}`);
  }finally{settleCompletion?.();if(checkpointCompletionInFlight===completionGuard)checkpointCompletionInFlight=false;}
}
async function deferCurrentCheckpoint(reason='Rider deferred'){
  if(rejectRallyMutationWhileQuiesced('defer an objective'))return;
  const checkpoint=currentCheckpoint();if(!checkpoint)return setStatus('No active checkpoint.',true);if(checkpoint.type==='hotel')return setStatus('The official hotel is mandatory and cannot be deferred.',true);
  snapshot();const prior=checkpoint.status,now=new Date().toISOString(),next=checkpoints.deferCheckpoint(dayCheckpoints(),checkpoint,reason,now);if(!next&&checkpoint.status!==checkpoints.CHECKPOINT_STATE.DEFERRED)return;
  recordAnalyticsCheckpoint(checkpoint,'deferred');await appendRallyJournalEvent('checkpoint_deferred',checkpoint,{eventIdentity:`deferred:${checkpoint.id}:${now}`,deferredStatus:true,deferredAt:now,transitionAt:now,reason});
  rallyDebug.record('deferred_action',{checkpointId:checkpoint.id,priorState:prior,newState:checkpoint.status,nextObjectiveId:next?.id||null});if(next)state.selectedId=next.id;await saveProject(false);renderAll();setStatus(`Deferred ${checkpoint.name}; it remains in the daily sequence.${next?` Next: ${next.name}.`:''}`);
}
async function resumeDeferredQueue(){
  if(rejectRallyMutationWhileQuiesced('resume an objective'))return;
  const now=new Date().toISOString(),checkpoint=checkpoints.resumeDeferred(dayCheckpoints(),now);if(!checkpoint)return;
  state.selectedId=checkpoint.id;await appendRallyJournalEvent('checkpoint_resumed',checkpoint,{eventIdentity:`resumed:${checkpoint.id}:${now}`,resumedDeferredStatus:true,resumedAt:now,transitionAt:now});
  rallyDebug.record('deferred_action',{action:'resume',checkpointId:checkpoint.id,newState:checkpoint.status});await saveProject(false);renderAll();setStatus(`Resumed deferred checkpoint ${checkpoint.name}.`);
}
async function finishDayFromDeferredQueue(){
  if(rejectRallyMutationWhileQuiesced('finish the day'))return;
  const rows=dayCheckpoints(),now=new Date().toISOString(),unresolved=rows.filter(item=>item.status===checkpoints.CHECKPOINT_STATE.DEFERRED),hotel=checkpoints.finishDayWithHotel(rows,now);
  if(!hotel)return setStatus('No official hotel is assigned to this day.',true);
  await appendRallyJournalEvent('deferred_finish_decision',hotel,{eventIdentity:`finish-deferred:${activeRallyDay()}`,transitionAt:now,deferredCheckpointIds:unresolved.map(item=>item.id),totalDeferred:unresolved.length,summary:'Rider chose to finish the day with deferred checkpoints uncollected.'},now);
  rallyDebug.record('finish_action',{day:activeRallyDay(),deferredCheckpointIds:unresolved.map(item=>item.id),hotelId:hotel.id});state.selectedId=hotel.id;await saveProject(false);renderAll();setStatus(`Proceed to mandatory hotel: ${hotel.name}. Deferred checkpoints remain uncollected.`);
}
async function startNextRallyDay(){
  if(rejectRallyMutationWhileQuiesced('start the next day'))return;
  const currentDay=activeRallyDay(),completed=rallyDayState(currentDay),nextDay=checkpoints.nextRallyDay(state.project,currentDay);
  completed.nextDay=nextDay;if(completed.status!=='complete'||!nextDay)return null;
  const session=await startNewRallySession(nextDay,{refreshPreflight:false});if(!session)return setStatus(`Day ${nextDay} could not be started.`,true);
  const next=currentCheckpoint();
  await appendRallyJournalEvent('day_started',next||{id:`day-${nextDay}`,type:'day',day:nextDay,name:`Day ${nextDay}`},{eventIdentity:'day-started',dayStartTimestamp:session.startedAt,title:`Day ${nextDay} Started`},session.startedAt);
  rallyDebug.record('next_day_request',{day:nextDay,sessionId:session.sessionId,accepted:true});await saveProject(false);renderAll();void refreshDayPreflight();if(state.gpsWatchId!==null)void screenWakeLock?.start('day-started');setTimeout(()=>{fitMap();gpsFollow?.restore('day-started');},0);return next;
}
function launchNavigation(feature){const point=feature?.geometry?.coordinates?.[0];if(!point)return;window.open(`https://www.google.com/maps/dir/?api=1&destination=${point.lat},${point.lon}`,'_blank','noopener,noreferrer');}
async function goToHotel(){
  if(rejectRallyMutationWhileQuiesced('start a hotel bailout'))return;
  const hotel=currentHotel();if(!hotel)return setStatus('No hotel is assigned to the active day.',true);const info=hotelEta();if(!confirm(`Go to ${hotel.name}? ${info.miles===null?'Distance unavailable':`${info.miles.toFixed(1)} miles`}. Unfinished checkpoints will be deferred, not deleted.`))return;
  const now=new Date().toISOString(),session=currentRallySession(),priorStates=dayCheckpoints().filter(checkpoint=>[checkpoints.CHECKPOINT_STATE.UPCOMING,checkpoints.CHECKPOINT_STATE.ACTIVE].includes(checkpoint.status)).map(checkpoint=>({id:checkpoint.id,status:checkpoint.status,deferredAt:checkpoint.deferredAt??null,deferReason:checkpoint.deferReason??null})),deferred=checkpoints.deferForHotel(dayCheckpoints(),now);state.hotelBailoutActive=true;hotelBailoutUndo={projectId:state.project.projectId,sessionId:session?.sessionId||null,transitionAt:now,priorStates};
  await Promise.all(deferred.map(checkpoint=>appendRallyJournalEvent('checkpoint_deferred',checkpoint,{eventIdentity:`hotel-bailout:${checkpoint.id}:${now}`,deferredStatus:true,deferredAt:now,transitionAt:now,reason:'Hotel bailout'})));
  rallyDebug.record('finish_action',{action:'hotel-bailout',hotelId:hotel.id,deferredCheckpointIds:deferred.map(item=>item.id)});await saveProject(false);renderAll();launchNavigation(hotel);setStatus(`Hotel bailout active. Unfinished checkpoints were deferred. Tap Undo Hotel Bailout to reverse.`);
}
async function undoHotelBailout(){
  if(rejectRallyMutationWhileQuiesced('undo the hotel bailout'))return;
  const session=currentRallySession(),undoState=hotelBailoutUndo;
  if(!undoState||undoState.projectId!==state.project.projectId||undoState.sessionId!==session?.sessionId){state.hotelBailoutActive=false;hotelBailoutUndo=null;renderAll();return setStatus('Hotel bailout undo is no longer available in this rally session.',true);}
  const restored=[];for(const prior of undoState.priorStates){const checkpoint=state.project.features.find(feature=>feature.id===prior.id&&Number(feature.day)===Number(session.dayNumber));if(!checkpoint||checkpoint.status!==checkpoints.CHECKPOINT_STATE.DEFERRED||checkpoint.deferredAt!==undoState.transitionAt)continue;checkpoint.status=prior.status;checkpoint.deferredAt=prior.deferredAt;checkpoint.deferReason=prior.deferReason;restored.push(checkpoint.id);}
  const undoneAt=core.clock.iso();await appendRallyJournalEvent('hotel_bailout_undone',currentHotel()||currentCheckpoint(),{eventIdentity:`hotel-bailout-undone:${undoState.transitionAt}`,transitionAt:undoState.transitionAt,undoneAt,restoredCheckpointIds:restored,title:'Hotel Bailout Undone',summary:`Restored ${restored.length} checkpoint${restored.length===1?'':'s'} from the same rally session.`},undoneAt);
  state.hotelBailoutActive=false;hotelBailoutUndo=null;await saveProject(false);renderAll();setStatus('Hotel bailout undone for this session.');
}
function toggleHotelBailout(){if(state.hotelBailoutActive)return undoHotelBailout();return goToHotel();}
function setIntelSheetOpen(open) {
  const sheet=$('intelSheet');if(!sheet)return;sheet.classList.toggle('open',open);sheet.setAttribute('aria-hidden',String(!open));$('intelButton')?.setAttribute('aria-expanded',String(open));
  if(open){$('rallyMode')?.classList.remove('more-open','journal-open');$('rallyMoreSheet')?.setAttribute('aria-hidden','true');$('rallyJournalSheet')?.setAttribute('aria-hidden','true');markRallyNavigation('intel');renderIntelSummary();}
  else if(!$('rallyMode')?.classList.contains('more-open')&&!$('rallyMode')?.classList.contains('journal-open'))markRallyNavigation('mission');
}
async function newProject(){return createIndependentProject();}
function setSidebarOpen(open) {
  $('sidebar')?.classList.toggle('open',open);$('sidebarBackdrop')?.classList.toggle('visible',open);$('sidebarToggle')?.setAttribute('aria-expanded',String(open));if($('sidebarToggle'))$('sidebarToggle').textContent=open?'Close':'Planner';
}
function wireUi() {
  document.querySelectorAll('.tab').forEach(tab=>tab.addEventListener('click',()=>{document.querySelectorAll('.tab,.panel').forEach(el=>el.classList.remove('active'));tab.classList.add('active');$(`${tab.dataset.tab}Panel`)?.classList.add('active');}));
  $('sidebarToggle')?.addEventListener('click',()=>setSidebarOpen(!$('sidebar').classList.contains('open')));
  $('sidebarClose')?.addEventListener('click',()=>setSidebarOpen(false));
  $('sidebarBackdrop')?.addEventListener('click',()=>setSidebarOpen(false));
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){setSidebarOpen(false);setIntelSheetOpen(false);closeDayBackupSheet();}});
  wireProjectController({getElement:$,actions:{
    importGpx:importGpxFiles,openProject:openProjectFile,saveProject,exportProject:exportProjectFile,reassignDays:reassignExistingDays,
    exportGpx,exportExcel,exportCsv,applyImport:applyPendingImport,cancelImport:()=>state.pendingImport=null
  }});
  $('missionFitButton')?.addEventListener('click',fitMap);
  $('missionUnassignedButton')?.addEventListener('click',trackedRallyAction(async()=>{if(rejectRallyMutationWhileQuiesced('show unassigned objectives'))return;await suspendPendingEvidenceRuntime('unassigned-selection');try{state.settings.dayFilter='0';if($('dayFilter'))$('dayFilter').value='0';resetRallySessionSelection();resumeRallyScopeRuntime('unassigned-selection-complete');document.querySelector('[data-tab="project"]')?.click();await saveProject(false);renderAll();}finally{if(rallyScopeSuspended)resumeRallyScopeRuntime('unassigned-selection-recovered');}}));
  $('missionSnapshotButton')?.addEventListener('click',()=>createNamedSnapshot('Manual snapshot'));
  ['globalSearch','searchType','searchDay'].forEach(id=>$(id)?.addEventListener(id==='globalSearch'?'input':'change',renderSearch));
  $('lineOpacity')?.addEventListener('input',()=>{state.settings.lineOpacity=Number($('lineOpacity').value);renderMapFeatures();});
  $('lineOpacity')?.addEventListener('change',()=>saveProject(false));
  document.addEventListener('click',event=>{if(!$('contextMenu')?.contains(event.target))closeContextMenu();});
  $('contextMenu')?.querySelectorAll('[data-context]').forEach(btn=>btn.addEventListener('click',()=>{const a=btn.dataset.context;closeContextMenu();if(a==='zoom')zoomSelected();if(a==='edit'){selectFeature(state.selectedId);editSelectedGeometry();}if(a==='duplicate')duplicateSelected();if(a==='reverse')reverseSelected();if(a==='favorite')toggleFavorite();if(a==='delete')deleteSelected();}));
  $('fitButton')?.addEventListener('click',fitMap);
  $('newProjectButton')?.addEventListener('click',newProject);
  $('gpsButton')?.addEventListener('click',startGps);
  $('projectName')?.addEventListener('change',async()=>{await saveProject(false);renderRallyMode();await renderStorageAndProjects();});
  $('dayFilter')?.addEventListener('change',trackedRallyAction(async()=>{if(rejectRallyMutationWhileQuiesced('change rally days'))return;await suspendPendingEvidenceRuntime('day-filter-change');try{state.settings.dayFilter=$('dayFilter').value;resetRallySessionSelection();resumeRallyScopeRuntime('day-filter-change-complete');await saveProject(false);renderAll();void refreshDayPreflight();}finally{if(rallyScopeSuspended)resumeRallyScopeRuntime('day-filter-change-recovered');}}));
  $('featureForm')?.addEventListener('submit',updateSelectedFeature);
  $('zoomFeatureButton')?.addEventListener('click',zoomSelected);
  $('duplicateFeatureButton')?.addEventListener('click',duplicateSelected);
  $('deleteFeatureButton')?.addEventListener('click',deleteSelected);
  $('editGeometryButton')?.addEventListener('click',editSelectedGeometry);
  $('stopEditButton')?.addEventListener('click',()=>{stopEditing();renderAll();selectFeature(state.selectedId);setStatus('Geometry edit saved.');});
  $('undoButton')?.addEventListener('click',trackedRallyAction(undo));
  $('bulkAssignButton')?.addEventListener('click',bulkAssign);
  $('saveTrackingSettings')?.addEventListener('click',trackedRallyAction(saveIntegrationSettings));
  $('openLeaderboardButton')?.addEventListener('click',openLeaderboard);
  $('syncRallyButton')?.addEventListener('click',syncRallyFeed);
  $('toggleRallyPollingButton')?.addEventListener('click',trackedRallyAction(toggleRallyPolling));
  $('exportCompetitorButton')?.addEventListener('click',exportCompetitorData);
  $('clearCompetitorButton')?.addEventListener('click',trackedRallyAction(clearCompetitors));
  $('rallyChooseBackupFolder')?.addEventListener('click',trackedRallyAction(chooseExternalBackupDirectory));
  $('rideMemoryIntervalMinutes')?.addEventListener('change',trackedRallyAction(changeRideMemoryInterval));
  $('showCompetitorTrails')?.addEventListener('change',()=>{state.settings.showCompetitorTrails=$('showCompetitorTrails').checked;saveProject(false);renderCompetitors();});
  $('showCompetitorMarkers')?.addEventListener('change',()=>{state.settings.showCompetitorMarkers=$('showCompetitorMarkers').checked;saveProject(false);renderCompetitors();});
  $('showStationaryEvents')?.addEventListener('change',()=>{state.settings.showStationaryEvents=$('showStationaryEvents').checked;saveProject(false);renderStationaryEvents();});
  $('showCompetitorClusters')?.addEventListener('change',()=>{state.settings.showCompetitorClusters=$('showCompetitorClusters').checked;saveProject(false);renderCompetitorClusters();});
  $('competitorTrailMinutes')?.addEventListener('change',()=>{state.settings.competitorTrailMinutes=Number($('competitorTrailMinutes').value)||480;saveProject(false);renderCompetitors();});
  $('competitorTrailOpacity')?.addEventListener('input',()=>{state.settings.competitorTrailOpacity=Number($('competitorTrailOpacity').value)||100;renderCompetitors();});
  $('competitorTrailOpacity')?.addEventListener('change',()=>saveProject(false));
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
  $('rallyPhotoViewerButton')?.addEventListener('click',()=>openPhotoViewer(false));
  $('rallyJourneyGalleryButton')?.addEventListener('click',openJourneyPhotoViewer);
  $('rallyJourneyPhotoButton')?.addEventListener('click',trackedRallyAction(requestJourneyPhoto));
  $('rallyBackUpDayButton')?.addEventListener('click',openDayBackupSheet);
  $('rallyDebriefButton')?.addEventListener('click',()=>setRallyJournalOpen(true));
  $('rallyTrailSettingsButton')?.addEventListener('click',()=>{setRallyMoreOpen(false);setSidebarOpen(true);document.querySelector('[data-tab="tracking"]')?.click();});
  for(const [id,kind] of [['rallyLayerCompetitors','competitors'],['rallyLayerBreadcrumbs','breadcrumbs'],['rallyLayerCheckpoints','checkpoints'],['rallyLayerRoute','route'],['rallyLayerRadar','radar']])$(id)?.addEventListener('click',()=>toggleRallyLayer(kind));
  $('rallyBackupDayPhotos')?.addEventListener('click',()=>exportPhotoArchive('day'));
  $('rallyBackupDayJournal')?.addEventListener('click',exportDayJournal);
  $('rallyBackupDayPackage')?.addEventListener('click',exportDayBackupPackage);
  $('rallyBackupToday')?.addEventListener('click',openDayBackupSheet);
  $('rallyBackupClose')?.addEventListener('click',closeDayBackupSheet);$('rallyBackupCloseSecondary')?.addEventListener('click',closeDayBackupSheet);
  $('rallyBackupRemindLater')?.addEventListener('click',trackedRallyAction(async()=>{if(rejectRallyMutationWhileQuiesced('change backup reminders'))return;state.settings.mediaBackupReminderDay=activeRallyDay();await saveProject(false);await renderStorageAndProjects();closeDayBackupSheet();setStatus('Backup reminder retained in Diagnostics.');}));
  $('rallyProjectCreate')?.addEventListener('click',createIndependentProject);
  $('rallyRetryEvidence')?.addEventListener('click',retryFailedEvidence);
  $('rallyProjectSwitch')?.addEventListener('click',()=>switchProject($('rallyProjectSelect')?.value));
  $('rallyProjectRename')?.addEventListener('click',renameActiveProject);
  $('rallyProjectArchive')?.addEventListener('click',archiveActiveProject);
  $('rallyProjectDelete')?.addEventListener('click',deleteActiveProject);
  $('rallyProjectExport')?.addEventListener('click',async()=>{const selected=$('rallyProjectSelect')?.value,project=(await projectLifecycle.listProjects()).find(item=>item.projectId===selected);if(!project)return;const journal=(await rallyJournal.getProjectJournal(project.projectId)).events,file=await photoExports.projectBackup(project.projectId,{journal,project,settings:project.projectId===state.project.projectId?state.settings:{}});downloadStoredBlob(file.blob,file.filename);if(project.projectId===state.project.projectId){state.settings.lastMediaExportAt=new Date().toISOString();await saveProject(false);}});
  $('rallyProjectRestore')?.addEventListener('change',event=>{const file=event.target.files?.[0];event.target.value='';restoreProjectPackage(file);});
  $('rallyDayRestore')?.addEventListener('change',event=>{const file=event.target.files?.[0];event.target.value='';restoreDayBackupPackage(file);});
  $('restoreViewDay')?.addEventListener('click',viewRestoredDay);$('restoreViewPhotos')?.addEventListener('click',viewRestoredPhotos);$('restoreViewJournal')?.addEventListener('click',viewRestoredJournal);$('restoreSwitchProject')?.addEventListener('click',switchAfterRestore);$('restoreResultClose')?.addEventListener('click',hideRestoreResult);$('restoreJournalClose')?.addEventListener('click',()=>$('restoreJournalDialog')?.close());
  $('finalizeProjectButton')?.addEventListener('click',finalizeProjectPlan);
  $('exportFinalizedProjectButton')?.addEventListener('click',exportFinalizedProject);
  $('finalizedProjectInput')?.addEventListener('change',event=>{const file=event.target.files?.[0];event.target.value='';importFinalizedProject(file);});
  $('createExecutionCopyButton')?.addEventListener('click',event=>{event.preventDefault();createActiveExecutionCopy();});
  $('rallyPhotoViewerClose')?.addEventListener('click',closePhotoViewer);
  $('rallyPhotoBack')?.addEventListener('click',()=>{$('rallyPhotoStage').hidden=true;$('rallyPhotoGalleryShell').hidden=false;});
  $('rallyPhotoGallery')?.addEventListener('click',event=>{const card=event.target.closest('[data-photo-index]');if(!card)return;photoViewerIndex=Number(card.dataset.photoIndex);photoViewerRole='evidence';renderPhotoStage();});
  $('rallyPhotoOriginal')?.addEventListener('click',()=>{photoViewerRole='original';renderPhotoStage();});
  $('rallyPhotoEvidence')?.addEventListener('click',()=>{photoViewerRole='evidence';renderPhotoStage();});
  $('rallyPhotoPrevious')?.addEventListener('click',()=>{if(!photoViewerGroups.length)return;photoViewerIndex=(photoViewerIndex-1+photoViewerGroups.length)%photoViewerGroups.length;renderPhotoStage();});
  $('rallyPhotoNext')?.addEventListener('click',()=>{if(!photoViewerGroups.length)return;photoViewerIndex=(photoViewerIndex+1)%photoViewerGroups.length;renderPhotoStage();});
  $('rallyPhotoZoomIn')?.addEventListener('click',()=>{$('rallyPhotoImage').style.setProperty('--photo-zoom',String(photoViewerZoom=Math.min(4,photoViewerZoom+.5)));});
  $('rallyPhotoZoomOut')?.addEventListener('click',()=>{$('rallyPhotoImage').style.setProperty('--photo-zoom',String(photoViewerZoom=Math.max(1,photoViewerZoom-.5)));});
  $('rallyExportOriginal')?.addEventListener('click',()=>exportPhotoSelection('original'));$('rallyExportEvidence')?.addEventListener('click',()=>exportPhotoSelection('evidence'));$('rallyExportDayPhotos')?.addEventListener('click',()=>exportPhotoArchive('day'));$('rallyExportRallyPhotos')?.addEventListener('click',()=>exportPhotoArchive('rally'));$('rallyExportJourneyPhotos')?.addEventListener('click',exportEntireJourney);
  let photoSwipeStart=null;$('rallyPhotoImage')?.addEventListener('pointerdown',event=>{photoSwipeStart=event.clientX;});$('rallyPhotoImage')?.addEventListener('pointerup',event=>{if(photoSwipeStart===null)return;const delta=event.clientX-photoSwipeStart;photoSwipeStart=null;if(Math.abs(delta)<50)return;const button=delta<0?$('rallyPhotoNext'):$('rallyPhotoPrevious');button?.click();});
  wireRallyController({getElement:$,actions:{
    selectNext:selectNextCheckpoint,setIntelOpen:setIntelSheetOpen,setJournalOpen:setRallyJournalOpen,showMission:showMissionSurface,addObservation:trackedRallyAction(addRiderObservation),defer:trackedRallyAction(()=>deferCurrentCheckpoint()),
    focusHotel:()=>{const hotel=currentHotel();if(hotel){const point=hotel.geometry.coordinates[0];performProgrammaticMapChange('hotel-focus',()=>state.map.setView([point.lat,point.lon],14,{animate:false}));setRallyMoreOpen(false);}else setStatus('No hotel is assigned to the active day.',true);},
    center:()=>{if(state.lastGpsPosition)gpsFollow?.restore('gps-button');else fitMap();},
    startGps:trackedRallyAction(startGps),
    toggleMore:()=>setRallyMoreOpen(!$('rallyMode').classList.contains('more-open')),
    openPlanner:()=>{setRallyMoreOpen(false);setSidebarOpen(true);},toggleHotelBailout:trackedRallyAction(toggleHotelBailout),
    complete:trackedRallyAction(()=>completeCurrentCheckpoint(false)),resumeDeferred:trackedRallyAction(resumeDeferredQueue),finishDay:trackedRallyAction(finishDayFromDeferredQueue),resumeSession:trackedRallyAction(()=>resumeExistingRallySession()),startNewSession:trackedRallyAction(()=>startNewRallySession(activeRallyDay())),enableGps:trackedRallyAction(()=>runPreflightAction(PREFLIGHT_CAPABILITY.GPS)),enableCamera:trackedRallyAction(enableCameraForRally),prepareStorage:trackedRallyAction(()=>runPreflightAction(PREFLIGHT_CAPABILITY.STORAGE)),prepareOffline:trackedRallyAction(()=>runPreflightAction(PREFLIGHT_CAPABILITY.OFFLINE)),startReadyDay:trackedRallyAction(()=>proceedFromDayPreflight({degraded:false})),continueDegradedDay:trackedRallyAction(()=>proceedFromDayPreflight({degraded:true})),continueManualCamera:trackedRallyAction(continueWithManualCamera),
    capturePhoto:trackedRallyAction(triggerManualFallbackCapture),addCameraSide:trackedRallyAction(addCheckpointCameraSide),addTestCameraPair:trackedRallyAction(addTestCheckpointCameraPair),cancelCamera:trackedRallyAction(cancelCheckpointCamera),failPhotoObjective:trackedRallyAction(failPendingPhotoObjective),continuePhotoRoute:trackedRallyAction(()=>continuePendingPhotoRoute()),pendingEvidence:trackedRallyAction(handlePendingEvidenceAction),startNextDay:trackedRallyAction(startNextRallyDay),warning:suppressWarning,
    exportDebug:()=>downloadBlob(rallyDebug.exportJson(),`${safeFilename(state.project.name)}-rally-debug.json`,'application/json'),
    exportJournal:exportDayJournal,
    saveArrivalSettings:trackedRallyAction(()=>{if(rejectRallyMutationWhileQuiesced('change arrival settings'))return;state.settings.autoCompleteCheckpoints=$('autoCompleteCheckpoints')?.checked!==false;state.settings.checkpointArrivalRadius=Math.max(100,Number($('checkpointArrivalRadius')?.value)||500);state.settings.checkpointMaxAccuracy=Math.max(25,Number($('checkpointMaxAccuracy')?.value)||200);saveProject(false);renderRallyMode();}),
    order:(id,action)=>{if(action==='up')moveCheckpointInOrder(id,-1);else if(action==='down')moveCheckpointInOrder(id,1);else if(action==='next')makeCheckpointNext(id);},
    resetOrder:restoreImportedCheckpointOrder,render:()=>{renderRallyMode();void refreshDayPreflight();}
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
  if(activeLifecycleProjectId)state.settings=loadSettingsForProject(activeLifecycleProjectId,state.settings);
  state.project.features.forEach(f=>{f.assignmentMethod ||= '';f.favorite ||= false;});
  state.settings.typeVisibility=Object.assign({track:true,route:true,backbone:true,waypoint:true,checkpoint:true,fuel:true,hotel:true},state.settings.typeVisibility||{});
  state.settings=Object.assign({...RALLY_FEED_DEFAULTS,rallyPollSeconds:30,rallyLivePollingEnabled:false,showCompetitorTrails:true,showCompetitorMarkers:true,showStationaryEvents:true,showCompetitorClusters:true,competitorTrailMinutes:480,competitorTrailOpacity:100,competitorFreshMinutes:15,trafficProvider:'none',tomtomApiKey:'',wazeFeedUrl:'',radarOpacity:65,radarCoverage:'active-day',radarEnabled:false,routeWeatherSpeed:45,usableFuelCapacity:0,expectedPavedRange:0,expectedMixedRange:0,reserveDistance:25,fuelProfile:'mixed',autoCompleteCheckpoints:true,checkpointArrivalRadius:500,checkpointMaxAccuracy:200,hideCompletedCheckpoints:true,preferredCamera:'front',rideMemoryIntervalMinutes:DEFAULT_RIDE_MEMORY_INTERVAL_MINUTES},state.settings);
  state.settings.preferredCamera=normalizeCameraPreference(state.settings.preferredCamera);applyCameraPreference();
  initializeCameraReadiness();
  initializeRallyDayPreflight();
  loadPersistedRestoredDayReview();
  defaultProjectSettings=deepClean(state.settings);
  state.project.competitors ||= [];
  state.project.stationaryEvents ||= [];
  rallyExecution();loadPendingEvidenceForSession();
  if(reconcileCompletedRallyDays())await saveProject(false);
  try{await initializeObservationCapture();}catch(error){console.warn(`[CannonMap observation capture] ${error?.message||error}`);}
  try{await initializeSecureObservationIngestion();}catch(error){console.warn(`[CannonMap secure ingestion] ${error?.message||error}`);}
  try{await initializeRallyAnalytics();}catch(error){console.warn(`[CannonMap analytics] ${error?.message||error}`);}
  refreshRideExportSource();
  weatherMaintenance=createProjectWeatherMaintenance();
  initMap();wireUi();weatherMaintenance.restore();renderReliabilityStatus();void refreshExternalBackupState();restoreRallyPollingIntent();if($('radarOpacity'))$('radarOpacity').value=state.settings.radarOpacity||65;if($('radarCoverage'))$('radarCoverage').value=state.settings.radarCoverage||'active-day';if($('routeWeatherSpeed'))$('routeWeatherSpeed').value=String(state.settings.routeWeatherSpeed||45);
  if(activeRallyDay()&&!showRallySessionChoice()&&rallyDayState(activeRallyDay()).status!=='complete')await cameraReadiness.inspect();
  if(activeRallyDay()&&!showRallySessionChoice())await refreshDayPreflight();
  if($('buildLabel'))$('buildLabel').textContent=`Beta ${APP_VERSION}`;
  if($('appVersion'))$('appVersion').textContent=`v${APP_VERSION} · ${BUILD_ID}`;
  renderAll();
  weatherMaintenance.onGps(currentIntelPoint(),{moving:false}).catch(error=>console.warn(`[CannonMap weather] Background refresh failed: ${error?.message||error}`));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){gpsWatchdog?.checkNow?.();void runReliabilityHealthCheck({force:true});weatherMaintenance?.onGps(currentIntelPoint(),{moving:false}).catch(()=>{});if(activeRallyDay()&&!showRallySessionChoice()&&rallyDayState(activeRallyDay()).status!=='complete')void refreshCameraReadiness();void refreshExternalBackupState();void releaseExpiredPendingEvidence();if(!showRallySessionChoice()&&!pendingMediaObjective)void reconcilePendingCheckpointEvidence({interactive:false});if(state.settings.rallyLivePollingEnabled&&state.rallyLiveFeed)void state.rallyLiveFeed.refreshMetadata?.().catch(()=>{});}else automaticCaptureAbortController?.abort();},{passive:true});
  window.addEventListener('pagehide',()=>{automaticCaptureAbortController?.abort();cameraSession?.teardown('page-unloaded');void livePollWriteScheduler?.flush?.('pagehide');void screenWakeLock?.stop('page-hidden');},{passive:true});
  window.addEventListener('pageshow',()=>{gpsWatchdog?.checkNow?.();void runReliabilityHealthCheck({force:true});if(activeRallyDay()&&!showRallySessionChoice()&&rallyDayState(activeRallyDay()).status!=='complete')void refreshCameraReadiness();void refreshExternalBackupState();void releaseExpiredPendingEvidence();if(!showRallySessionChoice()&&!pendingMediaObjective)void reconcilePendingCheckpointEvidence({interactive:false});if(state.gpsWatchId!==null)void screenWakeLock?.start('page-restored');restoreRallyPollingIntent();},{passive:true});
  window.addEventListener('online',()=>{state.rallySync.lastError='';if(state.settings.rallyLivePollingEnabled&&state.rallyLiveFeed)void state.rallyLiveFeed.refreshMetadata?.().catch(()=>{});else restoreRallyPollingIntent();if(!showRallySessionChoice()&&!pendingMediaObjective)void reconcilePendingCheckpointEvidence({interactive:false});renderIntelSummary();},{passive:true});
  window.addEventListener('offline',()=>{if(state.settings.rallyLivePollingEnabled)state.rallySync.lastError='OFFLINE · showing saved competitor trails';renderIntelSummary();},{passive:true});
  if(state.settings.radarEnabled)showRadar({silent:true});
  const recovery=showRallySessionChoice()?{handled:false,reason:'session-choice-required'}:await reconcilePendingCheckpointEvidence({interactive:false});
  rallyDebug.record('application_restored',{day:activeRallyDay(),dayStatus:rallyDayState(activeRallyDay()).status,activeObjectiveId:currentCheckpoint()?.id||null,pendingPhotoCheckpointId,recoveryHandled:Boolean(recovery?.handled),recoveryFinalized:Boolean(recovery?.finalized)});
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
  const types=['features','competitors','competitorClusters','stationaryEvents','traffic','weather','radar'];
  return {
    mapContainers:document.querySelectorAll('.leaflet-container').length,
    registry:mapEngine?.layers.counts()||{},
    groups:Object.fromEntries(types.map(type=>[type,mapEngine?.group(type).getLayers().length||0]))
  };
}
function competitorLayerDiagnostics(){
  return (mapEngine?.group('competitors')?.getLayers?.()||[]).map(layer=>{
    const metadata=layer._cannonMapRender||{},points=metadata.points||[];
    return {key:metadata.key||null,kind:metadata.kind||null,competitorId:metadata.competitorId||null,pointCount:points.length,pointIds:points.map(breadcrumbKey),points:points.map(point=>({lat:point.lat,lon:point.lon,time:point.time}))};
  });
}
function fieldMediaState(){
  const pending=pendingMediaObjective,camera=checkpointCamera?.getState()||null,coordinator=checkpointArrivalCoordinator?.state()||null;
  const cameraState=camera?{status:camera.status,visibility:camera.visibility||null,captureKind:camera.captureKind||null,pairId:camera.pairId||null,sides:{front:Boolean(camera.sides?.front),rear:Boolean(camera.sides?.rear)}}:null;
  const coordinatorState=coordinator?{processing:Boolean(coordinator.processing),candidateIds:(coordinator.candidates||[]).map(item=>item.checkpointId),queued:(coordinator.queued||[]).map(item=>({checkpointId:item.checkpointId,detectedAt:item.detectedAt,speedMph:item.speedMph,priorTargetId:item.priorTargetId})),handledCheckpointIds:[...(coordinator.handledCheckpointIds||[])]}:null;
  return {pending:Boolean(pending),pendingCheckpointId:pendingPhotoCheckpointId,priorTargetId:pending?.priorTargetId||null,captureKind:pending?.captureKind||null,mode:pending?.mode||null,expiresAt:pending?.expiresAt||null,cameraState,coordinatorState};
}
function setGpsPositionForTest(position={}){
  const speedMps=Number.isFinite(Number(position.speedMps))?Number(position.speedMps):(Number.isFinite(Number(position.speedMph))?Number(position.speedMph)/2.23694:null);
  state.lastGpsPosition={lat:Number(position.lat),lon:Number(position.lon),heading:Number.isFinite(Number(position.heading))?Number(position.heading):null,speedMps,accuracyFeet:Number.isFinite(Number(position.accuracyFeet))?Number(position.accuracyFeet):15,elevationFeet:Number.isFinite(Number(position.elevationFeet))?Number(position.elevationFeet):null,time:position.time||new Date().toISOString()};return structuredClone(state.lastGpsPosition);
}
function observeCheckpointDetectionsForTest(input={}){
  const session=currentRallySession();if(!session||acceptedRallySessionId!==session.sessionId||showRallySessionChoice()||showDayPreflight()||rallyScopeSuspended)return {accepted:[],rejected:[{reason:'rally-session-not-accepted'}]};
  const scope=rallyScopeSnapshot(),detections=(input.detections||[]).map(detection=>({...detection,metadata:{...(detection.metadata||{}),rallyScopeToken:scope.token,projectId:scope.projectId,dayNumber:scope.dayNumber,sessionId:scope.sessionId}}));
  return checkpointArrivalCoordinator?.observe({...input,detections});
}
function checkpointEvidenceStateForTest(id){const checkpoint=state.project.features.find(feature=>feature.id===id);return checkpoint?structuredClone(checkpointEvidenceSnapshot(checkpoint)):null;}
function rallySessionStateForTest(){return {current:currentRallySession({matchActiveDay:false}),choice:rallySessionChoiceState(),acceptedRallySessionId,pendingRallySessionId,pendingEvidence:structuredClone(pendingEvidenceQueue),activePendingEvidence:structuredClone(activePendingEvidenceEntries())};}
window.CannonMapTest={filterProhibitedFeatures,sanitizeProjectData,lineGeometriesMatch,lineDistanceMiles,planningMileage,normalizeCheckpoint,rallyCheckpointNumber,selectNextCheckpoint,completeCurrentCheckpoint,deferCurrentCheckpoint,resumeDeferredQueue,finishDayFromDeferredQueue,startNextRallyDay,finalizePendingPhotoCheckpoint,goToHotel,rallyScore,restoreSnapshot,evaluateCheckpointArrival,moveCheckpointInOrder,makeCheckpointNext,restoreImportedCheckpointOrder,handleStationaryAction,renderStationaryEvents,updateStationaryDetection,renderMapFeatures,mapEngineDiagnostics,competitorLayerDiagnostics,competitorTacticalProjectionMetrics:()=>({...competitorTacticalProjectionMetrics}),observationCaptureDiagnostics,captureGpsObservation,replaySecureObservations,observationContext,missionControlJournalEvents,missionControlAppendTestPhotoReference,rideExportSnapshot,missionMediaRecords:async()=>Promise.all((await missionMedia.listProjectPhotos(state.project.projectId)).map(async row=>({role:row.role,metadata:row.metadata,name:row.name,bytes:[...new Uint8Array(await row.blob.arrayBuffer())]}))),rallySessionStateForTest,startNewRallySessionForTest:startNewRallySession,resumeRallySessionForTest:resumeExistingRallySession,pendingEvidenceActionForTest:handlePendingEvidenceAction,rallyDebugEntries:()=>rallyDebug.entries(),gpsFollowState:()=>gpsFollow?.state(),simulateManualMapPan:()=>state.map?.fire('dragstart',{originalEvent:{type:'field-test'}}),gpsMarkerBounds:()=>{if(!state.lastGpsPosition||!state.map)return null;const point=state.map.latLngToContainerPoint([state.lastGpsPosition.lat,state.lastGpsPosition.lon]),mapRect=$('map')?.getBoundingClientRect();return mapRect?{x:mapRect.left+point.x,y:mapRect.top+point.y}:null;},setCompetitorsForTest:competitors=>{state.project.competitors=structuredClone(competitors);renderCompetitors();return mapEngineDiagnostics();},openCompetitorPopupForTest:id=>mapEngine.layers.get('competitors',`marker:${id}`)?.openPopup(),competitorPopupState:()=>structuredClone(competitorPopupSelection),followCompetitorForTest:followCompetitor,zoomCompetitorForTest:zoomCompetitor,mapViewForTest:()=>({center:state.map?.getCenter?.(),zoom:state.map?.getZoom?.()}),setAutomaticCameraCaptureForTest:handler=>{automaticCaptureOverride=typeof handler==='function'?handler:null;},cameraReadinessState:()=>structuredClone(cameraReadinessState()),cameraSessionState:()=>structuredClone(cameraSession?.state?.()||null),refreshCameraReadinessForTest:refreshCameraReadiness,dayPreflightState:()=>structuredClone(currentPreflightState()),refreshDayPreflightForTest:refreshDayPreflight,proceedFromDayPreflightForTest:proceedFromDayPreflight,checkpointEvidenceStateForTest,reconcilePendingCheckpointEvidenceForTest:options=>reconcilePendingCheckpointEvidence(options),observeCheckpointDetectionsForTest,awaitFieldMediaIdle:()=>checkpointArrivalCoordinator?.whenIdle(),expireManualFallbackForTest:expireManualFallback,fieldMediaState,missionStorageEstimate:()=>missionStorage?.estimate(state.project.projectId),wakeLockState:()=>screenWakeLock?.state()||null,setGpsPositionForTest,
  automaticBackupStateForTest:()=>structuredClone(automaticBackup?.state?.()||null),automaticBackupLatestForTest:sessionId=>automaticBackup?.latestRecovery?.(sessionId||currentRallySession()?.sessionId),runAutomaticBackupForTest:trigger=>requestAutomaticBackup(trigger||AUTOMATIC_BACKUP_TRIGGER.SCHEDULED),externalBackupStateForTest:()=>automaticBackup?.externalState?.(),backupHealthStateForTest:()=>structuredClone(backupSchedulerHealth?.state?.()||null),
  rideMemoryStateForTest:()=>structuredClone(rideMemoryCapture?.state?.()||null),runRideMemoryDueForTest:()=>rideMemoryCapture?.runDueNow?.(),setRideMemoryIntervalForTest:milliseconds=>rideMemoryCapture?.setInterval?.(milliseconds),gpsWatchdogStateForTest:()=>structuredClone(gpsWatchdog?.state?.()||null),checkGpsWatchdogForTest:()=>gpsWatchdog?.checkNow?.(),pollingStateForTest:()=>structuredClone(rallyPollingState()),forceReliabilityHealthCheckForTest:()=>runReliabilityHealthCheck({force:true}),
  runtimeDependencyReport,startApplication,registerServiceWorker};
startApplication();
