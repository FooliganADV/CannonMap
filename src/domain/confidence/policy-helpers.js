export const clamp=value=>Number(Math.max(0,Math.min(1,value)).toFixed(6));
export const exponentialDecay=(value,elapsedMs,halfLifeMs)=>clamp(value*Math.pow(0.5,elapsedMs/halfLifeMs));

export function evidencePolicy({name,policyId,reinforcementStep,contradictionStep,decayHalfLifeMs=null,method='dimension-specific-evidence'}){
  return Object.freeze({
    name,policyId,policyVersion:1,method,methodVersion:1,
    constants:Object.freeze({reinforcementStep,contradictionStep,decayHalfLifeMs}),
    evolve({priorValue,evidence,elapsedMs}){
      let value=priorValue;
      let decayBasis=null,reinforcementBasis=null,changeReason='no-qualifying-evidence';
      if(value!==null&&decayHalfLifeMs!==null&&elapsedMs>0){
        value=exponentialDecay(value,elapsedMs,decayHalfLifeMs);
        decayBasis=Object.freeze({elapsedMs,halfLifeMs:decayHalfLifeMs});
        changeReason='elapsed-time-decay';
      }
      const reinforcing=evidence.filter(item=>item.kind==='reinforce');
      const contradictory=evidence.filter(item=>item.kind==='contradict');
      const direct=evidence.filter(item=>item.kind==='set'&&Number.isFinite(item.value));
      if(direct.length){
        value=clamp(direct.at(-1).value);
        reinforcementBasis=Object.freeze({kind:'direct',evidenceCount:direct.length});
        changeReason='direct-dimension-evidence';
      }
      if(reinforcing.length){
        const base=value??0;
        value=clamp(base+reinforcementStep*reinforcing.length*(1-base));
        reinforcementBasis=Object.freeze({kind:'corroboration',evidenceCount:reinforcing.length,step:reinforcementStep});
        changeReason='reinforcing-evidence';
      }
      if(contradictory.length){
        const base=value??0;
        value=clamp(base-contradictionStep*contradictory.length);
        reinforcementBasis=Object.freeze({kind:'contradiction',evidenceCount:contradictory.length,step:contradictionStep});
        changeReason='contradictory-evidence';
      }
      return Object.freeze({value,changeReason,decayBasis,reinforcementBasis});
    }
  });
}

export function recencyPolicy({halfLifeMs}){
  return Object.freeze({
    name:'recency',policyId:'recency-evidence-age',policyVersion:1,method:'latest-relevant-evidence-age',methodVersion:1,
    constants:Object.freeze({halfLifeMs}),
    evolve({priorValue,priorDimension,evidence,nowMs}){
      const priorLatest=priorDimension?.decayBasis?.latestEvidenceAt;
      if(!evidence.length&&!Number.isInteger(priorLatest))return Object.freeze({value:priorValue,changeReason:'no-relevant-freshness-evidence',decayBasis:null,reinforcementBasis:null});
      const latest=Math.max(...evidence.map(item=>item.occurredAt),Number.isInteger(priorLatest)?priorLatest:0);
      const ageMs=nowMs-latest;
      if(ageMs<0)throw new RangeError('Evidence timestamp cannot be later than evaluation time.');
      return Object.freeze({value:exponentialDecay(1,ageMs,halfLifeMs),changeReason:evidence.length?'relevant-evidence-age':'elapsed-time-decay',decayBasis:Object.freeze({ageMs,halfLifeMs,latestEvidenceAt:latest}),reinforcementBasis:null});
    }
  });
}
