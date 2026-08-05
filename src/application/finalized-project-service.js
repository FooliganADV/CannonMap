import {createFinalizedEnvelope,verifyFinalizedEnvelope} from '../domain/projects/finalized.js';
import {createStoredZip} from './photo-export-service.js';
import {jsonZipFile,readStoredZip} from './portable-zip.js';
export function createFinalizedProjectService({repository,projectLifecycle,createId,clock,applicationVersion,buildId,crypto=globalThis.crypto}={}){
  if(!repository||!projectLifecycle||typeof createId!=='function'||!clock)throw new TypeError('Finalized Project dependencies are required.');
  const packageOf=async(project,settings)=>createFinalizedEnvelope({project,settings,applicationVersion,buildId,finalizedAt:clock.iso(),crypto});
  const inspect=async input=>{const files=await readStoredZip(input),verified=await verifyFinalizedEnvelope(files,{crypto});return {...verified,files};};
  return Object.freeze({
    validate:(project,settings)=>import('../domain/projects/finalized.js').then(module=>module.validateFinalizedProject(project,{settings})),
    async exportFinalized(project,settings){await projectLifecycle.flush();const envelope=await packageOf(project,settings),blob=await createStoredZip(Object.entries(envelope.files).map(([name,value])=>jsonZipFile(name,value)));return {blob,filename:`${String(project.name).replace(/[^a-z0-9.-]+/gi,'_')}_Final.cmapproject.zip`,...envelope};},
    inspect,
    async importMaster(input){const verified=await inspect(input),masterId=`finalized:${verified.manifest.projectId}:${verified.manifest.checksums['project.json']}`;const existing=await repository.get(masterId);if(!existing)await repository.create({masterId,packageType:'finalized-project',manifest:verified.manifest,project:verified.project,validation:verified.validation,importedAt:clock.iso(),immutable:true});return {...verified,masterId,alreadyImported:Boolean(existing)};},
    async createExecutionCopy(masterId,{activate=false}={}){const record=await repository.get(masterId);if(!record)throw new Error('Finalized master is unavailable.');const executionId=createId(),now=clock.iso(),project={...structuredClone(record.project),id:executionId,projectId:executionId,name:record.project.name,createdAt:now,updatedAt:now,finalizedMasterReference:{masterId,sourceProjectId:record.manifest.projectId,finalizedAt:record.manifest.finalizedAt,checksum:record.manifest.checksums['project.json']},executionIdentity:executionId,lifecycleStatus:'active'};return projectLifecycle.createProject(project,{activate});}
  });
}
