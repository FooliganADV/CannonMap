'use strict';

const APP_VERSION = '0.2.0';
const PROJECT_KEY = 'cannonmap.project.v2';
const SETTINGS_KEY = 'cannonmap.settings.v2';
const DB_NAME = 'CannonMapDB';
const DB_STORE = 'projects';

const COLORS = {
  track: '#f97316', route: '#38bdf8', waypoint: '#facc15', checkpoint: '#22c55e',
  fuel: '#a78bfa', hotel: '#fb7185', competitor: '#ef4444'
};

const state = {
  map: null,
  baseLayers: {},
  featureGroup: null,
  gpsLayer: null,
  gpsAccuracyLayer: null,
  gpsWatchId: null,
  pendingLayer: null,
  selectedId: null,
  project: {
    version: APP_VERSION,
    name: 'America 250 – 2026',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    features: [],
    competitors: []
  },
  settings: {
    dayFilter: 'all',
    inreachUrl: ''
  }
};

const $ = id => document.getElementById(id);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

function setStatus(message, isError = false) {
  const el = $('status');
  el.textContent = message;
  el.style.background = isError ? '#450a0a' : '#431407';
  el.style.borderColor = isError ? '#991b1b' : '#7c2d12';
}

function initMap() {
  state.map = L.map('map', { zoomControl: true, preferCanvas: true }).setView([38.5, -98.5], 4);
  state.baseLayers.street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
  }).addTo(state.map);
  state.baseLayers.topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17,
    attribution: 'Map data © OpenStreetMap contributors, SRTM | Map style © OpenTopoMap'
  });
  L.control.layers({ Streets: state.baseLayers.street, Topographic: state.baseLayers.topo }, {}, { position: 'topright' }).addTo(state.map);

  state.featureGroup = L.featureGroup().addTo(state.map);
  state.map.pm.addControls({
    position: 'topleft',
    drawMarker: true,
    drawPolyline: true,
    drawPolygon: false,
    drawRectangle: false,
    drawCircle: false,
    drawCircleMarker: false,
    editMode: true,
    dragMode: true,
    cutPolygon: false,
    removalMode: false,
    rotateMode: false
  });
  state.map.pm.setGlobalOptions({ snappable: true, snapDistance: 20, layerGroup: state.featureGroup });

  state.map.on('pm:create', event => {
    state.pendingLayer = event.layer;
    state.pendingLayer._cannonStamp = uid();
    $('createLayerStamp').value = state.pendingLayer._cannonStamp;
    const activeDay = state.settings.dayFilter === 'all' ? '0' : state.settings.dayFilter;
    $('createDay').value = activeDay;
    $('createType').value = event.shape === 'Marker' ? 'checkpoint' : 'track';
    $('createName').value = event.shape === 'Marker' ? 'New checkpoint' : 'New track';
    $('createNotes').value = '';
    $('createDialog').showModal();
  });

  state.map.on('mousemove', e => {
    $('cursorCoordinates').textContent = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
  });
}

function normalizeLatLngs(latlngs) {
  if (!Array.isArray(latlngs)) return [];
  const source = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs;
  return source.map(p => ({ lat: Number(p.lat), lon: Number(p.lng) }));
}

function layerToGeometry(layer) {
  if (layer instanceof L.Marker) {
    const p = layer.getLatLng();
    return { kind: 'point', coordinates: [{ lat: p.lat, lon: p.lng }] };
  }
  return { kind: 'line', coordinates: normalizeLatLngs(layer.getLatLngs()) };
}

function featureMatchesDay(feature) {
  return state.settings.dayFilter === 'all' || String(feature.day ?? 0) === String(state.settings.dayFilter);
}

function featureStyle(feature) {
  const color = COLORS[feature.type] || COLORS.track;
  return { color, fillColor: color, weight: feature.type === 'route' ? 5 : 4, opacity: .9, fillOpacity: .9 };
}

