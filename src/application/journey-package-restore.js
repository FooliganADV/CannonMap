const decoder=new TextDecoder();
import {readStoredZipBinary} from './portable-zip.js';
const json=(files,name)=>{const bytes=files.get(name);if(!bytes)throw new Error(`Project package is missing ${name}.`);try{return JSON.parse(decoder.decode(bytes));}catch{throw new Error(`Project package contains invalid ${name}.`);}};

/** Parses CannonMap's stored (uncompressed) ZIP without inflating all media. */
export async function readStoredProjectPackage(file){
  const bytes=new Uint8Array(await file.arrayBuffer()),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),files=new Map();let offset=0;
  while(offset+30<=bytes.length&&view.getUint32(offset,true)===0x04034b50){const method=view.getUint16(offset+8,true),size=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extraLength=view.getUint16(offset+28,true);if(method!==0)throw new Error('Compressed project packages are not supported by this version.');const start=offset+30+nameLength+extraLength,end=start+size;if(end>bytes.length)throw new Error('Project package is truncated.');files.set(decoder.decode(bytes.slice(offset+30,offset+30+nameLength)),bytes.slice(start,end));offset=end;}
  const project=json(files,'Project.json'),journal=json(files,'Journal.json'),settings=json(files,'Settings.json'),manifest=json(files,'project-manifest.json'),mediaIndex=json(files,'media-index.json');
  if(manifest.format!=='cannonmap-project-media-backup'||manifest.version!==1)throw new Error('Unsupported CannonMap project package.');if(String(project.projectId)!==String(manifest.projectId))throw new Error('Project package identity mismatch.');if(mediaIndex.length!==manifest.mediaCount)throw new Error('Project package media manifest mismatch.');
  const media=mediaIndex.map(record=>{const data=files.get(`media/${record.name}`);if(!data)throw new Error(`Project package is missing media/${record.name}.`);if(Number(record.size)!==data.length)throw new Error(`Project package media size mismatch: ${record.name}.`);return {...record,blob:new Blob([data],{type:record.mimeType||'application/octet-stream'})};});
  return Object.freeze({project,journal,settings,manifest,media});
}

export function createJourneyPackageRestoreService({repository}={}){
  if(!repository)throw new TypeError('repository is required.');
  return Object.freeze({
    async inspectDay(file){return readStoredDayPackage(file);},
    async restoreDay(file,{mode='cancel',recoveryProjectId=null}={}){
      let payload=await readStoredDayPackage(file);
      if(mode==='recovery-copy'){
        const projectId=String(recoveryProjectId||`${payload.manifest.projectId}-recovery-${Date.now()}`),rewrite=value=>({...value,projectId});
        payload={...payload,manifest:{...payload.manifest,projectId},projectMetadata:{...payload.projectMetadata,projectId,projectName:`${payload.projectMetadata.projectName||'CannonMap'} Recovery`,project:{...payload.projectMetadata.project,projectId,id:projectId,name:`${payload.projectMetadata.project?.name||'CannonMap'} Recovery`}},journal:payload.journal.map(rewrite),media:payload.media.map(rewrite)};
        mode='cancel';
      }
      await repository.restoreDay(payload,{mode});return payload;
    },
    async restore(file){const payload=await readStoredProjectPackage(file);await repository.restoreNew(payload);return payload;}
  });
}

const digest=async bytes=>{const hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,'0')).join('');};
export async function readStoredDayPackage(file){
  const files=await readStoredZipBinary(file),parse=name=>{const bytes=files.get(name);if(!bytes)throw new Error(`Day package is missing ${name}.`);try{return JSON.parse(decoder.decode(bytes));}catch{throw new Error(`Day package contains invalid ${name}.`);}},manifest=parse('manifest/day-manifest.json'),projectMetadata=parse('manifest/project-metadata.json'),mediaIndex=parse('manifest/media-index.json'),journal=parse('journal/Daily_Journal.json');
  if(manifest.format!=='cannonmap-day-backup'||manifest.version!==2)throw new Error('Unsupported CannonMap day package.');if(String(projectMetadata.projectId)!==String(manifest.projectId)||Number(projectMetadata.dayNumber)!==Number(manifest.dayNumber))throw new Error('Day package identity mismatch.');
  if(!Array.isArray(journal)||!Array.isArray(mediaIndex)||mediaIndex.length!==manifest.mediaCount||journal.length!==manifest.journalEventCount)throw new Error('Day package manifest count mismatch.');
  const names=new Set(),media=[];for(const record of mediaIndex){if(!record.mediaId||!record.archivePath||names.has(record.archivePath))throw new Error('Day package media index is invalid.');names.add(record.archivePath);const bytes=files.get(record.archivePath);if(!bytes?.byteLength)throw new Error(`Day package is missing media bytes: ${record.archivePath}.`);if(record.checksum?.algorithm!=='SHA-256'||await digest(bytes)!==record.checksum.value)throw new Error(`Day package checksum failed: ${record.archivePath}.`);media.push({...record,blob:new Blob([bytes],{type:record.mimeType||'application/octet-stream'})});}
  const pairGroups=new Map();for(const record of media.filter(item=>item.pairId)){if(!pairGroups.has(record.pairId))pairGroups.set(record.pairId,[]);pairGroups.get(record.pairId).push(record);}
  for(const [pairId,records] of pairGroups)if(records.length!==4||!['front','rear'].every(cameraRole=>['original','evidence'].every(role=>records.some(record=>record.cameraRole===cameraRole&&record.role===role))))throw new Error(`Day package pair relationship is incomplete: ${pairId}.`);
  return Object.freeze({manifest,projectMetadata,journal,media});
}

