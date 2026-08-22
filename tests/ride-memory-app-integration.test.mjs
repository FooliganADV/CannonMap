import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {createPhotoExportService,photoArchiveCategory} from '../src/application/photo-export-service.js';
import {readStoredZip} from '../src/application/portable-zip.js';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');

function functionSource(name){
  const marker=`function ${name}(`,start=app.indexOf(marker);assert.notEqual(start,-1,`${name} must exist`);
  const parameters=app.indexOf('(',start);let parameterDepth=0,parameterQuote=null,parameterEscaped=false,opening=-1;
  for(let index=parameters;index<app.length;index++){
    const character=app[index];
    if(parameterQuote){if(parameterEscaped)parameterEscaped=false;else if(character==='\\')parameterEscaped=true;else if(character===parameterQuote)parameterQuote=null;continue;}
    if(character==='\''||character==='"'||character==='`'){parameterQuote=character;continue;}
    if(character==='(')parameterDepth+=1;else if(character===')'&&--parameterDepth===0){opening=app.indexOf('{',index);break;}
  }
  assert.notEqual(opening,-1,`${name} must have a body`);let depth=0,quote=null,escaped=false;
  for(let index=opening;index<app.length;index++){
    const character=app[index];
    if(quote){if(escaped)escaped=false;else if(character==='\\')escaped=true;else if(character===quote)quote=null;continue;}
    if(character==='\''||character==='"'||character==='`'){quote=character;continue;}
    if(character==='{')depth+=1;else if(character==='}'&&--depth===0)return app.slice(start,index+1);
  }
  throw new Error(`${name} has no closing brace`);
}

test('app composes Ride Memory with the exclusive camera session and accepted-session context',()=>{
  assert.match(app,/createCameraCaptureArbiter/);assert.match(app,/createRideMemoryCaptureService/);assert.match(app,/createRideMemoryStateStore\(\{storage:localStorage\}\)/);
  const initialization=functionSource('initializeMissionControlFoundations'),context=functionSource('rideMemorySessionContext'),status=functionSource('handleRideMemoryState');
  assert.match(initialization,/captureNativeCameraStill\(camera,\{\.\.\.options,cameraSession,scopeToken:preflightScopeKey\(\)\}\)/,'Ride Memory must reuse the existing scoped camera session');
  assert.match(initialization,/cameraReadiness\?\.assertAutomaticCaptureEligible/);assert.match(initialization,/positionProvider:\(\)=>state\.lastGpsPosition/);
  for(const gate of ['acceptedRallySessionId!==session.sessionId','showRallySessionChoice()','showDayPreflight()','rallyScopeSuspended',"rallyDayState(day).status==='complete'"])assert.ok(context.includes(gate),`Ride Memory context must require ${gate}`);
  assert.match(context,/sessionId:session\.sessionId/);assert.match(context,/dayNumber:Number\(day\)/);assert.match(context,/sessionRunNumber:session\.runNumber/);
  assert.match(status,/schedule\?\.persistenceStatus==='failed'/);assert.match(status,/ACTION REQUIRED · Ride Memory schedule is not protected/);
});

test('session lifecycle starts after preflight and drains Ride Memory before scope replacement',()=>{
  const proceed=functionSource('proceedFromDayPreflight'),start=functionSource('startRallyReliabilityServices'),stop=functionSource('stopRallyReliabilityServices'),suspend=functionSource('suspendPendingEvidenceRuntime');
  assert.match(proceed,/await startRallyReliabilityServices\(\{triggerSessionBackup:true\}\)/);
  assert.match(start,/await rideMemoryCapture\?\.start\?\.\(\)/);assert.match(start,/rideMemoryCapture\?\.setInterval/);
  assert.match(stop,/rideMemoryCapture\?\.stop\?\.\(reason\)/);assert.match(stop,/cameraCaptureArbiter\?\.cancelMemory\?\.\(reason\)/);assert.match(stop,/rideMemoryCapture\?\.whenIdle/);
  assert.match(suspend,/const priorReliabilityTask=stopRallyReliabilityServices\(reason\)/);assert.match(suspend,/priorReliabilityTask/);
  for(const transition of ['startNewRallySession','resumeExistingRallySession'])assert.match(functionSource(transition),/await suspendPendingEvidenceRuntime/);
  assert.match(functionSource('finalizeDay'),/rideMemoryCapture\?\.stop\?\.\('day-complete'\)/);
});

