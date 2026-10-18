import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {parsePQTypedOriginalRecord} from './wallet-pq-typed-original.mjs';
import {inspectPQReviewedTypedActionQuery} from './features/pq-transaction/typed-action-query.mjs';
const fail=()=>{throw Object.assign(Error('Keep the original typed response and progress.'),{code:'PQ_TYPED_PROGRESS_INVALID'})};
const hash=text=>createHash('sha256').update(text).digest('hex');
const typed=Object.getPrototypeOf(Uint8Array.prototype),bufferOf=Object.getOwnPropertyDescriptor(typed,'buffer').get,lengthOf=Object.getOwnPropertyDescriptor(typed,'length').get,offsetOf=Object.getOwnPropertyDescriptor(typed,'byteOffset').get;
const resizable=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable').get,detached=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'detached').get;
const exact=(value,keys)=>{if(!value||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)fail();const ds=Object.getOwnPropertyDescriptors(value),actual=Reflect.ownKeys(ds);if(actual.length!==keys.length||actual.some(k=>!keys.includes(k)||!ds[k].enumerable||!Object.hasOwn(ds[k],'value')))fail();};
export function retainPQTypedHTTPResponse(value){
 exact(value,['method','requestPath','status','contentType','cacheControl','body']);
 if(types.isProxy(value.body)||!types.isUint8Array(value.body))fail();
 const buffer=bufferOf.call(value.body),length=lengthOf.call(value.body),offset=offsetOf.call(value.body);
 if(types.isSharedArrayBuffer(buffer)||resizable.call(buffer)||detached.call(buffer)||length>8<<20)fail();
 return Object.freeze({...value,body:Buffer.from(new Uint8Array(buffer,offset,length))});
}
export function capturePQTypedProgressResult(input){
 exact(input,['phase','response']);if(!['read','submission'].includes(input.phase))fail();
 const response=retainPQTypedHTTPResponse(input.response);let text;
 try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(response.body)}catch{fail()}
 return Object.freeze({phase:input.phase,method:response.method,requestPath:response.requestPath,statusCode:response.status,contentType:response.contentType,cacheControl:response.cacheControl,text,bodySha256:hash(text)});
}
export function pqTypedSubmissionIdentity(value){
 const original=parsePQTypedOriginalRecord(value);return Object.freeze({account:original.account,hash:original.hash,kind:original.kind,operationId:original.operationId,nativeTransactionHash:original.typed.memberHash,abciTransactionHash:original.hash});
}
export function parsePQTypedProgressResult(input,value,maxBytes){
 exact(input,['phase','method','requestPath','statusCode','contentType','cacheControl','text','bodySha256']);
 if(input.phase!=='read'||input.method!=='GET'||typeof input.text!=='string'||Buffer.byteLength(input.text)>maxBytes||input.bodySha256!==hash(input.text))fail();
 const saved=parsePQTypedOriginalRecord(value),t=saved.typed,network={owner:saved.account,chainId:t.networkId,nativeChainId:'6423'};
 const original={reviewSnapshot:parsePQAccountAuthorization(t.reviewSnapshot,network),signingSnapshot:parsePQAccountAuthorization(t.signingSnapshot,network),selectedBinding:{account:saved.account,networkId:t.networkId},memberHash:t.memberHash,transportHash:saved.hash};
 const observed=inspectPQReviewedTypedActionQuery(t.review,Buffer.from(saved.wire,'base64url'),original,{method:input.method,requestPath:input.requestPath,status:input.statusCode,contentType:input.contentType,cacheControl:input.cacheControl,body:Buffer.from(input.text)});
 const status={committed:'inclusion-observed',rejected:'rejection-observed',unknown:'submission-unknown'}[observed.observedStatus];
 return Object.freeze({result:Object.freeze({...input}),observed,status});
}
