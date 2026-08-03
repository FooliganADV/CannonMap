const MPH_PER_MPS=2.2369362921;

export function captureArrivalEvidence(sample,now=Date.now(),{headingMaxAgeMs=15000}={}){
  const timestamp=sample?.time||sample?.timestamp||null,parsed=timestamp?Date.parse(timestamp):NaN;
  const sampleAgeMs=Number.isFinite(parsed)?Math.max(0,now-parsed):null;
  const numeric=value=>value===null||value===undefined||value===''?null:(Number.isFinite(Number(value))?Number(value):null),rawSpeed=numeric(sample?.speedMps),speedMph=rawSpeed!==null&&rawSpeed>=0?rawSpeed*MPH_PER_MPS:null,heading=numeric(sample?.heading);
  const stationary=speedMph!==null&&speedMph<1,headingFresh=heading!==null&&sampleAgeMs!==null&&sampleAgeMs<=headingMaxAgeMs&&!stationary;
  return Object.freeze({latitude:numeric(sample?.lat),longitude:numeric(sample?.lon),elevationFeet:numeric(sample?.elevationFeet),gpsAccuracyFeet:numeric(sample?.accuracyFeet),
    speedMph:speedMph===null?null:(stationary?0:speedMph),motion:speedMph===null?'unavailable':(stationary?'stationary':'moving'),heading:headingFresh?Number(sample.heading):null,
    sampleTimestamp:timestamp,sampleAgeMs,headingFresh});
}