test('checkpoint capture has camera priority and only durable finalized media provides memory coverage',()=>{
  const begin=functionSource('beginPhotoWorkflow'),capture=functionSource('captureAutomaticPair'),finalize=functionSource('finalizePendingPhotoCheckpoint');
  assert.ok(begin.indexOf("cameraCaptureArbiter?.cancelMemory?.('checkpoint-workflow-started')")<begin.indexOf('checkpointCamera?.start'),'memory capture must be canceled before checkpoint camera startup');
  assert.match(capture,/cameraCaptureArbiter\?\.runCheckpoint\?cameraCaptureArbiter\.runCheckpoint\(run\)/);assert.match(capture,/signal:controller\.signal/);assert.match(capture,/prioritySignal\?\.addEventListener/);
  const saved=finalize.indexOf('await saveProject(false)'),coverage=finalize.indexOf('rideMemoryCapture?.noteCheckpointCapture?.');assert.ok(saved>=0&&coverage>saved,'coverage must be noted only after pair state is durably saved');
  assert.match(finalize,/result\.sides\.front\.original\.mediaId/);assert.match(finalize,/result\.sides\.rear\.original\.mediaId/);
});

test('reliability startup restores newest durable same-session checkpoint coverage before Ride Memory starts',async()=>{
  const helper=functionSource('restoreRideMemoryCheckpointCoverage'),start=functionSource('startRallyReliabilityServices'),context={projectId:'project',sessionId:'run-2'},calls=[],queries=[];
  const pair=(checkpointId,pairId,capturedAt,{sessionId='run-2',captureType='checkpoint',complete=true,missingRole=null}={})=>[['front','original'],['front','evidence'],['rear','original'],['rear','evidence']].filter(([cameraRole,role])=>`${cameraRole}:${role}`!==missingRole).map(([cameraRole,role],index)=>({mediaId:`${pairId}-${cameraRole}-${role}`,projectId:'project',sessionId,checkpointId,pairId,pairStatus:complete?'complete':'pending',cameraRole,role,capturedAt:new Date(Date.parse(capturedAt)+index).toISOString(),metadata:{sessionId,captureType,objectiveType:captureType,cameraRole,pairId}}));
  const rows=[...pair('cp-old','pair-old','2026-08-20T12:00:00.000Z'),...pair('cp-current','pair-current','2026-08-20T12:05:00.000Z'),...pair('cp-foreign','pair-foreign','2026-08-20T12:10:00.000Z',{sessionId:'run-1'}),...pair('ride-memory:run-2:slot','pair-memory','2026-08-20T12:15:00.000Z',{captureType:'ride_memory'}),...pair('cp-partial','pair-partial','2026-08-20T12:20:00.000Z',{missingRole:'rear:evidence'}),...pair('journey:photo','pair-journey','2026-08-20T12:25:00.000Z',{captureType:'journey'})];
  const result=await runInNewContext(`(${helper.replace(/^function /,'async function ')})(${JSON.stringify(context)})`,{
    missionMedia:{async listProjectSessionPhotos(projectId,sessionId){queries.push({projectId,sessionId});return rows;},async listProjectPhotos(){throw new Error('scoped query should be preferred');}},
    rideMemoryCapture:{noteCheckpointCapture(value){calls.push(value);return value;}},rallyDebug:{record(){}},queries,calls,rows
  });
  assert.deepEqual(queries,[context]);assert.equal(calls.length,2,'startup clears prior-session in-memory coverage before seeding this session');assert.equal(JSON.stringify(calls[0]),JSON.stringify({capturedAt:0,checkpointId:null,mediaIds:[]}));
  assert.equal(result.checkpointId,'cp-current');assert.equal(result.capturedAt,Date.parse('2026-08-20T12:05:00.003Z'));assert.deepEqual([...result.mediaIds].sort(),pair('cp-current','pair-current','2026-08-20T12:05:00.000Z').map(item=>item.mediaId).sort());
  assert.ok(start.indexOf('await restoreRideMemoryCheckpointCoverage(context)')<start.indexOf('await rideMemoryCapture?.start?.()'),'durable coverage is restored before a due scheduler tick can capture a duplicate');
  assert.match(helper,/typeof missionMedia\.listProjectSessionPhotos==='function'/);assert.match(helper,/:await missionMedia\.listProjectPhotos\(context\.projectId\)/);assert.match(helper,/recordSessionId!==sessionId/);assert.match(helper,/captureType==='ride_memory'/);assert.match(helper,/record\.pairStatus!=='complete'/);
});

