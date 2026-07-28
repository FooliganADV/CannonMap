import {createCoreCompatibility} from './src/core/compatibility.js';
import * as geometry from './src/domain/geo/geometry.js';
import {createMapEngine} from './src/ui/map/map-engine.js';
import {createProjectWorkflows} from './src/application/project-workflows.js';
import * as checkpoints from './src/domain/checkpoints/workflow.js';
import {renderRally as presentRally} from './src/ui/rally/presenter.js';
import {wireRallyController} from './src/ui/rally/controller.js';
import {wireProjectController} from './src/ui/project/controller.js';
import {createFeatureFlags} from './src/core/feature-flags.js';
import {createObservationCapture,OBSERVATION_CAPTURE_FEATURE_FLAG} from './src/application/observation-capture.js';
import {createSecureObservationUploader,SECURE_INGESTION_FEATURE_FLAG} from './src/application/secure-observation-upload.js';
import {createObservationCaptureRepository,openIndexedDbV2,V2_FEATURE_FLAG} from './src/infrastructure/indexeddb/index.js';
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
let observationSequence=0;
const observationSessionId=`device-${core.ids.create()}`;
const featureFlags=createFeatureFlags({read:key=>globalThis.__CANNONMAP_FEATURE_FLAGS__?.[key]===true});

const $ = id => document.getElementById(id);
const uid=core.ids.create;
const haversine=geometry.haversineMeters;
const lineDistanceMiles=geometry.lineDistanceMiles;
const validPoint=geometry.validPoint;
const distancePointToSegmentMiles=geometry.distancePointToSegmentMiles;
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&','<':'<','>':'>',"'":'&#39;','"':'"'}[c]));
