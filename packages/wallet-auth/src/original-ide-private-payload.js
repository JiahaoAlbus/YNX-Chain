// Data framing only. No parser result, digest or response is Native authority.
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {canonicalJSON,exactFields,WalletAuthError} from './canonical.js';
import {decodeOriginalWalletServicePrivateRequest} from './original-wallet-service-private-dispatch.js';
export const ORIGINAL_IDE_PRIVATE_PAYLOAD_SCHEMA='YNX-IDE-PRIVATE-PAYLOAD/v1';
export const ORIGINAL_IDE_PRIVATE_REQUEST_FRAME_BYTES=589824;
export const ORIGINAL_IDE_PRIVATE_RESPONSE_FRAME_BYTES=196608;
const common=['schema','type','bindingDigest','operation','phase','requestId','requestDigest'];
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const fail=()=>{throw new WalletAuthError('ORIGINAL_IDE_PRIVATE_FRAME_INVALID','Original IDE payload is invalid');};
export function originalIDEPrivateDeliveryBinding(selection){
 const requestNonce=selection?.expectedRequest?.requestNonce,receiptDigest=selection?.receiptSelection?.receiptDigest,consumerManifestDigest=selection?.expectedRequest?.consumerManifestDigest;
 if(typeof requestNonce!=='string'||!requestNonce.length||requestNonce.length>128||!hex(receiptDigest)||!hex(consumerManifestDigest))fail();
 return sha(canonicalJSON({requestNonce,receiptDigest,consumerManifestDigest}));
}
export function parseOriginalIDEPrivateResponse(raw,requestId){
 if(typeof raw!=='string'||!raw.length||Buffer.byteLength(raw)>65536)fail();
 let response;try{response=JSON.parse(raw);}catch{fail();}
 exactFields(response,['status','headers','body'],'Original private response');
 if(canonicalJSON(response)!==raw||!Number.isInteger(response.status)||response.status<200||response.status>599||typeof response.body!=='string'||!response.headers||typeof response.headers!=='object'||Array.isArray(response.headers)||Object.keys(response.headers).length>32||Object.entries(response.headers).some(([k,v])=>!/^[a-z0-9-]+$/.test(k)||typeof v!=='string'||Buffer.byteLength(v)>16384)||response.headers['x-request-id']!==requestId||!/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers['content-type']??'')||!/(^|,)\s*no-store\s*(,|$)/i.test(response.headers['cache-control']??''))fail();
 if(Object.hasOwn(response.headers,'content-length')&&response.headers['content-length']!==String(Buffer.byteLength(response.body)))fail();
 let payload;try{payload=JSON.parse(response.body);}catch{fail();}
 const ok=response.status<300;exactFields(payload,ok?['ok','requestId','result','schemaVersion']:['ok','requestId','error','schemaVersion'],'Original private response payload');
 if(canonicalJSON(payload)!==response.body||payload.ok!==ok||payload.requestId!==requestId||payload.schemaVersion!==2)fail();
 if(!ok){exactFields(payload.error,['code','message'],'Original private error');if(typeof payload.error.code!=='string'||! /^[A-Z][A-Z0-9_]{2,63}$/.test(payload.error.code)||typeof payload.error.message!=='string'||payload.error.message.length>300)fail();}
 return Object.freeze({...response,headers:Object.freeze({...response.headers})});
}
export function parseOriginalIDEPrivatePayload(raw){
 if(typeof raw!=='string'||!raw.length||Buffer.byteLength(raw)>ORIGINAL_IDE_PRIVATE_REQUEST_FRAME_BYTES)fail();
 let frame;try{frame=JSON.parse(raw);}catch{fail();}
 if(!frame||typeof frame!=='object'||Array.isArray(frame)||canonicalJSON(frame)!==raw||frame.schema!==ORIGINAL_IDE_PRIVATE_PAYLOAD_SCHEMA||!['request','response','failure'].includes(frame.type)||!hex(frame.bindingDigest)||!hex(frame.requestDigest)||!['beginYNX','handleReturn','restore','disconnect'].includes(frame.operation)||!['time','effect'].includes(frame.phase)||typeof frame.requestId!=='string'||frame.requestId.length>84||!/^req_[A-Za-z0-9_-]{12,80}$/.test(frame.requestId))fail();
 exactFields(frame,[...common,...(frame.type==='request'?['canonicalInput']:frame.type==='response'?['responseRaw','responseDigest']:['errorCode'])],'Original private payload frame');
 if(frame.type==='request'){
  const input=decodeOriginalWalletServicePrivateRequest(frame.canonicalInput);
  if(sha(frame.canonicalInput)!==frame.requestDigest||['operation','phase','requestId'].some(k=>input[k]!==frame[k]))fail();
 }else{
  if(Buffer.byteLength(raw)>ORIGINAL_IDE_PRIVATE_RESPONSE_FRAME_BYTES)fail();
  if(frame.type==='response'){if(!hex(frame.responseDigest)||sha(frame.responseRaw)!==frame.responseDigest)fail();parseOriginalIDEPrivateResponse(frame.responseRaw,frame.requestId);}
  else if(typeof frame.errorCode!=='string'||! /^[A-Z][A-Z0-9_]{2,95}$/.test(frame.errorCode))fail();
 }
 return Object.freeze(frame);
}
export function createOriginalIDEPrivateRequestFrame(bindingDigest,canonicalInput){
 const input=decodeOriginalWalletServicePrivateRequest(canonicalInput),raw=canonicalJSON({schema:ORIGINAL_IDE_PRIVATE_PAYLOAD_SCHEMA,type:'request',bindingDigest,operation:input.operation,phase:input.phase,requestId:input.requestId,requestDigest:sha(canonicalInput),canonicalInput});
 parseOriginalIDEPrivatePayload(raw);return raw;
}
export function createOriginalIDEPrivateResponseFrame(requestFrame,responseRaw){
 const request=parseOriginalIDEPrivatePayload(requestFrame);if(request.type!=='request')fail();
 const {canonicalInput:_input,...fields}=request,raw=canonicalJSON({...fields,type:'response',responseRaw,responseDigest:sha(responseRaw)});
 parseOriginalIDEPrivatePayload(raw);return raw;
}

