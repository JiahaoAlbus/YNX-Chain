import{createOriginalAITaskV6MobileBodyDATA,inspectOriginalAITaskV6MobileAgentMetadataDATA,captureOriginalAITaskV6MobileBytesDATA}from'../src/original-ai-task-action-v6-mobile-data.mjs';import{createOriginalAITaskV6MobileCustodyDATA}from'../src/original-ai-task-action-v6-mobile-custody.mjs';import{openOriginalAITaskActionClientV6}from'../src/original-ai-task-action-v6-mobile.mjs';
const d=createOriginalAITaskV6MobileBodyDATA(new Uint8Array([1]));const noSource:false=d.SourceAdmission;const q=createOriginalAITaskV6MobileCustodyDATA(),noNative:false=q.read().NativeAdmission;
// @ts-expect-error no arbitrary cap expansion
captureOriginalAITaskV6MobileBytesDATA(new Uint8Array(), 'unbounded');
// @ts-expect-error canonical primitive original required, no JS registration DTO
inspectOriginalAITaskV6MobileAgentMetadataDATA({},'{}',0,1,0);
// @ts-expect-error controller is not Source/Native qualification
const source:true=q.read().SourceAdmission;
// @ts-expect-error no provider or fabricated Root injection
openOriginalAITaskActionClientV6({approved:true});
void[noSource,noNative,source];
