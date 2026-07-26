export const DEFAULT_QUALITY_POLICY=Object.freeze({
  staleAfterMs:15000,
  degradedAccuracyMeters:50,
  rejectAccuracyMeters:1000
});

export function assessObservationQuality(sample,{nowMs,policy=DEFAULT_QUALITY_POLICY}={}){
  const reasons=[];
  const {lat,lon}=sample.location||{};
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat < -90||lat > 90||lon < -180||lon > 180)reasons.push('invalid-location');
  if(!Number.isFinite(sample.timestampMs))reasons.push('missing-timestamp');
  const ageMs=Number.isFinite(sample.timestampMs)?Math.max(0,nowMs-sample.timestampMs):null;
  if(ageMs!==null&&ageMs>policy.staleAfterMs)reasons.push('stale');
  if(!Number.isFinite(sample.accuracyMeters)||sample.accuracyMeters<0)reasons.push('invalid-accuracy');
  else if(sample.accuracyMeters>policy.rejectAccuracyMeters)reasons.push('unusable-accuracy');
  else if(sample.accuracyMeters>policy.degradedAccuracyMeters)reasons.push('poor-accuracy');
  const rejected=reasons.some(reason=>['invalid-location','missing-timestamp','stale','invalid-accuracy','unusable-accuracy'].includes(reason));
  const classification=rejected?'rejected':reasons.length?'degraded':'accepted';
  const accuracyScore=Number.isFinite(sample.accuracyMeters)?Math.max(0,1-(sample.accuracyMeters/policy.rejectAccuracyMeters)):0;
  return Object.freeze({
    classification,
    score:Number(accuracyScore.toFixed(3)),
    reasons:Object.freeze(reasons),
    inputs:Object.freeze({ageMs,accuracyMeters:sample.accuracyMeters})
  });
}
