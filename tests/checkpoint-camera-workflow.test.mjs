import assert from 'node:assert/strict';
import test from 'node:test';
import {createCheckpointCameraWorkflow} from '../src/application/checkpoint-camera-workflow.js';

test('optional checkpoint camera stores multiple photo references and becomes ready after inactivity',async()=>{
  let timeout=null,cleared=0;const states=[],media=[],events=[];
  const workflow=createCheckpointCameraWorkflow({
    mediaRepository:{async addPhoto(input){media.push(input);return {mediaId:`media-${media.length}`,uri:`media://media-${media.length}`,kind:'photo'};}},
    journal:{async appendEvent(event){events.push(event);return event;}},clock:{iso:()=> '2026-07-31T12:00:00.000Z'},timeoutMs:60000,
    setTimer:callback=>{timeout=callback;return Symbol('timer');},clearTimer:()=>cleared++,onState:state=>states.push(state)
  });
  workflow.start({projectId:'project-1',checkpoint:{id:'cp-1',name:'Checkpoint'},journalEvent:{eventId:'event-1'}});
  await workflow.addFiles([{name:'one.jpg',type:'image/jpeg',size:1},{name:'two.jpg',type:'image/jpeg',size:2}]);
  assert.equal(media.length,2);assert.equal(events.length,2);assert.equal(events[0].references.parentEventId,'event-1');
  assert.deepEqual(events[1].attachments.photos,[{mediaId:'media-2',uri:'media://media-2',kind:'photo'}]);
  timeout();
  assert.equal(workflow.getState().status,'ready');assert.equal(states.at(-1).status,'ready');assert.ok(cleared>=1);
  assert.equal(workflow.finish().photos.length,2);assert.equal(workflow.getState().status,'idle');
});

test('required photo cancellation blocks finish and retry recovers',async()=>{
  let timeout=null,attempts=0;
  const workflow=createCheckpointCameraWorkflow({
    mediaRepository:{async addPhoto(){attempts++;if(attempts===1)throw new Error('storage failed');return {mediaId:'photo',uri:'media://photo'};}},
    journal:{async appendEvent(event){return event;}},clock:{iso:()=> '2026-07-31T12:00:00.000Z'},
    setTimer:callback=>{timeout=callback;return 1;},clearTimer:()=>{},onState:()=>{}
  });
  workflow.start({projectId:'project-1',checkpoint:{id:'required',name:'Required',photoRequired:true},journalEvent:{eventId:'arrival'},required:true});
  workflow.cancel();assert.equal(workflow.getState().status,'awaiting_photo');assert.equal(workflow.finish(),null);
  workflow.retry();timeout();assert.equal(workflow.getState().status,'awaiting_photo');
  await assert.rejects(workflow.addFiles([{name:'bad.jpg'}]),/storage failed/);assert.equal(workflow.getState().status,'failed');
  workflow.retry();await workflow.addFiles([{name:'good.jpg'}]);assert.equal(workflow.getState().status,'ready');assert.equal(workflow.finish().photos.length,1);
});
