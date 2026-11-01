import type{PQAuthorizationDTO}from'../src/pq-wallet-policy.js';
import type{NetworkResourceScopeV1,NetworkResourceIssuerCurrentV1,NetworkResourcePrincipalCurrentV1}from'./original-network-resource-source-contract.mjs';
import type{NetworkResourceSignatureBindingV1}from'./original-network-resource-source-v2-contract.mjs';
export const NETWORK_RESOURCE_PENDING_CONSENT_SOURCE_PURPOSE:'network-resource-pending-consent-source-v1';
export const NETWORK_RESOURCE_PENDING_CONSENT_SOURCE_SELECTION_KEY:'networkResourcePendingConsentV1';
export const NETWORK_RESOURCE_PENDING_CONSENT_SOURCE_OPERATIONS:readonly ['resource.public-block-histogram'];
/** Auth frozen stage-r2 exact nine PRIVATE inputs. Registration DTOs are only
 * equality pins; the independent node observations are the actual math input.
 * Neither this shape nor a PUBLIC node observation is a protected Source. */
export interface OriginalNetworkPendingConsentInputV1 {
 readonly scope:NetworkResourceScopeV1;readonly inputOriginal:Uint8Array;
 readonly issuerMapping:Readonly<{canonicalIssuer:string;signatureBinding:NetworkResourceSignatureBindingV1;memberOriginal:Uint8Array}>;
 readonly principalMapping:Readonly<{principal:string;subjectOwner:string;signatureBinding:NetworkResourceSignatureBindingV1}>;
 readonly issuerRegistration:PQAuthorizationDTO;readonly principalRegistration:PQAuthorizationDTO;
 readonly issuerCurrent:NetworkResourceIssuerCurrentV1;readonly principalCurrent:NetworkResourcePrincipalCurrentV1;
 readonly node:Readonly<{origin:string;spki:string;nativeChainId:string}>;
}
declare const pendingData:unique symbol;
export interface OriginalNetworkPendingConsentStageV1DATA {readonly [pendingData]:never;}
export type PendingRegistrationPublicDATAGetterV1=(node:OriginalNetworkPendingConsentInputV1['node'],owner:string)=>Promise<unknown>;
export function prepareOriginalNetworkPendingConsentStageV1DATA(input:OriginalNetworkPendingConsentInputV1,get?:PendingRegistrationPublicDATAGetterV1):Promise<OriginalNetworkPendingConsentStageV1DATA>;
export function prepareOriginalPendingConsentStatementPrivate(input:OriginalNetworkPendingConsentInputV1,get?:PendingRegistrationPublicDATAGetterV1):Promise<Uint8Array>;
export function assertOriginalNetworkPendingConsentStageCurrentV1DATA(stage:OriginalNetworkPendingConsentStageV1DATA):Promise<void>;
export function readOriginalNetworkPendingConsentStatementV1DATA(stage:OriginalNetworkPendingConsentStageV1DATA):Uint8Array;
export function inspectOriginalNetworkPendingConsentStageV1DATA(stage:OriginalNetworkPendingConsentStageV1DATA):Readonly<{purpose:typeof NETWORK_RESOURCE_PENDING_CONSENT_SOURCE_PURPOSE;selectionKey:typeof NETWORK_RESOURCE_PENDING_CONSENT_SOURCE_SELECTION_KEY;statementSHA256:string;retired:boolean;closed:boolean;pending:boolean;firstCausePresent:boolean;firstCause:unknown;dataOnly:true;RootAdmission:false;SourceAdmission:false;NativeAdmission:false;approved:false;signed:false;executionAllowed:false}>;
export function retireOriginalNetworkPendingConsentStageV1DATA(stage:OriginalNetworkPendingConsentStageV1DATA):void;
export function joinOriginalNetworkPendingConsentStageV1DATA(stage:OriginalNetworkPendingConsentStageV1DATA):undefined;
export function closeOriginalNetworkPendingConsentStageV1DATA(stage:OriginalNetworkPendingConsentStageV1DATA):undefined;
