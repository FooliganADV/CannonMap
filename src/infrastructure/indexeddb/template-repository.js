import {
  BuiltInTemplateMutationError,DuplicateTemplateError,TemplateNotFoundError
} from '../../domain/templates/errors.js';
import {normalizeTemplate} from '../../domain/templates/model.js';
import {
  getBuiltInTemplate,isBuiltInTemplateId,listBuiltInTemplates
} from '../../domain/templates/built-ins.js';
import {requestResult,transactionDone} from './request.js';

const STORE='projectTemplates';
const clone=value=>structuredClone(value);

/** User Templates persist in IndexedDB; built-ins remain immutable code assets. */
export function createTemplateRepository({database,createId,now}={}){
  if(!database||typeof createId!=='function'||typeof now!=='function'){
    throw new TypeError('Template repository database, identity, and clock dependencies are required.');
  }
  const timestamp=()=>new Date(now()).toISOString();
  const readUser=async templateId=>{
    const transaction=database.transaction(STORE,'readonly'),done=transactionDone(transaction);
    const value=await requestResult(transaction.objectStore(STORE).get(String(templateId)));
    await done;return value||null;
  };
  const assertMutable=templateId=>{
    if(isBuiltInTemplateId(templateId))throw new BuiltInTemplateMutationError(templateId,'modified');
  };
  const createRecord=input=>{
    const createdAt=timestamp();
    return normalizeTemplate({
      ...input,templateId:input?.templateId||createId(),createdAt,updatedAt:createdAt,
      source:input?.source??'user',isBuiltIn:false,isUserDefined:true
    });
  };
  const createTemplate=async input=>{
    const record=createRecord(input||{});
    if(isBuiltInTemplateId(record.templateId))throw new BuiltInTemplateMutationError(record.templateId,'overwritten');
    const transaction=database.transaction(STORE,'readwrite'),done=transactionDone(transaction);
    try{
      await requestResult(transaction.objectStore(STORE).add(clone(record)));
      await done;return clone(record);
    }catch(error){
      try{transaction.abort();}catch(_){ }
      try{await done;}catch(_){ }
      if(error?.name==='ConstraintError'||transaction.error?.name==='ConstraintError'){
        throw new DuplicateTemplateError(record.templateId,{cause:error});
      }
      throw error;
    }
  };
  const getTemplate=async templateId=>getBuiltInTemplate(templateId)||clone(await readUser(templateId));
  return Object.freeze({
    createTemplate,getTemplate,
    async listTemplates(){
      const transaction=database.transaction(STORE,'readonly'),done=transactionDone(transaction);
      const users=await requestResult(transaction.objectStore(STORE).getAll());
      await done;
      return [...listBuiltInTemplates(),...users.map(clone)].sort((left,right)=>
        left.name.localeCompare(right.name)||left.templateId.localeCompare(right.templateId));
    },
    async updateTemplate(templateId,patch={}){
      const id=String(templateId);assertMutable(id);
      const existing=await readUser(id);
      if(!existing)throw new TemplateNotFoundError(id);
      const updated=normalizeTemplate({
        ...existing,...patch,templateId:id,createdAt:existing.createdAt,updatedAt:timestamp(),
        isBuiltIn:false,isUserDefined:true
      });
      const transaction=database.transaction(STORE,'readwrite'),done=transactionDone(transaction);
      await requestResult(transaction.objectStore(STORE).put(clone(updated)));
      await done;return clone(updated);
    },
    async deleteTemplate(templateId){
      const id=String(templateId);
      if(isBuiltInTemplateId(id))throw new BuiltInTemplateMutationError(id,'deleted');
      const transaction=database.transaction(STORE,'readwrite'),done=transactionDone(transaction);
      const store=transaction.objectStore(STORE),existing=await requestResult(store.get(id));
      if(existing)store.delete(id);
      await done;return Boolean(existing);
    },
    async cloneTemplate(templateId,{templateId:cloneId,name}={}){
      const source=await getTemplate(templateId);
      if(!source)throw new TemplateNotFoundError(templateId);
      return createTemplate({
        ...source,templateId:cloneId||createId(),name:name||`${source.name} Copy`,
        source:{kind:'clone',templateId:source.templateId},isBuiltIn:false,isUserDefined:true
      });
    }
  });
}
