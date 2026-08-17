import {CHECKPOINT_EVIDENCE_SCHEMA_VERSION,checkpointEvidenceState} from '../domain/checkpoints/evidence.js';

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

const binaryValue=value=>typeof Blob!=='undefined'&&value instanceof Blob||typeof ArrayBuffer!=='undefined'&&(value instanceof ArrayBuffer||ArrayBuffer.isView(value));
const durable=value=>JSON.parse(JSON.stringify(value,(key,current)=>key==='_layer'||typeof current==='function'||typeof current==='symbol'||binaryValue(current)?undefined:current));
const checkpointEvidenceProjection=feature=>durable(checkpointEvidenceState(feature));
const checkpointManifestState=feature=>{
  const evidence=checkpointEvidenceProjection(feature);
  return {id:feature.id,type:feature.type,status:feature.status,order:feature.checkpointOrder??feature.importOrder??null,points:feature.points??null,pointsAwarded:evidence.completion.pointsAwarded,
    photoRequired:evidence.photo.required,pairId:evidence.photo.pairId||feature.photoPairId||feature.photoPair?.pairId||feature.pendingPhotoPair?.pairId||null,
    arrivalState:evidence.arrival.state,photoEvidenceState:evidence.photo.state,finalCompletionState:evidence.completion.state,checkpointEvidence:evidence};
};
const journalEvidenceCounts=journal=>({
  arrival:journal.filter(event=>event?.eventType==='checkpoint_arrival').length,
  photoIncomplete:journal.filter(event=>event?.eventType==='checkpoint_photo_evidence_incomplete').length,
  photoRecovered:journal.filter(event=>event?.eventType==='checkpoint_photo_evidence_recovered').length,
  completed:journal.filter(event=>['checkpoint_completed','hotel_arrival'].includes(event?.eventType)&&event?.metadata?.objectiveCompletion!==false).length
});
const referenceMediaIds=(value,key='',ids=[])=>{
  if(value==null||binaryValue(value))return ids;
  if(Array.isArray(value)){for(const item of value)referenceMediaIds(item,key,ids);return ids;}
  if(typeof value==='object'){for(const [childKey,child] of Object.entries(value))referenceMediaIds(child,childKey,ids);return ids;}
  if(/(?:media|photo)id$/i.test(key)||/(?:media|photo)ids$/i.test(key))ids.push(String(value));
  return ids;
};
const mediaIdsForEvent=event=>[...new Set(referenceMediaIds({references:event?.references,attachments:event?.attachments}))];
function journalMediaMetadata(journal=[]){
  const byId=new Map(),byPairId=new Map();for(const event of journal){const metadata={...(event.metadata||{}),objectiveType:event.metadata?.objectiveType||null};for(const mediaId of mediaIdsForEvent(event))byId.set(mediaId,metadata);const pairId=event?.references?.pairId||event?.metadata?.pairId;if(pairId)byPairId.set(String(pairId),metadata);}return {byId,byPairId};
}
const roleAlias=value=>{const role=String(value||'').trim().toLowerCase();if(['front','user','selfie','rider'].includes(role))return 'front';if(['rear','environment','forward','road'].includes(role))return 'rear';return null;};
const logicalSideFor=value=>roleAlias(value)==='front'?'rider':roleAlias(value)==='rear'?'road':null;
/** Normalizes new road/rider pairs and legacy front/rear records without renaming media. */
export function normalizeMediaExportRecord(record={}){
  const metadata={...(record.metadata||{})},pairId=record.pairId||metadata.pairId||null,explicitRole=record.cameraRole||metadata.cameraRole||record.orientation||metadata.orientation||record.logicalSide||metadata.logicalSide||record.captureSide||metadata.captureSide,cameraRole=roleAlias(explicitRole||metadata.requestedCamera)||(/(?:^|[_-])front(?:[_-]|\.)/i.test(String(record.name||''))?'front':/(?:^|[_-])rear(?:[_-]|\.)/i.test(String(record.name||''))?'rear':null),logicalSide=logicalSideFor(record.logicalSide||metadata.logicalSide||record.captureSide||metadata.captureSide||cameraRole),pairMetadata={...metadata};
  if(pairId){pairMetadata.pairId=pairId;if(cameraRole)pairMetadata.cameraRole=cameraRole;if(logicalSide)pairMetadata.logicalSide=logicalSide;}
  return {...record,pairId,cameraRole,logicalSide,metadata:pairMetadata};
}
function resolvedMediaRecord(record,journalIndex){
  const normalized=normalizeMediaExportRecord(record),journal=journalIndex.byId.get(String(normalized.mediaId))||journalIndex.byPairId.get(String(normalized.pairId))||{},metadata={...journal,...normalized.metadata};
  if(!Number.isFinite(Number(metadata.dayNumber))||Number(metadata.dayNumber)<1)metadata.dayNumber=journal.dayNumber??null;
  if(!metadata.objectiveType&&journal.objectiveType)metadata.objectiveType=journal.objectiveType;
  return normalizeMediaExportRecord({...normalized,metadata});
}
export function photoArchiveCategory(record){
  const type=String(record.metadata?.objectiveType||'').toLowerCase(),eventName=String(record.metadata?.eventName||'').toLowerCase(),checkpointId=String(record.checkpointId||'').toLowerCase();
  if(type==='journey'||checkpointId.startsWith('journey:')||eventName==='journey photo')return 'Journey';
  if(type==='hotel'||eventName==='hotel arrival'||/_hotel/i.test(String(record.name||'')))return 'Hotels';
  return 'Checkpoints';
}
function archiveRows(rows,journal=[]){
  const journalIndex=journalMediaMetadata(journal),seen=new Set();return rows.filter(record=>{const id=String(record.mediaId||'');if(!id||seen.has(id))return false;seen.add(id);return true;}).map(record=>resolvedMediaRecord(record,journalIndex));
}
function photoZipFiles(rows){
  const used=new Map();return rows.map(record=>{const base=`${photoArchiveCategory(record)}/${record.name}`,count=used.get(base)||0;used.set(base,count+1);const name=count?base.replace(/(?=\.[^.]+$)/,`_${String(count+1).padStart(2,'0')}`):base;return {name,blob:record.blob,mediaId:record.mediaId,size:Number(record.blob?.size)||0,record};});
}

