/** Explicit compatibility identifiers, not automatically decoded hex16 IDs. */
export interface LegacyGrantRefV1 {readonly realm:string;readonly tenant:string;readonly kind:string;readonly id:string;readonly rev:string}
export interface GrantBindV1 {readonly bytes:string;readonly sha3_512:string;readonly sha512:string}
export interface GrantToolV1 {readonly id:string;readonly version:string;readonly schema:GrantBindV1}
export interface GrantTargetV1 {readonly service:string;readonly tenant:string;readonly origin:string;readonly path:string;readonly region:string;readonly operation:string}
export interface GrantSessionV1 {readonly id:string;readonly epoch:string;readonly channel:string}
export interface GrantSourceV1 {readonly ref:LegacyGrantRefV1;readonly fields:readonly string[];readonly label:'PUBLIC'|'TENANT'|'RESTRICTED'|'VAULT';readonly binding:GrantBindV1}
export interface GrantStepBindingV1 {
 readonly task:LegacyGrantRefV1;readonly generation:string;readonly stepId:string;readonly input:GrantBindV1;
 readonly tool:GrantToolV1;readonly target:GrantTargetV1;readonly purpose:string;readonly risk:'read'|'write'|'asset';
 readonly holderSession:GrantSessionV1;readonly sources:readonly GrantSourceV1[];
}
export interface BoundGrantV1 {
 readonly version:'AUTH-BOUND-GRANT-PRIVATE/v1';
 /** Newly issued CSPRNG16 represented as canonical lower hex32. Codec checks
  * shape only; it cannot prove randomness or migrate an old grant ID. */
 readonly id:string;readonly realm:string;readonly tenant:string;readonly issuer:LegacyGrantRefV1;readonly issuerEpoch:string;
 readonly holder:LegacyGrantRefV1;readonly holderEpoch:string;readonly audience:string;readonly operation:string;
 readonly resources:readonly LegacyGrantRefV1[];readonly cap:string;readonly singleMax:string;readonly validFrom:string;readonly expires:string;
 readonly nonce:string;readonly rev:string;readonly nonDelegable:true;readonly approvalId:string;readonly binding:GrantStepBindingV1;
}
export declare const BOUND_GRANT_DOMAIN:'YNX-OPEN/BOUND-GRANT/1';
export declare const GRANT_EFFECT_DOMAIN:'YNX-OPEN/GRANT-EFFECT/1';
export declare const BOUND_GRANT_DATA_VERSION:'AUTH-BOUND-GRANT-PRIVATE/v1';
/** Exact shared Auth codec ports; synchronous bytes may also be awaited. */
export declare function encodeBoundGrant(grant:BoundGrantV1):Uint8Array;
export declare function decodeBoundGrant(wire:Uint8Array):BoundGrantV1;
export declare function encodeGrantEffect(grant:BoundGrantV1,step:GrantStepBindingV1):Uint8Array;
export declare function decodeGrantEffect(wire:Uint8Array):Readonly<{grant:BoundGrantV1;step:GrantStepBindingV1}>;

declare const originalProtectedGrantProof:unique symbol;
/** Original Auth-held proof. There is no public proof/issuer constructor. */
export interface OriginalProtectedGrantProof {readonly [originalProtectedGrantProof]:never}
export interface BoundGrantIssuerApprovalV1 {
 readonly id:string;readonly principal:LegacyGrantRefV1;readonly principalKind:'human'|'organization';readonly purpose:'AUTH-GRANT-ISSUE';
 readonly grantId:string;readonly grantRevision:string;readonly binding:GrantBindV1;readonly expires:string;readonly nonce:string;
}
export interface OriginalBoundGrantIssueResult {readonly original:unknown;readonly recoveryOnly:boolean;readonly newGrant:boolean;readonly sourceAdmission:false}
export interface OriginalGrantEffectReceipt {readonly state:'COMMITTED'|'UNKNOWN'|'CONTENT_PRESENT';readonly scope:'same-resource-transaction'|'egress-only';readonly effectRef:string;readonly [key:string]:unknown}
/** Calls already implemented by the original private kernel. No factory or
 * network route is supplied here; the admitted Auth service must own them. */
export interface OriginalBoundGrantAuthorityCalls {
 signBoundGrant(grant:BoundGrantV1,approval:BoundGrantIssuerApprovalV1,issuerProof:OriginalProtectedGrantProof):Promise<OriginalBoundGrantIssueResult>;
 authorizeAtEffect(grant:BoundGrantV1,step:GrantStepBindingV1,holderProof:OriginalProtectedGrantProof,expectedRevision:string):Promise<OriginalGrantEffectReceipt>;
}
/** Required authorized reconciliation selection, NOT an implemented service
 * method. Authority derives the original semantic slot, never requestId or a
 * changed body digest. UNKNOWN must retain reservation and original dispatch. */
export interface BoundGrantAuthorizedReconciliationRequirement {
 readonly realm:string;readonly tenant:string;readonly grantId:string;readonly grantRevision:string;
 readonly task:LegacyGrantRefV1;readonly generation:string;readonly stepId:string;readonly tool:GrantToolV1;readonly operation:string;
}
