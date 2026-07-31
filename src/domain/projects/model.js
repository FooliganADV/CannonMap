export const PROJECT_SCHEMA_VERSION=1;
export const LEGACY_CURRENT_PROJECT_ID='legacy-current';

const clone=value=>JSON.parse(JSON.stringify(value??null));
const array=value=>Array.isArray(value)?clone(value):[];
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?clone(value):{};

export function normalizeProject(project,{createId,now,settings}={}){
  const source=object(project);
  const timestamp=typeof now==='function'?now():new Date().toISOString();
  const projectId=String(source.projectId||source.id||(typeof createId==='function'?createId():LEGACY_CURRENT_PROJECT_ID));
  const features=array(source.features);
  return {
    ...source,
    id:projectId,
    projectId,
    schemaVersion:PROJECT_SCHEMA_VERSION,
    name:String(source.name||'CannonMap Project'),
    createdAt:source.createdAt||timestamp,
    updatedAt:source.updatedAt||timestamp,
    features,
    competitors:array(source.competitors),
    journal:array(source.journal),
    analytics:object(source.analytics),
    photos:array(source.photos),
    videos:array(source.videos),
    notes:array(source.notes),
    offlineMapConfiguration:object(source.offlineMapConfiguration),
    settings:object(source.settings||settings)
  };
}

export function projectCollections(project){
  const features=Array.isArray(project?.features)?project.features:[];
  return Object.freeze({
    routes:features.filter(feature=>feature?.type==='route'),
    tracks:features.filter(feature=>feature?.type==='track'||feature?.type==='backbone'),
    checkpoints:features.filter(feature=>feature?.type==='checkpoint'||feature?.type==='hotel'),
    waypoints:features.filter(feature=>feature?.type==='waypoint'),
    journal:Array.isArray(project?.journal)?project.journal:[],
    analytics:project?.analytics&&typeof project.analytics==='object'?project.analytics:{},
    photos:Array.isArray(project?.photos)?project.photos:[],
    videos:Array.isArray(project?.videos)?project.videos:[],
    notes:Array.isArray(project?.notes)?project.notes:[],
    offlineMapConfiguration:project?.offlineMapConfiguration&&typeof project.offlineMapConfiguration==='object'?project.offlineMapConfiguration:{},
    settings:project?.settings&&typeof project.settings==='object'?project.settings:{}
  });
}

export function isProjectModel(project){
  return Boolean(
    project&&project.schemaVersion===PROJECT_SCHEMA_VERSION&&
    typeof project.projectId==='string'&&project.projectId&&
    Array.isArray(project.features)
  );
}
