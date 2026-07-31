import {CannonMapError} from '../../core/errors.js';

export class BackupValidationError extends CannonMapError {
  constructor(message,{code='BACKUP_INVALID',details,cause}={}){
    super(message,{code,details,cause});
  }
}

export class UnsupportedArchiveVersionError extends BackupValidationError {
  constructor(version){
    super(`Unsupported CannonMap archive version: ${version}`,{
      code:'BACKUP_ARCHIVE_VERSION_UNSUPPORTED',details:{archiveVersion:version}
    });
  }
}

export class BackupChecksumError extends BackupValidationError {
  constructor(){super('CannonMap archive checksum verification failed.',{code:'BACKUP_CHECKSUM_INVALID'});}
}

export class DuplicateBackupProjectError extends CannonMapError {
  constructor(projectId){
    const id=String(projectId);
    super(`Project already exists: ${id}`,{code:'BACKUP_PROJECT_ALREADY_EXISTS',details:{projectId:id}});
  }
}

export class BackupImportError extends CannonMapError {
  constructor(message,{code='BACKUP_IMPORT_FAILED',details,cause}={}){
    super(message,{code,details,cause});
  }
}
