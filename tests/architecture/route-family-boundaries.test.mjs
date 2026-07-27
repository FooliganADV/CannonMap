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

test('Route Family Engine has no UI, publication, recommendation, or M9 dependency',async()=>{
  const files=await readTree('src/domain/routes');
  const source=files.map(([,text])=>text).join('\n');
  assert.doesNotMatch(source,/(?:src\/ui|notification|publication|co-driver|recommendation|checkpoint intelligence|compatibility engine)/i);
  assert.doesNotMatch(source,/confidenceVector|overallConfidence|confidence evolution/i);
});

test('application and UI do not consume route-family shadow projections',async()=>{
  const files=[...await readTree('src/application'),...await readTree('src/ui'),['app.js',await readFile('app.js','utf8')]];
  for(const [file,source] of files){
    assert.doesNotMatch(source,/domain\/routes|routeFamilyHeads|routeAggregateProjections/,`${file} must not consume M8 shadow output`);
  }
});

test('route projection paths remain server-only under default-deny rules',async()=>{
  const rules=JSON.parse(await readFile('database.rules.json','utf8')).rules;
  for(const pathName of ['routeVariantRevisions','routeVariantHeads','routeFamilyRevisions','routeFamilyHeads','routeAggregateProjections','routeLineage','routeProposals','routeDiagnostics','routeProjectionReceipts']){
    assert.equal(rules[pathName]['.read'],false);
    assert.equal(rules[pathName]['.write'],false);
  }
});