/** Existing R30a Native proof DATA only. No ACK, adoption or authority. */
export function captureOriginalIDEPrivateTerminalCustodyData(proof,canonicalInput,association,expectedResponseRaw=null){
 const invalid=()=>{throw new WalletAuthError('IDE_PRIVATE_TERMINAL_CUSTODY_INVALID','Original terminal custody DATA is invalid');};
 if(!proof||types.isProxy(proof)||Object.getPrototypeOf(proof)!==Object.prototype)invalid();
 const fields=['responseRaw','responseDigest','requestDigest','associationDigest','stateBeforeDigest','stateAfterDigest','stateFileDigest','enteredDigest','recordVersion','success'];
 const descriptors=Object.getOwnPropertyDescriptors(proof);
 if(Reflect.ownKeys(descriptors).length!==fields.length||Reflect.ownKeys(descriptors).some(k=>typeof k!=='string'||!fields.includes(k)||!Object.hasOwn(descriptors[k],'value')||!descriptors[k].enumerable))invalid();
 if(['responseDigest','requestDigest','associationDigest','stateBeforeDigest','stateAfterDigest','stateFileDigest','enteredDigest'].some(k=>!hex(proof[k]))||![1,2,3].includes(proof.recordVersion)||typeof proof.success!=='boolean'||typeof proof.responseRaw!=='string'||Buffer.byteLength(proof.responseRaw)>65536||sha(proof.responseRaw)!==proof.responseDigest||sha(canonicalInput)!==proof.requestDigest||sha(canonicalJSON(association))!==proof.associationDigest||expectedResponseRaw!==null&&expectedResponseRaw!==proof.responseRaw)invalid();
 let response;
 try{const input=decodeOriginalWalletServicePrivateRequest(canonicalInput);response=parseOriginalIDEPrivateResponse(proof.responseRaw,input.requestId);if(proof.success!==(response.status<300))invalid();}catch{invalid();}
 return Object.freeze({proof:Object.freeze({...proof}),response});
}

/** R44 retained cold journal DATA. Native alone checks Source association.
 * Deliberately separate from the qualified, exact ten-field R30a parser. */
export function captureOriginalIDEColdTerminalCustodyData(proof,canonicalInput){
 const invalid=()=>{throw new WalletAuthError('IDE_PRIVATE_TERMINAL_CUSTODY_INVALID','Original cold terminal DATA is invalid');};
 if(!proof||types.isProxy(proof)||Object.getPrototypeOf(proof)!==Object.prototype)invalid();
 const fields=['responseRaw','responseDigest','requestDigest','associationDigest','stateBeforeDigest','stateAfterDigest','stateFileDigest','enteredDigest','recordVersion','success','dataOnly','effectRetryAuthorized','nativeAdmission'];
 const descriptors=Object.getOwnPropertyDescriptors(proof);
 if(Reflect.ownKeys(descriptors).length!==fields.length||Reflect.ownKeys(descriptors).some(k=>typeof k!=='string'||!fields.includes(k)||!Object.hasOwn(descriptors[k],'value')||!descriptors[k].enumerable))invalid();
 if(proof.dataOnly!==true||proof.effectRetryAuthorized!==false||proof.nativeAdmission!==false||['responseDigest','requestDigest','associationDigest','stateBeforeDigest','stateAfterDigest','stateFileDigest','enteredDigest'].some(k=>!hex(proof[k]))||![1,2,3].includes(proof.recordVersion)||typeof proof.success!=='boolean'||typeof proof.responseRaw!=='string'||Buffer.byteLength(proof.responseRaw)>65536||sha(proof.responseRaw)!==proof.responseDigest||typeof canonicalInput!=='string'||sha(canonicalInput)!==proof.requestDigest)invalid();
 let response;
 try{const input=decodeOriginalIDEColdTerminalCustodyRequest(canonicalInput);response=parseOriginalIDEPrivateResponse(proof.responseRaw,input.requestId);if(proof.success!==(response.status<300))invalid();}catch{invalid();}
 return Object.freeze({proof:Object.freeze({...proof}),response});
}
export function decodeOriginalIDEColdTerminalCustodyRequest(raw){
 if(typeof raw!=='string'||!raw.length||Buffer.byteLength(raw)>65536)throw new WalletAuthError('IDE_PRIVATE_TERMINAL_CUSTODY_INVALID','Original cold terminal request is invalid');
 const input=decodeOriginalWalletServicePrivateRequest(raw);
 if(input.carrierVersion!=='YNX-PRODUCT-SESSION-PRIVATE/v4'||input.operation!=='handleReturn'||input.phase!=='effect'||input.referenceAction!=='complete')throw new WalletAuthError('IDE_PRIVATE_TERMINAL_CUSTODY_INVALID','Original cold terminal request is invalid');
 return input;
}