function createLeafletLayer(feature) {
  let layer;
  const style = featureStyle(feature);
  if (feature.geometry.kind === 'point') {
    const p = feature.geometry.coordinates[0];
    layer = L.circleMarker([p.lat, p.lon], { ...style, radius: feature.type === 'checkpoint' ? 8 : 7 });
  } else {
    layer = L.polyline(feature.geometry.coordinates.map(p => [p.lat, p.lon]), style);
  }
  layer._cannonId = feature.id;
  layer.bindTooltip(feature.name || feature.type, { sticky: true });
  layer.on('click', () => selectFeature(feature.id));
  layer.on('pm:edit', () => syncGeometryFromLayer(layer));
  layer.on('pm:dragend', () => syncGeometryFromLayer(layer));
  return layer;
}

function syncGeometryFromLayer(layer) {
  const feature = state.project.features.find(f => f.id === layer._cannonId);
  if (!feature) return;
  feature.geometry = layerToGeometry(layer);
  feature.updatedAt = new Date().toISOString();
  state.project.updatedAt = feature.updatedAt;
  saveProject(false);
  renderStats();
}

function renderMapFeatures() {
  state.featureGroup.clearLayers();
  state.project.features.forEach(feature => {
    if (!feature.visible || !featureMatchesDay(feature)) return;
    const layer = createLeafletLayer(feature);
    state.featureGroup.addLayer(layer);
    feature._layer = layer;
  });
  renderCompetitors();
}

function renderCompetitors() {
  state.project.competitors.forEach(comp => {
    if (!Array.isArray(comp.points) || !comp.points.length) return;
    const line = L.polyline(comp.points.map(p => [p.lat, p.lon]), { color: COLORS.competitor, weight: 3, dashArray: '7 7', opacity: .75 });
    line.bindTooltip(`${comp.name || comp.id} competitor trail`);
    state.featureGroup.addLayer(line);
    const last = comp.points[comp.points.length - 1];
    const marker = L.circleMarker([last.lat, last.lon], { radius: 6, color: COLORS.competitor, fillColor: COLORS.competitor, fillOpacity: 1 });
    marker.bindPopup(`<strong>${escapeHtml(comp.name || comp.id)}</strong><br>${escapeHtml(last.time || 'Latest position')}`);
    state.featureGroup.addLayer(marker);
  });
}

function renderLayerList() {
  const box = $('layerList');
  const filtered = state.project.features.filter(featureMatchesDay);
  if (!filtered.length) {
    box.className = 'layer-list empty';
    box.textContent = 'No map features for this day.';
    return;
  }
  box.className = 'layer-list';
  box.innerHTML = filtered.map(feature => `
    <div class="layer-row">
      <span class="swatch" style="background:${COLORS[feature.type] || COLORS.track}"></span>
      <button type="button" data-select-id="${feature.id}">
        <strong>${escapeHtml(feature.name)}</strong>
        <small>${escapeHtml(feature.type)} · ${feature.day ? `Day ${feature.day}` : 'Unassigned'}</small>
      </button>
      <input class="visibility" type="checkbox" data-visible-id="${feature.id}" ${feature.visible ? 'checked' : ''} aria-label="Show ${escapeHtml(feature.name)}" />
    </div>`).join('');
  box.querySelectorAll('[data-select-id]').forEach(btn => btn.addEventListener('click', () => selectFeature(btn.dataset.selectId)));
  box.querySelectorAll('[data-visible-id]').forEach(input => input.addEventListener('change', () => {
    const feature = state.project.features.find(f => f.id === input.dataset.visibleId);
    if (feature) { feature.visible = input.checked; saveProject(false); renderMapFeatures(); }
  }));
}

function renderStats() {
  const visible = state.project.features.filter(featureMatchesDay);
  $('trackCount').textContent = visible.filter(f => f.type === 'track').length;
  $('routeCount').textContent = visible.filter(f => f.type === 'route').length;
  $('waypointCount').textContent = visible.filter(f => ['waypoint','checkpoint','fuel','hotel'].includes(f.type)).length;
  const miles = visible.filter(f => f.geometry.kind === 'line').reduce((sum, f) => sum + lineDistanceMiles(f.geometry.coordinates), 0);
  $('distanceTotal').textContent = `${miles.toFixed(1)} mi`;
}

