import test from 'node:test';
import assert from 'node:assert/strict';
import {stopStream, isCameraCaptureSupported} from '../src/application/camera-capture.js';

test('isCameraCaptureSupported is false without mediaDevices', () => {
  // In Node test environment there is no navigator.mediaDevices.
  assert.equal(isCameraCaptureSupported(), false);
});

test('stopStream tolerates null and empty tracks', () => {
  assert.doesNotThrow(() => stopStream(null));
  assert.doesNotThrow(() => stopStream(undefined));
  const stopped = [];
  const stream = {
    getTracks: () => [
      { stop: () => stopped.push(1) },
      { stop: () => stopped.push(2) }
    ]
  };
  stopStream(stream);
  assert.deepEqual(stopped, [1, 2]);
});
