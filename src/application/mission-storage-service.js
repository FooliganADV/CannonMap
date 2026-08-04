const bytes=value=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):0;

export function isQuotaExceeded(error){
  return error?.name==='QuotaExceededError'||error?.code===22||error?.code===1014;
}

/** Read-only storage intelligence. It never deletes, resizes, or recompresses media. */
export function createMissionStorageService({mediaRepository,storageManager=globalThis.navigator?.storage,settingsProvider=()=>({})}={}){
  if(!mediaRepository)throw new TypeError('mediaRepository is required.');
  return Object.freeze({
    async estimate(projectId){
      const records=typeof mediaRepository.listAllPhotos==='function'?await mediaRepository.listAllPhotos():await mediaRepository.listProjectPhotos(projectId);
      const projectRecords=records.filter(record=>String(record.projectId)===String(projectId)),originals=records.filter(record=>record.role==='original'),projectOriginals=projectRecords.filter(record=>record.role==='original');
      const estimate=await storageManager?.estimate?.().catch?.(()=>null)||null;
      const recent=projectOriginals.slice().sort((a,b)=>String(b.capturedAt).localeCompare(String(a.capturedAt))).slice(0,20);
      const average=recent.length?recent.reduce((sum,item)=>sum+bytes(item.size),0)/recent.length:0;
      const quota=bytes(estimate?.quota),usage=bytes(estimate?.usage),remaining=quota?Math.max(0,quota-usage):null;
      const settings=settingsProvider()||{},warningThreshold=Number(settings.mediaStorageWarningPercent)||75,criticalThreshold=Number(settings.mediaStorageCriticalPercent)||90;
      const percent=quota?usage/quota*100:null;
      return Object.freeze({usage,quota,remaining,totalMediaSize:records.reduce((sum,item)=>sum+bytes(item.size),0),projectMediaSize:projectRecords.reduce((sum,item)=>sum+bytes(item.size),0),
        totalPhotoCount:originals.length,projectPhotoCount:projectOriginals.length,pairCount:projectRecords.filter(item=>item.role==='original'&&item.evidenceStatus==='complete').length,
        unresolvedFailures:projectRecords.filter(item=>item.role==='original'&&item.evidenceStatus==='failed').length,recentAveragePhotoSize:average,
        estimatedRemainingCaptures:remaining!==null&&average>0?Math.floor(remaining/(average*2)):null,warningLevel:percent===null?'unknown':percent>=criticalThreshold?'critical':percent>=warningThreshold?'warning':'ok'});
    }
  });
}

