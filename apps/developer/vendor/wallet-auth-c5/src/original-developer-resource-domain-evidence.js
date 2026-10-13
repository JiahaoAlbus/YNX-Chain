import {createHash,createPublicKey,verify} from 'node:crypto';
import {types} from 'node:util';
import {constants,openSync,closeSync,fstatSync,lstatSync,readSync} from 'node:fs';
import {isAbsolute,normalize,dirname,join,parse} from 'node:path';
import {canonicalJSON,exactFields,WalletAuthError} from './canonical.js';
import {parseProductSession} from './product-session-v2.js';

export const ORIGINAL_RESOURCE_DOMAIN_ROLE_DOMAIN='YNX_DEVELOPER_RESOURCE_DOMAIN_OPERATOR_ROLE_V1\n';
export const ORIGINAL_RESOURCE_DOMAIN_REGISTRATION_DOMAIN='YNX_DEVELOPER_RESOURCE_DOMAIN_OBSERVER_REGISTRATION_V1\n';
export const ORIGINAL_RESOURCE_DOMAIN_OBSERVATION_DOMAIN='YNX_DEVELOPER_RESOURCE_DOMAIN_OBSERVATION_V1\n';
const brands=new WeakSet();
const fail=(code='ORIGINAL_RESOURCE_DOMAIN_EVIDENCE_INVALID')=>{throw new WalletAuthError(code,'Original registered domain evidence is unavailable');};
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const eq=(a,b)=>canonicalJSON(a)===canonicalJSON(b);
const time=v=>{const n=Date.parse(v);if(typeof v!=='string'||!Number.isSafeInteger(n)||new Date(n).toISOString()!==v)fail();return n;};
const atTime=v=>{let n;try{n=Date.prototype.getTime.call(v);}catch{fail();}if(!Number.isSafeInteger(n))fail();return n;};
function data(raw,max=65536){
 const seen=new Set();let nodes=0;
 function copy(v,depth){
  if(++nodes>100000||depth>32)fail();
  if(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isSafeInteger(v))return v;
  if(!v||typeof v!=='object'||types.isProxy(v)||seen.has(v))fail();seen.add(v);
  const array=Array.isArray(v),out=array?[]:{};
  if(Object.getPrototypeOf(v)!==(array?Array.prototype:Object.prototype))fail();
  const keys=Reflect.ownKeys(v);if(array&&(keys.length!==v.length+1||keys.some(k=>k!=='length'&&(typeof k!=='string'||!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=v.length))))fail();
  for(const key of keys){if(array&&key==='length')continue;const d=Object.getOwnPropertyDescriptor(v,key);if(typeof key!=='string'||!d.enumerable||!Object.hasOwn(d,'value'))fail();Object.defineProperty(out,key,{value:copy(d.value,depth+1),enumerable:true});}
  seen.delete(v);return Object.freeze(out);
 }
 const captured=copy(raw,0);if(Buffer.byteLength(canonicalJSON(captured))>max)fail();return captured;
}
function parseRaw(raw){if(typeof raw!=='string'||Buffer.byteLength(raw)>65536)fail();let value;try{value=JSON.parse(raw);}catch{fail();}if(canonicalJSON(value)!==raw)fail();return data(value);}
function publicKey(raw){if(typeof raw!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(raw))fail();const b=Buffer.from(raw,'base64url');if(b.length!==32||b.toString('base64url')!==raw)fail();return createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),b]),format:'der',type:'spki'});}
function signed(raw,fields,domain,key){const envelope=data(raw);exactFields(envelope,['body','signature'],'NEW domain signature envelope');exactFields(envelope.body,fields,'NEW domain signed body');if(typeof envelope.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(envelope.signature))fail();const signature=Buffer.from(envelope.signature,'base64url');if(signature.length!==64||signature.toString('base64url')!==envelope.signature||!verify(null,Buffer.from(domain+canonicalJSON(envelope.body)),publicKey(key),signature))fail('ORIGINAL_RESOURCE_DOMAIN_SIGNATURE_INVALID');return envelope.body;}
const ROLE=['version','purpose','rootId','rootKeyId','operatorId','operatorKeyId','operatorPublicKey','registryDigest','operatorSessionDigest','account','deviceId','deviceBinding','sessionBinding','productId','clientId','platform','familyId','privateGeneration','issuedAt','expiresAt'];
const REG=['version','purpose','operatorId','operatorKeyId','operatorRoleDigest','observerId','observerKeyId','observerPublicKey','registryDigest','resourceOrigin','productId','clientId','platform','requiredScope','issuedAt','expiresAt'];
const RECEIPT=['version','purpose','observerId','observerKeyId','registrationDigest','registryDigest','sessionDigest','account','deviceId','deviceBinding','sessionBinding','productId','clientId','platform','familyId','privateGeneration','approvalDigest','approvedOwner','approvalNonce','actionNonce','intentId','projectId','projectDigest','resourceOrigin','resourceId','action','requiredScope','method','path','bodyDigest','accountGeneration','resourceRevision','projectRole','resourceRole','currentReference','issuedAt','expiresAt'];
function finite(body,at,limit,maxExpiry){const from=time(body.issuedAt),to=time(body.expiresAt);if(from>at||to<=at||to<=from||to-from>limit||to>maxExpiry)fail('ORIGINAL_RESOURCE_DOMAIN_EXPIRED');}
function capturedOperator(raw,role,at,mode){
 const captured=data(raw);exactFields(captured,['session','projection'],'Original Host operator capture');exactFields(captured.projection,['sessionBinding','familyId','generation','revoked'],'Original operator private projection');
 const s=parseProductSession(captured.session),p=captured.projection;if(!eq(s,captured.session)||sha(canonicalJSON(s))!==role.operatorSessionDigest||['account','deviceId','deviceBinding','sessionBinding','productId','clientId','platform'].some(k=>s[k]!==role[k])||p.sessionBinding!==s.sessionBinding||p.familyId!==role.familyId||p.generation!==role.privateGeneration||typeof p.revoked!=='boolean'||mode==='current'&&p.revoked)fail('ORIGINAL_RESOURCE_OPERATOR_BINDING_INVALID');
 if(time(s.issuedAt)>at||time(s.expiresAt)<=at)fail('ORIGINAL_RESOURCE_DOMAIN_EXPIRED');return captured;
}
function identity(s){return s.isDirectory()?['directory',s.dev,s.ino,s.uid,s.mode].join(':'):['file',s.dev,s.ino,s.uid,s.mode,s.nlink,s.size,s.mtimeMs,s.ctimeMs].join(':');}
function holdPublicSource(input){
 exactFields(input,['path','bytes','sha256'],'Protected NEW public domain source');if(typeof input.path!=='string'||!isAbsolute(input.path)||normalize(input.path)!==input.path||input.path.includes('\\')||!Number.isSafeInteger(input.bytes)||input.bytes<1||input.bytes>65536||!hash(input.sha256)||typeof process.getuid!=='function')fail('ORIGINAL_RESOURCE_SOURCE_NOT_CONFIGURED');
 const held=[],uid=process.getuid();
 try{
  const root=parse(input.path).root,parts=dirname(input.path).slice(root.length).split('/').filter(Boolean);let path=root;
  for(const part of ['',...parts]){
   if(part)path=join(path,part);const fd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW),stat=fstatSync(fd);held.push({path,fd,identity:identity(stat)});
   if(!stat.isDirectory()||![0,uid].includes(stat.uid)||(stat.mode&0o022)!==0)fail('ORIGINAL_RESOURCE_PUBLIC_SOURCE_UNSAFE');
  }
  const fd=openSync(input.path,constants.O_RDONLY|constants.O_NOFOLLOW),stat=fstatSync(fd);held.push({path:input.path,fd,identity:identity(stat)});
  if(!stat.isFile()||stat.uid!==uid||stat.nlink!==1||(stat.mode&0o077)!==0||stat.size!==input.bytes)fail('ORIGINAL_RESOURCE_PUBLIC_SOURCE_UNSAFE');
  const identities=()=>{for(const h of held){const pathStat=lstatSync(h.path);if(pathStat.isSymbolicLink()||identity(pathStat)!==h.identity||identity(fstatSync(h.fd))!==h.identity)fail('ORIGINAL_RESOURCE_PUBLIC_SOURCE_CHANGED');}};
  const check=()=>{identities();const raw=Buffer.alloc(65537);let total=0;while(total<raw.length){const n=readSync(fd,raw,total,raw.length-total,total);if(n===0)break;total+=n;}const bytes=raw.subarray(0,total),text=bytes.toString('utf8');if(total!==input.bytes||sha(bytes)!==input.sha256||!Buffer.from(text,'utf8').equals(bytes))fail('ORIGINAL_RESOURCE_PUBLIC_SOURCE_CHANGED');identities();return text;};
  const raw=check();return {raw,check,close:()=>{for(const h of held.splice(0).reverse())closeSync(h.fd);}};
 }catch(error){for(const h of held.reverse())try{closeSync(h.fd);}catch{}throw error;}
}

