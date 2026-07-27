export const CHECKPOINT_SCHEMA_VERSION=1;
export const CHECKPOINT_ALGORITHM_VERSION='m10-checkpoint-aggregate-v1';
export const SEQUENCE_ALGORITHM_VERSION='m10-sequence-aggregate-v1';
export const CHECKPOINT_PROJECTION_FLAG='architecture.intelligence.checkpoints';
export const SEQUENCE_PROJECTION_FLAG='architecture.intelligence.sequences';

const nonempty=value=>typeof value==='string'&&value.length>0;
const count=value=>Number.isInteger(value)&&value>=0;
const finiteOrNull=value=>value===null||Number.isFinite(value);
const required=(record,fields)=>fields.filter(field=>record?.[field]===undefined||record[field]===null);

export function validateCheckpointAggregate(record){
  const errors=required(record,['eventId','checkpointId','aggregateId','revisionId','revision','schemaVersion','algorithmVersion','createdAt','updatedAt','evidenceRefs','sourceRevisionRefs','successCount','failureCount','dwellStatistics','transitionStatistics','routeFamilyRefs','confidenceRefs','provenance','explanation']);
  if(record?.schemaVersion!==CHECKPOINT_SCHEMA_VERSION)errors.push('schemaVersion');
  if(record?.algorithmVersion!==CHECKPOINT_ALGORITHM_VERSION)errors.push('algorithmVersion');
  if(![record?.eventId,record?.checkpointId,record?.aggregateId,record?.revisionId].every(nonempty))errors.push('identity');
  if(!count(record?.revision)||record.revision<1||!count(record?.successCount)||!count(record?.failureCount))errors.push('counts');
  if(!Number.isInteger(record?.createdAt)||!Number.isInteger(record?.updatedAt)||record.updatedAt<record.createdAt)errors.push('timestamps');
  if(!Array.isArray(record?.evidenceRefs)||!Array.isArray(record?.sourceRevisionRefs)||!Array.isArray(record?.routeFamilyRefs)||!Array.isArray(record?.confidenceRefs)||!Array.isArray(record?.provenance))errors.push('references');
  for(const field of ['meanMs','minMs','maxMs'])if(!finiteOrNull(record?.dwellStatistics?.[field]))errors.push(`dwell:${field}`);
  return Object.freeze({valid:errors.length===0,errors:Object.freeze(errors)});
}

export function validateSequenceAggregate(record){
  const errors=required(record,['eventId','sequenceId','orderedCheckpointIds','revisionId','revision','schemaVersion','algorithmVersion','createdAt','updatedAt','evidenceRefs','sourceCheckpointRevisionRefs','aggregateProfile','transitionCounts','statistics','routeFamilyRefs','routeVariantRefs','confidenceRefs','provenance','explanation']);
  if(record?.schemaVersion!==CHECKPOINT_SCHEMA_VERSION)errors.push('schemaVersion');
  if(record?.algorithmVersion!==SEQUENCE_ALGORITHM_VERSION)errors.push('algorithmVersion');
  if(![record?.eventId,record?.sequenceId,record?.revisionId].every(nonempty)||!Array.isArray(record?.orderedCheckpointIds)||record.orderedCheckpointIds.length<2)errors.push('identity');
  if(!count(record?.revision)||record.revision<1||!Number.isInteger(record?.createdAt)||!Number.isInteger(record?.updatedAt))errors.push('revision-timestamps');
  if(!Array.isArray(record?.routeFamilyRefs)||!Array.isArray(record?.routeVariantRefs)||!Array.isArray(record?.confidenceRefs))errors.push('references');
  return Object.freeze({valid:errors.length===0,errors:Object.freeze(errors)});
}

export function assertCheckpointAggregate(record){
  const result=validateCheckpointAggregate(record);
  if(!result.valid)throw new TypeError(`Invalid checkpoint aggregate: ${result.errors.join(', ')}`);
  return record;
}

export function assertSequenceAggregate(record){
  const result=validateSequenceAggregate(record);
  if(!result.valid)throw new TypeError(`Invalid sequence aggregate: ${result.errors.join(', ')}`);
  return record;
}
