// Same original bounded read-only verifier process. No key acquisition,
// native-addon load, Source factory, issuer activation or granting callback.
import {request} from 'node:https';import {checkServerIdentity} from 'node:tls';import {X509Certificate} from 'node:crypto';
import {canonical,sha} from './original-auth-identity-source-verifier.mjs';
import {dispatchOriginalSourceV2} from './original-auth-source-v2-dispatch.mjs';
import {fetchOriginalNativeAuthorization} from './original-ide-auth-proof-dispatch.mjs';
import {parsePQAccountAuthorization,assertPQAuthorizationCurrent} from '../src/pq-wallet-policy.js';
import {verifyOriginalIDEApprovalCurrentDATA,ORIGINAL_IDE_APPROVAL_SOURCE_PURPOSE} from './original-ide-publication-approval-contract.mjs';
import {originalApprovalStateHeadDATA} from './original-ide-approval-state-head-data.mjs';
const coded=code=>Object.assign(new Error(code),{code});
const fail=code=>{throw coded(code);};
function exact(v,keys){if(!v||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).sort().join('|')!==keys.slice().sort().join('|')||Object.values(Object.getOwnPropertyDescriptors(v)).some(d=>!Object.hasOwn(d,'value')||!d.enumerable))fail('AUTH_APPROVAL_DISPATCH_SCHEMA');}
function parse(raw,cap){if(typeof raw!=='string'||!raw.length||Buffer.byteLength(raw)>cap)fail('AUTH_APPROVAL_DISPATCH_CAPACITY');let v;try{v=JSON.parse(raw);}catch{fail('AUTH_APPROVAL_DISPATCH_CANONICAL');}if(canonical(v)!==raw)fail('AUTH_APPROVAL_DISPATCH_CANONICAL');return v;}
function enrollmentBody(raw){const e=parse(raw,393216),b=Buffer.from(e.body??'','base64url');if(!b.length||b.length>65536||b.toString('base64url')!==e.body)fail('AUTH_APPROVAL_DISPATCH_ENROLLMENT');return parse(new TextDecoder('utf8',{fatal:true}).decode(b),65536);}
function liveProjection(p,at){if(!p||p.dataOnly!==true||p.nativeAdmission!==false||p.status!=='active'||!Number.isSafeInteger(p.generation)||p.generation<1||!Number.isSafeInteger(p.sequence)||p.sequence<1||!Number.isSafeInteger(p.floor)||p.floor<0||p.floor>p.sequence||typeof p.head!=='string'||!/^[a-f0-9]{64}$/.test(p.head)||!Number.isSafeInteger(p.timeFloor)||p.timeFloor<0||!Number.isSafeInteger(p.expiresAtMs)||at<p.timeFloor||at>=p.expiresAtMs||typeof p.executionHeight!=='string'||!/^(0|[1-9][0-9]*)$/.test(p.executionHeight)||BigInt(p.executionHeight)>0xffffffffffffffffn)fail('AUTH_APPROVAL_DISPATCH_SOURCE_NOT_CURRENT');}
// Fixed new path in the SAME Root-selected original Auth realm/TLS pin. No
// request JSON/redirect/env may select an alternate service or TLS identity.
export function fetchOriginalIDEApprovalCurrent(policy,profileDigest,scopeOriginal,nonce){
 if(policy.endpoint!=='https://wallet-auth.ynxweb4.com/v1/auth-identity/source-current'||typeof policy.spki!=='string'||!/^[a-f0-9]{64}$/.test(policy.spki)||! /^[a-f0-9]{64}$/.test(profileDigest)||! /^[A-Za-z0-9_-]{43}$/.test(nonce))fail('AUTH_APPROVAL_QUERY_BINDING');
 const scope=parse(scopeOriginal,16384),url=new URL('https://wallet-auth.ynxweb4.com/v1/ide-publication-approval-current');url.searchParams.set('profile',profileDigest);url.searchParams.set('approvalRef',scope.actualApprovalRef);url.searchParams.set('scope',sha(scopeOriginal));url.searchParams.set('nonce',nonce);
 return new Promise((resolve,reject)=>{let settled=false,size=0;const chunks=[];const done=(e,v)=>{if(settled)return;settled=true;e?reject(e):resolve(v);};const req=request(url,{method:'GET',agent:false,timeout:2000,headers:{accept:'application/json','cache-control':'no-store'},checkServerIdentity(host,cert){const error=checkServerIdentity(host,cert);if(error)return coded('AUTH_APPROVAL_QUERY_TLS');try{if(sha(new X509Certificate(cert.raw).publicKey.export({type:'spki',format:'der'}))!==policy.spki)return coded('AUTH_APPROVAL_QUERY_PIN');}catch{return coded('AUTH_APPROVAL_QUERY_PIN');}}},res=>{
  res.on('error',()=>done(Object.assign(coded('AUTH_APPROVAL_QUERY_UNAVAILABLE'),{code:'AUTH_APPROVAL_QUERY_UNAVAILABLE'})));if(res.statusCode!==200||!/^application\/json(?:\s*;|$)/i.test(String(res.headers['content-type']??''))){done(coded('AUTH_APPROVAL_QUERY_STATUS'));res.destroy();return;}
  res.on('data',b=>{size+=b.length;if(size>393216){done(coded('AUTH_APPROVAL_QUERY_CAPACITY'));res.destroy();}else chunks.push(b);});res.on('end',()=>{try{const raw=new TextDecoder('utf8',{fatal:true}).decode(Buffer.concat(chunks));parse(raw,393216);done(null,raw);}catch{done(coded('AUTH_APPROVAL_QUERY_ENCODING'));}});res.on('aborted',()=>done(coded('AUTH_APPROVAL_QUERY_UNAVAILABLE')));res.on('close',()=>{if(!res.complete)done(coded('AUTH_APPROVAL_QUERY_UNAVAILABLE'));});
 });const timeout=()=>{done(coded('AUTH_APPROVAL_QUERY_TIMEOUT'));req.destroy();};const timer=setTimeout(timeout,2000);req.on('close',()=>clearTimeout(timer));req.on('timeout',timeout);req.on('error',()=>done(coded('AUTH_APPROVAL_QUERY_UNAVAILABLE')));req.end();});
}
// Getters are explicit PUBLIC DATA test seams, NEVER accepted by stdin. The
// original process branch invokes these fixed implementations with no seam.
export async function dispatchOriginalIDEApprovalCurrent(input,getSource=dispatchOriginalSourceV2,getApproval=fetchOriginalIDEApprovalCurrent,getRole=fetchOriginalNativeAuthorization){
 const result={version:'YNX-IDE-APPROVAL-VERIFICATION-DATA/v1',completed:false,sourceBefore:null,sourceAfter:null,approvalOriginal:'',projection:null,failureCode:'',dataOnly:true,authorized:false,nativeAdmission:false};
 try{
  exact(input,['operation','source','expectedScopeOriginal','nonce','previous']);if(input.operation!=='ide-publication-approval-current-native-node/v1'||input.source?.policy?.signatureContract?.purpose!==ORIGINAL_IDE_APPROVAL_SOURCE_PURPOSE||typeof input.nonce!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(input.nonce))fail('AUTH_APPROVAL_DISPATCH_SCOPE_REQUIRED');
  const root=parse(input.source.rootRaw,16384),enrollment=enrollmentBody(input.source.enrollmentRaw),profileDigest=sha(input.source.profileRaw);const first=await getSource(input.source);result.sourceBefore=first;const before=first.projection;liveProjection(before,Date.now());
  if(before?.dataOnly!==true||before.nativeAdmission!==false||before.status!=='active'||before.profileDigest!==profileDigest||before.selection?.publicationApprovalAuthority?.scopeOriginal!==input.expectedScopeOriginal)fail('AUTH_APPROVAL_DISPATCH_SCOPE_NOT_SELECTED');
  const network={chainId:root.networkId,nativeChainId:input.source.node.nativeChainId,owner:enrollment.currentOwner};const roleBefore=parsePQAccountAuthorization(await getRole(input.source.node,enrollment.currentOwner),network);
  const raw=await getApproval(input.source.policy,profileDigest,input.expectedScopeOriginal,input.nonce);result.approvalOriginal=raw; // exact original retained BEFORE status/late checks
  const e=parse(raw,393216),roleAfter=parsePQAccountAuthorization(await getRole(input.source.node,enrollment.currentOwner),network);assertPQAuthorizationCurrent(roleBefore,roleAfter);
  if(e.binding?.owner!==enrollment.currentOwner||e.binding.networkId!==root.networkId||BigInt(e.binding.executionHeight)<BigInt(before.executionHeight)||BigInt(e.binding.executionHeight)<BigInt(roleBefore.executionHeight))fail('AUTH_APPROVAL_DISPATCH_ISSUANCE_ROLLBACK');
  const projected=verifyOriginalIDEApprovalCurrentDATA(raw,roleAfter,input.expectedScopeOriginal,input.nonce,input.previous,Date.now());result.projection=projected;
  const sourceAgain={...input.source,previous:{sequence:before.sequence,floor:before.floor,head:before.head,timeFloor:before.timeFloor,executionHeight:before.executionHeight}};const last=await getSource(sourceAgain);result.sourceAfter=last;const after=last.projection;liveProjection(after,Date.now());
  if(after?.status!=='active'||after.profileDigest!==before.profileDigest||after.generation!==before.generation||after.sourceId!==before.sourceId||after.instanceId!==before.instanceId||after.sequence!==before.sequence||after.floor!==before.floor||after.head!==before.head||BigInt(after.executionHeight)<BigInt(roleAfter.executionHeight)||BigInt(after.executionHeight)<BigInt(projected.statementExecutionHeight)||after.selection?.publicationApprovalAuthority?.scopeOriginal!==input.expectedScopeOriginal||after.head!==originalApprovalStateHeadDATA(input.expectedScopeOriginal,e.currentOriginal))fail('AUTH_APPROVAL_DISPATCH_POST_SOURCE_CHANGED');
  const roleFinal=parsePQAccountAuthorization(await getRole(input.source.node,enrollment.currentOwner),network);assertPQAuthorizationCurrent(roleAfter,roleFinal);const now=Date.now();if(now<before.timeFloor||now<after.timeFloor||now<projected.timeFloor||now>=Math.min(before.expiresAtMs,after.expiresAtMs,projected.expiresAtMs))fail('AUTH_APPROVAL_DISPATCH_POST_EXPIRED');
  result.completed=true;
 }catch(error){result.failureCode=typeof error?.code==='string'&&/^(AUTH_|IDE_|PQ_)[A-Z0-9_]{1,100}$/.test(error.code)?error.code:'AUTH_APPROVAL_DISPATCH_UNKNOWN';}
 return Object.freeze(result);
}
