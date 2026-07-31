import {CannonMapError} from '../../core/errors.js';

export class DuplicateProjectError extends CannonMapError {
  constructor(projectId,{cause}={}){
    const id=String(projectId);
    super(`Project already exists: ${id}`,{
      code:'PROJECT_ALREADY_EXISTS',cause,details:{projectId:id}
    });
  }
}
