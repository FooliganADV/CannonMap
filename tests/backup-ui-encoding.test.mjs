import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const textFiles=['index.html','app.js','app.css','sw.js','src/application/photo-export-service.js','src/ui/rally/presenter.js'];

test('completion and backup assets are valid UTF-8 without mojibake',async()=>{
  const contents=await Promise.all(textFiles.map(file=>readFile(new URL(`../${file}`,import.meta.url),'utf8')));
  const html=contents[0];
  assert.match(html,/<meta charset="utf-8"/i);
  assert.match(html,/Back Up Today’s Photos/);
  assert.match(html,/Calculating storage…/);
  for(let index=0;index<contents.length;index++)assert.doesNotMatch(contents[index],/â|Ã|Â|�/,`${textFiles[index]} contains mojibake`);
});

test('service worker caches the current UTF-8 backup-interface assets',async()=>{
  const sw=await readFile(new URL('../sw.js',import.meta.url),'utf8');
  assert.match(sw,/20260804-rally-stabilization-08/);
  assert.match(sw,/app\.css\?v=20260804-stabilization-08/);
  assert.match(sw,/app\.js\?v=20260804-stabilization-08/);
});
