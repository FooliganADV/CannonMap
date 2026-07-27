import {cp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
for(const domain of ['commitment','routes']){
  const source=path.join(root,`src/domain/${domain}`);
  const target=path.join(root,`functions/src/generated/${domain}`);
  await rm(target,{recursive:true,force:true});
  await mkdir(path.dirname(target),{recursive:true});
  await cp(source,target,{recursive:true});
  console.log(`Packaged the ${domain} domain for Cloud Functions.`);
}
