const fixed=value=>Number((Number(value)||0).toFixed(3));
const immutable=value=>Object.freeze(value);

export function emptyVariantStats(){
  return immutable({traversalCount:0,evidenceCount:0,totalDistanceMeters:0,totalDurationSeconds:0,averageDistanceMeters:0,averageDurationSeconds:0,averageSpeedMps:0,minDurationSeconds:null,maxDurationSeconds:null});
}

export function accumulateVariantStats(previous=emptyVariantStats(),traversal={}){
  const distance=Math.max(0,Number(traversal.distanceMeters)||0);
  const duration=Math.max(0,Number(traversal.durationSeconds)||0);
  const count=previous.traversalCount+1,totalDistance=previous.totalDistanceMeters+distance,totalDuration=previous.totalDurationSeconds+duration;
  return immutable({
    traversalCount:count,
    evidenceCount:previous.evidenceCount+new Set(traversal.evidenceRefs||[]).size,
    totalDistanceMeters:fixed(totalDistance),
    totalDurationSeconds:fixed(totalDuration),
    averageDistanceMeters:fixed(totalDistance/count),
    averageDurationSeconds:fixed(totalDuration/count),
    averageSpeedMps:fixed(totalDuration?totalDistance/totalDuration:0),
    minDurationSeconds:previous.minDurationSeconds===null?fixed(duration):fixed(Math.min(previous.minDurationSeconds,duration)),
    maxDurationSeconds:previous.maxDurationSeconds===null?fixed(duration):fixed(Math.max(previous.maxDurationSeconds,duration))
  });
}

export function aggregateFamilyStats(variants=[]){
  const stats=variants.map(item=>item.independentStats),traversalCount=stats.reduce((sum,item)=>sum+item.traversalCount,0);
  const totalDistance=stats.reduce((sum,item)=>sum+item.totalDistanceMeters,0),totalDuration=stats.reduce((sum,item)=>sum+item.totalDurationSeconds,0);
  return immutable({
    variantCount:variants.length,
    traversalCount,
    evidenceCount:stats.reduce((sum,item)=>sum+item.evidenceCount,0),
    totalDistanceMeters:fixed(totalDistance),
    totalDurationSeconds:fixed(totalDuration),
    averageDistanceMeters:fixed(traversalCount?totalDistance/traversalCount:0),
    averageDurationSeconds:fixed(traversalCount?totalDuration/traversalCount:0),
    averageSpeedMps:fixed(totalDuration?totalDistance/totalDuration:0)
  });
}
