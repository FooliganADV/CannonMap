const STATUS=Object.freeze({READY:'ready',NEEDS_PERMISSION:'needs-permission',UNSUPPORTED:'unsupported',FAILED:'failed'});
const BACKUP_DIRECTORY_KEY='cannonmap-external-backup-directory';
const message=error=>String(error?.message||error||'External backup failed');
const text=value=>String(value??'').trim();
const safeName=(value,fallback='CannonMap')=>text(value).normalize('NFKD').replace(/[^a-z0-9._-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,150)||fallback;
const defaultHash=async blob=>{const digest=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');};
const binaryValue=value=>globalThis.Blob&&value instanceof globalThis.Blob||value instanceof ArrayBuffer||ArrayBuffer.isView(value);
function withoutBinary(value,seen=new WeakMap()){
  if(value==null||typeof value!=='object')return value;if(binaryValue(value))return undefined;if(seen.has(value))return seen.get(value);
  const copy=Array.isArray(value)?[]:{};seen.set(value,copy);if(Array.isArray(value)){for(const item of value){const clean=withoutBinary(item,seen);if(clean!==undefined)copy.push(clean);}return copy;}
  for(const [key,item] of Object.entries(value)){const clean=withoutBinary(item,seen);if(clean!==undefined)copy[key]=clean;}return copy;
}

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

function collisionName(filename,index){
  const suffix=`_${String(index).padStart(2,'0')}`;
  if(/_Backup\.cmapday\.zip$/i.test(filename))return filename.replace(/(_Backup\.cmapday\.zip)$/i,`${suffix}$1`);
  return filename.includes('.')?filename.replace(/(?=\.[^.]+$)/,suffix):`${filename}${suffix}`;
}
async function unusedFilename(directory,requested){
  for(let index=1;index<100;index++){
    const candidate=index===1?requested:collisionName(requested,index);
    try{await directory.getFileHandle(candidate);}
    catch(error){if(error?.name==='NotFoundError'||error?.name==='TypeMismatchError')return candidate;throw error;}
  }
  throw new Error('External backup filename collision limit reached.');
}

const missing=error=>error?.name==='NotFoundError'||error?.name==='TypeMismatchError';
async function readFileHandle(directory,name){try{return await directory.getFileHandle(name);}catch(error){if(missing(error))return null;throw error;}}
async function verifiedFile(fileHandle,{size,checksum,hash}){
  if(!fileHandle)return null;const file=await fileHandle.getFile();if(Number(file.size)!==Number(size))return null;return await hash(file)===checksum?file:null;
}
async function contentTarget(directory,requested,expected,hash){
  for(let index=1;index<100;index++){
    const name=index===1?requested:collisionName(requested,index),handle=await readFileHandle(directory,name),file=await verifiedFile(handle,{...expected,hash});
    if(file)return {name,handle,file,reused:true};if(!handle)return {name,handle:null,file:null,reused:false};
  }
  throw new Error('External backup media collision limit reached.');
}
const mediaFilename=record=>`Media_${safeName(record.mediaId,'media').slice(0,48)}_${text(record.checksum?.value).slice(0,16)}_${safeName(record.name||`${record.mediaId}.jpg`,'photo.jpg').slice(0,80)}`;
async function cleanStalePartials(directory){
  if(typeof directory?.values!=='function')return {incompletePartialCount:null,cleanedPartialCount:0};
  let found=0,cleaned=0;
  try{for await(const entry of directory.values()){if(entry?.kind&&entry.kind!=='file'||!String(entry?.name||'').endsWith('.partial'))continue;found++;if(typeof directory.removeEntry!=='function')continue;try{await directory.removeEntry(entry.name);cleaned++;}catch{}}}
  catch{return {incompletePartialCount:null,cleanedPartialCount:cleaned};}
  return {incompletePartialCount:found-cleaned,cleanedPartialCount:cleaned};
}
const combinePartialResults=(prior,current)=>({
  cleanedPartialCount:(Number(prior?.cleanedPartialCount)||0)+(Number(current?.cleanedPartialCount)||0),
  incompletePartialCount:current?.incompletePartialCount==null?null:Number(current.incompletePartialCount)
});

/**
 * Samsung Chrome File System Access adapter. Permission is requested only from
 * chooseDirectoryFromUserGesture; unattended writes merely query permission.
 */
export function createFileSystemBackupAdapter({
  handleRepository,
  showDirectoryPicker=globalThis.showDirectoryPicker?.bind(globalThis),
  createId=()=>globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`,
  clock={iso:()=>new Date().toISOString()},
  hash=defaultHash
}={}){
  if(!handleRepository||typeof handleRepository.get!=='function'||typeof handleRepository.save!=='function')throw new TypeError('A directory-handle repository is required.');

  const load=()=>handleRepository.get(BACKUP_DIRECTORY_KEY);
  const requirePermission=async directory=>{const current=await permission(directory);if(current!=='granted')throw Object.assign(new Error('External backup needs folder permission.'),{code:'EXTERNAL_BACKUP_PERMISSION_REQUIRED',permission:current});return current;};

  async function writeNewVerified(directory,{filename,blob,verify}){
    const tempName=`.${filename}.${createId()}.partial`;let tempHandle=null,finalHandle=null,finalizedBy='copy';
    try{
      await requirePermission(directory);tempHandle=await directory.getFileHandle(tempName,{create:true});await requirePermission(directory);await writeBlob(tempHandle,blob);await reopenAndVerify(tempHandle,blob.size,verify);
      if(typeof tempHandle.move==='function'){
        try{await requirePermission(directory);await tempHandle.move(filename);finalHandle=await directory.getFileHandle(filename);finalizedBy='move';}catch(error){if(error?.code==='EXTERNAL_BACKUP_PERMISSION_REQUIRED')throw error;}
      }
      if(!finalHandle){await requirePermission(directory);finalHandle=await directory.getFileHandle(filename,{create:true});await requirePermission(directory);await writeBlob(finalHandle,blob);}
      const file=await reopenAndVerify(finalHandle,blob.size,verify);if(finalizedBy!=='move')try{await directory.removeEntry?.(tempName);}catch{}
      return {file,finalHandle,finalizedBy};
    }catch(error){
      try{if(tempHandle)await directory.removeEntry?.(tempName);}catch{}
      try{if(finalHandle)await directory.removeEntry?.(filename);}catch{}
      throw error;
    }
  }

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

  async function writeVerifiedGeneration({sessionDirectoryName,generationFilename,manifest,media=[],openMedia}={}){
    if(!sessionDirectoryName||!generationFilename||!manifest||!Array.isArray(media)||typeof openMedia!=='function')throw new TypeError('Incremental external backup requires session directory, generation manifest, media descriptors, and a media loader.');
    const stored=await load(),directory=stored?.handle,current=await permission(directory);
    if(!directory||current!=='granted')return Object.freeze({status:STATUS.NEEDS_PERMISSION,supported:Boolean(directory||typeof showDirectoryPicker==='function'),configured:Boolean(directory),permission:directory?current:'none',priorVerifiedPreserved:true});
    const sessionName=safeName(sessionDirectoryName,'CannonMap_Session'),manifestRequested=safeName(generationFilename,'Generation.cmapbackup.json');let sessionDirectory=null,writtenMediaCount=0,reusedMediaCount=0,partialRecovery={incompletePartialCount:null,cleanedPartialCount:0};
    try{
      await requirePermission(directory);if(typeof directory.getDirectoryHandle!=='function')throw new Error('Selected backup folder does not support session directories.');
      sessionDirectory=await directory.getDirectoryHandle(sessionName,{create:true});partialRecovery=await cleanStalePartials(sessionDirectory);const committedMedia=[];
      for(const reference of [...media].sort((a,b)=>text(a.mediaId).localeCompare(text(b.mediaId)))){
        const mediaId=text(reference?.mediaId),size=Number(reference?.size),checksum=text(reference?.checksum?.value).toLowerCase();
        if(!mediaId||!Number.isFinite(size)||size<1||reference?.checksum?.algorithm!=='SHA-256'||!/^[a-f0-9]{64}$/.test(checksum))throw new Error(`External backup media descriptor is invalid: ${mediaId||'unknown'}.`);
        await requirePermission(directory);const requested=mediaFilename({...reference,mediaId,checksum:{algorithm:'SHA-256',value:checksum}}),target=await contentTarget(sessionDirectory,requested,{size,checksum},hash);
        if(target.reused)reusedMediaCount+=1;
        else{
          const blob=await openMedia(reference);if(!(blob instanceof Blob)||blob.size!==size||await hash(blob)!==checksum)throw new Error(`External backup source checksum failed: ${mediaId}.`);
          await writeNewVerified(sessionDirectory,{filename:target.name,blob,verify:async file=>{if(!await verifiedFile({getFile:async()=>file},{size,checksum,hash}))throw new Error(`External backup media verification failed: ${mediaId}.`);}});writtenMediaCount+=1;
        }
        committedMedia.push({...withoutBinary(reference),archivePath:undefined,relativePath:target.name,checksum:{algorithm:'SHA-256',value:checksum},size});
      }
      const manifestName=await unusedFilename(sessionDirectory,manifestRequested),committedManifest={...withoutBinary(manifest),mediaCount:committedMedia.length,media:committedMedia.map(item=>Object.fromEntries(Object.entries(item).filter(([,value])=>value!==undefined))),externalLayout:{version:1,sessionDirectory:sessionName,manifestFilename:manifestName,mediaStorage:'individual-files',commitMarker:'manifest-written-last',...partialRecovery}},manifestBlob=new Blob([JSON.stringify(committedManifest,null,2)],{type:'application/json;charset=utf-8'}),manifestChecksum=await hash(manifestBlob);
      await requirePermission(directory);const finalized=await writeNewVerified(sessionDirectory,{filename:manifestName,blob:manifestBlob,verify:async file=>{if(await hash(file)!==manifestChecksum)throw new Error('External generation manifest checksum failed.');let reopened;try{reopened=JSON.parse(await file.text());}catch{throw new Error('External generation manifest is invalid JSON.');}const journalCount=Array.isArray(reopened.journal)?reopened.journal.length:0,checksummedMedia=Array.isArray(reopened.media)&&reopened.media.every(item=>item?.mediaId&&Number(item?.size)>0&&item?.checksum?.algorithm==='SHA-256'&&/^[a-f0-9]{64}$/.test(text(item.checksum.value).toLowerCase())&&item?.relativePath);if(reopened.format!=='cannonmap-incremental-session-backup'||reopened.version!==1||text(reopened.generationId)!==text(committedManifest.generationId)||text(reopened.sessionId)!==text(committedManifest.sessionId)||Number(reopened.journalEventCount)!==journalCount||Number(reopened.mediaCount)!==committedMedia.length||!Array.isArray(reopened.media)||reopened.media.length!==committedMedia.length||!checksummedMedia)throw new Error('External generation manifest identity, Journal, media count, or checksum verification failed.');}});
      await handleRepository.save({...stored,key:BACKUP_DIRECTORY_KEY,handle:directory,directoryName:directory.name||stored.directoryName||null,permission:'granted',lastVerifiedAt:clock.iso(),lastFilename:`${sessionName}/${manifestName}`,lastSessionDirectory:sessionName,updatedAt:clock.iso()});
      return Object.freeze({status:STATUS.READY,supported:true,configured:true,permission:'granted',filename:`${sessionName}/${manifestName}`,sessionDirectoryName:sessionName,size:finalized.file.size,verified:true,finalizedBy:'incremental-files',writtenMediaCount,reusedMediaCount,mediaCount:committedMedia.length,...partialRecovery,manifestChecksum,manifest:committedManifest});
    }catch(error){
      if(sessionDirectory)partialRecovery=combinePartialResults(partialRecovery,await cleanStalePartials(sessionDirectory));
      const latestPermission=await permission(directory),permissionRequired=error?.code==='EXTERNAL_BACKUP_PERMISSION_REQUIRED'||latestPermission!=='granted';
      return Object.freeze({status:permissionRequired?STATUS.NEEDS_PERMISSION:STATUS.FAILED,supported:true,configured:true,permission:latestPermission,sessionDirectoryName:sessionName,error:message(error),priorVerifiedPreserved:true,resumeSupported:true,committed:false,writtenMediaCount,reusedMediaCount,...partialRecovery});
    }
  }

  return Object.freeze({
    inspect,chooseDirectoryFromUserGesture,writeVerified,writeVerifiedGeneration,
    async forgetDirectory(){await handleRepository.clear?.(BACKUP_DIRECTORY_KEY);return inspect();}
  });
}

export {BACKUP_DIRECTORY_KEY,STATUS as FILE_SYSTEM_BACKUP_STATUS};
