const assertProject=(projectId,value)=>{
  if(value?.projectId!==undefined&&String(value.projectId)!==projectId){
    throw new TypeError(`Repository scope ${projectId} cannot write project ${value.projectId}.`);
  }
};
const withProject=(projectId,value)=>value?{...value,projectId}:value;

/**
 * Converts compatibility repositories into a project-bound handle. Closing the
 * scope invalidates every method so stale consumers fail instead of writing to
 * the newly active Project.
 */
export function createProjectRepositoryScope({
  projectId,journalRepository,analyticsRepository,searchRepository,hooks={}
}={}){
  const id=String(projectId||'').trim();
  if(!id)throw new TypeError('projectId is required.');
  let closed=false;
  const open=()=>{if(closed)throw new Error(`Project repository scope is closed: ${id}`);};
  const journal=journalRepository&&Object.freeze({
    appendEvent(event){open();assertProject(id,event);return journalRepository.appendEvent(withProject(id,event));},
    appendEvents(events){open();for(const event of events)assertProject(id,event);return journalRepository.appendEvents(events.map(event=>withProject(id,event)));},
    async getEvent(eventId){
      open();
      const event=await journalRepository.getEvent(eventId);
      return event?.projectId===id?event:null;
    },
    getEvents:()=>{open();return journalRepository.getEventsByProject(id);},
    query:query=>{open();return journalRepository.queryEvents({...query,projectId:id});}
  });
  const search=searchRepository&&Object.freeze({
    replace(index){open();assertProject(id,index);return searchRepository.replaceProjectIndex({...index,projectId:id});},
    find(terms){open();return searchRepository.findCandidates({terms,projectId:id,allProjects:false});},
    getState(){open();return searchRepository.getIndexState(id);},
    delete(){open();return searchRepository.deleteProjectIndex(id);}
  });
  const writeAnalytics=records=>{
    open();
    const scoped={...records};
    for(const key of ['sample','session','daily','event'])if(scoped[key])scoped[key]=withProject(id,scoped[key]);
    if(scoped.events)scoped.events=scoped.events.map(event=>withProject(id,event));
    return analyticsRepository.appendSampleAndStats(scoped);
  };
  const analytics=analyticsRepository&&Object.freeze({
    appendSampleAndStats:writeAnalytics,
    appendEventAndStats:writeAnalytics,
    saveStats:writeAnalytics,
    async findActiveSession(rallyEventId){
      open();const value=await analyticsRepository.findActiveSession(rallyEventId,id);
      return value?.projectId===id?value:null;
    },
    async getDaily(sessionId,dayKey){
      open();const value=await analyticsRepository.getDaily(sessionId,dayKey);
      return value?.projectId===id?value:null;
    },
    async getSession(sessionId,rallyEventId){
      open();const value=await analyticsRepository.getSession(sessionId,rallyEventId);
      return value?.projectId===id?value:null;
    },
    async listSamples(sessionId){
      open();return (await analyticsRepository.listSamples(sessionId)).filter(value=>value.projectId===id);
    }
  });
  return Object.freeze({
    projectId:id,journal,analytics,search,
    async flushPendingWrites(){open();await hooks.flushPendingWrites?.();},
    async commitJournal(){open();await hooks.commitJournal?.(journal);},
    async commitAnalytics(){open();await hooks.commitAnalytics?.(analytics);},
    async commitSearch(){open();await hooks.commitSearch?.(search);},
    async rebuildCaches(){open();await hooks.rebuildCaches?.({journal,analytics,search});},
    async destroy(){
      open();
      if(hooks.destroy)await hooks.destroy({journal,analytics,search});
      else await Promise.all([
        journalRepository?.deleteProjectJournal?.(id),
        analyticsRepository?.deleteProjectAnalytics?.(id),
        searchRepository?.deleteProjectIndex?.(id)
      ]);
    },
    async close(){
      if(closed)return;
      await hooks.close?.({journal,analytics,search});
      closed=true;
    },
    isClosed:()=>closed
  });
}
