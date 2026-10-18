// Pure v4 framing only. The fixed Native admission method checks the actual
// authenticated Source selection. No dictionary or parser result is a grant.
import {canonicalJSON,exactFields,WalletAuthError} from './canonical.js';
export const ORIGINAL_PRIVATE_REFERENCE_CARRIER='YNX-PRODUCT-SESSION-PRIVATE/v4';
export const ORIGINAL_PRIVATE_REFERENCE_CONTRACT='ab90fbcd71e6386e763ee7a3c4abd2eab8806eb06c5418c7cd5a5bb649e83566';
const actions=Object.freeze({challenge:Object.freeze({operation:'beginYNX',path:'/v2/product-sessions/returns/challenge'}),complete:Object.freeze({operation:'handleReturn',path:'/v2/product-sessions/returns/complete'}),outcome:Object.freeze({operation:'handleReturn',path:'/v2/product-sessions/returns/outcome'})});
const fail=()=>{throw new WalletAuthError('ORIGINAL_PRIVATE_REQUEST_INVALID','Original reference carrier is invalid; no capability was granted');};
const bytes=value=>new TextEncoder().encode(value).length;
export function originalPrivateReferenceRoute(input){
  if(typeof input.referenceAction!=='string'||!Object.hasOwn(actions,input.referenceAction))fail();
  const route=actions[input.referenceAction];if(route.operation!==input.operation||input.phase!=='effect'||input.carrierVersion!==ORIGINAL_PRIVATE_REFERENCE_CARRIER)fail();return route.path;
}
export function originalPrivateReferenceBudget(input){
  exactFields(input,['requestId','operation','phase','body','proofHeader','carrierVersion','referenceAction'],'Original private reference carrier');
  originalPrivateReferenceRoute(input);
  if(typeof input.requestId!=='string'||input.requestId.length<16||input.requestId.length>84||!/^req_[A-Za-z0-9_-]{12,80}$/.test(input.requestId)||input.proofHeader!==null||typeof input.body!=='string'||bytes(input.body)>49152||bytes(canonicalJSON(input))>65536)fail();
  let body;try{body=JSON.parse(input.body);}catch{fail();}if(canonicalJSON(body)!==input.body)fail();
  exactFields(body,input.referenceAction==='challenge'?['reference','request']:['reference','request','completion'],'Original private reference body');
  if(typeof body.reference!=='string'||body.reference.length!==51||!/^ynxpsr1_[A-Za-z0-9_-]{43}$/.test(body.reference)||!body.request||typeof body.request!=='object'||Array.isArray(body.request)||body.request.version!=='2')fail();
  if(input.referenceAction!=='challenge'){
    exactFields(body.completion,['challenge','deviceSignature'],'Original reference completion');
    if(!body.completion.challenge||typeof body.completion.challenge!=='object'||Array.isArray(body.completion.challenge)||typeof body.completion.deviceSignature!=='string'||bytes(body.completion.deviceSignature)>4096)fail();
  }
  return Object.freeze({body:49152,envelope:65536,response:65536,pq:false,reference:true});
}
export function createOriginalPrivateReferenceCarrier(action,requestId,body){
  if(!Object.hasOwn(actions,action))fail();
  const input={requestId,operation:actions[action].operation,phase:'effect',body,proofHeader:null,carrierVersion:ORIGINAL_PRIVATE_REFERENCE_CARRIER,referenceAction:action};
  originalPrivateReferenceBudget(input);return Object.freeze(input);
}
export function sameOriginalReferenceCompletion(write,read){
  try{originalPrivateReferenceBudget(write);originalPrivateReferenceBudget(read);}catch{return false;}
  return write.referenceAction==='complete'&&read.referenceAction==='outcome'&&write.requestId!==read.requestId&&write.body===read.body;
}
