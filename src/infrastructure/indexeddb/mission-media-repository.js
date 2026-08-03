import {requestResult,transactionDone} from './request.js';

const STORE='missionMedia';

/** Durable project-scoped photo assets. Journal and Backup retain references only. */
export function createMissionMediaRepository({database,createId,clock}={}){
  if(!database||typeof createId!=='function'||!clock)throw new TypeError('database, createId, and clock are required.');
  return Object.freeze({
    async addEvidencePair({projectId,checkpointId,journalEventId,originalFile,evidenceBlob,metadata={},filenames={},identities={}}){
      if(!projectId||!checkpointId||!journalEventId||!originalFile||!evidenceBlob)throw new TypeError('Evidence photo context and both images are required.');
      const mediaGroupId=identities.mediaGroupId||createId(),originalMediaId=identities.originalMediaId||createId(),evidenceMediaId=identities.evidenceMediaId||createId(),capturedAt=metadata.capturedAt||clock.iso();
      const common={projectId:String(projectId),checkpointId:String(checkpointId),journalEventId:String(journalEventId),mediaGroupId,capturedAt,metadata:structuredClone(metadata)};
      const original={...common,mediaId:originalMediaId,kind:'photo',role:'original',mimeType:String(originalFile.type||'image/jpeg'),name:String(filenames.original||originalFile.name||`${originalMediaId}.jpg`),size:Number(originalFile.size)||0,blob:originalFile,pairedMediaId:evidenceMediaId};
      const evidence={...common,mediaId:evidenceMediaId,kind:'photo',role:'evidence',mimeType:'image/jpeg',name:String(filenames.evidence||`${evidenceMediaId}.jpg`),size:Number(evidenceBlob.size)||0,blob:evidenceBlob,pairedMediaId:originalMediaId};
      const transaction=database.transaction(STORE,'readwrite'),done=transactionDone(transaction),store=transaction.objectStore(STORE);
      await requestResult(store.add(original));await requestResult(store.add(evidence));await done;
      const reference=record=>Object.freeze({mediaId:record.mediaId,mediaGroupId,uri:`media://${record.mediaId}`,kind:'photo',role:record.role,mimeType:record.mimeType,name:record.name,size:record.size,capturedAt,pairedMediaId:record.pairedMediaId});
      return Object.freeze({mediaGroupId,original:reference(original),evidence:reference(evidence),metadata:structuredClone(metadata)});
    },
    async addPhoto({projectId,checkpointId,journalEventId,file}){
      if(!projectId||!checkpointId||!journalEventId||!file)throw new TypeError('Photo context and file are required.');
      const mediaId=createId(),capturedAt=clock.iso();
      const record={
        mediaId,projectId:String(projectId),checkpointId:String(checkpointId),journalEventId:String(journalEventId),
        kind:'photo',mimeType:String(file.type||'application/octet-stream'),name:String(file.name||`${mediaId}.jpg`),
        size:Number(file.size)||0,capturedAt,blob:file
      };
      const transaction=database.transaction(STORE,'readwrite'),done=transactionDone(transaction);
      await requestResult(transaction.objectStore(STORE).add(record));await done;
      return Object.freeze({mediaId,uri:`media://${mediaId}`,kind:'photo',mimeType:record.mimeType,name:record.name,size:record.size,capturedAt});
    },
    async listCheckpointPhotos(projectId,checkpointId){
      const transaction=database.transaction(STORE,'readonly'),done=transactionDone(transaction);
      const rows=await requestResult(transaction.objectStore(STORE).index('projectCheckpoint').getAll([String(projectId),String(checkpointId)]));
      await done;return rows;
    },
    async listProjectPhotos(projectId){
      const transaction=database.transaction(STORE,'readonly'),done=transactionDone(transaction);
      const rows=await requestResult(transaction.objectStore(STORE).index('projectId').getAll(String(projectId)));
      await done;return rows;
    },
    async getMedia(mediaId){
      const transaction=database.transaction(STORE,'readonly'),done=transactionDone(transaction);
      const row=await requestResult(transaction.objectStore(STORE).get(String(mediaId)));await done;return row||null;
    },
    async deleteEvidencePair(pair){
      if(!pair?.original?.mediaId||!pair?.evidence?.mediaId)throw new TypeError('A complete evidence pair is required.');
      const transaction=database.transaction(STORE,'readwrite'),done=transactionDone(transaction),store=transaction.objectStore(STORE);
      store.delete(pair.original.mediaId);store.delete(pair.evidence.mediaId);await done;
    }
  });
}
