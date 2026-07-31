import {createProjectArchive,validateProjectArchive} from '../domain/backup/archive.js';

/**
 * UI-independent Backup use cases. The lifecycle port serializes operations;
 * the repository owns transactionally consistent IndexedDB snapshots/writes.
 */
export function createProjectBackupService({
  backupRepository,projectLifecycle,clock,applicationVersion,schemaVersion,crypto
}={}){
  if(!backupRepository||!clock||typeof clock.iso!=='function'){
    throw new TypeError('Backup repository and clock are required.');
  }
  if(!projectLifecycle||typeof projectLifecycle.flush!=='function'){
    throw new TypeError('Project lifecycle coordination is required.');
  }
  if(typeof applicationVersion!=='string'||!applicationVersion||
    !Number.isInteger(schemaVersion)||schemaVersion<1){
    throw new TypeError('Application and schema versions are required.');
  }
  const synchronize=async()=>{await projectLifecycle.flush();};
  const validate=archive=>validateProjectArchive(archive,{crypto,maxSchemaVersion:schemaVersion});
  return Object.freeze({
    async exportProject(projectId,{exportedAt=clock.iso()}={}){
      await synchronize();
      const snapshot=await backupRepository.readProjectSnapshot(String(projectId));
      return createProjectArchive({snapshot,applicationVersion,schemaVersion,exportedAt,crypto});
    },
    validateArchive:validate,
    async importProject(archive,{mode='create',dryRun=false}={}){
      if(!['create','replace'].includes(mode))throw new TypeError('Import mode must be create or replace.');
      const validation=await validate(archive);
      await synchronize();
      await backupRepository.inspectProjectImport(validation.projectId,{mode});
      if(dryRun)return Object.freeze({valid:true,dryRun:true,mode,projectId:validation.projectId});
      return backupRepository.importProjectArchive(validation.archive,{mode,importedAt:clock.iso()});
    }
  });
}
