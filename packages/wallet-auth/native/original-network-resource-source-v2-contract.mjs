// Finite Source-v2 Resource DATA. No Source/factory/protected original is minted.
import{types}from'node:util';import{canonical}from'./original-auth-identity-source-verifier.mjs';
import{inspectOriginalNetworkResourceScopeV1DATA,inspectOriginalNetworkResourceExecutionV1DATA,NETWORK_RESOURCE_SOURCE_PURPOSE,NETWORK_RESOURCE_SOURCE_SELECTION_KEY,NETWORK_RESOURCE_SOURCE_OPERATIONS}from'./original-network-resource-source-contract.mjs';
import{encodeOriginalNetworkResourceSignatureMessageV1DATA,inspectOriginalNetworkResourceSignedMemberV1DATA}from'./original-network-resource-signature-v1.mjs';
import{inspectPQAuthorizationView}from'../src/pq-wallet-policy.js';
export{NETWORK_RESOURCE_SOURCE_PURPOSE,NETWORK_RESOURCE_SOURCE_SELECTION_KEY,NETWORK_RESOURCE_SOURCE_OPERATIONS};
export const NETWORK_RESOURCE_INPUT_ORIGINAL_KEY='resource.input.original';
const bad=(c='NETWORK_RESOURCE_SOURCE_V2_DATA_INVALID')=>{throw Object.assign(Error(c),{code:c});};
function exact(v,keys){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)bad();const d=Object.getOwnPropertyDescriptors(v),own=Reflect.ownKeys(d);if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k)||!d[k].enumerable||!Object.hasOwn(d[k],'value')))bad();}
function token(v){if(typeof v!=='string'||! /^[A-Za-z0-9._:-]{1,128}$/.test(v))bad();}
const owner=v=>{if(typeof v!=='string'||!/^0x[0-9a-f]{40}$/.test(v))bad();};
const hex=(v,n=64)=>{if(typeof v!=='string'||!new RegExp('^[0-9a-f]{'+n+'}$').test(v))bad();};
function dec(v,positive=false){if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(v)||BigInt(v)>18446744073709551615n||positive&&v==='0')bad();return BigInt(v);}
const tp=Object.getPrototypeOf(Uint8Array.prototype),length=Object.getOwnPropertyDescriptor(tp,'byteLength').get,buffer=Object.getOwnPropertyDescriptor(tp,'buffer').get;
function bytes(v,cap){if(types.isProxy(v)||!types.isUint8Array(v))bad('NETWORK_RESOURCE_ACTUAL_ORIGINALS_REQUIRED');const n=length.call(v);if(!n||n>cap||types.isSharedArrayBuffer(buffer.call(v)))bad('NETWORK_RESOURCE_ACTUAL_ORIGINALS_REQUIRED');const b=new Uint8Array(n);Uint8Array.prototype.set.call(b,v);return Buffer.from(b);}
function text(b){try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b);}catch{bad('NETWORK_RESOURCE_ACTUAL_UTF8_REQUIRED');}}
function identity(v){exact(v,['runtimeKind','appId','productId','platform','vnode','imageSHA256']);if(v.runtimeKind!=='go-native'||typeof v.appId!=='string'||!/^[A-Za-z][A-Za-z0-9.-]{2,131}$/.test(v.appId)||typeof v.productId!=='string'||!/^[a-z][a-z0-9-]{1,31}$/.test(v.productId)||!['macos','linux','windows'].includes(v.platform))bad('NETWORK_RESOURCE_GO_CONSUMER_REQUIRED');exact(v.vnode,['device','inode']);dec(v.vnode.device);dec(v.vnode.inode,true);hex(v.imageSHA256);}
function inputRef(v,scope){exact(v,['key','protectedResourceRef','leaf']);if(v.key!==NETWORK_RESOURCE_INPUT_ORIGINAL_KEY||v.protectedResourceRef!==scope.protectedResourceRef)bad('NETWORK_RESOURCE_INPUT_REF');token(v.protectedResourceRef);exact(v.leaf,['device','inode','uid','gid','mode','nlink','bytes','sha3_512','sha512']);for(const k of['device','uid','gid'])dec(v.leaf[k]);dec(v.leaf.inode,true);const mode=dec(v.leaf.mode,true);if((mode&61440n)!==32768n||(mode&18n)!==0n||v.leaf.nlink!=='1')bad('NETWORK_RESOURCE_INPUT_CUSTODY');dec(v.leaf.bytes,true);hex(v.leaf.sha3_512,128);hex(v.leaf.sha512,128);}
function current(v,s,at){exact(v,['sourceId','instanceId','resourceKey','epoch','sequence','head','status','issuedAtMs','expiresAtMs']);if(v.sourceId!==s.sourceId||v.instanceId!==s.instanceId||v.resourceKey!==s.resourceScope.protectedResourceRef||v.epoch!==s.currentFloor.epoch||dec(v.sequence,true)<dec(s.currentFloor.minimumSequence,true)||v.sequence===s.currentFloor.minimumSequence&&v.head!==s.currentFloor.head)bad('NETWORK_RESOURCE_PROTECTED_CURRENT_CHANGED');hex(v.head);if(v.status!=='active')bad('NETWORK_RESOURCE_PROTECTED_CURRENT_REVOKED');if(!Number.isSafeInteger(v.issuedAtMs)||!Number.isSafeInteger(v.expiresAtMs)||v.issuedAtMs<0||v.expiresAtMs<=v.issuedAtMs||v.expiresAtMs-v.issuedAtMs>30000||at<v.issuedAtMs||at>=v.expiresAtMs)bad('NETWORK_RESOURCE_PROTECTED_CURRENT_EXPIRED');}
const ORIGINALS=['manifestOriginal','consentOriginal','inputOriginal','originalInputRef','nativeConsumerIdentity','sourceCurrent','issuerMapping','principalMapping','issuerCurrent','principalCurrent','issuerRegistration','principalRegistration','once'];
/** Capture bytes BEFORE async public fetch/signing. Registration views must already
 * be independently acquired SDK-branded snapshots; parsed DATA is never provenance. */
