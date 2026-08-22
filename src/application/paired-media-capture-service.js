const SIDES=Object.freeze([
  Object.freeze({key:'road',cameraRole:'rear',requestedCamera:'rear'}),
  Object.freeze({key:'rider',cameraRole:'front',requestedCamera:'front'})
]);

const defaultId=()=>globalThis.crypto?.randomUUID?.()||`media-pair-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const finitePositive=value=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):null;
const captureSummary=capture=>({
  mimeType:String(capture?.provenance?.mimeType||capture?.blob?.type||'application/octet-stream'),
  byteLength:Number(capture?.provenance?.byteLength||capture?.blob?.size)||0,
  width:finitePositive(capture?.provenance?.width),height:finitePositive(capture?.provenance?.height),
  sourceKind:capture?.provenance?.sourceKind||'unknown',nativeStill:capture?.provenance?.nativeStill===true,
  derivedFromVideoFrame:capture?.provenance?.derivedFromVideoFrame===true,
  recoveryPath:capture?.provenance?.recoveryPath||'none',nativeRetryCount:Number(capture?.provenance?.nativeRetryCount)||0
});
const validNativeStill=capture=>capture?.provenance?.nativeStill===true&&capture?.provenance?.derivedFromVideoFrame!==true&&capture?.provenance?.cameraSelectionHonored!==false;
const recoveredCapture=capture=>Number(capture?.provenance?.nativeRetryCount)>0||String(capture?.provenance?.recoveryPath||'none')!=='none';

function degradedCaptureError(capture,side){
  return Object.assign(new Error('Automatic checkpoint Evidence requires a native still; the recovered video frame was retained only as degraded capture context.'),{
    code:'NON_NATIVE_AUTOMATIC_CAPTURE',degradedCapture:capture,degradedCaptures:Object.freeze({[side.key]:capture})
  });
}

/** Conservative and metadata-only: no decoded pixels or camera bytes enter diagnostics. */
export function assessNativeStillQuality(capture,{minimumWidth=960,minimumHeight=720,minimumBytesPerPixel=.012}={}){
  const summary=captureSummary(capture),pixels=summary.width&&summary.height?summary.width*summary.height:null,density=pixels?summary.byteLength/pixels:null,reasons=[];
  if(summary.width&&summary.height&&(summary.width<minimumWidth||summary.height<minimumHeight))reasons.push('low-resolution');
  if(density!==null&&summary.byteLength<90_000&&density<minimumBytesPerPixel)reasons.push('unusually-small-encoding');
  return Object.freeze({...summary,pixels,bytesPerPixel:density,poor:reasons.length>0,reasons:Object.freeze(reasons)});
}

export function selectBestNativeStill(primary,backup,{assess=assessNativeStillQuality}={}){
  if(!backup)return Object.freeze({selected:primary,selection:'primary-only',primaryQuality:assess(primary),backupQuality:null});
  const first=assess(primary),second=assess(backup);let selected=primary,selection='primary-retained';
  if(first.poor&&!second.poor){selected=backup;selection='backup-clearly-better';}
  else if(first.poor&&second.poor){
    const pixelGain=first.pixels&&second.pixels?second.pixels/first.pixels:1,byteGain=first.byteLength?second.byteLength/first.byteLength:1;
    if(pixelGain>=1.2||(pixelGain>=.95&&byteGain>=1.35)){selected=backup;selection='backup-clearly-better';}
  }
  return Object.freeze({selected,selection,primaryQuality:first,backupQuality:second});
}

export class PairedMediaCaptureError extends Error{
  constructor(message,{cause,pairId,failedSide,failureStage=null,partial={},recoverableOriginal=null,degradedCapture=null,degradedCaptures=null}={}){
    super(message,{cause});this.name='PairedMediaCaptureError';this.code='PAIRED_MEDIA_CAPTURE_FAILED';this.pairId=pairId||null;this.failedSide=failedSide||null;this.partial=Object.freeze({...partial});
    this.failureStage=failureStage||cause?.failureStage||'unknown';
    this.recoverableOriginal=recoverableOriginal||cause?.originalMedia||null;
    this.evidenceRetryable=Boolean(cause?.evidenceRetryable&&this.recoverableOriginal);
    this.originalDurablyDetached=Boolean(cause?.originalDurablyDetached);
    this.requiresNewPair=Boolean(cause?.requiresNewPair);
    this.cleanupErrors=Object.freeze([...(cause?.cleanupErrors||[])]);
    this.degradedCapture=degradedCapture||cause?.degradedCapture||null;
    this.degradedCaptures=Object.freeze({...cause?.degradedCaptures,...degradedCaptures});
  }
}

export const isNativeCameraCaptureFailure=error=>error instanceof PairedMediaCaptureError&&error.failureStage==='camera-capture';

function withFailureStage(error,failureStage){
  if(error?.failureStage)return error;
  const wrapped=new Error(error?.message||String(error),{cause:error});
  wrapped.name=error?.name||'Error';wrapped.code=error?.code||null;wrapped.failureStage=failureStage;
  for(const key of ['originalMedia','evidenceRetryable','originalDurablyDetached','requiresNewPair','cleanupErrors','degradedCapture','degradedCaptures'])if(error?.[key]!==undefined)wrapped[key]=error[key];
  return wrapped;
}

/**
 * Application orchestration for a road/rear still followed by a rider/front still.
 * The injected captureStill port must return {blob, provenance} from a native still source.
 * Supplying photoEvidence persists an untouched Original and an independent Evidence derivative.
 */
export function createPairedMediaCaptureService({captureStill,photoEvidence=null,createId=defaultId,clock={iso:()=>new Date().toISOString()},assess=assessNativeStillQuality}={}){
  if(typeof captureStill!=='function')throw new TypeError('captureStill is required.');

  const emit=async(callback,eventType,details={})=>callback?.(Object.freeze({eventType,occurredAt:clock.iso(),...details}));

  async function captureSide(side,{signal,pairId,pairJournalEventId,projectId,checkpointId,journalEventId,context,onEvent}){
    const common={pairId,cameraRole:side.cameraRole,requestedCamera:side.requestedCamera};
    await emit(onEvent,'automatic_capture_initiated',{...common,side:side.key});
    let primary,failureStage='camera-capture';
    try{
    try{
      primary=await captureStill(side.requestedCamera,{signal,captureType:'checkpoint_evidence',onPhase:(phase,details)=>emit(onEvent,phase,{...common,side:side.key,...details})});
    }catch(error){
      await emit(onEvent,'camera_failure',{...common,side:side.key,errorName:error?.name||'Error',errorCode:error?.code||null});throw error;
    }
    if(!validNativeStill(primary)){
      await emit(onEvent,'automatic_degraded_capture_rejected',{...common,side:side.key,...captureSummary(primary),reason:'checkpoint-evidence-requires-native-still'});
      throw degradedCaptureError(primary,side);
    }
    const primaryQuality=assess(primary);
    await emit(onEvent,'automatic_primary_capture',{...common,side:side.key,quality:primaryQuality});

    let backup=null,backupAttempted=false;
    if(primaryQuality.poor&&!recoveredCapture(primary)){
      backupAttempted=true;
      await emit(onEvent,'automatic_backup_capture_initiated',{...common,side:side.key,reasons:primaryQuality.reasons});
      try{backup=await captureStill(side.requestedCamera,{signal,captureType:'checkpoint_evidence',onPhase:(phase,details)=>emit(onEvent,phase,{...common,side:side.key,attempt:'backup',...details})});}
      catch(error){await emit(onEvent,'automatic_backup_capture_failed',{...common,side:side.key,errorName:error?.name||'Error',errorCode:error?.code||null});}
    }else if(primaryQuality.poor){
      await emit(onEvent,'automatic_quality_backup_suppressed',{...common,side:side.key,reasons:primaryQuality.reasons,recoveryPath:primary.provenance?.recoveryPath||'none',nativeRetryCount:Number(primary.provenance?.nativeRetryCount)||0});
    }
    if(backup&&!validNativeStill(backup)){
      await emit(onEvent,'automatic_backup_capture_failed',{...common,side:side.key,errorName:'InvalidSource',errorCode:'NON_NATIVE_BACKUP'});backup=null;
    }
    const choice=selectBestNativeStill(primary,backup,{assess});
    await emit(onEvent,'automatic_image_selected',{...common,side:side.key,selection:choice.selection,selected:captureSummary(choice.selected)});

    let media=null;
    if(photoEvidence){
      failureStage='media-persistence';
      const provenance=choice.selected.provenance,capturedAt=clock.iso();
      media=await photoEvidence.capture({
        projectId,checkpointId,journalEventId,file:choice.selected.blob,source:choice.selected,
        context:{...context,capturedAt,captureTimestamp:capturedAt,captureMethod:provenance.captureMethod,requestedCamera:provenance.requestedCamera,actualCamera:provenance.actualCamera,cameraSelectionHonored:provenance.cameraSelectionHonored,cameraRole:side.cameraRole,pairId,pairJournalEventId,originalSourceProvenance:provenance}
      });
      await emit(onEvent,'automatic_media_persisted',{...common,side:side.key,originalMediaId:media.original?.mediaId||null,evidenceMediaId:media.evidence?.mediaId||null});
    }
    return Object.freeze({side:side.key,cameraRole:side.cameraRole,capture:choice.selected,quality:Object.freeze({primary:choice.primaryQuality,backup:choice.backupQuality,selection:choice.selection,backupAttempted}),media});
    }catch(error){throw withFailureStage(error,failureStage);}
  }

  return Object.freeze({
    async capturePair({signal,projectId=null,checkpointId=null,journalEventId=null,pairJournalEventId=journalEventId,pairId=createId(),context={},onEvent=async()=>{}}={}){
      const sides={},base={pairId,pairJournalEventId};
      await emit(onEvent,'paired_capture_initiated',base);
      for(const side of SIDES){
        try{sides[side.key]=await captureSide(side,{signal,pairId,pairJournalEventId,projectId,checkpointId,journalEventId,context,onEvent});}
        catch(error){throw new PairedMediaCaptureError(`Automatic ${side.key} capture failed.`,{cause:error,pairId,failedSide:side.key,failureStage:error?.failureStage,partial:sides,recoverableOriginal:error?.originalMedia||null,degradedCapture:error?.degradedCapture||null,degradedCaptures:error?.degradedCaptures||null});}
      }
      // Pair completion belongs to checkpoint-camera-workflow, which first writes the
      // durable photo_added Journal relationship and then marks all four assets complete.
      await emit(onEvent,'paired_capture_completed',{pairId,pairJournalEventId,roadOriginalMediaId:sides.road.media?.original?.mediaId||null,riderOriginalMediaId:sides.rider.media?.original?.mediaId||null});
      return Object.freeze({pairId,pairJournalEventId,status:'complete',road:sides.road,rider:sides.rider,sides:Object.freeze({rear:sides.road,front:sides.rider})});
    }
  });
}
