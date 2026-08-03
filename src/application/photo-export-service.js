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

export async function createStoredZip(files){
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
    async day(projectId,dayNumber){const rows=(await records(projectId)).filter(item=>Number(item.metadata?.dayNumber)===Number(dayNumber));return {blob:await createStoredZip(rows.map(item=>({name:item.name,blob:item.blob}))),filename:`Day${String(dayNumber).padStart(2,'0')}_Photos.zip`};},
    async rally(projectId){const rows=await records(projectId);return {blob:await createStoredZip(rows.map(item=>({name:item.name,blob:item.blob}))),filename:'Entire_Rally_Photos.zip'};}
  });
}
