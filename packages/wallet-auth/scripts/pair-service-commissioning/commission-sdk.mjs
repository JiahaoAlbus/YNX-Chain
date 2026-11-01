// Fixed original offline owner selection only; no CLI/ENV injection.
import{emitReviewedPairServiceSource}from'./emit-reviewed-source.mjs';
import{postprocessReviewedPairServiceSource}from'./postprocess-reviewed-source.mjs';
export function commissionReviewedPairServiceSDK(){if(arguments.length)throw Object.assign(new Error('PAIR_RELEASE_ZERO_INPUT'),{code:'PAIR_RELEASE_ZERO_INPUT'});return postprocessReviewedPairServiceSource(emitReviewedPairServiceSource());}
