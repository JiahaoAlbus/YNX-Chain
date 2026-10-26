// Companion of the ORIGINAL bounded Source driver, not another executable,
// service, Source holder, approval provider or generic signing interface.
import {X509Certificate} from 'node:crypto';
import {request} from 'node:https';
import {checkServerIdentity} from 'node:tls';
import {canonical,sha} from './original-auth-identity-source-verifier.mjs';
import {parseOriginalAuthIdentityRequest} from './original-auth-identity-v2-contract.mjs';
import {verifyOriginalAuthIdentityProofFrameData} from '../src/auth-identity-verification.js';
import {preparePQAuthorizationQuery} from '../src/pq-wallet-authorization.js';
import {parsePQAccountAuthorization,assertPQAuthorizationCurrent} from '../src/pq-wallet-policy.js';
const coded=code=>Object.assign(new Error(code),{code});
const bad=code=>{throw coded(code);};
// Do not publish remote bodies, certificate errors or arbitrary exception text.
// Preserve this client's precise first cause rather than hiding it as generic
// UNAVAILABLE when destroy() subsequently emits an error event.
const transportError=error=>coded([
 'AUTH_IDENTITY_NATIVE_NODE_PIN_MISMATCH','AUTH_IDENTITY_NATIVE_NODE_TIMEOUT',
 'AUTH_IDENTITY_NATIVE_NODE_CAPACITY','AUTH_IDENTITY_NATIVE_NODE_RESPONSE_INVALID',
 'AUTH_IDENTITY_NATIVE_NODE_TLS_IDENTITY_INVALID',
].includes(error?.code)?error.code:'AUTH_IDENTITY_NATIVE_NODE_UNAVAILABLE');
const exact=(v,keys)=>{if(!v||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))bad('AUTH_IDENTITY_PROOF_DISPATCH_SCHEMA');};
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function binding(value){
 exact(value,['origin','spki','nativeChainId']);
 let url;try{url=new URL(value.origin);}catch{bad('AUTH_IDENTITY_NATIVE_NODE_BINDING_REQUIRED');}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||value.origin!==url.origin||!hash(value.spki)||typeof value.nativeChainId!=='string'||!/^[1-9][0-9]*$/.test(value.nativeChainId))bad('AUTH_IDENTITY_NATIVE_NODE_BINDING_REQUIRED');
 return Object.freeze({...value});
}
// The original Native compiled release supplies this origin/SPKI. HTTPS200 is
// NOT provenance: platform TLS AND exact SPKI AND independent binding are
// mandatory. This is trusted-node current data, not independent BFT finality.
export function fetchOriginalNativeAuthorization(node,owner){
 node=binding(node);const query=preparePQAuthorizationQuery(owner);
 const url=new URL(node.origin);url.pathname=url.pathname.replace(/\/$/,'')+query.path;
 return new Promise((resolve,reject)=>{
  const chunks=[];let size=0,settled=false;
  const done=(e,v)=>{if(settled)return;settled=true;e?reject(e):resolve(v);};
  const req=request(url,{method:'GET',timeout:2000,agent:false,headers:{accept:'application/json','cache-control':'no-store'},checkServerIdentity(host,cert){
   const error=checkServerIdentity(host,cert);if(error)return coded('AUTH_IDENTITY_NATIVE_NODE_TLS_IDENTITY_INVALID');
   try{if(sha(new X509Certificate(cert.raw).publicKey.export({type:'spki',format:'der'}))!==node.spki)return coded('AUTH_IDENTITY_NATIVE_NODE_PIN_MISMATCH');}
   catch{return coded('AUTH_IDENTITY_NATIVE_NODE_PIN_MISMATCH');}
  }},res=>{
   res.on('error',e=>done(transportError(e)));
   if(res.statusCode!==200||!/^application\/json(?:\s*;|$)/i.test(String(res.headers['content-type']??''))){done(coded('AUTH_IDENTITY_NATIVE_NODE_UNAVAILABLE'));res.destroy();return;}
   res.on('data',b=>{size+=b.length;if(size>1048576){done(coded('AUTH_IDENTITY_NATIVE_NODE_CAPACITY'));res.destroy();}else chunks.push(b);});
   res.on('end',()=>{if(settled)return;try{const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));done(null,JSON.parse(raw));}catch{done(coded('AUTH_IDENTITY_NATIVE_NODE_RESPONSE_INVALID'));}});
   res.on('aborted',()=>done(coded('AUTH_IDENTITY_NATIVE_NODE_UNAVAILABLE')));
   res.on('close',()=>{if(!res.complete)done(coded('AUTH_IDENTITY_NATIVE_NODE_UNAVAILABLE'));});
  });
  const timeout=()=>{const error=coded('AUTH_IDENTITY_NATIVE_NODE_TIMEOUT');done(error);req.destroy(error);};
  const timer=setTimeout(timeout,2000);
  req.on('close',()=>clearTimeout(timer));req.on('timeout',timeout);
  req.on('error',e=>done(transportError(e)));req.end();
 });
}
// Optional getter is only an explicit PUBLIC test seam for this DATA helper.
// The original stdin driver NEVER accepts a callback/module/provider selector:
// it invokes this function with the fixed implementation above.
export async function dispatchOriginalIDEAuthProof(input,getRegistration=fetchOriginalNativeAuthorization){
 exact(input,['operation','node','requestRaw','expectedRequestRaw','purpose','atMs','wireBase64url']);
 if(input.operation!=='auth-identity-proof-native-node/v1')bad('AUTH_IDENTITY_PROOF_DISPATCH_OPERATION');
 const node=binding(input.node),expected=parseOriginalAuthIdentityRequest(input.expectedRequestRaw);
 if(input.requestRaw!==input.expectedRequestRaw||input.purpose!==expected.purpose)bad('AUTH_IDENTITY_PROOF_DISPATCH_EXPECTED_MISMATCH');
 // This equality is only correlation DATA. Native independently constructed
// and retained expected, authenticated Source/permission and selected once.
 const network={chainId:expected.networkId,nativeChainId:node.nativeChainId,owner:expected.owner};
 const registration=await getRegistration(node,expected.owner);
 const before=parsePQAccountAuthorization(registration,network);
 if(before.executionHeight!==expected.executionHeight)bad('AUTH_IDENTITY_PROOF_DISPATCH_HEIGHT_CHANGED');
 const result=verifyOriginalAuthIdentityProofFrameData(canonical({version:'YNX-AUTH-IDENTITY-PROOF-DATA/v1',
  requestRaw:input.requestRaw,expectedRequestRaw:input.expectedRequestRaw,purpose:input.purpose,atMs:input.atMs,
  registration,network,wireBase64url:input.wireBase64url}));
 const after=parsePQAccountAuthorization(await getRegistration(node,expected.owner),network);
 assertPQAuthorizationCurrent(before,after);
 if(after.executionHeight!==before.executionHeight)bad('AUTH_IDENTITY_PROOF_DISPATCH_HEIGHT_CHANGED');
 // Only sole SDK's frozen15 DATA result is returned. No Root/Source/policy
 // snapshot, private material, approval, native grant or effect retry token.
 return result;
}
