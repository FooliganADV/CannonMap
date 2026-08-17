import {test,expect} from '@playwright/test';

test('Day backup persists degraded checkpoint evidence, Journal, and partial media through clean IndexedDB restore',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='iPhone 13 portrait');
  await page.goto('/');
  const result=await page.evaluate(async suffix=>{
    const infra=await import('/src/infrastructure/indexeddb/index.js'),exports=await import('/src/application/photo-export-service.js'),restoreModule=await import('/src/application/journey-package-restore.js'),open=name=>infra.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:()=>true},databaseName:name}),projectId=`evidence-${suffix}`,pairId='pair-degraded',checkpointEvidence={
      schemaVersion:1,
      arrival:{state:'confirmed',arrivalId:'arrival-1',journalEventId:'arrival-event',checkpointId:'cp-1',objectiveId:'cp-1',objectiveType:'checkpoint',dayId:'day-1',dayNumber:1,timestamp:'2026-08-17T14:00:00.000Z',latitude:38.1,longitude:-105.4,gpsAccuracyFeet:10,speedMph:25,motionState:'moving',heading:90,sampleTimestamp:'2026-08-17T14:00:00.000Z',sampleAgeMs:0,source:'gps_capture',offline:true,background:false,interruptionContext:null,trustworthy:true},
      photo:{required:true,state:'partial',pairId,pairJournalEventId:'pair-event',reasonCode:'rear-only',failureReason:null,missingSides:['front'],mediaReferences:{rearOriginalMediaId:'rear-original',rearEvidenceMediaId:'rear-evidence'},updatedAt:'2026-08-17T14:00:02.000Z'},
      completion:{state:'pending',completedAt:null,pointsAwarded:0,legacyCompletionWithoutRequiredPhoto:false}
    },feature={id:'cp-1',name:'1.4 BLVD',type:'checkpoint',day:1,status:'photo_required',points:10,scoreAwarded:0,photoRequired:true,arrivedAt:'2026-08-17T14:00:00.000Z',arrivalState:'confirmed',photoEvidenceState:'partial',finalCompletionState:'pending',pendingPhotoPair:{pairId,pairJournalEventId:'pair-event',status:'partial'},checkpointEvidence},project={projectId,id:projectId,name:'Offline Day',features:[feature],rallyExecution:{days:{1:{status:'active',score:0}}}},journal=[
      {eventId:'arrival-event',projectId,eventType:'checkpoint_arrival',timestamp:'2026-08-17T14:00:00.000Z',references:{checkpointId:'cp-1'},metadata:{dayNumber:1,arrivalEvidence:checkpointEvidence.arrival}},
      {eventId:'incomplete-event',projectId,eventType:'checkpoint_photo_evidence_incomplete',timestamp:'2026-08-17T14:00:02.000Z',references:{checkpointId:'cp-1',pairId},metadata:{dayNumber:1,photoEvidenceState:'partial',pointsWithheld:true}}
    ],media=['original','evidence'].map(role=>({mediaId:`rear-${role}`,projectId,checkpointId:'cp-1',journalEventId:'pair-event',pairId,pairStatus:'pending',cameraRole:'rear',role,pairedMediaId:`rear-${role==='original'?'evidence':'original'}`,name:`rear-${role}.jpg`,mimeType:'image/jpeg',metadata:{dayNumber:1,objectiveType:'checkpoint',pairId,cameraRole:'rear'},blob:new Blob([`rear-${role}`],{type:'image/jpeg'})}));
    const sourceDb=await open(`evidence-source-${suffix}`),sourceRepository=infra.createJourneyRestoreRepository({database:sourceDb});await sourceRepository.restoreNew({project,journal,media});
    const archive=await exports.createPhotoExportService({repository:infra.createMissionMediaRepository({database:sourceDb,createId:()=>'',clock:{iso:()=>''}})}).dayBackup(projectId,1,{project,journal});sourceDb.close();
    const targetDb=await open(`evidence-target-${suffix}`),targetRepository=infra.createJourneyRestoreRepository({database:targetDb}),restored=await restoreModule.createJourneyPackageRestoreService({repository:targetRepository}).restoreDay(archive.blob),day=await targetRepository.readDay(projectId,1),bytes=await Promise.all(day.media.map(item=>item.blob.text()));targetDb.close();
    return {manifest:restored.manifest,verification:restored.verification,feature:day.project.features[0],journal:day.journal,media:day.media.map(({blob,binaryData,...item})=>item),bytes};
  },`${testInfo.project.name}-${Date.now()}`);
  expect(result.verification).toMatchObject({verified:true,score:0,journalEventCount:2,mediaCount:2});
  expect(result.manifest.checkpointStates[0]).toMatchObject({arrivalState:'confirmed',photoEvidenceState:'partial',finalCompletionState:'pending',pointsAwarded:0,pairId:'pair-degraded'});
  expect(result.feature.checkpointEvidence).toMatchObject({arrival:{state:'confirmed',trustworthy:true},photo:{state:'partial',missingSides:['front']},completion:{state:'pending',pointsAwarded:0}});
  expect(result.journal.map(event=>event.eventType)).toEqual(['checkpoint_arrival','checkpoint_photo_evidence_incomplete']);
  expect(result.media).toHaveLength(2);expect(result.media.every(item=>item.pairId==='pair-degraded'&&item.cameraRole==='rear')).toBeTruthy();expect(result.bytes.sort()).toEqual(['rear-evidence','rear-original']);
});
