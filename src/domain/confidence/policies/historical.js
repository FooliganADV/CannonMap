import {evidencePolicy} from '../policy-helpers.js';
export const historicalPolicy=evidencePolicy({name:'historical',policyId:'historical-corroboration',reinforcementStep:0.06,contradictionStep:0.08,method:'long-lived-historical-evidence'});
