export const PREFERRED_MISSION_MEDIA_BUDGET_BYTES=10_000_000_000;
export const CONSERVATIVE_PAIRED_CAPTURE_BYTES=64_000_000;

/** Decimal units keep the stated 10 GB planning target distinct from browser quota bytes. */
export function formatPreferredMissionMediaBudget(value){
  const amount=Math.max(0,Number(value)||0);
  if(amount<1000)return `${amount} B`;
  if(amount<1_000_000)return `${Number((amount/1000).toFixed(1))} KB`;
  if(amount<1_000_000_000)return `${Number((amount/1_000_000).toFixed(1))} MB`;
  return `${Number((amount/1_000_000_000).toFixed(1))} GB`;
}

const positiveBytes=value=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):0;
const optionalBytes=value=>Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;
const recordBytes=record=>positiveBytes(record?.size)||positiveBytes(record?.blob?.size);
const metadataValue=(record,key)=>record?.[key]??record?.metadata?.[key]??null;
const cameraRole=record=>String(metadataValue(record,'cameraRole')||'').toLowerCase();
const mediaRole=record=>String(record?.role||metadataValue(record,'role')||'').toLowerCase();
const pairIdentity=record=>metadataValue(record,'pairId');
const capturedAt=record=>String(record?.capturedAt||record?.metadata?.captureTimestamp||record?.metadata?.capturedAt||'');

function completeCaptureGroups(records){
  const groups=new Map();
  for(const record of records){
    const pairId=pairIdentity(record);
    if(!pairId)continue;
    const key=String(pairId);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(record);
  }
  return [...groups].flatMap(([pairId,rows])=>{
    const assets=new Set(rows.map(row=>`${cameraRole(row)}:${mediaRole(row)}`));
    const complete=['front:original','front:evidence','rear:original','rear:evidence'].every(key=>assets.has(key));
    if(!complete)return [];
    return [{pairId,bytes:rows.reduce((sum,row)=>sum+recordBytes(row),0),capturedAt:rows.reduce((latest,row)=>capturedAt(row)>latest?capturedAt(row):latest,'')}];
  }).sort((a,b)=>b.capturedAt.localeCompare(a.capturedAt));
}

async function safelyCall(target,method){
  if(!target||typeof target[method]!=='function')return {supported:false,value:null,error:null};
  try{return {supported:true,value:await target[method].call(target),error:null};}
  catch(error){return {supported:true,value:null,error};}
}

function persistenceResult({persistedSupport,persistSupport,value=null,error=null,requested=false}={}){
  const persisted=value===true?true:value===false?false:null;
  return Object.freeze({
    supported:Boolean(persistedSupport||persistSupport),
    status:error?'error':persisted===true?'granted':persisted===false?'not-granted':'unsupported',
    persisted,
    requestSupported:Boolean(persistSupport),
    requested:Boolean(requested),
    error:error?String(error?.message||error):null
  });
}

export function isQuotaExceeded(error){
  return error?.name==='QuotaExceededError'||error?.code===22||error?.code===1014;
}

/**
 * Read-only mission-media storage intelligence. It never deletes, resizes,
 * recompresses, or otherwise mutates media. Calling requestPersistence only asks
 * the browser to protect the existing origin storage from automatic eviction.
 */
