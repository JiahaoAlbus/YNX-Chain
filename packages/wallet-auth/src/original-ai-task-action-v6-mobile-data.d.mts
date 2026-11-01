import type{OriginalAITaskActionV6AgentPublic}from'../native/original-ai-task-action-v6-source-contract.mjs';
/** Intrinsic copy: no iterable/own buffer access. Kind selects fixed existing caps. */
export function captureOriginalAITaskV6MobileBytesDATA(value:unknown,kind:'body'|'member'|'sourceOriginal'):Uint8Array;
export function createOriginalAITaskV6MobileBodyDATA(value:unknown):Readonly<{bodyOriginal:Uint8Array;bodyDigest:string;bodyBytes:string;dataOnly:true;signatureVerified:false;SourceAdmission:false;NativeAdmission:false}>;
/** Primitive canonical originals only, never a JS Source/registration DTO. */
export function inspectOriginalAITaskV6MobileAgentMetadataDATA(agentOriginal:string,expectedOriginal:string,issuedAtMs:number,expiresAtMs:number,atMs:number):Readonly<{agentPublic:OriginalAITaskActionV6AgentPublic;dataOnly:true;signatureVerified:false;registrationVerified:false;SourceAdmission:false;NativeAdmission:false}>;
