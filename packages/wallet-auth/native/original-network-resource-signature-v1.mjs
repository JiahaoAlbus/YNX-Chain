// Fixed Network Resource signature DATA. Reuses sole E5 codec and registered
// dual-PQ math. Neither expected binding nor math proves Source provenance.
import{encodeFields,u32,decodeMember}from'@ynx/batch-v01-candidate';
import{types}from'node:util';
import{inspectPQAuthorizationView}from'../src/pq-wallet-policy.js';
import{verifyPQRegisteredMemberData}from'../src/pq-registered-member.js';
import{canonical}from'./original-auth-identity-source-verifier.mjs';
import{inspectOriginalNetworkResourceScopeV1DATA}from'./original-network-resource-source-contract.mjs';
export const NETWORK_RESOURCE_MANIFEST_DOMAIN_V1='YNX-NETWORK-RESOURCE-MANIFEST/v1';
export const NETWORK_RESOURCE_MANIFEST_PURPOSE_V1='NETWORK-RESOURCE-MANIFEST';
export const NETWORK_RESOURCE_CONSENT_DOMAIN_V1='YNX-NETWORK-RESOURCE-CONSENT/v1';
export const NETWORK_RESOURCE_CONSENT_PURPOSE_V1='NETWORK-RESOURCE-CONSENT';
const bad=(code='NETWORK_RESOURCE_SIGNATURE_DATA_INVALID')=>{throw Object.assign(Error(code),{code});};
function exact(v,keys){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)bad();const d=Object.getOwnPropertyDescriptors(v),own=Reflect.ownKeys(d);if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k)||!d[k].enumerable||!Object.hasOwn(d[k],'value')))bad();}
function decimal(v,positive=false){if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(v)||BigInt(v)>18446744073709551615n||positive&&v==='0')bad();}
function context(b){exact(b,['networkId','canonicalSignerOwner','keyEpoch','issuedHeight']);if(typeof b.networkId!=='string'||!/^[0-9a-f]{64}$/.test(b.networkId)||typeof b.canonicalSignerOwner!=='string'||!/^0x[0-9a-f]{40}$/.test(b.canonicalSignerOwner))bad();decimal(b.keyEpoch,true);decimal(b.issuedHeight);}
function statement(direction,scope,input,atMs,binding){context(binding);const s=inspectOriginalNetworkResourceScopeV1DATA(scope,input,atMs).scope;let domain,purpose,body;
 if(direction==='manifest'){if(binding.keyEpoch!==s.issuer.keyEpoch)bad('NETWORK_RESOURCE_ISSUER_EPOCH_BINDING');domain=NETWORK_RESOURCE_MANIFEST_DOMAIN_V1;purpose=NETWORK_RESOURCE_MANIFEST_PURPOSE_V1;body=canonical({version:1,purpose,protectedResourceRef:s.protectedResourceRef,issuer:s.issuer,manifestOriginal:s.manifestOriginal});}
 else if(direction==='consent'){if(binding.keyEpoch!==s.request.principalKeyEpoch)bad('NETWORK_RESOURCE_PRINCIPAL_EPOCH_BINDING');domain=NETWORK_RESOURCE_CONSENT_DOMAIN_V1;purpose=NETWORK_RESOURCE_CONSENT_PURPOSE_V1;body=canonical({version:1,purpose,scope:s});}
 else bad('NETWORK_RESOURCE_SIGNATURE_DIRECTION');
 // Exact E5 fields, in order. Network is raw32, version big-endian u32;
 // owner/keyEpoch/issuedHeight/body are exact UTF8 strings. No delimiter JSON.
 const message=new Uint8Array(encodeFields([domain,u32(1),Buffer.from(binding.networkId,'hex'),binding.canonicalSignerOwner,binding.keyEpoch,binding.issuedHeight,body]));if(message.byteLength>65536)bad();return{message,purpose};}
export function encodeOriginalNetworkResourceSignatureMessageV1DATA(direction,scope,originalInput,atMs,binding){return statement(direction,scope,originalInput,atMs,binding).message;}
export function inspectOriginalNetworkResourceSignedMemberV1DATA(memberOriginal,direction,scope,originalInput,atMs,binding,independentRegisteredSnapshot){
 const{message,purpose}=statement(direction,scope,originalInput,atMs,binding);
 if(types.isProxy(memberOriginal)||!types.isUint8Array(memberOriginal))bad();const proto=Object.getPrototypeOf(Uint8Array.prototype),b=Object.getOwnPropertyDescriptor(proto,'buffer').get.call(memberOriginal),n=Object.getOwnPropertyDescriptor(proto,'byteLength').get.call(memberOriginal);if(types.isSharedArrayBuffer(b)||n<1||n>262144)bad();const raw=new Uint8Array(n);Uint8Array.prototype.set.call(raw,memberOriginal);const m=decodeMember(Buffer.from(raw));if(m.certificate.N!==1||m.index!==0||m.pathA.length||m.pathB.length)bad('NETWORK_RESOURCE_N1_REQUIRED');
 // Branded snapshot may only be accepted as genuine by the Native owner after
 // its independent issuer/principal Source verification before AND after math.
 inspectPQAuthorizationView(independentRegisteredSnapshot);if(BigInt(binding.issuedHeight)>BigInt(independentRegisteredSnapshot.executionHeight))bad('NETWORK_RESOURCE_SIGNED_HEIGHT_FUTURE');
 const result=verifyPQRegisteredMemberData(independentRegisteredSnapshot,raw,{chainId:binding.networkId,owner:binding.canonicalSignerOwner,keyVersion:binding.keyEpoch,executionHeight:independentRegisteredSnapshot.executionHeight,purpose,message});
 return Object.freeze({direction,purpose,canonicalSignerOwner:binding.canonicalSignerOwner,keyEpoch:binding.keyEpoch,memberCount:1,memberIndex:0,signatureVerified:result.signatureVerified,dataOnly:true,trusted:false,registered:false,current:false,authorized:false,RootAdmission:false,SourceAdmission:false,NativeAdmission:false,productionDisabled:true,rewards:'NOT_AUTHORIZED'});
}
