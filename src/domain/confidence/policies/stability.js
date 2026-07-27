import {evidencePolicy} from '../policy-helpers.js';
export const stabilityPolicy=evidencePolicy({name:'stability',policyId:'stability-consistency',reinforcementStep:0.08,contradictionStep:0.25,method:'repeated-consistency'});
