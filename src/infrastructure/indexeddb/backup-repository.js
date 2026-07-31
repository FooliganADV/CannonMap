import {DuplicateBackupProjectError,BackupImportError} from '../../domain/backup/errors.js';
import {canonicalJson} from '../../domain/backup/archive.js';
import {normalizeProject} from '../../domain/projects/model.js';
import {requestResult,transactionDone} from './request.js';

const OWNED_STORES=Object.freeze([
  'journalEvents','telemetrySamples','telemetryEvents','analyticsSessions','analyticsDailyStats'
]);
const TRANSACTION_STORES=Object.freeze([
  'projectRecords','projectLifecycleState','searchDocuments','searchIndexState',...OWNED_STORES
]);
export const BACKUP_IMPORT_BOUNDARIES=Object.freeze([
  'projectRecord','journalEvents','telemetrySamples','telemetryEvents',
  'analyticsSessions','analyticsDailyStats','searchRebuildMetadata'
]);

const clone=value=>structuredClone(value);
const byCanonical=(left,right)=>canonicalJson(left).localeCompare(canonicalJson(right));
const sort=values=>values.map(clone).sort(byCanonical);

function assertImportDisposition(existing,mode,projectId){
  if(existing&&mode!=='replace')throw new DuplicateBackupProjectError(projectId);
  if(!existing&&mode==='replace')throw new BackupImportError(`Project not found for replacement: ${projectId}`,{
    code:'BACKUP_REPLACE_PROJECT_NOT_FOUND',details:{projectId}
  });
}

function assertInactiveReplacement(active,existing,mode,projectId){
  if(existing&&mode==='replace'&&active?.projectId===projectId){
    throw new BackupImportError('The active Project must be closed before replacement.',{
      code:'BACKUP_ACTIVE_PROJECT_REPLACE_FORBIDDEN',details:{projectId}
    });
  }
}

function splitFeatures(features=[]){
  const collections={routes:[],tracks:[],waypoints:[],checkpoints:[],additionalFeatures:[]};
  const featureOrder=[];
  for(const feature of features){
    let collection='additionalFeatures';
    if(feature?.type==='route')collection='routes';
    else if(feature?.type==='track'||feature?.type==='backbone')collection='tracks';
    else if(feature?.type==='waypoint')collection='waypoints';
    else if(feature?.type==='checkpoint'||feature?.type==='hotel')collection='checkpoints';
    featureOrder.push({collection,index:collections[collection].length});
    collections[collection].push(feature);
  }
  return {...collections,featureOrder};
}

function projectMetadata(project){
  const metadata=clone(project);
  for(const key of [
    'features','journal','analytics','settings','offlineMapConfiguration','photos','videos','templateReference'
  ])delete metadata[key];
  return metadata;
}

function restoreProject(archive){
  const {data}=archive;
  const fallback=[...data.routes,...data.tracks,...data.waypoints,...data.checkpoints,...data.additionalFeatures];
  const features=data.featureOrder.map(reference=>data[reference.collection]?.[reference.index]).filter(Boolean);
  return normalizeProject({
    ...clone(data.project),
    id:archive.manifest.projectId,projectId:archive.manifest.projectId,
    name:archive.manifest.projectName,
    lifecycleStatus:data.lifecycle.status||'active',
    archivedAt:data.lifecycle.archivedAt||null,
    features:clone(features.length===data.featureOrder.length?features:fallback),
    journal:clone(data.journal.embedded),analytics:clone(data.analytics.embedded),
    settings:clone(data.settings),offlineMapConfiguration:clone(data.offlineMapMetadata),
    photos:clone(data.mediaReferences.photos),videos:clone(data.mediaReferences.videos),
    templateReference:clone(data.templateReference)
  });
}

async function recordsForProject(transaction,storeName,projectId){
  const store=transaction.objectStore(storeName);
  return requestResult(store.index('projectId').getAll(projectId));
}

async function deleteProjectRecords(transaction,storeName,projectId){
  const store=transaction.objectStore(storeName);
  const keys=await requestResult(store.index('projectId').getAllKeys(projectId));
  for(const key of keys)store.delete(key);
}

/**
 * Backup's infrastructure port. Cross-store reads and imports live here
 * because repository-by-repository calls cannot provide one IndexedDB
 * snapshot or one all-or-nothing restore transaction.
 */
