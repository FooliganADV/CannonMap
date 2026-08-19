import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPendingEvidenceQueue,isAuthoritativePendingEvidenceArrival,listActivePendingEvidence,listExpiredPendingEvidence,
  pendingEvidenceActionIdentity,pendingEvidenceEntry,pendingEvidenceKey,PENDING_EVIDENCE_ACTION,PENDING_EVIDENCE_STATUS,
  reconcilePendingEvidenceQueue,recordPendingEvidenceAction,resolvePendingEvidence,upsertPendingEvidence
} from '../src/domain/checkpoints/pending-evidence-queue.js';

const at=(minute,day=18)=>`2026-08-${String(day).padStart(2,'0')}T17:${String(minute).padStart(2,'0')}:00.000Z`;
const arrival=(checkpointId,minute=0)=>({
  state:'confirmed',trustworthy:true,source:'gps_capture',arrivalId:`arrival-${checkpointId}`,
  timestamp:at(minute),latitude:38.1+minute/10_000,longitude:-105.2,gpsAccuracyFeet:14
});
const checkpoint=(checkpointId,minute=0,extra={})=>({
  id:checkpointId,name:`1.${checkpointId.at(-1)} Checkpoint`,day:1,photoRequired:true,
  checkpointEvidence:{
    arrival:arrival(checkpointId,minute),
    photo:{required:true,state:'failed',updatedAt:at(minute+1),missingSides:['front','rear']},
    completion:{state:'pending'}
  },
  ...extra
});
const enqueue=(queue,sessionId,checkpointId,minute=0,extra={})=>upsertPendingEvidence(queue,{sessionId,checkpoint:checkpoint(checkpointId,minute,extra)}).queue;

test('stable keys keep two pending checkpoints independent within one session',()=>{
  let queue=createPendingEvidenceQueue();
  queue=enqueue(queue,'session-a','cp-1',0);
  queue=enqueue(queue,'session-a','cp-2',2);
  assert.equal(pendingEvidenceKey('session-a','cp-1'),'session-a::cp-1');
  assert.deepEqual(listActivePendingEvidence(queue,{sessionId:'session-a'}).map(entry=>entry.checkpointId),['cp-1','cp-2']);
  assert.equal(pendingEvidenceEntry(queue,{sessionId:'session-a',checkpointId:'cp-1'}).arrivalId,'arrival-cp-1');
  assert.equal(pendingEvidenceEntry(queue,{sessionId:'session-a',checkpointId:'cp-2'}).arrivalId,'arrival-cp-2');
});

test('reload and checkpoint reconciliation are idempotent and never delete omitted history',()=>{
  const projections=[checkpoint('cp-1',0),checkpoint('cp-2',2)];
  const first=reconcilePendingEvidenceQueue(createPendingEvidenceQueue(),{sessionId:'session-a',checkpoints:projections,at:at(5)});
  assert.equal(first.changed,true);
  const reloaded=createPendingEvidenceQueue(JSON.parse(JSON.stringify(first.queue)));
  const replay=reconcilePendingEvidenceQueue(reloaded,{sessionId:'session-a',checkpoints:projections,at:at(6)});
  assert.equal(replay.changed,false);
  assert.deepEqual(replay.queue,reloaded);
  const partial=reconcilePendingEvidenceQueue(replay.queue,{sessionId:'session-a',checkpoints:[projections[0]],at:at(7)});
  assert.deepEqual(partial.queue.entries.map(entry=>entry.checkpointId),['cp-1','cp-2'],'an omitted projection is retained as history');
  const resolved=resolvePendingEvidence(partial.queue,{sessionId:'session-a',checkpointId:'cp-1',at:at(8)}).queue;
  const stale=reconcilePendingEvidenceQueue(resolved,{sessionId:'session-a',checkpoints:[projections[0]],at:at(9)});
  assert.equal(stale.changed,false,'an older incomplete projection cannot reopen resolved history');
  assert.equal(pendingEvidenceEntry(stale.queue,{sessionId:'session-a',checkpointId:'cp-1'}).status,PENDING_EVIDENCE_STATUS.RESOLVED);
});

test('resolve, fail, and defer affect only the addressed queue entry',()=>{
  let queue=createPendingEvidenceQueue();
  for(const [index,id] of ['cp-1','cp-2','cp-3'].entries())queue=enqueue(queue,'session-a',id,index*2);
  queue=resolvePendingEvidence(queue,{sessionId:'session-a',checkpointId:'cp-1',at:at(10)}).queue;
  queue=recordPendingEvidenceAction(queue,{sessionId:'session-a',checkpointId:'cp-2',action:PENDING_EVIDENCE_ACTION.FAIL,at:at(11),reasonCode:'rider-failed'}).queue;
  queue=recordPendingEvidenceAction(queue,{sessionId:'session-a',checkpointId:'cp-3',action:PENDING_EVIDENCE_ACTION.DEFER,at:at(12),reasonCode:'continue-route'}).queue;
  assert.equal(pendingEvidenceEntry(queue,{sessionId:'session-a',checkpointId:'cp-1'}).status,PENDING_EVIDENCE_STATUS.RESOLVED);
  assert.equal(pendingEvidenceEntry(queue,{sessionId:'session-a',checkpointId:'cp-2'}).status,PENDING_EVIDENCE_STATUS.FAILED);
  assert.equal(pendingEvidenceEntry(queue,{sessionId:'session-a',checkpointId:'cp-3'}).status,PENDING_EVIDENCE_STATUS.DEFERRED);
  assert.deepEqual(listActivePendingEvidence(queue,{sessionId:'session-a'}),[]);
});

