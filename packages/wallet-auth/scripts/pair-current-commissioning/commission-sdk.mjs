// Fixed build-admin Node entry: no caller/ENV provider or dynamic reviewed row.
import {emitStableReviewedPairCurrentSource} from './emit-stable-reviewed-source.mjs';
import {postprocessStableReviewedPairCurrentSource} from './postprocess-reviewed-source.mjs';
export function commissionStableReviewedPairCurrentSDK(){if(arguments.length)throw Object.assign(Error('PAIR_STABLE_ZERO_INPUT'),{code:'PAIR_STABLE_ZERO_INPUT'});return postprocessStableReviewedPairCurrentSource(emitStableReviewedPairCurrentSource());}