export function createBackupRepository({database,onImportBoundary}={}){
  if(!database)throw new TypeError('database is required.');
  if(onImportBoundary!==undefined&&typeof onImportBoundary!=='function'){
    throw new TypeError('onImportBoundary must be a function.');
  }
  const hit=boundary=>onImportBoundary?.(boundary);
  return Object.freeze({
    async inspectProjectImport(projectId,{mode='create'}={}){
      const id=String(projectId),transaction=database.transaction(
        ['projectRecords','projectLifecycleState'],'readonly'
      );
      const done=transactionDone(transaction);
      const existing=await requestResult(transaction.objectStore('projectRecords').get(id));
      const active=await requestResult(transaction.objectStore('projectLifecycleState').get('activeProject'));
      await done;assertImportDisposition(existing,mode,id);assertInactiveReplacement(active,existing,mode,id);
      return Object.freeze({projectId:id,mode,replaced:Boolean(existing)});
    },
    async readProjectSnapshot(projectId){
      const id=String(projectId),transaction=database.transaction(TRANSACTION_STORES,'readonly');
      const done=transactionDone(transaction);
      const project=await requestResult(transaction.objectStore('projectRecords').get(id));
      if(!project){await done;throw new BackupImportError(`Project not found: ${id}`,{code:'BACKUP_PROJECT_NOT_FOUND'});}
      const active=await requestResult(transaction.objectStore('projectLifecycleState').get('activeProject'));
      const journal=await recordsForProject(transaction,'journalEvents',id);
      const telemetrySamples=await recordsForProject(transaction,'telemetrySamples',id);
      const telemetryEvents=await recordsForProject(transaction,'telemetryEvents',id);
      const sessions=await recordsForProject(transaction,'analyticsSessions',id);
      const dailyStats=await recordsForProject(transaction,'analyticsDailyStats',id);
      const searchState=await requestResult(transaction.objectStore('searchIndexState').get(id));
      await done;
      const features=splitFeatures(project.features);
      return {
        project:clone(project),
        data:{
          project:projectMetadata(project),
          lifecycle:{
            status:project.lifecycleStatus||'active',archivedAt:project.archivedAt||null,
            wasActive:active?.projectId===id
          },
          routes:sort(features.routes),tracks:sort(features.tracks),
          waypoints:sort(features.waypoints),checkpoints:sort(features.checkpoints),
          additionalFeatures:sort(features.additionalFeatures),
          featureOrder:features.featureOrder.map(reference=>{
            const original=features[reference.collection][reference.index];
            const sorted=sort(features[reference.collection]);
            return {collection:reference.collection,index:sorted.findIndex(value=>canonicalJson(value)===canonicalJson(original))};
          }),
          journal:{embedded:clone(project.journal||[]),events:sort(journal)},
          analytics:{
            embedded:clone(project.analytics||{}),telemetrySamples:sort(telemetrySamples),
            telemetryEvents:sort(telemetryEvents),sessions:sort(sessions),dailyStats:sort(dailyStats)
          },
          settings:clone(project.settings||{}),
          templateReference:clone(project.templateReference??null),
          offlineMapMetadata:clone(project.offlineMapConfiguration||{}),
          searchRebuildMetadata:{
            required:true,indexVersion:searchState?.indexVersion??null,
            sourceRevision:searchState?.revision??null,lastBuiltAt:searchState?.builtAt??null
          },
          mediaReferences:{photos:clone(project.photos||[]),videos:clone(project.videos||[])}
        }
      };
    },

    async importProjectArchive(archive,{mode='create',importedAt}={}){
      const id=String(archive.manifest.projectId),project=restoreProject(archive);
      const transaction=database.transaction(TRANSACTION_STORES,'readwrite'),done=transactionDone(transaction);
      try{
        const projectStore=transaction.objectStore('projectRecords');
        const existing=await requestResult(projectStore.get(id));
        assertImportDisposition(existing,mode,id);
        const lifecycle=transaction.objectStore('projectLifecycleState');
        const active=await requestResult(lifecycle.get('activeProject'));
        assertInactiveReplacement(active,existing,mode,id);

        if(existing){
          for(const storeName of OWNED_STORES)await deleteProjectRecords(transaction,storeName,id);
          await deleteProjectRecords(transaction,'searchDocuments',id);
          transaction.objectStore('searchIndexState').delete(id);
        }

        hit('projectRecord');
        if(existing)projectStore.put(project);else projectStore.add(project);
        const writes=[
          ['journalEvents',archive.data.journal.events],
          ['telemetrySamples',archive.data.analytics.telemetrySamples],
          ['telemetryEvents',archive.data.analytics.telemetryEvents],
          ['analyticsSessions',archive.data.analytics.sessions],
          ['analyticsDailyStats',archive.data.analytics.dailyStats]
        ];
        for(const [storeName,records] of writes){
          hit(storeName);const store=transaction.objectStore(storeName);
          for(const record of records)store.add(clone(record));
        }
        hit('searchRebuildMetadata');
        transaction.objectStore('searchIndexState').put({
          projectId:id,status:'stale',indexVersion:archive.data.searchRebuildMetadata.indexVersion,
          revision:archive.data.searchRebuildMetadata.sourceRevision,
          importedAt:String(importedAt),rebuildRequired:true,documentCount:0,builtAt:null
        });
        await done;
        return Object.freeze({projectId:id,mode,replaced:Boolean(existing),searchRebuildRequired:true});
      }catch(error){
        try{transaction.abort();}catch(_){ }
        try{await done;}catch(_){ }
        throw error;
      }
    }
  });
}
