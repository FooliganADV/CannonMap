import assert from 'node:assert/strict';
import test from 'node:test';
import {createPhotoExportService,photoArchiveCategory} from '../src/application/photo-export-service.js';

const u16=(bytes,offset)=>bytes[offset]|bytes[offset+1]<<8;
const u32=(bytes,offset)=>(bytes[offset]|bytes[offset+1]<<8|bytes[offset+2]<<16|bytes[offset+3]<<24)>>>0;
async function zipEntries(blob){
  const bytes=new Uint8Array(await blob.arrayBuffer()),decoder=new TextDecoder(),entries=[];let offset=0;
  while(offset+30<=bytes.length&&u32(bytes,offset)===0x04034b50){const size=u32(bytes,offset+18),nameLength=u16(bytes,offset+26),extraLength=u16(bytes,offset+28),nameStart=offset+30,dataStart=nameStart+nameLength+extraLength;entries.push({name:decoder.decode(bytes.slice(nameStart,nameStart+nameLength)),size,bytes:[...bytes.slice(dataStart,dataStart+size)]});offset=dataStart+size;}
  return entries;
}

const row=(mediaId,name,text,metadata={},checkpointId=mediaId)=>({mediaId,projectId:'project',checkpointId,role:/Evidence/.test(name)?'evidence':'original',name,blob:new Blob([text],{type:'image/jpeg'}),metadata});
const records=[
  row('cp-o','Day01_CP1.1_Original.jpg','checkpoint-original',{dayNumber:1,objectiveType:'checkpoint'}),
  row('cp-e','Day01_CP1.1_Evidence.jpg','checkpoint-evidence',{dayNumber:1,objectiveType:'checkpoint'}),
  row('hotel-o','Day01_Hotel1.5_Original.jpg','hotel-original',{dayNumber:null,eventName:'Hotel Arrival'},'hotel-1'),
  row('hotel-e','Day01_Hotel1.5_Evidence.jpg','hotel-evidence',{eventName:'Hotel Arrival'},'hotel-1'),
  row('journey-o','Day01_Journey_Original.jpg','journey-original',{},'journey:one')
];
const journal=[
  {eventType:'photo_added',references:{originalMediaId:'hotel-o',evidenceMediaId:'hotel-e'},metadata:{dayNumber:1,objectiveType:'hotel'}},
  {eventType:'photo_added',references:{originalMediaId:'journey-o'},metadata:{dayNumber:1,objectiveType:'journey'}}
];
const serviceFor=rows=>createPhotoExportService({repository:{listProjectPhotos:async()=>rows,getMedia:async id=>rows.find(item=>item.mediaId===id)}});

test('photo categories distinguish checkpoint, hotel, and Journey media without changing blobs',()=>{
  assert.equal(photoArchiveCategory(records[0]),'Checkpoints');assert.equal(photoArchiveCategory(records[2]),'Hotels');assert.equal(photoArchiveCategory(records[4]),'Journey');
});

test('Day Photos includes checkpoint, Journal-resolved hotel, and Journey media with exact names and bytes',async()=>{
  const exportResult=await serviceFor([...records,records[2]]).day('project',1,{journal}),entries=await zipEntries(exportResult.blob),expectedNames=['Checkpoints/Day01_CP1.1_Evidence.jpg','Checkpoints/Day01_CP1.1_Original.jpg','Hotels/Day01_Hotel1.5_Evidence.jpg','Hotels/Day01_Hotel1.5_Original.jpg','Journey/Day01_Journey_Original.jpg'];
  assert.equal(entries.length,5);assert.deepEqual(entries.map(entry=>entry.name).sort(),expectedNames);assert.equal(exportResult.manifest.entryCount,5);assert.equal(exportResult.manifest.totalBytes,records.reduce((sum,item)=>sum+item.blob.size,0));
  for(const entry of entries){const source=records.find(item=>entry.name.endsWith(item.name));assert.equal(entry.size,source.blob.size);assert.deepEqual(entry.bytes,[...new Uint8Array(await source.blob.arrayBuffer())]);}
});

test('Entire Rally includes every unique checkpoint, hotel, and Journey record',async()=>{
  const exportResult=await serviceFor([...records,records[0]]).rally('project',{journal}),entries=await zipEntries(exportResult.blob);assert.equal(entries.length,5);assert.equal(exportResult.manifest.entryCount,5);assert.equal(entries.filter(entry=>entry.name.startsWith('Hotels/')).length,2);assert.equal(entries.filter(entry=>entry.name.startsWith('Journey/')).length,1);
});

test('empty day and rally exports are valid empty ZIPs with zero inventory',async()=>{
  const service=serviceFor([]),day=await service.day('project',1,{journal:[]}),rally=await service.rally('project',{journal:[]});assert.deepEqual(await zipEntries(day.blob),[]);assert.deepEqual(await zipEntries(rally.blob),[]);assert.deepEqual({count:day.manifest.entryCount,bytes:day.manifest.totalBytes},{count:0,bytes:0});assert.equal(rally.manifest.entryCount,0);
});
