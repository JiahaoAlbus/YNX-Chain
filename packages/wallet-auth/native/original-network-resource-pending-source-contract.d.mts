import type{PQAuthorizationSnapshot}from'../src/pq-wallet-policy.js';
import type{NetworkResourceScopeV1,NetworkResourceBindingV1,NetworkResourceIssuerCurrentV1,NetworkResourcePrincipalCurrentV1,NetworkResourceOnceV1}from'./original-network-resource-source-contract.mjs';
export{NETWORK_RESOURCE_PENDING_CONSENT_SOURCE_PURPOSE,NETWORK_RESOURCE_PENDING_CONSENT_SOURCE_SELECTION_KEY,NETWORK_RESOURCE_PENDING_CONSENT_SOURCE_OPERATIONS}from'./original-network-resource-pending-consent-v1.mjs';
export const NETWORK_RESOURCE_INPUT_ORIGINAL_KEY:'resource.input.original';
export interface NetworkResourceInputOriginalRefV1 {readonly key:'resource.input.original';readonly protectedResourceRef:string;readonly leaf:Readonly<NetworkResourceBindingV1&{device:string;inode:string;uid:string;gid:string;mode:string;nlink:'1'}>;}
export interface NetworkResourceGoConsumerV1 {readonly runtimeKind:'go-native';readonly appId:string;readonly productId:string;readonly platform:'macos'|'linux'|'windows';readonly vnode:Readonly<{device:string;inode:string}>;readonly imageSHA256:string;}
export interface NetworkResourceSourceCurrentV1 {readonly sourceId:string;readonly instanceId:string;readonly resourceKey:string;readonly epoch:string;readonly sequence:string;readonly head:string;readonly status:'active'|'revoked'|'retired';readonly issuedAtMs:number;readonly expiresAtMs:number;}
export interface NetworkResourceSignatureBindingV1 {readonly networkId:string;readonly canonicalSignerOwner:string;readonly keyEpoch:string;readonly issuedHeight:string;}
/** Independent ORIGINALS only; type/SDK brand alone does not prove Native provenance. */
export interface NetworkPendingConsentOriginalsV1 {
 readonly manifestOriginal:Uint8Array;readonly consentOriginal:Uint8Array;readonly inputOriginal:Uint8Array;
 readonly originalInputRef:NetworkResourceInputOriginalRefV1;readonly nativeConsumerIdentity:NetworkResourceGoConsumerV1;readonly sourceCurrent:NetworkResourceSourceCurrentV1;
 readonly issuerMapping:Readonly<{canonicalIssuer:string;signatureBinding:NetworkResourceSignatureBindingV1;memberOriginal:Uint8Array}>;
 readonly principalMapping:Readonly<{principal:string;subjectOwner:string;signatureBinding:NetworkResourceSignatureBindingV1}>;
 readonly issuerCurrent:NetworkResourceIssuerCurrentV1;readonly principalCurrent:NetworkResourcePrincipalCurrentV1;
 readonly issuerRegistration:PQAuthorizationSnapshot;readonly principalRegistration:PQAuthorizationSnapshot;readonly once:NetworkResourceOnceV1;
}
declare const captured:unique symbol;
export type NetworkPendingConsentOriginalsCaptureV1=Readonly<NetworkPendingConsentOriginalsV1&{readonly [captured]:true}>;
export interface NetworkPendingConsentSourceScopeV1 {readonly version:1;readonly networkId:string;readonly subjectOwner:string;readonly sourceId:string;readonly instanceId:string;readonly operation:'resource.public-block-histogram';readonly originalInputRef:NetworkResourceInputOriginalRefV1;readonly nativeConsumerIdentity:NetworkResourceGoConsumerV1;readonly currentFloor:Readonly<{epoch:string;minimumSequence:string;head:string}>;readonly issuerSignerOwner:string;readonly principalSignerOwner:string;readonly resourceScope:NetworkResourceScopeV1;}
export interface NetworkResourceSourceAssociationV1 {readonly account:string;readonly clientId:string;readonly productId:string;readonly platform:'macos'|'linux'|'windows';readonly applicationId:string;readonly deviceId:string;}
export interface NetworkPendingConsentSourceV1DATA {readonly scopeOriginal:string;readonly scope:NetworkPendingConsentSourceScopeV1;readonly effectExpiresAtMs:number;readonly dataOnly:true;readonly authorized:false;readonly RootAdmission:false;readonly SourceAdmission:false;readonly NativeAdmission:false;readonly approved:false;readonly signed:false;readonly executionAllowed:false;readonly productionDisabled:true;readonly rewards:'NOT_AUTHORIZED';}
export function captureOriginalNetworkPendingConsentOriginalsV1DATA(value:NetworkPendingConsentOriginalsV1):NetworkPendingConsentOriginalsCaptureV1;
export function assertOriginalNetworkPendingConsentOriginalsCurrentV1DATA(capture:NetworkPendingConsentOriginalsCaptureV1,observed?:NetworkPendingConsentOriginalsV1):undefined;
export function inspectOriginalNetworkPendingConsentSourceScopeV1DATA(value:NetworkPendingConsentSourceScopeV1,association:NetworkResourceSourceAssociationV1,networkId:string,subjectOwner:string,sourceId:string,instanceId:string,issuedAtMs:number,expiresAtMs:number,atMs:number,actualOriginals:NetworkPendingConsentOriginalsV1):Readonly<NetworkPendingConsentSourceV1DATA>;
/** Exact existing E5 consent before any principal member. DATA only. */
export function readOriginalNetworkPendingConsentUnsignedV1DATA(value:NetworkPendingConsentSourceScopeV1,association:NetworkResourceSourceAssociationV1,networkId:string,subjectOwner:string,sourceId:string,instanceId:string,issuedAtMs:number,expiresAtMs:number,atMs:number,actualOriginals:NetworkPendingConsentOriginalsV1):Uint8Array;
/** Fixed same-owner Native adapter slot. Requests cannot supply this interface. */
export interface NetworkPendingConsentOriginalsNativeIOV1 {readNetworkPendingConsentOriginalsV1():NetworkPendingConsentOriginalsV1;}

export{prepareOriginalNetworkPendingConsentStageV1DATA,prepareOriginalPendingConsentStatementPrivate,assertOriginalNetworkPendingConsentStageCurrentV1DATA,readOriginalNetworkPendingConsentStatementV1DATA,inspectOriginalNetworkPendingConsentStageV1DATA,retireOriginalNetworkPendingConsentStageV1DATA,joinOriginalNetworkPendingConsentStageV1DATA,closeOriginalNetworkPendingConsentStageV1DATA}from'./original-network-resource-pending-consent-v1.mjs';
export{openOriginalNetworkPendingConsentSourceV1}from'./original-network-resource-pending-source-factory.mjs';
