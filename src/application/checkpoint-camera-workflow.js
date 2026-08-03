/** Durable checkpoint photo gate. Required photos never auto-finish without media. */
export function createCheckpointCameraWorkflow({mediaRepository,journal,clock,timeoutMs=60000,setTimer=setTimeout,clearTimer=clearTimeout,onState=()=>{},onRequested=()=>{}}={}){
  if(!mediaRepository||!journal||!clock)throw new TypeError('Camera workflow dependencies are required.');
  let active=null,timer=null;
  const snapshot=()=>active?{...active,photos:[...active.photos]}:{status:'idle'};
  const publish=()=>onState(snapshot());
  const clear=()=>{if(timer)clearTimer(timer);timer=null;};
  const expire=()=>{
    clear();if(!active)return;
    if(active.required&&!active.photos.length){active.status='awaiting_photo';active.error='A photo is required before this checkpoint can complete.';publish();return;}
    active.status='ready';publish();
  };
  const arm=()=>{clear();active.deadline=Date.now()+timeoutMs;timer=setTimer(expire,timeoutMs);publish();};
  return Object.freeze({
    start({projectId,checkpoint,journalEvent,required=Boolean(checkpoint?.photoRequired)}){
      clear();active={status:'requesting',required:Boolean(required),projectId,checkpoint,journalEvent,photos:[],startedAt:clock.iso(),deadline:0,error:''};
      arm();onRequested(snapshot());return snapshot();
    },
    async addFiles(files){
      if(!active)throw new Error('Camera workflow is not active.');
      if(!files?.length){active.status='awaiting_photo';active.error=active.required?'Photo capture was canceled. Retry is required.':'No photo selected.';publish();return [];}
      active.status='saving';active.error='';publish();
      try{
        for(const file of [...files]){
          const reference=await mediaRepository.addPhoto({projectId:active.projectId,checkpointId:active.checkpoint.id,journalEventId:active.journalEvent.eventId,file});
          await journal.appendEvent({
            projectId:active.projectId,eventType:'photo_added',source:'checkpoint_camera',title:`Photo · ${active.checkpoint.name}`,
            summary:'Photo captured during checkpoint arrival.',metadata:{checkpointId:active.checkpoint.id,required:active.required,status:'recorded'},
            references:{checkpointId:active.checkpoint.id,parentEventId:active.journalEvent.eventId},attachments:{photos:[reference]}
          });
          active.photos.push(reference);
        }
        active.status='ready';active.error='';clear();publish();return [...active.photos];
      }catch(error){active.status='failed';active.error=error?.message||String(error);publish();throw error;}
    },
    cancel(){if(!active)return null;active.status='awaiting_photo';active.error=active.required?'Photo capture was canceled. Retry is required.':'Photo skipped.';publish();return snapshot();},
    retry(){if(!active)return null;active.status='requesting';active.error='';arm();onRequested(snapshot());return snapshot();},
    finish(){
      if(!active)return null;
      if(active.required&&!active.photos.length){active.status='awaiting_photo';active.error='A required photo has not been recorded.';publish();return null;}
      clear();const result=snapshot();active=null;publish();return result;
    },
    getState:snapshot
  });
}
