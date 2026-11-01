// Original zero-input selector runs first; DATA postprocessing never grants Root.
import{emitReviewedRuntimeImageSource}from'./emit-reviewed-source.mjs';
export async function commissionReviewedRuntimeImageSDK(){
 if(arguments.length)throw Object.assign(new Error('IMAGE_RELEASE_ZERO_INPUT'),{code:'IMAGE_RELEASE_ZERO_INPUT'});
 const receipt=emitReviewedRuntimeImageSource();
 const{postprocessReviewedRuntimeImageSource}=await import('./postprocess-reviewed-source.mjs');
 return postprocessReviewedRuntimeImageSource(receipt);
}
