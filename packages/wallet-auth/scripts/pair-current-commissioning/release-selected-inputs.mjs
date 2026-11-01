// PRIVATE offline build inputs, never an approval or runtime setter.
const reviewedCurrentReleaseInputs=Object.freeze([]);
export function acquireReviewedCurrentReleaseInputs(){if(arguments.length||reviewedCurrentReleaseInputs.length!==1)throw Object.assign(Error('PAIR_V4_SOURCE_NOT_CONFIGURED'),{code:'PAIR_V4_SOURCE_NOT_CONFIGURED'});return structuredClone(reviewedCurrentReleaseInputs[0]);}
