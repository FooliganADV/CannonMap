import assert from 'node:assert/strict';
import test from 'node:test';
import {createFileSystemBackupAdapter} from '../src/infrastructure/browser/file-system-backup-adapter.js';

const sha256=async blob=>{const value=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());return [...new Uint8Array(value)].map(byte=>byte.toString(16).padStart(2,'0')).join('');};

function fileSystem({permission='granted'}={}){
  const directories=new Map(),writes=[];let id=0;
  const makeDirectory=name=>{
    const files=new Map(),handle={name,async queryPermission(){return permission;},
      async getFileHandle(filename,{create=false}={}){
        if(!files.has(filename)&&!create)throw new DOMException('Missing','NotFoundError');if(!files.has(filename))files.set(filename,new Blob([]));
        return {name:filename,async createWritable(){return {async write(blob){writes.push(`${name}/${filename}`);files.set(filename,blob);},async close(){},async abort(){}};},async getFile(){return files.get(filename);},async move(finalName){files.set(finalName,files.get(filename));files.delete(filename);}};
      },async removeEntry(filename){files.delete(filename);},async *values(){for(const filename of files.keys())yield {kind:'file',name:filename};}
    };directories.set(name,{handle,files});return directories.get(name);
  };
  const root={name:'CannonMap Backups',async queryPermission(){return permission;},async requestPermission(){permission='granted';return permission;},
    async getDirectoryHandle(name,{create=false}={}){if(!directories.has(name)&&!create)throw new DOMException('Missing','NotFoundError');return (directories.get(name)||makeDirectory(name)).handle;},
    async getFileHandle(){throw new DOMException('Missing','NotFoundError');}
  };
  return {root,directories,writes,nextId:()=>`temp-${++id}`,setPermission:value=>{permission=value;}};
}

function repository(handle){let row={key:'cannonmap-external-backup-directory',handle};return {async get(){return row;},async save(value){row=value;return value;},async clear(){row=null;}};}

async function mediaSet(count){
  const values=[];for(let index=0;index<count;index++){const mediaId=`media-${String(index).padStart(4,'0')}`,blob=new Blob([`jpeg-${index}`],{type:'image/jpeg'});values.push({mediaId,name:`Day01_CP${index}_Rear_Original.jpg`,size:blob.size,checksum:{algorithm:'SHA-256',value:await sha256(blob)},blob});}return values;
}
const manifest=(generationId,count)=>({format:'cannonmap-incremental-session-backup',version:1,generationId,sessionId:'session-1',projectId:'project-1',dayNumber:1,journal:[{eventId:'journal-1'},{eventId:'journal-2'}],journalEventCount:2,mediaCount:count});

function adapterHarness(fs){return createFileSystemBackupAdapter({handleRepository:repository(fs.root),showDirectoryPicker:async()=>fs.root,createId:fs.nextId,hash:sha256});}
const request=(rows,generationId,openMedia)=>({sessionDirectoryName:'CannonMap_project_D01_Run01_session-1',generationFilename:`Generation_${generationId}.cmapbackup.json`,manifest:manifest(generationId,rows.length),media:rows.map(({blob,...row})=>row),openMedia:openMedia|| (async reference=>rows.find(row=>row.mediaId===reference.mediaId).blob)});

test('96-media generation writes bounded individual files and commits its manifest last',async()=>{
  const fs=fileSystem(),adapter=adapterHarness(fs),rows=await mediaSet(96);let active=0,maxActive=0,opened=0;
  const result=await adapter.writeVerifiedGeneration(request(rows,'g96',async reference=>{active++;maxActive=Math.max(maxActive,active);opened++;const blob=rows.find(row=>row.mediaId===reference.mediaId).blob;await Promise.resolve();active--;return blob;}));
  assert.equal(result.status,'ready');assert.equal(result.mediaCount,96);assert.equal(result.writtenMediaCount,96);assert.equal(result.reusedMediaCount,0);assert.equal(opened,96);assert.equal(maxActive,1);
  const directory=fs.directories.get(result.sessionDirectoryName),manifestFile=directory.files.get(result.filename.split('/').at(-1)),stored=JSON.parse(await manifestFile.text());
  assert.equal(stored.media.length,96);assert.equal(stored.externalLayout.commitMarker,'manifest-written-last');assert.ok(fs.writes.at(-1).includes('Generation_g96.cmapbackup'));
});

