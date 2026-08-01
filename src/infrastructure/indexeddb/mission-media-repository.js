import {requestResult,transactionDone} from './request.js';

const STORE='missionMedia';

/** Durable project-scoped photo assets. Journal and Backup retain references only. */
export function createMissionMediaRepository({database,createId,clock}={}){
  if(!database||typeof createId!=='function'||!clock)throw new TypeError('database, createId, and clock are required.');
  return Object.freeze({
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
    }
  });
}
