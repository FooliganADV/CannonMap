import {acknowledgeOutboxItem,appendObservationWithOutbox} from './observation-outbox.js';
import {createDomainRepositories} from './repositories.js';

export function createObservationCaptureRepository(database){
  const repositories=createDomainRepositories(database);
  return Object.freeze({
    async append(records){
      try{
        return await appendObservationWithOutbox(database,records);
      }catch(error){
        if(error?.name!=='ConstraintError')throw error;
        const existing=await repositories.observations.get([records.observation.eventId,records.observation.observationId]);
        const queued=await repositories.observationOutbox.get(records.outboxItem.idempotencyKey);
        if(existing&&queued)return Object.freeze({duplicate:true});
        throw error;
      }
    },
    async pending(){
      const items=await repositories.observationOutbox.getAll();
      return items.filter(item=>item.state==='pending').sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
    },
    get:key=>repositories.observations.get(key),
    acknowledge:(idempotencyKey,details)=>acknowledgeOutboxItem(database,idempotencyKey,details)
  });
}
