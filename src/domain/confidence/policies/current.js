import {evidencePolicy} from '../policy-helpers.js';
export const currentPolicy=evidencePolicy({name:'current',policyId:'current-evidence-decay',reinforcementStep:0.14,contradictionStep:0.22,decayHalfLifeMs:21600000,method:'current-evidence-with-decay'});
