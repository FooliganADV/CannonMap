import {requestResult,transactionDone} from './request.js';

const STORE='missionMedia';

export class MediaPersistenceError extends Error{
  constructor(message,{cause,diagnostics={},originalMedia=null}={}){
    super(message,{cause});this.name='MediaPersistenceError';this.code='MEDIA_PERSISTENCE_FAILED';this.diagnostics=Object.freeze({...diagnostics});
    if(originalMedia)this.originalMedia=originalMedia;
  }
}

const constructorName=value=>value?.constructor?.name||typeof value;
const sourceDetails=source=>({objectConstructor:constructorName(source),objectType:globalThis.File&&source instanceof globalThis.File?'File':globalThis.Blob&&source instanceof globalThis.Blob?'Blob':constructorName(source),objectSize:Number(source?.size)||0,mimeType:String(source?.type||'application/octet-stream'),lastModified:Number(source?.lastModified)||null});

/**
 * WebKit can reject File/Blob structured cloning during an IndexedDB write. Persist exact
 * ArrayBuffer bytes and explicit file metadata; hydrate a Blob only after a successful read.
 */
export async function prepareMissionMediaRecord(record){
  const source=record?.blob;
  let binaryData=record?.binaryData;
  if(source?.arrayBuffer)binaryData=await source.arrayBuffer();
  else if(ArrayBuffer.isView(binaryData))binaryData=binaryData.buffer.slice(binaryData.byteOffset,binaryData.byteOffset+binaryData.byteLength);
  if(!(binaryData instanceof ArrayBuffer))throw new TypeError('Mission media must provide readable binary data.');
  const {blob:discarded,...plain}=record;
  return {...plain,binaryData,size:binaryData.byteLength,mimeType:String(record.mimeType||source?.type||'application/octet-stream'),sourceName:String(record.sourceName||source?.name||''),sourceConstructor:String(record.sourceConstructor||constructorName(source)),lastModified:Number(record.lastModified??source?.lastModified)||null};
}

export function hydrateMissionMediaRecord(record){
  if(!record)return null;
  if(globalThis.Blob&&record.blob instanceof globalThis.Blob)return record;
  const binaryData=record.binaryData;
  if(!(binaryData instanceof ArrayBuffer)&&!ArrayBuffer.isView(binaryData))return record;
  return {...record,blob:new Blob([binaryData],{type:record.mimeType||'application/octet-stream'})};
}

const bytesOf=async record=>new Uint8Array(await hydrateMissionMediaRecord(record).blob.arrayBuffer());
async function verifyRecord(expected,stored){
  if(!stored)throw new Error(`Media verification could not reopen ${expected.mediaId}.`);
  const expectedBytes=await bytesOf(expected),storedBytes=await bytesOf(stored);
  if(storedBytes.byteLength!==expectedBytes.byteLength||stored.size!==expected.size||stored.mimeType!==expected.mimeType||stored.name!==expected.name||stored.lastModified!==expected.lastModified)throw new Error(`Media metadata verification failed for ${expected.mediaId}.`);
  for(let index=0;index<expectedBytes.length;index++)if(expectedBytes[index]!==storedBytes[index])throw new Error(`Media byte verification failed for ${expected.mediaId}.`);
  return hydrateMissionMediaRecord(stored);
}

const browserDetails=()=>({browser:globalThis.navigator?.userAgent||'Unavailable',appVersion:globalThis.navigator?.appVersion||'Unavailable'});
function wrapPersistenceError(error,context,originalMedia=null){
  if(error instanceof MediaPersistenceError){if(originalMedia&&!error.originalMedia)error.originalMedia=originalMedia;return error;}
  const diagnostics={exceptionName:error?.name||constructorName(error),exceptionMessage:error?.message||String(error),stackTrace:error?.stack||'Unavailable',objectStore:STORE,...browserDetails(),...context};
  return new MediaPersistenceError('Photo could not be saved.',{cause:error,diagnostics,originalMedia});
}

async function readStored(database,mediaId){
  const transaction=database.transaction(STORE,'readonly'),done=transactionDone(transaction),row=await requestResult(transaction.objectStore(STORE).get(String(mediaId)));await done;return row||null;
}

