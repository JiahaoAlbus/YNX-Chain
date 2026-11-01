/** Independent expected selection from actual Auth registered device/current
 * and original operation. Public DATA never establishes that provenance. */
export interface PendingOriginalQueryE13Expected {readonly networkId:string;readonly canonicalOwner:string;readonly pkA:string;readonly pkB:string;readonly actorDigest:string;readonly serviceOrigin:string;readonly nonce:string;readonly issuedAt:string;readonly expiresAt:string;readonly atMs:number;readonly sourceIssuedAtMs:number;readonly sourceExpiresAtMs:number}
export interface PendingOriginalQueryE13Input {readonly queryOriginal:Uint8Array;readonly registrationOriginal:Uint8Array;readonly originalPairPost:Uint8Array;readonly expected:PendingOriginalQueryE13Expected}
export interface PendingOriginalQueryE13DATA {readonly version:'1';readonly purpose:'product-device-pending-original-query-v1';readonly operationId:string;readonly actorDigest:string;readonly originalRequestBodyDigest:string;readonly queryBodyDigest:string;readonly messageOriginal:Uint8Array;readonly queryOriginal:Uint8Array;readonly registrationOriginal:Uint8Array;readonly signatureVerified:boolean;readonly originalPostVerified:boolean;readonly dataOnly:true;readonly RootAdmission:false;readonly SourceAdmission:false;readonly NativeAdmission:false;readonly registered:false;readonly current:false;readonly authorized:false;readonly connected:false;readonly newSession:false;readonly retryAuthorized:false}
export const PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_E13_DOMAIN:'YNX/PRODUCT-PAIR/PENDING-ORIGINAL-QUERY/V1';
export const PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_E13_PURPOSE:'product-device-pending-original-query-v1';
export const PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_E13_MESSAGE_MAX_BYTES:16384;
export const PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_E13_MEMBER_MAX_BYTES:98304;
export function encodeProductPairPendingOriginalQueryMessageDATA(input:PendingOriginalQueryE13Input):Uint8Array;
export function inspectProductPairPendingOriginalQueryMessageDATA(messageOriginal:Uint8Array,input:PendingOriginalQueryE13Input):Readonly<PendingOriginalQueryE13DATA&{signatureVerified:false;originalPostVerified:true}>;
export function inspectRegisteredProductPairPendingOriginalQueryN1DATA(memberOriginal:Uint8Array,input:PendingOriginalQueryE13Input):Readonly<PendingOriginalQueryE13DATA&{signatureVerified:true;originalPostVerified:true;memberCount:1;memberIndex:0}>;

export type PendingOriginalQueryE13EnvelopeInput=Readonly<Omit<PendingOriginalQueryE13Input,'originalPairPost'>>;
/** Pre-lookup stage, never a substitute for full post-lookup original binding. */
export function inspectRegisteredProductPairPendingOriginalQueryEnvelopeN1DATA(memberOriginal:Uint8Array,input:PendingOriginalQueryE13EnvelopeInput):Readonly<PendingOriginalQueryE13DATA&{signatureVerified:true;originalPostVerified:false;memberCount:1;memberIndex:0}>;
export const PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_PROOF_HEADER_V1:'x-ynx-product-pair-original-query-proof-v1';
export const PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_PROOF_HEADER_MAX_CHARS_V1:131072;
export function encodeProductPairPendingOriginalQueryProofHeaderV1(memberOriginal:Uint8Array):string;
export function decodeProductPairPendingOriginalQueryProofHeaderV1(header:string):Uint8Array;

/** Untrusted extraction intentionally does NOT return network/owner/pair as
 * independent expected. Returned originals are only untrusted candidates. */
export interface PendingOriginalQueryClaimsDATA {readonly version:'1';readonly purpose:'product-device-pending-original-query-v1';readonly nonce:string;readonly issuedAt:string;readonly expiresAt:string;readonly operationId:string;readonly originalRequestBodyDigest:string;readonly queryBodyDigest:string;readonly queryOriginal:Uint8Array;readonly registrationOriginal:Uint8Array;readonly messageOriginal:Uint8Array;readonly untrusted:true;readonly dataOnly:true;readonly signatureVerified:false;readonly originalPostVerified:false;readonly RootAdmission:false;readonly SourceAdmission:false;readonly NativeAdmission:false;readonly registered:false;readonly current:false;readonly authorized:false;readonly connected:false;readonly newSession:false;readonly retryAuthorized:false}
export function extractProductPairPendingOriginalQueryClaimsDATA(memberOriginal:Uint8Array):Readonly<PendingOriginalQueryClaimsDATA>;
