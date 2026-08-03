import {
  createJournalEvent,createJournalEventTypeRegistry,createRallyJournal
} from '../domain/journal/model.js';

/**
 * Reusable Journal API. This service performs validation and event creation;
 * persistence remains an injected port. It has no UI or application lifecycle
 * integration, so adding the foundation cannot change existing workflows.
 */
export function createRallyJournalService({repository,createId,clock,eventTypes}={}){
  if(!repository||typeof createId!=='function')throw new TypeError('repository and createId are required.');
  const registry=eventTypes||createJournalEventTypeRegistry();
  const normalize=input=>createJournalEvent(input,{createId,clock});
  return Object.freeze({
    registerEventType:eventType=>registry.register(eventType),
    appendEvent:async input=>repository.appendEvent(normalize(input)),
    async appendEventIdempotent(input){
      const event=normalize(input),existing=await repository.getEvent(event.eventId);
      return existing||repository.appendEvent(event);
    },
    appendEvents:async inputs=>{
      if(!Array.isArray(inputs)||inputs.length===0)throw new TypeError('events must be a non-empty array.');
      return repository.appendEvents(inputs.map(normalize));
    },
    getEvent:eventId=>repository.getEvent(eventId),
    async getProjectJournal(projectId){
      return createRallyJournal(String(projectId),await repository.getEventsByProject(projectId));
    },
    queryEvents:query=>repository.queryEvents(query),
    deleteProjectJournal:projectId=>repository.deleteProjectJournal(projectId)
  });
}
