// PRIVATE offline RELEASE BUILD selection, NOT a Root approval format or grant.
// Only the original independent release owner may supply reviewed source pins
// through its existing source-review channel. No ENV/CLI/runtime JSON setter.
// That exact authenticated channel has not been supplied: deliberately empty.
const reviewedReleaseInputs=Object.freeze([]);
export function acquireReviewedReleaseBuildInputs(){
 if(arguments.length||reviewedReleaseInputs.length!==1)throw Object.assign(Error('PAIR_V4_SOURCE_NOT_CONFIGURED'),{code:'PAIR_V4_SOURCE_NOT_CONFIGURED'});
 return structuredClone(reviewedReleaseInputs[0]);
}
