import {TemplateValidationError} from './errors.js';

export const TEMPLATE_SCHEMA_VERSION=1;
export const SUPPORTED_TEMPLATE_TYPES=Object.freeze([
  'adv_cannonball','america_250','bdr','tat','adventure_ride','weekend_ride','day_ride','custom'
]);
export const TEMPLATE_DEFAULT_FIELDS=Object.freeze([
  'settings','layerDefaults','journalDefaults','analyticsDefaults','weatherDefaults',
  'hazardDefaults','checklistDefaults','offlineMapDefaults','rallyModeDefaults','metadata'
]);

const PROHIBITED_KEYS=new Set([
  'activeProject','activeProjectId','lifecycle','lifecycleState','journalEvents',
  'analyticsRecords','telemetrySamples','telemetryEvents','media','photos','videos',
  'liveGpsState','gpsSamples','breadcrumbs','searchIndex','searchIndexes',
  'features','routes','tracks','waypoints','checkpoints'
]);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const clone=(value,field='value')=>{
  try{return structuredClone(value);}
  catch(cause){throw new TemplateValidationError(`${field} cannot be cloned.`,{
    code:'TEMPLATE_VALUE_INVALID',details:{field},cause
  });}
};
const iso=(value,field)=>{
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))throw new TemplateValidationError(`${field} is invalid.`,{
    code:'TEMPLATE_TIMESTAMP_INVALID',details:{field}
  });
  return date.toISOString();
};

function findProhibited(value,path='template',seen=new Set()){
  if(!value||typeof value!=='object'||seen.has(value))return null;
  seen.add(value);
  for(const [key,item] of Object.entries(value)){
    if(PROHIBITED_KEYS.has(key))return `${path}.${key}`;
    const nested=findProhibited(item,`${path}.${key}`,seen);
    if(nested)return nested;
  }
  return null;
}

export function validateTemplate(template){
  if(!object(template))throw new TemplateValidationError('Template must be an object.');
  const id=typeof template.templateId==='string'?template.templateId.trim():'';
  if(!id)throw new TemplateValidationError('Template identity is required.',{code:'TEMPLATE_ID_REQUIRED'});
  if(Number(template.schemaVersion)!==TEMPLATE_SCHEMA_VERSION){
    throw new TemplateValidationError(`Unsupported Template schema version: ${template.schemaVersion}`,{
      code:'TEMPLATE_SCHEMA_UNSUPPORTED',details:{schemaVersion:template.schemaVersion}
    });
  }
  if(typeof template.name!=='string'||!template.name.trim()){
    throw new TemplateValidationError('Template name is required.',{code:'TEMPLATE_NAME_REQUIRED'});
  }
  const type=typeof template.templateType==='string'?template.templateType.trim():'';
  if(!/^[a-z0-9][a-z0-9_-]*$/.test(type)){
    throw new TemplateValidationError('Template type is invalid.',{
      code:'TEMPLATE_TYPE_INVALID',details:{templateType:template.templateType}
    });
  }
  if(typeof template.isBuiltIn!=='boolean'||typeof template.isUserDefined!=='boolean'||
    template.isBuiltIn===template.isUserDefined){
    throw new TemplateValidationError('Template must be either built-in or user-defined.',{
      code:'TEMPLATE_OWNERSHIP_INVALID'
    });
  }
  if(template.source===undefined||template.source===null||template.source===''){
    throw new TemplateValidationError('Template source is required.',{code:'TEMPLATE_SOURCE_REQUIRED'});
  }
  if(typeof template.source!=='string'&&!object(template.source)){
    throw new TemplateValidationError('Template source is invalid.',{code:'TEMPLATE_SOURCE_INVALID'});
  }
  if(typeof template.description!=='string'){
    throw new TemplateValidationError('Template description must be a string.',{code:'TEMPLATE_DESCRIPTION_INVALID'});
  }
  for(const field of TEMPLATE_DEFAULT_FIELDS){
    if(!object(template[field]))throw new TemplateValidationError(`${field} must be an object.`,{
      code:'TEMPLATE_DEFAULTS_INVALID',details:{field}
    });
  }
  iso(template.createdAt,'createdAt');iso(template.updatedAt,'updatedAt');
  const prohibited=findProhibited(template);
  if(prohibited)throw new TemplateValidationError(`Template contains prohibited Project state: ${prohibited}`,{
    code:'TEMPLATE_ACTIVE_STATE_PROHIBITED',details:{path:prohibited}
  });
  return true;
}

export function normalizeTemplate(input,{createId,now}={}){
  if(!object(input))throw new TemplateValidationError('Template must be an object.');
  const timestamp=typeof now==='function'?now():new Date().toISOString();
  const template={
    ...clone(input,'template'),
    templateId:String(input.templateId||(typeof createId==='function'?createId():'')).trim(),
    name:String(input.name||'').trim(),description:String(input.description||''),
    templateType:String(input.templateType||'custom').trim(),
    schemaVersion:Number(input.schemaVersion||TEMPLATE_SCHEMA_VERSION),
    createdAt:iso(input.createdAt||timestamp,'createdAt'),
    updatedAt:iso(input.updatedAt||timestamp,'updatedAt'),
    source:clone(input.source??(input.isBuiltIn?'built-in':'user'),'source'),
    isBuiltIn:Boolean(input.isBuiltIn),isUserDefined:Boolean(input.isUserDefined),
    ...Object.fromEntries(TEMPLATE_DEFAULT_FIELDS.map(field=>[field,clone(input[field]||{},field)]))
  };
  validateTemplate(template);
  return template;
}

export function createTemplateReference(template){
  validateTemplate(template);
  return Object.freeze({
    templateId:template.templateId,name:template.name,templateType:template.templateType,
    schemaVersion:template.schemaVersion,source:clone(template.source),updatedAt:template.updatedAt
  });
}

export function isKnownTemplateType(templateType){
  return SUPPORTED_TEMPLATE_TYPES.includes(String(templateType));
}
