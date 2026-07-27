import {evidencePolicy} from '../policy-helpers.js';
export const inferencePolicy=evidencePolicy({name:'inference',policyId:'inference-support',reinforcementStep:0.1,contradictionStep:0.2,method:'inference-support-evidence'});
