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

test('Confidence Evolution depends on no UI, runtime SDK, M10, or decision consumer',async()=>{
  const source=(await readTree('src/domain/confidence')).map(([,text])=>text).join('\n');
  assert.doesNotMatch(source,/(?:src\/ui|app\.js|firebase|notification|publication|co-driver|compatibility|checkpoint intelligence|intelligence network)/i);
});

test('UI, application, app.js, and pre-M10 domains do not consume confidence output',async()=>{
  const files=[
    ...await readTree('src/ui'),...await readTree('src/application'),
    ...await readTree('src/domain/checkpoints'),...await readTree('src/domain/commitment'),
    ...await readTree('src/domain/routes'),['app.js',await readFile('app.js','utf8')]
  ];
  for(const [file,source] of files)assert.doesNotMatch(source,/domain\/confidence|confidenceVectors|CONFIDENCE_EVOLUTION/,`${file} consumes M9 shadow output`);
});

test('production confidence source contains no scalar-combination implementation',async()=>{
  const files=await readTree('src/domain/confidence');
  const source=files.map(([,text])=>text).join('\n');
  assert.doesNotMatch(source,/(overallConfidence|totalConfidence|aggregateConfidence|compositeConfidence|weightedConfidence|normalizedConfidence|combinedConfidence)/);
  assert.doesNotMatch(source,/reduce\s*\([^)]*(?:quality|evidenceStrength|inference|historical|current|recency|stability)/);
});

test('app.js is unchanged from main and contains no confidence-domain logic',async()=>{
  const app=await readFile('app.js','utf8');
  assert.doesNotMatch(app,/domain\/confidence|confidenceVectors|confidence evolution/i);
});
