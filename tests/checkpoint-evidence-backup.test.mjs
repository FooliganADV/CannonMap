import assert from 'node:assert/strict';
import test from 'node:test';
import {createPhotoExportService} from '../src/application/photo-export-service.js';
import {createJourneyPackageRestoreService,readStoredDayPackage,verifyRestoredDayPayload} from '../src/application/journey-package-restore.js';
import {readStoredZip} from '../src/application/portable-zip.js';

const checkpointEvidence={
  schemaVersion:1,
  arrival:{state:'confirmed',arrivalId:'arrival-cp-1',journalEventId:'arrival-event',checkpointId:'cp-1',objectiveId:'cp-1',objectiveType:'checkpoint',dayId:'day-1',dayNumber:1,timestamp:'2026-08-17T14:00:00.000Z',latitude:38.123,longitude:-105.456,gpsAccuracyFeet:12,speedMph:34,motionState:'moving',heading:82,sampleTimestamp:'2026-08-17T14:00:00.000Z',sampleAgeMs:0,source:'gps_capture',offline:true,background:false,interruptionContext:null,trustworthy:true},
  photo:{required:true,state:'partial',pairId:'pair-1',pairJournalEventId:'pair-event',reasonCode:'rear-only',failureReason:null,missingSides:['front'],mediaReferences:{rearOriginalMediaId:'rear-original',rearEvidenceMediaId:'rear-evidence'},updatedAt:'2026-08-17T14:00:02.000Z'},
  completion:{state:'pending',completedAt:null,pointsAwarded:0,legacyCompletionWithoutRequiredPhoto:false}
};
const feature={id:'cp-1',name:'1.4 BLVD',type:'checkpoint',day:1,status:'photo_required',points:10,scoreAwarded:0,photoRequired:true,arrivedAt:'2026-08-17T14:00:00.000Z',arrivalState:'confirmed',photoEvidenceState:'partial',finalCompletionState:'pending',pendingPhotoPair:{pairId:'pair-1',pairJournalEventId:'pair-event',status:'partial'},checkpointEvidence};
const media=['original','evidence'].map(role=>({mediaId:`rear-${role}`,projectId:'project',checkpointId:'cp-1',journalEventId:'pair-event',pairId:'pair-1',pairStatus:'pending',cameraRole:'rear',role,pairedMediaId:`rear-${role==='original'?'evidence':'original'}`,name:`Day01_CP1.4_Rear_${role}.jpg`,mimeType:'image/jpeg',size:role.length,blob:new Blob([`rear-${role}`],{type:'image/jpeg'}),metadata:{dayNumber:1,objectiveType:'checkpoint',pairId:'pair-1',cameraRole:'rear'}}));
const journal=[
  {eventId:'arrival-event',projectId:'project',eventType:'checkpoint_arrival',timestamp:'2026-08-17T14:00:00.000Z',references:{checkpointId:'cp-1'},metadata:{dayNumber:1,checkpointId:'cp-1',arrivalEvidence:checkpointEvidence.arrival}},
  {eventId:'incomplete-event',projectId:'project',eventType:'checkpoint_photo_evidence_incomplete',timestamp:'2026-08-17T14:00:02.000Z',references:{checkpointId:'cp-1',pairId:'pair-1'},metadata:{dayNumber:1,photoEvidenceState:'partial',pointsWithheld:true,missingSides:['front']}}
];

test('Day backup keeps Journal, partial media, and explicit checkpoint evidence projection together',async()=>{
  const project={projectId:'project',id:'project',name:'America 250',features:[feature],rallyExecution:{days:{1:{dayNumber:1,status:'active',score:0}}}},repository={listProjectPhotos:async()=>media},exporter=createPhotoExportService({repository}),archive=await exporter.dayBackup('project',1,{project,journal,settings:{rallyDays:{1:{status:'active',score:0}}},applicationVersion:'test',buildId:'evidence-backup'}),files=await readStoredZip(archive.blob),manifest=JSON.parse(files['manifest/day-manifest.json']),metadata=JSON.parse(files['manifest/project-metadata.json']),exportedJournal=JSON.parse(files['journal/Daily_Journal.json']),mediaIndex=JSON.parse(files['manifest/media-index.json']),payload=await readStoredDayPackage(archive.blob);

  assert.equal(manifest.version,2,'additive evidence fields do not break the established Day package version');
  assert.equal(manifest.checkpointEvidenceSchemaVersion,1);
  assert.deepEqual(manifest.journalEvidenceCounts,{arrival:1,photoIncomplete:1,photoRecovered:0,completed:0});
  assert.deepEqual(manifest.checkpointStates[0],{
    id:'cp-1',type:'checkpoint',status:'photo_required',order:null,points:10,pointsAwarded:0,photoRequired:true,pairId:'pair-1',
    arrivalState:'confirmed',photoEvidenceState:'partial',finalCompletionState:'pending',checkpointEvidence
  });
  assert.deepEqual(metadata.checkpointEvidence,[{id:'cp-1',...checkpointEvidence}]);
  assert.deepEqual(metadata.dayFeatures[0].checkpointEvidence,checkpointEvidence);
  assert.deepEqual(exportedJournal,journal);
  assert.equal(mediaIndex.length,2);assert.ok(mediaIndex.every(record=>record.pairId==='pair-1'&&record.cameraRole==='rear'));
  assert.deepEqual(payload.projectMetadata.project.features[0].checkpointEvidence,checkpointEvidence);
  assert.deepEqual(payload.journal,journal);assert.equal(payload.media.length,2);

  const restoreRepository={payload:null,async restoreDay(value){this.payload=value;},async readDay(){return {project:this.payload.projectMetadata.project,journal:this.payload.journal,media:this.payload.media};}},restore=createJourneyPackageRestoreService({repository:restoreRepository}),restored=await restore.restoreDay(archive.blob);
  assert.equal(restored.verification.verified,true);assert.equal(restored.verification.score,0);assert.equal(restored.verification.mediaCount,2);assert.equal(restored.verification.journalEventCount,2);
});

