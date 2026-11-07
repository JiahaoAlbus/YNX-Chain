import type {OriginalAITaskActionV6Context} from './original-ai-task-action-v6-client.js';
export interface OriginalAITaskV6MobileAbortDATA {readonly original:OriginalAITaskActionV6Context;readonly signal:AbortSignal;readonly add:AbortSignal['addEventListener'];readonly remove:AbortSignal['removeEventListener'];}
/** Plain JS getters/Proxy may execute; this snapshot has no Native/Source brand. */
export declare function captureOriginalAITaskV6MobileAbortDATA(value:unknown):OriginalAITaskV6MobileAbortDATA;
export declare function captureOriginalAITaskV6MobileIntentDATA(value:unknown):Readonly<{snapshotString:string;operationId:string;abort:OriginalAITaskV6MobileAbortDATA;dataOnly:true;SourceAdmission:false;NativeAdmission:false}>;
