export function evaluateArrivalSample({checkpointId,distanceFeet,accuracyFeet,radiusFeet,maxAccuracyFeet,candidate,now,dwellMs=2000}={}){
  if(!checkpointId||!Number.isFinite(distanceFeet))return {decision:'rejected',reason:'location-unavailable',candidate};
  if(!Number.isFinite(accuracyFeet)||accuracyFeet>maxAccuracyFeet)return {decision:'retry',reason:'accuracy-poor',candidate};
  if(distanceFeet>radiusFeet+Math.min(accuracyFeet,maxAccuracyFeet))return {decision:'rejected',reason:'outside-radius',candidate:null};
  if(candidate?.checkpointId!==checkpointId)return {decision:'candidate',reason:'dwell-started',candidate:{checkpointId,enteredAt:now}};
  if(now-candidate.enteredAt<dwellMs)return {decision:'candidate',reason:'dwell-incomplete',candidate};
  return {decision:'accepted',reason:'',candidate:null};
}
