const decoder=new TextDecoder();
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
  return Object.freeze({async restore(file){const payload=await readStoredProjectPackage(file);await repository.restoreNew(payload);return payload;}});
}

