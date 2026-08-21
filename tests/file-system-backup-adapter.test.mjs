import assert from 'node:assert/strict';
import test from 'node:test';
import {createFileSystemBackupAdapter} from '../src/infrastructure/browser/file-system-backup-adapter.js';

const filename='CannonMap_America250_D01_Run01_2026-08-20_183012-123_Backup.cmapday.zip';

function directory({permission='granted',failFinalWrite=false,corruptFinal=false,withMove=false}={}){
  const files=new Map(),writes=[];
  const handle={name:'CannonMap Backups',async queryPermission(){return permission;},async requestPermission(){permission='granted';return permission;},
    async getFileHandle(name,{create=false}={}){
      if(!files.has(name)&&!create)throw new DOMException('Missing','NotFoundError');
      if(!files.has(name))files.set(name,new Blob([]));
      const fileHandle={name,
        async createWritable(){return {async write(blob){writes.push(name);if(failFinalWrite&&name===filename)throw new Error('disk removed');files.set(name,corruptFinal&&name===filename?new Blob(['bad']):blob);},async close(){},async abort(){}};},
        async getFile(){return files.get(name);}
      };
      if(withMove)fileHandle.move=async newName=>{files.set(newName,files.get(name));files.delete(name);};
      return fileHandle;
    },
    async removeEntry(name){files.delete(name);}
  };
  return {handle,files,writes,setPermission(value){permission=value;}};
}

function repository(initial=null){let row=initial;return {async get(){return row;},async save(value){row=value;return value;},async clear(){row=null;},value:()=>row};}
const verifier=async blob=>{if(await blob.text()!=='complete archive')throw new Error('archive verification failed');};

test('unsupported browser exposes one permission-needed/unsupported state without breaking backup',async()=>{
  const adapter=createFileSystemBackupAdapter({handleRepository:repository(),showDirectoryPicker:null});
  assert.deepEqual(await adapter.inspect(),{status:'unsupported',supported:false,configured:false,permission:'unavailable'});
});

test('chosen directory handle is saved and reused for unattended verified writes',async()=>{
  const fs=directory(),repo=repository(),adapter=createFileSystemBackupAdapter({handleRepository:repo,showDirectoryPicker:async()=>fs.handle,createId:()=> 'temp'});
  assert.equal((await adapter.chooseDirectoryFromUserGesture()).status,'ready');assert.equal(repo.value().handle,fs.handle);
  const result=await adapter.writeVerified({filename,blob:new Blob(['complete archive']),verify:verifier});
  assert.equal(result.status,'ready');assert.equal(result.verified,true);assert.equal(await fs.files.get(filename).text(),'complete archive');assert.equal([...fs.files.keys()].some(name=>name.endsWith('.partial')),false);
});

test('revoked directory permission is not silently requested during unattended write',async()=>{
  const fs=directory({permission:'denied'}),repo=repository({key:'cannonmap-external-backup-directory',handle:fs.handle}),adapter=createFileSystemBackupAdapter({handleRepository:repo,showDirectoryPicker:async()=>fs.handle});
  const result=await adapter.writeVerified({filename,blob:new Blob(['complete archive']),verify:verifier});
  assert.deepEqual({status:result.status,permission:result.permission},{status:'needs-permission',permission:'denied'});assert.equal(fs.writes.length,0);
});

test('partial external write preserves prior verified backup and removes temporary marker',async()=>{
  const fs=directory({failFinalWrite:true}),prior='CannonMap_prior_Backup.cmapday.zip';fs.files.set(prior,new Blob(['prior verified']));
  const adapter=createFileSystemBackupAdapter({handleRepository:repository({key:'cannonmap-external-backup-directory',handle:fs.handle}),showDirectoryPicker:async()=>fs.handle,createId:()=> 'temp'}),result=await adapter.writeVerified({filename,blob:new Blob(['complete archive']),verify:verifier});
  assert.equal(result.status,'failed');assert.equal(result.priorVerifiedPreserved,true);assert.equal(await fs.files.get(prior).text(),'prior verified');assert.equal([...fs.files.keys()].some(name=>name.endsWith('.partial')),false);
});

test('external verification failure never reports success and does not overwrite prior backup',async()=>{
  const fs=directory({corruptFinal:true}),prior='CannonMap_prior_Backup.cmapday.zip';fs.files.set(prior,new Blob(['prior verified']));
  const adapter=createFileSystemBackupAdapter({handleRepository:repository({key:'cannonmap-external-backup-directory',handle:fs.handle}),showDirectoryPicker:async()=>fs.handle,createId:()=> 'temp'}),result=await adapter.writeVerified({filename,blob:new Blob(['complete archive']),verify:verifier});
  assert.equal(result.status,'failed');assert.match(result.error,/size mismatch|verification failed/);assert.equal(await fs.files.get(prior).text(),'prior verified');
});

test('supported move finalization reopens and verifies the renamed archive',async()=>{
  const fs=directory({withMove:true}),adapter=createFileSystemBackupAdapter({handleRepository:repository({key:'cannonmap-external-backup-directory',handle:fs.handle}),showDirectoryPicker:async()=>fs.handle,createId:()=> 'temp'}),result=await adapter.writeVerified({filename,blob:new Blob(['complete archive']),verify:verifier});
  assert.equal(result.status,'ready');assert.equal(result.finalizedBy,'move');assert.equal(await fs.files.get(filename).text(),'complete archive');
});
