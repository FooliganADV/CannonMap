import {deterministicId,inferCommitment as runCommitmentEngine} from './generated/commitment/index.js';

const values=snapshot=>snapshot?.val?.()||snapshot||null;
const list=value=>Array.isArray(value)?value.filter(Boolean):Object.values(value||{});

export function createInferCommitmentHandler({repository,clock=()=>Date.now(),engine=runCommitmentEngine}={}){
  if(!repository)throw new TypeError('repository is required.');
  return async function handle({eventId,observation}={}){
    const competitorId=String(observation?.competitorId||observation?.riderId||'');
    if(!eventId||!competitorId||!observation?.observationId)return Object.freeze({status:'ignored',reason:'missing-trigger-context'});
    const [observations,checkpoints]=await Promise.all([
      repository.recentValidatedObservations({eventId,competitorId,since:clock()-10*60*1000}),
      repository.checkpoints(eventId)
    ]);
    const results=checkpoints.map(checkpoint=>engine({eventId,competitorId,checkpoint,observations,nowMs:clock()}));
    const inferred=results.filter(result=>result.status==='inferred').sort((left,right)=>
      right.inference.confidenceDimensions.evidenceStrength.score-left.inference.confidenceDimensions.evidenceStrength.score
      ||left.inference.checkpointId.localeCompare(right.inference.checkpointId)
    );
    const traceId=inferred[0]?.inference.traceId||deterministicId('trace',[eventId,competitorId,observation.observationId,'insufficient']);
    if(!inferred.length){
      await repository.diagnostic({schemaVersion:1,eventId,competitorId,traceId,status:'insufficient-evidence',evaluatedAt:new Date(clock()).toISOString(),checkpointCount:checkpoints.length,observationCount:observations.length,shadowMode:true});
      return Object.freeze({status:'insufficient-evidence',traceId});
    }
    const selected=inferred[0];
    const persistence=await repository.persistShadow({inference:selected.inference,evidence:selected.evidence});
    await repository.diagnostic({schemaVersion:1,eventId,competitorId,traceId,status:'inferred',inferenceId:selected.inference.inferenceId,evaluatedAt:new Date(clock()).toISOString(),shadowMode:true});
    return Object.freeze({status:'inferred',replayed:persistence.replayed,inference:selected.inference});
  };
}

export function createRealtimeCommitmentRepository(database){
  return Object.freeze({
    async recentValidatedObservations({eventId,competitorId,since}){
      const records=list(values(await database.ref(`validatedObservations/${eventId}`).get()));
      return records.filter(record=>(record.competitorId===competitorId||record.riderId===competitorId)&&Number(record.occurredAt)>=since);
    },
    async checkpoints(eventId){
      const primary=values(await database.ref(`events/${eventId}/checkpoints`).get());
      const fallback=primary||values(await database.ref(`checkpointGeometry/${eventId}`).get());
      return list(fallback).map((checkpoint,index)=>({
        ...checkpoint,
        checkpointId:String(checkpoint.checkpointId||checkpoint.id||index)
      }));
    },
    async persistShadow({inference,evidence}){
      for(const item of evidence){
        let created=false;
        await database.ref(`evidenceLedger/${item.eventId}/${item.evidenceId}`).transaction(current=>{
          if(current)return;
          created=true;
          return item;
        });
        if(!created){
          const existing=values(await database.ref(`evidenceLedger/${item.eventId}/${item.evidenceId}`).get());
          if(JSON.stringify(existing)!==JSON.stringify(item))throw new Error(`Immutable evidence collision: ${item.evidenceId}`);
        }
      }
      const path=`commitmentInferences/${inference.eventId}/${inference.competitorId}/${inference.inferenceId}`;
      let created=false;
      await database.ref(path).transaction(current=>{
        if(current)return;
        created=true;
        return inference;
      });
      if(!created){
        const existing=values(await database.ref(path).get());
        if(existing?.traceId!==inference.traceId||existing?.checkpointId!==inference.checkpointId)throw new Error(`Commitment inference identity collision: ${inference.inferenceId}`);
      }
      const headRef=database.ref(`commitmentInferenceHeads/${inference.eventId}/${inference.competitorId}/${inference.checkpointId}`);
      const priorId=values(await headRef.get());
      const updates={[`commitmentInferenceHeads/${inference.eventId}/${inference.competitorId}/${inference.checkpointId}`]:inference.inferenceId};
      if(priorId&&priorId!==inference.inferenceId){
        updates[`commitmentInferences/${inference.eventId}/${inference.competitorId}/${priorId}/supersededBy`]=inference.inferenceId;
        updates[`commitmentInferences/${inference.eventId}/${inference.competitorId}/${priorId}/active`]=false;
        updates[`commitmentInferences/${inference.eventId}/${inference.competitorId}/${inference.inferenceId}/supersedes`]=priorId;
      }
      await database.ref().update(updates);
      return Object.freeze({replayed:!created});
    },
    diagnostic(record){
      return database.ref(`commitmentDiagnostics/${record.eventId}/${record.traceId}`).set(record);
    }
  });
}
