export const PROJECT_LIFECYCLE_SCHEMA_VERSION=1;
export const PROJECT_LIFECYCLE_EVENT_TYPES=Object.freeze([
  'projectCreated','projectOpened','projectClosed','projectArchived',
  'projectDeleted','activeProjectChanged'
]);

export function createProjectLifecycleEvent({
  type,projectId,previousProjectId=null,clock,createId,payload={}
}){
  if(!PROJECT_LIFECYCLE_EVENT_TYPES.includes(type))throw new TypeError(`Unsupported project lifecycle event: ${type}`);
  if(typeof createId!=='function'||!clock)throw new TypeError('createId and clock are required.');
  const occurredAt=clock.iso();
  return Object.freeze({
    type,eventId:createId(),entityId:String(projectId||previousProjectId||'project-lifecycle'),
    occurredAt,correlationId:createId(),causationId:null,
    schemaVersion:PROJECT_LIFECYCLE_SCHEMA_VERSION,
    payload:Object.freeze({
      projectId:projectId?String(projectId):null,
      previousProjectId:previousProjectId?String(previousProjectId):null,
      ...structuredClone(payload)
    })
  });
}

export function projectIdentity(project){
  const value=String(project?.projectId||project?.id||'').trim();
  if(!value)throw new TypeError('Project identity is required.');
  return value;
}
