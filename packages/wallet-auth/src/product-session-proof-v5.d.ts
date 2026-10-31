/** Node-only DATA/math. No signer, Source or HTTP admission. */
export interface ProductSessionHTTPBodyV5Binding {readonly bytes:string;readonly sha3_512:string;readonly sha512:string}
export interface ProductSessionHTTPBodyV5DATA {readonly contentType:string;readonly bodyDigest:string;readonly bodyBinding:Readonly<ProductSessionHTTPBodyV5Binding>;readonly dataOnly:true;readonly SourceAdmission:false;readonly NativeAdmission:false}
/** Exact version5 HTTP-device request DATA. Authentication/registration/current
 * and replay consumption belong to the original Auth/server/Native owners. */
export interface ProductSessionHTTPProofV5Unsigned {
 readonly version:'5';readonly sessionBinding:string;readonly productId:string;readonly clientId:string;
 readonly applicationId:string;readonly bundleId:string|null;readonly packageId:string|null;
 readonly origin:string;readonly callback:string;readonly account:string;readonly canonicalOwner:string;
 readonly deviceId:string;readonly deviceRegistrationId:string;readonly deviceRegistrationRevision:string;
 readonly deviceRegistrationDigest:string;readonly method:'POST';
 readonly path:'/api/v1/ide/deployments';readonly bodyDigest:string;readonly contentType:string;readonly bodyBinding:ProductSessionHTTPBodyV5Binding;readonly nonce:string;readonly issuedAt:string;readonly expiresAt:string;
}
export interface ProductSessionHTTPProofV5Expected {readonly networkId:string;readonly unsigned:ProductSessionHTTPProofV5Unsigned;readonly pkA:string;readonly pkB:string}
export interface ProductSessionHTTPProofV5Data {readonly version:'5';readonly sessionBinding:string;readonly deviceRegistrationId:string;readonly deviceRegistrationRevision:string;readonly deviceRegistrationDigest:string;readonly purpose:'PRODUCT-SESSION-HTTP-PROOF';readonly signatureVerified:true;readonly memberCount:1;readonly memberIndex:0;readonly dataOnly:true;readonly trusted:false;readonly authorized:false;readonly registered:false;readonly current:false;readonly nativeAdmission:false}
export const PRODUCT_SESSION_PROOF_HEADER_V5:'x-ynx-product-session-proof-v5';
export const PRODUCT_SESSION_HTTP_PROOF_DOMAIN_V5:'YNX-PRODUCT-SESSION-HTTP-PROOF/v5';
export const PRODUCT_SESSION_HTTP_PROOF_PURPOSE_V5:'PRODUCT-SESSION-HTTP-PROOF';
export const PRODUCT_SESSION_V5_MEMBER_MAX_BYTES:98304;
export const PRODUCT_SESSION_V5_HEADER_MAX_BYTES:196608;
export const PRODUCT_SESSION_V5_TOTAL_HEADERS_MAX_BYTES:262144;
export const PRODUCT_SESSION_V5_MESSAGE_MAX_BYTES:16384;
export function parseProductSessionHTTPProofV5Unsigned(input:unknown):Readonly<ProductSessionHTTPProofV5Unsigned>;
export function encodeProductSessionHTTPProofV5Message(unsigned:ProductSessionHTTPProofV5Unsigned,networkId:string):Uint8Array;
/** Selected pair and entire original unsigned request are mandatory independent
 * DATA inputs; even a successful AND result does not grant current authority. */
export function inspectProductSessionHTTPProofV5Data(memberOriginal:Uint8Array,expected:ProductSessionHTTPProofV5Expected):Readonly<ProductSessionHTTPProofV5Data>;
/** Serialization only, not signing, registration or verification. */
export function encodeProductSessionProofHeaderV5(unsigned:ProductSessionHTTPProofV5Unsigned,memberOriginal:Uint8Array):string;
export function decodeProductSessionProofHeaderV5(header:string):Readonly<ProductSessionHTTPProofV5Unsigned & {readonly member:string}>;
export function inspectProductSessionHTTPProofHeaderV5Data(header:string,expected:ProductSessionHTTPProofV5Expected):Readonly<ProductSessionHTTPProofV5Data>;

export const PRODUCT_SESSION_V5_BODY_MAX_BYTES:68288512;
/** Computes hashes from one owned actual body snapshot. */
export function createProductSessionHTTPBodyV5DATA(actualBytes:Uint8Array,exactContentType:string):Readonly<ProductSessionHTTPBodyV5DATA>;
/** Actual body and received Content-Type must independently match unsigned. */
export function assertProductSessionHTTPBodyV5DATA(actualBytes:Uint8Array,exactContentType:string,unsigned:ProductSessionHTTPProofV5Unsigned):Readonly<ProductSessionHTTPBodyV5DATA>;
