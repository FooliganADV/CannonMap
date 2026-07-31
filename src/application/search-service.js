import {
  buildProjectSearchIndex,compareSearchResults,partialTerms,rankSearchDocument,
  SEARCH_INDEX_SCHEMA_VERSION,tokenizeSearchText
} from '../domain/search/index.js';

/**
 * Backend-only Search API. Source loading remains outside this service; results
 * identify source records and carry only compact display/ranking projections.
 */
export function createSearchService({repository,clock}={}){
  if(!repository||!clock)throw new TypeError('repository and clock are required.');
  return Object.freeze({
    async rebuildProject({project,journalEvents=[]}={}){
      const index=buildProjectSearchIndex({project,journalEvents});
      return repository.replaceProjectIndex({...index,builtAt:clock.iso()});
    },
    async ensureProjectIndex({project,journalEvents=[]}={}){
      const index=buildProjectSearchIndex({project,journalEvents});
      const state=await repository.getIndexState(index.projectId);
      if(state?.status==='ready'&&state.revision===index.revision&&
        state.indexVersion===SEARCH_INDEX_SCHEMA_VERSION){
        return {...state,reused:true};
      }
      return {...await repository.replaceProjectIndex({...index,builtAt:clock.iso()}),reused:false};
    },
    async search(query,{projectId,allProjects=false,limit=20}={}){
      const tokens=tokenizeSearchText(query);
      if(!tokens.length)return [];
      if(!allProjects&&!projectId)throw new TypeError('projectId is required unless allProjects is true.');
      const candidates=await repository.findCandidates({
        terms:[...new Set(tokens.flatMap(token=>partialTerms(token)))],
        projectId:String(projectId||''),allProjects
      });
      return candidates.map(document=>rankSearchDocument(document,query)).filter(Boolean)
        .sort(compareSearchResults).slice(0,Math.max(0,Number(limit)||0));
    },
    getIndexState:projectId=>repository.getIndexState(projectId),
    listIndexStates:()=>repository.listIndexStates(),
    deleteProjectIndex:projectId=>repository.deleteProjectIndex(projectId)
  });
}
