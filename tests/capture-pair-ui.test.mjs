import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('normal Rally photo gate exposes only the Capture Pair rider action',()=>{
  assert.equal((html.match(/id="rallyCameraCapturePair"/g)||[]).length,1);
  assert.match(html,/id="rallyCameraCapturePair"[^>]*>CAPTURE PAIR</);
  assert.doesNotMatch(html,/id="rallyCamera(?:Selfie|Forward|SavePair|OpenCamera)"/);
  assert.doesNotMatch(html,/60-second|countdown/i);
  assert.match(html,/id="rallyCameraRetry"[^>]*hidden/);
});
