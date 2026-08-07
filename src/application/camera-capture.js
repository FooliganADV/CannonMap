/**
 * Sequential camera capture for iOS Safari / installed PWA.
 *
 * iPhone Safari does not reliably support concurrent front + rear streams.
 * This module always captures one facingMode at a time, stops tracks
 * immediately after the frame is taken, and waits briefly before the next open.
 */

const DEFAULT_CONSTRAINTS = Object.freeze({
  audio: false,
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 }
  }
});

const SETTLE_MS = 450;
const SWITCH_DELAY_MS = 350;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Stop every track on a MediaStream (or null).
 */
export function stopStream(stream) {
  if (!stream) return;
  try {
    for (const track of stream.getTracks()) {
      try { track.stop(); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

/**
 * Capture a single JPEG blob from the requested facingMode.
 * Always releases the stream in a finally block.
 *
 * @param {'user'|'environment'} facingMode
 * @param {object} [options]
 * @param {number} [options.quality=0.85]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Blob>}
 */
export async function captureFacingMode(facingMode, options = {}) {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera is not available in this browser.');
  }

  const quality = Number.isFinite(options.quality) ? options.quality : 0.85;
  const signal = options.signal;

  if (signal?.aborted) throw new DOMException('Capture aborted', 'AbortError');

  const constraints = {
    ...DEFAULT_CONSTRAINTS,
    video: {
      ...DEFAULT_CONSTRAINTS.video,
      facingMode: { ideal: facingMode }
    }
  };

  let stream = null;
  let video = null;

  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    if (signal?.aborted) throw new DOMException('Capture aborted', 'AbortError');

    video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;

    // Wait until we have real dimensions.
    await new Promise((resolve, reject) => {
      const onReady = () => {
        cleanupListeners();
        resolve();
      };
      const onError = () => {
        cleanupListeners();
        reject(new Error('Camera preview failed to start.'));
      };
      const cleanupListeners = () => {
        video.removeEventListener('loadeddata', onReady);
        video.removeEventListener('error', onError);
      };
      video.addEventListener('loadeddata', onReady, { once: true });
      video.addEventListener('error', onError, { once: true });
      video.play().catch(onError);
    });

    // Let exposure / autofocus settle on mobile cameras.
    await sleep(SETTLE_MS);
    if (signal?.aborted) throw new DOMException('Capture aborted', 'AbortError');

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    if (width < 16 || height < 16) {
      throw new Error('Camera returned an empty frame.');
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas is unavailable.');
    ctx.drawImage(video, 0, 0, width, height);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error('Failed to encode photo.'))),
        'image/jpeg',
        quality
      );
    });

    return blob;
  } finally {
    if (video) {
      try {
        video.pause();
        video.srcObject = null;
        video.removeAttribute('src');
        video.load?.();
      } catch { /* ignore */ }
      video = null;
    }
    stopStream(stream);
    stream = null;
  }
}

/**
 * Capture a front + rear pair sequentially (required for iPhone Safari).
 * Front = user (selfie), rear = environment.
 *
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {(phase: string) => void} [options.onProgress]
 * @returns {Promise<{frontBlob: Blob, rearBlob: Blob}>}
 */
export async function captureSequentialPair(options = {}) {
  const { signal, onProgress } = options;

  onProgress?.('front');
  const frontBlob = await captureFacingMode('user', { signal });

  // Give the camera subsystem time to release the previous device.
  await sleep(SWITCH_DELAY_MS);
  if (signal?.aborted) throw new DOMException('Capture aborted', 'AbortError');

  onProgress?.('rear');
  const rearBlob = await captureFacingMode('environment', { signal });

  onProgress?.('done');
  return { frontBlob, rearBlob };
}

/**
 * Best-effort check whether getUserMedia is present.
 */
export function isCameraCaptureSupported() {
  return Boolean(
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}
