import type{PQAuthorizationSnapshot}from'../src/pq-wallet-policy.js';
import type{NetworkResourceScopeV1,NetworkResourceBindingV1,NetworkResourceIssuerCurrentV1,NetworkResourcePrincipalCurrentV1,NetworkResourceOnceV1}from'./original-network-resource-source-contract.mjs';
export{NETWORK_RESOURCE_SOURCE_PURPOSE,NETWORK_RESOURCE_SOURCE_SELECTION_KEY,NETWORK_RESOURCE_SOURCE_OPERATIONS}from'./original-network-resource-source-contract.mjs';
export const NETWORK_RESOURCE_INPUT_ORIGINAL_KEY:'resource.input.original';
export interface NetworkResourceInputOriginalRefV1 {readonly key:'resource.input.original';readonly protectedResourceRef:string;readonly leaf:Readonly<NetworkResourceBindingV1&{device:string;inode:string;uid:string;gid:string;mode:string;nlink:'1'}>;}
export interface NetworkResourceGoConsumerV1 {readonly runtimeKind:'go-native';readonly appId:string;readonly productId:string;readonly platform:'macos'|'linux'|'windows';readonly vnode:Readonly<{device:string;inode:string}>;readonly imageSHA256:string;}
export interface NetworkResourceSourceCurrentV1 {readonly sourceId:string;readonly instanceId:string;readonly resourceKey:string;readonly epoch:string;readonly sequence:string;readonly head:string;readonly status:'active'|'revoked'|'retired';readonly issuedAtMs:number;readonly expiresAtMs:number;}
export interface NetworkResourceSignatureBindingV1 {readonly networkId:string;readonly canonicalSignerOwner:string;readonly keyEpoch:string;readonly issuedHeight:string;}
/** Independent ORIGINALS only; type/SDK brand alone does not prove Native provenance. */
export interface NetworkResourceOriginalsV1 {
 readonly manifestOriginal:Uint8Array;readonly consentOriginal:Uint8Array;readonly inputOriginal:Uint8Array;
 readonly originalInputRef:NetworkResourceInputOriginalRefV1;readonly nativeConsumerIdentity:NetworkResourceGoConsumerV1;readonly sourceCurrent:NetworkResourceSourceCurrentV1;
 readonly issuerMapping:Readonly<{canonicalIssuer:string;signatureBinding:NetworkResourceSignatureBindingV1;memberOriginal:Uint8Array}>;
 readonly principalMapping:Readonly<{principal:string;subjectOwner:string;signatureBinding:NetworkResourceSignatureBindingV1;memberOriginal:Uint8Array}>;
 readonly issuerCurrent:NetworkResourceIssuerCurrentV1;readonly principalCurrent:NetworkResourcePrincipalCurrentV1;
 readonly issuerRegistration:PQAuthorizationSnapshot;readonly principalRegistration:PQAuthorizationSnapshot;readonly once:NetworkResourceOnceV1;
}
declare const captured:unique symbol;
export type NetworkResourceOriginalsCaptureV1=Readonly<NetworkResourceOriginalsV1&{readonly [captured]:true}>;
export interface NetworkResourceSourceScopeV2 {readonly version:1;readonly networkId:string;readonly subjectOwner:string;readonly sourceId:string;readonly instanceId:string;readonly operation:'resource.public-block-histogram';readonly originalInputRef:NetworkResourceInputOriginalRefV1;readonly nativeConsumerIdentity:NetworkResourceGoConsumerV1;readonly currentFloor:Readonly<{epoch:string;minimumSequence:string;head:string}>;readonly issuerSignerOwner:string;readonly principalSignerOwner:string;readonly resourceScope:NetworkResourceScopeV1;}
export interface NetworkResourceSourceAssociationV1 {readonly account:string;readonly clientId:string;readonly productId:string;readonly platform:'macos'|'linux'|'windows';readonly applicationId:string;readonly deviceId:string;}
export interface NetworkResourceSourceV2DATA {readonly scopeOriginal:string;readonly scope:NetworkResourceSourceScopeV2;readonly effectExpiresAtMs:number;readonly dataOnly:true;readonly authorized:false;readonly RootAdmission:false;readonly SourceAdmission:false;readonly NativeAdmission:false;readonly productionDisabled:true;readonly rewards:'NOT_AUTHORIZED';}
export function captureOriginalNetworkResourceOriginalsV1DATA(value:NetworkResourceOriginalsV1):NetworkResourceOriginalsCaptureV1;
export function assertOriginalNetworkResourceOriginalsCurrentV1DATA(capture:NetworkResourceOriginalsCaptureV1,observed?:NetworkResourceOriginalsV1):undefined;
export function inspectOriginalNetworkResourceSourceScopeV2DATA(value:NetworkResourceSourceScopeV2,association:NetworkResourceSourceAssociationV1,networkId:string,subjectOwner:string,sourceId:string,instanceId:string,issuedAtMs:number,expiresAtMs:number,atMs:number,actualOriginals:NetworkResourceOriginalsV1):Readonly<NetworkResourceSourceV2DATA>;
/** PUBLIC serialized DTO decoder; result is intentionally not Originals/capture. */
export function decodeOriginalNetworkResourceOriginalsTransportV1DATA(value:unknown):Readonly<{readonly [key:string]:unknown}>;
/** Existing already-signed-original E5 readback, NOT pre-sign review acquisition. */
export function readOriginalNetworkResourceUnsignedConsentV1DATA(value:NetworkResourceSourceScopeV2,association:NetworkResourceSourceAssociationV1,networkId:string,subjectOwner:string,sourceId:string,instanceId:string,issuedAtMs:number,expiresAtMs:number,atMs:number,actualOriginals:NetworkResourceOriginalsV1):Uint8Array;
/** Fixed same-owner Native adapter slot. Requests cannot supply this interface. */
export interface NetworkResourceOriginalsNativeIOV1 {readNetworkResourceOriginalsV1():NetworkResourceOriginalsV1;}
