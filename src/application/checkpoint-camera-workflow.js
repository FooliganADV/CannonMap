/** Durable paired checkpoint photo gate. A checkpoint is ready only after both sides and one Journal relationship are durable. */
export function createCheckpointCameraWorkflow({mediaRepository,photoEvidence,journal,clock,createId,onState=()=>{},onRequested=()=>{},onDiagnostic=()=>{}}={}){
  if(!mediaRepository||!photoEvidence||!journal||!clock||typeof createId!=='function')throw new TypeError('Paired camera workflow dependencies are required.');
  let active=null;
  const snapshot=()=>active?{...active,sides:{...active.sides}}:{status:'idle',sides:{front:null,rear:null}};
  const publish=()=>onState(snapshot());
  const refs=pair=>[pair.original,pair.evidence];
  async function recordFailure(error,role,status='write_failed'){
    onDiagnostic({exceptionName:error?.name||'Error',exceptionMessage:error?.message||String(error),stackTrace:error?.stack||'Unavailable',objectStore:'missionMedia',pairId:active.pairId,cameraRole:role});
    try{await journal.appendEventIdempotent({eventId:createId(),projectId:active.projectId,eventType:'media_storage_failure',source:'checkpoint_camera',title:`Photo pair storage failed · ${active.checkpoint.name}`,summary:`${role.toUpperCase()} capture did not complete durable pair persistence.`,references:{checkpointId:active.checkpoint.id,parentEventId:active.journalEvent.eventId,pairId:active.pairId},metadata:{pairId:active.pairId,cameraRole:role,status,retryable:true}});}catch(_){ }
  }
  async function finalizePair(){
    if(!active?.sides.front||!active?.sides.rear)return null;
    active.status='saving_pair';publish();
    const front=active.sides.front,rear=active.sides.rear,event=await journal.appendEventIdempotent({
      eventId:active.pairJournalEventId,projectId:active.projectId,eventType:'photo_added',source:'checkpoint_camera',title:`Capture Pair · ${active.checkpoint.name}`,
      summary:active.checkpoint.type==='hotel'?'Hotel front/selfie and rear/forward evidence pair captured.':'Checkpoint front/selfie and rear/forward evidence pair captured.',
      references:{checkpointId:active.checkpoint.id,objectiveId:active.checkpoint.id,objectiveType:active.checkpoint.type||'checkpoint',parentEventId:active.journalEvent.eventId,pairId:active.pairId,frontOriginalMediaId:front.original.mediaId,frontEvidenceMediaId:front.evidence.mediaId,rearOriginalMediaId:rear.original.mediaId,rearEvidenceMediaId:rear.evidence.mediaId},
      attachments:{photos:[...refs(front),...refs(rear)],front:{originalMediaId:front.original.mediaId,evidenceMediaId:front.evidence.mediaId},rear:{originalMediaId:rear.original.mediaId,evidenceMediaId:rear.evidence.mediaId}},
      metadata:{pairId:active.pairId,persistenceStatus:'complete',checkpointId:active.checkpoint.id,objectiveType:active.checkpoint.type||'checkpoint',dayNumber:Number(active.checkpoint.day)||null,projectId:active.projectId,frontCapturedAt:front.metadata.captureTimestamp||front.metadata.capturedAt,rearCapturedAt:rear.metadata.captureTimestamp||rear.metadata.capturedAt}
    });
    await mediaRepository.markPairComplete?.(active.pairId,event.eventId);
    active.status='ready';active.error='';active.journalPairEvent=event;publish();return snapshot();
  }
  return Object.freeze({
    start({projectId,checkpoint,journalEvent,required=true,evidenceContext={},pairId=null,pairJournalEventId=null}){
      active={status:'awaiting_pair',required:Boolean(required),projectId:String(projectId),checkpoint,journalEvent,evidenceContext,pairId:pairId||createId(),pairJournalEventId:pairJournalEventId||createId(),sides:{front:null,rear:null},startedAt:clock.iso(),error:''};publish();return snapshot();
    },
    request(){if(!active)return null;active.status=active.sides.front?'rear_required':'capturing_front';active.error='';publish();onRequested(snapshot());return snapshot();},
    async addSide(role,file){
      if(!active)throw new Error('Camera workflow is not active.');if(!['front','rear'].includes(role))throw new TypeError('Camera role must be front or rear.');if(!(file instanceof Blob))throw new TypeError('A captured photo Blob is required.');
      active.status=`saving_${role}`;active.error='';publish();
      try{
        const capturedAt=clock.iso(),pair=await photoEvidence.capture({projectId:active.projectId,checkpointId:active.checkpoint.id,journalEventId:active.pairJournalEventId,file,context:{...active.evidenceContext,capturedAt,captureTimestamp:capturedAt,captureMethod:'getUserMedia-sequential',requestedCamera:role,actualCamera:role,cameraSelectionHonored:true,cameraRole:role,pairId:active.pairId,pairJournalEventId:active.pairJournalEventId}});
        active.sides[role]=pair;active.status=role==='front'&&!active.sides.rear?'rear_required':'pair_captured';publish();if(active.sides.front&&active.sides.rear)return finalizePair();return snapshot();
      }catch(error){active.status='failed';active.error=`${role==='front'?'Front':'Rear'} photo could not be saved. The objective remains PHOTO_REQUIRED.`;await recordFailure(error,role,error?.originalMedia?'evidence_failed':'write_failed');publish();throw error;}
    },
    cancel(role){if(!active)return null;const missing=role||(!active.sides.front?'front':'rear');active.status=active.sides.front?'rear_required':'awaiting_pair';active.error=`${missing==='rear'?'Rear':'Front'} capture was canceled. ${active.sides.front?'Front captured safely; rear remains required.':'Capture Pair remains required.'}`;publish();return snapshot();},
    retry(){if(!active)return null;active.status=active.sides.front?'rear_required':'awaiting_pair';active.error='';publish();return snapshot();},
    restoreSide(role,pair){if(!active||!pair||!['front','rear'].includes(role))return null;active.sides[role]=pair;active.status=active.sides.front&&active.sides.rear?'pair_captured':active.sides.front?'rear_required':'awaiting_pair';publish();return snapshot();},
    finalizeRestoredPair:finalizePair,
    finish(){if(!active?.sides.front||!active?.sides.rear||active.status!=='ready'){if(active){active.status=active.sides.front?'rear_required':'awaiting_pair';active.error='A complete durable front and rear pair is required.';publish();}return null;}const result=snapshot();active=null;publish();return result;},
    abandon(){const result=snapshot();active=null;publish();return result;},getState:snapshot
  });
}
