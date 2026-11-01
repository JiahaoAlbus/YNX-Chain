export const ORIGINAL_WALLET_SERVICE_ROLE_PURPOSE: 'wallet-product-session-v2-admission-publisher/v1';
export const ORIGINAL_WALLET_SERVICE_ROLE_RECEIPT_DOMAIN: 'YNX_WALLET_SERVICE_ROLE_ENROLLMENT_RECEIPT_V1\n';
export const ORIGINAL_WALLET_SERVICE_ROLE_STATE_MAX_BYTES: 16384;
export interface OriginalServiceRoleRootAnchor { rootId:string; rootKeyId:string; publicKey:string; purpose:typeof ORIGINAL_WALLET_SERVICE_ROLE_PURPOSE }
/** Secret-bearing: only original Vault catalog AEAD plaintext, never IPC/public JSON. */
export interface OriginalServiceRoleHolderCustody { publicKey:string; privateKeyPKCS8:string }
export interface OriginalServiceRoleReview {
  version:'ynx-wallet-service-role-enrollment-review/v1'; purpose:typeof ORIGINAL_WALLET_SERVICE_ROLE_PURPOSE;
  service:'wallet-product-session-v2'; productId:'developer'; platform:'macos'; gatewayOrigin:'https://wallet-auth.ynxweb4.com';
  registryDigest:string; targetConsumerManifestDigest:string; gatewayManifestDigest:string;
  rootId:string; rootKeyId:string; holderPublicKey:string; operationId:string; nonce:string; issuedAt:number; expiresAt:number;
}
export interface OriginalServiceRoleReceipt { body:Omit<OriginalServiceRoleReview,'version'> & {version:'ynx-wallet-service-role-enrollment-receipt/v1';decision:'approved'|'revoked';reviewDigest:string;roleExpiresAt:number};signature:string }
export interface OriginalServiceRoleOperation { review:OriginalServiceRoleReview; state:'pending'|'UNKNOWN'|'approved'|'revoked' }
export interface OriginalServiceRoleHistory { operationId:string; observedAt:number; receipt:OriginalServiceRoleReceipt }
export interface OriginalServiceRoleEnrollmentState { version:1;holder:OriginalServiceRoleHolderCustody|null;rootAnchor:OriginalServiceRoleRootAnchor|null;operations:OriginalServiceRoleOperation[];history:OriginalServiceRoleHistory[] }
export interface OriginalServiceRolePublicReadback { version:1;holderPublicKey:string|null;rootAnchor:OriginalServiceRoleRootAnchor|null;operations:OriginalServiceRoleOperation[];history:OriginalServiceRoleHistory[] }
export interface OriginalServiceRoleMutation {state:OriginalServiceRoleEnrollmentState;readOnly:boolean}
export interface OriginalServiceRoleEnrollmentCodec {
  readonly rootAnchor:Readonly<OriginalServiceRoleRootAnchor>;
  begin(state:unknown,review:unknown):OriginalServiceRoleMutation;
  recordUnknown(state:unknown,operationId:string):OriginalServiceRoleEnrollmentState;
  recordApproved(state:unknown,operationId:string,receipt:unknown):OriginalServiceRoleMutation;
  /** Revocation is a new independently signed operation; never a caller status toggle. */
  recordRevoked(state:unknown,operationId:string,receipt:unknown):OriginalServiceRoleMutation;
  /** Historical signature validation at observedAt, without re-consuming/renewing. */
  assertStored(state:unknown):OriginalServiceRoleEnrollmentState;
  /** Metadata verification only. This does not implement existing publisher role/current authority. */
  assertApproved(state:unknown):{holderPublicKey:string;rootAnchor:OriginalServiceRoleRootAnchor;receipt:OriginalServiceRoleReceipt;reviewDigest:string};
}
export function emptyOriginalWalletServiceRoleEnrollmentState():OriginalServiceRoleEnrollmentState;
export function parseOriginalWalletServiceRoleEnrollmentState(raw:unknown):OriginalServiceRoleEnrollmentState;
/** No key generation; caller must have explicit user consent before original Vault creates custody. */
export function initializeOriginalWalletServiceRoleHolder(state:unknown,custody:unknown):OriginalServiceRoleEnrollmentState;
export function prepareOriginalWalletServiceRoleEnrollmentReview(raw:unknown):OriginalServiceRoleReview;
export function publicOriginalWalletServiceRoleEnrollmentReadback(state:unknown):OriginalServiceRolePublicReadback;
export function assertOriginalWalletServiceRoleEnrollmentCodec(value:unknown):OriginalServiceRoleEnrollmentCodec;
export function createOriginalWalletServiceRoleEnrollmentCodec(config:{rootAnchor:OriginalServiceRoleRootAnchor;registryDigest:string;targetConsumerManifestDigest:string;gatewayManifestDigest:string;now:()=>number}):OriginalServiceRoleEnrollmentCodec;
