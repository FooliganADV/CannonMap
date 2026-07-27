import {evidencePolicy} from '../policy-helpers.js';
export const qualityPolicy=evidencePolicy({name:'quality',policyId:'quality-source-assessment',reinforcementStep:0.12,contradictionStep:0.2,method:'source-quality-evidence'});
