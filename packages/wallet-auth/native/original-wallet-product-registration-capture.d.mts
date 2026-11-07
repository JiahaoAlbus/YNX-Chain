import type{PQAuthorizationSnapshot}from'../src/pq-wallet-policy.js';
import type{OriginalWalletProductSourceV1Policy}from'./original-wallet-product-source-contract.mjs';
export interface WPRNodeDATA{readonly origin:string;readonly spki:string;readonly nativeChainId:string}
export interface WPRPreviousDATA{readonly sequence:number;readonly floor:number;readonly head:string;readonly timeFloor:number;readonly executionHeight:string}
export interface WPRSourceInputDATA{readonly operation:'auth-source-v2-native-node/v1';readonly node:WPRNodeDATA;readonly rootRaw:string;readonly enrollmentRaw:string;readonly profileRaw:string;readonly headRaw:string;readonly policy:OriginalWalletProductSourceV1Policy;readonly previous:WPRPreviousDATA}
export type WPRRole='root'|'profile'|'current'|'subject';
export interface WPRIndependentExpectedContextDATA{readonly node:WPRNodeDATA;readonly networkId:string;readonly owners:readonly[string,string,string,string]}
export interface WPRSourceProjectionDATA{readonly status:'active';readonly dataOnly:true;readonly nativeAdmission:false;readonly sequence:number;readonly floor:number;readonly head:string;readonly timeFloor:number;readonly executionHeight:string;readonly expiresAtMs:number;readonly [key:string]:unknown}
export interface WPRRegistrationCaptureDATA{readonly schema:'YNX-WPR-SOURCE-V2-REGISTRATION-CAPTURE/v1';readonly purpose:'wallet-native-product-source-v1';readonly phase:'AFTER_CURRENT';readonly inputSHA256:string;readonly context:WPRIndependentExpectedContextDATA;readonly before:Readonly<Record<WPRRole,string>>;readonly after:Readonly<Record<WPRRole,string>>;readonly nonce:string;readonly previous:WPRPreviousDATA;readonly baselineAtMs:number;readonly atMs:number;readonly afterAtMs:number;readonly currentRawSHA256:string;readonly batchSHA256:string}
export interface WPRSourceCaptureResultDATA{readonly projection:WPRSourceProjectionDATA;readonly currentRaw:string;readonly registrationCapture:WPRRegistrationCaptureDATA}
export interface WPRReparsedRegistrationDATA{readonly before:Readonly<Record<WPRRole,PQAuthorizationSnapshot>>;readonly after:Readonly<Record<WPRRole,PQAuthorizationSnapshot>>;readonly nonce:string;readonly previous:WPRPreviousDATA;readonly baselineAtMs:number;readonly atMs:number;readonly afterAtMs:number;readonly inputSHA256:string;readonly batchSHA256:string;readonly dataOnly:true;readonly nativeAdmission:false}
export const WPR_REGISTRATION_CAPTURE_SCHEMA:'YNX-WPR-SOURCE-V2-REGISTRATION-CAPTURE/v1';
export const WPR_REGISTRATION_CAPTURE_MAX_BYTES:33554432;
export function snapshotWPRJSONDATA(value:unknown,cap?:number):unknown;
export function reparseWPRRegistrationCaptureDATA(value:unknown,expectedInput:WPRSourceInputDATA,expectedContext:WPRIndependentExpectedContextDATA):WPRReparsedRegistrationDATA;
export function encodeWPRRegistrationCaptureOriginalDATA(value:WPRSourceCaptureResultDATA):Uint8Array;
export function decodeWPRRegistrationCaptureOriginalDATA(bytes:Uint8Array,expectedInput:WPRSourceInputDATA,expectedContext:WPRIndependentExpectedContextDATA,currentOriginal:string):WPRReparsedRegistrationDATA;
