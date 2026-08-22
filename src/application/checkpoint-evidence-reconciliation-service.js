import {isAuthoritativeCheckpointArrivalSource} from '../domain/checkpoints/evidence.js';

const PHOTO_STATES=new Set(['not_attempted','permission_blocked','capture_started','partial','interrupted','failed','complete']);
const COMPLETION_EVENTS=new Set(['checkpoint_completed','hotel_arrival']);

const text=value=>String(value??'').trim();
const recordsOf=value=>Array.isArray(value)?value:Array.isArray(value?.events)?value.events:[];
const checkpointIdOf=event=>text(event?.references?.checkpointId||event?.metadata?.checkpointId||event?.metadata?.objectiveId);
const pairIdOf=value=>text(value?.pairId||value?.references?.pairId||value?.metadata?.pairId||value?.abandonedPairId||value?.metadata?.abandonedPairId);
const sessionIdOf=value=>text(value?.sessionId||value?.metadata?.sessionId||value?.references?.sessionId);
const matchesSession=(value,sessionId,includeLegacyUnscoped)=>!sessionId||sessionIdOf(value)===text(sessionId)||(includeLegacyUnscoped&&!sessionIdOf(value));
const mediaRole=record=>text(record?.role||record?.metadata?.role).toLowerCase();
const cameraRole=record=>{
  const role=text(record?.cameraRole||record?.metadata?.cameraRole||record?.logicalSide||record?.metadata?.logicalSide).toLowerCase();
  if(['front','rider','selfie','user'].includes(role))return 'front';
  if(['rear','road','forward','environment'].includes(role))return 'rear';
  return null;
};
const occurredAt=value=>Date.parse(value?.timestamp||value?.capturedAt||value?.createdAt||'')||0;
const finite=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
const trustworthyArrival=value=>{
  const arrival=value?.checkpointEvidence?.arrival||value?.arrivalEvidence||value?.metadata?.arrivalEvidence||value?.metadata||{};
  if(arrival?.state&&arrival.state!=='confirmed')return false;
  const accuracy=arrival?.gpsAccuracyFeet??arrival?.accuracyFeet;
  const source=arrival?.source||value?.metadata?.source||value?.source;
  return Boolean(isAuthoritativeCheckpointArrivalSource(source)&&(arrival?.timestamp||arrival?.confirmedAt||value?.arrivedAt||value?.timestamp)&&finite(arrival?.latitude)&&finite(arrival?.longitude)&&finite(accuracy)&&Number(accuracy)>=0);
};
const uniqueByMediaId=records=>{
  const unique=new Map();
  for(const record of records||[]){const id=text(record?.mediaId);if(id&&!unique.has(id))unique.set(id,record);}
  return [...unique.values()].sort((left,right)=>occurredAt(left)-occurredAt(right)||text(left.mediaId).localeCompare(text(right.mediaId)));
};
const freezeList=items=>Object.freeze([...items]);
const mediaReference=record=>Object.freeze({
  mediaId:record.mediaId,mediaGroupId:record.mediaGroupId||null,uri:`media://${record.mediaId}`,
  kind:record.kind||'photo',role:mediaRole(record),mimeType:record.mimeType||'application/octet-stream',
  name:record.name||String(record.mediaId),size:Number(record.size)||0,capturedAt:record.capturedAt||null,
  pairedMediaId:record.pairedMediaId||null,sourceProvenance:record.sourceProvenance?structuredClone(record.sourceProvenance):null
});

function matchingEvents(journalEvents,checkpointId,{sessionId=null,includeLegacyUnscoped=false}={}){
  return recordsOf(journalEvents)
    .filter(event=>checkpointIdOf(event)===checkpointId&&matchesSession(event,sessionId,includeLegacyUnscoped))
    .slice()
    .sort((left,right)=>occurredAt(left)-occurredAt(right)||text(left.eventId).localeCompare(text(right.eventId)));
}

function groupedMedia(records){
  const groups=new Map();
  for(const record of uniqueByMediaId(records)){
    const pairId=pairIdOf(record);if(!pairId)continue;
    if(!groups.has(pairId))groups.set(pairId,[]);
    groups.get(pairId).push(record);
  }
  return groups;
}

