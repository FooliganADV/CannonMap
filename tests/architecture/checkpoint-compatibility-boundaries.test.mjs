import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const readTree=async root=>{
  const output=[];
  for(const entry of await readdir(root,{withFileTypes:true})){
    const target=path.join(root,entry.name);
    if(entry.isDirectory())output.push(...await readTree(target));
    else if(/\.[cm]?js$/.test(entry.name))output.push([target,await readFile(target,'utf8')]);
  }
  return output;
};

test('M10 domain has no UI, publication, notification, Firebase, or application dependency',async()=>{
  const files=[...await readTree('src/domain/checkpoints'),...await readTree('src/domain/compatibility'),...await readTree('src/domain/network')];
  const source=files.map(([,text])=>text).join('\n');
  assert.doesNotMatch(source,/(?:src\/ui|app\.js|leaflet|firebase|notification|publication|co-driver)/i);
});

test('app.js and production UI do not consume M10 shadow output',async()=>{
  const files=[...await readTree('src/application'),...await readTree('src/ui'),['app.js',await readFile('app.js','utf8')]];
  for(const [file,source] of files)assert.doesNotMatch(source,/domain\/(?:compatibility|network)|checkpointAggregateRevisions|compatibilitySuggestions/,`${file} must not consume M10 output`);
});

test('M10 production source has no combined confidence implementation',async()=>{
  const files=[...await readTree('src/domain/checkpoints'),...await readTree('src/domain/compatibility'),...await readTree('src/domain/network')];
  const source=files.map(([,text])=>text).join('\n');
  assert.doesNotMatch(source,/(?:overallConfidence|combinedConfidence|aggregateConfidence|totalConfidence|confidenceScore)\s*[:=]/);
});

test('Intelligence Network has no automatic mutation entry point',async()=>{
  const source=await readFile('src/domain/network/network.js','utf8');
  assert.match(source,/explicit-user-command/);
  const advisoryBody=source.match(/export function assertSuggestionDoesNotMutateNetwork[\s\S]*?\n}/)?.[0]||'';
  assert.match(advisoryBody,/return snapshot/);
  assert.doesNotMatch(advisoryBody,/applyNetworkCommand|members\.(?:set|delete)/);
});

test('M10 projections are server-only and network commands remain owner-scoped',async()=>{
  const rules=JSON.parse(await readFile('database.rules.json','utf8')).rules;
  for(const key of ['checkpointAggregateRevisions','checkpointAggregateHeads','sequenceAggregateRevisions','sequenceAggregateHeads','compatibilityRevisions','compatibilityHeads','compatibilitySuggestions']){
    assert.equal(rules[key]['.read'],false); assert.equal(rules[key]['.write'],false);
  }
  assert.match(rules.networkCommands.$uid.$commandId['.write'],/auth\.uid === \$uid/);
  assert.match(rules.networkCommands.$uid.$commandId['.write'],/auth\.token\.events/);
});
