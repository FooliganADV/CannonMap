import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONSERVATIVE_PAIRED_CAPTURE_BYTES,
  PREFERRED_MISSION_MEDIA_BUDGET_BYTES,
  createMissionStorageService,
  formatPreferredMissionMediaBudget
} from '../src/application/mission-storage-service.js';

const pairedRecords=({projectId='mission',pairId='pair-1',size=100,capturedAt='2026-08-13T12:00:00Z'}={})=>[
  ['front','original'],['front','evidence'],['rear','original'],['rear','evidence']
].map(([cameraRole,role],index)=>({mediaId:`${pairId}-${index}`,projectId,pairId,pairStatus:'complete',cameraRole,role,size,capturedAt}));

test('10 GB is a preferred planning budget and actual browser quota remains distinct',async()=>{
  const records=pairedRecords(),snapshot=structuredClone(records);
  const service=createMissionStorageService({mediaRepository:{listAllPhotos:async()=>records},storageManager:{estimate:async()=>({usage:200,quota:1000}),persisted:async()=>true}});
  const result=await service.estimate('mission');
  assert.equal(result.preferredMissionMediaBudgetBytes,PREFERRED_MISSION_MEDIA_BUDGET_BYTES);
  assert.equal(result.preferredBudget.kind,'preferred-not-guaranteed');
  assert.equal(result.actualUsageBytes,200);
  assert.equal(result.actualQuotaBytes,1000);
  assert.equal(result.actualRemainingBytes,800);
  assert.equal(result.browserStorage.quotaBytes,1000);
  assert.equal(result.persistence.status,'granted');
  assert.deepEqual(records,snapshot,'estimation must not mutate or purge media');
  assert.equal(formatPreferredMissionMediaBudget(result.preferredMissionMediaBudgetBytes),'10 GB');
});

test('remaining capture estimate models a complete four-asset camera pair',async()=>{
  const records=[...pairedRecords({pairId:'older',size:75,capturedAt:'2026-08-12T12:00:00Z'}),...pairedRecords({pairId:'newer',size:125,capturedAt:'2026-08-13T12:00:00Z'})];
  const service=createMissionStorageService({
    mediaRepository:{listAllPhotos:async()=>records},
    storageManager:{estimate:async()=>({usage:0,quota:1250})},
    settingsProvider:()=>({mediaPairedCaptureFallbackBytes:1,preferredMissionMediaBudgetBytes:10_000})
  });
  const result=await service.estimate('mission');
  assert.equal(result.pairCount,2);
  assert.equal(result.recentCompleteCaptureGroupCount,2);
  assert.equal(result.recentAveragePairSize,400);
  assert.equal(result.recentMaximumPairSize,500);
  assert.equal(result.estimatedPairedCaptureBytes,500);
  assert.equal(result.effectiveRemainingMediaBytes,1250);
  assert.equal(result.estimatedRemainingCapturePairs,2);
  assert.equal(result.estimatedRemainingCaptures,2,'legacy field is a logical paired-capture count');
});

test('incomplete media groups are ignored and conservative fallback is used',async()=>{
  const incomplete=pairedRecords().slice(0,3);
  const service=createMissionStorageService({mediaRepository:{listAllPhotos:async()=>incomplete},storageManager:{estimate:async()=>({usage:0,quota:CONSERVATIVE_PAIRED_CAPTURE_BYTES*2})}});
  const result=await service.estimate('mission');
  assert.equal(result.pairCount,0);
  assert.equal(result.recentCaptureGroupSampleSource,'fallback');
  assert.equal(result.estimatedPairedCaptureBytes,CONSERVATIVE_PAIRED_CAPTURE_BYTES);
  assert.equal(result.estimatedRemainingCapturePairs,2);
});

test('persistence request reports granted state without requesting twice',async()=>{
  let requested=0,persisted=false;
  const service=createMissionStorageService({mediaRepository:{listAllPhotos:async()=>[]},storageManager:{estimate:async()=>({}),persisted:async()=>persisted,persist:async()=>{requested++;persisted=true;return true;}}});
  assert.equal((await service.persistenceStatus()).status,'not-granted');
  const first=await service.requestPersistence();
  assert.equal(first.status,'granted');
  assert.equal(first.requested,true);
  const second=await service.requestPersistence();
  assert.equal(second.status,'granted');
  assert.equal(second.requested,false);
  assert.equal(requested,1);
});

test('unsupported and rejected storage APIs fail safely without media mutation',async()=>{
  const records=pairedRecords(),snapshot=structuredClone(records);
  const unsupported=createMissionStorageService({mediaRepository:{listAllPhotos:async()=>records},storageManager:{}});
  const unsupportedEstimate=await unsupported.estimate('mission');
  assert.equal(unsupportedEstimate.actualQuotaBytes,null);
  assert.equal(unsupportedEstimate.storageEstimateSupported,false);
  assert.equal(unsupportedEstimate.estimatedRemainingCapturePairs,null,'preferred 10 GB target must not masquerade as actual capacity');
  assert.ok(unsupportedEstimate.preferredBudgetEstimatedRemainingCapturePairs>0);
  assert.equal(unsupportedEstimate.persistence.status,'unsupported');
  assert.equal((await unsupported.requestPersistence()).status,'unsupported');

  const rejected=createMissionStorageService({mediaRepository:{listAllPhotos:async()=>records},storageManager:{estimate:()=>{throw new Error('estimate denied');},persisted:async()=>false,persist:async()=>{throw new Error('persist denied');}}});
  const rejectedEstimate=await rejected.estimate('mission');
  assert.equal(rejectedEstimate.storageEstimateError,'estimate denied');
  const persistence=await rejected.requestPersistence();
  assert.equal(persistence.status,'error');
  assert.equal(persistence.error,'persist denied');
  assert.deepEqual(records,snapshot);
});