export function createMissionStorageService({mediaRepository,storageManager=globalThis.navigator?.storage,settingsProvider=()=>({})}={}){
  if(!mediaRepository)throw new TypeError('mediaRepository is required.');

  const readPersistence=async()=>{
    const result=await safelyCall(storageManager,'persisted');
    return persistenceResult({persistedSupport:result.supported,persistSupport:typeof storageManager?.persist==='function',value:result.value,error:result.error});
  };

  return Object.freeze({
    persistenceStatus:readPersistence,

    async requestPersistence(){
      const before=await readPersistence();
      if(before.persisted===true||typeof storageManager?.persist!=='function')return before;
      const result=await safelyCall(storageManager,'persist');
      if(result.error)return persistenceResult({persistedSupport:typeof storageManager?.persisted==='function',persistSupport:true,error:result.error,requested:true});
      const after=await readPersistence();
      return persistenceResult({persistedSupport:typeof storageManager?.persisted==='function',persistSupport:true,value:after.persisted??result.value,error:after.status==='error'?new Error(after.error):null,requested:true});
    },

    async estimate(projectId){
      const records=typeof mediaRepository.listAllPhotos==='function'?await mediaRepository.listAllPhotos():await mediaRepository.listProjectPhotos(projectId);
      const projectRecords=records.filter(record=>String(record.projectId)===String(projectId));
      const originals=records.filter(record=>mediaRole(record)==='original');
      const projectOriginals=projectRecords.filter(record=>mediaRole(record)==='original');
      const storageEstimate=await safelyCall(storageManager,'estimate');
      const estimate=storageEstimate.value&&typeof storageEstimate.value==='object'?storageEstimate.value:null;
      const actualQuotaBytes=optionalBytes(estimate?.quota);
      const actualUsageBytes=optionalBytes(estimate?.usage);
      const actualRemainingBytes=actualQuotaBytes!==null&&actualUsageBytes!==null?Math.max(0,actualQuotaBytes-actualUsageBytes):null;
      const persistence=await readPersistence();

      let settings={};
      try{settings=settingsProvider()||{};}catch(_){settings={};}
      const preferredMissionMediaBudgetBytes=positiveBytes(settings.preferredMissionMediaBudgetBytes)||PREFERRED_MISSION_MEDIA_BUDGET_BYTES;
      const pairedCaptureFallbackBytes=positiveBytes(settings.mediaPairedCaptureFallbackBytes)||CONSERVATIVE_PAIRED_CAPTURE_BYTES;
      const totalMediaSize=records.reduce((sum,item)=>sum+recordBytes(item),0);
      const projectMediaSize=projectRecords.reduce((sum,item)=>sum+recordBytes(item),0);
      const preferredMissionMediaRemainingBytes=Math.max(0,preferredMissionMediaBudgetBytes-totalMediaSize);

      const projectGroups=completeCaptureGroups(projectRecords);
      const allGroups=projectGroups.length?projectGroups:completeCaptureGroups(records);
      const recentGroups=allGroups.slice(0,20);
      const recentAveragePairSize=recentGroups.length?recentGroups.reduce((sum,item)=>sum+item.bytes,0)/recentGroups.length:0;
      const recentMaximumPairSize=recentGroups.length?Math.max(...recentGroups.map(item=>item.bytes)):0;
      const estimatedPairedCaptureBytes=Math.max(pairedCaptureFallbackBytes,recentMaximumPairSize);
      const preferredBudgetEstimatedRemainingCapturePairs=Math.floor(preferredMissionMediaRemainingBytes/estimatedPairedCaptureBytes);
      // A preferred budget is not storage capacity. Do not promise remaining
      // captures when the browser cannot report its real quota.
      const effectiveRemainingMediaBytes=actualRemainingBytes===null?null:Math.min(actualRemainingBytes,preferredMissionMediaRemainingBytes);
      const estimatedRemainingCapturePairs=effectiveRemainingMediaBytes===null?null:Math.floor(effectiveRemainingMediaBytes/estimatedPairedCaptureBytes);

      const recentOriginals=projectOriginals.slice().sort((a,b)=>capturedAt(b).localeCompare(capturedAt(a))).slice(0,20);
      const recentAveragePhotoSize=recentOriginals.length?recentOriginals.reduce((sum,item)=>sum+recordBytes(item),0)/recentOriginals.length:0;
      const warningThreshold=Number(settings.mediaStorageWarningPercent)||75;
      const criticalThreshold=Number(settings.mediaStorageCriticalPercent)||90;
      const percent=actualQuotaBytes&&actualUsageBytes!==null?actualUsageBytes/actualQuotaBytes*100:null;
      const warningLevel=percent===null?'unknown':percent>=criticalThreshold?'critical':percent>=warningThreshold?'warning':'ok';

      return Object.freeze({
        // Backwards-compatible fields used by the existing Mission Control UI.
        usage:actualUsageBytes??0,
        quota:actualQuotaBytes??0,
        remaining:actualRemainingBytes,
        totalMediaSize,
        projectMediaSize,
        totalPhotoCount:originals.length,
        projectPhotoCount:projectOriginals.length,
        pairCount:projectGroups.length,
        unresolvedFailures:projectOriginals.filter(item=>item.evidenceStatus==='failed').length,
        recentAveragePhotoSize,
        estimatedRemainingCaptures:estimatedRemainingCapturePairs,
        warningLevel,

        // Explicit mission budget, actual browser capacity, and paired-media model.
        preferredMissionMediaBudgetBytes,
        preferredMissionMediaUsedBytes:totalMediaSize,
        preferredMissionMediaRemainingBytes,
        actualUsageBytes,
        actualQuotaBytes,
        actualRemainingBytes,
        storageEstimateSupported:storageEstimate.supported,
        storageEstimateError:storageEstimate.error?String(storageEstimate.error?.message||storageEstimate.error):null,
        persistence,
        recentCompleteCaptureGroupCount:recentGroups.length,
        recentCaptureGroupSampleSource:projectGroups.length?'project':recentGroups.length?'all-projects':'fallback',
        recentAveragePairSize,
        recentMaximumPairSize,
        pairedCaptureFallbackBytes,
        estimatedPairedCaptureBytes,
        effectiveRemainingMediaBytes,
        estimatedRemainingCapturePairs,
        preferredBudgetEstimatedRemainingCapturePairs,
        preferredBudget:Object.freeze({targetBytes:preferredMissionMediaBudgetBytes,usedBytes:totalMediaSize,remainingBytes:preferredMissionMediaRemainingBytes,kind:'preferred-not-guaranteed'}),
        browserStorage:Object.freeze({usageBytes:actualUsageBytes,quotaBytes:actualQuotaBytes,remainingBytes:actualRemainingBytes,estimateSupported:storageEstimate.supported,persistence})
      });
    }
  });
}
