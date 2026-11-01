// PRIVATE offline build selector, NOT an approval format or runtime provider.
// Exact pins must arrive through the original independent release owner.
// No real approval/channel has been supplied. Runtime ENV/CLI cannot fill it.
const reviewedRuntimeImageBuilds=Object.freeze([]);
export function acquireReviewedRuntimeImageBuild(){
 if(arguments.length||reviewedRuntimeImageBuilds.length!==1)throw Object.assign(Error('AUTH_RUNTIME_IMAGE_ADMISSION_NOT_SUPPLIED'),{code:'AUTH_RUNTIME_IMAGE_ADMISSION_NOT_SUPPLIED'});
 return structuredClone(reviewedRuntimeImageBuilds[0]);
}
