import {access, readFile} from 'node:fs/promises';

const assets=[
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/layers.png',
  'vendor/leaflet/images/layers-2x.png',
  'vendor/leaflet/images/marker-icon-2x.png',
  'vendor/leaflet/images/marker-icon.png',
  'vendor/leaflet/images/marker-shadow.png',
  'vendor/leaflet-geoman/leaflet-geoman.min.js',
  'vendor/leaflet-geoman/leaflet-geoman.css',
  'vendor/xlsx/xlsx.full.min.js',
  'vendor/firebase/firebase-app.js',
  'vendor/firebase/firebase-database.js',
  'vendor/firebase/firebase-auth.js',
  'vendor/firebase/firebase-app-check.js'
];

await Promise.all(assets.map(asset=>access(asset)));
const shell=await readFile('index.html','utf8');
const runtimeCdns=[/unpkg\.com\/leaflet/i,/unpkg\.com\/@geoman-io/i,/cdn\.jsdelivr\.net\/npm\/xlsx/i,/gstatic\.com\/firebasejs/i];
if(runtimeCdns.some(pattern=>pattern.test(shell)))throw new Error('Required runtime CDN reference remains in index.html');
console.log(`Validated ${assets.length} local vendor assets and no required runtime CDN references.`);
