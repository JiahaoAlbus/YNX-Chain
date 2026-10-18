import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {PQ_ACTION_MEMBER_MAX_BYTES,PQ_ACTION_TRANSPORT_MAX_BYTES} from '@ynx-chain/wallet-auth/pq-action-transport';
import {inspectPQReviewedTypedTransportOriginal} from './typed-action-reviewed-transport.mjs';

// Existing Go PQActionView, not the single-PQ finality collector. No network,
// signature, journal write, retry or independently anchored proof is performed.
export const PQ_TYPED_QUERY_MAX_BYTES=8<<20;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const invalid=()=>fail('PQ_TYPED_QUERY_RESPONSE_INVALID');
const hash=b=>'0x'+createHash('sha256').update(b).digest('hex');
const hashPattern=/^0x[0-9a-f]{64}$/;
const required=['type','status','committed','source','nativeTransactionHash','executionHeight','amount','fee','nonce','readbackUrl'];
const fields=[...required,'abciTransactionHash','wire','transport','cometIndex','from','to','effects','abciReadbackUrl','error'];
const responseFields=['method','requestPath','status','contentType','cacheControl','body'];
const typed=Object.getPrototypeOf(Uint8Array.prototype);
const bufferOf=Object.getOwnPropertyDescriptor(typed,'buffer').get;
const lengthOf=Object.getOwnPropertyDescriptor(typed,'length').get;
const offsetOf=Object.getOwnPropertyDescriptor(typed,'byteOffset').get;
const resizable=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable').get;
const detached=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'detached').get;
function responseData(input){
 if(!input||typeof input!=='object'||types.isProxy(input)||Object.getPrototypeOf(input)!==Object.prototype)invalid();
 const ds=Object.getOwnPropertyDescriptors(input),keys=Reflect.ownKeys(ds);
 if(keys.length!==responseFields.length||keys.some(k=>!responseFields.includes(k)||!ds[k].enumerable||!Object.hasOwn(ds[k],'value')))invalid();
 return Object.fromEntries(responseFields.map(k=>[k,ds[k].value]));
}
function copyBody(value){
 if(types.isProxy(value)||!types.isUint8Array(value))invalid();
 const buffer=bufferOf.call(value),length=lengthOf.call(value),offset=offsetOf.call(value);
 if(types.isSharedArrayBuffer(buffer)||resizable.call(buffer)||detached.call(buffer)||!length||length>PQ_TYPED_QUERY_MAX_BYTES)invalid();
 return new Uint8Array(new Uint8Array(buffer,offset,length));
}

// HTTP JSON grammar only. Preserve Go decimal strings; reject duplicate keys
// (including escaped aliases), prototype keys and all numeric tokens except
// the root's canonical uint32 Comet index. Effects are untrusted DATA, not proof.
function parseView(text){
 let at=0,nodes=0;
 const skip=()=>{while(at<text.length&&/[ \t\r\n]/.test(text[at]))at++;};
 const string=()=>{
  if(text[at++]!=='"')invalid();const start=at-1;
  while(at<text.length){const code=text.charCodeAt(at++);if(code<32)invalid();if(code===92){at++;continue;}if(code===34){
   let result;try{result=JSON.parse(text.slice(start,at));}catch{invalid();}
   for(const c of result){const n=c.codePointAt(0);if(n>=0xd800&&n<=0xdfff)invalid();}return result;
  }}invalid();
 };
 const value=(depth,key)=>{
  if(depth>32||++nodes>131072)invalid();skip();
  const c=text[at];
  if(c==='"')return string();
  if(c==='{'){
   at++;const out=Object.create(null),seen=new Set();skip();
   if(text[at]!=='}')for(;;){skip();const k=string();if(seen.has(k)||['__proto__','constructor','prototype'].includes(k)||depth===0&&!fields.includes(k))invalid();seen.add(k);skip();if(text[at++]!==':')invalid();out[k]=value(depth+1,k);skip();if(text[at]==='}')break;if(text[at++]!==',')invalid();}
   if(text[at++]!=='}')invalid();return Object.freeze(out);
  }
  if(c==='['){at++;const out=[];skip();if(text[at]!==']')for(;;){out.push(value(depth+1,''));skip();if(text[at]===']')break;if(text[at++]!==',')invalid();}if(text[at++]!==']')invalid();return Object.freeze(out);}
  for(const [token,result]of [['true',true],['false',false],['null',null]])if(text.slice(at,at+token.length)===token){at+=token.length;return result;}
  if(depth===1&&key==='cometIndex'){
   const start=at;while(/[0-9]/.test(text[at]??'x'))at++;const token=text.slice(start,at);
   if(!/^(0|[1-9][0-9]{0,9})$/.test(token)||BigInt(token)>0xffffffffn)invalid();return Number(token);
  }
  invalid();
 };
 const out=value(0,'');skip();if(at!==text.length||!out||Object.getPrototypeOf(out)!==null)invalid();return out;
}
function decimal(value,signed=false){
 if(typeof value!=='string'||!(signed?/^(0|-?[1-9][0-9]{0,18})$/:/^(0|[1-9][0-9]{0,19})$/).test(value))invalid();
 const n=BigInt(value);if(signed?n<-(1n<<63n)||n>=(1n<<63n):n>=(1n<<64n))invalid();return value;
}
function base64(value,max){
 if(typeof value!=='string'||!value.length||value.length%4!==0||value.length>4*Math.ceil(max/3)||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))invalid();
 const raw=Buffer.from(value,'base64');if(!raw.length||raw.length>max||raw.toString('base64')!==value)invalid();return raw;
}

