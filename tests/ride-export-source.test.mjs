import assert from 'node:assert/strict';
import test from 'node:test';
import {createRideExportSource} from '../src/application/ride-export-source.js';

test('future ride exporters receive one read-only Project, Journal, and raw Analytics snapshot',async()=>{
  let flushed=false;
  const source=createRideExportSource({
    getActiveProject:()=>({projectId:'project-1',name:'Rally'}),
    journal:{getProjectJournal:async projectId=>({projectId,events:[{eventId:'event-1'}]})},
    analytics:{flush:async()=>{flushed=true;},getExportSnapshot:async()=>({samples:[{sampleId:'sample-1'}],events:[],daily:[]})}
  });
  const result=await source.snapshot();
  assert.equal(flushed,true);assert.equal(result.project.projectId,'project-1');assert.equal(result.journal.events.length,1);assert.equal(result.analytics.samples.length,1);
  assert.throws(()=>{result.project.name='Changed';});
});
