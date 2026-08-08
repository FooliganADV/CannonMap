import {createProjectLifecycleEvent,projectIdentity} from '../domain/projects/lifecycle.js';

const clone=value=>value?structuredClone(value):value;
const identityOrNull=project=>{
  try{return project?projectIdentity(project):null;}catch(_){return null;}
};
const sameSnapshot=(left,right)=>JSON.stringify(left)===JSON.stringify(right);

/**
 * Authoritative application-facing Project lifecycle. Operations are queued to
 * make rapid switches deterministic. Durable transition stages support crash
 * recovery while `projects/current` remains a compatibility mirror.
 */
export function createProjectLifecycleManager({
  projectRepository,projectDeletionRepository,lifecycleRepository,legacyCurrentRepository,
  scopeFactory,eventBus,clock,createId
}={}){
  if(!projectRepository||!projectDeletionRepository||!lifecycleRepository||!legacyCurrentRepository||
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
  const usable=project=>project&&project.lifecycleStatus!=='archived';
  const projectById=async projectId=>{
    const project=await projectRepository.get(String(projectId));
    if(!project)throw new Error(`Project not found: ${projectId}`);
    if(project.lifecycleStatus==='archived')throw new Error(`Project is archived: ${projectId}`);
    return project;
  };
  const openScope=async project=>{
    const scope=await scopeFactory(project.projectId);
    if(!scope?.repositories||!scope?.lifecycle)throw new TypeError('scopeFactory must return repositories and lifecycle capabilities.');
    try{await scope.lifecycle.rebuildCaches();return scope;}
    catch(error){try{await scope.lifecycle.close();}catch(_){ }throw error;}
  };
  const reconcileNoActive=async()=>{
    await lifecycleRepository.clearActiveProject();
    activeProject=null;activeScope=null;
    return null;
  };
  const recoverTransition=async transition=>{
    const legacy=await legacyCurrentRepository.get(),legacyId=identityOrNull(legacy);
    const finishTarget=transition.stage==='legacyCommitted'||
      (transition.stage==='committingLegacy'&&legacyId===transition.toProjectId);
    const recoveredId=finishTarget?transition.toProjectId:transition.fromProjectId;
    if(recoveredId){
      const project=await projectRepository.get(recoveredId);
      if(usable(project)){
        if(legacyId!==recoveredId)await legacyCurrentRepository.save(project);
        await lifecycleRepository.completeTransition(recoveredId,clock.iso());
        return recoveredId;
      }
    }
    await lifecycleRepository.clearActiveProject();
    return null;
  };
  const initializeInternal=async()=>{
    if(initialized)return activeProject;
    const transition=await lifecycleRepository.getTransition();
    let activeId=transition?await recoverTransition(transition):await lifecycleRepository.getActiveProjectId();
    if(activeId){
      const project=await projectRepository.get(activeId);
      if(!usable(project)){
        await reconcileNoActive();initialized=true;return null;
      }
      const legacy=await legacyCurrentRepository.get();
      if(identityOrNull(legacy)!==project.projectId||!sameSnapshot(legacy,project)){
        await legacyCurrentRepository.save(project);
      }
      activeProject=project;activeScope=await openScope(project);
      activeScope.lifecycle.activate();initialized=true;
      return activeProject;
    }

    const legacy=await legacyCurrentRepository.get();
    if(legacy){
      const legacyId=identityOrNull(legacy);
      if(!legacyId){await reconcileNoActive();initialized=true;return null;}
      const stored=await projectRepository.get(legacyId);
      if(stored?.lifecycleStatus==='archived'){
        await reconcileNoActive();initialized=true;return null;
      }
      const project=stored||await projectRepository.save(legacy);
      await lifecycleRepository.completeTransition(project.projectId,clock.iso());
      activeProject=project;activeScope=await openScope(project);
      activeScope.lifecycle.activate();initialized=true;
      return activeProject;
    }
    initialized=true;return null;
  };
  const drainActive=async()=>{
    if(!activeProject)return null;
    const previous=activeProject,scope=activeScope;
    scope.lifecycle.beginDrain();
    try{
      await scope.lifecycle.flushPendingWrites();
      await scope.lifecycle.commitJournal();
      await scope.lifecycle.commitAnalytics();
      await scope.lifecycle.commitSearch();
    }catch(error){
      scope.lifecycle.restoreAfterFailedDrain();
      throw error;
    }
    try{await scope.lifecycle.close();}
    finally{activeProject=null;activeScope=null;}
    return previous;
  };
  const recoverAfterClosedFailure=async()=>{
    initialized=false;
    try{await initializeInternal();}catch(_){initialized=false;}
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
      await drainActive();
      transition.stage='opening';transition.updatedAt=clock.iso();
      await lifecycleRepository.updateTransition(transition);
      nextScope=await openScope(target);
      transition.stage='committingLegacy';transition.updatedAt=clock.iso();
      await lifecycleRepository.updateTransition(transition);
      await legacyCurrentRepository.save(target);
      transition.stage='legacyCommitted';transition.updatedAt=clock.iso();
      await lifecycleRepository.updateTransition(transition);
      await lifecycleRepository.completeTransition(target.projectId,clock.iso());
      nextScope.lifecycle.activate();activeProject=target;activeScope=nextScope;
      if(previous)publish('projectClosed',null,previous.projectId);
      publish('projectOpened',target.projectId,previous?.projectId||null);
      publish('activeProjectChanged',target.projectId,previous?.projectId||null);
      return activeProject;
    }catch(error){
      if(nextScope)try{await nextScope.lifecycle.close();}catch(_){ }
      if(activeProject)await lifecycleRepository.clearTransition();
      else await recoverAfterClosedFailure();
      throw error;
    }
  };

  return Object.freeze({
    initialize:()=>enqueue(initializeInternal),
    getActiveProject:()=>clone(activeProject),
    getActiveRepositories:()=>activeScope?.repositories||null,
    saveActiveProject:project=>enqueue(async()=>{
      await initializeInternal();
      const id=identityOrNull(project);
      if(!activeProject||id!==activeProject.projectId){
        throw new Error('Only the active Project can be saved through Project Lifecycle.');
      }
      const saved=await projectRepository.save(project);
      await legacyCurrentRepository.save(saved);
      activeProject=saved;
      return clone(saved);
    }),
    listProjects:()=>projectRepository.list(),
    openProject:projectId=>enqueue(()=>switchInternal(projectId)),
    setActiveProject:projectId=>enqueue(()=>switchInternal(projectId)),
    closeProject:()=>enqueue(async()=>{
      await initializeInternal();
      const previous=await drainActive();
      try{await lifecycleRepository.clearActiveProject();}
      catch(error){await recoverAfterClosedFailure();throw error;}
      if(previous){
        publish('projectClosed',null,previous.projectId);
        publish('activeProjectChanged',null,previous.projectId);
      }
      return previous;
    }),
    createProject:(input,{activate=false}={})=>enqueue(async()=>{
      await initializeInternal();
      const project=await projectRepository.create({...input,lifecycleStatus:'active',archivedAt:null});
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
        await legacyCurrentRepository.save(renamed);activeProject=renamed;
      }
      return clone(renamed);
    }),
    archiveProject:projectId=>enqueue(async()=>{
      await initializeInternal();
      const id=String(projectId),wasActive=activeProject?.projectId===id;
      const previous=wasActive?await drainActive():null;
      try{
        const archived=await projectRepository.archive(id,clock.iso());
        if(wasActive)await lifecycleRepository.clearActiveProject();
        if(previous){
          publish('projectClosed',null,previous.projectId);
          publish('activeProjectChanged',null,previous.projectId);
        }
        publish('projectArchived',archived.projectId,null);
        return clone(archived);
      }catch(error){
        if(wasActive)await recoverAfterClosedFailure();
        throw error;
      }
    }),
    deleteProject:projectId=>enqueue(async()=>{
      await initializeInternal();
      const id=String(projectId),wasActive=activeProject?.projectId===id;
      const previous=wasActive?await drainActive():null;
      try{
        const deleted=await projectDeletionRepository.deleteProject(id);
        if(deleted){
          if(previous){
            publish('projectClosed',null,previous.projectId);
            publish('activeProjectChanged',null,previous.projectId);
          }
          publish('projectDeleted',id,null);
        }else if(wasActive)await recoverAfterClosedFailure();
        return deleted;
      }catch(error){
        if(wasActive)await recoverAfterClosedFailure();
        throw error;
      }
    }),
    flush:async()=>{await queue;return {status:'flushed'};}
  });
}