const captures=new WeakMap(),transportDATA=new WeakSet();
function cloneDATA(v,depth=0){
 if(depth>20)bad('NETWORK_RESOURCE_CAPTURE_DEPTH');
 if(v===null||typeof v==='string'||typeof v==='boolean'||Number.isSafeInteger(v))return v;
 if(Array.isArray(v)&&!types.isProxy(v)&&Object.getPrototypeOf(v)===Array.prototype){const d=Object.getOwnPropertyDescriptors(v),n=d.length.value;if(n>128||Reflect.ownKeys(d).length!==n+1)bad('NETWORK_RESOURCE_CAPTURE_DATA');const out=[];for(let i=0;i<n;i++){const x=d[String(i)];if(!x||!x.enumerable||!Object.hasOwn(x,'value'))bad('NETWORK_RESOURCE_CAPTURE_DATA');out.push(cloneDATA(x.value,depth+1));}return Object.freeze(out);}
 if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)bad('NETWORK_RESOURCE_CAPTURE_DATA');
 const d=Object.getOwnPropertyDescriptors(v),out={};
 for(const k of Reflect.ownKeys(d)){if(typeof k!=='string'||!d[k].enumerable||!Object.hasOwn(d[k],'value'))bad('NETWORK_RESOURCE_CAPTURE_DATA');Object.defineProperty(out,k,{value:cloneDATA(d[k].value,depth+1),enumerable:true});}
 return Object.freeze(out);
}
function snapshot(v){
 exact(v,ORIGINALS);if(transportDATA.has(v))bad('NETWORK_RESOURCE_TRANSPORT_IS_NOT_ORIGINALS');
 for(const k of ['issuerRegistration','principalRegistration']){if(types.isProxy(v[k]))bad('NETWORK_RESOURCE_REGISTRATION_REQUIRED');inspectPQAuthorizationView(v[k]);}
 exact(v.issuerMapping,['canonicalIssuer','signatureBinding','memberOriginal']);exact(v.principalMapping,['principal','subjectOwner','signatureBinding','memberOriginal']);
 const mapping=m=>{exact(m.signatureBinding,['networkId','canonicalSignerOwner','keyEpoch','issuedHeight']);const out={};for(const k of Object.keys(m))out[k]=k==='memberOriginal'?bytes(m[k],262144):cloneDATA(m[k]);return Object.freeze(out);};
 const out={};for(const k of ORIGINALS)out[k]=['manifestOriginal','consentOriginal','inputOriginal'].includes(k)?bytes(v[k],k==='inputOriginal'?4194304:16384):['issuerMapping','principalMapping'].includes(k)?mapping(v[k]):['issuerRegistration','principalRegistration'].includes(k)?v[k]:cloneDATA(v[k]);return Object.freeze(out);
}
function fingerprint(v){const out={};for(const k of ORIGINALS)out[k]=['manifestOriginal','consentOriginal','inputOriginal'].includes(k)?Buffer.from(v[k]).toString('base64url'):['issuerMapping','principalMapping'].includes(k)?{...v[k],memberOriginal:Buffer.from(v[k].memberOriginal).toString('base64url')}:['issuerRegistration','principalRegistration'].includes(k)?inspectPQAuthorizationView(v[k]):v[k];return canonical(out);}
export function captureOriginalNetworkResourceOriginalsV1DATA(v){
 if(captures.has(v)){assertOriginalNetworkResourceOriginalsCurrentV1DATA(v);return v;}
 const out=snapshot(v);captures.set(out,{original:v,pin:fingerprint(out),issuer:v.issuerRegistration,principal:v.principalRegistration});return out;
}
/** Synchronous fence after every foreign/async observation. Never recapture a
 * changed original as a new baseline; same held capture, same branded views. */
