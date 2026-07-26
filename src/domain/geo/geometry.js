export function validPoint(point){
  return Number.isFinite(point?.lat)&&Number.isFinite(point?.lon)&&Math.abs(point.lat)<=90&&Math.abs(point.lon)<=180;
}

export function haversineMeters(a,b){
  const radius=6371000,toRadians=value=>value*Math.PI/180;
  const latitudeDelta=toRadians(b.lat-a.lat),longitudeDelta=toRadians(b.lon-a.lon);
  const value=Math.sin(latitudeDelta/2)**2+
    Math.cos(toRadians(a.lat))*Math.cos(toRadians(b.lat))*Math.sin(longitudeDelta/2)**2;
  return 2*radius*Math.asin(Math.sqrt(value));
}

export function lineDistanceMiles(points){
  let meters=0;
  for(let index=1;index<points.length;index++)meters+=haversineMeters(points[index-1],points[index]);
  return meters/1609.344;
}

export function distancePointToSegmentMiles(point,start,end){
  const x=point.lon,y=point.lat,x1=start.lon,y1=start.lat,x2=end.lon,y2=end.lat;
  const dx=x2-x1,dy=y2-y1;
  const ratio=(dx||dy)?Math.max(0,Math.min(1,((x-x1)*dx+(y-y1)*dy)/(dx*dx+dy*dy))):0;
  return lineDistanceMiles([point,{lat:y1+ratio*dy,lon:x1+ratio*dx}]);
}
