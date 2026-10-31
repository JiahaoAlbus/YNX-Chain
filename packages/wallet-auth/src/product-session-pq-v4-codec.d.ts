import type {ProductSessionRequestV4,ProductSessionV4} from './index.js';
import type {ProductSessionAccountPolicyObservation} from './product-session-account-policy.js';
import type {VerifiedPQProductSessionApproval,ProductSessionAccountAuthorization} from './product-session-pq-approval.js';
declare const originalV4AccountPlan:unique symbol;
/** Opaque Main account plan; not a user permission, Source or custody grant. */
export interface PQProductSessionApprovalV4SigningPlan {readonly [originalV4AccountPlan]:never}
export function preparePQProductSessionApprovalV4(registry:unknown,request:ProductSessionRequestV4,input:Readonly<{account:string;expiresAt:string}>,policy:ProductSessionAccountPolicyObservation,registrationOriginal:Uint8Array,at?:Date):PQProductSessionApprovalV4SigningPlan;
/** Exact public DATA shapes of the existing v4 codec. These types carry no
 * original Source/Native brand, key, approval or signing capability. */
export type ProductSessionApprovalUnsignedV4 = Readonly<
 Omit<ProductSessionRequestV4,'purpose'|'issuedAt'|'expiresAt'> & {
  result:'approved';requestDigest:string;account:string;
  accountAuthorization:ProductSessionAccountAuthorization;issuedAt:string;expiresAt:string;
 }>;
export type ProductSessionApprovalV4 = Readonly<ProductSessionApprovalUnsignedV4 & {walletProof:string}>;
export type ProductSessionDeviceChallengeV4 = Readonly<
 Omit<ProductSessionRequestV4,'purpose'> & {
  account:string;accountAuthorization:ProductSessionAccountAuthorization;
  challenge:string;requestDigest:string;approvalDigest:string;sessionExpiresAt:string;
 }>;
export type ProductSessionDeviceCompletionV4 = Readonly<{
 challenge:ProductSessionDeviceChallengeV4;deviceMember:string;
}>;
export interface PreparedProductSessionApprovalV4Data {
 readonly unsigned:ProductSessionApprovalUnsignedV4;readonly message:Uint8Array;
 readonly purpose:'PRODUCT-SESSION-APPROVAL';readonly dataOnly:true;
 readonly SourceAdmission:false;readonly NativeAdmission:false;readonly approval:false;
}
export const PRODUCT_SESSION_APPROVAL_DOMAIN_V4:'YNX-PRODUCT-SESSION-APPROVAL/v4';
export const PRODUCT_SESSION_DEVICE_CHALLENGE_DOMAIN_V4:'YNX-PRODUCT-SESSION-DEVICE-CHALLENGE/v4';
export const PRODUCT_SESSION_DEVICE_REGISTRATION_DOMAIN_V4:'YNX-PRODUCT-SESSION-DEVICE-REGISTRATION/v4';
export function prepareProductSessionApprovalV4Data(registry:unknown,request:ProductSessionRequestV4,input:Readonly<{account:string;expiresAt:string}>,policy:ProductSessionAccountPolicyObservation,registrationOriginal:Uint8Array,at?:Date):Readonly<PreparedProductSessionApprovalV4Data>;
export function verifyProductSessionApprovalV4Data(registry:unknown,request:ProductSessionRequestV4,approval:unknown,policy:ProductSessionAccountPolicyObservation,registrationOriginal:Uint8Array,at?:Date):Readonly<{approval:ProductSessionApprovalV4;verifiedApproval:VerifiedPQProductSessionApproval;signatureVerified:true;dataOnly:true;NativeAdmission:false;SourceAdmission:false}>;
export function encodeProductSessionDeviceChallengeV4Message(challenge:unknown,registrationOriginal:Uint8Array):Uint8Array;
export function verifyProductSessionDeviceChallengeV4Data(challenge:unknown,registrationOriginal:Uint8Array,member:Uint8Array,at?:Date):Readonly<{signatureVerified:true;dataOnly:true;registered:false;current:false;NativeAdmission:false;SourceAdmission:false}>;
export function verifyProductSessionV4CompletionData(registry:unknown,request:ProductSessionRequestV4,approval:unknown,completion:Readonly<{challenge:unknown;deviceMember:string}>,policy:ProductSessionAccountPolicyObservation,registrationOriginal:Uint8Array,at?:Date):Readonly<{session:ProductSessionV4;dataOnly:true;registered:false;authorized:false;nativeAdmission:false}>;
export function encodeProductSessionDeviceRegistrationV4Message(registrationOriginal:Uint8Array):Uint8Array;
export function verifyProductSessionDeviceRegistrationProofV4Data(registrationOriginal:Uint8Array,member:Uint8Array,at?:Date):Readonly<{signatureVerified:true;dataOnly:true;registered:false;current:false;NativeAdmission:false;SourceAdmission:false}>;

/** Actual original SQLite operation terminal_ms values, not now/observation
 * or caller-provided authority. All four originals are canonical UTF8 strings. */
export interface StoredProductSessionV4IssueOriginalInputDATA {
 readonly pairInputOriginal:string;readonly completeInputOriginal:string;
 readonly sessionOriginal:string;readonly challengeOriginal:string;
 readonly pairCommittedAtMs:number;readonly completeCommittedAtMs:number;
}
export interface StoredProductSessionV4IssueOriginalDATA {
 readonly version:'4';readonly originals:Readonly<StoredProductSessionV4IssueOriginalInputDATA>;
 readonly pairOperationId:string;readonly completeOperationId:string;
 readonly pairRequest:ProductSessionRequestV4;readonly request:ProductSessionRequestV4;
 readonly pairApproval:ProductSessionApprovalV4;readonly completionApproval:ProductSessionApprovalV4;
 readonly registration:import('./product-session-device-registration-v4.js').ProductSessionDeviceRegistrationV4;
 readonly registrationDigest:string;readonly registrationOriginal:string;
 readonly challenge:ProductSessionDeviceChallengeV4;readonly session:ProductSessionV4;
 readonly pairAccountAuthorization:ProductSessionAccountAuthorization;readonly completionAccountAuthorization:ProductSessionAccountAuthorization;
 readonly signatureVerified:true;readonly accountApprovalsVerified:2;readonly registrationPoPVerified:true;readonly deviceCompletionVerified:true;
 readonly timeBasis:'original-signatures-and-store-commits-only';readonly historical:true;readonly dataOnly:true;
 readonly SourceAdmission:false;readonly RootAdmission:false;readonly NativeAdmission:false;readonly nativeAdmission:false;
 readonly authorized:false;readonly registered:false;readonly current:false;readonly newSession:false;readonly connected:false;
}
/** Historical mathematics only: no policyRef/current/provider/callback/clock
 * input, no fabricated observation, no capability or issuer registration. */
export function inspectStoredProductSessionV4IssueOriginalDATA(registry:unknown,input:StoredProductSessionV4IssueOriginalInputDATA):Readonly<StoredProductSessionV4IssueOriginalDATA>;
