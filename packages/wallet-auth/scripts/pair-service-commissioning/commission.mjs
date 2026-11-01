import {emitReviewedPairServiceSource} from './emit-reviewed-source.mjs';
if(process.argv.length!==2)throw Object.assign(Error('PAIR_RELEASE_ZERO_INPUT'),{code:'PAIR_RELEASE_ZERO_INPUT'});
try{console.log(JSON.stringify(emitReviewedPairServiceSource()));}catch(e){console.error(JSON.stringify({code:e.code??'PAIR_RELEASE_FAILED',partial:e.partial??null}));process.exitCode=65;}
