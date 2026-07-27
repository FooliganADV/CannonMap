import {qualityPolicy} from './quality.js';
import {evidenceStrengthPolicy} from './evidence-strength.js';
import {inferencePolicy} from './inference.js';
import {historicalPolicy} from './historical.js';
import {currentPolicy} from './current.js';
import {recencyPolicy} from './recency.js';
import {stabilityPolicy} from './stability.js';

export const M9_DIMENSION_POLICIES=Object.freeze({
  quality:qualityPolicy,evidenceStrength:evidenceStrengthPolicy,inference:inferencePolicy,
  historical:historicalPolicy,current:currentPolicy,recency:recencyPolicy,stability:stabilityPolicy
});
export {qualityPolicy,evidenceStrengthPolicy,inferencePolicy,historicalPolicy,currentPolicy,recencyPolicy,stabilityPolicy};
