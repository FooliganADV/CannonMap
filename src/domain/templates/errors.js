import {CannonMapError} from '../../core/errors.js';

export class TemplateValidationError extends CannonMapError {
  constructor(message,{code='TEMPLATE_INVALID',details,cause}={}){
    super(message,{code,details,cause});
  }
}

export class DuplicateTemplateError extends CannonMapError {
  constructor(templateId,{cause}={}){
    const id=String(templateId);
    super(`Template already exists: ${id}`,{
      code:'TEMPLATE_ALREADY_EXISTS',details:{templateId:id},cause
    });
  }
}

export class BuiltInTemplateMutationError extends CannonMapError {
  constructor(templateId,operation){
    const id=String(templateId);
    super(`Built-in Template cannot be ${operation}: ${id}`,{
      code:'TEMPLATE_BUILT_IN_IMMUTABLE',details:{templateId:id,operation}
    });
  }
}

export class TemplateNotFoundError extends CannonMapError {
  constructor(templateId){
    const id=String(templateId);
    super(`Template not found: ${id}`,{code:'TEMPLATE_NOT_FOUND',details:{templateId:id}});
  }
}