function renderAll() {
  $('projectName').value = state.project.name;
  $('dayFilter').value = state.settings.dayFilter;
  $('inreachUrl').value = state.settings.inreachUrl || '';
  renderMapFeatures();
  renderLayerList();
  renderStats();
  renderCompetitorSummary();
}

function lineDistanceMiles(points) {
  let meters = 0;
  for (let i = 1; i < points.length; i++) meters += haversine(points[i - 1], points[i]);
  return meters / 1609.344;
}

function haversine(a, b) {
  const R = 6371000;
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const q = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(q));
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB could not be opened.'));
  });
}

async function saveProject(showMessage = true) {
  try {
    state.project.name = $('projectName').value.trim() || 'CannonMap Project';
    state.project.updatedAt = new Date().toISOString();
    const clean = JSON.parse(JSON.stringify(state.project, (key, value) => key === '_layer' ? undefined : value));
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(clean, 'current');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Project save transaction failed.'));
    });
    db.close();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    localStorage.removeItem(PROJECT_KEY);
    if (showMessage) setStatus(`Saved locally at ${new Date().toLocaleTimeString()}.`);
  } catch (error) {
    setStatus(`Save failed: ${error.message}`, true);
  }
}

async function loadProject() {
  try {
    const db = await openDatabase();
    const saved = await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const request = tx.objectStore(DB_STORE).get('current');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Project read failed.'));
    });
    db.close();
    if (saved) state.project = saved;
    else {
      const legacy = localStorage.getItem(PROJECT_KEY);
      if (legacy) state.project = JSON.parse(legacy);
    }
    const settings = localStorage.getItem(SETTINGS_KEY);
    if (settings) state.settings = { ...state.settings, ...JSON.parse(settings) };
  } catch (error) {
    setStatus(`Saved project could not be read: ${error.message}`, true);
  }
}

function inferDay(name, fallback = 0) {
  const match = String(name || '').match(/\bday[\s_-]*(\d)\b/i);
  return match ? Number(match[1]) : fallback;
}

function textOf(element, tag) {
  const node = element.getElementsByTagName(tag)[0];
  return node ? node.textContent.trim() : '';
}

function parseGpx(xmlText, filename) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('The file is not valid GPX/XML.');
  const features = [];

  [...doc.getElementsByTagName('wpt')].forEach((wpt, index) => {
    const name = textOf(wpt, 'name') || `${filename} waypoint ${index + 1}`;
    const sym = textOf(wpt, 'sym').toLowerCase();
    const type = /fuel|gas/.test(name.toLowerCase()) || /fuel/.test(sym) ? 'fuel'
      : /hotel|motel|lodging|finish/.test(name.toLowerCase()) ? 'hotel'
      : /checkpoint|\bcp\b|start|finish|dirt|extreme/.test(name.toLowerCase()) ? 'checkpoint' : 'waypoint';
    features.push({
      id: uid(), name, type, day: inferDay(name), notes: textOf(wpt, 'desc') || textOf(wpt, 'cmt'), visible: true,
      source: filename, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      geometry: { kind: 'point', coordinates: [{ lat: Number(wpt.getAttribute('lat')), lon: Number(wpt.getAttribute('lon')) }] }
    });
  });

  [...doc.getElementsByTagName('rte')].forEach((rte, index) => {
    const name = textOf(rte, 'name') || `${filename} route ${index + 1}`;
    const coordinates = [...rte.getElementsByTagName('rtept')].map(p => ({ lat: Number(p.getAttribute('lat')), lon: Number(p.getAttribute('lon')) })).filter(validPoint);
    if (coordinates.length) features.push({ id: uid(), name, type: 'route', day: inferDay(name), notes: textOf(rte, 'desc'), visible: true, source: filename, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), geometry: { kind: 'line', coordinates } });
  });

  [...doc.getElementsByTagName('trk')].forEach((trk, index) => {
    const baseName = textOf(trk, 'name') || `${filename} track ${index + 1}`;
    const segments = [...trk.getElementsByTagName('trkseg')];
    segments.forEach((segment, segIndex) => {
      const coordinates = [...segment.getElementsByTagName('trkpt')].map(p => ({ lat: Number(p.getAttribute('lat')), lon: Number(p.getAttribute('lon')) })).filter(validPoint);
      if (coordinates.length) features.push({
        id: uid(), name: segments.length > 1 ? `${baseName} – Segment ${segIndex + 1}` : baseName, type: 'track', day: inferDay(baseName), notes: textOf(trk, 'desc'), visible: true, source: filename,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), geometry: { kind: 'line', coordinates }
      });
    });
  });
  return features;
}