/** Decode actual GET metadata/UTF-8 bytes. Generic DATA accepts the original
 * N2 fixture without granting it the local signer's N1/index0 contract. */
export function decodePQTypedActionQueryResponse(input){
 const response=responseData(input);
 if(response.method!=='GET'||typeof response.requestPath!=='string'||!/^\/transactions\/pq\/actions\/(?:originals\/)?0x[0-9a-f]{64}$/.test(response.requestPath)||response.cacheControl!=='no-store'||typeof response.contentType!=='string'||!/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.contentType))invalid();
 if(response.status!==200&&response.status!==202)fail('PQ_TYPED_QUERY_HTTP_STATUS');
 let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(copyBody(response.body));}catch{invalid();}
 const view=parseView(text),has=k=>Object.hasOwn(view,k);
 if(required.some(k=>!has(k))||view.source!=='comet-rpc'||typeof view.committed!=='boolean'||!['committed','rejected','unknown'].includes(view.status))invalid();
 for(const k of ['type','nativeTransactionHash','readbackUrl','abciTransactionHash','wire','transport','from','to','abciReadbackUrl','error'])if(has(k)&&typeof view[k]!=='string')invalid();
 decimal(view.executionHeight);decimal(view.fee);decimal(view.nonce);decimal(view.amount,true);
 const nativePath=response.requestPath.includes('/originals/'),requested=response.requestPath.split('/').at(-1);
 if(view.nativeTransactionHash!==''&&!hashPattern.test(view.nativeTransactionHash)||has('abciTransactionHash')&&!hashPattern.test(view.abciTransactionHash))invalid();
 if(nativePath?view.nativeTransactionHash!==requested:view.abciTransactionHash!==requested)fail('PQ_TYPED_QUERY_BINDING_MISMATCH');
 if(view.readbackUrl!==(view.nativeTransactionHash?'/transactions/pq/actions/originals/'+view.nativeTransactionHash:''))invalid();
 if(has('abciTransactionHash')?view.abciReadbackUrl!=='/transactions/pq/actions/'+view.abciTransactionHash:has('abciReadbackUrl'))invalid();
 if(has('cometIndex')&&(!Number.isInteger(view.cometIndex)||view.cometIndex<0||view.cometIndex>0xffffffff))invalid();
 if(has('effects')&&(!view.effects||Array.isArray(view.effects)||typeof view.effects!=='object'))invalid();
 const identity=view.type!=='';
 if(identity){
  if(!/^[a-z][a-z0-9_]{0,63}$/.test(view.type)||!hashPattern.test(view.nativeTransactionHash)||!has('abciTransactionHash')||!/^0x[0-9a-f]{40}$/.test(view.from??'')||!has('wire')||!has('transport'))invalid();
  if(hash(base64(view.wire,PQ_ACTION_MEMBER_MAX_BYTES))!==view.nativeTransactionHash||hash(base64(view.transport,PQ_ACTION_TRANSPORT_MAX_BYTES))!==view.abciTransactionHash)fail('PQ_TYPED_QUERY_BINDING_MISMATCH');
 }else if(['wire','transport','from','to','effects','cometIndex'].some(has)||view.fee!=='0'||view.nonce!=='0'||view.amount!=='0')invalid();
 if(response.status===202){
  if(view.status!=='unknown'||view.committed||view.executionHeight!=='0'||has('effects')||has('cometIndex')||!has('error'))invalid();
 }else{
  if(!identity||view.executionHeight==='0'||!has('cometIndex')||view.status==='unknown')invalid();
  // The original-hash route requires committed history; Go converts its
  // disagreement with an indexed rejection to 202/unknown. ABCI can reject.
  if(nativePath&&view.status==='rejected')invalid();
  if(view.status==='committed'?!view.committed||!has('effects')||has('error'):view.committed||has('effects')||has('to')||view.amount!=='0')invalid();
 }
 return Object.freeze({requestPath:response.requestPath,httpStatus:response.status,view,dataOnly:true,proofVerification:'not-performed',independentFinality:false});
}

