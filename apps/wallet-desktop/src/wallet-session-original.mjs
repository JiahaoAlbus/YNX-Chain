import {canonicalJSON,productSessionRequestDigest,parseProductSessionRequest,evmAddressFromYNX} from '@ynx-chain/wallet-auth';
import {PRODUCT_SESSION_REGISTRY} from './wallet-auth-contract.mjs';
const fail=()=>{throw Object.assign(new Error('The retained session original is invalid.'),{code:'SESSION_ORIGINAL_INVALID'});};
const exact=(value,keys)=>{if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).sort().join()!==keys.sort().join())fail();};
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export const SESSION_ORIGINAL_RESERVE_BYTES=270000;
export function sessionOriginalCause(value){
 // Preserve falsy first causes, but never persist an untrusted exception's
 // payload/message (which could contain signed bytes or a secret).
 if(value===null||['boolean','number','string','undefined'].includes(typeof value))return {kind:typeof value,value:typeof value==='string'?(value===''?'':'redacted'):value===undefined?null:value,code:null};
 const d=Object.getOwnPropertyDescriptor(value??{},'code'),data=Object.getOwnPropertyDescriptor(value??{},'data'),nested=data&&Object.hasOwn(data,'value')&&data.value&&typeof data.value==='object'?Object.getOwnPropertyDescriptor(data.value,'code'):null;
 const code=d&&Object.hasOwn(d,'value')&&typeof d.value==='string'?d.value:nested&&Object.hasOwn(nested,'value')?nested.value:null;
 return {kind:'error',value:null,code:typeof code==='string'&&/^[A-Za-z0-9_:-]{1,128}$/.test(code)?code:null};
}
export function parseSessionOriginal(value){
 exact(value,['version','account','requestId','requestDigest','request','createdAt','approval','deliveryAttempted','cleanupComplete','firstCause','storageCause','cleanupCause']);
 if(value.version!==1||!/^0x[0-9a-f]{40}$/.test(value.account??'')||typeof value.requestId!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(value.requestId)||typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt))||new Date(value.createdAt).toISOString()!==value.createdAt||typeof value.deliveryAttempted!=='boolean'||typeof value.cleanupComplete!=='boolean')fail();
 const request=parseProductSessionRequest(PRODUCT_SESSION_REGISTRY,value.request,new Date(value.createdAt));
 if(value.requestDigest!==productSessionRequestDigest(PRODUCT_SESSION_REGISTRY,request,new Date(value.createdAt)))fail();
 if(value.approval!==null){
  const a=value.approval;if(!a||!['2','3'].includes(a.version)||a.result!=='approved'||a.requestDigest!==value.requestDigest||evmAddressFromYNX(a.account)!==value.account||Buffer.byteLength(canonicalJSON(a))>262144)fail();
 }
 for(const cause of [value.firstCause,value.storageCause,value.cleanupCause])if(cause!==null){exact(cause,['kind','value','code']);if(!['error','object','undefined','boolean','number','string'].includes(cause.kind)||cause.code!==null&&(typeof cause.code!=='string'||!/^[A-Za-z0-9_:-]{1,128}$/.test(cause.code))||cause.value!==null&&!['string','number','boolean'].includes(typeof cause.value))fail();}
 if(Buffer.byteLength(canonicalJSON(value))>SESSION_ORIGINAL_RESERVE_BYTES)fail();
 // Disk structure is NOT policy/crypto authority. Fresh SDK verification is
 // mandatory before the original approval may reach a callback again.
 return freeze(JSON.parse(canonicalJSON({...value,request})));
}
