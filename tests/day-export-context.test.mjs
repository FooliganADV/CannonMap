import assert from 'node:assert/strict';
import test from 'node:test';
import {journalEventDay,journalEventsForDay,resolveRallyExportDay} from '../src/application/day-export-context.js';

test('all-days planner filter resolves the finalized field day instead of Day 0',()=>{
  const project={rallyExecution:{days:{'1':{dayNumber:1,status:'complete',completedAt:'2026-08-01T20:00:00Z'},'9':{dayNumber:9,status:'complete',completedAt:'2026-08-08T20:00:00Z'}}},features:[{day:1},{day:9}]};
  assert.equal(resolveRallyExportDay({settings:{dayFilter:'all'},project}),9);
});

test('active and arbitrary nonconsecutive days resolve without assuming Day 1',()=>{
  assert.equal(resolveRallyExportDay({settings:{dayFilter:'all'},project:{features:[{day:17,status:'active'},{day:31,status:'upcoming'}]}}),17);
  assert.equal(resolveRallyExportDay({settings:{dayFilter:'31'},project:{features:[{day:17,status:'active'}]}}),31);
});

test('Journal day normalization supports metadata, references, and durable day identity',()=>{
  const events=[
    {eventType:'checkpoint_arrival',metadata:{dayNumber:9}},
    {eventType:'photo_added',references:{dayNumber:9}},
    {eventType:'checkpoint_completed',metadata:{dayId:'day-9'}},
    {eventType:'hotel_arrival',references:{dayId:'day-9'}},
    {eventType:'day_finished',metadata:{dayNumber:9}},
    {eventType:'other',metadata:{dayNumber:17}}
  ];
  assert.equal(journalEventDay(events[2]),9);assert.deepEqual(journalEventsForDay(events,9).map(event=>event.eventType),['checkpoint_arrival','photo_added','checkpoint_completed','hotel_arrival','day_finished']);
});
