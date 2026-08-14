import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('manual Rally photo gate makes the full capture view the only shutter surface',()=>{
  assert.equal((html.match(/id="rallyCameraTapSurface"/g)||[]).length,1);
  assert.match(html,/id="rallyCameraTapSurface"[^>]*role="button"[^>]*tabindex="0"/);
  assert.doesNotMatch(html,/id="rallyCamera(?:CapturePair|Retry|Selfie|Forward|SavePair|OpenCamera)"/);
  assert.doesNotMatch(html,/60-second|countdown/i);
  assert.match(html,/id="rallyCameraFailObjective"[^>]*>Mark Objective Failed</);
});

test('Journey media exposes one paired Journey Photo action',()=>{
  assert.equal((html.match(/id="rallyJourneyPhotoButton"/g)||[]).length,1);
  assert.match(html,/id="rallyJourneyPhotoButton"[^>]*>Journey Photo</);
  assert.doesNotMatch(html,/id="rallyJourney(?:Selfie|Forward)Button"/);
});
