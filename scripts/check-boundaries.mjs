#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const SOURCE_EXTENSIONS=new Set(['.js','.mjs','.cjs']);
const IGNORED_DIRECTORIES=new Set(['.git','node_modules','vendor','playwright-report','test-results','.worktrees','.pnpm-store']);
const IMPORT_PATTERNS=[
  /\b(?:import|export)\s+(?:[^'"]*?\s+from\s*)?['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g
];

const normalize=value=>value.split(path.sep).join('/');
const relativeTo=(root,file)=>normalize(path.relative(root,file));
const isRelativeImport=value=>value.startsWith('./')||value.startsWith('../');
const resolveImport=(file,specifier)=>{
  if(!isRelativeImport(specifier))return null;
  const base=path.resolve(path.dirname(file),specifier);
  if(path.extname(base))return base;
  for(const extension of SOURCE_EXTENSIONS){
    if(fs.existsSync(base+extension))return base+extension;
    if(fs.existsSync(path.join(base,'index'+extension)))return path.join(base,'index'+extension);
  }
  return base;
};

function collectFiles(root){
  const files=[];
  const visit=directory=>{
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
      if(entry.isDirectory()&&IGNORED_DIRECTORIES.has(entry.name))continue;
      const target=path.join(directory,entry.name);
      if(entry.isDirectory())visit(target);
      else if(SOURCE_EXTENSIONS.has(path.extname(entry.name))&&!normalize(target).includes('/tests/'))files.push(target);
    }
  };
  visit(root);
  return files;
}

function importsIn(file){
  const source=fs.readFileSync(file,'utf8'),imports=[];
  for(const pattern of IMPORT_PATTERNS){
    pattern.lastIndex=0;
    let match;
    while((match=pattern.exec(source)))imports.push({specifier:match[1],index:match.index});
  }
  return imports;
}

function area(root,file){
  const rel=relativeTo(root,file);
  if(rel==='app.js'||rel==='src/bootstrap.js'||rel.startsWith('src/bootstrap/'))return 'composition';
  const match=rel.match(/^src\/(core|domain|application|infrastructure|ui|plugins)\//);
  if(match)return match[1];
  if(rel.startsWith('shared/'))return 'shared';
  return 'legacy';
}

const FORBIDDEN={
  core:new Set(['domain','application','infrastructure','ui','plugins','composition']),
  domain:new Set(['application','infrastructure','ui','plugins','composition']),
  application:new Set(['infrastructure','ui','plugins','composition']),
  infrastructure:new Set(['application','ui','plugins','composition']),
  ui:new Set(['infrastructure','plugins','composition'])
};

function pluginIdentity(root,file){
  return relativeTo(root,file).match(/^src\/plugins\/([^/]+)\//)?.[1]||null;
}

function checkRepository(root=process.cwd()){
  const resolvedRoot=path.resolve(root),violations=[];
  for(const file of collectFiles(resolvedRoot)){
    const sourceArea=area(resolvedRoot,file);
    for(const imported of importsIn(file)){
      const target=resolveImport(file,imported.specifier);
      if(!target)continue;
      const targetRel=relativeTo(resolvedRoot,target),targetArea=area(resolvedRoot,target);
      const sourceRel=relativeTo(resolvedRoot,file);
      if(targetRel==='app.js'&&sourceArea!=='composition'){
        violations.push({file:sourceRel,import:imported.specifier,rule:'modules-never-import-app',message:'Modules may never import app.js; app.js is the composition root.'});
        continue;
      }
      if(FORBIDDEN[sourceArea]?.has(targetArea)){
        violations.push({file:sourceRel,import:imported.specifier,rule:'layer-direction',message:`${sourceArea} may not depend on ${targetArea}.`});
      }
      if(sourceArea==='plugins'){
        const sourcePlugin=pluginIdentity(resolvedRoot,file),targetPlugin=pluginIdentity(resolvedRoot,target);
        if(targetPlugin&&sourcePlugin!==targetPlugin){
          violations.push({file:sourceRel,import:imported.specifier,rule:'plugin-implementation-isolation',message:`Plugin ${sourcePlugin} may not import plugin ${targetPlugin}; use a published capability interface.`});
        }else if(!targetPlugin&&targetArea!=='shared'&&!targetRel.startsWith('src/core/plugins/')){
          violations.push({file:sourceRel,import:imported.specifier,rule:'plugin-public-api-only',message:'Plugins may import only their own files, shared contracts, and src/core/plugins public interfaces.'});
        }
      }
    }
  }
  return violations;
}

function formatViolations(violations){
  if(!violations.length)return 'Architecture boundaries: OK (0 violations).';
  return [
    `Architecture boundaries: FAILED (${violations.length} violation${violations.length===1?'':'s'}).`,
    ...violations.map((item,index)=>`${index+1}. ${item.file}\n   import: ${item.import}\n   rule: ${item.rule}\n   ${item.message}`)
  ].join('\n');
}

const isMain=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(isMain){
  const root=process.argv[2]||process.cwd(),violations=checkRepository(root);
  console.log(formatViolations(violations));
  process.exitCode=violations.length?1:0;
}

export {checkRepository,collectFiles,formatViolations,importsIn};

