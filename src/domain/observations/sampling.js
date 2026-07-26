const toRadians=value=>value*Math.PI/180;
export function distanceMeters(a,b){
  if(!a||!b)return Infinity;
  const dLat=toRadians(b.lat-a.lat),dLon=toRadians(b.lon-a.lon);
  const lat1=toRadians(a.lat),lat2=toRadians(b.lat);
  const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}

export function shouldSuppressSample(previous,current,{minimumIntervalMs=2000,duplicateRadiusMeters=5}={}){
  if(!previous)return false;
  const elapsed=current.timestampMs-previous.timestampMs;
  return elapsed>=0&&elapsed<minimumIntervalMs&&distanceMeters(previous.location,current.location)<=duplicateRadiusMeters;
}
