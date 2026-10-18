import {createHash} from 'node:crypto';
import {canonicalJSON} from '@ynx-chain/wallet-auth';
import {parsePQOriginalRecord} from './wallet-pq-intent-record.mjs';
import {pqBFTOriginalIdentity,parsePQBFTOriginalResponse,parsePQBFTSubmissionResponse} from './wallet-pq-bft-evidence.mjs';
import {sessionOriginalCause} from './wallet-session-original.mjs';
import {pqTypedSubmissionIdentity,parsePQTypedProgressResult,capturePQTypedProgressResult} from './wallet-pq-typed-progress.mjs';
const fail=()=>{throw Object.assign(Error('Preserve the original PQ submission and its unknown result.'),{code:'PQ_PROGRESS_INVALID'});};
const exact=(v,keys)=>{if(!v||Object.getPrototypeOf(v)!==Object.prototype)fail();const d=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(d);if(names.length!==keys.length||names.some(k=>!keys.includes(k)||!Object.hasOwn(d[k],'value')||!d[k].enumerable))fail();};
const digest=text=>createHash('sha256').update(text).digest('hex');
export const PQ_PROGRESS_RESPONSE_BYTES=524288;
const statuses=['submission-unknown','rejection-observed','inclusion-observed'];
const stateOf=observation=>observation.outcome==='bft-inclusion-observed'?'inclusion-observed':observation.outcome==='rejection-observed'?'rejection-observed':'submission-unknown';
export function pqProgressCause(value){try{const result=sessionOriginalCause(value);if(typeof result.value==='number'&&!Number.isFinite(result.value))result.value=null;return Object.freeze(result);}catch{return Object.freeze({kind:'error',value:null,code:null});}}
function cause(value){if(value===null)return;exact(value,['kind','value','code']);if(!['error','object','undefined','boolean','number','string'].includes(value.kind)||value.code!==null&&(typeof value.code!=='string'||! /^[A-Za-z0-9_:-]{1,128}$/.test(value.code))||['error','object','undefined'].includes(value.kind)&&value.value!==null||value.kind==='boolean'&&typeof value.value!=='boolean'||value.kind==='number'&&value.value!==null&&(typeof value.value!=='number'||!Number.isFinite(value.value))||value.kind==='string'&&!['','redacted'].includes(value.value))fail();}
export function pqSubmissionIdentity(input){
 if(input?.kind==='pq-typed-action')return pqTypedSubmissionIdentity(input);
 const original=parsePQOriginalRecord(input),identity=pqBFTOriginalIdentity(original);
 return Object.freeze({account:original.account,hash:original.hash,kind:original.kind,operationId:original.operationId,nativeTransactionHash:identity.nativeTransactionHash,abciTransactionHash:identity.abciTransactionHash});
}
/** Raw response is private journal custody, not a renderer receipt or a
 * qualified Source. No method here signs, POSTs, grants or clears an original. */
export function parsePQProgressResult(input,original){
 if(original?.kind==='pq-typed-action')return parsePQTypedProgressResult(input,original,PQ_PROGRESS_RESPONSE_BYTES);
 exact(input,['phase','statusCode','text','bodySha256']);
 if(!['submission','read'].includes(input.phase)||!Number.isInteger(input.statusCode)||typeof input.text!=='string'||Buffer.byteLength(input.text)>PQ_PROGRESS_RESPONSE_BYTES||input.bodySha256!==digest(input.text))fail();
 const observed=(input.phase==='submission'?parsePQBFTSubmissionResponse:parsePQBFTOriginalResponse)(original,input.statusCode,input.text);
 return Object.freeze({result:Object.freeze({...input}),observed,status:stateOf(observed)});
}
export function capturePQProgressResult(input){
 if(input&&Object.hasOwn(input,'response'))return capturePQTypedProgressResult(input);
 exact(input,['phase','statusCode','text']);if(!['submission','read'].includes(input.phase)||!Number.isInteger(input.statusCode)||typeof input.text!=='string')fail();
 // A main caller retains even an oversized result in memory before the
 // bounded parser can refuse durable storage. No callback bytes are logged.
 return Object.freeze({...input,bodySha256:digest(input.text)});
}
export function parsePQProgress(input,original){
 exact(input,['version','account','hash','kind','operationId','nativeTransactionHash','abciTransactionHash','status','result','firstCause','storageCause']);
 const identity=pqSubmissionIdentity(original);if(input.version!==1||Object.keys(identity).some(k=>input[k]!==identity[k])||!statuses.includes(input.status))fail();
 cause(input.firstCause);cause(input.storageCause);
 if(input.result===null){if(input.status!=='submission-unknown')fail();}
 else if(parsePQProgressResult(input.result,original).status!==input.status)fail();
 return Object.freeze({...input,result:input.result?Object.freeze({...input.result}):null,firstCause:input.firstCause?Object.freeze({...input.firstCause}):null,storageCause:input.storageCause?Object.freeze({...input.storageCause}):null});
}
export const initialPQProgress=original=>parsePQProgress({version:1,...pqSubmissionIdentity(original),status:'submission-unknown',result:null,firstCause:null,storageCause:null},original);
export function mergePQProgressResult(current,result,original){
 const prior=parsePQProgress(current,original),next=parsePQProgressResult(result,original);
 const rank=statuses.indexOf(next.status)-statuses.indexOf(prior.status);
 if(rank<0)return prior; // A later UNKNOWN never erases a known observation.
 if(prior.result&&rank===0){
  if(prior.status==='inclusion-observed'&&canonicalJSON(JSON.parse(prior.result.text))!==canonicalJSON(JSON.parse(next.result.text)))throw Object.assign(Error('Conflicting observations for the same original; do not retry.'),{code:'PQ_PROGRESS_OBSERVATION_CONFLICT'});
  return prior; // Duplicate callbacks/UNKNOWN reasons never rewrite history.
 }
 return parsePQProgress({...prior,status:next.status,result:next.result},original);
}
export function pqProgressCoreEqual(left,right){return canonicalJSON({status:left.status,result:left.result})===canonicalJSON({status:right.status,result:right.result});}
export function pqSavedCustodyResult(account,hash,progress){return Object.freeze({account,hash,savedLocally:true,submitted:progress?(progress.status==='inclusion-observed'?true:null):false,confirmed:false,...(progress?{submissionStatus:progress.status}:{})});}
