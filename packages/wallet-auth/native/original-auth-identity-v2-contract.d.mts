/** Original Auth-owned canonical request DATA; no credential or permission is issued. */
export const AUTH_IDENTITY_V2:'YNX-AUTH-IDENTITY/v2';
export const AUTH_IDENTITY_REQUEST_DOMAIN:'YNX/AUTH/IDENTITY-REQUEST/V2';
export const AUTH_IDENTITY_ALGORITHM:'YNX-BATCH/v0.1';
export const AUTH_IDENTITY_PURPOSES:Readonly<{receive:'AUTH-IDENTITY-RECEIVE';recover:'AUTH-IDENTITY-RECOVER';keyCall:'AUTH-PROTECTED-KEY-CALL';login:'AUTH-LOGIN'}>;
export type OriginalAuthIdentityPurpose=typeof AUTH_IDENTITY_PURPOSES[keyof typeof AUTH_IDENTITY_PURPOSES];
export interface OriginalAuthIdentityRequest {
 readonly version:typeof AUTH_IDENTITY_V2;readonly algorithmVersion:typeof AUTH_IDENTITY_ALGORITHM;
 readonly networkId:string;readonly owner:string;
 /** Canonical U64 decimal strings. keyVersion is original owner Record.Revision. */
 readonly keyVersion:string;readonly executionHeight:string;
 readonly principalId:string;readonly productId:'developer';readonly applicationId:string;readonly deviceId:string;
 readonly requestId:string;readonly purpose:OriginalAuthIdentityPurpose;
 readonly requestDigest:string;readonly credentialDigest:string;readonly nonce:string;
 readonly issuedAtMs:string;readonly expiresAtMs:string;
}
export function parseOriginalAuthIdentityRequest(raw:string):Readonly<OriginalAuthIdentityRequest>;
export function canonicalOriginalAuthIdentityRequest(value:OriginalAuthIdentityRequest):string;
export function encodeOriginalAuthIdentityRequest(value:OriginalAuthIdentityRequest):Uint8Array;
export function inspectOriginalAuthIdentityRequest(raw:string,expectedRaw:string,purpose:OriginalAuthIdentityPurpose,atMs:string):Readonly<{body:Readonly<OriginalAuthIdentityRequest>;requestOriginalDigest:string;dataOnly:true;authorized:false}>;
export function inspectOriginalAuthIdentityContinuity(originalRaw:string,recoveredRaw:string):Readonly<{principalId:string;owner:string;dataOnly:true;authorized:false}>;