test('250-media interrupted generation resumes by reopening checksummed files and commits only when complete',async()=>{
  const fs=fileSystem(),adapter=adapterHarness(fs),rows=await mediaSet(250);let opened=0;
  const interrupted=await adapter.writeVerifiedGeneration(request(rows,'first',async reference=>{if(opened===100)throw new Error('device disconnected');opened++;return rows.find(row=>row.mediaId===reference.mediaId).blob;}));
  assert.equal(interrupted.status,'failed');assert.equal(interrupted.committed,false);assert.equal(interrupted.writtenMediaCount,100);const directory=fs.directories.get(interrupted.sessionDirectoryName);assert.equal([...directory.files.keys()].some(name=>name.endsWith('.cmapbackup.json')),false);
  directory.files.set('.abandoned.partial',new Blob(['incomplete']));let resumedOpens=0;const resumed=await adapter.writeVerifiedGeneration(request(rows,'resumed',async reference=>{resumedOpens++;return rows.find(row=>row.mediaId===reference.mediaId).blob;}));
  assert.equal(resumed.status,'ready');assert.equal(resumed.reusedMediaCount,100);assert.equal(resumed.writtenMediaCount,150);assert.equal(resumedOpens,150);assert.equal(resumed.cleanedPartialCount,1);assert.equal(resumed.incompletePartialCount,0);assert.equal(resumed.manifest.externalLayout.cleanedPartialCount,1);assert.equal([...directory.files.keys()].filter(name=>name.endsWith('.cmapbackup.json')).length,1);
});

test('500-media repeat skips only reopened size-and-SHA matches and never overwrites a corrupt prior file',async()=>{
  const fs=fileSystem(),adapter=adapterHarness(fs),rows=await mediaSet(500),first=await adapter.writeVerifiedGeneration(request(rows,'first'));
  assert.equal(first.status,'ready');let opens=0;const repeated=await adapter.writeVerifiedGeneration(request(rows,'second',async reference=>{opens++;return rows.find(row=>row.mediaId===reference.mediaId).blob;}));
  assert.equal(repeated.status,'ready');assert.equal(repeated.reusedMediaCount,500);assert.equal(repeated.writtenMediaCount,0);assert.equal(opens,0);
  const directory=fs.directories.get(first.sessionDirectoryName),firstMedia=first.manifest.media[0],priorName=firstMedia.relativePath,prior=directory.files.get(priorName);directory.files.set(priorName,new Blob(['x'.repeat(prior.size)]));
  const repaired=await adapter.writeVerifiedGeneration(request(rows,'third',async reference=>{opens++;return rows.find(row=>row.mediaId===reference.mediaId).blob;})),replacement=repaired.manifest.media.find(item=>item.mediaId===firstMedia.mediaId);
  assert.equal(repaired.status,'ready');assert.equal(repaired.reusedMediaCount,499);assert.equal(repaired.writtenMediaCount,1);assert.notEqual(replacement.relativePath,priorName);assert.equal(await directory.files.get(priorName).text(),'x'.repeat(prior.size));
});

test('permission revoked during media writes stops without a committed manifest and resumes after a new grant',async()=>{
  const fs=fileSystem(),adapter=adapterHarness(fs),rows=await mediaSet(96);let opened=0;
  const revoked=await adapter.writeVerifiedGeneration(request(rows,'revoked',async reference=>{opened++;if(opened===11)fs.setPermission('denied');return rows.find(row=>row.mediaId===reference.mediaId).blob;}));
  assert.equal(revoked.status,'needs-permission');assert.equal(revoked.committed,false);const directory=fs.directories.get(revoked.sessionDirectoryName);assert.equal([...directory.files.keys()].some(name=>name.endsWith('.cmapbackup.json')),false);
  fs.setPermission('granted');const resumed=await adapter.writeVerifiedGeneration(request(rows,'after-grant'));assert.equal(resumed.status,'ready');assert.ok(resumed.reusedMediaCount>=10);assert.equal(resumed.mediaCount,96);
});

test('an unremovable stale partial is reported in the committed result and manifest',async()=>{
  const fs=fileSystem(),adapter=adapterHarness(fs),rows=await mediaSet(1),first=await adapter.writeVerifiedGeneration(request(rows,'first')),directory=fs.directories.get(first.sessionDirectoryName);directory.files.set('.identified.partial',new Blob(['incomplete']));directory.handle.removeEntry=undefined;
  const next=await adapter.writeVerifiedGeneration(request(rows,'second'));assert.equal(next.status,'ready');assert.equal(next.cleanedPartialCount,0);assert.equal(next.incompletePartialCount,1);assert.equal(next.manifest.externalLayout.incompletePartialCount,1);assert.equal(directory.files.has('.identified.partial'),true);
});
