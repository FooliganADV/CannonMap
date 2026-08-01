import assert from 'node:assert/strict';
import test from 'node:test';
import {createCheckpointCameraWorkflow} from '../src/application/checkpoint-camera-workflow.js';

test('checkpoint camera stores multiple photo references and auto-continues after inactivity',async()=>{
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
  assert.equal(workflow.getState().status,'idle');assert.equal(states.at(-1).status,'idle');assert.ok(cleared>=2);
});
