import{startOriginalAITaskActionClientV6NodeLoadV1,isOriginalAITaskActionClientV6ModuleImportDATA,captureOriginalAITaskActionClientV6LoaderBindingV1}from'../src/original-ai-task-action-v6-node-loader-private.js';
import type{OriginalAITaskV6NodeBootstrapNativeABIPrivate,OriginalAITaskV6BootstrapPartialErrorPrivate,OriginalAITaskV6NodeAcquisitionOutcomePrivate}from'../src/original-ai-task-action-v6-client-private.js';
const attempt=startOriginalAITaskActionClientV6NodeLoadV1({PUBLIC_ONLY:true});const noGrant:false=attempt.statusDATA().SourceAdmission;void noGrant;
// @ts-expect-error caller URI/provider cannot enter fixed helper
startOriginalAITaskActionClientV6NodeLoadV1({},'file:///caller');
// @ts-expect-error fixed capture has zero arguments
captureOriginalAITaskActionClientV6LoaderBindingV1({provider:()=>true});
// @ts-expect-error same-owner/same-namespace evidence is exactly two arguments
isOriginalAITaskActionClientV6ModuleImportDATA({});
const falsy:OriginalAITaskV6NodeAcquisitionOutcomePrivate={owner:null,errorPresent:true,error:false};
// @ts-expect-error explicit flag must be boolean
const badFlag:OriginalAITaskV6NodeAcquisitionOutcomePrivate={owner:null,errorPresent:'false'};
// @ts-expect-error acquisition is synchronous, never Promise assimilation
const asyncAcquire:OriginalAITaskV6NodeBootstrapNativeABIPrivate['acquireOriginalAITaskActionClientV6Source']=async()=>({owner:null,errorPresent:false});
declare const partial:OriginalAITaskV6BootstrapPartialErrorPrivate;const kept:unknown=partial.cause,hasError:true=partial.errorPresent,cleanup:true=partial.cleanupOnly;partial.bootstrap.join();partial.bootstrap.close();void[falsy,badFlag,asyncAcquire,kept,hasError,cleanup];
