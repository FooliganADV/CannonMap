import {requestResult,transactionDone} from './request.js';

const DOCUMENTS='searchDocuments';
const STATE='searchIndexState';
const clone=value=>structuredClone(value);

/**
 * Search stores only compact projections and source references. Project
 * rebuilds delete stale projections and insert the replacement set in one
 * transaction, so interruption restores the previous usable index.
 */
export function createSearchRepository({database,keyRange=globalThis.IDBKeyRange}={}){
  if(!database)throw new TypeError('database is required.');
  if(!keyRange)throw new TypeError('IDBKeyRange is required.');
  const read=async(storeName,operation)=>{
    const transaction=database.transaction(storeName,'readonly'),done=transactionDone(transaction);
    const value=await requestResult(operation(transaction.objectStore(storeName)));
    await done;
    return value;
  };
  return Object.freeze({
    async replaceProjectIndex({projectId,revision,indexVersion,documents,builtAt}){
      const transaction=database.transaction([DOCUMENTS,STATE],'readwrite');
      const done=transactionDone(transaction);
      const documentStore=transaction.objectStore(DOCUMENTS);
      const keys=await requestResult(documentStore.index('projectId').getAllKeys(String(projectId)));
      for(const key of keys)documentStore.delete(key);
      for(const document of documents)documentStore.add(clone(document));
      transaction.objectStore(STATE).put({
        projectId:String(projectId),revision,indexVersion,status:'ready',
        documentCount:documents.length,builtAt:new Date(builtAt).toISOString()
      });
      await done;
      return {projectId:String(projectId),revision,documentCount:documents.length};
    },
    async findCandidates({terms,projectId,allProjects=false}={}){
      if(!Array.isArray(terms)||!terms.length)return [];
      if(!allProjects&&!projectId)throw new TypeError('projectId is required unless allProjects is true.');
      const transaction=database.transaction(DOCUMENTS,'readonly'),done=transactionDone(transaction);
      const store=transaction.objectStore(DOCUMENTS);
      const index=store.index(allProjects?'terms':'scopedTerms');
      const keys=terms.map(term=>allProjects?term:`${projectId}\u0000${term}`);
      const groups=await Promise.all(keys.map(key=>requestResult(index.getAll(key))));
      await done;
      const membership=groups.map(group=>new Map(group.map(document=>[
        `${document.projectId}\u0000${document.sourceType}\u0000${document.sourceId}`,document
      ])));
      const [first,...rest]=membership;
      return [...first].filter(([key])=>rest.every(group=>group.has(key))).map(([,document])=>document);
    },
    async getIndexState(projectId){
      return (await read(STATE,store=>store.get(String(projectId))))||null;
    },
    async listIndexStates(){
      return read(STATE,store=>store.getAll());
    },
    async deleteProjectIndex(projectId){
      const transaction=database.transaction([DOCUMENTS,STATE],'readwrite'),done=transactionDone(transaction);
      const documents=transaction.objectStore(DOCUMENTS);
      const keys=await requestResult(documents.index('projectId').getAllKeys(String(projectId)));
      for(const key of keys)documents.delete(key);
      transaction.objectStore(STATE).delete(String(projectId));
      await done;
      return keys.length;
    }
  });
}