export function assertOriginalNetworkResourceOriginalsCurrentV1DATA(v,observed=undefined){
 const r=captures.get(v);if(!r)bad('NETWORK_RESOURCE_CAPTURE_REQUIRED');
 if(r.original.issuerRegistration!==r.issuer||r.original.principalRegistration!==r.principal||fingerprint(snapshot(r.original))!==r.pin||fingerprint(v)!==r.pin)bad('NETWORK_RESOURCE_ORIGINALS_CHANGED');
 if(observed!==undefined&&(observed.issuerRegistration!==r.issuer||observed.principalRegistration!==r.principal||fingerprint(snapshot(observed))!==r.pin))bad('NETWORK_RESOURCE_ORIGINALS_CHANGED');
 return undefined;
}
/** Sole fe3 Scope/Work/Consent/signature DATA is reused; none is reconstructed
 * from received Work DTOs. Actual Native owner separately proves all custody. */
export function inspectOriginalNetworkResourceSourceScopeV2DATA(value,association,networkId,subjectOwner,sourceId,instanceId,issuedAtMs,expiresAtMs,atMs,actualOriginals){
 value=cloneDATA(value);association=cloneDATA(association);
 exact(value,['version','networkId','subjectOwner','sourceId','instanceId','operation','originalInputRef','nativeConsumerIdentity','currentFloor','issuerSignerOwner','principalSignerOwner','resourceScope']);if(value.version!==1||value.operation!=='resource.public-block-histogram'||value.networkId!==networkId||value.subjectOwner!==subjectOwner||value.sourceId!==sourceId||value.instanceId!==instanceId)bad('NETWORK_RESOURCE_SOURCE_BINDING');hex(networkId);owner(subjectOwner);token(sourceId);token(instanceId);owner(value.issuerSignerOwner);owner(value.principalSignerOwner);identity(value.nativeConsumerIdentity);inputRef(value.originalInputRef,value.resourceScope);exact(value.currentFloor,['epoch','minimumSequence','head']);dec(value.currentFloor.epoch,true);dec(value.currentFloor.minimumSequence,true);hex(value.currentFloor.head);
 if(!actualOriginals)bad('NETWORK_RESOURCE_ACTUAL_ORIGINALS_NOT_SUPPLIED');const o=captureOriginalNetworkResourceOriginalsV1DATA(actualOriginals);identity(o.nativeConsumerIdentity);inputRef(o.originalInputRef,value.resourceScope);if(canonical(o.nativeConsumerIdentity)!==canonical(value.nativeConsumerIdentity)||canonical(o.originalInputRef)!==canonical(value.originalInputRef))bad('NETWORK_RESOURCE_ACTUAL_CAPTURE_CHANGED');
 if(association.account!==subjectOwner||association.applicationId!==value.nativeConsumerIdentity.appId||association.productId!==value.nativeConsumerIdentity.productId||association.platform!==value.nativeConsumerIdentity.platform)bad('NETWORK_RESOURCE_CONSUMER_BINDING');
 if(text(o.manifestOriginal)!==value.resourceScope.manifestOriginal||text(o.consentOriginal)!==value.resourceScope.consentOriginal)bad('NETWORK_RESOURCE_ACTUAL_ORIGINAL_BYTES_CHANGED');const data=inspectOriginalNetworkResourceScopeV1DATA(value.resourceScope,o.inputOriginal,atMs),w=JSON.parse(value.resourceScope.manifestOriginal);for(const k of['bytes','sha3_512','sha512'])if(value.originalInputRef.leaf[k]!==w.input[k])bad('NETWORK_RESOURCE_INPUT_REF_BINDING');current(o.sourceCurrent,value,atMs);
 if(o.issuerMapping.canonicalIssuer!==data.scope.issuer.canonicalIssuer||o.principalMapping.principal!==data.scope.request.principal||o.principalMapping.subjectOwner!==subjectOwner||o.issuerMapping.signatureBinding.canonicalSignerOwner!==value.issuerSignerOwner||o.principalMapping.signatureBinding.canonicalSignerOwner!==value.principalSignerOwner||o.issuerMapping.signatureBinding.networkId!==networkId||o.principalMapping.signatureBinding.networkId!==networkId)bad('NETWORK_RESOURCE_INDEPENDENT_SIGNER_MAPPING');
 inspectOriginalNetworkResourceSignedMemberV1DATA(o.issuerMapping.memberOriginal,'manifest',data.scope,o.inputOriginal,atMs,o.issuerMapping.signatureBinding,o.issuerRegistration);inspectOriginalNetworkResourceSignedMemberV1DATA(o.principalMapping.memberOriginal,'consent',data.scope,o.inputOriginal,atMs,o.principalMapping.signatureBinding,o.principalRegistration);
 inspectOriginalNetworkResourceExecutionV1DATA(data.scope,o.inputOriginal,o.issuerCurrent,o.principalCurrent,o.once,atMs);
 const effectExpiresAtMs=Math.min(Date.parse(w.expiresAt),Date.parse(JSON.parse(data.scope.consentOriginal).expiresAt),o.sourceCurrent.expiresAtMs,o.issuerCurrent.expiresAtMs,o.principalCurrent.expiresAtMs);if(!Number.isSafeInteger(issuedAtMs)||!Number.isSafeInteger(expiresAtMs)||issuedAtMs<0||issuedAtMs>=expiresAtMs||atMs<issuedAtMs||expiresAtMs>effectExpiresAtMs||atMs>=expiresAtMs)bad('NETWORK_RESOURCE_SOURCE_WINDOW');
 assertOriginalNetworkResourceOriginalsCurrentV1DATA(o);
 return Object.freeze({scopeOriginal:canonical(value),scope:value,effectExpiresAtMs,dataOnly:true,authorized:false,RootAdmission:false,SourceAdmission:false,NativeAdmission:false,productionDisabled:true,rewards:'NOT_AUTHORIZED'});
}
/** PUBLIC stdin serialization only; no Go/Native transport compatibility or
 * protected Source is implied. Existing overall stdin2MiB cap stays unchanged. */