/** Durable project-scoped photo assets. Journal and Backup retain references only. */
export function createMissionMediaRepository({database,createId,clock}={}){
  if(!database||typeof createId!=='function'||!clock)throw new TypeError('database, createId, and clock are required.');
  const commit=async({records,updates=[]})=>{
    const prepared=await Promise.all(records.map(prepareMissionMediaRecord)),preparedUpdates=await Promise.all(updates.map(prepareMissionMediaRecord));
    const transaction=database.transaction(STORE,'readwrite'),done=transactionDone(transaction),store=transaction.objectStore(STORE),state={value:'active'};
    transaction.addEventListener?.('complete',()=>{state.value='complete';});transaction.addEventListener?.('abort',()=>{state.value='aborted';});transaction.addEventListener?.('error',()=>{state.value='error';});
    try{
      for(const record of prepared)await requestResult(store.add(record));
      for(const record of preparedUpdates)await requestResult(store.put(record));
      await done;state.value='complete';
      const verified=[];for(const record of prepared)verified.push(await verifyRecord(record,await readStored(database,record.mediaId)));
      for(const record of preparedUpdates)await verifyRecord(record,await readStored(database,record.mediaId));
      return verified;
    }catch(error){
      try{transaction.abort();}catch(_){ }await done.catch(()=>{});
      const source=records[0]?.blob,details=sourceDetails(source);
      throw wrapPersistenceError(error,{...details,transactionState:state.value,operation:updates.length?'add-and-update':'add'});
    }
  };
  return Object.freeze({
    async addOriginal({projectId,checkpointId,journalEventId,originalFile,metadata={},filenames={},identities={}}){
      if(!projectId||!checkpointId||!journalEventId||!originalFile)throw new TypeError('Original photo context is required.');
      const mediaGroupId=identities.mediaGroupId||createId(),mediaId=identities.originalMediaId||createId(),capturedAt=metadata.capturedAt||clock.iso();
      const record={projectId:String(projectId),checkpointId:String(checkpointId),journalEventId:String(journalEventId),mediaGroupId,capturedAt,
        metadata:structuredClone(metadata),mediaId,kind:'photo',role:'original',mimeType:String(originalFile.type||'image/jpeg'),
        name:String(filenames.original||originalFile.name||`${mediaId}.jpg`),sourceName:String(originalFile.name||''),size:Number(originalFile.size)||0,blob:originalFile,lastModified:Number(originalFile.lastModified)||null,
        pairedMediaId:identities.evidenceMediaId||null,evidenceStatus:'pending'};
      return (await commit({records:[record]}))[0];
    },
    async addEvidence({original,evidenceBlob,filename,evidenceMediaId}){
      if(!original?.mediaId||!evidenceBlob)throw new TypeError('Stored original and evidence image are required.');
      const mediaId=evidenceMediaId||original.pairedMediaId||createId(),evidence={...original,mediaId,role:'evidence',mimeType:'image/jpeg',name:String(filename||`${mediaId}.jpg`),size:Number(evidenceBlob.size)||0,
        blob:evidenceBlob,lastModified:null,sourceConstructor:constructorName(evidenceBlob),pairedMediaId:original.mediaId,evidenceStatus:'complete'};
      const originalUpdate={...original,pairedMediaId:mediaId,evidenceStatus:'complete'};
      try{return (await commit({records:[evidence],updates:[originalUpdate]}))[0];}catch(error){throw wrapPersistenceError(error,{...sourceDetails(evidenceBlob),transactionState:error.diagnostics?.transactionState||'unknown',operation:'add-evidence'},original);}
    },
    async markEvidenceFailed(mediaId,error){
      const record=await readStored(database,String(mediaId));if(!record)return null;
      const update={...record,evidenceStatus:'failed',evidenceError:String(error||'Evidence generation failed.')};
      const transaction=database.transaction(STORE,'readwrite'),done=transactionDone(transaction);await requestResult(transaction.objectStore(STORE).put(update));await done;return hydrateMissionMediaRecord(record);
    },
    async addEvidencePair({projectId,checkpointId,journalEventId,originalFile,evidenceBlob,metadata={},filenames={},identities={}}){
      if(!projectId||!checkpointId||!journalEventId||!originalFile||!evidenceBlob)throw new TypeError('Evidence photo context and both images are required.');
      const mediaGroupId=identities.mediaGroupId||createId(),originalMediaId=identities.originalMediaId||createId(),evidenceMediaId=identities.evidenceMediaId||createId(),capturedAt=metadata.capturedAt||clock.iso(),common={projectId:String(projectId),checkpointId:String(checkpointId),journalEventId:String(journalEventId),mediaGroupId,capturedAt,metadata:structuredClone(metadata)};
      const original={...common,mediaId:originalMediaId,kind:'photo',role:'original',mimeType:String(originalFile.type||'image/jpeg'),name:String(filenames.original||originalFile.name||`${originalMediaId}.jpg`),sourceName:String(originalFile.name||''),size:Number(originalFile.size)||0,blob:originalFile,lastModified:Number(originalFile.lastModified)||null,pairedMediaId:evidenceMediaId};
      const evidence={...common,mediaId:evidenceMediaId,kind:'photo',role:'evidence',mimeType:'image/jpeg',name:String(filenames.evidence||`${evidenceMediaId}.jpg`),size:Number(evidenceBlob.size)||0,blob:evidenceBlob,lastModified:null,pairedMediaId:originalMediaId};
      const [storedOriginal,storedEvidence]=await commit({records:[original,evidence]}),reference=record=>Object.freeze({mediaId:record.mediaId,mediaGroupId,uri:`media://${record.mediaId}`,kind:'photo',role:record.role,mimeType:record.mimeType,name:record.name,size:record.size,capturedAt,pairedMediaId:record.pairedMediaId});
      return Object.freeze({mediaGroupId,original:reference(storedOriginal),evidence:reference(storedEvidence),metadata:structuredClone(metadata)});
    },
    async addPhoto({projectId,checkpointId,journalEventId,file}){
      if(!projectId||!checkpointId||!journalEventId||!file)throw new TypeError('Photo context and file are required.');
      const mediaId=createId(),capturedAt=clock.iso(),record={mediaId,projectId:String(projectId),checkpointId:String(checkpointId),journalEventId:String(journalEventId),kind:'photo',mimeType:String(file.type||'application/octet-stream'),name:String(file.name||`${mediaId}.jpg`),sourceName:String(file.name||''),size:Number(file.size)||0,capturedAt,blob:file,lastModified:Number(file.lastModified)||null};
      const stored=(await commit({records:[record]}))[0];return Object.freeze({mediaId,uri:`media://${mediaId}`,kind:'photo',mimeType:stored.mimeType,name:stored.name,size:stored.size,capturedAt});
    },
    async listCheckpointPhotos(projectId,checkpointId){const transaction=database.transaction(STORE,'readonly'),done=transactionDone(transaction),rows=await requestResult(transaction.objectStore(STORE).index('projectCheckpoint').getAll([String(projectId),String(checkpointId)]));await done;return rows.map(hydrateMissionMediaRecord);},
    async listProjectPhotos(projectId){const transaction=database.transaction(STORE,'readonly'),done=transactionDone(transaction),rows=await requestResult(transaction.objectStore(STORE).index('projectId').getAll(String(projectId)));await done;return rows.map(hydrateMissionMediaRecord);},
    async listAllPhotos(){const transaction=database.transaction(STORE,'readonly'),done=transactionDone(transaction),rows=await requestResult(transaction.objectStore(STORE).getAll());await done;return rows.map(hydrateMissionMediaRecord);},
    async getMedia(mediaId){return hydrateMissionMediaRecord(await readStored(database,mediaId));},
    async discardEvidence(evidenceMediaId,originalMediaId,error){
      const original=await readStored(database,originalMediaId),transaction=database.transaction(STORE,'readwrite'),done=transactionDone(transaction),store=transaction.objectStore(STORE);store.delete(String(evidenceMediaId));
      if(original)store.put({...original,evidenceStatus:'failed',evidenceError:String(error||'Evidence verification failed.')});await done;
    },
    async deleteEvidencePair(pair){if(!pair?.original?.mediaId||!pair?.evidence?.mediaId)throw new TypeError('A complete evidence pair is required.');const transaction=database.transaction(STORE,'readwrite'),done=transactionDone(transaction),store=transaction.objectStore(STORE);store.delete(pair.original.mediaId);store.delete(pair.evidence.mediaId);await done;}
  });
}
