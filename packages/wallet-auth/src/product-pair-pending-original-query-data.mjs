// DATA contract only. No HTTP mount, Source brand, signer, admission or retry.
import {createHash} from 'node:crypto';
import {types} from 'node:util';
export const PENDING_ORIGINAL_QUERY_CONTRACT=Object.freeze({
 version:'1',method:'POST',path:'/v4/product-pairs/original-query',
 domain:'YNX/PRODUCT-PAIR/PENDING-ORIGINAL-QUERY/V1',
 purpose:'product-device-pending-original-query-v1',
 digestDomain:'issuer_v4_operations.input_sha256:SHA256(original PAIR POST UTF8 bytes)',
 operationMapping:'pendingId === original PAIR POST operationId',
 sessionBinding:false,readOnly:true,
});
const fail=()=>{throw Object.assign(Error('PENDING_ORIGINAL_QUERY_DATA_REFUSED'),{code:'PENDING_ORIGINAL_QUERY_DATA_REFUSED'});};
const sha=b=>createHash('sha256').update(b).digest('hex');
const hex=v=>{if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))fail();return v;};
const canonical=v=>JSON.stringify(Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])));
const typed=Object.getPrototypeOf(Uint8Array.prototype),lengthOf=Object.getOwnPropertyDescriptor(typed,'byteLength').get,bufferOf=Object.getOwnPropertyDescriptor(typed,'buffer').get,setBytes=Uint8Array.prototype.set;
function bytes(v,max){
 if(types.isProxy(v)||!Buffer.isBuffer(v))fail();
 const length=lengthOf.call(v);if(!length||length>max||types.isSharedArrayBuffer(bufferOf.call(v)))fail();
 const b=Buffer.alloc(length);setBytes.call(b,v);
 const s=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b);
 if(!Buffer.from(s,'utf8').equals(b)||s.charCodeAt(0)===0xfeff)fail();
 return {b,s};
}
function record(v,keys){
 if(v===null||typeof v!=='object'||types.isProxy(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail();
 const d=Object.getOwnPropertyDescriptors(v);
 if(Reflect.ownKeys(d).length!==keys.length||keys.some(k=>!d[k]||!d[k].enumerable||!Object.hasOwn(d[k],'value')))fail();
 return Object.fromEntries(keys.map(k=>[k,d[k].value]));
}
export function decodePendingPairOriginalQueryDATA(raw){
 const {b,s}=bytes(raw,1024);let parsed;try{parsed=JSON.parse(s);}catch{fail();}
 const q=record(parsed,['version','operationId','originalRequestBodyDigest']);
 if(q.version!=='1'||canonical(q)!==s)fail();
 hex(q.operationId);hex(q.originalRequestBodyDigest);
 return Object.freeze({...q,queryBodyDigest:sha(b),dataOnly:true,authorized:false});
}
// Call only AFTER the independent typed proof/Source/current/actor checks.
// This function does not turn a caller-supplied row into an authenticated result.
// The SQL reader must select by original namespace+operation and enforce actor.
export function projectPendingPairOriginalQueryDATA(raw,originalPairPost,expectedActor,selectedRow){
 const q=decodePendingPairOriginalQueryDATA(raw),body=bytes(originalPairPost,393216);
 hex(expectedActor);
 let post;try{post=JSON.parse(body.s);}catch{fail();}
 if(post===null||typeof post!=='object'||Array.isArray(post)||post.operationId!==q.operationId||sha(body.b)!==q.originalRequestBodyDigest)fail();
 let state='NOT_FOUND',original=null;
 if(selectedRow!==null){
  const r=record(selectedRow,['operation_id','actor_digest','kind','input_sha256','input_original','phase','result_original']);
  if(r.operation_id!==q.operationId||r.actor_digest!==expectedActor||r.kind!=='PAIR'||r.input_sha256!==q.originalRequestBodyDigest||typeof r.input_original!=='string')fail();
  const stored=bytes(Buffer.from(r.input_original,'utf8'),393216);
  if(!stored.b.equals(body.b)||sha(stored.b)!==r.input_sha256)fail();
  if(r.phase==='ENTERED'){
   if(r.result_original!==null)fail();state='UNKNOWN';
  }else if(r.phase==='COMMITTED'){
   if(typeof r.result_original!=='string')fail();
   const result=bytes(Buffer.from(r.result_original,'utf8'),393216);
   try{JSON.parse(result.s);}catch{fail();}
   original=result.s;state='OBSERVED';
  }else fail();
 }
 return Object.freeze({version:'1',operationId:q.operationId,queryBodyDigest:q.queryBodyDigest,
  originalRequestBodyDigest:q.originalRequestBodyDigest,state,original,
  dataOnly:true,authorized:false,sourceAdmission:false,nativeAdmission:false,
  registered:false,connected:false,newSession:false,retryAuthorized:false});
}