function selectPairId(checkpoint,events,groups){
  const explicit=[checkpoint?.checkpointEvidence?.photo?.pairId,checkpoint?.pendingPhotoPair?.pairId,checkpoint?.photoPair?.pairId]
    .map(text).find(Boolean);
  const journalPairs=[...events].reverse().filter(event=>event.eventType==='photo_added').map(pairIdOf).filter(Boolean),complete=pairId=>{const analysis=analyzeSides(groups.get(pairId)||[],pairId);return Boolean(analysis.sides.front&&analysis.sides.rear);};
  const completeJournal=journalPairs.find(pairId=>groups.has(pairId)&&complete(pairId));if(completeJournal)return completeJournal;
  if(explicit&&groups.has(explicit)&&complete(explicit))return explicit;
  const completeStored=[...groups].filter(([pairId])=>complete(pairId)).sort((left,right)=>Math.max(0,...right[1].map(occurredAt))-Math.max(0,...left[1].map(occurredAt)))[0]?.[0];if(completeStored)return completeStored;
  if(explicit)return explicit;
  const journalPair=journalPairs[0]||[...events].reverse().map(pairIdOf).find(Boolean);
  if(journalPair)return journalPair;
  return [...groups]
    .sort((left,right)=>{
      const leftTime=Math.max(0,...left[1].map(occurredAt)),rightTime=Math.max(0,...right[1].map(occurredAt));
      return rightTime-leftTime||right[1].length-left[1].length||left[0].localeCompare(right[0]);
    })[0]?.[0]||null;
}

function evidenceFor(original,records,role){
  return records.find(record=>mediaRole(record)==='evidence'&&cameraRole(record)===role&&(
    text(record.derivedFromMediaId)===text(original.mediaId)||
    text(record.pairedMediaId)===text(original.mediaId)||
    text(record.mediaGroupId)===text(original.mediaGroupId)
  ))||null;
}

function analyzeSides(records,pairId){
  const result={front:null,rear:null},retry=[],reattach=[];
  for(const role of ['front','rear']){
    const roleRecords=records.filter(record=>cameraRole(record)===role),originals=roleRecords.filter(record=>mediaRole(record)==='original');
    let complete=null;
    for(const original of originals){const evidence=evidenceFor(original,roleRecords,role);if(evidence){complete={original,evidence,metadata:{...(original.metadata||{}),...(evidence.metadata||{})}};break;}}
    result[role]=complete;
    if(complete&&(!text(complete.original.pairId)||!text(complete.evidence.pairId)))reattach.push({...complete,role,pairId});
    if(!complete){
      const candidate=originals.find(original=>['failed','pending'].includes(text(original.evidenceStatus).toLowerCase())||text(original.pairStatus).toLowerCase()==='abandoned'||Boolean(pairIdOf(original)));
      if(candidate)retry.push(candidate);
    }
  }
  return {sides:result,retry,reattach};
}

function projectedPhotoState(checkpoint,{hasMedia,completeSideCount,retryCount,completePair}){
  if(completePair)return 'complete';
  if(completeSideCount>0||hasMedia)return 'partial';
  const current=text(checkpoint?.photoEvidenceState||checkpoint?.checkpointEvidence?.photo?.state);
  if(PHOTO_STATES.has(current)&&current!=='complete')return current;
  const legacy=text(checkpoint?.photoStatus).toLowerCase();
  if(/denied|blocked/.test(legacy))return 'permission_blocked';
  if(/interrupt|cancel/.test(legacy))return 'interrupted';
  if(/fail/.test(legacy)||retryCount)return 'failed';
  if(checkpoint?.pendingPhotoPair)return 'capture_started';
  return 'not_attempted';
}

