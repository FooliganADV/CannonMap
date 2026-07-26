import {createHash} from 'node:crypto';
import {MAX_INGESTION_BYTES,validateObservationIngress} from './ingestion-contract.js';

export const DEFAULT_PER_USER_EVENT_QUOTA=120;
const digest=value=>createHash('sha256').update(String(value)).digest('hex');
const publicReceipt=receipt=>Object.freeze({
  receiptId:receipt.receiptId,
  idempotencyKey:receipt.idempotencyKey,
  eventId:receipt.eventId,
  observationId:receipt.observationId,
  status:receipt.status,
  acceptedAt:receipt.acceptedAt
});

export function createIngestObservation({repository,clock=()=>Date.now(),quota=DEFAULT_PER_USER_EVENT_QUOTA,requireAppCheck=true}={}){
  if(!repository)throw new TypeError('repository is required.');
  return async function ingest({auth,appCheck,observation,idempotencyKey,requestBytes}={}){
    if(!auth?.uid)return Object.freeze({status:401,error:'Authentication is required.'});
    if(requireAppCheck&&!appCheck?.appId)return Object.freeze({status:401,error:'App Check is required.'});
    if(requestBytes>MAX_INGESTION_BYTES)return Object.freeze({status:413,error:'Request exceeds size limit.'});
    const validation=validateObservationIngress(observation,{nowMs:clock(),idempotencyKey});
    if(!validation.valid)return Object.freeze({status:400,error:'Invalid observation.',details:validation.errors});
    const receiptId=digest(`${auth.uid}\n${idempotencyKey}`);
    const existing=await repository.getReceipt(auth.uid,receiptId);
    if(existing?.status==='accepted')return Object.freeze({status:200,replayed:true,receipt:publicReceipt(existing)});
    const reservation=await repository.reserve({
      uid:auth.uid,receiptId,idempotencyKey,eventId:observation.eventId,
      observationId:observation.observationId,createdAt:new Date(clock()).toISOString()
    });
    if(!reservation.acquired){
      const receipt=reservation.receipt||await repository.getReceipt(auth.uid,receiptId);
      if(receipt?.status==='accepted')return Object.freeze({status:200,replayed:true,receipt:publicReceipt(receipt)});
      return Object.freeze({status:409,error:'Ingestion is already in progress.'});
    }
    const allowed=await repository.consumeQuota({
      uid:auth.uid,eventId:observation.eventId,
      bucket:Math.floor(clock()/60000),limit:quota
    });
    if(!allowed){
      await repository.reject({uid:auth.uid,receiptId,reason:'quota-exceeded'});
      return Object.freeze({status:429,error:'Per-user event quota exceeded.'});
    }
    const acceptedAt=new Date(clock()).toISOString();
    const receipt={
      schemaVersion:1,receiptId,idempotencyKey,eventId:observation.eventId,
      observationId:observation.observationId,ownerUid:auth.uid,status:'accepted',acceptedAt
    };
    const committed=await repository.commitImmutable({
      uid:auth.uid,observation:{...observation,ownerUid:auth.uid,ingestedAt:acceptedAt},receipt
    });
    return Object.freeze({status:200,replayed:!committed.created,receipt:publicReceipt(committed.receipt||receipt)});
  };
}

export function createRealtimeIngestionRepository(database){
  return Object.freeze({
    async getReceipt(uid,receiptId){
      return (await database.ref(`private/${uid}/observationReceipts/${receiptId}`).get()).val();
    },
    async reserve(record){
      const ref=database.ref(`private/${record.uid}/observationReceipts/${record.receiptId}`);
      let acquired=false;
      const transaction=await ref.transaction(current=>{
        if(current)return;
        acquired=true;
        return {...record,status:'processing'};
      });
      return Object.freeze({acquired:transaction.committed&&acquired,receipt:transaction.snapshot.val()});
    },
    async consumeQuota({uid,eventId,bucket,limit}){
      const ref=database.ref(`ingestionQuota/${eventId}/${uid}/${bucket}`);
      const transaction=await ref.transaction(current=>{
        const count=Number(current?.count)||0;
        return count>=limit?undefined:{count:count+1};
      });
      return transaction.committed;
    },
    async reject({uid,receiptId,reason}){
      await database.ref(`private/${uid}/observationReceipts/${receiptId}`).update({status:'rejected',reason});
    },
    async commitImmutable({uid,observation,receipt}){
      const ref=database.ref(`observationIngress/${observation.eventId}/${uid}/${observation.observationId}`);
      let created=false;
      const transaction=await ref.transaction(current=>{
        if(current)return;
        created=true;
        return observation;
      });
      if(!transaction.committed||!created){
        const existingReceipt=(await database.ref(`private/${uid}/observationReceipts/${receipt.receiptId}`).get()).val();
        return Object.freeze({created:false,receipt:existingReceipt||receipt});
      }
      await database.ref(`private/${uid}/observationReceipts/${receipt.receiptId}`).set(receipt);
      return Object.freeze({created:true,receipt});
    }
  });
}
