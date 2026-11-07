// Paired server/mobile DATA carrier. The existing response16 commits to these
// exact transport bytes. This codec never authenticates a receipt or Source.
import {types} from 'node:util';
import {canonicalJSON} from './canonical.js';
export const AI_RESPONSE_ORIGINALS_CARRIER_V6='YNX-AI-TASK-V6-RESPONSE-ORIGINALS/v1';
export const AI_RESPONSE_ORIGINALS_CARRIER_LIMIT_V6=1048576;
const fields=['version','bodyOriginalBase64url','outcomeMetadataOriginalBase64url','businessReceiptOriginalBase64url'];
const bad=()=>{throw Object.assign(Error('AI_V6_RESPONSE_ORIGINALS_CARRIER_INVALID'),{code:'AI_V6_RESPONSE_ORIGINALS_CARRIER_INVALID'});};
function record(v,keys){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)bad();const d=Object.getOwnPropertyDescriptors(v),own=Reflect.ownKeys(d);if(own.length!==keys.length||own.some(k=>!keys.includes(k)||!Object.hasOwn(d[k],'value')||!d[k].enumerable))bad();return Object.fromEntries(keys.map(k=>[k,d[k].value]));}
const ta=Object.getPrototypeOf(Uint8Array.prototype),length=Object.getOwnPropertyDescriptor(ta,'byteLength').get,buffer=Object.getOwnPropertyDescriptor(ta,'buffer').get;
function bytes(v,cap){if(types.isProxy(v)||!types.isUint8Array(v))bad();let n,b;try{n=length.call(v);b=buffer.call(v);}catch{bad();}if(types.isSharedArrayBuffer(b)||n>cap)bad();const out=new Uint8Array(n);try{Uint8Array.prototype.set.call(out,v);}catch{bad();}return out;}
function parse(raw,cap){const b=bytes(raw,cap);let s,v;try{s=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b);v=JSON.parse(s);}catch{bad();}if(canonicalJSON(v)!==s)bad();return v;}
function metadata(raw){const b=bytes(raw,16384),v=record(parse(b,16384),['state','action','businessAction','completionScope','requestRef']);if(!['COMMITTED','ACCEPTED','OBSERVED','DENIED','UNKNOWN'].includes(v.state)||typeof v.action!=='string'||!v.action||!v.action.isWellFormed()||['businessAction','completionScope','requestRef'].some(k=>v[k]!==null&&(typeof v[k]!=='string'||!v[k].isWellFormed())))bad();return b;}
const b64=b=>Buffer.from(b).toString('base64url');
function un64(s,cap){if(typeof s!=='string'||s.length>Math.ceil(cap*4/3)||!/^[A-Za-z0-9_-]*$/.test(s))bad();const b=Buffer.from(s,'base64url');if(b.length>cap||b64(b)!==s)bad();return new Uint8Array(b);}
export function encodeOriginalAITaskResponseCarrierV6DATA(input){
 const v=record(input,['bodyOriginal','outcomeMetadataOriginal','businessReceiptOriginal']);
 const body=bytes(v.bodyOriginal,1048576),m=metadata(v.outcomeMetadataOriginal),receipt=v.businessReceiptOriginal===null?null:bytes(v.businessReceiptOriginal,1048576);
 const raw=new TextEncoder().encode(canonicalJSON({version:AI_RESPONSE_ORIGINALS_CARRIER_V6,bodyOriginalBase64url:b64(body),outcomeMetadataOriginalBase64url:b64(m),businessReceiptOriginalBase64url:receipt===null?null:b64(receipt)}));
 if(raw.length>AI_RESPONSE_ORIGINALS_CARRIER_LIMIT_V6)bad();return raw;
}
export function decodeOriginalAITaskResponseCarrierV6DATA(transportOriginal){
 const raw=bytes(transportOriginal,AI_RESPONSE_ORIGINALS_CARRIER_LIMIT_V6),v=record(parse(raw,AI_RESPONSE_ORIGINALS_CARRIER_LIMIT_V6),fields);
 if(v.version!==AI_RESPONSE_ORIGINALS_CARRIER_V6)bad();
 const bodyOriginal=un64(v.bodyOriginalBase64url,1048576),outcomeMetadataOriginal=metadata(un64(v.outcomeMetadataOriginalBase64url,16384)),businessReceiptOriginal=v.businessReceiptOriginalBase64url===null?null:un64(v.businessReceiptOriginalBase64url,1048576);
 return Object.freeze({transportOriginal:raw,bodyOriginal,outcomeMetadataOriginal,businessReceiptOriginal,dataOnly:true,receiptProvenanceVerified:false,SourceAdmission:false,RootAdmission:false,operationVerified:false});
}
