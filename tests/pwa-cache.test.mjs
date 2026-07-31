import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const normalize=value=>value.replace(/^[.][/\\]/,'').replaceAll('\\','/').split('?')[0];
const imports=/\b(?:import|export)\s+(?:[^'"]*?\s+from\s*)?['"]([^'"]+)['"]/g;

async function cacheManifest(){
  const source=await readFile('sw.js','utf8');
  const cache=source.match(/const CACHE = '([^']+)'/)?.[1];
  const shell=[...source.matchAll(/^\s*'([^']+)',?$/gm)].map(match=>normalize(match[1]));
  return {cache,shell:new Set(shell),source};
}

async function requiredModuleGraph(entry,shell,visited=new Set()){
  const module=normalize(entry);
  if(visited.has(module)||!module.endsWith('.js'))return visited;
  visited.add(module);
  const source=await readFile(module,'utf8');
  for(const match of source.matchAll(imports)){
    if(!match[1].startsWith('.'))continue;
    const target=normalize(path.posix.join(path.posix.dirname(module),match[1]));
    assert.ok(shell.has(target),`${module} requires ${target}, but it is absent from the service-worker application shell`);
    await requiredModuleGraph(target,shell,visited);
  }
  return visited;
}

test('service-worker shell contains the complete local startup module graph',async()=>{
  const {shell}=await cacheManifest();
  const graph=await requiredModuleGraph('app.js',shell);
  for(const required of [
    'src/infrastructure/indexeddb/index.js',
    'src/infrastructure/indexeddb/repositories.js',
    'src/infrastructure/indexeddb/confidence-vector-repository.js',
    'src/infrastructure/indexeddb/intelligence-repository.js'
  ])assert.ok(graph.has(required),`${required} must be reachable and cached for fresh offline startup`);
  for(const foundationModule of [
    'src/domain/journal/model.js',
    'src/application/rally-journal-service.js',
    'src/infrastructure/indexeddb/journal-repository.js'
  ])assert.ok(shell.has(foundationModule),`${foundationModule} must be cached for offline journal consumers`);
});

test('post-M10 cache identifier advances without deleting IndexedDB data',async()=>{
  const {cache,source}=await cacheManifest();
  assert.notEqual(cache,'cannonmap-v0.7.1-20260726-06');
  assert.equal(cache,'cannonmap-v0.7.1-20260730-rally-journal-foundation-01');
  assert.doesNotMatch(source,/indexedDB\.deleteDatabase|deleteDatabase\s*\(/);
  assert.doesNotMatch(source,/localStorage\.clear|caches\.delete\([^)]*CannonMapDB/);
});
