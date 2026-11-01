import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {encodePQNativeAction,decodePQNativeAction} from '@ynx-chain/wallet-auth/pq-native-action';
import {parsePQTypedOriginalRecord} from './wallet-pq-typed-original.mjs';
import {sessionOriginalCause} from './wallet-session-original.mjs';

// Private journal DATA only. No transport, Core receipt parser or authority.
export const PQ_PAY_PACKET_BODY_MAX_BYTES=2*1024*1024;
export const PQ_PAY_PACKET_BASE64_MAX_BYTES=4*Math.ceil(PQ_PAY_PACKET_BODY_MAX_BYTES/3);
export const PQ_PAY_PACKET_METADATA_RESERVE_BYTES=192*1024;
export const PQ_PAY_PROGRESS_RESERVE_BYTES=PQ_PAY_PACKET_BASE64_MAX_BYTES+PQ_PAY_PACKET_METADATA_RESERVE_BYTES+65536;
// Additional reserve before the first read, on top of the existing journal.
export const PQ_PAY_QUERY_RESERVE_BYTES=PQ_PAY_PROGRESS_RESERVE_BYTES;
const metadata=['method','requestPath','status','contentType','cacheControl'];
const limits={method:1024,requestPath:8192,status:64,contentType:8192,cacheControl:8192};
const targetKeys=['version','service','kind','intentId','merchant','invoiceId','requestPath'];
const identityKeys=['account','hash','kind','operationId','nativeTransactionHash','abciTransactionHash'];
const progressKeys=['version',...identityKeys,'target','status','result','firstCause','storageCause'];
const resultKeys=['version',...metadata,'undefinedFields','bodyBase64url','bodySha256','bodyBytes'];
const fail=(code='PQ_PAY_PROGRESS_INVALID')=>{throw Object.assign(new Error('Keep the original Pay operation and response; do not resend.'),{code});};
function exact(value,keys){
 if(!value||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)fail();
 const ds=Object.getOwnPropertyDescriptors(value),ks=Reflect.ownKeys(ds);
 if(ks.length!==keys.length||ks.some(k=>!keys.includes(k)||!ds[k].enumerable||!Object.hasOwn(ds[k],'value')))fail();
 return Object.fromEntries(keys.map(k=>[k,ds[k].value]));
}
const frozen=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(frozen);Object.freeze(value);}return value;};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function verified(original){
 const saved=parsePQTypedOriginalRecord(original);
 const action=decodePQNativeAction(encodePQNativeAction(saved.typed.review.action));
 if(action.owner!==saved.account||action.chainId!==saved.typed.networkId||action.nativeChainId!=='6423'||
    !['invoice_terms','invoice_settle','invoice_refund'].includes(action.kind))fail();
 return {saved,action,identity:{account:saved.account,hash:saved.hash,kind:saved.kind,operationId:saved.operationId,
  nativeTransactionHash:saved.typed.memberHash,abciTransactionHash:saved.hash}};
}
function normalize({saved,action},input){
 const terms=action.kind==='invoice_terms';
 const ref=exact(input,terms?['hash','kind','intentId']:['hash','kind','merchant','invoiceId']);
 if(ref.hash!==saved.hash||ref.kind!==action.kind)fail();
 const merchant=action.kind==='invoice_settle'?action.payload.merchant:saved.account;
 const invoiceId=action.payload.invoiceID;
 if(terms?typeof ref.intentId!=='string'||!/^npi_[0-9a-f]{48}$/.test(ref.intentId):ref.merchant!==merchant||ref.invoiceId!==invoiceId)fail();
 const requestPath=terms?`/v5/pay/invoice-intents/${ref.intentId}/merchant-member`:
  `/v5/pay/invoices/${merchant}/${invoiceId}/${action.kind==='invoice_settle'?'settlements':'refunds'}`;
 return frozen({version:1,service:'pay',kind:action.kind,intentId:terms?ref.intentId:null,merchant,invoiceId,requestPath});
}
export function normalizePQPayTargetDATA(original,ref){return normalize(verified(original),ref);}
function target(input,context){
 const t=exact(input,targetKeys),terms=context.action.kind==='invoice_terms';
 const expected=normalize(context,terms?{hash:context.saved.hash,kind:t.kind,intentId:t.intentId}:
  {hash:context.saved.hash,kind:t.kind,merchant:t.merchant,invoiceId:t.invoiceId});
 if(targetKeys.some(k=>t[k]!==expected[k]))fail();
 return expected;
}
export function pqPayProgressCause(value){
 try{const out=sessionOriginalCause(value);if(out.kind==='number'&&!Number.isFinite(out.value))out.value=null;return frozen(out);}
 catch{return frozen({kind:'error',value:null,code:null});}
}
function cause(input){
 if(input===null)return null;
 const c=exact(input,['kind','value','code']);
 if(!['error','object','undefined','boolean','number','string'].includes(c.kind)||
    c.code!==null&&(typeof c.code!=='string'||!/^[A-Za-z0-9_:-]{1,128}$/.test(c.code))||
    ['error','object','undefined'].includes(c.kind)&&c.value!==null||
    c.kind==='boolean'&&typeof c.value!=='boolean'||
    c.kind==='number'&&c.value!==null&&(typeof c.value!=='number'||!Number.isFinite(c.value))||
    c.kind==='string'&&!['','redacted'].includes(c.value))fail();
 return frozen(c);
}
function scalar(value,key){
 if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)&&!Object.is(value,-0))return value;
 if(typeof value==='string'&&Buffer.byteLength(value)<=limits[key])return value;
 fail('PQ_PAY_PACKET_METADATA_INVALID');
}
const typed=Object.getPrototypeOf(Uint8Array.prototype);
const bufferOf=Object.getOwnPropertyDescriptor(typed,'buffer').get;
const offsetOf=Object.getOwnPropertyDescriptor(typed,'byteOffset').get;
const lengthOf=Object.getOwnPropertyDescriptor(typed,'byteLength').get;
const resizable=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable').get;
const detached=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'detached').get;
function bodyCopy(value){
 try{
  if(types.isProxy(value)||!types.isUint8Array(value))fail();
  if(['buffer','byteLength','byteOffset','length'].some(k=>Object.hasOwn(value,k)))fail();
  const b=bufferOf.call(value),n=lengthOf.call(value),o=offsetOf.call(value);
  if(!types.isArrayBuffer(b)||resizable.call(b)||detached.call(b))fail();
  if(n>PQ_PAY_PACKET_BODY_MAX_BYTES)fail('PQ_PAY_PACKET_TOO_LARGE');
  return Buffer.from(new Uint8Array(b,o,n));
 }catch(error){if(error?.code==='PQ_PAY_PACKET_TOO_LARGE')throw error;fail('PQ_PAY_PACKET_BODY_INVALID');}
}
/** Copy synchronously before the caller can await, recheck current or parse. */
export function capturePQPayPacket(input){
 const raw=exact(input,[...metadata,'body']);
 const body=bodyCopy(raw.body),out={version:1},undefinedFields=[];
 for(const k of metadata){if(raw[k]===undefined){out[k]=null;undefinedFields.push(k);}else out[k]=scalar(raw[k],k);}
 return frozen({...out,undefinedFields,bodyBase64url:body.toString('base64url'),bodySha256:sha(body),bodyBytes:body.length});
}
function packet(input){
 const r=exact(input,resultKeys);
 if(r.version!==1||!Number.isInteger(r.bodyBytes)||r.bodyBytes<0||r.bodyBytes>PQ_PAY_PACKET_BODY_MAX_BYTES||
    typeof r.bodyBase64url!=='string'||r.bodyBase64url.length>PQ_PAY_PACKET_BASE64_MAX_BYTES||
    !/^[A-Za-z0-9_-]*$/.test(r.bodyBase64url)||typeof r.bodySha256!=='string'||!/^[0-9a-f]{64}$/.test(r.bodySha256))fail();
 const body=Buffer.from(r.bodyBase64url,'base64url');
 if(body.length!==r.bodyBytes||body.toString('base64url')!==r.bodyBase64url||sha(body)!==r.bodySha256)fail();
 if(types.isProxy(r.undefinedFields)||!Array.isArray(r.undefinedFields)||Object.getPrototypeOf(r.undefinedFields)!==Array.prototype)fail();
 const ds=Object.getOwnPropertyDescriptors(r.undefinedFields);
 const ks=Reflect.ownKeys(ds);
 if(r.undefinedFields.length>metadata.length||ks.length!==r.undefinedFields.length+1||ks.some(k=>k!=='length'&&(!/^(0|[1-9][0-9]*)$/.test(k)||!Object.hasOwn(ds[k],'value'))))fail();
 const absent=Array.from({length:r.undefinedFields.length},(_,i)=>ds[i].value);
 if(absent.some(k=>!metadata.includes(k))||new Set(absent).size!==absent.length||metadata.filter(k=>absent.includes(k)).join()!==absent.join())fail();
 for(const k of metadata){scalar(r[k],k);if(absent.includes(k)&&r[k]!==null)fail();}
 return frozen({...r,undefinedFields:absent});
}
function parse(input,context){
 const hasQuery=!!input&&!types.isProxy(input)&&Object.hasOwn(input,'queryResult');
 const p=exact(input,hasQuery?[...progressKeys,'queryResult']:progressKeys);
 if(p.version!==2||identityKeys.some(k=>p[k]!==context.identity[k])||!['signed-unsubmitted','submission-unknown'].includes(p.status))fail();
 const t=target(p.target,context),result=p.result===null?null:packet(p.result);
 const queryResult=hasQuery?(p.queryResult===null?null:packet(p.queryResult)):null;
 if((result!==null||queryResult!==null)&&p.status!=='submission-unknown')fail();
 return frozen({...p,target:t,result,...(hasQuery?{queryResult}:{}),firstCause:cause(p.firstCause),storageCause:cause(p.storageCause)});
}
export function parsePQPayProgress(input,original){return parse(input,verified(original));}
export function initialPQPayProgress(original,input){
 const context=verified(original);
 return frozen({version:2,...context.identity,target:target(input,context),status:'signed-unsubmitted',result:null,firstCause:null,storageCause:null});
}
export function enterPQPaySubmission(input,original){
 const p=parsePQPayProgress(input,original);return frozen({...p,status:'submission-unknown'});
}
export function mergePQPayPacket(input,captured,original){
 const prior=parsePQPayProgress(input,original),result=packet(captured);
 // Parent must durably begin before dispatch. Never let a packet create begin.
 if(prior.status!=='submission-unknown')fail('PQ_PAY_SUBMISSION_NOT_ENTERED');
 if(prior.result!==null){
  if(resultKeys.some(k=>JSON.stringify(prior.result[k])!==JSON.stringify(result[k])))fail('PQ_PAY_RESPONSE_CONFLICT');
  return prior;
 }
 return frozen({...prior,result});
}