test('coverage restore falls back to project media without admitting another session',async()=>{
  const helper=functionSource('restoreRideMemoryCheckpointCoverage'),calls=[],sessionId='run-2',rows=[['front','original'],['front','evidence'],['rear','original'],['rear','evidence']].map(([cameraRole,role])=>({mediaId:`current-${cameraRole}-${role}`,sessionId,checkpointId:'cp-current',pairId:'pair-current',pairStatus:'complete',cameraRole,role,capturedAt:'2026-08-20T12:05:00.000Z',metadata:{sessionId,objectiveType:'checkpoint',cameraRole,pairId:'pair-current'}}));
  rows.push(...rows.map(item=>({...item,mediaId:`foreign-${item.cameraRole}-${item.role}`,sessionId:'run-1',checkpointId:'cp-foreign',pairId:'pair-foreign',capturedAt:'2026-08-20T12:30:00.000Z',metadata:{...item.metadata,sessionId:'run-1',pairId:'pair-foreign'}})));
  const result=await runInNewContext(`(${helper.replace(/^function /,'async function ')})({projectId:'project',sessionId:'run-2'})`,{missionMedia:{async listProjectPhotos(){return rows;}},rideMemoryCapture:{noteCheckpointCapture(value){calls.push(value);return value;}},rallyDebug:{record(){}},rows,calls});
  assert.equal(result.checkpointId,'cp-current');assert.ok(result.mediaIds.every(id=>id.startsWith('current-')));assert.equal(calls.length,2);
});

test('Ride Memory remains a separate gallery and archive category',()=>{
  assert.equal(photoArchiveCategory({metadata:{captureType:'ride_memory'}}),'Ride_Memories');
  assert.equal(photoArchiveCategory({metadata:{objectiveType:'ride_memory'}}),'Ride_Memories');
  assert.equal(photoArchiveCategory({checkpointId:'ride-memory:session:slot',metadata:{}}),'Ride_Memories');
  const viewer=functionSource('openPhotoViewer');assert.match(viewer,/objectiveType==='ride_memory'\?'Ride Memories'/);assert.match(viewer,/captureType==='ride_memory'\?'Ride Memory'/);
});

