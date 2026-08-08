/**
 * Rally checkpoint photo wiring for CannonMap composition root.
 * Sequential front→rear capture for iPhone Safari / installed PWA.
 */
import {createCheckpointPhotoService,CHECKPOINT_PHOTO_FEATURE_FLAG} from './checkpoint-photo-service.js';
import {createRallyJournalService} from './rally-journal-service.js';
import {captureSequentialPair,isCameraCaptureSupported} from './camera-capture.js';

export {CHECKPOINT_PHOTO_FEATURE_FLAG};

/**
 * Create the photo service + action handlers for the composition root.
 * @param {object} deps
 */
export function createRallyPhotoWiring({
  featureFlags,
  openIndexedDb,
  indexedDbFactory=globalThis.indexedDB,
  databaseFeatureFlag,
  createJournalRepository,
  createMediaRepository,
  observationDatabase,
  analyticsDatabase,
  createId,
  clock,
  state,
  setStatus,
  renderRallyMode,
  currentCheckpoint,
  currentProjectId
} = {}) {
  let mediaRepository = null;
  let journalService = null;
  let checkpointPhotoService = null;
  let photoCaptureAbort = null;

  function clearPendingPhotos() {
    state.pendingFrontPhoto = null;
    state.pendingRearPhoto = null;
    state.photoStatus = '';
    state.photoCapturing = false;
  }

  function isPhotoDebugMode() {
    try {
      return new URLSearchParams(location.search).has('debugPhotos')
        || globalThis.__CANNONMAP_PHOTO_DEBUG__ === true;
    } catch {
      return false;
    }
  }

  function releaseActivePhotoCapture() {
    if (photoCaptureAbort) {
      try { photoCaptureAbort.abort(); } catch {}
      photoCaptureAbort = null;
    }
    state.photoCapturing = false;
  }

  async function initializeCheckpointPhotos() {
    if (!featureFlags.isEnabled(CHECKPOINT_PHOTO_FEATURE_FLAG)) return null;
    const architectureDatabase = observationDatabase || analyticsDatabase || await openIndexedDb({
      indexedDB:indexedDbFactory,
      featureFlags: { isEnabled: key => key === databaseFeatureFlag || featureFlags.isEnabled(key) }
    });
    if (!architectureDatabase) throw new Error('IndexedDB is required for checkpoint photos.');
    if(typeof createMediaRepository!=='function'||typeof createJournalRepository!=='function'){
      throw new Error('Checkpoint photo repositories are required.');
    }
    mediaRepository = createMediaRepository({ database: architectureDatabase });
    journalService = createRallyJournalService({
      repository: createJournalRepository({ database: architectureDatabase }),
      createId,
      clock
    });
    checkpointPhotoService = createCheckpointPhotoService({
      mediaRepository,
      journalService,
      createId,
      clock,
      featureFlags
    });
    state.pendingFrontPhoto = null;
    state.pendingRearPhoto = null;
    state.photoStatus = '';
    state.photoCapturing = false;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') releaseActivePhotoCapture();
    });
    window.addEventListener('pagehide', releaseActivePhotoCapture);
    return checkpointPhotoService;
  }

  function captureFrontPhoto(file) {
    if (!checkpointPhotoService?.isEnabled()) return;
    if (!(file instanceof Blob)) return setStatus('Front photo capture failed.', true);
    state.pendingFrontPhoto = file;
    state.photoStatus = 'Front ready — capture rear';
    renderRallyMode();
  }

  function captureRearPhoto(file) {
    if (!checkpointPhotoService?.isEnabled()) return;
    if (!(file instanceof Blob)) return setStatus('Rear photo capture failed.', true);
    state.pendingRearPhoto = file;
    state.photoStatus = state.pendingFrontPhoto ? 'Both photos ready — save pair' : 'Rear ready — capture front';
    renderRallyMode();
  }

  async function submitPhotoPair() {
    if (!checkpointPhotoService?.isEnabled()) return setStatus('Checkpoint photos are disabled.', true);
    const checkpoint = currentCheckpoint();
    if (!checkpoint) return setStatus('No active checkpoint.', true);
    if (!(state.pendingFrontPhoto instanceof Blob) || !(state.pendingRearPhoto instanceof Blob)) {
      return setStatus('Capture both front and rear photos first.', true);
    }
    try {
      state.photoStatus = 'Saving pair…';
      renderRallyMode();
      const result = await checkpointPhotoService.capturePair({
        projectId: currentProjectId(),
        checkpointId: checkpoint.id,
        frontBlob: state.pendingFrontPhoto,
        rearBlob: state.pendingRearPhoto,
        source: 'rally-mode-debug'
      });
      clearPendingPhotos();
      state.photoStatus = 'Pair saved';
      renderRallyMode();
      setStatus(`Saved front + rear photos for ${checkpoint.name}.`);
      setTimeout(() => {
        if (state.photoStatus === 'Pair saved') {
          state.photoStatus = '';
          renderRallyMode();
        }
      }, 2500);
      return result;
    } catch (error) {
      state.photoStatus = 'Save failed';
      renderRallyMode();
      setStatus(`Photo pair save failed: ${error?.message || error}`, true);
    }
  }

  async function capturePhotoPair() {
    if (!checkpointPhotoService?.isEnabled()) return setStatus('Checkpoint photos are disabled.', true);
    const checkpoint = currentCheckpoint();
    if (!checkpoint) return setStatus('No active checkpoint.', true);
    if (state.photoCapturing) return;

    if (!isCameraCaptureSupported()) {
      return setStatus('Camera capture is not available in this browser. Use ?debugPhotos=1 for file inputs.', true);
    }

    if (photoCaptureAbort) {
      try { photoCaptureAbort.abort(); } catch {}
    }
    photoCaptureAbort = new AbortController();
    const { signal } = photoCaptureAbort;

    state.photoCapturing = true;
    state.photoStatus = 'Capturing front…';
    renderRallyMode();

    let frontBlob = null;
    let rearBlob = null;

    try {
      const pair = await captureSequentialPair({
        signal,
        onProgress: (phase) => {
          if (phase === 'front') state.photoStatus = 'Capturing front…';
          else if (phase === 'rear') state.photoStatus = 'Capturing rear…';
          else if (phase === 'done') state.photoStatus = 'Saving pair…';
          renderRallyMode();
        }
      });
      frontBlob = pair.frontBlob;
      rearBlob = pair.rearBlob;

      if (!(frontBlob instanceof Blob) || !(rearBlob instanceof Blob)) {
        throw new Error('Camera returned incomplete frames.');
      }

      state.photoStatus = 'Saving pair…';
      renderRallyMode();

      const result = await checkpointPhotoService.capturePair({
        projectId: currentProjectId(),
        checkpointId: checkpoint.id,
        frontBlob,
        rearBlob,
        source: 'rally-mode'
      });

      frontBlob = null;
      rearBlob = null;
      clearPendingPhotos();
      state.photoStatus = 'Pair saved';
      renderRallyMode();
      setStatus(`Saved front + rear photos for ${checkpoint.name}.`);
      setTimeout(() => {
        if (state.photoStatus === 'Pair saved') {
          state.photoStatus = '';
          renderRallyMode();
        }
      }, 2200);
      return result;
    } catch (error) {
      const aborted = error?.name === 'AbortError' || signal.aborted;
      state.photoCapturing = false;
      state.photoStatus = aborted ? 'Cancelled' : 'Capture failed';
      renderRallyMode();
      if (!aborted) {
        const msg = error?.message || String(error);
        if (/Permission|NotAllowed|denied/i.test(msg)) {
          setStatus('Camera permission denied. Enable camera access for CannonMap in Settings.', true);
        } else if (/NotFound|DevicesNotFound|no camera/i.test(msg)) {
          setStatus('No camera found on this device.', true);
        } else {
          setStatus(`Photo capture failed: ${msg}`, true);
        }
      }
      frontBlob = null;
      rearBlob = null;
    } finally {
      state.photoCapturing = false;
      photoCaptureAbort = null;
    }
  }

  function getPhotoService() {
    return checkpointPhotoService;
  }

  function photoModelFields() {
    return {
      photoCaptureEnabled: Boolean(checkpointPhotoService?.isEnabled?.()),
      photoCapturing: Boolean(state.photoCapturing),
      photoDebugMode: isPhotoDebugMode(),
      pendingFrontPhoto: state.pendingFrontPhoto || null,
      pendingRearPhoto: state.pendingRearPhoto || null,
      photoStatus: state.photoStatus || ''
    };
  }

  return Object.freeze({
    initializeCheckpointPhotos,
    capturePhotoPair,
    captureFrontPhoto,
    captureRearPhoto,
    submitPhotoPair,
    clearPendingPhotos,
    getPhotoService,
    photoModelFields,
    isPhotoDebugMode
  });
}