/** Derived read DATA only; neither a request executor nor a reconcile POST. */
export function pqPayQueryRequestDATA(input,original){
 const prior=parsePQPayProgress(input,original);
 if(prior.status!=='submission-unknown')fail('PQ_PAY_SUBMISSION_NOT_ENTERED');
 const t=prior.target,requestPath=t.kind==='invoice_terms'?`/v5/pay/invoice-intents/${t.intentId}`:
  `/v5/pay/invoices/${t.merchant}/${t.invoiceId}`;
 return frozen({method:'GET',requestPath});
}
// Capture actual framing before any interpretation, even a wrong method/path.
export function capturePQPayQueryPacket(input){return capturePQPayPacket(input);}
export function mergePQPayQueryPacket(input,captured,original){
 const prior=parsePQPayProgress(input,original),queryResult=packet(captured);
 if(prior.status!=='submission-unknown')fail('PQ_PAY_SUBMISSION_NOT_ENTERED');
 if(prior.queryResult!=null){
  if(resultKeys.some(k=>JSON.stringify(prior.queryResult[k])!==JSON.stringify(queryResult[k])))fail('PQ_PAY_QUERY_RESPONSE_CONFLICT');
  return prior;
 }
 // Keep the submission packet, target, identity, status and causes intact.
 return frozen({...prior,queryResult});
}
