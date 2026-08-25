import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {inspectStoredZip} from '../../src/application/portable-zip.js';
import {readStoredDayPackage} from '../../src/application/journey-package-restore.js';

const photo=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const feature=(id,name,type,sequence)=>({id,name,type,day:9,sequence,status:'planned',photoRequirement:'required',visible:true,geometry:{kind:'point',coordinates:[{lat:30+sequence/100,lon:-90}]}});
const payload={format:'CannonMap Project',settings:{dayFilter:'all'},project:{projectId:'field-export-day-nine',name:'Field Export Day 9',features:[feature('cp','9.1 Checkpoint','checkpoint',1),feature('hotel','9.2 Hotel','hotel',2)],competitors:[]}};

async function proceedPastReadiness(page){
  const preflight=page.locator('#rallyDayPreflight');
  if(await preflight.isVisible()){
    await expect(page.locator('#rallyDayPreflightOverall')).not.toHaveText('CHECKING');
    await expect(page.locator('#rallyDayPreflightDegraded')).toBeEnabled();
    await page.locator('#rallyDayPreflightDegraded').click();
    await expect(preflight).toBeHidden();
  }
  if(await page.locator('#rallyCameraSetup').isVisible()){
    await page.locator('#rallyCameraContinueManualButton').click();
    await expect(page.locator('#rallyCameraSetup')).toBeHidden();
  }
}
async function load(page){await page.goto('/?e2e=field-export-day-nine');await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');await page.locator('#projectInput').setInputFiles({name:'field.cmap',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(payload))});await expect(page.locator('#status')).toContainText('Opened field.cmap');await page.evaluate(()=>{const day=document.getElementById('dayFilter');day.value='9';day.dispatchEvent(new Event('change',{bubbles:true}));});await expect(page.locator('#rallyDay')).toHaveText('Day 9');await proceedPastReadiness(page);}
async function capture(page,{checkpointId,latitude,observedAt,name}){
  await page.evaluate(({checkpointId,latitude,observedAt})=>{
    window.CannonMapTest.setAutomaticCameraCaptureForTest(()=>{throw new Error('field-export test uses the manual fallback');});
    window.CannonMapTest.setGpsPositionForTest({lat:latitude,lon:-90,speedMph:5,accuracyFeet:8,time:new Date(observedAt).toISOString()});
    const detections=[{checkpointId,distanceFeet:3,accuracyFeet:8,radiusFeet:100}];
    window.CannonMapTest.observeCheckpointDetectionsForTest({observedAt,speedMph:5,priorTargetId:checkpointId,gpsEvidence:{latitude,longitude:-90,accuracyFeet:8,sampleTimestamp:new Date(observedAt).toISOString()},detections});
    window.CannonMapTest.observeCheckpointDetectionsForTest({observedAt:observedAt+3000,speedMph:5,priorTargetId:checkpointId,gpsEvidence:{latitude,longitude:-90,accuracyFeet:8,sampleTimestamp:new Date(observedAt+3000).toISOString()},detections});
  },{checkpointId,latitude,observedAt});
  await expect(page.locator('#rallyCameraWorkflow')).toBeVisible();
  await page.locator('#rallyCameraInput').setInputFiles({name,mimeType:'image/png',buffer:photo});
  await page.evaluate(()=>window.CannonMapTest.awaitFieldMediaIdle());
  await expect(page.locator('#rallyCameraWorkflow')).toBeHidden();
}

test('finalized Day 9 exports verified photos, Journal, restorable backup, and Journey manifest from an explicitly selected active day',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='iPhone 13 portrait');await load(page);await capture(page,{checkpointId:'cp',latitude:30.01,observedAt:10_000,name:'checkpoint.png'});await expect(page.locator('#rallyNextName')).toContainText('Hotel');await capture(page,{checkpointId:'hotel',latitude:30.02,observedAt:20_000,name:'hotel.png'});await expect(page.locator('#rallyDayComplete')).toBeVisible();
  const before=await page.evaluate(async()=>({media:await window.CannonMapTest.missionMediaRecords(),events:await window.CannonMapTest.missionControlJournalEvents()}));expect(before.media).toHaveLength(8);expect(before.media.filter(item=>item.name.includes('_Hotel')).every(item=>item.metadata.objectiveType==='hotel')).toBeTruthy();expect(before.events.some(event=>event.eventType==='checkpoint_arrival')).toBeTruthy();expect(before.events.some(event=>event.eventType==='photo_added'&&event.metadata.objectiveType==='hotel')).toBeTruthy();expect(before.events.some(event=>event.eventType==='hotel_arrival')).toBeTruthy();expect(before.events.some(event=>event.eventType==='day_finished')).toBeTruthy();
  for(let index=0;index<3;index++)await page.evaluate(()=>window.CannonMapTest.evaluateCheckpointArrival(10));const failures=await page.evaluate(()=>window.CannonMapTest.rallyDebugEntries().filter(entry=>entry.type==='objective_selection_failed'&&entry.reason==='day-complete'));expect(failures).toHaveLength(0);
  await page.locator('#rallyBackupToday').click();let pending=page.waitForEvent('download');await page.locator('#rallyBackupDayPhotos').click();const photos=await pending,photoBytes=await readFile(await photos.path()),entries=await inspectStoredZip(new Blob([photoBytes])),mediaEntries=entries.filter(entry=>entry.name!=='manifest/photo-media-index.json');expect(photos.suggestedFilename()).toMatch(/^CannonMap_FieldExportDay9_D09_Run01_\d{4}-\d{2}-\d{2}_\d{6}-\d{3}_Photos\.zip$/);expect(entries).toHaveLength(9);expect(mediaEntries).toHaveLength(8);expect(entries.filter(entry=>entry.name==='manifest/photo-media-index.json')).toHaveLength(1);expect(entries.every(entry=>entry.size>0)).toBeTruthy();expect(mediaEntries.filter(entry=>entry.name.startsWith('Hotels/'))).toHaveLength(4);
  pending=page.waitForEvent('download');await page.locator('#rallyBackupDayJournal').click();const journal=await pending,journalEvents=JSON.parse(await readFile(await journal.path(),'utf8'));expect(journal.suggestedFilename()).toMatch(/^CannonMap_FieldExportDay9_D09_Run01_\d{4}-\d{2}-\d{2}_\d{6}-\d{3}_Journal\.json$/);expect(journalEvents.length).toBeGreaterThan(4);expect(journalEvents.some(event=>event.eventType==='checkpoint_arrival')).toBeTruthy();expect(journalEvents.some(event=>event.eventType==='photo_added')).toBeTruthy();expect(journalEvents.some(event=>event.eventType==='hotel_arrival')).toBeTruthy();expect(journalEvents.some(event=>event.eventType==='day_finished')).toBeTruthy();
  pending=page.waitForEvent('download');await page.locator('#rallyBackupDayPackage').click();const backup=await pending,backupBytes=await readFile(await backup.path()),restorable=await readStoredDayPackage(new Blob([backupBytes]));expect(backup.suggestedFilename()).toMatch(/^CannonMap_FieldExportDay9_D09_Run01_\d{4}-\d{2}-\d{2}_\d{6}-\d{3}_Backup\.cmapday\.zip$/);expect(restorable.manifest.mediaCount).toBe(8);expect(restorable.journal.length).toBeGreaterThan(4);expect(restorable.media.filter(item=>item.metadata.objectiveType==='hotel')).toHaveLength(4);const stages=await page.evaluate(()=>window.CannonMapTest.rallyDebugEntries().map(entry=>entry.type).filter(type=>type.startsWith('backup_')));expect(stages).toEqual(expect.arrayContaining(['backup_started','backup_project_resolved','backup_day_resolved','backup_journal_loaded','backup_media_indexed','backup_manifest_created','backup_zip_created','backup_verified','backup_download_requested','backup_completed']));
  await page.locator('#rallyBackupClose').click();await page.locator('#rallyMoreButton').click();await page.locator('#rallyPhotoViewerButton').click();pending=page.waitForEvent('download');await page.locator('#rallyExportJourneyPhotos').click();const manifestDownload=await pending,journeyManifest=JSON.parse(await readFile(await manifestDownload.path(),'utf8'));expect(journeyManifest.projects).toHaveLength(1);expect(journeyManifest.projects[0]).toMatchObject({projectId:'field-export-day-nine',projectName:'Field Export Day 9',originalPhotoCount:4,evidencePhotoCount:4,dayCount:1,completedState:true});
});
