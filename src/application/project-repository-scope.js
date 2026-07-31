const assertProject=(projectId,value)=>{
  if(value?.projectId!==undefined&&String(value.projectId)!==projectId){
    throw new TypeError(`Repository scope ${projectId} cannot write project ${value.projectId}.`);
  }
};
const withProject=(projectId,value)=>value?{...value,projectId}:value;

/**
 * Creates separate consumer and lifecycle capabilities for one Project. The
 * manager exposes only `repositories`; transition controls remain private to
 * composition code through `lifecycle`.
 */
export function createProjectRepositoryScope({
  projectId,journalRepository,analyticsRepository,searchRepository,hooks={}
}={}){
  const id=String(projectId||'').trim();
  if(!id)throw new TypeError('projectId is required.');
  let state='opening';
  const consumer=()=>{
    if(state!=='open')throw new Error(`Project repository scope is ${state}: ${id}`);
  };
  const controlled=()=>{
    if(!['opening','draining'].includes(state))throw new Error(`Project repository scope is ${state}: ${id}`);
  };
  const draining=()=>{
    if(state!=='draining')throw new Error(`Project repository scope is ${state}: ${id}`);
  };
  const buildJournal=guard=>journalRepository&&Object.freeze({
    appendEvent(event){guard();assertProject(id,event);return journalRepository.appendEvent(withProject(id,event));},
    appendEvents(events){guard();for(const event of events)assertProject(id,event);return journalRepository.appendEvents(events.map(event=>withProject(id,event)));},
    async getEvent(eventId){
      guard();const event=await journalRepository.getEvent(eventId);
      return event?.projectId===id?event:null;
    },
    getEvents:()=>{guard();return journalRepository.getEventsByProject(id);},
    query:query=>{guard();return journalRepository.queryEvents({...query,projectId:id});}
  });
  const buildSearch=guard=>searchRepository&&Object.freeze({
    replace(index){guard();assertProject(id,index);return searchRepository.replaceProjectIndex({...index,projectId:id});},
    find(terms){guard();return searchRepository.findCandidates({terms,projectId:id,allProjects:false});},
    getState(){guard();return searchRepository.getIndexState(id);},
    delete(){guard();return searchRepository.deleteProjectIndex(id);}
  });
  const buildAnalytics=guard=>{
    if(!analyticsRepository)return undefined;
    const write=records=>{
      guard();const scoped={...records};
      for(const key of ['sample','session','daily','event'])if(scoped[key])scoped[key]=withProject(id,scoped[key]);
      if(scoped.events)scoped.events=scoped.events.map(event=>withProject(id,event));
      return analyticsRepository.appendSampleAndStats(scoped);
    };
    return Object.freeze({
      appendSampleAndStats:write,appendEventAndStats:write,saveStats:write,
      async findActiveSession(rallyEventId){
        guard();const value=await analyticsRepository.findActiveSession(rallyEventId,id);
        return value?.projectId===id?value:null;
      },
      async getDaily(sessionId,dayKey){
        guard();const value=await analyticsRepository.getDaily(sessionId,dayKey);
        return value?.projectId===id?value:null;
      },
      async getSession(sessionId,rallyEventId){
        guard();const value=await analyticsRepository.getSession(sessionId,rallyEventId);
        return value?.projectId===id?value:null;
      },
      async listSamples(sessionId){
        guard();return (await analyticsRepository.listSamples(sessionId)).filter(value=>value.projectId===id);
      }
    });
  };
  const repositories=Object.freeze({
    projectId:id,journal:buildJournal(consumer),analytics:buildAnalytics(consumer),search:buildSearch(consumer),
    getState:()=>state,isClosed:()=>state==='closed'
  });
  const internal=Object.freeze({
    journal:buildJournal(controlled),analytics:buildAnalytics(controlled),search:buildSearch(controlled)
  });
  const lifecycle=Object.freeze({
    async rebuildCaches(){
      if(state!=='opening')throw new Error(`Project repository scope cannot rebuild from ${state}: ${id}`);
      await hooks.rebuildCaches?.(internal);
    },
    activate(){
      if(state!=='opening')throw new Error(`Project repository scope cannot activate from ${state}: ${id}`);
      state='open';
    },
    beginDrain(){
      if(state!=='open')throw new Error(`Project repository scope cannot drain from ${state}: ${id}`);
      state='draining';
    },
    async flushPendingWrites(){draining();await hooks.flushPendingWrites?.();},
    async commitJournal(){draining();await hooks.commitJournal?.(internal.journal);},
    async commitAnalytics(){draining();await hooks.commitAnalytics?.(internal.analytics);},
    async commitSearch(){draining();await hooks.commitSearch?.(internal.search);},
    restoreAfterFailedDrain(){
      if(state!=='draining')throw new Error(`Project repository scope cannot restore from ${state}: ${id}`);
      state='open';
    },
    async close(){
      if(state==='closed')return;
      if(!['opening','draining'].includes(state))throw new Error(`Project repository scope cannot close from ${state}: ${id}`);
      try{await hooks.close?.(internal);}finally{state='closed';}
    },
    getState:()=>state
  });
  return Object.freeze({repositories,lifecycle});
}
