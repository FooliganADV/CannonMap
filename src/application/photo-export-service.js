const encoder=new TextEncoder();
const table=(()=>{const values=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;values[n]=c>>>0;}return values;})();
const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes)crc=table[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;};
const u16=value=>new Uint8Array([value&255,(value>>>8)&255]);
const u32=value=>new Uint8Array([value&255,(value>>>8)&255,(value>>>16)&255,(value>>>24)&255]);
const join=parts=>{const size=parts.reduce((sum,part)=>sum+part.length,0),out=new Uint8Array(size);let offset=0;for(const part of parts){out.set(part,offset);offset+=part.length;}return out;};

export function checkpointPhotoFilename({dayNumber,checkpointNumber,role}){
  const day=String(Number(dayNumber)||0).padStart(2,'0'),checkpoint=String(checkpointNumber||'Unknown').replace(/[^a-z0-9.-]+/gi,'_');
  return `Day${day}_CP${checkpoint}_${role==='evidence'?'Evidence':'Original'}.jpg`;
}

const mediaIdsForEvent=event=>[event?.references?.originalMediaId,event?.references?.evidenceMediaId,...(event?.attachments?.photos||[]).map(photo=>photo?.mediaId)].filter(Boolean).map(String);
function journalMediaMetadata(journal=[]){
  const byId=new Map();for(const event of journal)for(const mediaId of mediaIdsForEvent(event))byId.set(mediaId,{...(event.metadata||{}),objectiveType:event.metadata?.objectiveType||null});return byId;
}
function resolvedMediaRecord(record,journalByMediaId){
  const journal=journalByMediaId.get(String(record.mediaId))||{},metadata={...journal,...(record.metadata||{})};
  if(!Number.isFinite(Number(metadata.dayNumber))||Number(metadata.dayNumber)<1)metadata.dayNumber=journal.dayNumber??null;
  if(!metadata.objectiveType&&journal.objectiveType)metadata.objectiveType=journal.objectiveType;
  return {...record,metadata};
}
export function photoArchiveCategory(record){
  const type=String(record.metadata?.objectiveType||'').toLowerCase(),eventName=String(record.metadata?.eventName||'').toLowerCase(),checkpointId=String(record.checkpointId||'').toLowerCase();
  if(type==='journey'||checkpointId.startsWith('journey:')||eventName==='journey photo')return 'Journey';
  if(type==='hotel'||eventName==='hotel arrival'||/_hotel/i.test(String(record.name||'')))return 'Hotels';
  return 'Checkpoints';
}
function archiveRows(rows,journal=[]){
  const journalByMediaId=journalMediaMetadata(journal),seen=new Set();return rows.filter(record=>{const id=String(record.mediaId||'');if(!id||seen.has(id))return false;seen.add(id);return true;}).map(record=>resolvedMediaRecord(record,journalByMediaId));
}
function photoZipFiles(rows){
  const used=new Map();return rows.map(record=>{const base=`${photoArchiveCategory(record)}/${record.name}`,count=used.get(base)||0;used.set(base,count+1);const name=count?base.replace(/(?=\.[^.]+$)/,`_${String(count+1).padStart(2,'0')}`):base;return {name,blob:record.blob,mediaId:record.mediaId,size:Number(record.blob?.size)||0};});
}

const exportError=(code,message,details={})=>Object.assign(new Error(message),{code,...details});
const sha256=async blob=>{const bytes=blob instanceof Uint8Array?blob:new Uint8Array(await blob.arrayBuffer()),hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,'0')).join('');};
const jsonFile=(name,value)=>({name,blob:new Blob([JSON.stringify(value,null,2)],{type:'application/json;charset=utf-8'})});
const durable=value=>JSON.parse(JSON.stringify(value,(key,current)=>key==='_layer'||typeof current==='function'||typeof current==='symbol'?undefined:current));
async function verifiedPhotoArchive(files,{storedMediaCount,dayNumber=null}={}){
  if(!files.length)throw exportError(storedMediaCount?'PHOTO_EXPORT_DAY_EMPTY':'PHOTO_EXPORT_NO_MEDIA',storedMediaCount?`Photo export failed. ${storedMediaCount} stored media files were found, but none matched Day ${dayNumber}.`:'Photo export stopped: no stored media files were found.',{storedMediaCount,dayNumber});
  const empty=files.filter(file=>!file.blob||file.size<1);if(empty.length)throw exportError('PHOTO_EXPORT_EMPTY_ENTRY',`Photo export failed. ${empty.length} media files contain no readable bytes.`,{mediaIds:empty.map(file=>file.mediaId)});
  const names=files.map(file=>file.name);if(new Set(names).size!==names.length)throw exportError('PHOTO_EXPORT_DUPLICATE_NAME','Photo export failed because generated filenames are not unique.');
  const blob=await createStoredZip(files),entries=await inspectStoredZip(blob);if(entries.length!==files.length)throw exportError('PHOTO_EXPORT_ENTRY_MISMATCH',`Photo export failed. Expected ${files.length} media files, but the archive contains ${entries.length}.`);
  if(entries.some(entry=>entry.size<1))throw exportError('PHOTO_EXPORT_EMPTY_ENTRY','Photo export failed because the reopened archive contains an empty media file.');
  return blob;
}

