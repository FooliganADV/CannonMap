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
function photoZipFiles(rows){return rows.map(record=>({name:`${photoArchiveCategory(record)}/${record.name}`,blob:record.blob,mediaId:record.mediaId,size:Number(record.blob?.size)||0}));}

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
    async day(projectId,dayNumber,{journal=[]}={}){const rows=archiveRows(await records(projectId),journal).filter(item=>Number(item.metadata?.dayNumber)===Number(dayNumber)),files=photoZipFiles(rows);return {blob:await createStoredZip(files),filename:`Day${String(dayNumber).padStart(2,'0')}_Photos.zip`,manifest:{dayNumber:Number(dayNumber),entryCount:files.length,totalBytes:files.reduce((sum,file)=>sum+file.size,0),entries:files.map(({name,mediaId,size})=>({name,mediaId,size}))}};},
    async dayBackup(projectId,dayNumber,{journal=[],project=null}={}){
      const rows=archiveRows(await records(projectId),journal).filter(item=>Number(item.metadata?.dayNumber)===Number(dayNumber)),json=(name,value)=>({name,blob:new Blob([JSON.stringify(value,null,2)],{type:'application/json;charset=utf-8'})});
      const mediaIndex=rows.map(({blob,...record})=>record),manifest={format:'cannonmap-day-backup',version:1,projectId:String(projectId),projectName:project?.name||null,dayNumber:Number(dayNumber),createdAt:new Date().toISOString(),mediaCount:rows.length,originalCount:rows.filter(item=>item.role==='original').length,evidenceCount:rows.filter(item=>item.role==='evidence').length};
      const files=[...rows.map(item=>({name:`media/${item.name}`,blob:item.blob})),json('Daily_Journal.json',journal),json('day-manifest.json',manifest),json('media-index.json',mediaIndex),json('project-metadata.json',{projectId,projectName:project?.name||null,features:(project?.features||[]).filter(item=>Number(item.day)===Number(dayNumber)).map(({geometry,...feature})=>feature)})];
      return {blob:await createStoredZip(files),filename:`Day${String(dayNumber).padStart(2,'0')}_Backup.cmapday`,manifest};
    },
    async projectBackup(projectId,{journal=[],project=null,settings={}}={}){
      const rows=await records(projectId),json=(name,value)=>({name,blob:new Blob([JSON.stringify(value,null,2)],{type:'application/json;charset=utf-8'})}),manifest={format:'cannonmap-project-media-backup',version:1,projectId:String(projectId),projectName:project?.name||null,createdAt:new Date().toISOString(),mediaCount:rows.length,originalCount:rows.filter(item=>item.role==='original').length,evidenceCount:rows.filter(item=>item.role==='evidence').length};
      const mediaIndex=rows.map(({blob,...record})=>record),files=[...rows.map(item=>({name:`media/${item.name}`,blob:item.blob})),json('Project.json',project),json('Journal.json',journal),json('Settings.json',settings),json('project-manifest.json',manifest),json('media-index.json',mediaIndex)];
      return {blob:await createStoredZip(files),filename:`${String(project?.name||'CannonMap_Project').replace(/[^a-z0-9.-]+/gi,'_')}_Backup.cmapproject`,manifest};
    },
    async rally(projectId,{journal=[]}={}){const files=photoZipFiles(archiveRows(await records(projectId),journal));return {blob:await createStoredZip(files),filename:'Entire_Rally_Photos.zip',manifest:{entryCount:files.length,totalBytes:files.reduce((sum,file)=>sum+file.size,0),entries:files.map(({name,mediaId,size})=>({name,mediaId,size}))}};}
  });
}
