const freeze=value=>Object.freeze({...value});
const time=value=>{const parsed=value instanceof Date?value.valueOf():typeof value==='string'?Date.parse(value):Number(value);return Number.isFinite(parsed)?parsed:null;};

/** Read-only health hook for a manual or future scheduled Day-backup workflow. */
export function createBackupSchedulerHealth({now=()=>Date.now(),expectedHeartbeatMs=5*60_000,backupDueAfterMs=2*60*60_000,onStateChange=()=>{}}={}){
  const heartbeatLimit=Math.max(1_000,Number(expectedHeartbeatMs)||5*60_000),backupLimit=Math.max(heartbeatLimit,Number(backupDueAfterMs)||2*60*60_000);
  let sessionId=null,sessionStartedAt=null,lastHeartbeatAt=null,lastStartedAt=null,lastCompletedAt=null,lastFailedAt=null,lastError=null,completedFilename=null;
  const snapshot=()=>{
    const timestamp=now(),schedulerAge=lastHeartbeatAt===null?null:Math.max(0,timestamp-lastHeartbeatAt),backupAnchor=lastCompletedAt??sessionStartedAt,backupAge=backupAnchor===null?null:Math.max(0,timestamp-backupAnchor);
    const schedulerStatus=!sessionId?'unconfigured':lastHeartbeatAt===null?'starting':schedulerAge>heartbeatLimit*2?'stalled':'healthy';
    const backupStatus=!sessionId?'unconfigured':lastStartedAt!==null&&lastStartedAt>(lastCompletedAt??-Infinity)&&lastStartedAt>(lastFailedAt??-Infinity)?'running':lastFailedAt!==null&&lastFailedAt>(lastCompletedAt??-Infinity)?'failed':backupAge!==null&&backupAge>backupLimit?'overdue':lastCompletedAt!==null?'current':'due';
    return freeze({sessionId,sessionStartedAt,schedulerStatus,schedulerAgeMs:schedulerAge,backupStatus,backupAgeMs:backupAge,lastHeartbeatAt,lastStartedAt,lastCompletedAt,lastFailedAt,lastError,completedFilename,expectedHeartbeatMs:heartbeatLimit,backupDueAfterMs:backupLimit});
  };
  const emit=()=>{const value=snapshot();try{onStateChange(value);}catch{}return value;};
  return Object.freeze({
    beginSession({sessionId:requestedSessionId,startedAt=now()}={}){sessionId=String(requestedSessionId||'').trim();if(!sessionId)throw new TypeError('sessionId is required.');sessionStartedAt=time(startedAt);if(sessionStartedAt===null)throw new TypeError('startedAt is invalid.');lastHeartbeatAt=now();lastStartedAt=null;lastCompletedAt=null;lastFailedAt=null;lastError=null;completedFilename=null;return emit();},
    heartbeat(at=now()){lastHeartbeatAt=time(at);return emit();},
    backupStarted(at=now()){lastStartedAt=time(at);lastError=null;return emit();},
    backupCompleted({at=now(),filename=null}={}){lastCompletedAt=time(at);lastError=null;completedFilename=filename?String(filename):null;return emit();},
    backupFailed(error,{at=now()}={}){lastFailedAt=time(at);lastError=String(error?.message||error||'Backup failed.');return emit();},
    clear(){sessionId=null;sessionStartedAt=null;lastHeartbeatAt=null;lastStartedAt=null;lastCompletedAt=null;lastFailedAt=null;lastError=null;completedFilename=null;return emit();},
    state:snapshot
  });
}