export async function createStoredZip(files,{maxBytes=256*1024*1024}={}){
  const declaredSize=files.reduce((sum,file)=>sum+(Number(file.blob?.size)||0),0);
  if(declaredSize>maxBytes){const error=new Error('This photo archive is too large for safe in-browser creation. Export smaller day or project archives.');error.code='PHOTO_EXPORT_TOO_LARGE';error.declaredSize=declaredSize;throw error;}
  const local=[],central=[];let offset=0;
  for(const file of files){const name=encoder.encode(file.name),data=new Uint8Array(await file.blob.arrayBuffer()),crc=crc32(data);
    const header=join([u32(0x04034b50),u16(20),u16(0x0800),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),name]);
    local.push(header,data);central.push(join([u32(0x02014b50),u16(20),u16(20),u16(0x0800),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name]));offset+=header.length+data.length;
  }
  const centralBytes=join(central),end=join([u32(0x06054b50),u16(0),u16(0),u16(files.length),u16(files.length),u32(centralBytes.length),u32(offset),u16(0)]);
  return new Blob([...local,centralBytes,end],{type:'application/zip'});
}

export function createPhotoExportService({repository}={}){
  if(!repository)throw new TypeError('repository is required.');
  const records=async projectId=>(await repository.listProjectPhotos(projectId)).filter(item=>item.role==='original'||item.role==='evidence');
  return Object.freeze({
    checkpointPhotoFilename,
    async single(mediaId){const record=await repository.getMedia(mediaId);if(!record)throw new Error('Photo is unavailable.');return {blob:record.blob,filename:record.name};},
    async day(projectId,dayNumber,{journal=[]}={}){const all=archiveRows(await records(projectId),journal),rows=all.filter(item=>Number(item.metadata?.dayNumber)===Number(dayNumber)),files=photoZipFiles(rows),blob=await verifiedPhotoArchive(files,{storedMediaCount:all.length,dayNumber});return {blob,filename:`Day${String(dayNumber).padStart(2,'0')}_Photos.zip`,manifest:{dayNumber:Number(dayNumber),entryCount:files.length,totalBytes:files.reduce((sum,file)=>sum+file.size,0),entries:files.map(({name,mediaId,size})=>({name,mediaId,size}))}};},
    async dayBackup(projectId,dayNumber,{journal=[],project=null,settings={},applicationVersion=null,buildId=null}={}){
      const day=Number(dayNumber),all=archiveRows(await records(projectId),journal),rows=all.filter(item=>Number(item.metadata?.dayNumber)===day);
      if(!project?.projectId||String(project.projectId)!==String(projectId))throw exportError('DAY_BACKUP_PROJECT_INVALID','Day backup failed because the active Project identity could not be verified.');
      if(!rows.length&&all.length)throw exportError('DAY_BACKUP_MEDIA_MISMATCH',`Day backup failed verification. ${all.length} stored media files exist, but none matched Day ${day}.`);
      if(rows.some(row=>!row.blob||Number(row.blob.size)<1))throw exportError('DAY_BACKUP_MEDIA_EMPTY','Day backup failed verification because stored media contain no readable bytes.');
      const used=new Map(),mediaFiles=[],mediaIndex=[];
      for(const row of rows){const category=photoArchiveCategory(row),base=`media/${category}/${row.name}`,count=used.get(base)||0;used.set(base,count+1);const archivePath=count?base.replace(/(?=\.[^.]+$)/,`_${String(count+1).padStart(2,'0')}`):base,checksum=await sha256(row.blob),{blob,...record}=row;mediaFiles.push({name:archivePath,blob});mediaIndex.push({...record,archivePath,checksum:{algorithm:'SHA-256',value:checksum}});}
      const dayFeatures=durable((project.features||[]).filter(item=>Number(item.day)===day)),durableProject=durable({...project,features:dayFeatures}),createdAt=new Date().toISOString(),projectMetadata={projectId:String(projectId),projectName:project.name||null,executionId:project.executionId||project.rallyExecution?.executionId||null,finalizedMasterId:project.finalizedMasterId||project.sourceMasterId||null,dayNumber:day,project:durableProject,settings:durable(settings),createdAt};
      const manifest={format:'cannonmap-day-backup',version:2,projectId:String(projectId),projectName:project.name||null,executionId:projectMetadata.executionId,finalizedMasterId:projectMetadata.finalizedMasterId,dayNumber:day,createdAt,applicationVersion,buildId,mediaCount:rows.length,originalCount:rows.filter(item=>item.role==='original').length,evidenceCount:rows.filter(item=>item.role==='evidence').length,journalEventCount:journal.length,checkpointStates:dayFeatures.map(feature=>({id:feature.id,type:feature.type,status:feature.status,order:feature.checkpointOrder??feature.importOrder??null,points:feature.points??null,pairId:feature.photoPairId||feature.pendingPhotoPair?.pairId||null})),dayState:project.rallyExecution?.days?.[day]||settings.rallyDays?.[day]||null};
      const files=[...mediaFiles,jsonFile('manifest/day-manifest.json',manifest),jsonFile('manifest/project-metadata.json',projectMetadata),jsonFile('manifest/media-index.json',mediaIndex),jsonFile('journal/Daily_Journal.json',journal)];
      const blob=await createStoredZip(files),reopened=await readStoredZipBinary(blob),required=['manifest/day-manifest.json','manifest/project-metadata.json','manifest/media-index.json','journal/Daily_Journal.json'];
      for(const name of required)if(!reopened.has(name))throw exportError('DAY_BACKUP_REQUIRED_FILE_MISSING',`Day backup failed verification: ${name} is missing.`);
      for(const name of required)try{JSON.parse(new TextDecoder().decode(reopened.get(name)));}catch{throw exportError('DAY_BACKUP_JSON_INVALID',`Day backup failed verification: ${name} is invalid.`);}
      if(reopened.size!==files.length)throw exportError('DAY_BACKUP_ENTRY_MISMATCH',`Day backup failed verification. Expected ${files.length} entries but reopened ${reopened.size}.`);
      for(const item of mediaIndex){const bytes=reopened.get(item.archivePath);if(!bytes?.byteLength||await sha256(bytes)!==item.checksum.value)throw exportError('DAY_BACKUP_CHECKSUM_INVALID',`Day backup failed verification for ${item.archivePath}.`);}
      return {blob,filename:`Day${String(day).padStart(2,'0')}_Backup.cmapday.zip`,manifest,verified:true,entryCount:files.length};
    },
    async projectBackup(projectId,{journal=[],project=null,settings={}}={}){
      const rows=await records(projectId),json=(name,value)=>({name,blob:new Blob([JSON.stringify(value,null,2)],{type:'application/json;charset=utf-8'})}),manifest={format:'cannonmap-project-media-backup',version:1,projectId:String(projectId),projectName:project?.name||null,createdAt:new Date().toISOString(),mediaCount:rows.length,originalCount:rows.filter(item=>item.role==='original').length,evidenceCount:rows.filter(item=>item.role==='evidence').length};
      const mediaIndex=rows.map(({blob,...record})=>record),files=[...rows.map(item=>({name:`media/${item.name}`,blob:item.blob})),json('Project.json',project),json('Journal.json',journal),json('Settings.json',settings),json('project-manifest.json',manifest),json('media-index.json',mediaIndex)];
      return {blob:await createStoredZip(files),filename:`${String(project?.name||'CannonMap_Project').replace(/[^a-z0-9.-]+/gi,'_')}_Backup.cmapproject`,manifest};
    },
    async rally(projectId,{journal=[]}={}){const rows=archiveRows(await records(projectId),journal),files=photoZipFiles(rows),blob=await verifiedPhotoArchive(files,{storedMediaCount:rows.length});return {blob,filename:'Entire_Rally_Photos.zip',manifest:{entryCount:files.length,totalBytes:files.reduce((sum,file)=>sum+file.size,0),entries:files.map(({name,mediaId,size})=>({name,mediaId,size}))}};}
  });
}
import {inspectStoredZip,readStoredZipBinary} from './portable-zip.js';
