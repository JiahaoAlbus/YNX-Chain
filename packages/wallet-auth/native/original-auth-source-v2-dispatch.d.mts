import type{WPRSourceInputDATA,WPRSourceCaptureResultDATA,WPRNodeDATA}from'./original-wallet-product-registration-capture.mjs';
import type{PQAuthorizationDTO}from'../src/pq-wallet-policy.js';
/** Existing native/private dispatch; purpose-specific validation remains sole JS runtime implementation. */
export function dispatchOriginalSourceV2(input:unknown,get?:(node:WPRNodeDATA,owner:string)=>Promise<PQAuthorizationDTO>,getCurrent?:(endpoint:string,spki:string,profileSHA256:string,nonce:string)=>Promise<string>,networkOriginals?:unknown):Promise<Readonly<{projection:unknown;currentRaw:string}>>;
/** Fixed WPR-only NodeHost private capture; no new stdin operation/provider. */
export function captureOriginalWalletProductSourceV2(input:WPRSourceInputDATA,get?:(node:WPRNodeDATA,owner:string)=>Promise<PQAuthorizationDTO>,getCurrent?:(endpoint:string,spki:string,profileSHA256:string,nonce:string)=>Promise<string>):Promise<WPRSourceCaptureResultDATA>;
