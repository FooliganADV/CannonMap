import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';

const source='src/domain/commitment',target='functions/src/generated/commitment';
const files=(await readdir(source)).sort();
const packaged=(await readdir(target)).sort();
if(JSON.stringify(files)!==JSON.stringify(packaged))throw new Error('Packaged Commitment Engine file list is stale.');
for(const file of files){
  const [left,right]=await Promise.all([readFile(path.join(source,file)),readFile(path.join(target,file))]);
  if(!left.equals(right))throw new Error(`Packaged Commitment Engine is stale: ${file}`);
}
console.log(`Validated ${files.length} packaged Commitment Engine modules.`);