export function decodeOriginalNetworkResourceOriginalsTransportV1DATA(v){
 exact(v,ORIGINALS);const decode=(s,cap)=>{if(typeof s!=='string'||!/^[A-Za-z0-9_-]+$/.test(s)||s.length>Math.ceil(cap*4/3))bad('NETWORK_RESOURCE_ORIGINALS_TRANSPORT');const b=Buffer.from(s,'base64url');if(!b.length||b.length>cap||b.toString('base64url')!==s)bad('NETWORK_RESOURCE_ORIGINALS_TRANSPORT');return b;};
 // This codec deliberately does not parse/brand received registration DTOs.
 // No chain-id default and no trust derived from a signer mapping in the DTO.
 const d=cloneDATA(v),o={...d,manifestOriginal:decode(d.manifestOriginal,16384),consentOriginal:decode(d.consentOriginal,16384),inputOriginal:decode(d.inputOriginal,4194304),issuerMapping:Object.freeze({...d.issuerMapping,memberOriginal:decode(d.issuerMapping.memberOriginal,262144)}),principalMapping:Object.freeze({...d.principalMapping,memberOriginal:decode(d.principalMapping.memberOriginal,262144)})};Object.freeze(o);transportDATA.add(o);return o;
}
/** Exact fe3 E5 message bytes for the original consent direction. DATA only;
 * Native's held typed NETWORK-RESOURCE-CONSENT keeper is independently needed. */
export function readOriginalNetworkResourceUnsignedConsentV1DATA(value,association,networkId,subjectOwner,sourceId,instanceId,issuedAtMs,expiresAtMs,atMs,actualOriginals){
 const o=captureOriginalNetworkResourceOriginalsV1DATA(actualOriginals),checked=inspectOriginalNetworkResourceSourceScopeV2DATA(value,association,networkId,subjectOwner,sourceId,instanceId,issuedAtMs,expiresAtMs,atMs,o);
 const result=encodeOriginalNetworkResourceSignatureMessageV1DATA('consent',checked.scope.resourceScope,o.inputOriginal,atMs,o.principalMapping.signatureBinding);assertOriginalNetworkResourceOriginalsCurrentV1DATA(o);return new Uint8Array(result);
}
