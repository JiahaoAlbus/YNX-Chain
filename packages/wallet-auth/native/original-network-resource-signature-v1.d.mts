import type{NetworkResourceScopeV1}from'./original-network-resource-source-contract.mjs';
export const NETWORK_RESOURCE_MANIFEST_DOMAIN_V1:'YNX-NETWORK-RESOURCE-MANIFEST/v1';
export const NETWORK_RESOURCE_MANIFEST_PURPOSE_V1:'NETWORK-RESOURCE-MANIFEST';
export const NETWORK_RESOURCE_CONSENT_DOMAIN_V1:'YNX-NETWORK-RESOURCE-CONSENT/v1';
export const NETWORK_RESOURCE_CONSENT_PURPOSE_V1:'NETWORK-RESOURCE-CONSENT';
/** Independently protected text-identity -> canonical signer mapping. Never derived from Work, member certificate or consumer JSON. */
export interface NetworkResourceSignatureBindingV1{readonly networkId:string;readonly canonicalSignerOwner:string;readonly keyEpoch:string;readonly issuedHeight:string;}
export function encodeOriginalNetworkResourceSignatureMessageV1DATA(direction:'manifest'|'consent',scope:NetworkResourceScopeV1,originalInput:Uint8Array,atMs:number,binding:NetworkResourceSignatureBindingV1):Uint8Array;
export function inspectOriginalNetworkResourceSignedMemberV1DATA(member:Uint8Array,direction:'manifest'|'consent',scope:NetworkResourceScopeV1,originalInput:Uint8Array,atMs:number,binding:NetworkResourceSignatureBindingV1,independentRegisteredSnapshot:unknown):Readonly<{direction:'manifest'|'consent';purpose:string;canonicalSignerOwner:string;keyEpoch:string;memberCount:1;memberIndex:0;signatureVerified:true;dataOnly:true;trusted:false;registered:false;current:false;authorized:false;RootAdmission:false;SourceAdmission:false;NativeAdmission:false;productionDisabled:true;rewards:'NOT_AUTHORIZED'}>;
