import {assertPersistedRecord} from './repositories.js';
import {requestResult,transactionDone} from './request.js';

export async function appendObservationWithOutbox(database,{observation,outboxItem}){
  assertPersistedRecord(observation);
  assertPersistedRecord(outboxItem,{eventScoped:false});
  if(outboxItem.eventId!==observation.eventId)throw new TypeError('Observation and outbox eventId must match.');
  if(!outboxItem.idempotencyKey)throw new TypeError('Outbox item requires idempotencyKey.');

  const transaction=database.transaction(['observations','observationOutbox'],'readwrite');
  const done=transactionDone(transaction);
  const observations=transaction.objectStore('observations');
  const outbox=transaction.objectStore('observationOutbox');
  try{
    await requestResult(observations.add(observation));
    await requestResult(outbox.add(outboxItem));
    await done;
  }catch(error){
    try{transaction.abort();}catch(_){}
    await done.catch(()=>{});
    throw error;
  }
  return Object.freeze({
    observationKey:[observation.eventId,observation.observationId],
    idempotencyKey:outboxItem.idempotencyKey
  });
}

export async function acknowledgeOutboxItem(database,idempotencyKey,{acknowledgedAt,receipt}){
  const transaction=database.transaction('observationOutbox','readwrite');
  const done=transactionDone(transaction);
  const store=transaction.objectStore('observationOutbox');
  const item=await requestResult(store.get(idempotencyKey));
  if(!item){
    try{transaction.abort();}catch(_){}
    throw new Error(`Outbox item not found: ${idempotencyKey}`);
  }
  item.state='acknowledged';
  item.acknowledgedAt=acknowledgedAt;
  item.receipt=receipt;
  item.updatedAt=acknowledgedAt;
  await requestResult(store.put(item));
  await done;
  return item;
}
