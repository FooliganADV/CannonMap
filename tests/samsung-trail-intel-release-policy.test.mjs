import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const read=file=>readFile(new URL(`../${file}`,import.meta.url),'utf8');

test('0.7.19 identity and offline tactical module are release-consistent',async()=>{
  const [packageSource,app,index,worker]=await Promise.all([
    read('package.json'),read('app.js'),read('index.html'),read('sw.js')
  ]),packageJson=JSON.parse(packageSource);
  assert.equal(packageJson.version,'0.7.19');
  assert.match(app,/const APP_VERSION = '0\.7\.19'/);
  assert.match(app,/const BUILD_ID = '2026\.08\.27\.samsung-landscape-ui-1'/);
  assert.match(index,/v0\.7\.19 · 2026\.08\.27\.samsung-landscape-ui-1/);
  assert.match(worker,/cannonmap-v0\.7\.19-20260827-samsung-landscape-ui-1/);
  assert.match(worker,/\.\/src\/ui\/trail-intel\/tactical-presentation\.js/);
});

test('Samsung mounted landscape is the sole default browser release gate',async()=>{
  const [packageSource,config,policy]=await Promise.all([
    read('package.json'),read('playwright.config.mjs'),read('docs/architecture/SAMSUNG_TRAIL_INTEL_RELEASE_POLICY.md')
  ]),packageJson=JSON.parse(packageSource);
  assert.equal(packageJson.scripts['test:browser'],'playwright test --project="Android landscape"');
  assert.equal(packageJson.scripts['test:browser:samsung'],packageJson.scripts['test:browser']);
  assert.match(config,/name:'Android landscape'/);
  assert.match(config,/viewport:\{width:915,height:412\}/);
  assert.match(config,/Sole pre-rally production release gate/);
  assert.match(config,/name:'iPhone 13 portrait'/,'legacy iOS coverage stays available');
  assert.match(policy,/iPhone and WebKit[\s\S]+informational[\s\S]+does not block\s+Samsung deployment/i);
});

test('immutable preview workflow is fenced to this isolated branch and build',async()=>{
  const workflow=await read('.github/workflows/deploy-persistent-camera-preview.yml');
  assert.match(workflow,/agent\/samsung-landscape-rally-ui/);
  assert.doesNotMatch(workflow,/agent\/samsung-field-data-hardening/);
  assert.doesNotMatch(workflow,/agent\/samsung-trail-intel-rc/);
  assert.match(workflow,/2026\.08\.27\.samsung-landscape-ui-1/);
  assert.match(workflow,/--commit-hash=\$\{\{ github\.sha \}\}/);
  assert.match(workflow,/Cloudflare did not return an immutable deployment URL/);
});

test('unsafe historical target semantics remain deliberately outside this release',async()=>{
  const [app,policy]=await Promise.all([read('app.js'),read('docs/architecture/SAMSUNG_TRAIL_INTEL_RELEASE_POLICY.md')]);
  assert.doesNotMatch(app,/target-intelligence\.js|APPROACHING TARGET|STOPPED NEAR TARGET/);
  assert.match(policy,/B - useful, deliberately deferred/i);
  assert.match(policy,/Semantic target activity, closest approach, speed, dwell/i);
});
