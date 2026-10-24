// R192 exact dual-proof contract. Neither PoP nor a verified member is a
// protected publisher grant: the normal Source additionally owns independent
// custodian-role/current/revoke/ACL and durable once registration.
import{encodeFields,VERSION,SUITE,createVerifier,decodeMember}from'@ynx/batch-v01-candidate';
import{canonical,sha}from'./original-auth-identity-source-verifier.mjs';
import{encodeOriginalDeveloperPrincipalDATA}from'./original-developer-principal-data.mjs';
import{encodeOriginalDeveloperCommandDATA,ORIGINAL_PUBLISHER_REGISTRATION_PURPOSE as POP,ORIGINAL_PUBLISHER_REGISTRATION_FRAME as POPFRAME,ORIGINAL_PUBLISHER_CUSTODIAN_PURPOSE as CUSTODY,ORIGINAL_PUBLISHER_CUSTODIAN_FRAME as CUSTODYFRAME}from'./original-ide-project-control-contract.mjs';
import{inspectIDEArtifactPublisherPublicOriginalData}from'../src/ide-artifact-signature.js';
import{verifyPQRegisteredMemberData}from'../src/pq-registered-member.js';
import{inspectPQAuthorizationView}from'../src/pq-wallet-policy.js';
const fail=code=>{throw Object.assign(Error(code),{code})};
const bodyKeys=['version','registrationRef','principalSHA256','commandSHA256','publicSHA256','account','projectId','publisherId','keyRole','publisherKeyVersion','callerIdentity','sourceCurrentRef','nonce','issuedAtMs','expiresAtMs','custodyCurrentRef'];
function exact(v,keys){if(!v||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).sort().join('|')!==keys.slice().sort().join('|')||Object.values(Object.getOwnPropertyDescriptors(v)).some(d=>!Object.hasOwn(d,'value')||!d.enumerable))fail('IDE_PUBLISHER_SCHEMA')}
function text(v){if(typeof v!=='string'||!v.length||!v.isWellFormed()||Buffer.byteLength(v)>256||/[\x00-\x20\x7f]/u.test(v)||/^\p{White_Space}|\p{White_Space}$/u.test(v))fail('IDE_PUBLISHER_TEXT')}
function decimal(v,zero=false){if(typeof v!=='string'||! /^(0|[1-9][0-9]*)$/.test(v)||BigInt(v)>18446744073709551615n||!zero&&v==='0')fail('IDE_PUBLISHER_DECIMAL')}
function bytes(v,max){if(typeof v!=='string'||!v.length||v.length>Math.ceil(max*4/3)||!/^[A-Za-z0-9_-]+$/.test(v))fail('IDE_PUBLISHER_ENCODING');const b=Buffer.from(v,'base64url');if(!b.length||b.length>max||b.toString('base64url')!==v)fail('IDE_PUBLISHER_ENCODING');return b}
function parsed(raw,max){if(typeof raw!=='string'||!raw.length||Buffer.byteLength(raw)>max)fail('IDE_PUBLISHER_CAPACITY');let v;try{v=JSON.parse(raw)}catch{fail('IDE_PUBLISHER_CANONICAL')}if(canonical(v)!==raw)fail('IDE_PUBLISHER_CANONICAL');return v}
function context(v){exact(v,['networkId','owner','keyVersion','executionHeight','callerIdentity','sourceCurrentRef']);if(typeof v.networkId!=='string'||typeof v.owner!=='string'||!/^[a-f0-9]{64}$/.test(v.networkId)||!/^0x[a-f0-9]{40}$/.test(v.owner))fail('IDE_PUBLISHER_CONTEXT');decimal(v.keyVersion);decimal(v.executionHeight,true);text(v.callerIdentity);text(v.sourceCurrentRef);return v}
function originals(publicOriginal,principal,command,registrationOriginal,at){
 const publicBytes=Buffer.from(publicOriginal),pub=inspectIDEArtifactPublisherPublicOriginalData(publicBytes),p=encodeOriginalDeveloperPrincipalDATA(principal),c=encodeOriginalDeveloperCommandDATA(command,at),b=parsed(registrationOriginal,16384);exact(b,bodyKeys);
 if(b.version!=='YNX-IDE-PROTECTED-PUBLISHER-REGISTRATION/v1'||b.principalSHA256!==p.principalSHA256||b.commandSHA256!==c.commandSHA256||b.publicSHA256!==sha(publicBytes)||b.keyRole!=='ide-artifact-publisher'||command.Action!=='project.publisher'||command.Revoke||command.SubjectAccount!==pub.account||command.ProjectID!==pub.projectId||command.PublisherID!==pub.publisherId||command.PublicOriginalSHA256!==b.publicSHA256||b.account!==pub.account||b.projectId!==pub.projectId||b.publisherId!==pub.publisherId||b.publisherKeyVersion!==pub.publisherKeyVersion||b.sourceCurrentRef!==principal.currentRef)fail('IDE_PUBLISHER_ORIGINAL_BINDING');
 for(const k of['registrationRef','callerIdentity','sourceCurrentRef','custodyCurrentRef'])text(b[k]);const n=bytes(b.nonce,32);if(n.length!==32||n.every(v=>v===0))fail('IDE_PUBLISHER_NONCE');
 if(!Number.isSafeInteger(at)||!Number.isSafeInteger(b.issuedAtMs)||!Number.isSafeInteger(b.expiresAtMs)||b.issuedAtMs<0||at<b.issuedAtMs||at>=b.expiresAtMs||b.expiresAtMs-b.issuedAtMs>30000||BigInt(b.expiresAtMs)>BigInt(principal.expiresMS)||BigInt(b.expiresAtMs)>BigInt(command.ExpiresMS)||BigInt(b.expiresAtMs)>BigInt(command.GrantExpiresMS))fail('IDE_PUBLISHER_EXPIRED');
 return{pub,p,c,b,publicBytes}
}
export function encodeOriginalProtectedPublisherPoPDATA(publicOriginal,principal,command,registrationOriginal,at){const{pub,publicBytes}=originals(publicOriginal,principal,command,registrationOriginal,at);return encodeFields([POPFRAME,VERSION,SUITE,POP,Buffer.from(pub.networkId,'hex'),pub.subjectOwner,pub.publisherKeyVersion,publicBytes,registrationOriginal])}
export function encodeOriginalProtectedPublisherCustodianDATA(binding,publicOriginal,principal,command,registrationOriginal,popMemberOriginal,at){context(binding);const{pub,p,c,b}=originals(publicOriginal,principal,command,registrationOriginal,at),pop=bytes(popMemberOriginal,262144);if(binding.networkId!==pub.networkId||binding.callerIdentity!==b.callerIdentity||binding.sourceCurrentRef!==b.custodyCurrentRef)fail('IDE_PUBLISHER_CUSTODIAN_BINDING');return encodeFields([CUSTODYFRAME,VERSION,SUITE,CUSTODY,Buffer.from(binding.networkId,'hex'),binding.owner,binding.keyVersion,binding.executionHeight,p.principalOriginal,c.commandOriginal,registrationOriginal,sha(pop)])}
// Exact v1 transport. Original R13 bytes are never rewritten or relabelled as
// protected custody. This function verifies both messages, not caller booleans.
export function verifyOriginalProtectedPublisherRegistrationDATA(raw,registeredCustodian,principal,command,expected,at){
 exact(expected,['registrationRef','nonce','callerIdentity','sourceCurrentRef','custodyCurrentRef']);const e=parsed(raw,786432);exact(e,['version','binding','publicOriginal','registrationOriginal','popMemberOriginal','custodianMemberOriginal']);if(e.version!==CUSTODYFRAME)fail('IDE_PUBLISHER_VERSION');
 const publicOriginal=bytes(e.publicOriginal,8192),pop=bytes(e.popMemberOriginal,262144),custody=bytes(e.custodianMemberOriginal,262144),{pub,b}=originals(publicOriginal,principal,command,e.registrationOriginal,at);context(e.binding);
 for(const k of Object.keys(expected))if(b[k]!==expected[k])fail('IDE_PUBLISHER_CURRENT_BINDING');
 const active=inspectPQAuthorizationView(registeredCustodian).activeRecord;
 if(!active||Buffer.from(active.pkA,'hex').equals(Buffer.from(pub.pkA))||Buffer.from(active.pkB,'hex').equals(Buffer.from(pub.pkB)))fail('IDE_PUBLISHER_CUSTODIAN_NOT_INDEPENDENT');
 const verifier=createVerifier({provider:'portable',chainId:Buffer.from(pub.networkId,'hex'),purpose:POP,cacheEntries:0,resolveTrustedOwner:()=>({algorithmVersion:VERSION,enabled:true,owner:pub.subjectOwner,purpose:POP,policyRevision:pub.publisherKeyVersion,chainId:Buffer.from(pub.networkId,'hex'),pkA:Buffer.from(pub.pkA),pkB:Buffer.from(pub.pkB),activeFrom:0,revokedAt:null})});
 try{if(!verifier.verifyOne(pop,{height:0}))fail('IDE_PUBLISHER_POP_SIGNATURE')}finally{verifier.clear()}
 // Reuse the registered AND verifier to inspect exact member message/N1 for
 // custodian, while the PoP's self-contained certificate remains DATA only.
 const member=decodeMember(pop),cert=member.certificate;
 if(cert.N!==1||member.index!==0||cert.owner!==pub.subjectOwner||!cert.pkA.equals(Buffer.from(pub.pkA))||!cert.pkB.equals(Buffer.from(pub.pkB))||!member.message.equals(Buffer.from(encodeOriginalProtectedPublisherPoPDATA(publicOriginal,principal,command,e.registrationOriginal,at))))fail('IDE_PUBLISHER_POP_BINDING');
 const verified=verifyPQRegisteredMemberData(registeredCustodian,custody,{chainId:e.binding.networkId,owner:e.binding.owner,keyVersion:e.binding.keyVersion,executionHeight:e.binding.executionHeight,purpose:CUSTODY,message:encodeOriginalProtectedPublisherCustodianDATA(e.binding,publicOriginal,principal,command,e.registrationOriginal,e.popMemberOriginal,at)});if(verified.memberCount!==1||verified.memberIndex!==0)fail('IDE_PUBLISHER_N1_REQUIRED');
 return Object.freeze({account:b.account,projectId:b.projectId,publisherId:b.publisherId,keyRole:b.keyRole,publicSHA256:b.publicSHA256,registrationRef:b.registrationRef,principalSHA256:b.principalSHA256,commandSHA256:b.commandSHA256,proofSHA256:sha(raw),expiresAtMs:b.expiresAtMs,signatureVerified:true,independentCustodianPairVerified:true,dataOnly:true,authorized:false,registered:false,protectedCustodyAdmitted:false,nativeAdmission:false});
}
