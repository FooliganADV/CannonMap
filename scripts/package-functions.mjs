import {cp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'src/domain/commitment');
const target=path.join(root,'functions/src/generated/commitment');
await rm(target,{recursive:true,force:true});
await mkdir(path.dirname(target),{recursive:true});
await cp(source,target,{recursive:true});
console.log('Packaged the Commitment Engine domain for Cloud Functions.');
