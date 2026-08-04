/** Durable checkpoint photo gate. Required photos never auto-finish without media. */
export function createCheckpointCameraWorkflow({mediaRepository,photoEvidence,journal,clock,timeoutMs=60000,setTimer=setTimeout,clearTimer=clearTimeout,onState=()=>{},onRequested=()=>{}}={}){
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
    start({projectId,checkpoint,journalEvent,required=Boolean(checkpoint?.photoRequired),evidenceContext={}}){
      clear();active={status:'requesting',required:Boolean(required),projectId,checkpoint,journalEvent,evidenceContext,photos:[],startedAt:clock.iso(),deadline:0,error:''};
      arm();onRequested(snapshot());return snapshot();
    },
    async addFiles(files){
      if(!active)throw new Error('Camera workflow is not active.');
      if(!files?.length){active.status='awaiting_photo';active.error=active.required?'Photo capture was canceled. Retry is required.':'No photo selected.';publish();return [];}
      active.status='saving';active.error='';publish();
      try{
        for(const file of [...files]){
          const photoJournalEventId=active.evidenceContext.photoJournalEventId||active.journalEvent.eventId;
          const pair=photoEvidence?await photoEvidence.capture({projectId:active.projectId,checkpointId:active.checkpoint.id,journalEventId:photoJournalEventId,file,context:active.evidenceContext}):null;
          const reference=pair||await mediaRepository.addPhoto({projectId:active.projectId,checkpointId:active.checkpoint.id,journalEventId:active.journalEvent.eventId,file});
          const photos=pair?[pair.original,pair.evidence]:[reference];
          try{await journal.appendEvent({
            eventId:photoJournalEventId,projectId:active.projectId,eventType:'photo_added',source:'checkpoint_camera',title:`Photo · ${active.checkpoint.name}`,
            summary:active.checkpoint.type==='hotel'?'Hotel arrival photo captured.':'Photo captured during checkpoint arrival.',
            references:{checkpointId:active.checkpoint.id,parentEventId:active.journalEvent.eventId,mediaGroupId:pair?.mediaGroupId||reference.mediaId,
              originalMediaId:pair?.original?.mediaId||reference.mediaId,evidenceMediaId:pair?.evidence?.mediaId||null},
            attachments:{photos,original:pair?.original||reference,evidence:pair?.evidence||null},metadata:{checkpointId:active.checkpoint.id,objectiveType:active.checkpoint.type||'checkpoint',dayNumber:Number(active.checkpoint.day)||null,projectId:active.projectId,required:active.required,status:'recorded',captureTimestamp:active.evidenceContext.capturedAt||clock.iso(),exportFilename:pair?.evidence?.name||reference.name,originalExportFilename:pair?.original?.name||reference.name,evidenceExportFilename:pair?.evidence?.name||null}
          });}catch(error){if(pair)await mediaRepository.deleteEvidencePair?.(pair);throw error;}
          active.photos.push(reference);
        }
        active.status='ready';active.error='';clear();publish();return [...active.photos];
      }catch(error){
        active.status='failed';active.error=error?.message||String(error);
        {
          active.originalMedia=error.originalMedia;
          try{await journal.appendEvent({projectId:active.projectId,eventType:'media_storage_failure',source:'checkpoint_camera',
            title:`Photo storage failed · ${active.checkpoint.name}`,summary:error.originalMedia?'The full-resolution original is stored. Evidence generation must be retried.':'The photograph was not safely stored. Capture must be retried.',
            references:{checkpointId:active.checkpoint.id,parentEventId:active.journalEvent.eventId,originalMediaId:error.originalMedia?.mediaId||null},
            metadata:{checkpointId:active.checkpoint.id,dayNumber:Number(active.checkpoint.day)||null,required:active.required,status:error.originalMedia?'evidence_failed':'write_failed',retryable:true,error:active.error}});}catch(_){ }
        }
        publish();throw error;
      }
    },
    cancel(){if(!active)return null;active.status='awaiting_photo';active.error=active.required?'Photo capture was canceled. Retry is required.':'Photo skipped.';publish();return snapshot();},
    retry(){if(!active)return null;active.status='requesting';active.error='';arm();onRequested(snapshot());return snapshot();},
    restorePhoto(reference){
      if(!active||!reference)return null;
      if(!active.photos.some(photo=>photo.mediaId===reference.mediaId))active.photos.push(reference);
      active.status='ready';active.error='';clear();publish();return snapshot();
    },
    finish(){
      if(!active)return null;
      if(active.required&&!active.photos.length){active.status='awaiting_photo';active.error='A required photo has not been recorded.';publish();return null;}
      clear();const result=snapshot();active=null;publish();return result;
    },
    abandon(){clear();const result=snapshot();active=null;publish();return result;},
    getState:snapshot
  });
}
