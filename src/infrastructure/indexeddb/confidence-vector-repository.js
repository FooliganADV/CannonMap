import {assertConfidenceVector} from '../../../shared/contracts/confidence-vector.js';
import {requestResult,transactionDone} from './request.js';

const STORE_NAME='confidenceVectors';

export function createConfidenceVectorRepository({database}={}){
  if(!database)throw new TypeError('database is required.');
  return Object.freeze({
    async addRevision(vector){
      assertConfidenceVector(vector);
      const transaction=database.transaction(STORE_NAME,'readwrite');
      const done=transactionDone(transaction);
      try{
        await requestResult(transaction.objectStore(STORE_NAME).add(vector));
        await done;
        return Object.freeze({created:true,replayed:false,revisionId:vector.revisionId});
      }catch(error){
        try{await done;}catch(_){}
        if(error?.name!=='ConstraintError')throw error;
        const existing=await this.getRevision([vector.eventId,vector.subjectType,vector.subjectId,vector.revision]);
        if(existing?.revisionId!==vector.revisionId)throw new Error(`Immutable ConfidenceVector collision at revision ${vector.revision}.`);
        return Object.freeze({created:false,replayed:true,revisionId:vector.revisionId});
      }
    },
    async getRevision(key){
      const transaction=database.transaction(STORE_NAME,'readonly'),done=transactionDone(transaction);
      const result=await requestResult(transaction.objectStore(STORE_NAME).get(key));
      await done;
      return result||null;
    },
    async revisionsFor({eventId,subjectType,subjectId}){
      const transaction=database.transaction(STORE_NAME,'readonly'),done=transactionDone(transaction);
      const records=await requestResult(transaction.objectStore(STORE_NAME).index('updatedAt').getAll());
      await done;
      return records.filter(item=>item.eventId===eventId&&item.subjectType===subjectType&&item.subjectId===subjectId)
        .sort((left,right)=>left.revision-right.revision);
    },
    async latest(query){
      const revisions=await this.revisionsFor(query);
      return revisions.at(-1)||null;
    }
  });
}
