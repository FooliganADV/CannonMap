import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUILT_IN_TEMPLATES,getBuiltInTemplate,listBuiltInTemplates
} from '../src/domain/templates/built-ins.js';
import {
  TEMPLATE_SCHEMA_VERSION,isKnownTemplateType,normalizeTemplate,validateTemplate
} from '../src/domain/templates/model.js';
import {createProjectTemplateService} from '../src/application/project-template-service.js';

const now='2026-07-31T12:00:00.000Z';
const userTemplate=(overrides={})=>normalizeTemplate({
  templateId:'template-1',name:'Unknown Rally',description:'Custom defaults',
  templateType:'future_rally_type',schemaVersion:TEMPLATE_SCHEMA_VERSION,
  createdAt:now,updatedAt:now,source:'user',isBuiltIn:false,isUserDefined:true,
  settings:{units:'miles',nested:{one:true}},layerDefaults:{routeVisible:true},
  journalDefaults:{enabled:true},analyticsDefaults:{enabled:true},
  weatherDefaults:{enabled:false},hazardDefaults:{enabled:true},
  checklistDefaults:{enabled:true,items:['fuel']},offlineMapDefaults:{enabled:true},
  rallyModeDefaults:{enabled:false},metadata:{category:'custom'},...overrides
});

test('built-in Templates are compact, immutable defaults and retrieval is isolated',()=>{
  assert.equal(BUILT_IN_TEMPLATES.length,2);
  assert.equal(Object.isFrozen(BUILT_IN_TEMPLATES[0]),true);
  const adv=getBuiltInTemplate('builtin.adv_cannonball');
  assert.deepEqual({
    rally:adv.rallyModeDefaults.enabled,journal:adv.journalDefaults.enabled,
    analytics:adv.analyticsDefaults.enabled,weather:adv.weatherDefaults.enabled,
    hazards:adv.hazardDefaults.enabled,offline:adv.offlineMapDefaults.enabled,
    checklist:adv.checklistDefaults.enabled
  },{rally:true,journal:true,analytics:true,weather:true,hazards:true,offline:true,checklist:true});
  assert.equal(Object.hasOwn(adv,'routes'),false);
  adv.name='Changed';
  assert.equal(getBuiltInTemplate('builtin.adv_cannonball').name,'ADV Cannonball');
  assert.equal(listBuiltInTemplates().every(template=>template.isBuiltIn&&!template.isUserDefined),true);
});

test('unknown Template types are preserved while known types remain discoverable',()=>{
  const template=userTemplate();
  assert.equal(template.templateType,'future_rally_type');
  assert.equal(isKnownTemplateType(template.templateType),false);
  assert.equal(isKnownTemplateType('bdr'),true);
  assert.equal(validateTemplate(template),true);
});

test('validation rejects identity, schema, ownership, malformed defaults, and prohibited state',()=>{
  for(const [patch,code] of [
    [{templateId:''},'TEMPLATE_ID_REQUIRED'],
    [{schemaVersion:99},'TEMPLATE_SCHEMA_UNSUPPORTED'],
    [{isBuiltIn:true,isUserDefined:true},'TEMPLATE_OWNERSHIP_INVALID'],
    [{settings:[]},'TEMPLATE_DEFAULTS_INVALID'],
    [{metadata:{lifecycleState:{active:true}}},'TEMPLATE_ACTIVE_STATE_PROHIBITED'],
    [{journalDefaults:{journalEvents:[]}},'TEMPLATE_ACTIVE_STATE_PROHIBITED'],
    [{templateType:'Not Valid'},'TEMPLATE_TYPE_INVALID'],
    [{source:[]},'TEMPLATE_SOURCE_INVALID'],
    [{settings:{callback(){}}},'TEMPLATE_VALUE_INVALID']
  ])assert.throws(()=>userTemplate(patch),error=>error.code===code);
  const valid=userTemplate();
  for(const [patch,code] of [
    [{templateId:{value:'template'}},'TEMPLATE_ID_REQUIRED'],
    [{name:{value:'Template'}},'TEMPLATE_NAME_REQUIRED'],
    [{templateType:{value:'custom'}},'TEMPLATE_TYPE_INVALID'],
    [{isBuiltIn:0},'TEMPLATE_OWNERSHIP_INVALID']
  ])assert.throws(()=>validateTemplate({...valid,...patch}),error=>error.code===code);
});

test('Project draft rejects invalid generated identity and malformed overrides',()=>{
  const template=userTemplate();
  const same=createProjectTemplateService({createId:()=>template.templateId,clock:{iso:()=>now}});
  assert.throws(()=>same.createProjectDraft(template),error=>error.code==='TEMPLATE_PROJECT_ID_INVALID');
  const valid=createProjectTemplateService({createId:()=> 'project-1',clock:{iso:()=>now}});
  assert.throws(()=>valid.createProjectDraft(template,{settings:[]}),error=>error.code==='TEMPLATE_OVERRIDES_INVALID');
});

test('Project draft applies defaults with a new identity and creates no active or historical state',()=>{
  let sequence=0;
  const service=createProjectTemplateService({createId:()=>`project-${++sequence}`,clock:{iso:()=>now}});
  const template=userTemplate();
  const draft=service.createProjectDraft(template,{
    name:'New Rally',settings:{nested:{two:true}},metadata:{owner:'rider'}
  });
  assert.equal(draft.projectId,'project-1');
  assert.notEqual(draft.projectId,template.templateId);
  assert.equal(draft.name,'New Rally');
  assert.deepEqual(draft.settings,{units:'miles',nested:{one:true,two:true}});
  assert.deepEqual(draft.offlineMapConfiguration,{enabled:true});
  assert.deepEqual(draft.journalDefaults,{enabled:true});
  assert.deepEqual(draft.analyticsDefaults,{enabled:true});
  assert.deepEqual(draft.metadata,{category:'custom',owner:'rider'});
  assert.deepEqual(draft.features,[]);assert.deepEqual(draft.journal,[]);assert.deepEqual(draft.analytics,{});
  for(const field of ['lifecycleStatus','lifecycleState','activeProject','journalEvents','analyticsRecords']){
    assert.equal(Object.hasOwn(draft,field),false);
  }
  assert.deepEqual(draft.templateReference,{
    templateId:'template-1',name:'Unknown Rally',templateType:'future_rally_type',
    schemaVersion:1,source:'user',updatedAt:now
  });
});

test('drafts and Templates remain isolated across repeated instantiation',()=>{
  let sequence=0;
  const service=createProjectTemplateService({createId:()=>`project-${++sequence}`,clock:{iso:()=>now}});
  const template=userTemplate(),first=service.createProjectDraft(template),second=service.createProjectDraft(template);
  first.settings.nested.one=false;first.journalDefaults.enabled=false;
  assert.notEqual(first.projectId,second.projectId);
  assert.equal(second.settings.nested.one,true);
  assert.equal(template.settings.nested.one,true);
  assert.equal(template.journalDefaults.enabled,true);
});
