import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {checkRepository,formatViolations} from '../../scripts/check-boundaries.mjs';

const fixture=files=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cannonmap-boundaries-'));
  for(const [name,content] of Object.entries(files)){
    const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);
  }
  return root;
};

test('current repository satisfies architecture import boundaries',()=>{
  assert.deepEqual(checkRepository(path.resolve(import.meta.dirname,'../..')),[]);
});

test('allows app.js to compose lower modules',()=>{
  const root=fixture({'app.js':"import './src/domain/route.js';",'src/domain/route.js':'export default {};'});
  assert.deepEqual(checkRepository(root),[]);
});

test('rejects any module importing app.js',()=>{
  const root=fixture({'app.js':'export const state={};','src/domain/route.js':"import {state} from '../../app.js';"});
  assert.equal(checkRepository(root)[0].rule,'modules-never-import-app');
});

test('rejects lower layers importing higher layers',()=>{
  const root=fixture({'src/domain/route.js':"import '../ui/map.js';",'src/ui/map.js':'export default {};'});
  const violations=checkRepository(root);
  assert.equal(violations.length,1);assert.equal(violations[0].rule,'layer-direction');
});

test('allows domain modules to use core contracts',()=>{
  const root=fixture({'src/domain/route.js':"import '../core/clock.js';",'src/core/clock.js':'export const now=()=>0;'});
  assert.deepEqual(checkRepository(root),[]);
});

test('rejects direct cross-plugin implementation imports',()=>{
  const root=fixture({
    'src/plugins/weather/index.js':"import '../traffic/client.js';",
    'src/plugins/traffic/client.js':'export default {};'
  });
  assert.equal(checkRepository(root).some(item=>item.rule==='plugin-implementation-isolation'),true);
});

test('allows plugins to use published plugin capability interfaces',()=>{
  const root=fixture({
    'src/plugins/weather/index.js':"import '../../core/plugins/contracts.js';",
    'src/core/plugins/contracts.js':'export const API_VERSION=1;'
  });
  assert.deepEqual(checkRepository(root),[]);
});

test('reports readable violations with file, import, and rule',()=>{
  const text=formatViolations([{file:'src/domain/a.js',import:'../ui/b.js',rule:'layer-direction',message:'domain may not depend on ui.'}]);
  assert.match(text,/FAILED/);assert.match(text,/src\/domain\/a\.js/);assert.match(text,/\.\.\/ui\/b\.js/);assert.match(text,/layer-direction/);
});

