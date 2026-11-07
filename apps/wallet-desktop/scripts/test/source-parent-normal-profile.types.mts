import {materializeSourceParentNormalProfileDATA,encodeSourceParentNormalProfileModuleDATA,type SourceParentNormalProfileBuildInput} from '../source-parent-normal-profile.mjs';const input:SourceParentNormalProfileBuildInput={sourceRoot:'/normal/build',profileOriginal:'original',independentOriginal:'independent'};const out=materializeSourceParentNormalProfileDATA(input);const images:readonly [string,string,string]=out.images;const neverRoot:false=out.RootAdmission;const noQualification:false=out.qualifiedRuntimeResource;const moduleSource:string=encodeSourceParentNormalProfileModuleDATA(input);void images;void neverRoot;void noQualification;void moduleSource;
// @ts-expect-error no public caller expected pin or profile setter
materializeSourceParentNormalProfileDATA({...input,approved:true});
// @ts-expect-error cannot infer genuine Root from verified DATA facts
const qualified:true=out.RootAdmission;
