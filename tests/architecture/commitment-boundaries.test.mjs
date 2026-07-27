import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

test('Commitment Engine has no UI, route-family, intent, notification, or publication dependency',async()=>{
  const directory=new URL('../../src/domain/commitment/',import.meta.url);
  const files=(await readdir(directory)).filter(file=>file.endsWith('.js'));
  const source=(await Promise.all(files.map(file=>readFile(new URL(file,directory),'utf8')))).join('\n');
  const imports=[...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(match=>match[1]);
  for(const prohibited of ['/ui/','domain/routes','route-family','user-intent','notification','publication']){
    assert.equal(imports.some(specifier=>specifier.includes(prohibited)),false,`Commitment Engine imported prohibited dependency: ${prohibited}`);
  }
});

test('application and UI do not consume Commitment Engine shadow output',async()=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
  const files=[path.join(root,'app.js'),path.join(root,'src/application'),path.join(root,'src/ui')];
  const collect=async entry=>{
    const metadata=await stat(entry);
    if(metadata.isFile())return [entry];
    const children=await readdir(entry,{withFileTypes:true});
    const nested=[];
    for(const child of children){
      const childPath=path.join(entry,child.name);
      if(child.isDirectory())nested.push(...await collect(childPath));
      else if(child.name.endsWith('.js'))nested.push(childPath);
    }
    return nested;
  };
  const sourceFiles=(await Promise.all(files.map(collect))).flat();
  const source=(await Promise.all(sourceFiles.map(file=>readFile(file,'utf8')))).join('\n');
  assert.equal(source.includes('commitmentInferences'),false);
  assert.equal(source.includes('domain/commitment'),false);
});
