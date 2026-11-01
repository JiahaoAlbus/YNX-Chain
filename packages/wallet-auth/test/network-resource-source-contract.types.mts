import {encodeOriginalNetworkResourceManifestV1DATA,inspectOriginalNetworkResourceExecutionV1DATA}from'../src/network-resource-source-v1.js';
import type{NetworkResourceWorkV1,NetworkResourceScopeV1,NetworkResourceIssuerCurrentV1,NetworkResourcePrincipalCurrentV1,NetworkResourceOnceV1}from'../src/network-resource-source-v1.js';
import type{RequiredOriginalNetworkResourceNativeABI,OriginalNetworkResourceNativeOutcome,OriginalNetworkResourceSourceOwner}from'../native/original-network-resource-source-private.mjs';
declare const w:NetworkResourceWorkV1,s:NetworkResourceScopeV1,i:Uint8Array,c:NetworkResourceIssuerCurrentV1,p:NetworkResourcePrincipalCurrentV1,o:NetworkResourceOnceV1,n:OriginalNetworkResourceNativeOutcome<OriginalNetworkResourceSourceOwner>;
const m=encodeOriginalNetworkResourceManifestV1DATA(w,i,0),e=inspectOriginalNetworkResourceExecutionV1DATA(s,i,c,p,o,0);
const disabled:true=e.productionDisabled,noGrant:false=e.authorized,reward:'NOT_AUTHORIZED'=e.rewards;
if(n.errorPresent){const first:unknown=n.error;void first;}else{const owner:OriginalNetworkResourceSourceOwner|null=n.owner;void owner;}
// @ts-expect-error only fixed P09 interpreter, never supplied code.
const arbitrary:NetworkResourceWorkV1={...w,kind:'shell'};
// @ts-expect-error limits use lossless original decimal strings.
const numeric:NetworkResourceWorkV1={...w,limits:{...w.limits,cpuMilli:500}};
// @ts-expect-error data cannot become Native resource authority.
const grant:{authorized:true}=e;
// @ts-expect-error key epoch does not use a potentially rounded Number.
const epoch:number=s.issuer.keyEpoch;
// @ts-expect-error private Native source is not a public plain DTO.
const fakeNative:OriginalNetworkResourceSourceOwner={current(){},retire(){}};
// @ts-expect-error required private ABI is not an endpoint/provider setter.
const abi:RequiredOriginalNetworkResourceNativeABI={provider(){}};
void[m,disabled,noGrant,reward,arbitrary,numeric,grant,epoch,fakeNative,abi];

import{encodeOriginalNetworkResourceSignatureMessageV1DATA}from'../native/original-network-resource-signature-v1.mjs';
import type{NetworkResourceSignatureBindingV1}from'../native/original-network-resource-signature-v1.mjs';
const signatureBinding:NetworkResourceSignatureBindingV1={networkId:'ab'.repeat(32),canonicalSignerOwner:'0x'+'12'.repeat(20),keyEpoch:'1',issuedHeight:'20'};
// @ts-expect-error unknown signature domain/direction cannot enter finite API
encodeOriginalNetworkResourceSignatureMessageV1DATA('TX',{} as NetworkResourceScopeV1,new Uint8Array(),0,signatureBinding);
// @ts-expect-error full-u64 epoch stays string
const roundedBinding:NetworkResourceSignatureBindingV1={...signatureBinding,keyEpoch:9007199254740992};
void roundedBinding;
