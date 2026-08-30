import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const read=file=>readFile(new URL(`../${file}`,import.meta.url),'utf8');

test('0.7.21 identity and offline tactical modules are release-consistent',async()=>{
  const [packageSource,app,index,worker,targetIntelligence]=await Promise.all([
    read('package.json'),read('app.js'),read('index.html'),read('sw.js'),read('src/domain/competitors/target-intelligence.js')
  ]),packageJson=JSON.parse(packageSource);
  assert.equal(packageJson.version,'0.7.21');
  assert.match(app,/const APP_VERSION = '0\.7\.21'/);
  assert.match(app,/const BUILD_ID = '2026\.08\.30\.target-intel-final-samsung-rc-1'/);
  assert.match(app,/from '.\/src\/domain\/competitors\/target-intelligence\.js'/);
  assert.match(index,/v0\.7\.21 · 2026\.08\.30\.target-intel-final-samsung-rc-1/);
  assert.match(worker,/cannonmap-v0\.7\.21-20260830-target-intel-final-samsung-rc-1/);
  assert.match(worker,/\.\/src\/domain\/competitors\/trails\.js/);
  assert.match(worker,/\.\/src\/domain\/competitors\/target-intelligence\.js/);
  assert.match(worker,/\.\/src\/ui\/trail-intel\/tactical-presentation\.js/);
  assert.match(targetIntelligence,/export function analyzeTargetIntelligence/);
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
  assert.match(workflow,/agent\/target-intel-final-samsung-rc/);
  assert.doesNotMatch(workflow,/agent\/(?:trail-intel-field-forensics|samsung-landscape-rally-ui)/);
  assert.match(workflow,/2026\.08\.30\.target-intel-final-samsung-rc-1/);
  assert.match(workflow,/cannonmap-v0\.7\.21-20260830-target-intel-final-samsung-rc-1/);
  assert.match(workflow,/cmp app\.css \/tmp\/cannonmap-app\.css/);
  assert.match(workflow,/--commit-hash=\$\{\{ github\.sha \}\}/);
  assert.match(workflow,/Cloudflare did not return an immutable deployment URL/);
  for(const asset of ['index.html','app.js','sw.js','src/domain/competitors/target-intelligence.js','src/domain/competitors/trails.js','src/ui/trail-intel/tactical-presentation.js'])assert.match(workflow,new RegExp(asset.replaceAll('/','\\/').replaceAll('.','\\.')));
  assert.match(workflow,/cmp index\.html \/tmp\/cannonmap-index\.html/);
});

test('conservative current target intelligence is release policy while predictive semantics remain deferred',async()=>{
  const [app,policy,targetIntelligence]=await Promise.all([read('app.js'),read('docs/architecture/SAMSUNG_TRAIL_INTEL_RELEASE_POLICY.md'),read('src/domain/competitors/target-intelligence.js')]);
  assert.match(app,/target-intelligence\.js/);
  assert.match(targetIntelligence,/APPROACHING:'APPROACHING'/);
  assert.match(targetIntelligence,/STOPPED_NEAR_TARGET:'STOPPED NEAR TARGET'/);
  assert.match(policy,/Conservative target-intelligence contract/i);
  assert.match(policy,/latest accepted segment/i);
  assert.match(policy,/stale\/offline feed[\s\S]+returns UNKNOWN/i);
  assert.match(policy,/does not predict routes, ETA,[\s\S]+future behavior/i);
});
