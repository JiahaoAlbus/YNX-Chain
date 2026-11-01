import type {ProductSessionV4,ProductBusinessReadInput} from './index.js';
import type {ProductSessionHTTPProofV4Unsigned} from './product-session-proof-v4.js';
import type {ProductSessionPlatform} from './index.js';
import type {PQ_SUITE} from './pq-wallet-contract.js';
export interface ProductSessionDeviceCurrentExpectedV4 {
 readonly networkId:string;readonly canonicalOwner:string;readonly account:string;readonly sessionBinding:string;
 readonly productId:string;readonly clientId:string;readonly platform:ProductSessionPlatform;readonly applicationId:string;
 readonly bundleId:string|null;readonly packageId:string|null;readonly origin:string;readonly callback:string;
 readonly deviceId:string;readonly generation:string;readonly registrationId:string;readonly revision:string;readonly registrationDigest:string;
}
export interface ProductSessionDeviceNativeContextV4 {
 readonly version:'4';readonly algorithm:typeof PQ_SUITE;readonly securityLevel:'hardware-backed'|'os-protected';
 readonly networkId:string;readonly account:string;readonly deviceId:string;readonly generation:string;
 readonly registrationId:string;readonly revision:string;readonly registrationDigest:string;readonly scopes:readonly string[];readonly purpose:string;
}
declare const originalDeviceCurrent:unique symbol,originalProofOperation:unique symbol;
/** Actual original Auth/Native private brands. JSON, a decoded record or an
 * approved boolean cannot construct these. No public brand setter is exported. */
export interface OriginalProductSessionDeviceCurrentV4 {readonly [originalDeviceCurrent]:never}
export interface OriginalProductSessionDeviceProofOperationV4 {
 readonly [originalProofOperation]:never;
 /** PUBLIC captured original only. Does not sign, retry or authorize delivery. */
 readOriginalMember():Uint8Array;assertCurrent():undefined;retire():undefined;join():Promise<undefined>;close():Promise<undefined>;
}
export type ProductSessionDeviceAbortContextV4=Readonly<{signal:AbortSignal}>;
export interface OriginalProductSessionDeviceCurrentSourceV4 {
 readCurrent(expected:ProductSessionDeviceCurrentExpectedV4,abortContext:ProductSessionDeviceAbortContextV4):Promise<OriginalProductSessionDeviceCurrentV4>;
 assertCurrent(held:OriginalProductSessionDeviceCurrentV4,abortContext:ProductSessionDeviceAbortContextV4):undefined|Promise<undefined>;
 readRegistrationOriginal(held:OriginalProductSessionDeviceCurrentV4):Uint8Array;
 readSessionOriginal(held:OriginalProductSessionDeviceCurrentV4):string;
}
export interface ProductSessionDevicePortsV4 {
 readonly version:'4';readonly algorithm:typeof PQ_SUITE;
 readContext():ProductSessionDeviceNativeContextV4;
 produceHTTPProof(input:Readonly<{version:'4';networkId:string;unsigned:ProductSessionHTTPProofV4Unsigned}>,held:OriginalProductSessionDeviceCurrentV4,abortContext:ProductSessionDeviceAbortContextV4):Promise<OriginalProductSessionDeviceProofOperationV4>;
}
export type ProductSessionBusinessReadProofV4=Readonly<{version:'4';proofHeaderName:'x-ynx-product-session-proof-v4';proofHeader:string;body:'';signatureVerified:true;NativeAdmission:false;SourceAdmission:false}>;
export interface ProductSessionBusinessReadClientV4 {
 readonly capabilities:Readonly<{kind:'existing-native-business-read-v4';algorithm:typeof PQ_SUITE;identityGrant:false;nativeAdmission:false;connected:false;newSession:false}>;
 createBusinessProof(input:ProductBusinessReadInput):Promise<ProductSessionBusinessReadProofV4>;
 /** Retires this client and drains original entered operations. Does not abort
  * the caller's signal: its owner aborts the original controller first. First
  * UNKNOWN error is retained; Source/read permission cleanup stays with its owner. */
 close():Promise<void>;
}
export const PRODUCT_SESSION_DEVICE_V4_EXPECTED_FIELDS:readonly string[];
/** Same original client's Node-only consumer branch; no Source qualification. */
export function openExistingProductSessionV4Read(options:Readonly<Record<string,unknown>>):Promise<ProductSessionBusinessReadClientV4>;
export function productSessionHTTPProofV4ReplayKey(header:string):string;
export function verifyOriginalProductSessionHTTPProofV4(input:Readonly<{
 headerName:'x-ynx-product-session-proof-v4';header:string;request:Readonly<{method:string;path:string;body:string|Uint8Array;requiredScopes:readonly string[]}>;
 expected:ProductSessionDeviceCurrentExpectedV4;source:OriginalProductSessionDeviceCurrentSourceV4;abortContext:ProductSessionDeviceAbortContextV4;at:Date;
 consumeNonce:(original:Readonly<{key:string;nonce:string;sessionBinding:string;expiresAt:string}>,held:OriginalProductSessionDeviceCurrentV4,abortContext:ProductSessionDeviceAbortContextV4)=>Promise<undefined>;
}>):Promise<Readonly<{session:ProductSessionV4;proof:Readonly<Record<string,unknown>>;replayKey:string;signatureVerified:true;dataOnly:true;authorized:false;nativeAdmission:false}>>;
/** Actual rawHeaders parser only, never deployment/admission evidence. */
export function readProductSessionV4BoundedHTTPHeaders(rawHeaders:readonly string[]):Readonly<{headerName:'x-ynx-product-session-proof-v4';proofHeader:string;totalBytes:number;proofHeaderMaxBytes:196608;totalHeaderMaxBytes:262144;budgetOnly:true;counterpartDeployed:false;nativeAdmission:false}>;