test('recovered photo evidence and final scoring state are explicit in the additive manifest fields',async()=>{
  const completedEvidence=structuredClone(checkpointEvidence);completedEvidence.photo.state='complete';completedEvidence.photo.missingSides=[];completedEvidence.photo.reasonCode=null;completedEvidence.completion={state:'completed',completedAt:'2026-08-17T14:00:05.000Z',pointsAwarded:10,legacyCompletionWithoutRequiredPhoto:false};
  const completedFeature={...feature,status:'collected',completedAt:'2026-08-17T14:00:05.000Z',photoEvidenceState:'complete',finalCompletionState:'completed',scoreAwarded:10,checkpointEvidence:completedEvidence,photoPair:{pairId:'pair-1',journalEventId:'pair-event',status:'complete'}};
  const completedMedia=['front','rear'].flatMap(cameraRole=>['original','evidence'].map(role=>({mediaId:`${cameraRole}-${role}`,projectId:'project',checkpointId:'cp-1',journalEventId:'pair-event',pairId:'pair-1',pairStatus:'complete',cameraRole,role,pairedMediaId:`${cameraRole}-${role==='original'?'evidence':'original'}`,name:`Day01_CP1.4_${cameraRole}_${role}.jpg`,mimeType:'image/jpeg',blob:new Blob([`${cameraRole}-${role}`],{type:'image/jpeg'}),metadata:{dayNumber:1,objectiveType:'checkpoint',pairId:'pair-1',cameraRole}}))),completedJournal=[
    journal[0],
    {eventId:'recovered-event',projectId:'project',eventType:'checkpoint_photo_evidence_recovered',timestamp:'2026-08-17T14:00:04.000Z',references:{checkpointId:'cp-1',pairId:'pair-1'},metadata:{dayNumber:1,photoEvidenceState:'complete'}},
    {eventId:'complete-event',projectId:'project',eventType:'checkpoint_completed',timestamp:'2026-08-17T14:00:05.000Z',references:{checkpointId:'cp-1'},metadata:{dayNumber:1,objectiveCompletion:true,points:10}}
  ],project={projectId:'project',name:'America 250',features:[completedFeature],rallyExecution:{days:{1:{status:'active',score:10}}}},archive=await createPhotoExportService({repository:{listProjectPhotos:async()=>completedMedia}}).dayBackup('project',1,{project,journal:completedJournal}),manifest=archive.manifest,state=manifest.checkpointStates[0];
  assert.deepEqual(manifest.journalEvidenceCounts,{arrival:1,photoIncomplete:0,photoRecovered:1,completed:1});
  assert.equal(state.arrivalState,'confirmed');assert.equal(state.photoEvidenceState,'complete');assert.equal(state.finalCompletionState,'completed');assert.equal(state.pointsAwarded,10);assert.equal(state.pairId,'pair-1');
});

test('restore verification detects lost checkpoint evidence while accepting legacy Day package projections',async()=>{
  const manifest={format:'cannonmap-day-backup',version:2,projectId:'project',projectName:'Trip',dayNumber:1,mediaCount:0,journalEventCount:0,checkpointStates:[{id:'legacy',type:'checkpoint',status:'deferred',points:10}],dayState:{status:'active'}},legacy={id:'legacy',type:'checkpoint',day:1,status:'deferred',points:10,arrivedAt:null,photoRequired:false},project={projectId:'project',name:'Trip',features:[legacy],rallyExecution:{days:{1:{status:'active'}}}},payload={manifest,projectMetadata:{projectId:'project',dayNumber:1,project,dayFeatures:[legacy]},journal:[],media:[]};
  const compatible=await verifyRestoredDayPayload(payload,{project:structuredClone(project),journal:[],media:[]});
  assert.equal(compatible.verified,true,'legacy v2 packages without evidence manifest fields remain valid');

  const expectedProject={projectId:'project',name:'Trip',features:[feature],rallyExecution:{days:{1:{status:'active'}}}},expectedPayload={manifest:{...manifest,checkpointEvidenceSchemaVersion:1,checkpointStates:[{id:'cp-1',checkpointEvidence}]},projectMetadata:{projectId:'project',dayNumber:1,project:expectedProject,dayFeatures:[feature]},journal:[],media:[]},lost=structuredClone(expectedProject);
  lost.features[0].checkpointEvidence.photo.state='not_attempted';lost.features[0].photoEvidenceState='not_attempted';
  await assert.rejects(()=>verifyRestoredDayPayload(expectedPayload,{project:lost,journal:[],media:[]}),/checkpoint evidence mismatch/);
});
