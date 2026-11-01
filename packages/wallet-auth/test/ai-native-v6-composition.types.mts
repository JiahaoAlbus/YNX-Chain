import{PRODUCT_SESSION_TASK_RESPONSE_HEADER_V6,type ProductSessionTaskActionV6Unsigned}from'@ynx-chain/wallet-auth/product-session-task-action-v6';import{type OriginalAITaskActionV6SourcePolicy,inspectOriginalAITaskActionV6SourceScopeDATA}from'@ynx-chain/wallet-auth/ai-native-task-action-v6-source-data';import{openOriginalAITaskActionClientV6,type OriginalAITaskActionV6Client}from'@ynx-chain/wallet-auth/original-ai-task-action-v6-client';
const header:'x-ynx-product-session-response-proof-v6'=PRODUCT_SESSION_TASK_RESPONSE_HEADER_V6;declare const request:ProductSessionTaskActionV6Unsigned;declare const policy:OriginalAITaskActionV6SourcePolicy;const opened:Promise<OriginalAITaskActionV6Client>=openOriginalAITaskActionClientV6();
// @ts-expect-error no DTO/provider enters the normal fixed-image getter
openOriginalAITaskActionClientV6({approved:true});
// @ts-expect-error handoff is still unregistered
const action:ProductSessionTaskActionV6Unsigned={...request,action:'task.handoff'};
const d=inspectOriginalAITaskActionV6SourceScopeDATA({},{} ,'','','','',0,1,0);const noNative:false=d.NativeAdmission;void[header,policy,opened,action,noNative];
