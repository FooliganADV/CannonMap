/** 60-second, no-cancel checkpoint photo workflow with inactivity reset. */
export function createCheckpointCameraWorkflow({mediaRepository,journal,clock,timeoutMs=60000,setTimer=setTimeout,clearTimer=clearTimeout,onState=()=>{}}={}){
  if(!mediaRepository||!journal||!clock)throw new TypeError('Camera workflow dependencies are required.');
  let active=null,timer=null;
  const publish=()=>onState(active?{...active,photos:[...active.photos]}:{status:'idle'});
  const arm=()=>{if(timer)clearTimer(timer);active.deadline=Date.now()+timeoutMs;timer=setTimer(()=>finish(),timeoutMs);publish();};
  const finish=()=>{if(timer)clearTimer(timer);timer=null;const result=active;active=null;publish();return result;};
  return Object.freeze({
    start({projectId,checkpoint,journalEvent}){
      if(active)finish();
      active={status:'active',projectId,checkpoint,journalEvent,photos:[],startedAt:clock.iso(),deadline:0};arm();
    },
    async addFiles(files){
      if(!active)throw new Error('Camera workflow is not active.');
      for(const file of [...files]){
        const reference=await mediaRepository.addPhoto({
          projectId:active.projectId,checkpointId:active.checkpoint.id,journalEventId:active.journalEvent.eventId,file
        });
        await journal.appendEvent({
          projectId:active.projectId,eventType:'photo_added',source:'checkpoint_camera',title:`Photo · ${active.checkpoint.name}`,
          summary:'Photo captured during the checkpoint completion window.',metadata:{checkpointId:active.checkpoint.id},
          references:{checkpointId:active.checkpoint.id,parentEventId:active.journalEvent.eventId},attachments:{photos:[reference]}
        });
        active.photos.push(reference);arm();
      }
      return [...active.photos];
    },
    finish,getState:()=>active?{...active,photos:[...active.photos]}:{status:'idle'}
  });
}