export function createCheckpointEvidenceReconciliationService({mediaRepository,photoEvidence=null}={}){
  if(!mediaRepository||typeof mediaRepository.listCheckpointPhotos!=='function')throw new TypeError('A mission media repository is required.');

  async function inspect({projectId,checkpoint,journalEvents=[],sessionId=null,includeLegacyUnscoped=false}={}){
    const checkpointId=text(checkpoint?.id);if(!projectId||!checkpointId)throw new TypeError('projectId and checkpoint are required.');
    const events=matchingEvents(journalEvents,checkpointId,{sessionId,includeLegacyUnscoped}),arrivalEvents=events.filter(event=>event.eventType==='checkpoint_arrival'&&trustworthyArrival(event)),manualWorkflowEvents=events.filter(event=>event.eventType==='checkpoint_photo_capture_started');
    const arrivalConfirmed=trustworthyArrival(checkpoint)||arrivalEvents.length>0;
    const completionEvent=events.find(event=>COMPLETION_EVENTS.has(event.eventType)&&event.metadata?.objectiveCompletion!==false&&(
      checkpoint.photoRequired!==true||event.metadata?.photoEvidenceState==='complete'||event.metadata?.photoStatus==='recorded'
    ))||null;
    const storedPhotoState=text(checkpoint?.checkpointEvidence?.photo?.state||checkpoint?.photoEvidenceState||checkpoint?.photoStatus).toLowerCase(),evidenceGateComplete=checkpoint.photoRequired!==true||storedPhotoState==='complete'||storedPhotoState==='recorded'||checkpoint?.photoPair?.status==='complete';
    const alreadyCompleted=evidenceGateComplete&&(text(checkpoint?.status).toLowerCase()==='collected'||checkpoint?.checkpointEvidence?.completion?.state==='completed'||Boolean(checkpoint?.completedAt)||Boolean(completionEvent));
    const records=uniqueByMediaId((await mediaRepository.listCheckpointPhotos(String(projectId),checkpointId)).filter(record=>matchesSession(record,sessionId,includeLegacyUnscoped)));
    const groups=groupedMedia(records),pairId=selectPairId(checkpoint,events,groups),pairRecords=pairId?(groups.get(pairId)||[]):[];
    const analysis=analyzeSides(pairRecords,pairId),completeSides=['front','rear'].filter(role=>Boolean(analysis.sides[role])),missingSides=['front','rear'].filter(role=>!analysis.sides[role]);
    const retryOriginalIds=analysis.retry.map(record=>text(record.mediaId)).filter(Boolean),reattachOriginalIds=analysis.reattach.map(item=>text(item.original.mediaId)).filter(Boolean),completePair=completeSides.length===2&&reattachOriginalIds.length===0;
    const pairEvent=events.find(event=>event.eventType==='photo_added'&&pairIdOf(event)===pairId)||null;
    const pairJournalEventId=text(checkpoint?.checkpointEvidence?.photo?.pairJournalEventId||checkpoint?.pendingPhotoPair?.pairJournalEventId||checkpoint?.photoPair?.journalEventId||pairEvent?.eventId||pairRecords[0]?.journalEventId)||null;
    const trustworthyArrivalEvent=arrivalEvents[0]||null,manualWorkflowEvent=manualWorkflowEvents.at(-1)||null;
    const workflowEvent=trustworthyArrivalEvent||manualWorkflowEvent||null,recoveryEligible=arrivalConfirmed||Boolean(workflowEvent)||Boolean(checkpoint?.pendingPhotoPair)||pairRecords.length>0;
    let action='none',reason='not-photo-required';
    if(!recoveryEligible)reason='arrival-not-confirmed';
    else if(!checkpoint.photoRequired)reason='photo-not-required';
    else if(alreadyCompleted)reason='already-completed';
    else if(completePair){action='finalize_pair';reason=pairEvent||pairRecords.every(record=>record.pairStatus==='complete')?'pair-durable':'pair-media-complete';}
    else if(reattachOriginalIds.length){action='retry_evidence';reason='evidence-awaiting-pair-reattachment';}
    else if(retryOriginalIds.length){action='retry_evidence';reason='original-awaiting-evidence';}
    else {action='resume_pair';reason=pairId?'pair-incomplete':'pair-not-started';}
    const photoEvidenceState=projectedPhotoState(checkpoint,{hasMedia:pairRecords.length>0,completeSideCount:completeSides.length,retryCount:retryOriginalIds.length,completePair});
    const sidePairs=Object.freeze(Object.fromEntries(['front','rear'].map(role=>[role,analysis.sides[role]?Object.freeze({
      original:mediaReference(analysis.sides[role].original),evidence:mediaReference(analysis.sides[role].evidence),metadata:Object.freeze({...analysis.sides[role].metadata})
    }):null])));
    return Object.freeze({
      action,reason,checkpointId,pairId,pairJournalEventId,arrivalConfirmed,arrivalEvent:workflowEvent,trustworthyArrivalEvent,manualWorkflowEvent,
      arrivalEventCount:arrivalEvents.length,alreadyCompleted,photoEvidenceState,
      missingSides:freezeList(missingSides),retryOriginalIds:freezeList(retryOriginalIds),reattachOriginalIds:freezeList(reattachOriginalIds),completeSides:freezeList(completeSides),
      mediaIds:freezeList(pairRecords.map(record=>text(record.mediaId))),sidePairs,
      projectionPatch:Object.freeze({arrivalState:arrivalConfirmed?'confirmed':'not_confirmed',photoEvidenceState})
    });
  }

  async function recoverEvidence({projectId,checkpoint,journalEvents=[],sessionId=null,includeLegacyUnscoped=false,inspection=null}={}){
    let report=inspection||await inspect({projectId,checkpoint,journalEvents,sessionId,includeLegacyUnscoped});
    if(report.action!=='retry_evidence')return report;
    for(const originalMediaId of report.reattachOriginalIds||[]){
      const original=await mediaRepository.getMedia?.(originalMediaId),records=(await mediaRepository.listCheckpointPhotos(String(projectId),text(checkpoint?.id))).filter(record=>matchesSession(record,sessionId,includeLegacyUnscoped)),evidence=records.find(record=>mediaRole(record)==='evidence'&&(
        text(record.derivedFromMediaId)===text(originalMediaId)||text(record.pairedMediaId)===text(originalMediaId)||text(record.mediaGroupId)===text(original?.mediaGroupId)
      ));
      if(!original||!evidence||typeof mediaRepository.reattachRecoveredEvidencePair!=='function')continue;
      await mediaRepository.reattachRecoveredEvidencePair({originalMediaId,evidenceMediaId:evidence.mediaId,pairId:report.pairId,cameraRole:cameraRole(original),pairJournalEventId:report.pairJournalEventId});
    }
    report=await inspect({projectId,checkpoint,journalEvents,sessionId,includeLegacyUnscoped});
    if(report.action!=='retry_evidence'||!report.retryOriginalIds.length)return report;
    if(!photoEvidence||typeof photoEvidence.retryEvidence!=='function')return report;
    for(const originalMediaId of report.retryOriginalIds){
      const record=await mediaRepository.getMedia?.(originalMediaId),role=cameraRole(record);
      await photoEvidence.retryEvidence(originalMediaId,{pairId:report.pairId,cameraRole:role,pairJournalEventId:report.pairJournalEventId});
    }
    return inspect({projectId,checkpoint,journalEvents,sessionId,includeLegacyUnscoped});
  }

  async function restoreWorkflow({projectId,checkpoint,journalEvents=[],sessionId=null,includeLegacyUnscoped=false,cameraWorkflow,inspection=null,finalizeCompletePair=true,evidenceContext={},visibility='manual'}={}){
    let report=inspection||await inspect({projectId,checkpoint,journalEvents,sessionId,includeLegacyUnscoped});
    if(!cameraWorkflow||!['resume_pair','finalize_pair'].includes(report.action))return Object.freeze({...report,workflowRestored:false});
    if(!report.arrivalEvent)return Object.freeze({...report,workflowRestored:false,workflowReason:'arrival-journal-event-missing'});
    const current=cameraWorkflow.getState?.()||{status:'idle',sides:{}},matchesExisting=report.pairId?
      text(current.pairId)===text(report.pairId):
      current.status!=='idle'&&text(current.checkpoint?.id)===text(checkpoint.id);
    if(!matchesExisting)cameraWorkflow.start({
      projectId,checkpoint,journalEvent:report.arrivalEvent,required:true,evidenceContext,pairId:report.pairId||undefined,
      pairJournalEventId:report.pairJournalEventId||undefined,visibility,captureKind:checkpoint.type==='hotel'?'hotel':'checkpoint'
    });
    let state=cameraWorkflow.getState?.()||{sides:{}};
    for(const role of ['front','rear'])if(report.sidePairs[role]&&!state.sides?.[role]){cameraWorkflow.restoreSide(role,report.sidePairs[role]);state=cameraWorkflow.getState();}
    if(report.action==='finalize_pair'&&finalizeCompletePair&&state.status!=='ready')await cameraWorkflow.finalizeRestoredPair();
    state=cameraWorkflow.getState?.()||state;
    return Object.freeze({...report,pairId:report.pairId||text(state.pairId)||null,pairJournalEventId:report.pairJournalEventId||text(state.pairJournalEventId)||null,workflowRestored:true,workflowState:state});
  }

  async function reconcile(input={}){
    let report=await inspect(input);
    if(input.recoverEvidence===true&&report.action==='retry_evidence')report=await recoverEvidence({...input,inspection:report});
    if(input.cameraWorkflow&&['resume_pair','finalize_pair'].includes(report.action))return restoreWorkflow({...input,inspection:report});
    return report;
  }

  return Object.freeze({inspect,recoverEvidence,restoreWorkflow,reconcile});
}
