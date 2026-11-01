/** Exact version4 HTTP-device request DATA. Authentication/registration/current
 * and replay consumption belong to the original Auth/server/Native owners. */
export interface ProductSessionHTTPProofV4Unsigned {
 readonly version:'4';readonly sessionBinding:string;readonly productId:string;readonly clientId:string;
 readonly applicationId:string;readonly bundleId:string|null;readonly packageId:string|null;
 readonly origin:string;readonly callback:string;readonly account:string;readonly canonicalOwner:string;
 readonly deviceId:string;readonly deviceRegistrationId:string;readonly deviceRegistrationRevision:string;
 readonly deviceRegistrationDigest:string;readonly method:'GET'|'POST'|'PUT'|'PATCH'|'DELETE';
 readonly path:string;readonly bodyDigest:string;readonly nonce:string;readonly issuedAt:string;readonly expiresAt:string;
}
export interface ProductSessionHTTPProofV4Expected {readonly networkId:string;readonly unsigned:ProductSessionHTTPProofV4Unsigned;readonly pkA:string;readonly pkB:string}
export interface ProductSessionHTTPProofV4Data {readonly version:'4';readonly sessionBinding:string;readonly deviceRegistrationId:string;readonly deviceRegistrationRevision:string;readonly deviceRegistrationDigest:string;readonly purpose:'PRODUCT-SESSION-HTTP-PROOF';readonly signatureVerified:true;readonly memberCount:1;readonly memberIndex:0;readonly dataOnly:true;readonly trusted:false;readonly authorized:false;readonly registered:false;readonly current:false;readonly nativeAdmission:false}
export const PRODUCT_SESSION_PROOF_HEADER_V4:'x-ynx-product-session-proof-v4';
export const PRODUCT_SESSION_HTTP_PROOF_DOMAIN_V4:'YNX-PRODUCT-SESSION-HTTP-PROOF/v4';
export const PRODUCT_SESSION_HTTP_PROOF_PURPOSE_V4:'PRODUCT-SESSION-HTTP-PROOF';
export const PRODUCT_SESSION_V4_MEMBER_MAX_BYTES:98304;
export const PRODUCT_SESSION_V4_HEADER_MAX_BYTES:196608;
export const PRODUCT_SESSION_V4_TOTAL_HEADERS_MAX_BYTES:262144;
export const PRODUCT_SESSION_V4_MESSAGE_MAX_BYTES:16384;
export function parseProductSessionHTTPProofV4Unsigned(input:unknown):Readonly<ProductSessionHTTPProofV4Unsigned>;
export function encodeProductSessionHTTPProofV4Message(unsigned:ProductSessionHTTPProofV4Unsigned,networkId:string):Uint8Array;
/** Selected pair and entire original unsigned request are mandatory independent
 * DATA inputs; even a successful AND result does not grant current authority. */
export function inspectProductSessionHTTPProofV4Data(memberOriginal:Uint8Array,expected:ProductSessionHTTPProofV4Expected):Readonly<ProductSessionHTTPProofV4Data>;
/** Serialization only, not signing, registration or verification. */
export function encodeProductSessionProofHeaderV4(unsigned:ProductSessionHTTPProofV4Unsigned,memberOriginal:Uint8Array):string;
export function decodeProductSessionProofHeaderV4(header:string):Readonly<ProductSessionHTTPProofV4Unsigned & {readonly member:string}>;
export function inspectProductSessionHTTPProofHeaderV4Data(header:string,expected:ProductSessionHTTPProofV4Expected):Readonly<ProductSessionHTTPProofV4Data>;