// Signatures are NEW-purpose software verification. Root/key admission and
// original Host operator current capture are external normal protected sources.
export function createOriginalDeveloperResourceDomainEvidenceVerifier(rawInput){
 if(!rawInput||typeof rawInput!=='object'||types.isProxy(rawInput)||Object.getPrototypeOf(rawInput)!==Object.prototype)fail('ORIGINAL_RESOURCE_SOURCE_NOT_CONFIGURED');
 const fields=['rootAnchor','originalOperatorCaptured','publicSource','registryDigest','at','mode'],descriptors=Object.getOwnPropertyDescriptors(rawInput);if(Reflect.ownKeys(descriptors).length!==fields.length||fields.some(k=>!descriptors[k]||!descriptors[k].enumerable||!Object.hasOwn(descriptors[k],'value')))fail('ORIGINAL_RESOURCE_SOURCE_NOT_CONFIGURED');
 const input=data(rawInput);exactFields(input,['rootAnchor','originalOperatorCaptured','publicSource','registryDigest','at','mode'],'Fixed NEW domain verifier config');if(!hash(input.registryDigest)||input.mode!=='current'&&input.mode!=='history')fail('ORIGINAL_RESOURCE_SOURCE_NOT_CONFIGURED');
 const root=input.rootAnchor;exactFields(root,['rootId','rootKeyId','publicKey'],'Independent NEW role root anchor');if(!id(root.rootId)||!id(root.rootKeyId))fail('ORIGINAL_RESOURCE_SOURCE_NOT_CONFIGURED');publicKey(root.publicKey);
 // Date cannot pass the data capture above. The constructor uses canonical UTC
 // at, while verification takes an intrinsic Date from the original writer.
 const initial=time(input.at);let held;
 try{
  held=holdPublicSource(input.publicSource);const source=parseRaw(held.raw);exactFields(source,['version','operatorRole','registration'],'Protected NEW domain source');if(source.version!=='ynx-developer-resource-domain-source/v1')fail();
  const role=signed(source.operatorRole,ROLE,ORIGINAL_RESOURCE_DOMAIN_ROLE_DOMAIN,root.publicKey);
  if(role.version!==1||role.purpose!=='developer-resource-domain-operator-role/v1'||role.rootId!==root.rootId||role.rootKeyId!==root.rootKeyId||!id(role.operatorId)||!id(role.operatorKeyId)||!hash(role.registryDigest)||!hash(role.operatorSessionDigest)||!Number.isSafeInteger(role.privateGeneration)||role.privateGeneration<1||typeof role.familyId!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(role.familyId))fail();
  if(role.registryDigest!==input.registryDigest)fail('ORIGINAL_RESOURCE_REGISTRY_BINDING_INVALID');
  publicKey(role.operatorPublicKey);if(time(role.issuedAt)>initial)fail();const roleAt=input.mode==='history'?time(role.issuedAt):initial;const original=capturedOperator(input.originalOperatorCaptured,role,roleAt,input.mode);finite(role,roleAt,86400000,time(original.session.expiresAt));
  const reg=signed(source.registration,REG,ORIGINAL_RESOURCE_DOMAIN_REGISTRATION_DOMAIN,role.operatorPublicKey);
  const scope=reg.resourceOrigin==='https://web4.ynxweb4.com'?'developer:resource:cloud-file-content':reg.resourceOrigin==='http://127.0.0.1:18111'?'developer:resource:ai-generation':null;
  if(reg.version!==1||reg.purpose!=='developer-resource-domain-observer-role/v1'||reg.operatorId!==role.operatorId||reg.operatorKeyId!==role.operatorKeyId||reg.operatorRoleDigest!==sha(canonicalJSON(source.operatorRole))||reg.registryDigest!==role.registryDigest||!id(reg.observerId)||!id(reg.observerKeyId)||reg.productId!=='developer'||reg.clientId!=='ynx-developer-v1'||reg.platform!=='macos'||!scope||reg.requiredScope!==scope||time(reg.issuedAt)>initial||time(reg.issuedAt)<time(role.issuedAt))fail();publicKey(reg.observerPublicKey);finite(reg,input.mode==='history'?time(reg.issuedAt):initial,86400000,time(role.expiresAt));
  const registrationDigest=sha(canonicalJSON(source.registration));held.check();let active=false,invalid=false,closed=false;
  const enter=()=>{if(active){invalid=true;fail('ORIGINAL_RESOURCE_REENTRY');}if(invalid||closed)fail('ORIGINAL_RESOURCE_SOURCE_NOT_CONFIGURED');active=true;};
  const sourceCheck=()=>{try{held.check();}catch(error){invalid=true;throw error;}if(invalid)fail('ORIGINAL_RESOURCE_REENTRY');};
  const result={
   registrationDigest,
   assertHeldSource(){enter();try{sourceCheck();return undefined;}finally{active=false;}},
   verifyDomainEvidence(rawReceipt,rawAssociation,at,mode,originalOperatorCurrent){enter();try{
    if(mode!=='current'&&mode!=='history'||input.mode==='history'&&mode!=='history')fail();const clock=atTime(at);sourceCheck();capturedOperator(originalOperatorCurrent,role,clock,mode);finite(role,clock,86400000,time(original.session.expiresAt));finite(reg,clock,86400000,time(role.expiresAt));
    const a=data(rawAssociation);exactFields(a,['approval','approvalDigest','approvedOwner','actor','request','requiredScope','actionProof'],'Original full domain association');if(typeof a.approval!=='string'||Buffer.byteLength(a.approval)>8192||sha(a.approval)!==a.approvalDigest)fail();const approval=parseRaw(a.approval),s=parseProductSession(a.actor.session),p=a.actor.projection,r=a.request;
    exactFields(a.actor,['session','projection'],'Original actor');exactFields(p,['sessionBinding','familyId','generation','revoked'],'Original private projection');exactFields(r,['intentId','projectId','projectDigest','resourceOrigin','resourceId','action','method','path','bodyDigest'],'Original resource request');
    if(!eq(s,a.actor.session)||s.applicationId!=='com.ynxweb4.developer.testnetpreview'||s.bundleId!==s.applicationId||s.packageId!==null||s.origin!=='app://macos/com.ynxweb4.developer.testnetpreview'||s.callback!=='ynxdeveloper://wallet-auth/callback'||typeof p.familyId!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(p.familyId)||!Number.isSafeInteger(p.generation)||p.generation<1||typeof p.revoked!=='boolean'||mode==='current'&&p.revoked||!id(r.intentId)||!id(r.projectId)||!id(r.resourceId)||!hash(r.projectDigest)||!hash(r.bodyDigest)||typeof approval.nonce!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(approval.nonce)||typeof a.actionProof.nonce!=='string'||!/^[A-Za-z0-9_-]{32,64}$/.test(a.actionProof.nonce))fail();
    const cloud=r.resourceOrigin==='https://web4.ynxweb4.com'&&r.action==='file-content-save'&&r.method==='PUT'&&r.path===`/api/v1/objects/${r.resourceId}/content`;
    const ai=r.resourceOrigin==='http://127.0.0.1:18111'&&r.action==='ai-generate'&&r.method==='POST'&&['/ai/stream','/ai/byok/stream','/ai-build/ai/stream','/ai-build/ai/byok/stream'].includes(r.path);if(!cloud&&!ai)fail();
    const b=signed(parseRaw(rawReceipt),RECEIPT,ORIGINAL_RESOURCE_DOMAIN_OBSERVATION_DOMAIN,reg.observerPublicKey);
    if(b.version!==1||b.purpose!=='developer-project-resource-domain-observation/v1'||b.observerId!==reg.observerId||b.observerKeyId!==reg.observerKeyId||b.registrationDigest!==registrationDigest||b.registryDigest!==reg.registryDigest||b.sessionDigest!==sha(canonicalJSON(s))||['account','deviceId','deviceBinding','sessionBinding','productId','clientId','platform'].some(k=>b[k]!==s[k])||s.productId!==reg.productId||s.clientId!==reg.clientId||s.platform!==reg.platform||b.familyId!==p.familyId||b.privateGeneration!==p.generation||p.sessionBinding!==s.sessionBinding||b.approvalDigest!==a.approvalDigest||b.approvedOwner!==a.approvedOwner||b.approvedOwner!==s.account||b.approvalNonce!==approval.nonce||b.actionNonce!==a.actionProof.nonce||b.intentId!==r.intentId||['projectId','projectDigest','resourceOrigin','resourceId','action','method','path','bodyDigest'].some(k=>b[k]!==r[k])||b.resourceOrigin!==reg.resourceOrigin||b.requiredScope!==reg.requiredScope||b.requiredScope!==a.requiredScope||!s.scopes.includes('account:read')||!s.scopes.includes(reg.requiredScope)||!Number.isSafeInteger(b.accountGeneration)||b.accountGeneration<1||!id(b.resourceRevision)||!['owner','editor'].includes(b.projectRole)||!['owner','editor'].includes(b.resourceRole)||typeof b.currentReference!=='string'||!/^[\x21-\x7e]{1,256}$/.test(b.currentReference))fail('ORIGINAL_RESOURCE_DOMAIN_BINDING_INVALID');
    finite(b,clock,30000,Math.min(time(s.expiresAt),time(reg.expiresAt)));if(time(b.issuedAt)<Math.max(time(s.issuedAt),time(reg.issuedAt),time(approval.issuedAt),time(a.actionProof.issuedAt))||clock>=time(approval.expiresAt)||clock>=time(a.actionProof.expiresAt))fail('ORIGINAL_RESOURCE_DOMAIN_EXPIRED');const output=data({version:'ynx-original-developer-resource-domain-observation/v1',approvalDigest:b.approvalDigest,approvedOwner:b.approvedOwner,accountGeneration:b.accountGeneration,resourceCurrent:{version:'ynx-original-developer-resource-current/v1',purpose:'developer-project-resource/v1',requiredScope:b.requiredScope,registrationDigest,sourceDigest:input.publicSource.sha256,currentReference:b.currentReference,account:b.account,deviceBinding:b.deviceBinding,sessionBinding:b.sessionBinding,familyId:b.familyId,privateGeneration:b.privateGeneration,projectId:b.projectId,projectDigest:b.projectDigest,resourceOrigin:b.resourceOrigin,resourceId:b.resourceId,projectRole:b.projectRole,resourceRole:b.resourceRole,resourceRevision:b.resourceRevision,issuedAt:b.issuedAt,expiresAt:b.expiresAt}});
    sourceCheck();return output;
   }finally{active=false;}},
   close(){enter();try{closed=true;held.close();}finally{active=false;}}
  };
  const fixed=Object.freeze(result);brands.add(fixed);return fixed;
 }catch(error){if(held)held.close();throw error;}
}
export function assertOriginalDeveloperResourceDomainEvidenceVerifier(value){if(!brands.has(value))fail('ORIGINAL_RESOURCE_SOURCE_NOT_CONFIGURED');return value;}
