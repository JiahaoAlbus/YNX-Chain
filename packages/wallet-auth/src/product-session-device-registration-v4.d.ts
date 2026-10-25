import type {ProductSessionHTTPProofV4Unsigned,ProductSessionHTTPProofV4Data} from './product-session-proof-v4.js';
export interface ProductSessionDeviceRegistrationV4 {
 readonly version:'4';readonly registrationId:string;readonly networkId:string;readonly canonicalOwner:string;
 readonly productId:string;readonly clientId:string;readonly platform:'android'|'ios'|'linux'|'macos'|'web'|'windows';
 readonly applicationId:string;readonly bundleId:string|null;readonly packageId:string|null;readonly origin:string;readonly callback:string;
 readonly deviceId:string;readonly generation:string;readonly revision:string;readonly pkA:string;readonly pkB:string;
 readonly registeredAt:string;readonly expiresAt:string;readonly revokedAt:string|null;
}
export interface ProductSessionDeviceRegistrationOriginalV4Data {readonly record:Readonly<ProductSessionDeviceRegistrationV4>;readonly registrationDigest:string;readonly dataOnly:true;readonly registered:false;readonly current:false;readonly nativeAdmission:false}
/** Exact public record, never an allocator, active-state projection or Source. */
export function parseProductSessionDeviceRegistrationV4Data(value:unknown):Readonly<ProductSessionDeviceRegistrationV4>;
/** Exact canonical original bytes/digest, with all qualification flags false. */
export function inspectProductSessionDeviceRegistrationOriginalV4Data(original:Uint8Array):Readonly<ProductSessionDeviceRegistrationOriginalV4Data>;
/** Original server must independently require SAME active/latest Auth record
 * and pre/post current/revoke. No account-pair or owner-only resolver exists. */
export function inspectProductSessionHTTPProofForDeviceRecordV4Data(header:string,registrationOriginal:Uint8Array,expected:Readonly<{networkId:string;unsigned:ProductSessionHTTPProofV4Unsigned;at:string}>):Readonly<ProductSessionHTTPProofV4Data>;
