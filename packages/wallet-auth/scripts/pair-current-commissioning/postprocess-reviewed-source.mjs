// Stable Root-current pair adapter. Not the old RootV2 two-CAS receipt grammar.
// One shared materializer is reused; this module grants no runtime capability.
import {fileURLToPath} from 'node:url';
import {canonical,exact,safe,read,parsed,walk,compare,pin,sha,fail,materializeReviewedSDKSourceDATA} from '../reviewed-sdk-source-materialization/core.mjs';
const CAS=['src/product-pair-session-v4-source.js','src/root-current-v3/root-read-current-owner-v3.mjs'];
const recipeFile=fileURLToPath(new URL('./materialization-recipe.json',import.meta.url));
export function postprocessStableReviewedPairCurrentSource(receipt){
 exact(receipt,['stage','target','sourceCommit','sourceTree','cas','stablePlanSHA256','finiteCheckpointCompiled','RootAdmission','SourceAdmission','requiresSDKWholeManifestAndNativeRebuild','requiresIndependentActualProducerRegistration']);
 if(receipt.stage!=='STABLE_REVIEWED_SOURCE_CANDIDATE_ONLY'||receipt.RootAdmission!==false||receipt.SourceAdmission!==false||receipt.finiteCheckpointCompiled!==false||receipt.requiresSDKWholeManifestAndNativeRebuild!==true||receipt.requiresIndependentActualProducerRegistration!==true)fail('PAIR_CURRENT_NOT_SOURCE_ONLY');
 if(!/^[a-f0-9]{40}$/.test(receipt.sourceCommit)||!/^[a-f0-9]{40}$/.test(receipt.sourceTree)||!/^[a-f0-9]{64}$/.test(receipt.stablePlanSHA256))fail('PAIR_CURRENT_IDENTITY');
 if(!Array.isArray(receipt.cas)||receipt.cas.length!==2)fail('PAIR_CURRENT_TWO_CAS_REQUIRED');
 const seen=new Set();for(const row of receipt.cas){exact(row,['path','before','after']);if(!CAS.includes(row.path)||seen.has(row.path))fail('PAIR_CURRENT_TWO_CAS_REQUIRED');seen.add(row.path);for(const key of ['before','after']){exact(row[key],['bytes','sha256']);if(!Number.isSafeInteger(row[key].bytes)||row[key].bytes<=0||!/^[a-f0-9]{64}$/.test(row[key].sha256))fail('PAIR_CURRENT_CAS');}if(row.before.sha256===row.after.sha256)fail('PAIR_CURRENT_CAS');}
 const candidate=safe(receipt.target,true),metadataPath=candidate+'/COMPLETE.json',raw=read(metadataPath,1048576),complete=parsed(metadataPath,1048576);if(canonical(receipt)!==canonical(complete))fail('PAIR_CURRENT_RECEIPT_MISMATCH');
 const source=safe(candidate+'/source-package',true);for(const row of receipt.cas)compare(row.after,pin(source+'/'+row.path));
 const result=materializeReviewedSDKSourceDATA({sourceRoot:source,sourceIdentity:{baseCommit:receipt.sourceCommit,baseTree:receipt.sourceTree,emitterSourceCandidateSHA256:sha(raw),family:'pair-service'},changedSourcePins:receipt.cas,outputRoot:candidate+'/sdk-postprocessed',recipeFile,metadataPath,metadataSHA256:sha(raw)});
 return Object.freeze({...result,status:'SDK_STABLE_PAIR_CURRENT_POSTPROCESS_REVIEW_ONLY',finiteCheckpointCompiled:false,stablePlanSHA256:receipt.stablePlanSHA256});
}
