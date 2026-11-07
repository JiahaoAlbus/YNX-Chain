// Private DATA composition only. This function does not create a Native loan,
// accept a provider/callback, authenticate its caller, load an image, or publish.
import{types}from'node:util';
import{canonical}from'./original-auth-identity-source-verifier.mjs';
import{decodeWPRRegistrationCaptureOriginalDATA}from'./original-wallet-product-registration-capture.mjs';
import{materializeOriginalWalletProductPublicDATA}from'../src/original-wallet-product-materializer-data.js';
const fail=c=>{throw Object.assign(Error(c),{code:c})};
function exact(value,keys){if(!value||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)fail('WPR_HOST_DATA_SCHEMA');const ds=Object.getOwnPropertyDescriptors(value);if(Reflect.ownKeys(ds).length!==keys.length||keys.some(k=>!ds[k]?.enumerable||!Object.hasOwn(ds[k],'value')))fail('WPR_HOST_DATA_SCHEMA');}
function bytes(value,cap){if(types.isProxy(value)||!types.isUint8Array(value))fail('WPR_HOST_ORIGINAL_BYTES');const p=Object.getPrototypeOf(Uint8Array.prototype),buffer=Object.getOwnPropertyDescriptor(p,'buffer').get.call(value),length=Object.getOwnPropertyDescriptor(p,'byteLength').get.call(value),offset=Object.getOwnPropertyDescriptor(p,'byteOffset').get.call(value);if(types.isSharedArrayBuffer(buffer)||!length||length>cap)fail('WPR_HOST_ORIGINAL_BYTES');const copy=new Uint8Array(length);Uint8Array.prototype.set.call(copy,new Uint8Array(buffer,offset,length));return copy;}
function text(value,cap){return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes(value,cap));}
function original(value,cap){const s=text(value,cap);let v;try{v=JSON.parse(s);}catch{fail('WPR_HOST_ORIGINAL_JSON');}if(canonical(v)!==s)fail('WPR_HOST_ORIGINAL_CANONICAL');return v;}
export function assembleOriginalWPRMaterializationDATA(actualReply){
 // The normal Host must obtain this from its SAME branded Native owner and
 // enforce Native current before/after. Pure mathematics cannot grant custody.
 const reply=actualReply;
 exact(reply,['version','lease','originals','currentOriginal','registrationCaptureOriginal','expectedInputOriginal','independentOriginal','buildOriginals','errorPresent','firstCausePresent','firstCause','retired','physicalDone','dataOnly','RootAdmission','SourceAdmission','NativeAdmission']);
 if(!reply||types.isProxy(reply)||reply.version!=='YNX-WPR-MATERIALIZATION-RPC/v1'||reply.errorPresent!==false||reply.firstCausePresent!==false||reply.retired!==false||reply.physicalDone!==false||reply.dataOnly!==true||reply.RootAdmission!==false||reply.SourceAdmission!==false||reply.NativeAdmission!==false)fail('WPR_HOST_NATIVE_LIVE_REPLY_REQUIRED');
 exact(reply.originals,['root','enrollment','profile','acquisitionHead']);
 const input=original(reply.expectedInputOriginal,2097152),metadata=original(reply.independentOriginal,2097152),current=text(reply.currentOriginal,393216);
 exact(metadata,['expectedContext','approvals','build','independentBuildOriginal']);
 if(input.rootRaw!==reply.originals.root||input.enrollmentRaw!==reply.originals.enrollment||input.profileRaw!==reply.originals.profile||input.headRaw!==reply.originals.acquisitionHead)fail('WPR_HOST_SAME_CAPTURED_ORIGINALS');
 const observed=decodeWPRRegistrationCaptureOriginalDATA(bytes(reply.registrationCaptureOriginal,33554432),input,metadata.expectedContext,current);
 // Extract only untrusted DATA nonce from the historical head. The sole WPR1
 // transition verifier below independently authenticates the whole envelope.
 let acquisitionNonce;try{const envelope=JSON.parse(input.headRaw);const body=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.from(envelope.body,'base64url')));acquisitionNonce=body.nonce;}catch{fail('WPR_HOST_BASELINE_NONCE_DATA');}
 exact(reply.buildOriginals,['root','enrollment','verifier','node','runtimeManifest','dispatch']);
 const caps={root:16384,enrollment:393216,verifier:131072,node:134217728,runtimeManifest:1048576,dispatch:16777216};let total=0;const buildOriginals={};for(const[k,cap]of Object.entries(caps)){buildOriginals[k]=bytes(reply.buildOriginals[k],cap);total+=buildOriginals[k].byteLength;if(total>153092096)fail('WPR_HOST_FIXED_BUILD_CAPACITY');}
 const data={originals:{...reply.originals,freshCurrent:current},policy:input.policy,registrations:{acquisition:observed.before,fresh:observed.after},currentContext:{acquisitionNonce,freshNonce:observed.nonce,previous:{sequence:0,floor:0,head:'',timeFloor:0,executionHeight:'0'},atMs:observed.atMs},approvals:metadata.approvals,build:metadata.build,independentBuildOriginal:metadata.independentBuildOriginal,buildOriginals};
 // Same historical-zero baseline as the original capture math. It does NOT
 // reset Native sequence/floor; sole decode already rechecked the independently
 // retained Native previous and merged-current floor above.
 const result=materializeOriginalWalletProductPublicDATA(data);
 return Object.freeze({data,result,dataOnly:true,RootAdmission:false,SourceAdmission:false,NativeAdmission:false});
}
