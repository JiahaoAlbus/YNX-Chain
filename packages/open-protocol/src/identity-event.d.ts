import type{NetworkBindingV1}from'./identity-challenge.js';
export type IdentityActionV1='register'|'rotate'|'suspend'|'revoke'|'recover';
export type IdentityRoleV1='controller'|'oldPair'|'newPoP'|'recovery';
export interface IdentityEventV1DATA {
 readonly id:Uint8Array;readonly subject:Readonly<{realm:Uint8Array;tenant:Uint8Array;kind:'agent';id:Uint8Array;rev:string}>;
 readonly action:IdentityActionV1;readonly fromEpoch:string;readonly toEpoch:string;
 readonly newPair:Readonly<{suite:'YNX-BATCH/v0.1';pkA:Uint8Array;pkB:Uint8Array}>|null;
 readonly trustId:Uint8Array;readonly policyId:Uint8Array;readonly previous:Uint8Array|null;
 readonly bound:Readonly<{bytes:string;sha3_512:Uint8Array;sha512:Uint8Array}>;
}
export interface IdentityRoleAuthorizationV1DATA {
 readonly role:IdentityRoleV1;readonly realm:Uint8Array;readonly networkBinding:NetworkBindingV1;readonly action:IdentityActionV1;
 readonly audience:Uint8Array;readonly eventOriginal:Uint8Array;readonly nonce:Uint8Array;
 readonly notAfter:string;readonly expectedEpoch:string;readonly nextEpoch:string;
}
export declare const IDENTITY_EVENT_SCHEMA:'YNX-OPEN/IDENTITY-EVENT/1';
export declare const IDENTITY_ROLE_DOMAINS:Readonly<Record<IdentityRoleV1,string>>;
/** DATA grammar only; required-role AND/threshold and current trust remain Auth. */
export declare function encodeIdentityEventV1DATA(event:IdentityEventV1DATA):Uint8Array;
export declare function decodeIdentityEventV1DATA(wire:Uint8Array):IdentityEventV1DATA;
export declare function encodeIdentityRoleAuthorizationV1DATA(input:IdentityRoleAuthorizationV1DATA):Uint8Array;
export declare function decodeIdentityRoleAuthorizationV1DATA(wire:Uint8Array):IdentityRoleAuthorizationV1DATA;
