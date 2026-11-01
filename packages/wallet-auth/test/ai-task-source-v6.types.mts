import{AI_NATIVE_TASK_ACTION_V6_OPERATIONS,inspectOriginalAITaskActionV6SourceScopeDATA,type OriginalAITaskActionV6SourcePolicy,type OriginalAITaskActionV6SourceScope,type OriginalAITaskActionV6Operation}from'../native/original-ai-task-action-v6-source-contract.mjs';import{inspectOriginalAITaskActionV6SourceIssuanceBodyDATA,verifyOriginalAuthSourceProfileV2}from'../native/original-auth-identity-source-v2-verifier.mjs';
declare const policy:OriginalAITaskActionV6SourcePolicy;declare const scope:OriginalAITaskActionV6SourceScope;
const operation:OriginalAITaskActionV6Operation='task.propose-tool-step';
// @ts-expect-error handoff has no supplied actual body contract
const handoff:OriginalAITaskActionV6Operation='task.handoff';
// @ts-expect-error native client cannot silently borrow server release platform
const wrongRole:OriginalAITaskActionV6SourcePolicy={...policy,sourceRole:'client',platform:'linux'};
// @ts-expect-error missing release platform must never default GOOS
const noPlatform:OriginalAITaskActionV6SourcePolicy={rootDigest:'x',enrollmentDigest:'x',endpoint:'https://wallet-auth.ynxweb4.com/v1/auth-identity/source-current',spki:'x',signatureContract:{purpose:'x',enrollmentFrame:'e',profileFrame:'p',currentFrame:'c'},applicationId:'com.ynxweb4.ai',productId:'ai',sourceRole:'client'};
const data=inspectOriginalAITaskActionV6SourceScopeDATA(scope,{},'x','x','x','x',0,1,0);const noSource:false=data.SourceAdmission;const noNative:false=data.NativeAdmission;
// @ts-expect-error math DATA is never current
const current:true=data.current;
void[operation,handoff,wrongRole,noPlatform,noSource,noNative,current,verifyOriginalAuthSourceProfileV2,inspectOriginalAITaskActionV6SourceIssuanceBodyDATA,AI_NATIVE_TASK_ACTION_V6_OPERATIONS];
