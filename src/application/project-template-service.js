import {normalizeProject} from '../domain/projects/model.js';
import {createTemplateReference,validateTemplate} from '../domain/templates/model.js';
import {TemplateValidationError} from '../domain/templates/errors.js';

const clone=value=>structuredClone(value);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const merge=(base,override)=>{
  const output=clone(base||{});
  for(const [key,value] of Object.entries(override||{})){
    output[key]=object(value)&&object(output[key])?merge(output[key],value):clone(value);
  }
  return output;
};

/** Produces an isolated, unpersisted Project draft; it has no lifecycle effects. */
export function createProjectTemplateService({createId,clock}={}){
  if(typeof createId!=='function'||!clock||typeof clock.iso!=='function'){
    throw new TypeError('Project Template identity and clock dependencies are required.');
  }
  return Object.freeze({
    createProjectDraft(template,{name,description,settings={},metadata={}}={}){
      validateTemplate(template);
      const projectId=createId(),timestamp=clock.iso();
      if(!String(projectId||'').trim()||String(projectId)===template.templateId){
        throw new TemplateValidationError('Generated Project identity is invalid.',{
          code:'TEMPLATE_PROJECT_ID_INVALID',details:{projectId}
        });
      }
      if(!object(settings)||!object(metadata))throw new TemplateValidationError(
        'Project draft settings and metadata overrides must be objects.',{code:'TEMPLATE_OVERRIDES_INVALID'}
      );
      return normalizeProject({
        projectId,id:projectId,name:String(name||template.name),
        description:String(description??template.description),
        createdAt:timestamp,updatedAt:timestamp,features:[],competitors:[],notes:[],
        journal:[],analytics:{},photos:[],videos:[],
        settings:merge(template.settings,settings),
        layerDefaults:clone(template.layerDefaults),
        journalDefaults:clone(template.journalDefaults),
        analyticsDefaults:clone(template.analyticsDefaults),
        weatherDefaults:clone(template.weatherDefaults),
        hazardDefaults:clone(template.hazardDefaults),
        checklistDefaults:clone(template.checklistDefaults),
        offlineMapConfiguration:clone(template.offlineMapDefaults),
        rallyModeDefaults:clone(template.rallyModeDefaults),
        metadata:merge(template.metadata,metadata),
        templateReference:createTemplateReference(template)
      },{createId,now:()=>timestamp});
    }
  });
}
