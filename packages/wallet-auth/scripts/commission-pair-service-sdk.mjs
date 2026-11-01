import{commissionReviewedPairServiceSDK}from'./pair-service-commissioning/commission-sdk.mjs';
if(process.argv.length!==2)throw Object.assign(new Error('PAIR_RELEASE_ZERO_INPUT'),{code:'PAIR_RELEASE_ZERO_INPUT'});
try{console.log(JSON.stringify(commissionReviewedPairServiceSDK()));}catch(e){console.error(JSON.stringify({code:e.code??'PAIR_SDK_POSTPROCESS_FAILED',partial:e.partial??null}));process.exitCode=65;}
