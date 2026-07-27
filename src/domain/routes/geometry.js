import {deterministicRouteId} from './identity.js';

const coordinate=point=>{
  const lat=Number(point?.lat??point?.latitude),lon=Number(point?.lon??point?.lng??point?.longitude);
  if(!Number.isFinite(lat)||lat< -90||lat>90||!Number.isFinite(lon)||lon< -180||lon>180)throw new TypeError('Route geometry contains an invalid coordinate.');
  return Object.freeze({lat:Number(lat.toFixed(5)),lon:Number(lon.toFixed(5))});
};

export function canonicalRouteGeometry(points){
  if(!Array.isArray(points)||points.length<2)throw new TypeError('Route geometry requires at least two points.');
  const normalized=points.map(coordinate);
  return Object.freeze(normalized.filter((point,index)=>index===0||point.lat!==normalized[index-1].lat||point.lon!==normalized[index-1].lon));
}

export function geometryFingerprint({eventId,fromCheckpointId,toCheckpointId,points}){
  const geometry=canonicalRouteGeometry(points);
  return deterministicRouteId('geometry',[eventId,fromCheckpointId,toCheckpointId,geometry]);
}
