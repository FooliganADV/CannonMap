import {normalizeTemplate} from './model.js';

const ESTABLISHED_AT='2026-07-31T00:00:00.000Z';
const freeze=value=>{
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    Object.freeze(value);for(const child of Object.values(value))freeze(child);
  }
  return value;
};
const builtIn=input=>freeze(normalizeTemplate({
  ...input,createdAt:ESTABLISHED_AT,updatedAt:ESTABLISHED_AT,
  source:'cannonmap',isBuiltIn:true,isUserDefined:false,
  settings:input.settings||{},layerDefaults:input.layerDefaults||{},
  journalDefaults:input.journalDefaults||{},analyticsDefaults:input.analyticsDefaults||{},
  weatherDefaults:input.weatherDefaults||{},hazardDefaults:input.hazardDefaults||{},
  checklistDefaults:input.checklistDefaults||{},offlineMapDefaults:input.offlineMapDefaults||{},
  rallyModeDefaults:input.rallyModeDefaults||{},metadata:input.metadata||{}
}));

export const BUILT_IN_TEMPLATES=Object.freeze([
  builtIn({
    templateId:'builtin.adv_cannonball',name:'ADV Cannonball',
    description:'Competitive rally defaults without route content.',templateType:'adv_cannonball',
    journalDefaults:{enabled:true,mode:'full'},analyticsDefaults:{enabled:true},
    weatherDefaults:{enabled:true},hazardDefaults:{enabled:true},
    checklistDefaults:{enabled:true},offlineMapDefaults:{enabled:true},
    rallyModeDefaults:{enabled:true},metadata:{category:'rally'}
  }),
  builtIn({
    templateId:'builtin.day_ride',name:'Day Ride',
    description:'Lightweight defaults for a single-day ride.',templateType:'day_ride',
    journalDefaults:{enabled:true,mode:'simplified'},analyticsDefaults:{enabled:true},
    offlineMapDefaults:{enabled:false,optional:true},rallyModeDefaults:{enabled:false},
    metadata:{category:'recreation'}
  })
]);

const byId=new Map(BUILT_IN_TEMPLATES.map(template=>[template.templateId,template]));
export const isBuiltInTemplateId=templateId=>byId.has(String(templateId));
export const getBuiltInTemplate=templateId=>{
  const template=byId.get(String(templateId));
  return template?structuredClone(template):null;
};
export const listBuiltInTemplates=()=>BUILT_IN_TEMPLATES.map(template=>structuredClone(template));