function validPoint(p) { return Number.isFinite(p.lat) && Number.isFinite(p.lon); }

async function importGpxFiles(fileList) {
  let added = 0;
  for (const file of fileList) {
    try {
      const features = parseGpx(await file.text(), file.name);
      state.project.features.push(...features);
      added += features.length;
    } catch (error) {
      setStatus(`Could not import ${file.name}: ${error.message}`, true);
    }
  }
  saveProject(false);
  renderAll();
  fitMap();
  setStatus(`Imported ${added} map features from ${fileList.length} GPX file(s).`);
}

function selectFeature(id) {
  state.selectedId = id;
  const feature = state.project.features.find(f => f.id === id);
  if (!feature) return;
  $('selectedFeatureId').value = id;
  $('featureName').value = feature.name;
  $('featureType').value = feature.type;
  $('featureDay').value = String(feature.day || 0);
  $('featureNotes').value = feature.notes || '';
  ['featureName','featureType','featureDay','featureNotes','updateFeatureButton','zoomFeatureButton','duplicateFeatureButton','deleteFeatureButton'].forEach(id => $(id).disabled = false);
  document.querySelector('[data-tab="features"]').click();
  if (feature._layer) feature._layer.openTooltip();
}

function clearSelection() {
  state.selectedId = null;
  $('featureForm').reset();
  ['featureName','featureType','featureDay','featureNotes','updateFeatureButton','zoomFeatureButton','duplicateFeatureButton','deleteFeatureButton'].forEach(id => $(id).disabled = true);
}

function updateSelectedFeature(event) {
  event.preventDefault();
  const feature = state.project.features.find(f => f.id === state.selectedId);
  if (!feature) return;
  feature.name = $('featureName').value.trim() || feature.name;
  feature.type = $('featureType').value;
  feature.day = Number($('featureDay').value);
  feature.notes = $('featureNotes').value.trim();
  feature.updatedAt = new Date().toISOString();
  saveProject(false);
  renderAll();
  selectFeature(feature.id);
  setStatus(`Updated ${feature.name}.`);
}

function zoomSelected() {
  const feature = state.project.features.find(f => f.id === state.selectedId);
  if (!feature || !feature._layer) return;
  if (feature.geometry.kind === 'point') state.map.setView(feature._layer.getLatLng(), 15);
  else state.map.fitBounds(feature._layer.getBounds(), { padding: [30, 30] });
}

function duplicateSelected() {
  const feature = state.project.features.find(f => f.id === state.selectedId);
  if (!feature) return;
  const copy = JSON.parse(JSON.stringify(feature, (key, value) => key === '_layer' ? undefined : value));
  copy.id = uid();
  copy.name = `${copy.name} copy`;
  copy.createdAt = new Date().toISOString();
  copy.updatedAt = copy.createdAt;
  copy.geometry.coordinates = copy.geometry.coordinates.map(p => ({ lat: p.lat + .002, lon: p.lon + .002 }));
  state.project.features.push(copy);
  saveProject(false);
  renderAll();
  selectFeature(copy.id);
}

function deleteSelected() {
  const feature = state.project.features.find(f => f.id === state.selectedId);
  if (!feature || !confirm(`Delete “${feature.name}”?`)) return;
  state.project.features = state.project.features.filter(f => f.id !== state.selectedId);
  clearSelection();
  saveProject(false);
  renderAll();
  setStatus(`Deleted ${feature.name}.`);
}

