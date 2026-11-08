import{createOriginalDeviceV4RegistrationClientFromFixedParts}from'./original-product-device-v4-registration-core.js';
// Main-only normal registration orchestration. Fixed Native Source and Auth
// origin; no key, signer, dispatcher, provider, endpoint or approved setter.
import{types}from'node:util';
import{openOriginalProductSessionDeviceV4PendingProofClient}from'./original-product-device-v4-pending-client.js';
import{inspectOriginalProductDeviceV4PendingReviewDATA}from'./original-product-device-v4-pending-review-data.js';
import{createOriginalDeviceIdentityDATA}from'./original-device-create-intent.js';
import{verifyProductSessionApprovalV4Data,verifyProductSessionDeviceRegistrationProofV4Data,verifyProductSessionV4CompletionData}from'./product-session-pq-v4-codec.js';
import{captureVerifiedPQSessionApproval}from'./product-session-account-private.js';
import{ProductSessionGatewayFetchAdapter}from'./product-session-gateway-client.js';
import{canonicalJSON,WalletAuthError}from'./canonical.js';
import{parseProductSessionChallenge,productSessionApprovalDigest}from'./product-session-v2.js';
import registry from'../product-session-registry.json'with{type:'json'};
const origin='https://wallet-auth.ynxweb4.com',originalFetch=globalThis.fetch;
const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get,reason=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'reason').get;
const ta=Object.getPrototypeOf(Uint8Array.prototype),lengthOf=Object.getOwnPropertyDescriptor(ta,'byteLength').get,bufferOf=Object.getOwnPropertyDescriptor(ta,'buffer').get,setBytes=Uint8Array.prototype.set;
const fail=c=>{throw new WalletAuthError(c,c);};
const record=(v,keys)=>{if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('DEVICE_REGISTRATION_EXACT_DATA');const ds=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(ds).length!==keys.length||keys.some(k=>!ds[k]||!Object.hasOwn(ds[k],'value')))fail('DEVICE_REGISTRATION_EXACT_DATA');return Object.fromEntries(keys.map(k=>[k,ds[k].value]));};
const originalContext=v=>{if(!v||types.isProxy(v)||!Object.isFrozen(v))fail('DEVICE_REGISTRATION_ORIGINAL_ABORT_CONTEXT');const c=record(v,['signal']);let stop;try{stop=aborted.call(c.signal);}catch{fail('DEVICE_REGISTRATION_ORIGINAL_ABORT_CONTEXT');}if(stop)throw reason.call(c.signal);return v;};
const bytes=(v,n)=>{if(types.isProxy(v)||!types.isUint8Array(v)||types.isSharedArrayBuffer(bufferOf.call(v)))fail('DEVICE_REGISTRATION_ORIGINAL_BYTES');const length=lengthOf.call(v);if(n?length!==n:!length||length>98304)fail('DEVICE_REGISTRATION_ORIGINAL_BYTES');const out=Buffer.alloc(length);try{setBytes.call(out,v);}catch{fail('DEVICE_REGISTRATION_ORIGINAL_BYTES');}return out;};
function operationMethod(op,name){if(!op||types.isProxy(op))fail('DEVICE_REGISTRATION_NATIVE_OPERATION_REQUIRED');const d=Object.getOwnPropertyDescriptor(op,name);if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function')fail('DEVICE_REGISTRATION_NATIVE_OPERATION_REQUIRED');return d.value.call(op);}
const parseOriginal=(raw,max)=>{if(typeof raw!=='string'||!raw.length||Buffer.byteLength(raw)>max)fail('DEVICE_REGISTRATION_ORIGINAL_REQUIRED');const v=JSON.parse(raw);if(canonicalJSON(v)!==raw)fail('DEVICE_REGISTRATION_CANONICAL_REQUIRED');return v;};

/** Zero input. A failure's original Native partial remains caller-owned.
 * Main must retain its independent account permission/current scope and durable
 * approval/whole-request journal before submitPreparedPair. This module does
 * not certify a caller's disk durability or provide cross-process replay rights.
 */
export async function openOriginalProductDeviceV4RegistrationClient(...args){
 if(args.length)fail('DEVICE_REGISTRATION_ZERO_INPUT');
 const pending=await openOriginalProductSessionDeviceV4PendingProofClient();
 const gateway=new ProductSessionGatewayFetchAdapter({endpoint:origin,fetch:(...a)=>originalFetch(...a),walletInstalled:async()=>false,schemeRegistered:async()=>false,timeoutMs:30000});
 return createOriginalDeviceV4RegistrationClientFromFixedParts(Object.freeze({pending,gateway,record,originalContext,bytes,operationMethod,parseOriginal,isProxy:types.isProxy,copyBytes:v=>Buffer.from(v),byteLength:s=>Buffer.byteLength(s),toHex:b=>b.toString('hex'),toBase64url:b=>b.toString('base64url'),nowMS:()=>Date.now(),createOriginalDeviceIdentityDATA,verifyProductSessionApprovalV4Data,verifyProductSessionDeviceRegistrationProofV4Data,verifyProductSessionV4CompletionData,captureVerifiedPQSessionApproval,inspectOriginalProductDeviceV4PendingReviewDATA,finishProofForTransport:()=>pending.close(),closeOriginalResources:()=>pending.close()}));
}
