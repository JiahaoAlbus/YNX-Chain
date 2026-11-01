import {emitReviewedRuntimeImageSource} from './emit-reviewed-source.mjs';
if(process.argv.length!==2)throw Error('IMAGE_RELEASE_ZERO_INPUT');
try{console.log(JSON.stringify(emitReviewedRuntimeImageSource()));}catch(e){console.error(JSON.stringify({code:e.code??'IMAGE_RELEASE_FAILED',partial:e.partial??null}));process.exitCode=65;}
