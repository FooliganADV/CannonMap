import {recencyPolicy as createRecencyPolicy} from '../policy-helpers.js';
export const recencyPolicy=createRecencyPolicy({halfLifeMs:7200000});