test('Day 8 completion cannot create or activate a Day 0 session',()=>{
  const finalize=functionSource('finalizeDay'),next=functionSource('startNextRallyDay');
  assert.match(finalize,/dayState\.nextDay=checkpoints\.nextRallyDay\(project,day\)/);
  assert.ok(next.indexOf("completed.nextDay=nextDay;if(completed.status!=='complete'||!nextDay)return null")<next.indexOf('startNewRallySession(nextDay'),'zero is terminal before session creation');
  assert.doesNotMatch(next,/startNewRallySession\(0/);
});

test('session Day backup includes Ride Memory bytes and Journal reference without changing checkpoint evidence counts',async()=>{
  const session={schemaVersion:2,sessionId:'run-1',projectId:'project',rallyId:'america-250',dayId:'america-250-day-1',dayNumber:1,calendarDate:'2026-08-20',runNumber:1,status:'active',startedAt:'2026-08-20T12:00:00.000Z',checkpointStates:{},pendingEvidence:{schemaVersion:1,entries:[]}},project={projectId:'project',tripId:'trip',rallyId:'america-250',name:'America 250',features:[{id:'cp-1',type:'checkpoint',day:1,name:'1.1',status:'upcoming',points:10,photoRequired:true}],rallyExecution:{schemaVersion:2,activeSessionId:'run-1',sessions:{'run-1':session},daySessions:{1:['run-1']},days:{1:{status:'active'}}}};
  const record=(mediaId,{role='original',pairId=null,captureType='checkpoint',sessionId='run-1',name=`${mediaId}.jpg`}={})=>({
    mediaId,mediaGroupId:`group-${mediaId}`,projectId:'project',sessionId,checkpointId:captureType==='ride_memory'?`ride-memory:${sessionId}:20260820T130000000Z`:'cp-1',journalEventId:captureType==='ride_memory'?'memory-event':'pair-event',pairId,pairStatus:pairId?'complete':null,cameraRole:'rear',role,pairedMediaId:null,evidenceStatus:captureType==='ride_memory'?'not_required':'complete',name,mimeType:'image/jpeg',capturedAt:'2026-08-20T13:00:01.000Z',blob:new Blob([mediaId],{type:'image/jpeg'}),metadata:{dayNumber:1,sessionId,objectiveType:captureType,captureType,evidenceRequired:captureType!=='ride_memory',scheduledCaptureAt:captureType==='ride_memory'?'2026-08-20T13:00:00.000Z':null,actualCaptureAt:'2026-08-20T13:00:01.000Z'}
  });
  const rows=[record('cp-original',{pairId:'pair-1'}),record('cp-evidence',{role:'evidence',pairId:'pair-1'}),record('memory-original',{captureType:'ride_memory',name:'Day01_RideMemory_20260820_130001-000_Rear_Original.jpg'}),record('other-memory',{captureType:'ride_memory',sessionId:'run-2'})];
  const journal=[
    {eventId:'pair-event',projectId:'project',sessionId:'run-1',eventType:'photo_added',timestamp:'2026-08-20T12:58:00.000Z',references:{sessionId:'run-1',checkpointId:'cp-1',pairId:'pair-1',frontOriginalMediaId:'cp-original'},metadata:{sessionId:'run-1',dayNumber:1,objectiveType:'checkpoint'}},
    {eventId:'memory-event',projectId:'project',sessionId:'run-1',eventType:'ride_memory_captured',timestamp:'2026-08-20T13:00:01.000Z',references:{sessionId:'run-1',rideMemoryId:'slot',mediaId:'memory-original'},attachments:{photos:[{mediaId:'memory-original',uri:'media://memory-original',role:'original',captureType:'ride_memory'}]},metadata:{sessionId:'run-1',dayNumber:1,captureType:'ride_memory',objectiveType:'ride_memory',scheduledCaptureAt:'2026-08-20T13:00:00.000Z',actualCaptureAt:'2026-08-20T13:00:01.000Z'}},
    {eventId:'other-event',projectId:'project',sessionId:'run-2',eventType:'ride_memory_captured',timestamp:'2026-08-20T13:00:01.000Z',references:{sessionId:'run-2',mediaId:'other-memory'},metadata:{sessionId:'run-2',dayNumber:1,captureType:'ride_memory'}}
  ];
  const exporter=createPhotoExportService({repository:{listProjectPhotos:async()=>rows}}),archive=await exporter.dayBackup('project',1,{project,session,journal,exportedAt:new Date('2026-08-20T18:30:12.123Z'),buildIdentity:{applicationVersion:'test',buildId:'samsung',serviceWorkerCacheId:'cache'}}),files=await readStoredZip(archive.blob),manifest=JSON.parse(files['manifest/day-manifest.json']),mediaIndex=JSON.parse(files['manifest/media-index.json']),exportedJournal=JSON.parse(files['journal/Daily_Journal.json']);
  const memory=mediaIndex.find(item=>item.mediaId==='memory-original');
  assert.equal(files['media/Ride_Memories/Day01_RideMemory_20260820_130001-000_Rear_Original.jpg'],'memory-original');
  assert.deepEqual({media:manifest.mediaCount,originals:manifest.originalCount,evidence:manifest.evidenceCount,pairs:manifest.pairCount},{media:3,originals:2,evidence:1,pairs:1});
  assert.deepEqual(exportedJournal.map(event=>event.eventId),['pair-event','memory-event']);assert.equal(memory.archivePath.startsWith('media/Ride_Memories/'),true);assert.equal(memory.evidenceStatus,'not_required');assert.equal(memory.pairId,null);assert.equal(memory.journalEventId,'memory-event');
  assert.equal(manifest.checkpointStates.length,1);assert.deepEqual(manifest.journalEvidenceCounts,{arrival:0,photoIncomplete:0,photoRecovered:0,completed:0},'Ride Memory does not count as checkpoint evidence or completion');
  assert.equal(mediaIndex.some(item=>item.mediaId==='other-memory'),false,'same-day media from another session stays isolated');
});
