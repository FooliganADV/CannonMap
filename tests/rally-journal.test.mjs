import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILT_IN_JOURNAL_EVENT_TYPES,createJournalEvent,createJournalEventTypeRegistry,
  createRallyJournal,JOURNAL_EVENT_SCHEMA_VERSION,JOURNAL_SCHEMA_VERSION
} from '../src/domain/journal/model.js';
import {createRallyJournalService} from '../src/application/rally-journal-service.js';

const ids=[
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003'
];
const input=(overrides={})=>({
  projectId:'project-1',timestamp:'2026-07-30T12:00:00-05:00',
  eventType:'ride_started',source:'rally-session',title:'Ride started',
  summary:'Day one began.',metadata:{day:1},references:{routeId:'route-1'},
  attachments:{photoIds:['photo-1']},...overrides
});

test('creates the versioned immutable event contract with UTC timestamps and reference-only attachments',()=>{
  const event=createJournalEvent(input(),{
    createId:()=>ids[0],clock:{iso:()=> '2026-07-30T17:00:01.000Z'}
  });
  assert.deepEqual(Object.keys(event),[
    'eventId','projectId','timestamp','eventType','source','title','summary',
    'metadata','references','attachments','createdAt','schemaVersion'
  ]);
  assert.equal(event.timestamp,'2026-07-30T17:00:00.000Z');
  assert.equal(event.schemaVersion,JOURNAL_EVENT_SCHEMA_VERSION);
  assert.equal(Object.isFrozen(event),true);
  assert.throws(()=>createJournalEvent(input({attachments:{image:'data:image/png;base64,abc'}}),{
    createId:()=>ids[1]
  }),/references only/);
});

test('supports built-in, plugin, and unknown event types without changing persisted fields',()=>{
  const registry=createJournalEventTypeRegistry();
  assert.deepEqual(registry.list(),[...BUILT_IN_JOURNAL_EVENT_TYPES].sort());
  registry.register('plugin_surface_condition');
  assert.equal(registry.has('plugin_surface_condition'),true);
  const unknown=createJournalEvent(input({eventType:'newer_producer_event'}),{createId:()=>ids[0],registry});
  assert.equal(unknown.eventType,'newer_producer_event');
});

test('builds one ordered project journal and rejects cross-project events',()=>{
  const later=createJournalEvent(input({timestamp:'2026-07-30T18:00:00Z'}),{createId:()=>ids[1]});
  const earlier=createJournalEvent(input({timestamp:'2026-07-30T17:00:00Z'}),{createId:()=>ids[0]});
  const journal=createRallyJournal('project-1',[later,earlier]);
  assert.equal(journal.schemaVersion,JOURNAL_SCHEMA_VERSION);
  assert.deepEqual(journal.events.map(event=>event.eventId),[ids[0],ids[1]]);
  assert.throws(()=>createRallyJournal('other-project',[earlier]),/journal project/);
});

test('service composes validation, repository operations, and type registration without global state',async()=>{
  const records=[];
  const repository={
    async appendEvent(event){records.push(event);return event;},
    async appendEvents(events){records.push(...events);return events;},
    async getEvent(id){return records.find(event=>event.eventId===id)||null;},
    async getEventsByProject(projectId){return records.filter(event=>event.projectId===projectId);},
    async queryEvents(){return [...records];},
    async deleteProjectJournal(projectId){
      const count=records.filter(event=>event.projectId===projectId).length;
      for(let index=records.length-1;index>=0;index--)if(records[index].projectId===projectId)records.splice(index,1);
      return count;
    }
  };
  let sequence=0;
  const service=createRallyJournalService({
    repository,createId:()=>ids[sequence++],clock:{iso:()=> '2026-07-30T17:00:00.000Z'}
  });
  service.registerEventType('plugin_event');
  await service.appendEvent(input({eventType:'plugin_event'}));
  await service.appendEvents([input({eventType:'unknown_event'}),input({projectId:'project-2'})]);
  assert.equal((await service.getProjectJournal('project-1')).events.length,2);
  assert.equal((await service.queryEvents({})).length,3);
  assert.equal(await service.deleteProjectJournal('project-1'),2);
  assert.equal((await service.getProjectJournal('project-1')).events.length,0);
});