function fitMap() {
  const layers = state.featureGroup.getLayers();
  if (!layers.length) return;
  const bounds = state.featureGroup.getBounds();
  if (bounds.isValid()) state.map.fitBounds(bounds, { padding: [25, 25] });
}

function xmlEscape(value) {
  return String(value ?? '').replace(/[<>&'\"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]));
}

function exportGpx() {
  const exportFeatures = state.project.features.filter(featureMatchesDay);
  const waypoints = exportFeatures.filter(f => f.geometry.kind === 'point').map(f => {
    const p = f.geometry.coordinates[0];
    return `  <wpt lat="${p.lat.toFixed(8)}" lon="${p.lon.toFixed(8)}"><name>${xmlEscape(f.name)}</name><desc>${xmlEscape(f.notes || '')}</desc><type>${xmlEscape(f.type)}</type></wpt>`;
  }).join('\n');
  const routes = exportFeatures.filter(f => f.type === 'route' && f.geometry.kind === 'line').map(f => `  <rte><name>${xmlEscape(f.name)}</name><desc>${xmlEscape(f.notes || '')}</desc>\n${f.geometry.coordinates.map(p => `    <rtept lat="${p.lat.toFixed(8)}" lon="${p.lon.toFixed(8)}" />`).join('\n')}\n  </rte>`).join('\n');
  const tracks = exportFeatures.filter(f => f.type !== 'route' && f.geometry.kind === 'line').map(f => `  <trk><name>${xmlEscape(f.name)}</name><desc>${xmlEscape(f.notes || '')}</desc><trkseg>\n${f.geometry.coordinates.map(p => `    <trkpt lat="${p.lat.toFixed(8)}" lon="${p.lon.toFixed(8)}" />`).join('\n')}\n  </trkseg></trk>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="CannonMap ${APP_VERSION}" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${xmlEscape(state.project.name)}</name><time>${new Date().toISOString()}</time></metadata>\n${waypoints}\n${routes}\n${tracks}\n</gpx>`;
  downloadBlob(xml, `${safeFilename(state.project.name)}${state.settings.dayFilter === 'all' ? '' : `-day-${state.settings.dayFilter}`}.gpx`, 'application/gpx+xml');
  setStatus(`Exported ${exportFeatures.length} features to GPX.`);
}

function safeFilename(name) { return String(name || 'cannonmap').trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase(); }
function downloadBlob(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

function startGps() {
  if (!navigator.geolocation) return setStatus('This browser does not support GPS.', true);
  if (state.gpsWatchId !== null) {
    navigator.geolocation.clearWatch(state.gpsWatchId);
    state.gpsWatchId = null;
    $('gpsButton').textContent = 'Start GPS';
    $('gpsStatus').textContent = 'GPS off';
    return;
  }
  state.gpsWatchId = navigator.geolocation.watchPosition(position => {
    const ll = [position.coords.latitude, position.coords.longitude];
    if (state.gpsLayer) state.gpsLayer.remove();
    if (state.gpsAccuracyLayer) state.gpsAccuracyLayer.remove();
    state.gpsAccuracyLayer = L.circle(ll, { radius: position.coords.accuracy, color: '#38bdf8', weight: 1, fillOpacity: .08 }).addTo(state.map);
    state.gpsLayer = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#38bdf8', fillOpacity: 1 }).addTo(state.map);
    $('gpsStatus').textContent = `GPS ±${Math.round(position.coords.accuracy * 3.28084)} ft`;
  }, error => setStatus(`GPS error: ${error.message}`, true), { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });
  $('gpsButton').textContent = 'Stop GPS';
}

async function importCompetitorJson(file) {
  try {
    const data = JSON.parse(await file.text());
    const entries = Array.isArray(data) ? data : data.competitors;
    if (!Array.isArray(entries)) throw new Error('Expected an array or a competitors array.');
    state.project.competitors = entries.map((entry, index) => ({
      id: entry.id || entry.riderId || `rider-${index + 1}`,
      name: entry.name || entry.riderName || `Rider ${index + 1}`,
      points: (entry.points || entry.positions || []).map(p => ({ lat: Number(p.lat ?? p.latitude), lon: Number(p.lon ?? p.longitude), time: p.time || p.timestamp || '' })).filter(validPoint)
    }));
    saveProject(false); renderAll(); fitMap(); setStatus(`Imported ${state.project.competitors.length} competitor trails.`);
  } catch (error) { setStatus(`Competitor import failed: ${error.message}`, true); }
}

function renderCompetitorSummary() {
  const box = $('competitorSummary');
  if (!state.project.competitors.length) { box.className = 'layer-list empty'; box.textContent = 'No competitor data loaded.'; return; }
  box.className = 'layer-list';
  box.innerHTML = state.project.competitors.map(c => `<div class="layer-row"><span class="swatch" style="background:${COLORS.competitor}"></span><div><strong>${escapeHtml(c.name)}</strong><small>${c.points.length} breadcrumb points</small></div><span></span></div>`).join('');
}

function newProject() {
  if (!confirm('Create a new empty project? The currently saved local project will be replaced.')) return;
  state.project = { version: APP_VERSION, name: 'America 250 – 2026', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), features: [], competitors: [] };
  clearSelection(); saveProject(false); renderAll(); setStatus('New project created.');
}

function wireUi() {
  document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.tab,.panel').forEach(el => el.classList.remove('active'));
    tab.classList.add('active');
    $(`${tab.dataset.tab}Panel`).classList.add('active');
  }));
  $('sidebarToggle').addEventListener('click', () => $('sidebar').classList.toggle('open'));
  $('gpxInput').addEventListener('change', event => importGpxFiles([...event.target.files]));
  $('saveButton').addEventListener('click', () => saveProject(true));
  $('exportAllButton').addEventListener('click', exportGpx);
  $('fitButton').addEventListener('click', fitMap);
  $('newProjectButton').addEventListener('click', newProject);
  $('gpsButton').addEventListener('click', startGps);
  $('projectName').addEventListener('change', () => saveProject(false));
  $('dayFilter').addEventListener('change', () => { state.settings.dayFilter = $('dayFilter').value; saveProject(false); renderAll(); });
  $('featureForm').addEventListener('submit', updateSelectedFeature);
  $('zoomFeatureButton').addEventListener('click', zoomSelected);
  $('duplicateFeatureButton').addEventListener('click', duplicateSelected);
  $('deleteFeatureButton').addEventListener('click', deleteSelected);
  $('saveTrackingSettings').addEventListener('click', () => { state.settings.inreachUrl = $('inreachUrl').value.trim(); saveProject(true); });
  $('competitorInput').addEventListener('change', e => e.target.files[0] && importCompetitorJson(e.target.files[0]));

  $('createDialog').addEventListener('close', () => {
    if ($('createDialog').returnValue !== 'default' && state.pendingLayer) {
      state.pendingLayer.remove(); state.pendingLayer = null;
    }
  });
  $('createForm').addEventListener('submit', event => {
    event.preventDefault();
    if (event.submitter && event.submitter.value === 'cancel') {
      if (state.pendingLayer) state.pendingLayer.remove();
      state.pendingLayer = null;
      $('createDialog').close('cancel');
      return;
    }
    if (!state.pendingLayer) return;
    const feature = {
      id: uid(), name: $('createName').value.trim() || 'New feature', type: $('createType').value,
      day: Number($('createDay').value), notes: $('createNotes').value.trim(), visible: true, source: 'CannonMap drawing',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), geometry: layerToGeometry(state.pendingLayer)
    };
    state.pendingLayer.remove(); state.pendingLayer = null;
    state.project.features.push(feature); saveProject(false); renderAll(); selectFeature(feature.id); $('createDialog').close('default');
    setStatus(`Created ${feature.name}.`);
  });
}

async function init() {
  await loadProject();
  initMap();
  wireUi();
  renderAll();
  setTimeout(() => { if (state.project.features.length) fitMap(); }, 200);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

init();
