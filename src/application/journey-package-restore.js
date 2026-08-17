const decoder=new TextDecoder();
import {readStoredZipBinary} from './portable-zip.js';
import {normalizeMediaExportRecord} from './photo-export-service.js';
import {checkpointEvidenceState} from '../domain/checkpoints/evidence.js';
const json=(files,name)=>{const bytes=files.get(name);if(!bytes)throw new Error(`Project package is missing ${name}.`);try{return JSON.parse(decoder.decode(bytes));}catch{throw new Error(`Project package contains invalid ${name}.`);}};
const completePair=records=>records.length===4&&['front','rear'].every(cameraRole=>['original','evidence'].every(role=>records.some(record=>record.cameraRole===cameraRole&&record.role===role)));
const validPairGroup=records=>{
  if(!records.length||records.length>4)return false;
  const slots=records.map(record=>`${record.cameraRole}:${record.role}`),validSlots=new Set(['front:original','front:evidence','rear:original','rear:evidence']);
  if(slots.some(slot=>!validSlots.has(slot))||new Set(slots).size!==slots.length)return false;
  // A group that claims completion must be structurally complete. Pending/failed
  // groups are valid recovery evidence and must survive backup without fabrication.
  return !records.some(record=>record.pairStatus==='complete')||completePair(records);
};

/** Parses CannonMap's stored (uncompressed) ZIP without inflating all media. */
export async function readStoredProjectPackage(file){
  const bytes=new Uint8Array(await file.arrayBuffer()),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),files=new Map();let offset=0;
  while(offset+30<=bytes.length&&view.getUint32(offset,true)===0x04034b50){const method=view.getUint16(offset+8,true),size=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extraLength=view.getUint16(offset+28,true);if(method!==0)throw new Error('Compressed project packages are not supported by this version.');const start=offset+30+nameLength+extraLength,end=start+size;if(end>bytes.length)throw new Error('Project package is truncated.');files.set(decoder.decode(bytes.slice(offset+30,offset+30+nameLength)),bytes.slice(start,end));offset=end;}
  const project=json(files,'Project.json'),journal=json(files,'Journal.json'),settings=json(files,'Settings.json'),manifest=json(files,'project-manifest.json'),mediaIndex=json(files,'media-index.json');
  if(manifest.format!=='cannonmap-project-media-backup'||![1,2].includes(Number(manifest.version)))throw new Error('Unsupported CannonMap project package.');if(String(project.projectId)!==String(manifest.projectId))throw new Error('Project package identity mismatch.');if(mediaIndex.length!==manifest.mediaCount)throw new Error('Project package media manifest mismatch.');
  const media=[];for(const raw of mediaIndex){const record=normalizeMediaExportRecord(raw),archivePath=record.archivePath||`media/${record.name}`,data=files.get(archivePath);if(!data)throw new Error(`Project package is missing ${archivePath}.`);if(Number.isFinite(Number(record.size))&&Number(record.size)!==data.length)throw new Error(`Project package media size mismatch: ${record.name}.`);if(manifest.version===2&&(record.checksum?.algorithm!=='SHA-256'||await digest(data)!==record.checksum.value))throw new Error(`Project package checksum failed: ${record.name}.`);media.push({...record,blob:new Blob([data],{type:record.mimeType||'application/octet-stream'})});}
  return Object.freeze({project,journal,settings,manifest,media});
}