/** Normal Main observer. Revalidate retained original review/snapshots/raw and
 * both hashes using aeeb first; node response can never substitute those inputs.
 * Output omits unproved effects, logs, amount/to and replayable raw bytes. */
export function inspectPQReviewedTypedActionQuery(archivedReview,rawTransport,original,response){
 const local=inspectPQReviewedTypedTransportOriginal(archivedReview,rawTransport,original);
 const decoded=decodePQTypedActionQueryResponse(response),v=decoded.view;
 if(decoded.requestPath!=='/transactions/pq/actions/originals/'+local.memberHash&&decoded.requestPath!=='/transactions/pq/actions/'+local.transportHash)fail('PQ_TYPED_QUERY_BINDING_MISMATCH');
 if(v.nativeTransactionHash&&v.nativeTransactionHash!==local.memberHash||v.abciTransactionHash&&v.abciTransactionHash!==local.transportHash)fail('PQ_TYPED_QUERY_BINDING_MISMATCH');
 const full=v.type!=='';
 if(full&&(v.type!==local.action.kind||v.from!==local.account||v.fee!==local.action.fee||v.nonce!==local.action.nonce||!Buffer.from(v.wire,'base64').equals(local.member)||!Buffer.from(v.transport,'base64').equals(local.body)))fail('PQ_TYPED_QUERY_BINDING_MISMATCH');
 if(decoded.httpStatus===200&&BigInt(v.executionHeight)<BigInt(local.executionHeight))fail('PQ_TYPED_QUERY_BINDING_MISMATCH');
 return Object.freeze({kind:'pq-typed-action',operationId:local.operationId,account:local.account,networkId:local.networkId,
  memberHash:local.memberHash,transportHash:local.transportHash,requestDigest:local.requestDigest,
  actionKind:local.action.kind,nonce:local.action.nonce,policyRevision:local.policyRevision,
  reviewExecutionHeight:local.reviewExecutionHeight,signingExecutionHeight:local.executionHeight,
  memberCount:1,memberIndex:0,signatureVerified:true,classicWitnessValidationRequired:local.classicWitnessValidationRequired,
  source:'comet-rpc',observedStatus:v.status,observedExecutionHeight:v.executionHeight,cometIndex:v.cometIndex??null,
  requestPath:decoded.requestPath,httpStatus:decoded.httpStatus,originalBytesObserved:full,httpResponseInspected:true,
  dataOnly:true,observationOnly:true,effectsVerified:false,proofVerification:'not-performed',independentFinality:false,
  nativeAdmission:false,permissionGranted:false,submitted:false,canRetry:false,clearsOriginal:false,consensusFinality:false});
}
