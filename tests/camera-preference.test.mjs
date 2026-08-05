import assert from 'node:assert/strict';
import test from 'node:test';
import {cameraCaptureAttribute,cameraSelectionMetadata,normalizeCameraPreference} from '../src/domain/media/camera-preference.js';

test('camera preference defaults to selfie and maps to advisory capture attributes',()=>{
  assert.equal(normalizeCameraPreference(), 'front');
  assert.equal(cameraCaptureAttribute(), 'user');
  assert.equal(cameraCaptureAttribute('front'), 'user');
  assert.equal(cameraCaptureAttribute('rear'), 'environment');
});

test('camera metadata is honest about browser fallback and records detectable lenses',()=>{
  assert.deepEqual(cameraSelectionMetadata('front',{}),{requestedCamera:'front',actualCamera:'unknown',cameraSelectionHonored:'unknown'});
  assert.deepEqual(cameraSelectionMetadata('front',{cameraFacingMode:'environment'}),{requestedCamera:'front',actualCamera:'rear',cameraSelectionHonored:false});
  assert.deepEqual(cameraSelectionMetadata('rear',{actualCamera:'rear'}),{requestedCamera:'rear',actualCamera:'rear',cameraSelectionHonored:true});
});