export function createJourneyPackageRestoreService({repository}={}){
  if(!repository)throw new TypeError('repository is required.');
  return Object.freeze({
    async inspectDay(file){return readStoredDayPackage(file);},
    async verifyExistingDay(file){
      const payload=await readStoredDayPackage(file),dayNumber=Number(payload.manifest.dayNumber),restored=await repository.readDay(payload.manifest.projectId,dayNumber),verification=await verifyRestoredDayPayload(payload,restored);
      return Object.freeze({...payload,verification,existingVerified:true});
    },
    async restoreDay(file,{mode='cancel',recoveryProjectId=null,onProgress=()=>{}}={}){
      let payload=await readStoredDayPackage(file);
      if(mode==='recovery-copy'){
        const originalProjectId=payload.manifest.projectId,projectId=String(recoveryProjectId||`${originalProjectId}-recovery-${Date.now()}`),projectName=`${payload.projectMetadata.projectName||'CannonMap'} Recovery Copy`,rewrite=value=>({...value,projectId});
        payload={...payload,recoveryCopy:true,originalProjectId,manifest:{...payload.manifest,projectId,projectName,recoveryCopy:true,originalProjectId},projectMetadata:{...payload.projectMetadata,projectId,projectName,recoveryCopy:true,originalProjectId,project:{...payload.projectMetadata.project,projectId,id:projectId,name:projectName,lifecycleStatus:'active'}},journal:payload.journal.map(rewrite),media:payload.media.map(rewrite)};
        onProgress('restore_copy_identity_created',{recoveryProjectId:projectId,recoveryProjectName:projectName});
        mode='cancel';
      }
      await repository.restoreDay(payload,{mode});
      const dayNumber=Number(payload.manifest.dayNumber),objectiveCount=(payload.projectMetadata.dayFeatures||[]).length,pairCount=new Set(payload.media.map(item=>item.pairId).filter(Boolean)).size;
      onProgress('restore_project_written',{projectId:payload.manifest.projectId});onProgress('restore_day_written',{dayNumber,objectiveCount});onProgress('restore_journal_written',{eventCount:payload.journal.length});onProgress('restore_media_written',{mediaCount:payload.media.length,pairCount});onProgress('restore_postwrite_verification_started',{projectId:payload.manifest.projectId,dayNumber});
      const restored=await repository.readDay(payload.manifest.projectId,dayNumber),verification=await verifyRestoredDayPayload(payload,restored);onProgress('restore_postwrite_verification_passed',{projectId:verification.projectId,dayNumber,mediaCount:verification.mediaCount,journalCount:verification.journalEventCount,pairCount:verification.pairCount});return Object.freeze({...payload,verification});
    },
    async restore(file){const payload=await readStoredProjectPackage(file);await repository.restoreNew(payload);return payload;}
  });
}

