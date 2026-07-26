import {cp, mkdir, copyFile, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const vendor=path.join(root,'vendor');
const copy=async(source,destination)=>{
  const target=path.join(vendor,destination);
  await mkdir(path.dirname(target),{recursive:true});
  await copyFile(path.join(root,'node_modules',source),target);
};

await copy('leaflet/dist/leaflet.js','leaflet/leaflet.js');
await copy('leaflet/dist/leaflet.css','leaflet/leaflet.css');
await cp(path.join(root,'node_modules/leaflet/dist/images'),path.join(vendor,'leaflet/images'),{recursive:true,force:true});
const geoman=await readFile(path.join(root,'node_modules/@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.min.js'),'utf8');
await mkdir(path.join(vendor,'leaflet-geoman'),{recursive:true});
await writeFile(path.join(vendor,'leaflet-geoman/leaflet-geoman.min.js'),`if(typeof globalThis.L!=="undefined"){${geoman}}\n`);
await copy('@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css','leaflet-geoman/leaflet-geoman.css');
await copy('xlsx/dist/xlsx.full.min.js','xlsx/xlsx.full.min.js');
await copy('firebase/firebase-app.js','firebase/firebase-app.js');
await copy('firebase/firebase-database.js','firebase/firebase-database.js');
await copy('firebase/firebase-auth.js','firebase/firebase-auth.js');
await copy('firebase/firebase-app-check.js','firebase/firebase-app-check.js');

console.log('Vendored Leaflet 1.9.4, Leaflet-Geoman 2.18.3, SheetJS 0.18.5, and Firebase 8.10.0.');