const exportError=(code,message,details={})=>Object.assign(new Error(message),{code,...details});
const sha256=async blob=>{const bytes=blob instanceof Uint8Array?blob:new Uint8Array(await blob.arrayBuffer()),hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,'0')).join('');};
const jsonFile=(name,value)=>({name,blob:new Blob([JSON.stringify(value,null,2)],{type:'application/json;charset=utf-8'})});
const mediaIndexEntry=async file=>{const {blob,...record}=file.record,{metadata={}}=record;return {archivePath:file.name,mediaId:String(file.mediaId),mediaGroupId:record.mediaGroupId||null,pairId:record.pairId||null,pairStatus:record.pairStatus||null,cameraRole:record.cameraRole||null,logicalSide:record.logicalSide||null,mediaRole:record.role||null,pairedMediaId:record.pairedMediaId||null,journalEventId:record.journalEventId||null,pairJournalEventId:record.pairJournalEventId||null,objectiveType:metadata.objectiveType||null,dayNumber:Number(metadata.dayNumber)||null,mimeType:record.mimeType||blob?.type||null,name:record.name,size:file.size,checksum:{algorithm:'SHA-256',value:await sha256(file.blob)}};};
async function photoArchiveFiles(rows,{scope,dayNumber=null}={}){
  const mediaFiles=photoZipFiles(rows),entries=[];for(const file of mediaFiles)entries.push(await mediaIndexEntry(file));
  const manifest={format:'cannonmap-photo-archive',version:2,scope,dayNumber:dayNumber==null?null:Number(dayNumber),mediaCount:mediaFiles.length,originalCount:entries.filter(item=>item.mediaRole==='original').length,evidenceCount:entries.filter(item=>item.mediaRole==='evidence').length,pairCount:new Set(entries.map(item=>item.pairId).filter(Boolean)).size,entries},files=mediaFiles.map(({record,...file})=>file);
  if(files.length)files.push(jsonFile('manifest/photo-media-index.json',manifest));
  return {files,mediaFiles,manifest};
}
async function verifiedPhotoArchive(files,{storedMediaCount,dayNumber=null,mediaFileCount=files.length}={}){
  if(!mediaFileCount)throw exportError(storedMediaCount?'PHOTO_EXPORT_DAY_EMPTY':'PHOTO_EXPORT_NO_MEDIA',storedMediaCount?`Photo export failed. ${storedMediaCount} stored media files were found, but none matched Day ${dayNumber}.`:'Photo export stopped: no stored media files were found.',{storedMediaCount,dayNumber});
  const empty=files.filter(file=>!file.blob||Number(file.blob.size)<1);if(empty.length)throw exportError('PHOTO_EXPORT_EMPTY_ENTRY',`Photo export failed. ${empty.length} media files contain no readable bytes.`,{mediaIds:empty.map(file=>file.mediaId).filter(Boolean)});
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
    async single(mediaId){const record=await repository.getMedia(mediaId);if(!record)throw new Error('Photo is unavailable.');return {blob:record.blob,filename:record.name,metadata:durable(normalizeMediaExportRecord(record))};},
    async day(projectId,dayNumber,{journal=[]}={}){const all=archiveRows(await records(projectId),journal),rows=all.filter(item=>Number(item.metadata?.dayNumber)===Number(dayNumber)),archive=await photoArchiveFiles(rows,{scope:'day',dayNumber}),blob=await verifiedPhotoArchive(archive.files,{storedMediaCount:all.length,dayNumber,mediaFileCount:archive.mediaFiles.length});return {blob,filename:`Day${String(dayNumber).padStart(2,'0')}_Photos.zip`,manifest:{...archive.manifest,entryCount:archive.mediaFiles.length,archiveEntryCount:archive.files.length,totalBytes:archive.mediaFiles.reduce((sum,file)=>sum+file.size,0)}};},
    async dayBackup(projectId,dayNumber,{journal=[],project=null,settings={},applicationVersion=null,buildId=null}={}){
      const day=Number(dayNumber),all=archiveRows(await records(projectId),journal),rows=all.filter(item=>Number(item.metadata?.dayNumber)===day);
      if(!project?.projectId||String(project.projectId)!==String(projectId))throw exportError('DAY_BACKUP_PROJECT_INVALID','Day backup failed because the active Project identity could not be verified.');
      if(!rows.length&&all.length)throw exportError('DAY_BACKUP_MEDIA_MISMATCH',`Day backup failed verification. ${all.length} stored media files exist, but none matched Day ${day}.`);
      if(rows.some(row=>!row.blob||Number(row.blob.size)<1))throw exportError('DAY_BACKUP_MEDIA_EMPTY','Day backup failed verification because stored media contain no readable bytes.');
      const used=new Map(),mediaFiles=[],mediaIndex=[];
      for(const row of rows){const category=photoArchiveCategory(row),base=`media/${category}/${row.name}`,count=used.get(base)||0;used.set(base,count+1);const archivePath=count?base.replace(/(?=\.[^.]+$)/,`_${String(count+1).padStart(2,'0')}`):base,checksum=await sha256(row.blob),{blob,...record}=row;mediaFiles.push({name:archivePath,blob});mediaIndex.push({...record,archivePath,checksum:{algorithm:'SHA-256',value:checksum}});}
      const exportedJournal=durable(journal),dayFeatures=durable((project.features||[]).filter(item=>Number(item.day)===day)),durableProject=durable(project),createdAt=new Date().toISOString(),checkpointStates=dayFeatures.map(checkpointManifestState),checkpointEvidence=checkpointStates.map(item=>({id:item.id,...item.checkpointEvidence})),projectMetadata={projectId:String(projectId),projectName:project.name||null,executionId:project.executionId||project.rallyExecution?.executionId||null,finalizedMasterId:project.finalizedMasterId||project.sourceMasterId||null,dayNumber:day,project:durableProject,dayFeatures,checkpointEvidenceSchemaVersion:CHECKPOINT_EVIDENCE_SCHEMA_VERSION,checkpointEvidence,settings:durable(settings),createdAt};
      const manifest={format:'cannonmap-day-backup',version:2,checkpointEvidenceSchemaVersion:CHECKPOINT_EVIDENCE_SCHEMA_VERSION,projectId:String(projectId),projectName:project.name||null,executionId:projectMetadata.executionId,finalizedMasterId:projectMetadata.finalizedMasterId,dayNumber:day,createdAt,applicationVersion,buildId,mediaCount:rows.length,originalCount:rows.filter(item=>item.role==='original').length,evidenceCount:rows.filter(item=>item.role==='evidence').length,pairCount:new Set(rows.map(item=>item.pairId).filter(Boolean)).size,journalEventCount:exportedJournal.length,journalEvidenceCounts:journalEvidenceCounts(exportedJournal),checkpointStates,dayState:project.rallyExecution?.days?.[day]||settings.rallyDays?.[day]||null};
      const files=[...mediaFiles,jsonFile('manifest/day-manifest.json',manifest),jsonFile('manifest/project-metadata.json',projectMetadata),jsonFile('manifest/media-index.json',mediaIndex),jsonFile('journal/Daily_Journal.json',exportedJournal)];
      const blob=await createStoredZip(files),reopened=await readStoredZipBinary(blob),required=['manifest/day-manifest.json','manifest/project-metadata.json','manifest/media-index.json','journal/Daily_Journal.json'];
      for(const name of required)if(!reopened.has(name))throw exportError('DAY_BACKUP_REQUIRED_FILE_MISSING',`Day backup failed verification: ${name} is missing.`);
      for(const name of required)try{JSON.parse(new TextDecoder().decode(reopened.get(name)));}catch{throw exportError('DAY_BACKUP_JSON_INVALID',`Day backup failed verification: ${name} is invalid.`);}
      if(reopened.size!==files.length)throw exportError('DAY_BACKUP_ENTRY_MISMATCH',`Day backup failed verification. Expected ${files.length} entries but reopened ${reopened.size}.`);
      for(const item of mediaIndex){const bytes=reopened.get(item.archivePath);if(!bytes?.byteLength||await sha256(bytes)!==item.checksum.value)throw exportError('DAY_BACKUP_CHECKSUM_INVALID',`Day backup failed verification for ${item.archivePath}.`);}
      return {blob,filename:`Day${String(day).padStart(2,'0')}_Backup.cmapday.zip`,manifest,verified:true,entryCount:files.length};
    },
    async projectBackup(projectId,{journal=[],project=null,settings={}}={}){
      const rows=archiveRows(await records(projectId),journal),exportedJournal=durable(journal),createdAt=new Date().toISOString(),manifest={format:'cannonmap-project-media-backup',version:2,projectId:String(projectId),projectName:project?.name||null,createdAt,mediaCount:rows.length,originalCount:rows.filter(item=>item.role==='original').length,evidenceCount:rows.filter(item=>item.role==='evidence').length,pairCount:new Set(rows.map(item=>item.pairId).filter(Boolean)).size,journalEventCount:exportedJournal.length};
      const used=new Map(),mediaIndex=[],mediaFiles=[];for(const row of rows){const base=`media/${photoArchiveCategory(row)}/${row.name}`,count=used.get(base)||0;used.set(base,count+1);const archivePath=count?base.replace(/(?=\.[^.]+$)/,`_${String(count+1).padStart(2,'0')}`):base,{blob,...record}=row;mediaFiles.push({name:archivePath,blob});mediaIndex.push({...record,archivePath,checksum:{algorithm:'SHA-256',value:await sha256(blob)}});}
      const files=[...mediaFiles,jsonFile('Project.json',durable(project)),jsonFile('Journal.json',exportedJournal),jsonFile('Settings.json',durable(settings)),jsonFile('project-manifest.json',manifest),jsonFile('media-index.json',mediaIndex)];
      return {blob:await createStoredZip(files),filename:`${String(project?.name||'CannonMap_Project').replace(/[^a-z0-9.-]+/gi,'_')}_Backup.cmapproject`,manifest};
    },
    async rally(projectId,{journal=[]}={}){const rows=archiveRows(await records(projectId),journal),archive=await photoArchiveFiles(rows,{scope:'rally'}),blob=await verifiedPhotoArchive(archive.files,{storedMediaCount:rows.length,mediaFileCount:archive.mediaFiles.length});return {blob,filename:'Entire_Rally_Photos.zip',manifest:{...archive.manifest,entryCount:archive.mediaFiles.length,archiveEntryCount:archive.files.length,totalBytes:archive.mediaFiles.reduce((sum,file)=>sum+file.size,0)}};}
  });
}
import {inspectStoredZip,readStoredZipBinary} from './portable-zip.js';
