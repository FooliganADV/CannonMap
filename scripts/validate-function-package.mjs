import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';

for(const domain of ['commitment','routes']){
  const source=`src/domain/${domain}`,target=`functions/src/generated/${domain}`;
  const files=(await readdir(source)).sort();
  const packaged=(await readdir(target)).sort();
  if(JSON.stringify(files)!==JSON.stringify(packaged))throw new Error(`Packaged ${domain} file list is stale.`);
  for(const file of files){
    const [left,right]=await Promise.all([readFile(path.join(source,file)),readFile(path.join(target,file))]);
    if(!left.equals(right))throw new Error(`Packaged ${domain} domain is stale: ${file}`);
  }
  console.log(`Validated ${files.length} packaged ${domain} modules.`);
}
