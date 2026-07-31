import {createProjectLifecycleEvent,projectIdentity} from '../domain/projects/lifecycle.js';

const clone=value=>value?structuredClone(value):value;

/**
 * Authoritative application-facing Project lifecycle. Operations are queued to
 * make rapid switches deterministic. Durable transition stages support crash
 * recovery while `projects/current` remains a compatibility mirror.
 */
export function createProjectLifecycleManager({
  projectRepository,lifecycleRepository,legacyCurrentRepository,scopeFactory,
  eventBus,clock,createId
}={}){
  if(!projectRepository||!lifecycleRepository||!legacyCurrentRepository||
    typeof scopeFactory!=='function'||!eventBus||!clock||typeof createId!=='function'){
    throw new TypeError('Project lifecycle dependencies are required.');
  }
  let activeProject=null,activeScope=null,initialized=false,queue=Promise.resolve();
  const enqueue=operation=>{
    const result=queue.then(operation);
    queue=result.catch(()=>{});
    return result;
  };
  const publish=(type,projectId,previousProjectId,payload)=>
    eventBus.publish(createProjectLifecycleEvent({type,projectId,previousProjectId,payload,clock,createId}));
  const projectById=async projectId=>{
    const project=await projectRepository.get(String(projectId));
    if(!project)throw new Error(`Project not found: ${projectId}`);
    if(project.lifecycleStatus==='archived')throw new Error(`Project is archived: ${projectId}`);
    return project;
  };
  const openScope=async project=>{
    const scope=await scopeFactory(project.projectId);
    await scope.rebuildCaches?.();
    return scope;
  };
  const recoverTransition=async transition=>{
    const legacy=await legacyCurrentRepository.get();
    const legacyId=legacy?projectIdentity(legacy):null;
    const finishTarget=transition.stage==='legacyCommitted'||
      (transition.stage==='committingLegacy'&&legacyId===transition.toProjectId);
    const recoveredId=finishTarget?transition.toProjectId:transition.fromProjectId;
    if(recoveredId){
      const project=await projectRepository.get(recoveredId);
      if(project){
        if(!finishTarget&&legacyId!==recoveredId)await legacyCurrentRepository.save(project);
        await lifecycleRepository.completeTransition(recoveredId,clock.iso());
        return recoveredId;
      }
    }
    await lifecycleRepository.completeTransition(null,clock.iso());
    return null;
  };
  const initializeInternal=async()=>{
    if(initialized)return activeProject;
    let activeId;
    const transition=await lifecycleRepository.getTransition();
    if(transition)activeId=await recoverTransition(transition);
    else activeId=await lifecycleRepository.getActiveProjectId();
    if(!activeId){
      const legacy=await legacyCurrentRepository.get();
      if(legacy){
        const saved=await projectRepository.save(legacy);
        activeId=saved.projectId;
        await lifecycleRepository.completeTransition(activeId,clock.iso());
      }
    }
    if(activeId){
      activeProject=await projectRepository.get(activeId);
      if(activeProject)activeScope=await openScope(activeProject);
    }
    initialized=true;
    return activeProject;
  };
  const closeActive=async()=>{
    if(!activeProject)return null;
    const previous=activeProject,scope=activeScope;
    await scope?.flushPendingWrites?.();
    await scope?.commitJournal?.();
    await scope?.commitAnalytics?.();
    await scope?.commitSearch?.();
    await scope?.close?.();
    activeProject=null;activeScope=null;
    publish('projectClosed',null,previous.projectId);
    return previous;
  };
  const switchInternal=async projectId=>{
    await initializeInternal();
    const target=await projectById(projectId);
    if(activeProject?.projectId===target.projectId)return activeProject;
    const previous=activeProject,transition={
      transitionId:createId(),fromProjectId:previous?.projectId||null,
      toProjectId:target.projectId,stage:'flushing',startedAt:clock.iso(),updatedAt:clock.iso()
    };
    await lifecycleRepository.beginTransition(transition);
    let nextScope=null;
    try{
      await closeActive();
      transition.stage='opening';transition.updatedAt=clock.iso();
      await lifecycleRepository.updateTransition(transition);
      nextScope=await openScope(target);
      transition.stage='committingLegacy';transition.updatedAt=clock.iso();
      await lifecycleRepository.updateTransition(transition);
      await legacyCurrentRepository.save(target);
      transition.stage='legacyCommitted';transition.updatedAt=clock.iso();
      await lifecycleRepository.updateTransition(transition);
      await lifecycleRepository.completeTransition(target.projectId,clock.iso());
      activeProject=target;activeScope=nextScope;
      publish('projectOpened',target.projectId,previous?.projectId||null);
      publish('activeProjectChanged',target.projectId,previous?.projectId||null);
      return activeProject;
    }catch(error){
      await nextScope?.close?.().catch(()=>{});
      if(activeProject)await lifecycleRepository.clearTransition();
      else initialized=false;
      throw error;
    }
  };

  return Object.freeze({
    initialize:()=>enqueue(initializeInternal),
    getActiveProject:()=>clone(activeProject),
    getActiveRepositories:()=>activeScope,
    listProjects:()=>projectRepository.list(),
    openProject:projectId=>enqueue(()=>switchInternal(projectId)),
    setActiveProject:projectId=>enqueue(()=>switchInternal(projectId)),
    closeProject:()=>enqueue(async()=>{
      await initializeInternal();
      const previous=await closeActive();
      await lifecycleRepository.completeTransition(null,clock.iso());
      await legacyCurrentRepository.clear();
      if(previous)publish('activeProjectChanged',null,previous.projectId);
      return previous;
    }),
    createProject:(input,{activate=false}={})=>enqueue(async()=>{
      await initializeInternal();
      const project=await projectRepository.save({...input,lifecycleStatus:'active',archivedAt:null});
      publish('projectCreated',project.projectId,null);
      if(activate)await switchInternal(project.projectId);
      return clone(project);
    }),
    renameProject:(projectId,name)=>enqueue(async()=>{
      await initializeInternal();
      const normalizedName=String(name||'').trim();
      if(!normalizedName)throw new TypeError('Project name is required.');
      const project=await projectById(projectId);
      const renamed=await projectRepository.save({...project,name:normalizedName});
      if(activeProject?.projectId===renamed.projectId){
        activeProject=renamed;await legacyCurrentRepository.save(renamed);
      }
      return clone(renamed);
    }),
    archiveProject:projectId=>enqueue(async()=>{
      await initializeInternal();
      if(activeProject?.projectId===String(projectId)){
        const previous=await closeActive();await lifecycleRepository.completeTransition(null,clock.iso());
        await legacyCurrentRepository.clear();
        publish('activeProjectChanged',null,previous.projectId);
      }
      const archived=await projectRepository.archive(projectId,clock.iso());
      publish('projectArchived',archived.projectId,null);
      return clone(archived);
    }),
    deleteProject:projectId=>enqueue(async()=>{
      await initializeInternal();
      const id=String(projectId);
      let scope;
      if(activeProject?.projectId===id){
        const previous=await closeActive();await lifecycleRepository.completeTransition(null,clock.iso());
        await legacyCurrentRepository.clear();
        publish('activeProjectChanged',null,previous.projectId);
        scope=await scopeFactory(id);
      }
      else scope=await scopeFactory(id);
      await scope.destroy?.();await scope.close?.();
      const deleted=await projectRepository.delete(id);
      if(deleted)publish('projectDeleted',id,null);
      return deleted;
    }),
    flush:async()=>{await queue;return {status:'flushed'};}
  });
}
