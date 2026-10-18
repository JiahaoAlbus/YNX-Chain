// Original Auth v2 credential mathematics. Not a Source/Root constructor,
// registration issuer, Native admission, signing owner, session or TLS upgrade.
// Native must supply independently authenticated current registration views
// under its original protected owner BEFORE AND AFTER using these functions.
import {encodeFields} from '@ynx/batch-v01-candidate';
import {canonical,sha,originalSignatureContract} from './original-auth-identity-source-verifier.mjs';
import {exactPQRecord,pqDecodeBase64url,pqBase64url} from '../src/pq-wallet-contract.js';
import {pqU64} from '../src/pq-wallet-authorization.js';
import {inspectPQAuthorizationView} from '../src/pq-wallet-policy.js';
import {verifyPQRegisteredMemberData} from '../src/pq-registered-member.js';

export const AUTH_SOURCE_V2='YNX-AUTH-SOURCE/v2';
export const AUTH_SOURCE_DOMAIN_V2='YNX/AUTH/SOURCE-ORIGINAL/V2';
export const AUTH_SOURCE_STATEMENT_CAP=393216;
const suite='YNX-BATCH/v0.1',ops=['beginYNX','handleReturn','restore','disconnect'];
const purposes=Object.freeze({enrollment:'AUTH-SOURCE-ENROLLMENT',profile:'AUTH-SOURCE-PROFILE',current:'AUTH-SOURCE-CURRENT'});
const fail=code=>{throw Object.assign(new Error(code),{code});};
const hex=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const owner=x=>typeof x==='string'&&/^0x[0-9a-f]{40}$/.test(x);
const token=x=>typeof x==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(x);
const integer=x=>Number.isSafeInteger(x)&&x>=0;
const seal=x=>{if(x&&typeof x==='object'){for(const v of Object.values(x))seal(v);Object.freeze(x);}return x;};
function parse(raw,cap=AUTH_SOURCE_STATEMENT_CAP){
 if(typeof raw!=='string'||!raw.length||Buffer.byteLength(raw)>cap)fail('AUTH_SOURCE_V2_CAPACITY');
 let value;try{value=JSON.parse(raw);}catch{fail('AUTH_SOURCE_V2_CANONICAL');}
 if(canonical(value)!==raw)fail('AUTH_SOURCE_V2_CANONICAL');return seal(value);
}
function exact(v,fields){return exactPQRecord(v,fields,'AUTH_SOURCE_V2_SCHEMA');}
function decimal(v,nonzero=false){
 if(typeof v!=='string')fail('AUTH_SOURCE_V2_DECIMAL');let n;try{n=pqU64(v);}catch{fail('AUTH_SOURCE_V2_DECIMAL');}
 if(nonzero&&!n)fail('AUTH_SOURCE_V2_DECIMAL');return n;
}
function window(body,at,limit){
 if(!integer(at)||!integer(body.issuedAtMs)||!integer(body.expiresAtMs)||body.expiresAtMs<=body.issuedAtMs||body.expiresAtMs-body.issuedAtMs>limit||at<body.issuedAtMs||at>=body.expiresAtMs)fail('AUTH_SOURCE_V2_EXPIRED');
}
function absolute(p){return typeof p==='string'&&p.startsWith('/')&&p.length<=4096&&!p.includes('\0')&&!p.split('/').some(v=>v==='.'||v==='..');}
function context(v){
 exact(v,['networkId','owner','keyVersion','executionHeight']);
 if(!hex(v.networkId)||!owner(v.owner))fail('AUTH_SOURCE_V2_CONTEXT');decimal(v.keyVersion,true);decimal(v.executionHeight);return v;
}
export function encodeOriginalAuthSourceStatementV2(role,frame,binding,bodyRaw){
 if(!Object.hasOwn(purposes,role)||typeof frame!=='string'||!frame.length||Buffer.byteLength(frame)>512||frame.includes('\0'))fail('AUTH_SOURCE_V2_FRAME');
 context(binding);parse(bodyRaw,65536);
 return new Uint8Array(encodeFields([AUTH_SOURCE_DOMAIN_V2,role,frame,binding.networkId,binding.owner,binding.keyVersion,binding.executionHeight,bodyRaw]));
}
export function canonicalOriginalAuthSourceEnvelopeV2(role,binding,bodyRaw,memberWire){
 context(binding);encodeOriginalAuthSourceStatementV2(role,'DATA-ONLY-ENCODING',binding,bodyRaw);
 const member=pqBase64url(memberWire);
 const raw=canonical({version:2,algorithmVersion:suite,role,...binding,body:pqBase64url(Buffer.from(bodyRaw)),member});
 parse(raw);return raw;
}
function envelope(raw,role,frame,snapshot,networkId,expectedOwner){
 const e=parse(raw);exact(e,['version','algorithmVersion','role','networkId','owner','keyVersion','executionHeight','body','member']);
 if(e.version!==2||e.algorithmVersion!==suite||e.role!==role||e.networkId!==networkId||e.owner!==expectedOwner)fail('AUTH_SOURCE_V2_SIGNER_BINDING');
 const binding=context({networkId:e.networkId,owner:e.owner,keyVersion:e.keyVersion,executionHeight:e.executionHeight});
 let bytes,wire,bodyRaw;try{bytes=pqDecodeBase64url(e.body,{max:65536});wire=pqDecodeBase64url(e.member,{max:262144});bodyRaw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('AUTH_SOURCE_V2_ENCODING');}
 const body=parse(bodyRaw,65536);
 const math=verifyPQRegisteredMemberData(snapshot,wire,{chainId:networkId,owner:expectedOwner,keyVersion:e.keyVersion,executionHeight:e.executionHeight,purpose:purposes[role],message:encodeOriginalAuthSourceStatementV2(role,frame,binding,bodyRaw)});
 if(math.memberCount!==1||math.memberIndex!==0)fail('AUTH_SOURCE_V2_N1_REQUIRED');
 return Object.freeze({body,binding:seal({...binding}),dataOnly:true,nativeAdmission:false});
}
function sourcePolicy(policy){
 exact(policy,['rootDigest','enrollmentDigest','endpoint','spki','signatureContract']);
 exact(policy.signatureContract,['purpose','enrollmentFrame','profileFrame','currentFrame']);
 if(!hex(policy.rootDigest)||!hex(policy.enrollmentDigest)||!hex(policy.spki)||policy.endpoint!=='https://wallet-auth.ynxweb4.com/v1/auth-identity/source-current')fail('AUTH_SOURCE_V2_POLICY');
 return originalSignatureContract(policy);
}
function active(snapshot,networkId,expectedOwner,height){
 const view=inspectPQAuthorizationView(snapshot);
 if(snapshot.networkId!==networkId||snapshot.owner!==expectedOwner||snapshot.executionHeight!==height||!view.pqSigningEnabled||!view.activeRecord||view.authorizationStatus==='revoked')fail('AUTH_SOURCE_V2_REGISTRATION');
 return view.activeRecord;
}
// Native's common gate MUST be used for old entries too. This does not
// authenticate snapshot provenance; a parsed snapshot alone is never trust.
export function selectOriginalAuthSourceAlgorithm(subjectSnapshot,credentialVersion){
 const view=inspectPQAuthorizationView(subjectSnapshot);
 if(view.authorizationStatus==='revoked')fail('AUTH_SOURCE_V2_SUBJECT_REVOKED');
 if(view.activeRecord){if(credentialVersion!==2)fail('AUTH_SOURCE_V2_LEGACY_ENTRY_REFUSED');return Object.freeze({algorithmVersion:suite,keyVersion:view.activeRecord.revision,dataOnly:true,nativeAdmission:false});}
 if(credentialVersion!==1)fail('AUTH_SOURCE_V2_SUBJECT_MIGRATION_REQUIRED');
 return Object.freeze({algorithmVersion:'ed25519',keyVersion:null,dataOnly:true,nativeAdmission:false});
}
export function verifyOriginalAuthSourceProfileV2(rootRaw,enrollmentRaw,profileRaw,policy,registrations,atMs){
 const contract=sourcePolicy(policy);
 exact(registrations,['root','profile','current','subject']);
 if(sha(rootRaw)!==policy.rootDigest||sha(enrollmentRaw)!==policy.enrollmentDigest)fail('AUTH_SOURCE_V2_NOT_PINNED');
 const root=parse(rootRaw,16384);exact(root,['version','algorithmVersion','purpose','rootId','networkId','rootOwner']);
 if(root.version!==2||root.algorithmVersion!==suite||root.purpose!==contract.purpose||!token(root.rootId)||!hex(root.networkId)||!owner(root.rootOwner))fail('AUTH_SOURCE_V2_ROOT');
 // Root authority is the independently pinned original, NOT certificate keys.
 const enrollment=envelope(enrollmentRaw,'enrollment',contract.enrollmentFrame,registrations.root,root.networkId,root.rootOwner);
 const e=enrollment.body;
 exact(e,['version','purpose','rootId','rootOwner','sourceId','service','productId','platform','applicationId','gatewayOrigin','registryDigest','profileOwner','currentOwner','endpoint','spki','currentStatePath','operations','issuedAtMs','expiresAtMs']);
 if(e.version!==2||e.purpose!==contract.purpose||e.rootId!==root.rootId||e.rootOwner!==root.rootOwner||!token(e.sourceId)||!owner(e.profileOwner)||!owner(e.currentOwner)||new Set([root.rootOwner,e.profileOwner,e.currentOwner]).size!==3||e.service!=='wallet-product-session-v2'||e.productId!=='developer'||e.platform!=='macos'||e.applicationId!=='com.ynxweb4.developer.testnetpreview'||e.gatewayOrigin!=='https://wallet-auth.ynxweb4.com'||!hex(e.registryDigest)||e.endpoint!==policy.endpoint||e.spki!==policy.spki||canonical(e.operations)!==canonical(ops)||!absolute(e.currentStatePath))fail('AUTH_SOURCE_V2_ENROLLMENT');
 window(e,atMs,86400000);
 const profile=envelope(profileRaw,'profile',contract.profileFrame,registrations.profile,root.networkId,e.profileOwner),p=profile.body;
 exact(p,['version','purpose','sourceId','enrollmentDigest','instanceId','generation','minimumSequence','minimumFloor','subjectOwner','selection','issuedAtMs','expiresAtMs']);
 if(p.version!==2||p.purpose!==contract.purpose||p.sourceId!==e.sourceId||p.enrollmentDigest!==sha(enrollmentRaw)||!token(p.instanceId)||!integer(p.generation)||p.generation<1||!integer(p.minimumSequence)||p.minimumSequence<1||!integer(p.minimumFloor)||p.minimumFloor>p.minimumSequence||!owner(p.subjectOwner))fail('AUTH_SOURCE_V2_PROFILE');
 const s=p.selection;
 // Preserve all existing signed product/ownership/permission metadata. Only
 // these original fields are interpreted here; do not silently drop extras
 // or rewrite the original application's role schema during key migration.
 if(!s||Object.getPrototypeOf(s)!==Object.prototype||!['association','expectedRequest','originalHostStatePath','originalHostTerminalDirectory'].every(k=>Object.hasOwn(s,k)))fail('AUTH_SOURCE_V2_SCHEMA');
 const a=s.association;exact(a,['account','clientId','productId','platform','applicationId','deviceId']);
 if(Object.values(a).some(x=>typeof x!=='string'||!x||x.length>512)||a.productId!==e.productId||a.platform!==e.platform||a.applicationId!==e.applicationId)fail('AUTH_SOURCE_V2_ASSOCIATION');
 const r=s.expectedRequest;
 if(!r||r.service!==e.service||r.productId!==e.productId||r.platform!==e.platform||r.applicationId!==e.applicationId||r.gatewayOrigin!==e.gatewayOrigin||r.registryDigest!==e.registryDigest||canonical(r.operations)!==canonical(ops)||r.instanceId!==p.instanceId||!absolute(s.originalHostStatePath)||s.originalHostTerminalDirectory!==s.originalHostStatePath+'.private-terminal')fail('AUTH_SOURCE_V2_REQUEST');
 window(p,atMs,86400000);if(p.issuedAtMs<e.issuedAtMs||p.expiresAtMs>e.expiresAtMs)fail('AUTH_SOURCE_V2_EXPIRED');
 const height=enrollment.binding.executionHeight;
 if(profile.binding.executionHeight!==height)fail('AUTH_SOURCE_V2_HEIGHT');
 const roleKeys=[active(registrations.root,root.networkId,root.rootOwner,height),
  active(registrations.profile,root.networkId,e.profileOwner,height),
  active(registrations.current,root.networkId,e.currentOwner,height)];
 for(let i=0;i<roleKeys.length;i++)for(let j=0;j<i;j++)
  if(roleKeys[i].pkA===roleKeys[j].pkA||roleKeys[i].pkB===roleKeys[j].pkB)fail('AUTH_SOURCE_V2_KEYS_NOT_DISTINCT');
 active(registrations.subject,root.networkId,p.subjectOwner,height);
 const selected=selectOriginalAuthSourceAlgorithm(registrations.subject,2);
 return Object.freeze({root,enrollment:e,profile:p,executionHeight:height,subjectKeyVersion:selected.keyVersion,dataOnly:true,nativeAdmission:false});
}
export function verifyOriginalAuthSourceCurrentV2(rootRaw,enrollmentRaw,profileRaw,currentRaw,policy,registrations,expectedNonce,previous,atMs){
 const verified=verifyOriginalAuthSourceProfileV2(rootRaw,enrollmentRaw,profileRaw,policy,registrations,atMs),contract=sourcePolicy(policy);
 exact(previous,['sequence','floor','head','timeFloor']);
 if(!integer(previous.sequence)||!integer(previous.floor)||!integer(previous.timeFloor)||!(previous.head===''||hex(previous.head))||atMs<previous.timeFloor)fail('AUTH_SOURCE_V2_ROLLBACK');
 const current=envelope(currentRaw,'current',contract.currentFrame,registrations.current,verified.root.networkId,verified.enrollment.currentOwner),c=current.body,p=verified.profile;
 exact(c,['version','purpose','sourceId','enrollmentDigest','profileDigest','instanceId','generation','subjectOwner','subjectKeyVersion','sequence','floor','head','status','nonce','issuedAtMs','expiresAtMs']);
 if(c.version!==2||c.purpose!==contract.purpose||c.sourceId!==p.sourceId||c.enrollmentDigest!==policy.enrollmentDigest||c.profileDigest!==sha(profileRaw)||c.instanceId!==p.instanceId||c.generation!==p.generation||c.subjectOwner!==p.subjectOwner||c.subjectKeyVersion!==verified.subjectKeyVersion||current.binding.executionHeight!==verified.executionHeight||!integer(c.sequence)||c.sequence<Math.max(p.minimumSequence,previous.sequence)||!integer(c.floor)||c.floor<Math.max(p.minimumFloor,previous.floor)||c.floor>c.sequence||!hex(c.head)||c.nonce!==expectedNonce||typeof expectedNonce!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(expectedNonce)||!['active','revoked','retired'].includes(c.status))fail('AUTH_SOURCE_V2_CURRENT');
 if(c.sequence===previous.sequence&&previous.head&&c.head!==previous.head)fail('AUTH_SOURCE_V2_EQUIVOCATION');
 window(c,atMs,30000);if(c.expiresAtMs>Math.min(p.expiresAtMs,verified.enrollment.expiresAtMs))fail('AUTH_SOURCE_V2_EXPIRED');
 if(c.status!=='active')fail('AUTH_SOURCE_V2_REVOKED');
 return seal({selection:p.selection,principalId:p.selection.association.account,subjectOwner:p.subjectOwner,subjectKeyVersion:c.subjectKeyVersion,generation:p.generation,sequence:c.sequence,floor:c.floor,head:c.head,status:c.status,timeFloor:atMs,expiresAtMs:Math.min(p.expiresAtMs,c.expiresAtMs,verified.enrollment.expiresAtMs),profileDigest:sha(profileRaw),sourceId:p.sourceId,instanceId:p.instanceId,executionHeight:verified.executionHeight,dataOnly:true,nativeAdmission:false});
}
