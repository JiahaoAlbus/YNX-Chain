export interface ProductSessionManagementV4RecoveryTarget {readonly kind:'completion';readonly operationId:string;readonly approvalOriginal:string;readonly challengeOriginal:string}
import type {ProductSessionHTTPProofV4Expected} from './product-session-proof-v4.js';
export type ProductSessionManagementV4Operation='active'|'recover'|'revoke'|'cancel';
export interface ProductSessionManagementV4Base {readonly request:unknown;readonly registrationOriginal:string;readonly account:string}
export type ProductSessionManagementV4Body=ProductSessionManagementV4Base&(
 {readonly sessionBinding:string}|{readonly operationId:string}|{readonly operationId:string;readonly sessionBinding:string|null}|{readonly operationId:string;readonly challengeId:string});
export interface ProductSessionManagementV4Flags {readonly dataOnly:true;readonly signatureVerified:boolean;readonly RootAdmission:false;readonly SourceAdmission:false;readonly NativeAdmission:false;readonly current:false;readonly authorized:false}
export interface ProductSessionManagementV4RequestDATA extends ProductSessionManagementV4Flags {readonly operation:ProductSessionManagementV4Operation;readonly method:'POST';readonly path:string;readonly contentType:'application/json';readonly proofHeaderName:'x-ynx-product-session-proof-v4';readonly intendedSessionBinding?:string;readonly bodyOriginal:Uint8Array;readonly bodyDigest:string;readonly operationId:string|null;readonly body:Readonly<ProductSessionManagementV4Body>}
export interface ProductSessionManagementV4ResponseSelection {readonly operation:ProductSessionManagementV4Operation;readonly operationId:string|null;readonly requestBodyDigest:string;readonly originalRequestBodyDigest:string|null}
export interface ProductSessionManagementV4Response extends ProductSessionManagementV4ResponseSelection {readonly version:'4';readonly state:'OBSERVED'|'UNKNOWN'|'REJECTED';readonly original:string|null;readonly code:string|null}
export const PRODUCT_SESSION_MANAGEMENT_V4_BODY_MAX_BYTES:393216;
export const PRODUCT_SESSION_MANAGEMENT_V4_CONTENT_TYPE:'application/json';
export const PRODUCT_SESSION_MANAGEMENT_V4_ROUTES:Readonly<Record<ProductSessionManagementV4Operation,string>>;
export function encodeProductSessionManagementV4RequestDATA(registry:unknown,operation:Exclude<ProductSessionManagementV4Operation,'recover'>,input:unknown):Readonly<ProductSessionManagementV4RequestDATA>;
export function encodeProductSessionManagementV4RequestDATA(registry:unknown,operation:'recover',input:unknown,recoveryTarget:ProductSessionManagementV4RecoveryTarget):Readonly<ProductSessionManagementV4RequestDATA>;
export function decodeProductSessionManagementV4RequestDATA(registry:unknown,operation:Exclude<ProductSessionManagementV4Operation,'recover'>,original:Uint8Array):Readonly<ProductSessionManagementV4RequestDATA>;
export function decodeProductSessionManagementV4RequestDATA(registry:unknown,operation:'recover',original:Uint8Array,recoveryTarget:ProductSessionManagementV4RecoveryTarget):Readonly<ProductSessionManagementV4RequestDATA>;
/** Full existing V4 AND math; independent expected pair required, never Source. */
export function inspectProductSessionManagementV4ProofDATA(registry:unknown,operation:Exclude<ProductSessionManagementV4Operation,'recover'>,original:Uint8Array,proofHeader:string,expected:ProductSessionHTTPProofV4Expected):Readonly<ProductSessionManagementV4RequestDATA>&{readonly signatureVerified:true};
export function inspectProductSessionManagementV4ProofDATA(registry:unknown,operation:'recover',original:Uint8Array,proofHeader:string,expected:ProductSessionHTTPProofV4Expected,recoveryTarget:ProductSessionManagementV4RecoveryTarget):Readonly<ProductSessionManagementV4RequestDATA>&{readonly signatureVerified:true};
export function assertProductSessionManagementV4RecoveryDATA(decoded:ProductSessionManagementV4RequestDATA,originalSelection:Readonly<{operationId:string;originalBodyDigest:string;originalBodyOriginal:Uint8Array}>):Readonly<ProductSessionManagementV4Flags&{operationId:string;originalBodyDigest:string;queryOnly:true;retryAuthorized:false}>;
export function encodeProductSessionManagementV4ResponseDATA(value:unknown,selection:ProductSessionManagementV4ResponseSelection):Uint8Array;
export function decodeProductSessionManagementV4ResponseDATA(original:Uint8Array,selection:ProductSessionManagementV4ResponseSelection):Readonly<ProductSessionManagementV4Flags&{responseOriginal:Uint8Array;response:Readonly<ProductSessionManagementV4Response>;queryOnly:true;retryAuthorized:false;executionVerified:false}>;
