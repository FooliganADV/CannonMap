const identity=project=>String(project?.projectId||project?.id||'');

/** The currently executing Project remains discoverable even if an older lifecycle registry missed it. */
export function discoverJourneyProjects(registered=[],activeProject=null){
  const projects=new Map();for(const project of registered||[]){const id=identity(project);if(id)projects.set(id,project);}
  const activeId=identity(activeProject);if(activeId)projects.set(activeId,{...(projects.get(activeId)||{}),...activeProject});
  return [...projects.values()];
}

export function journeyProjectManifest(project,media=[],createdAt=new Date().toISOString()){
  const days=new Set((project?.features||[]).map(feature=>Number(feature.day)).filter(day=>Number.isInteger(day)&&day>0)),originalPhotoCount=media.filter(item=>item.role==='original').length,evidencePhotoCount=media.filter(item=>item.role==='evidence').length;
  return {projectId:identity(project),projectName:project?.name||null,filename:`${String(project?.name||'CannonMap_Project').replace(/[^a-z0-9.-]+/gi,'_')}_Backup.cmapproject`,dayCount:days.size,originalPhotoCount,evidencePhotoCount,completedState:Object.values(project?.rallyExecution?.days||{}).length>0&&Object.values(project.rallyExecution.days).every(day=>day?.status==='complete'),lifecycleStatus:project?.lifecycleStatus||'active',archivedAt:project?.archivedAt||null,archiveTimestamp:createdAt};
}
