import {normalizeProject} from '../../domain/projects/model.js';

export const DATABASE_NAME='CannonMapDB';
export const DATABASE_VERSION=7;
export const V2_FEATURE_FLAG='architecture.indexeddb.v2';

const stores=[
  {name:'projects',legacy:true,indexes:[['updatedAt','updatedAt']]},
  {name:'projectRecords',keyPath:'projectId',indexes:[
    ['updatedAt','updatedAt'],['name','name'],['schemaVersion','schemaVersion']
  ]},
  {name:'journalEvents',keyPath:'eventId',indexes:[
    ['projectId','projectId'],['timestamp','timestamp'],['eventType','eventType'],['createdAt','createdAt'],
    ['projectTimestamp',['projectId','timestamp']],
    ['projectTypeTimestamp',['projectId','eventType','timestamp']],
    ['projectCreatedAt',['projectId','createdAt']]
  ]},
  {name:'searchDocuments',keyPath:['projectId','sourceType','sourceId'],indexes:[
    ['projectId','projectId'],['sourceType','sourceType'],
    ['terms','terms',{multiEntry:true}],['scopedTerms','scopedTerms',{multiEntry:true}],
    ['sourceUpdatedAt','sourceUpdatedAt']
  ]},
  {name:'searchIndexState',keyPath:'projectId',indexes:[
    ['status','status'],['builtAt','builtAt'],['indexVersion','indexVersion']
  ]},
  {name:'projectLifecycleState',keyPath:'key',indexes:[
    ['projectId','projectId'],['updatedAt','updatedAt'],['stage','stage']
  ]},
  {name:'observations',keyPath:['eventId','observationId'],indexes:[
    ['riderTime',['eventId','riderId','occurredAt']],
    ['checkpointTime',['eventId','checkpointId','occurredAt']],
    ['syncState',['syncState','nextAttemptAt']],
    ['sessionSequence',['deviceSessionId','sequence']]
  ]},
  {name:'observationOutbox',keyPath:'idempotencyKey',indexes:[
    ['nextAttemptAt','nextAttemptAt'],['eventId','eventId'],['state','state']
  ]},
  {name:'commitmentInferences',keyPath:['eventId','inferenceId'],indexes:[
    ['competitorCheckpointTime',['competitorId','checkpointId','createdAt']],['active','active']
  ]},
  {name:'routeFamilies',keyPath:['eventId','familyId','revision'],indexes:[
    ['checkpointPair',['fromCheckpointId','toCheckpointId']],['lifecycle','lifecycle'],['current','current']
  ]},
  {name:'routeVariants',keyPath:['eventId','variantId','revision'],indexes:[
    ['familyId','familyId'],['checkpointPair',['fromCheckpointId','toCheckpointId']],['lifecycle','lifecycle']
  ]},
  {name:'confidenceVectors',keyPath:['eventId','subjectType','subjectId','revision'],indexes:[['updatedAt','updatedAt']]},
  {name:'intelligenceItems',keyPath:['eventId','intelligenceId'],indexes:[
    ['stage','stage'],['audience','audience'],['surfaceAfter','surfaceAfter']
  ]},
  {name:'recommendations',keyPath:['eventId','recommendationId'],indexes:[
    ['status','status'],['createdAt','createdAt']
  ]},
  {name:'recommendationEvaluations',keyPath:['eventId','recommendationId','revision'],indexes:[
    ['evaluatedAt','evaluatedAt'],['modelVersion','modelVersion']
  ]},
  {name:'intelligenceNetwork',keyPath:['uid','memberId'],indexes:[['updatedAt','updatedAt']]},
  {name:'syncMeta',keyPath:'key'},
  {name:'telemetrySamples',keyPath:['sessionId','sampleId'],indexes:[
    ['sessionTime',['sessionId','occurredAt']],['eventDay',['rallyEventId','occurredAt']],['projectId','projectId']
  ]},
  {name:'telemetryEvents',keyPath:['sessionId','telemetryEventId'],indexes:[
    ['sessionTime',['sessionId','occurredAt']],['eventType',['rallyEventId','type','occurredAt']],['projectId','projectId']
  ]},
  {name:'analyticsSessions',keyPath:['rallyEventId','sessionId'],indexes:[
    ['eventStatus',['rallyEventId','status']],['updatedAt','updatedAt'],['projectId','projectId']
  ]},
  {name:'analyticsDailyStats',keyPath:['sessionId','dayKey'],indexes:[
    ['eventDay',['rallyEventId','dayKey']],['updatedAt','updatedAt'],['projectId','projectId']
  ]}
];

export const SCHEMA_REGISTRY=Object.freeze(stores.map(store=>Object.freeze({
  ...store,
  keyPath:Array.isArray(store.keyPath)?Object.freeze([...store.keyPath]):store.keyPath,
  indexes:Object.freeze((store.indexes||[]).map(index=>Object.freeze([
    index[0],Array.isArray(index[1])?Object.freeze([...index[1]]):index[1],
    Object.freeze({...index[2]})
  ])))
})));

function addIndexes(store,definition){
  for(const [name,keyPath,options] of definition.indexes){
    if(!store.indexNames.contains(name))store.createIndex(name,keyPath,options);
  }
}

export function applySchemaUpgrade(database,transaction){
  for(const definition of SCHEMA_REGISTRY){
    if(!database.objectStoreNames.contains(definition.name)){
      const options=definition.legacy?undefined:{keyPath:definition.keyPath};
      addIndexes(database.createObjectStore(definition.name,options),definition);
    }else{
      addIndexes(transaction.objectStore(definition.name),definition);
    }
  }
  migrateLegacyCurrentProject(database,transaction);
}

function migrateLegacyCurrentProject(database,transaction){
  if(!database.objectStoreNames.contains('projects')||!database.objectStoreNames.contains('projectRecords'))return;
  const legacyStore=transaction.objectStore('projects');
  const projectStore=transaction.objectStore('projectRecords');
  const request=legacyStore.get('current');
  request.onsuccess=()=>{
    if(!request.result)return;
    const record=normalizeProject(request.result);
    const existing=projectStore.get(record.projectId);
    existing.onsuccess=()=>{if(!existing.result)projectStore.add(record);};
  };
}

export function readV2FeatureFlag(featureFlags){
  if(!featureFlags||typeof featureFlags.isEnabled!=='function')return false;
  return featureFlags.isEnabled(V2_FEATURE_FLAG)===true;
}

export function openIndexedDbV2({indexedDB,featureFlags,databaseName=DATABASE_NAME}={}){
  if(!readV2FeatureFlag(featureFlags))return Promise.resolve(null);
  if(!indexedDB||typeof indexedDB.open!=='function')return Promise.reject(new Error('IndexedDB is unavailable.'));
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(databaseName,DATABASE_VERSION);
    request.onupgradeneeded=()=>applySchemaUpgrade(request.result,request.transaction);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error('IndexedDB v2 could not be opened.'));
    request.onblocked=()=>reject(new Error('IndexedDB v2 upgrade is blocked by another connection.'));
  });
}
