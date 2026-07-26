import {requestResult,transactionDone} from './request.js';

const checkpointKey=id=>`migration:${id}`;

async function readCheckpoint(database,id){
  const transaction=database.transaction('syncMeta','readonly');
  const done=transactionDone(transaction);
  const result=await requestResult(transaction.objectStore('syncMeta').get(checkpointKey(id)));
  await done;
  return result||null;
}

async function writeCheckpoint(database,checkpoint){
  const transaction=database.transaction('syncMeta','readwrite');
  const done=transactionDone(transaction);
  await requestResult(transaction.objectStore('syncMeta').put(checkpoint));
  await done;
}

export function createMigrationRunner({database,clock={now:()=>Date.now()}}){
  if(!database)throw new TypeError('database is required.');
  return Object.freeze({
    checkpoint:id=>readCheckpoint(database,id),
    async run({id,schemaVersion,batchSize=100,runBatch}){
      if(!id||!Number.isInteger(schemaVersion)||typeof runBatch!=='function')throw new TypeError('Migration id, schemaVersion, and runBatch are required.');
      let checkpoint=await readCheckpoint(database,id)||{
        key:checkpointKey(id),migrationId:id,schemaVersion,cursor:null,processed:0,state:'pending',
        createdAt:clock.now(),updatedAt:clock.now()
      };
      if(checkpoint.state==='complete')return checkpoint;

      while(true){
        checkpoint={...checkpoint,state:'running',updatedAt:clock.now()};
        await writeCheckpoint(database,checkpoint);
        const result=await runBatch(Object.freeze({cursor:checkpoint.cursor,batchSize,processed:checkpoint.processed}));
        if(!result||!Array.isArray(result.records))throw new TypeError('Migration batches return {records, cursor, done}.');
        checkpoint={
          ...checkpoint,
          cursor:result.cursor??checkpoint.cursor,
          processed:checkpoint.processed+result.records.length,
          state:result.done?'complete':'pending',
          updatedAt:clock.now()
        };
        await writeCheckpoint(database,checkpoint);
        if(result.done)return checkpoint;
      }
    }
  });
}
