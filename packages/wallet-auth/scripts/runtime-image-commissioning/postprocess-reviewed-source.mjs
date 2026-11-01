// Fixed image-receipt adapter only. The materializer is shared with pair CODE.
// Hash agreement is source consistency, never authenticated release approval.
import path from'node:path';import{fileURLToPath}from'node:url';
import{canonical,exact,safe,read,parsed,walk,compare,pin,sha,fail,materializeReviewedSDKSourceDATA}from'../reviewed-sdk-source-materialization/core.mjs';
const SOURCE='src/original-auth-runtime-image-source-v1.js',HELPER='src/original-auth-runtime-image-files-v1.js';
const SOURCE_BEFORE={bytes:12295,sha256:'215bb8b1f3a22e30d80144a6dbd2af6c9c996f6c87c0c19e3fb07c3e39cdff17'},HELPER_BEFORE={bytes:8948,sha256:'a4548297865d4fd1cba55717993f52cd1e97a621063d519163a4b31a11bc481b'};
const recipeFile=fileURLToPath(new URL('./materialization-recipe.json',import.meta.url));
export function postprocessReviewedRuntimeImageSource(receipt){
 exact(receipt,['candidate','status','cas','files','prebuildPlanSHA256','postBuildProfileRequired','RootAdmission','SourceAdmission']);exact(receipt.cas,['path','before','after']);exact(receipt.cas.before,['path','bytes','sha256']);exact(receipt.cas.after,['bytes','sha256']);safe(receipt.candidate,true);
 if(receipt.status!=='REVIEWED_SOURCE_CANDIDATE_NOT_APPROVED_OR_BUILT'||receipt.postBuildProfileRequired!==true||receipt.RootAdmission!==false||receipt.SourceAdmission!==false)fail('IMAGE_POSTPROCESS_NOT_SOURCE_ONLY');
 const candidate=receipt.candidate,metadataPath=candidate+'/PREBUILD_SOURCE.json',metadataRaw=read(metadataPath,16*1024*1024),m=parsed(metadataPath,16*1024*1024),complete=parsed(candidate+'/COMPLETE.json',1048576);
 if(!/^[0-9a-f]{64}$/.test(receipt.prebuildPlanSHA256)||sha(metadataRaw)!==receipt.prebuildPlanSHA256||canonical(complete)!==canonical(receipt)||canonical(m.cas)!==canonical(receipt.cas))fail('IMAGE_POSTPROCESS_RECEIPT_MISMATCH');
 exact(m,['stage','sourceCommit','sourceTree','cas','unchangedFilesHelper','reviewedSource','rootOriginal','enrollmentOriginal','registeredRoleOriginals','registrationWindow','recordLocation','files','tooling','postBuild','truth']);
 if(m.stage!=='PREBUILD_SOURCE_ONLY'||!/^[0-9a-f]{40}$/.test(m.sourceCommit)||!/^[0-9a-f]{40}$/.test(m.sourceTree)||m.truth?.RootAdmission!==false||m.truth?.SourceAdmission!==false||m.truth?.NativeAdmission!==false||m.truth?.approvedRelease!==false||m.postBuild?.profileOrImageHashInOwnSource!==false||m.postBuild?.recordCreatedByEmitter!==false)fail('IMAGE_POSTPROCESS_METADATA');
 const cas=receipt.cas;exact(cas,['path','before','after']);if(cas.path!==SOURCE||cas.before?.path!==SOURCE||cas.before.bytes!==SOURCE_BEFORE.bytes||cas.before.sha256!==SOURCE_BEFORE.sha256||cas.after?.sha256===SOURCE_BEFORE.sha256||!/^[0-9a-f]{64}$/.test(cas.after?.sha256)||!Number.isSafeInteger(cas.after?.bytes)||cas.after.bytes<=0)fail('IMAGE_POSTPROCESS_SINGLE_CAS_REQUIRED');
 if(m.unchangedFilesHelper?.path!==HELPER||m.unchangedFilesHelper.bytes!==HELPER_BEFORE.bytes||m.unchangedFilesHelper.sha256!==HELPER_BEFORE.sha256)fail('IMAGE_POSTPROCESS_HELPER_PIN');
 const source=candidate+'/source-package';safe(source,true);const rows=walk(source),map=new Map(rows.map(r=>[r.path,r]));if(!Number.isSafeInteger(receipt.files)||rows.length!==receipt.files||!Array.isArray(m.files)||m.files.length!==rows.length)fail('IMAGE_POSTPROCESS_SOURCE_SET');
 const seen=new Set();for(const row of m.files){if(typeof row.path!=='string'||!row.path.startsWith('source-package/'))fail('IMAGE_POSTPROCESS_SOURCE_SET');const rel=row.path.slice(15);if(seen.has(rel))fail('IMAGE_POSTPROCESS_SOURCE_SET');seen.add(rel);compare(row,map.get(rel));}compare(cas.after,map.get(SOURCE));compare(HELPER_BEFORE,map.get(HELPER));
 // The actual emitter enforced original review selection and <=30s snapshot
 // lifetime before completion. This adapter never extends or recreates it.
 const w=m.registrationWindow;exact(w,['notBeforeMs','expiresAtMs']);if(!Number.isSafeInteger(w.notBeforeMs)||!Number.isSafeInteger(w.expiresAtMs)||w.expiresAtMs<=w.notBeforeMs||w.expiresAtMs-w.notBeforeMs>30000)fail('IMAGE_POSTPROCESS_REGISTRATION_WINDOW');
 const result=materializeReviewedSDKSourceDATA({sourceRoot:source,sourceIdentity:{baseCommit:m.sourceCommit,baseTree:m.sourceTree,emitterSourceCandidateSHA256:receipt.prebuildPlanSHA256,family:'runtime-image'},changedSourcePins:[cas],outputRoot:candidate+'/sdk-postprocessed',recipeFile,metadataPath,metadataSHA256:receipt.prebuildPlanSHA256});
 return Object.freeze({...result,status:'SDK_RUNTIME_IMAGE_POSTPROCESS_REVIEW_ONLY'});
}
