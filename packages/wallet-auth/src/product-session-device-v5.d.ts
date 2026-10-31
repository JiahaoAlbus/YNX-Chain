import type{ProductSessionV4}from'./index.js';
import type{ProductSessionHTTPProofV5Unsigned}from'./product-session-proof-v5.js';
import type{ProductSessionDeviceCurrentExpectedV4,OriginalProductSessionDeviceCurrentSourceV4,OriginalProductSessionDeviceCurrentV4,ProductSessionDeviceAbortContextV4}from'./product-session-device-v4.js';
export function productSessionHTTPProofV5ReplayKey(header:string):string;
/** Same registered-device server Source read/current ports; no V4 GET issuer is
 * used or upgraded, and no DATA result supplies Source/Principal authority. */
export function verifyOriginalProductSessionHTTPProofV5(input:Readonly<{
 headerName:'x-ynx-product-session-proof-v5';header:string;
 request:Readonly<{method:'POST';path:'/api/v1/ide/deployments';bodyOriginal:Uint8Array;contentType:string;requiredScopes:readonly string[]}>;
 expected:ProductSessionDeviceCurrentExpectedV4;source:OriginalProductSessionDeviceCurrentSourceV4;abortContext:ProductSessionDeviceAbortContextV4;at:Date;
 consumeNonce:(original:Readonly<{key:string;nonce:string;sessionBinding:string;expiresAt:string}>,held:OriginalProductSessionDeviceCurrentV4,abortContext:ProductSessionDeviceAbortContextV4)=>Promise<undefined>;
}>):Promise<Readonly<{session:ProductSessionV4;proof:Readonly<ProductSessionHTTPProofV5Unsigned&{member:string}>;replayKey:string;signatureVerified:true;dataOnly:true;authorized:false;nativeAdmission:false}>>;