const digest=async bytes=>{const hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,'0')).join('');};
const stateCounts=features=>({checkpointCount:features.length,collected:features.filter(item=>item.status==='collected').length,deferred:features.filter(item=>item.status==='deferred').length,failed:features.filter(item=>item.status==='failed').length,score:features.reduce((sum,item)=>sum+Number(item.scoreAwarded??(item.status==='collected'?item.points:0))||sum,0),hotelState:features.find(item=>item.type==='hotel')?.status||null});
const projection=value=>JSON.stringify(checkpointEvidenceState(value));
export async function verifyRestoredDayPayload(payload,restored){
  const {manifest,projectMetadata}=payload,day=Number(manifest.dayNumber),project=restored?.project,features=(project?.features||[]).filter(item=>Number(item.day)===day),expectedFeatures=projectMetadata.dayFeatures||(projectMetadata.project?.features||[]).filter(item=>Number(item.day)===day),actual=stateCounts(features),expected=stateCounts(expectedFeatures);
  if(!project||String(project.projectId)!==String(manifest.projectId))throw new Error('Restore verification failed: Project identity mismatch.');if(actual.checkpointCount!==expected.checkpointCount||actual.collected!==expected.collected||actual.deferred!==expected.deferred||actual.failed!==expected.failed||actual.score!==expected.score||actual.hotelState!==expected.hotelState)throw new Error('Restore verification failed: checkpoint, score, or hotel state mismatch.');
  const byFeatureId=new Map(features.map(item=>[String(item.id),item])),manifestByFeatureId=new Map((manifest.checkpointStates||[]).map(item=>[String(item.id),item]));for(const expectedFeature of expectedFeatures){const feature=byFeatureId.get(String(expectedFeature.id));if(!feature||feature.status!==expectedFeature.status||Number(feature.scoreAwarded||0)!==Number(expectedFeature.scoreAwarded||0)||feature.type!==expectedFeature.type)throw new Error(`Restore verification failed: objective state mismatch for ${expectedFeature.id}.`);if(projection(feature)!==projection(expectedFeature))throw new Error(`Restore verification failed: checkpoint evidence mismatch for ${expectedFeature.id}.`);const manifestFeature=manifestByFeatureId.get(String(expectedFeature.id));if(manifestFeature?.checkpointEvidence&&JSON.stringify(manifestFeature.checkpointEvidence)!==projection(expectedFeature))throw new Error(`Restore verification failed: checkpoint evidence manifest mismatch for ${expectedFeature.id}.`);}
  if(restored.journal.length!==manifest.journalEventCount||restored.media.length!==manifest.mediaCount)throw new Error('Restore verification failed: Journal or media count mismatch.');
  const expectedById=new Map(payload.media.map(item=>[String(item.mediaId),normalizeMediaExportRecord(item)])),paths=new Set(),pairs=new Map();for(const rawRecord of restored.media){const record=normalizeMediaExportRecord(rawRecord),expectedRecord=expectedById.get(String(record.mediaId)),archiveIdentity=record.archivePath||record.name;if(!expectedRecord||record.name!==expectedRecord.name||record.role!==expectedRecord.role||record.cameraRole!==expectedRecord.cameraRole||record.logicalSide!==expectedRecord.logicalSide||record.pairId!==expectedRecord.pairId||record.pairedMediaId!==expectedRecord.pairedMediaId||paths.has(archiveIdentity))throw new Error('Restore verification failed: media identity, filename, or relationship mismatch.');paths.add(archiveIdentity);const bytes=new Uint8Array(await record.blob.arrayBuffer());if(!bytes.byteLength||await digest(bytes)!==expectedRecord.checksum.value)throw new Error(`Restore verification failed: checksum mismatch for ${record.name}.`);if(record.pairId){if(!pairs.has(record.pairId))pairs.set(record.pairId,[]);pairs.get(record.pairId).push(record);}}
  for(const [pairId,records] of pairs)if(!validPairGroup(records))throw new Error(`Restore verification failed: invalid Capture Pair ${pairId}.`);
  return Object.freeze({verified:true,projectId:project.projectId,projectName:project.name,dayNumber:day,status:manifest.dayState?.status||project.rallyExecution?.days?.[day]?.status||null,...actual,journalEventCount:restored.journal.length,pairCount:pairs.size,mediaCount:restored.media.length,filenames:restored.media.map(record=>record.name)});
}
export async function readStoredDayPackage(file){
  const files=await readStoredZipBinary(file),parse=name=>{const bytes=files.get(name);if(!bytes)throw new Error(`Day package is missing ${name}.`);try{return JSON.parse(decoder.decode(bytes));}catch{throw new Error(`Day package contains invalid ${name}.`);}},manifest=parse('manifest/day-manifest.json'),projectMetadata=parse('manifest/project-metadata.json'),mediaIndex=parse('manifest/media-index.json'),journal=parse('journal/Daily_Journal.json');
  if(manifest.format!=='cannonmap-day-backup'||manifest.version!==2)throw new Error('Unsupported CannonMap day package.');if(String(projectMetadata.projectId)!==String(manifest.projectId)||Number(projectMetadata.dayNumber)!==Number(manifest.dayNumber))throw new Error('Day package identity mismatch.');
  if(!Array.isArray(journal)||!Array.isArray(mediaIndex)||mediaIndex.length!==manifest.mediaCount||journal.length!==manifest.journalEventCount)throw new Error('Day package manifest count mismatch.');
  const names=new Set(),media=[];for(const raw of mediaIndex){const record=normalizeMediaExportRecord(raw);if(!record.mediaId||!record.archivePath||names.has(record.archivePath))throw new Error('Day package media index is invalid.');names.add(record.archivePath);const bytes=files.get(record.archivePath);if(!bytes?.byteLength)throw new Error(`Day package is missing media bytes: ${record.archivePath}.`);if(record.checksum?.algorithm!=='SHA-256'||await digest(bytes)!==record.checksum.value)throw new Error(`Day package checksum failed: ${record.archivePath}.`);media.push({...record,blob:new Blob([bytes],{type:record.mimeType||'application/octet-stream'})});}
  const pairGroups=new Map();for(const record of media.filter(item=>item.pairId)){if(!pairGroups.has(record.pairId))pairGroups.set(record.pairId,[]);pairGroups.get(record.pairId).push(record);}
  for(const [pairId,records] of pairGroups)if(!validPairGroup(records))throw new Error(`Day package pair relationship is invalid: ${pairId}.`);
  return Object.freeze({manifest,projectMetadata,journal,media});
}

