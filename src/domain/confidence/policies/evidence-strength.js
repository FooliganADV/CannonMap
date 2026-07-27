import {evidencePolicy} from '../policy-helpers.js';
export const evidenceStrengthPolicy=evidencePolicy({name:'evidenceStrength',policyId:'evidence-independent-corroboration',reinforcementStep:0.15,contradictionStep:0.22,method:'independent-corroboration'});
