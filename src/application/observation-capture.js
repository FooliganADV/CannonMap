import {assessObservationQuality} from '../domain/observations/quality.js';
import {createObservationRecord,normalizePositionSample} from '../domain/observations/contract.js';
import {shouldSuppressSample} from '../domain/observations/sampling.js';
import {transitionCaptureState} from '../domain/observations/state-machine.js';

export const OBSERVATION_CAPTURE_FEATURE_FLAG='architecture.observation.capture';

export function createObservationCapture({clock,featureFlags,persistence,diagnosticLimit=100,samplingPolicy,qualityPolicy}={}){
  if(!clock||!featureFlags||!persistence)throw new TypeError('clock, featureFlags, and persistence are required.');
  let previous=null;
  const diagnostics=[];
  const record=(level,code,details={})=>{
    diagnostics.push(Object.freeze({level,code,at:clock.iso(),...details}));
    if(diagnostics.length>diagnosticLimit)diagnostics.splice(0,diagnostics.length-diagnosticLimit);
  };
  const enabled=()=>featureFlags.isEnabled(OBSERVATION_CAPTURE_FEATURE_FLAG);
  return Object.freeze({
    isEnabled:enabled,
    diagnostics:()=>Object.freeze([...diagnostics]),
    async recover(){
      if(!enabled())return Object.freeze({status:'disabled',pending:0});
      const pending=await persistence.pending();
      record('info','capture-recovered',{pending:pending.length});
      return Object.freeze({status:'ready',pending:pending.length});
    },
    async capture(input,context){
      if(!enabled())return Object.freeze({status:'disabled'});
      let state=transitionCaptureState('idle','assessing');
      const sample=normalizePositionSample(input);
      const quality=assessObservationQuality(sample,{nowMs:clock.now(),policy:qualityPolicy});
      if(quality.classification==='rejected'){
        state=transitionCaptureState(state,'rejected');
        record('warn','sample-rejected',{reasons:quality.reasons});
        transitionCaptureState(state,'idle');
        return Object.freeze({status:'rejected',quality});
      }
      if(shouldSuppressSample(previous,sample,samplingPolicy)){
        state=transitionCaptureState(state,'suppressed');
        record('info','sample-suppressed');
        transitionCaptureState(state,'idle');
        return Object.freeze({status:'suppressed'});
      }
      const now=clock.iso();
      const observation=createObservationRecord({context,sample,quality,now});
      const outboxItem={
        schemaVersion:1,eventId:observation.eventId,idempotencyKey:`observation:${observation.eventId}:${observation.observationId}`,
        observationId:observation.observationId,state:'pending',attempts:0,nextAttemptAt:now,createdAt:now,updatedAt:now
      };
      state=transitionCaptureState(state,'persisting');
      try{
        const result=await persistence.append({observation,outboxItem});
        previous=sample;
        state=transitionCaptureState(state,'persisted');
        record('info',result?.duplicate?'capture-idempotent':'capture-persisted',{observationId:observation.observationId});
        transitionCaptureState(state,'idle');
        return Object.freeze({status:'persisted',observation,duplicate:Boolean(result?.duplicate)});
      }catch(error){
        state=transitionCaptureState(state,'failed');
        record('error','capture-persistence-failed',{name:error?.name||'Error',message:String(error?.message||error).slice(0,200)});
        transitionCaptureState(state,'idle');
        return Object.freeze({status:'failed',error});
      }
    },
    async replay({deliver,maxItems=25}={}){
      if(!enabled())return Object.freeze({status:'disabled',delivered:0});
      if(typeof deliver!=='function')throw new TypeError('deliver is required.');
      const pending=(await persistence.pending()).slice(0,Math.max(0,maxItems));
      let delivered=0;
      for(const item of pending){
        try{
          const receipt=await deliver(item);
          await persistence.acknowledge(item.idempotencyKey,{acknowledgedAt:clock.iso(),receipt});
          delivered++;
        }catch(error){
          record('warn','outbox-delivery-failed',{idempotencyKey:item.idempotencyKey,name:error?.name||'Error'});
          break;
        }
      }
      return Object.freeze({status:'complete',delivered,remaining:pending.length-delivered});
    }
  });
}
