import {requestResult,transactionDone} from './request.js';
import {createConfidenceVectorRepository} from './confidence-vector-repository.js';
import {createIntelligenceRepository} from './intelligence-repository.js';

const REQUIRED_METADATA=['schemaVersion','createdAt','updatedAt','eventId'];

export function assertPersistedRecord(record,{eventScoped=true}={}){
  if(!record||typeof record!=='object')throw new TypeError('A persisted record object is required.');
  const required=eventScoped?REQUIRED_METADATA:REQUIRED_METADATA.filter(field=>field!=='eventId');
  for(const field of required){
    if(record[field]===undefined||record[field]===null||record[field]==='')throw new TypeError(`Persisted record requires ${field}.`);
  }
  return record;
}

export function createRepository({database,storeName,appendOnly=false,eventScoped=true}){
  if(!database)throw new TypeError('database is required.');
  if(!storeName)throw new TypeError('storeName is required.');
  return Object.freeze({
    async add(record){
      assertPersistedRecord(record,{eventScoped});
      const transaction=database.transaction(storeName,'readwrite');
      const done=transactionDone(transaction);
      const result=await requestResult(transaction.objectStore(storeName)[appendOnly?'add':'put'](record));
      await done;
      return result;
    },
    async get(key){
      const transaction=database.transaction(storeName,'readonly');
      const done=transactionDone(transaction);
      const result=await requestResult(transaction.objectStore(storeName).get(key));
      await done;
      return result;
    },
    async getAll(){
      const transaction=database.transaction(storeName,'readonly');
      const done=transactionDone(transaction);
      const result=await requestResult(transaction.objectStore(storeName).getAll());
      await done;
      return result;
    },
    async remove(key){
      if(appendOnly)throw new Error(`${storeName} is append-only.`);
      const transaction=database.transaction(storeName,'readwrite');
      const done=transactionDone(transaction);
      await requestResult(transaction.objectStore(storeName).delete(key));
      await done;
    }
  });
}

export function createDomainRepositories(database){
  return Object.freeze({
    observations:createRepository({database,storeName:'observations',appendOnly:true}),
    observationOutbox:createRepository({database,storeName:'observationOutbox',eventScoped:false}),
    commitmentInferences:createRepository({database,storeName:'commitmentInferences'}),
    routeFamilies:createRepository({database,storeName:'routeFamilies'}),
    routeVariants:createRepository({database,storeName:'routeVariants'}),
    confidenceVectors:createConfidenceVectorRepository({database}),
    intelligence:createIntelligenceRepository({database}),
    intelligenceItems:createRepository({database,storeName:'intelligenceItems'}),
    recommendations:createRepository({database,storeName:'recommendations'}),
    recommendationEvaluations:createRepository({database,storeName:'recommendationEvaluations'}),
    intelligenceNetwork:createRepository({database,storeName:'intelligenceNetwork',eventScoped:false}),
    syncMeta:createRepository({database,storeName:'syncMeta',eventScoped:false})
  });
}
