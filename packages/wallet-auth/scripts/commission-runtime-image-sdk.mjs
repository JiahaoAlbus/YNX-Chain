import{commissionReviewedRuntimeImageSDK}from'./runtime-image-commissioning/commission-sdk.mjs';
if(process.argv.length!==2){console.error(JSON.stringify({code:'IMAGE_RELEASE_ZERO_INPUT',partial:null}));process.exitCode=65;}
else try{console.log(JSON.stringify(await commissionReviewedRuntimeImageSDK()));}catch(e){console.error(JSON.stringify({code:e.code??'IMAGE_RELEASE_FAILED',partial:e.partial??null}));process.exitCode=65;}
