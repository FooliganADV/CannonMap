const STATUS=Object.freeze({READY:'ready',NEEDS_PERMISSION:'needs-permission',UNSUPPORTED:'unsupported',FAILED:'failed'});
const BACKUP_DIRECTORY_KEY='cannonmap-external-backup-directory';
const message=error=>String(error?.message||error||'External backup failed');

async function permission(handle,method='queryPermission'){
  if(!handle||typeof handle[method]!=='function')return 'unavailable';
  try{return await handle[method]({mode:'readwrite'});}catch{return 'unavailable';}
}

async function writeBlob(handle,blob){
  const writable=await handle.createWritable({keepExistingData:false});
  try{await writable.write(blob);await writable.close();}
  catch(error){try{await writable.abort?.();}catch{/* Best effort partial cleanup. */}throw error;}
}

async function reopenAndVerify(fileHandle,expectedBytes,verify){
  const file=await fileHandle.getFile();
  if(Number(file.size)!==Number(expectedBytes))throw new Error(`External backup size mismatch: expected ${expectedBytes}, reopened ${file.size}.`);
  await verify(file);
  return file;
}

const collisionName=(filename,index)=>filename.replace(/(_Backup\.cmapday\.zip)$/i,`_${String(index).padStart(2,'0')}$1`);
async function unusedFilename(directory,requested){
  for(let index=1;index<100;index++){
    const candidate=index===1?requested:collisionName(requested,index);
    try{await directory.getFileHandle(candidate);}
    catch(error){if(error?.name==='NotFoundError'||error?.name==='TypeMismatchError')return candidate;throw error;}
  }
  throw new Error('External backup filename collision limit reached.');
}

/**
 * Samsung Chrome File System Access adapter. Permission is requested only from
 * chooseDirectoryFromUserGesture; unattended writes merely query permission.
 */
export function createFileSystemBackupAdapter({
  handleRepository,
  showDirectoryPicker=globalThis.showDirectoryPicker?.bind(globalThis),
  createId=()=>globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`,
  clock={iso:()=>new Date().toISOString()}
}={}){
  if(!handleRepository||typeof handleRepository.get!=='function'||typeof handleRepository.save!=='function')throw new TypeError('A directory-handle repository is required.');

  const load=()=>handleRepository.get(BACKUP_DIRECTORY_KEY);

  async function inspect(){
    const stored=await load(),handle=stored?.handle||null;
    if(!handle)return typeof showDirectoryPicker==='function'
      ?Object.freeze({status:STATUS.NEEDS_PERMISSION,supported:true,configured:false,permission:'none'})
      :Object.freeze({status:STATUS.UNSUPPORTED,supported:false,configured:false,permission:'unavailable'});
    const current=await permission(handle);
    if(current==='granted')return Object.freeze({status:STATUS.READY,supported:true,configured:true,permission:current,directoryName:handle.name||stored.directoryName||null});
    return Object.freeze({status:STATUS.NEEDS_PERMISSION,supported:true,configured:true,permission:current,directoryName:handle.name||stored.directoryName||null});
  }

  async function chooseDirectoryFromUserGesture(){
    if(typeof showDirectoryPicker!=='function')return Object.freeze({status:STATUS.UNSUPPORTED,supported:false,configured:false,permission:'unavailable'});
    const handle=await showDirectoryPicker({id:'cannonmap-backups',mode:'readwrite',startIn:'documents'});
    let current=await permission(handle);
    if(current!=='granted')current=await permission(handle,'requestPermission');
    if(current!=='granted')return Object.freeze({status:STATUS.NEEDS_PERMISSION,supported:true,configured:false,permission:current});
    await handleRepository.save({key:BACKUP_DIRECTORY_KEY,handle,directoryName:handle.name||null,permission:'granted',updatedAt:clock.iso()});
    return inspect();
  }

  async function writeVerified({filename,blob,verify}){
    if(!filename||!(blob instanceof Blob)||typeof verify!=='function')throw new TypeError('External backup requires filename, Blob, and verifier.');
    const stored=await load(),directory=stored?.handle,current=await permission(directory);
    if(!directory||current!=='granted')return Object.freeze({status:STATUS.NEEDS_PERMISSION,supported:Boolean(directory||typeof showDirectoryPicker==='function'),configured:Boolean(directory),permission:directory?current:'none'});
    const finalName=await unusedFilename(directory,filename),tempName=`.${finalName}.${createId()}.partial`;
    let tempHandle=null,finalHandle=null,finalizedBy='copy';
    try{
      tempHandle=await directory.getFileHandle(tempName,{create:true});
      await writeBlob(tempHandle,blob);
      await reopenAndVerify(tempHandle,blob.size,verify);
      if(typeof tempHandle.move==='function'){
        try{
          await tempHandle.move(finalName);
          finalHandle=await directory.getFileHandle(finalName);
          finalizedBy='move';
        }catch{/* User-selected directories do not consistently support move(). */}
      }
      if(!finalHandle){
        finalHandle=await directory.getFileHandle(finalName,{create:true});
        await writeBlob(finalHandle,blob);
      }
      const file=await reopenAndVerify(finalHandle,blob.size,verify);
      if(finalizedBy!=='move')await directory.removeEntry?.(tempName).catch?.(()=>{});
      await handleRepository.save({...stored,key:BACKUP_DIRECTORY_KEY,handle:directory,directoryName:directory.name||stored.directoryName||null,permission:'granted',lastVerifiedAt:clock.iso(),lastFilename:finalName,updatedAt:clock.iso()});
      return Object.freeze({status:STATUS.READY,supported:true,configured:true,permission:'granted',filename:finalName,size:file.size,verified:true,finalizedBy});
    }catch(error){
      try{if(tempHandle)await directory.removeEntry?.(tempName);}catch{/* A partial marker may remain for later rider cleanup. */}
      try{if(finalHandle)await directory.removeEntry?.(finalName);}catch{/* Best effort removal of an unverified new file. */}
      // A new, unique final filename is never used as the next backup target;
      // previously verified files are therefore left untouched.
      return Object.freeze({status:STATUS.FAILED,supported:true,configured:true,permission:'granted',filename:finalName,error:message(error),priorVerifiedPreserved:true});
    }
  }

  return Object.freeze({
    inspect,chooseDirectoryFromUserGesture,writeVerified,
    async forgetDirectory(){await handleRepository.clear?.(BACKUP_DIRECTORY_KEY);return inspect();}
  });
}

export {BACKUP_DIRECTORY_KEY,STATUS as FILE_SYSTEM_BACKUP_STATUS};
