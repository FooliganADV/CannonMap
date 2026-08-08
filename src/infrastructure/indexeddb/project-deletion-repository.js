import {requestResult,transactionDone} from './request.js';

const PROJECT_STORES=Object.freeze([
  'journalEvents','telemetrySamples','telemetryEvents','analyticsSessions',
  'analyticsDailyStats','searchDocuments','mediaRecords'
]);
export const PROJECT_DELETION_BOUNDARIES=Object.freeze([
  ...PROJECT_STORES,'searchIndexState','legacyCurrent','activeProject','projectRecord'
]);

/**
 * Deletes every Project-owned record in one IndexedDB transaction. The
 * optional boundary callback is a synchronous failure-injection seam used by
 * persistence tests; throwing aborts the complete transaction.
 */
export function createProjectDeletionRepository({database,onBoundary}={}){
  if(!database)throw new TypeError('database is required.');
  if(onBoundary!==undefined&&typeof onBoundary!=='function')throw new TypeError('onBoundary must be a function.');
  const stores=[
    'projectRecords','projects','projectLifecycleState','searchIndexState',...PROJECT_STORES
  ];
  const hit=name=>onBoundary?.(name);
  return Object.freeze({
    async deleteProject(projectId){
      const id=String(projectId),transaction=database.transaction(stores,'readwrite');
      const done=transactionDone(transaction);
      try{
        const projectStore=transaction.objectStore('projectRecords');
        const existing=await requestResult(projectStore.get(id));
        if(!existing){await done;return false;}

        const lifecycle=transaction.objectStore('projectLifecycleState');
        const transition=await requestResult(lifecycle.get('activeProjectTransition'));
        if(transition)throw new Error('Project deletion cannot run during an active transition.');

        for(const storeName of PROJECT_STORES){
          hit(storeName);
          const store=transaction.objectStore(storeName);
          const keys=await requestResult(store.index('projectId').getAllKeys(id));
          for(const key of keys)store.delete(key);
        }

        hit('searchIndexState');
        transaction.objectStore('searchIndexState').delete(id);

        hit('legacyCurrent');
        const legacyStore=transaction.objectStore('projects');
        const legacy=await requestResult(legacyStore.get('current'));
        if(String(legacy?.projectId||legacy?.id||'')===id)legacyStore.delete('current');

        hit('activeProject');
        const active=await requestResult(lifecycle.get('activeProject'));
        if(active?.projectId===id)lifecycle.delete('activeProject');

        hit('projectRecord');
        projectStore.delete(id);
        await done;
        return true;
      }catch(error){
        try{transaction.abort();}catch(_){ }
        try{await done;}catch(_){ }
        throw error;
      }
    }
  });
}