test('a complete checkpoint projection resolves one active entry without removing its history',()=>{
  let queue=enqueue(createPendingEvidenceQueue(),'session-a','cp-1');
  queue=enqueue(queue,'session-a','cp-2',2);
  const complete=checkpoint('cp-1',0);
  complete.checkpointEvidence.photo={...complete.checkpointEvidence.photo,state:'complete',updatedAt:at(6),missingSides:[]};
  complete.checkpointEvidence.completion={state:'completed',completedAt:at(6)};
  const reconciled=reconcilePendingEvidenceQueue(queue,{sessionId:'session-a',checkpoints:[complete],at:at(6)});
  assert.equal(reconciled.changed,true);
  assert.equal(pendingEvidenceEntry(reconciled.queue,{sessionId:'session-a',checkpointId:'cp-1'}).status,PENDING_EVIDENCE_STATUS.RESOLVED);
  assert.equal(pendingEvidenceEntry(reconciled.queue,{sessionId:'session-a',checkpointId:'cp-2'}).status,PENDING_EVIDENCE_STATUS.PENDING);
  assert.deepEqual(reconciled.queue.entries.map(entry=>entry.checkpointId),['cp-1','cp-2'],'resolved history remains serialized');
});

test('retry, resume, and continue actions are durable and deterministically idempotent',()=>{
  let queue=enqueue(createPendingEvidenceQueue(),'session-a','cp-1');
  const continued=recordPendingEvidenceAction(queue,{sessionId:'session-a',checkpointId:'cp-1',action:'CONTINUE',at:at(3)});
  assert.equal(continued.entry.status,PENDING_EVIDENCE_STATUS.CONTINUED);
  assert.equal(listActivePendingEvidence(continued.queue,{sessionId:'session-a'}).length,1,'continued evidence remains recoverable');
  const retryInput={sessionId:'session-a',checkpointId:'cp-1',action:'RETRY',at:at(4)};
  const retried=recordPendingEvidenceAction(continued.queue,retryInput),replayed=recordPendingEvidenceAction(retried.queue,retryInput);
  assert.equal(retried.entry.status,PENDING_EVIDENCE_STATUS.PENDING);
  assert.equal(replayed.changed,false);
  assert.equal(replayed.entry.actions.length,2);
  assert.equal(replayed.action.actionId,pendingEvidenceActionIdentity(retryInput));
  const resumed=recordPendingEvidenceAction(replayed.queue,{sessionId:'session-a',checkpointId:'cp-1',action:'RESUME',at:at(5)});
  assert.equal(resumed.entry.actions.length,3);
  assert.equal(resumed.entry.lastAction,'RESUME');
});

test('fallback expiry metadata survives two-minute suspension and reload',()=>{
  const fallbackExpiresAt=at(2),input={sessionId:'session-a',checkpoint:checkpoint('cp-1',0),fallbackExpiresAt};
  const queued=upsertPendingEvidence(createPendingEvidenceQueue(),input).queue;
  assert.equal(listExpiredPendingEvidence(queued,{sessionId:'session-a',now:at(1)}).length,0);
  const reloaded=createPendingEvidenceQueue(JSON.parse(JSON.stringify(queued)));
  const reconciled=reconcilePendingEvidenceQueue(reloaded,{sessionId:'session-a',checkpoints:[checkpoint('cp-1',0)],at:at(3)}).queue;
  assert.equal(pendingEvidenceEntry(reconciled,{sessionId:'session-a',checkpointId:'cp-1'}).fallbackExpiresAt,fallbackExpiresAt);
  assert.deepEqual(listExpiredPendingEvidence(reconciled,{sessionId:'session-a',now:at(3)}).map(entry=>entry.checkpointId),['cp-1']);
});

test('same checkpoint remains isolated across sessions',()=>{
  let queue=createPendingEvidenceQueue();
  queue=enqueue(queue,'session-date-a','cp-1',0);
  queue=enqueue(queue,'session-date-b','cp-1',0);
  const failed=recordPendingEvidenceAction(queue,{sessionId:'session-date-a',checkpointId:'cp-1',action:'FAIL',at:at(8)}).queue;
  assert.equal(pendingEvidenceEntry(failed,{sessionId:'session-date-a',checkpointId:'cp-1'}).status,PENDING_EVIDENCE_STATUS.FAILED);
  assert.equal(pendingEvidenceEntry(failed,{sessionId:'session-date-b',checkpointId:'cp-1'}).status,PENDING_EVIDENCE_STATUS.PENDING);
  assert.deepEqual(listActivePendingEvidence(failed,{sessionId:'session-date-b'}).map(entry=>entry.checkpointId),['cp-1']);
});

test('non-authoritative arrivals cannot enter the pending queue',()=>{
  const good=arrival('cp-1'),fabricated={...good,source:'gps_fabricated'};
  assert.equal(isAuthoritativePendingEvidenceArrival(good),true);
  assert.equal(isAuthoritativePendingEvidenceArrival(fabricated),false);
  const result=upsertPendingEvidence(createPendingEvidenceQueue(),{sessionId:'session-a',checkpointId:'cp-1',arrival:fabricated,photoRequired:true,photoState:'failed'});
  assert.equal(result.changed,false);
  assert.equal(result.reason,'arrival-not-authoritative');
  assert.equal(result.queue.entries.length,0);
});
