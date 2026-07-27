export const ROUTE_SCHEMA_VERSION=1;
export const ROUTE_LIFECYCLES=Object.freeze(['provisional','active','superseded','rejected']);
export const LINEAGE_KINDS=Object.freeze(['created','revised','merge-proposed','merge-applied','split-proposed','split-applied']);

const nonEmpty=value=>typeof value==='string'&&value.trim().length>0;
const revision=value=>Number.isInteger(value)&&value>0;
const lifecycle=value=>ROUTE_LIFECYCLES.includes(value);

export function validateRouteVariant(value){
  const errors=[];
  if(value?.schemaVersion!==ROUTE_SCHEMA_VERSION)errors.push('schemaVersion');
  if(!nonEmpty(value?.variantId))errors.push('variantId');
  if(!nonEmpty(value?.familyId))errors.push('familyId');
  if(!nonEmpty(value?.geometryFingerprint))errors.push('geometryFingerprint');
  if(!lifecycle(value?.lifecycle))errors.push('lifecycle');
  if(!revision(value?.revision))errors.push('revision');
  if(!value?.independentStats||typeof value.independentStats!=='object')errors.push('independentStats');
  if(!Array.isArray(value?.evidenceRefs))errors.push('evidenceRefs');
  return Object.freeze({valid:errors.length===0,errors:Object.freeze(errors)});
}

export function validateRouteFamily(value){
  const errors=[];
  if(value?.schemaVersion!==ROUTE_SCHEMA_VERSION)errors.push('schemaVersion');
  if(!nonEmpty(value?.familyId))errors.push('familyId');
  if(!lifecycle(value?.lifecycle))errors.push('lifecycle');
  if(!revision(value?.revision))errors.push('revision');
  if(!value?.aggregateStats||typeof value.aggregateStats!=='object')errors.push('aggregateStats');
  if(!Array.isArray(value?.memberVariantIds))errors.push('memberVariantIds');
  if(!Array.isArray(value?.lineage))errors.push('lineage');
  return Object.freeze({valid:errors.length===0,errors:Object.freeze(errors)});
}

export function assertRouteRecord(value,kind){
  const result=kind==='family'?validateRouteFamily(value):validateRouteVariant(value);
  if(!result.valid)throw new TypeError(`Invalid Route ${kind}: ${result.errors.join(', ')}`);
  return value;
}
