declare const reviewBrand:unique symbol,proofBrand:unique symbol;
export type OriginalManagementAbortContextV4=Readonly<{signal:AbortSignal}>;
export type OriginalManagementResultV4<T>=Readonly<{owner:T;errorPresent:false}>|Readonly<{owner:T|null;errorPresent:true;error:unknown}>;
export interface OriginalManagementReviewHandleV4 {readonly[reviewBrand]:never}
export interface OriginalManagementProofHandleV4 {readonly[proofBrand]:never}
export interface OriginalManagementReviewDATAV4 {
 readonly unsigned:string;readonly summary:Readonly<{sourceId:unknown;instanceId:unknown;scope:unknown}>;
 /** Exact fields await original Auth formal ABI. Never an independent Root expectation. */
 readonly binding:Readonly<Record<string,unknown>>;readonly body:Uint8Array;
}
export interface OriginalManagementProofDATAV4 {
 readonly unsigned?:string;readonly member?:Uint8Array;readonly body?:Uint8Array;readonly outcome?:unknown;
 readonly operation?:'active'|'recover'|'revoke'|'cancel';readonly proofHeader?:string;
 readonly signatureMathVerified?:true;readonly independentRegisteredOriginalsMatched?:true;
 readonly dataOnly?:true;readonly RootAdmission?:false;readonly SourceAdmission?:false;readonly NativeAdmission?:false;
}
export interface OriginalProductDeviceV4ManagementClient {
 readOriginalScopeDATA():Readonly<Record<string,unknown>>;
 /** Synchronous envelope. Retain owner before interpreting explicit errorPresent. */
 prepareReview(sameOriginalContext:OriginalManagementAbortContextV4):OriginalManagementResultV4<OriginalManagementReviewHandleV4>;
 /** Uses the internally held SAME Native review, SAME context and one proof attempt. */
 producePreparedProof(sameOriginalContext:OriginalManagementAbortContextV4):Promise<OriginalManagementResultV4<OriginalManagementProofHandleV4>>;
 /** Originals remain readable after failure/retirement for no-replay recovery. */
 readReviewDATA(originalHandle:OriginalManagementReviewHandleV4):OriginalManagementReviewDATAV4|null;
 readProofDATA(originalHandle:OriginalManagementProofHandleV4):OriginalManagementProofDATAV4|null;
 retire():void;
 /** Exact first Promise. Strict proof -> review -> Source retire/join/close; pending join forbids parent close. */
 close():Promise<void>;
 /** Explicitly retry remaining cleanup stages of SAME owners; first close Promise/cause remain unchanged. */
 drainCleanup():Promise<void>;
 statusDATA():Readonly<{reviewSelected:boolean;proofSelected:boolean;retired:boolean;closed:boolean;sourceRetained:boolean;reviewRetained:boolean;proofRetained:boolean;opaqueManagementLeaseRetained:boolean;firstCausePresent:boolean;firstCause:unknown;cleanupFailurePresent:boolean;cleanupFirstCause:unknown;cleanupDebt:boolean;signatureMathVerified:boolean;independentRegisteredOriginalsMatched:boolean;RootAdmission:false;SourceAdmission:false;NativeAdmission:false;connected:false}>;
}
/** Fixed image, zero arguments. Actual Native ABI is declared, not admitted by this type. */
export function openOriginalProductSessionDeviceV4ManagementClient():OriginalManagementResultV4<OriginalProductDeviceV4ManagementClient>;
