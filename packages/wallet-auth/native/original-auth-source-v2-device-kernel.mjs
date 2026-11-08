// Shared sole DEVICE Source-v2 kernel. This module receives only COMPILED
// internal parts from the fixed Node/private-native composition modules; no
// capture/stdin/caller chooses a module, verifier, provider, domain or callback.
import {sourceCanonicalV2 as canonical,sourceSHA256V2 as sha,parseOriginalSourceCanonicalV2 as parse,encodeOriginalAuthSourceStatementV2}from'./original-auth-source-v2-public-codec.mjs';
import{SourceUTF8Decoder}from'./original-source-private-utf8.mjs';
import{pqU64}from'../src/pq-public-bytes.js';
import{exactPQRecord,pqDecodeBase64url}from'../src/pq-wallet-contract.js';
import{inspectPQAuthorizationView}from'../src/pq-registered-snapshot-data.js';
const suite='YNX-BATCH/v0.1',PRIMARY='product-session-device-source-v4';
const PRODUCT_DEVICE_V4_SOURCE_PURPOSE=PRIMARY,PRODUCT_DEVICE_V4_PENDING_PURPOSE='product-session-device-pending-source-v4',PRODUCT_DEVICE_V4_PROVISIONING_PURPOSE='product-session-device-provisioning-source-v4';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const hex=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x),owner=x=>typeof x==='string'&&/^0x[0-9a-f]{40}$/.test(x),token=x=>typeof x==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(x),integer=x=>Number.isSafeInteger(x)&&x>=0;
const exact=(v,keys)=>exactPQRecord(v,keys,'AUTH_SOURCE_V2_SCHEMA');
const seal=x=>{if(x&&typeof x==='object'){for(const v of Object.values(x))seal(v);Object.freeze(x);}return x;};
function decimal(v,nonzero=false){if(typeof v!=='string')fail('AUTH_SOURCE_V2_DECIMAL');let n;try{n=pqU64(v);}catch{fail('AUTH_SOURCE_V2_DECIMAL');}if(nonzero&&!n)fail('AUTH_SOURCE_V2_DECIMAL');return n;}
function window(body,at,limit){if(!integer(at)||!integer(body.issuedAtMs)||!integer(body.expiresAtMs)||body.expiresAtMs<=body.issuedAtMs||body.expiresAtMs-body.issuedAtMs>limit||at<body.issuedAtMs||at>=body.expiresAtMs)fail('AUTH_SOURCE_V2_EXPIRED');}
function absolute(p){return typeof p==='string'&&p.startsWith('/')&&p.length<=4096&&!p.includes('\0')&&!p.split('/').some(v=>v==='.'||v==='..');}
function active(snapshot,networkId,expectedOwner,height){const view=inspectPQAuthorizationView(snapshot);if(snapshot.networkId!==networkId||snapshot.owner!==expectedOwner||snapshot.executionHeight!==height||!view.pqSigningEnabled||!view.activeRecord||view.authorizationStatus==='revoked')fail('AUTH_SOURCE_V2_REGISTRATION');return view.activeRecord;}
export function createDeviceSourceKernelFromFixedParts(parts){
 const {scopeRegistry,verifyMath}=parts;
 const deviceFamily=p=>scopeRegistry.has(p),deviceOperations=p=>scopeRegistry.entry(p).operations,deviceField=p=>scopeRegistry.entry(p).field;
 const inspectOriginalAuthRuntimeImageBindingV1DATA=(value,purpose)=>scopeRegistry.inspectRuntimeBinding(value,purpose);
 const privateAndroid=scopeRegistry.platformRole==='android-source-private-v1';
 const devicePolicyPlatform=policy=>privateAndroid?policy.platform:policy.signatureContract.purpose===PRIMARY&&Object.hasOwn(policy,'platform')?policy.platform:'macos';
 function sourcePolicy(policy){
  if(!deviceFamily(policy?.signatureContract?.purpose))fail('AUTH_SOURCE_V2_DEVICE_DEDICATED_PURPOSE_REQUIRED');
  exact(policy,['rootDigest','enrollmentDigest','endpoint','spki','signatureContract','applicationId','productId',...(privateAndroid||policy.signatureContract.purpose===PRIMARY&&Object.hasOwn(policy,'platform')?['platform']:[])]);
  if(privateAndroid?policy.platform!=='android':Object.hasOwn(policy,'platform')&&policy.platform!=='linux')fail('AUTH_SOURCE_V2_DEVICE_PLATFORM');
  if(typeof policy.applicationId!=='string'||!/^[A-Za-z][A-Za-z0-9.-]{2,131}$/.test(policy.applicationId)||typeof policy.productId!=='string'||!/^[a-z][a-z0-9-]{1,31}$/.test(policy.productId))fail('AUTH_SOURCE_V2_DEVICE_APPLICATION');
  const c=policy.signatureContract;exact(c,['purpose','enrollmentFrame','profileFrame','currentFrame']);
  if(!hex(policy.rootDigest)||!hex(policy.enrollmentDigest)||!hex(policy.spki)||policy.endpoint!=='https://wallet-auth.ynxweb4.com/v1/auth-identity/source-current')fail('AUTH_SOURCE_V2_POLICY');
  for(const value of Object.values(c))if(typeof value!=='string'||!value.length||new TextEncoder().encode(value).length>512||value.includes('\0'))fail('AUTH_IDENTITY_ORIGINAL_SIGNATURE_CONTRACT_NOT_SUPPLIED');
  if(new Set([c.enrollmentFrame,c.profileFrame,c.currentFrame]).size!==3)fail('AUTH_IDENTITY_ORIGINAL_SIGNATURE_CONTRACT_NOT_SUPPLIED');return c;
 }
 function envelope(raw,role,frame,snapshot,networkId,expectedOwner,historicalCurrent=false){
  const e=parse(raw);exact(e,['version','algorithmVersion','role','networkId','owner','keyVersion','executionHeight','body','member']);
  if(e.version!==2||e.algorithmVersion!==suite||e.role!==role||e.networkId!==networkId||e.owner!==expectedOwner)fail('AUTH_SOURCE_V2_SIGNER_BINDING');
  const binding={networkId:e.networkId,owner:e.owner,keyVersion:e.keyVersion,executionHeight:e.executionHeight};decimal(binding.keyVersion,true);decimal(binding.executionHeight);
  inspectPQAuthorizationView(snapshot);const observed=decimal(snapshot.executionHeight),issued=decimal(e.executionHeight);
  if(issued>observed)fail('AUTH_SOURCE_V2_STATEMENT_HEIGHT');if(role==='current'&&!historicalCurrent&&issued!==observed)fail('AUTH_SOURCE_V2_CURRENT_HEIGHT');
  const historic=inspectPQAuthorizationView(snapshot,e.executionHeight);if(!historic.activeRecord||historic.activeRecord.revision!==e.keyVersion||historic.authorizationStatus==='revoked')fail('AUTH_SOURCE_V2_ISSUANCE_KEY_REQUIRED');
  let bodyRaw,wire;try{bodyRaw=new SourceUTF8Decoder('utf-8',{fatal:true,ignoreBOM:true}).decode(pqDecodeBase64url(e.body,{max:65536}));wire=pqDecodeBase64url(e.member,{max:262144});}catch{fail('AUTH_SOURCE_V2_ENCODING');}
  const body=parse(bodyRaw,65536),math=verifyMath(role,frame,binding,bodyRaw,wire,snapshot,historicalCurrent);
  if(math.memberCount!==1||math.memberIndex!==0)fail('AUTH_SOURCE_V2_N1_REQUIRED');return Object.freeze({body,binding:seal(binding),dataOnly:true,nativeAdmission:false});
 }
function deviceEnrollmentBodyDATA(root,e,policy,registrations,atMs){
 exact(e,['version','purpose','rootId','rootOwner','sourceId','service','productId','platform','applicationId','gatewayOrigin','registryDigest','profileOwner','currentOwner','endpoint','spki','currentStatePath','operations','issuedAtMs','expiresAtMs']);
 if(e.version!==2||e.purpose!==policy.signatureContract.purpose||!deviceFamily(e.purpose)||root.purpose!==e.purpose||e.rootId!==root.rootId||e.rootOwner!==root.rootOwner||!token(e.sourceId)||!owner(e.profileOwner)||!owner(e.currentOwner)||new Set([root.rootOwner,e.profileOwner,e.currentOwner]).size!==3||e.service!==e.purpose||e.productId!==policy.productId||e.platform!==devicePolicyPlatform(policy)||e.applicationId!==policy.applicationId||e.gatewayOrigin!=='https://wallet-auth.ynxweb4.com'||!hex(e.registryDigest)||e.endpoint!==policy.endpoint||e.spki!==policy.spki||!absolute(e.currentStatePath)||canonical(e.operations)!==canonical(deviceOperations(e.purpose)))fail('AUTH_SOURCE_V2_DEVICE_ENROLLMENT_BODY');
 window(e,atMs,86400000);const height=registrations.root.executionHeight,records=[active(registrations.root,root.networkId,root.rootOwner,height),active(registrations.profile,root.networkId,e.profileOwner,height),active(registrations.current,root.networkId,e.currentOwner,height)];
 for(let i=0;i<records.length;i++)for(let j=0;j<i;j++)if(records[i].pkA===records[j].pkA||records[i].pkB===records[j].pkB)fail('AUTH_SOURCE_V2_KEYS_NOT_DISTINCT');
}
function deviceProfileBodyDATA(root,e,p,policy,registrations,atMs){
 exact(p,['version','purpose','sourceId','enrollmentDigest','instanceId','generation','minimumSequence','minimumFloor','subjectOwner','selection','issuedAtMs','expiresAtMs']);
 if(p.version!==2||p.purpose!==policy.signatureContract.purpose||!deviceFamily(p.purpose)||p.sourceId!==e.sourceId||p.enrollmentDigest!==policy.enrollmentDigest||!token(p.instanceId)||!integer(p.generation)||p.generation<1||!integer(p.minimumSequence)||p.minimumSequence<1||!integer(p.minimumFloor)||p.minimumFloor>p.minimumSequence||!owner(p.subjectOwner))fail('AUTH_SOURCE_V2_PROFILE');
 window(p,atMs,86400000);if(p.issuedAtMs<e.issuedAtMs||p.expiresAtMs>e.expiresAtMs)fail('AUTH_SOURCE_V2_EXPIRED');
 const field=deviceField(p.purpose),s=p.selection,hasRuntimeImageBinding=Object.hasOwn(s,'runtimeImageBindingV1');exact(s,['association','expectedRequest','originalHostStatePath','originalHostTerminalDirectory',field,...(p.purpose===PRODUCT_DEVICE_V4_PROVISIONING_PURPOSE?['originalProvisioningJournal']:p.purpose===PRODUCT_DEVICE_V4_PENDING_PURPOSE?['originalPendingDeviceJournal']:[]),...(hasRuntimeImageBinding?['runtimeImageBindingV1']:[])]);if(hasRuntimeImageBinding)inspectOriginalAuthRuntimeImageBindingV1DATA(s.runtimeImageBindingV1,p.purpose);const a=s.association;exact(a,['account','clientId','productId','platform','applicationId','deviceId']);
 if([PRODUCT_DEVICE_V4_PENDING_PURPOSE,PRODUCT_DEVICE_V4_PROVISIONING_PURPOSE].includes(p.purpose)){const j=p.purpose===PRODUCT_DEVICE_V4_PROVISIONING_PURPOSE?s.originalProvisioningJournal:s.originalPendingDeviceJournal;exact(j,['parent','directory']);for(const t of [j.parent,j.directory]){exact(t,['device','inode','uid','gid','mode']);if(!/^(0|[1-9][0-9]{0,19})$/.test(t.device)||typeof t.device!=='string'||typeof t.inode!=='string'||!/^[1-9][0-9]{0,19}$/.test(t.inode)||!integer(t.uid)||!integer(t.gid)||t.mode!==448)fail('AUTH_SOURCE_V2_PENDING_JOURNAL_IDENTITY');}}
 if(Object.values(a).some(x=>typeof x!=='string'||!x||x.length>512)||a.productId!==e.productId||a.platform!==e.platform||a.applicationId!==e.applicationId)fail('AUTH_SOURCE_V2_ASSOCIATION');
 const r=s.expectedRequest;exact(r,['service','productId','platform','applicationId','gatewayOrigin','registryDigest','operations','instanceId']);
 if(r.service!==e.service||r.productId!==e.productId||r.platform!==e.platform||r.applicationId!==e.applicationId||r.gatewayOrigin!==e.gatewayOrigin||r.registryDigest!==e.registryDigest||canonical(r.operations)!==canonical(deviceOperations(p.purpose))||r.instanceId!==p.instanceId||!absolute(s.originalHostStatePath)||s.originalHostTerminalDirectory!==s.originalHostStatePath+'.private-terminal')fail('AUTH_SOURCE_V2_REQUEST');
 const data=scopeRegistry.entry(p.purpose).inspect(s[field],a,root.networkId,p.subjectOwner,p.issuedAtMs,p.expiresAtMs,atMs),height=registrations.root.executionHeight;
 for(const [snapshot,id]of [[registrations.root,root.rootOwner],[registrations.profile,e.profileOwner],[registrations.current,e.currentOwner],[registrations.subject,p.subjectOwner]]){const record=active(snapshot,root.networkId,id,height);if(data.devicePublic&&(record.pkA===data.devicePublic.pkA||record.pkB===data.devicePublic.pkB))fail('AUTH_SOURCE_V2_DEVICE_KEY_ROLE_COLLISION');}
 const accountRecord=active(registrations.subject,root.networkId,p.subjectOwner,height);if(data.accountAuthorization)for(const k of ['pkA','pkB','revision','registeredAt','activeFrom'])if(accountRecord[k]!==data.accountAuthorization[k])fail('AUTH_SOURCE_V2_DEVICE_ACCOUNT_CURRENT_CHANGED');
 return data;
}
 function verifyEnrollment(rootRaw,enrollmentRaw,policy,registrations,atMs){
  const contract=sourcePolicy(policy);exact(registrations,['root','profile','current','subject']);
  if(sha(rootRaw)!==policy.rootDigest||sha(enrollmentRaw)!==policy.enrollmentDigest)fail('AUTH_SOURCE_V2_NOT_PINNED');
  const root=parse(rootRaw,16384);exact(root,['version','algorithmVersion','purpose','rootId','networkId','rootOwner']);
  if(root.version!==2||root.algorithmVersion!==suite||root.purpose!==contract.purpose||!token(root.rootId)||!hex(root.networkId)||!owner(root.rootOwner))fail('AUTH_SOURCE_V2_ROOT');
  const en=envelope(enrollmentRaw,'enrollment',contract.enrollmentFrame,registrations.root,root.networkId,root.rootOwner);deviceEnrollmentBodyDATA(root,en.body,policy,registrations,atMs);
  return seal({root,enrollment:en.body,enrollmentBinding:en.binding,executionHeight:registrations.root.executionHeight,dataOnly:true,nativeAdmission:false});
 }
 function verifyProfile(rootRaw,enrollmentRaw,profileRaw,policy,registrations,atMs){
  const contract=sourcePolicy(policy),v=verifyEnrollment(rootRaw,enrollmentRaw,policy,registrations,atMs),pr=envelope(profileRaw,'profile',contract.profileFrame,registrations.profile,v.root.networkId,v.enrollment.profileOwner);
  const data=deviceProfileBodyDATA(v.root,v.enrollment,pr.body,policy,registrations,atMs),subjectKeyVersion=active(registrations.subject,v.root.networkId,pr.body.subjectOwner,registrations.root.executionHeight).revision;
  return Object.freeze({root:v.root,enrollment:v.enrollment,profile:pr.body,executionHeight:registrations.root.executionHeight,credentialIssuedHeights:Object.freeze({enrollment:v.enrollmentBinding.executionHeight,profile:pr.binding.executionHeight}),subjectKeyVersion,dataOnly:true,nativeAdmission:false});
 }
 function verifyCurrent(rootRaw,enrollmentRaw,profileRaw,currentRaw,policy,registrations,expectedNonce,previous,atMs,historical=false){
  const verified=verifyProfile(rootRaw,enrollmentRaw,profileRaw,policy,registrations,atMs),contract=sourcePolicy(policy);
  exact(previous,['sequence','floor','head','timeFloor','executionHeight']);if(decimal(previous.executionHeight)>decimal(verified.executionHeight))fail('AUTH_SOURCE_V2_OBSERVATION_ROLLBACK');
  if(!integer(previous.sequence)||!integer(previous.floor)||!integer(previous.timeFloor)||!(previous.head===''||hex(previous.head))||atMs<previous.timeFloor)fail('AUTH_SOURCE_V2_ROLLBACK');
  const current=envelope(currentRaw,'current',contract.currentFrame,registrations.current,verified.root.networkId,verified.enrollment.currentOwner,historical),c=current.body,p=verified.profile;
  exact(c,['version','purpose','sourceId','enrollmentDigest','profileDigest','instanceId','generation','subjectOwner','subjectKeyVersion','sequence','floor','head','status','nonce','issuedAtMs','expiresAtMs']);
  if(c.version!==2||c.purpose!==contract.purpose||c.sourceId!==p.sourceId||c.enrollmentDigest!==policy.enrollmentDigest||c.profileDigest!==sha(profileRaw)||c.instanceId!==p.instanceId||c.generation!==p.generation||c.subjectOwner!==p.subjectOwner||c.subjectKeyVersion!==verified.subjectKeyVersion||(!historical&&current.binding.executionHeight!==verified.executionHeight)||!integer(c.sequence)||c.sequence<Math.max(p.minimumSequence,previous.sequence)||!integer(c.floor)||c.floor<Math.max(p.minimumFloor,previous.floor)||c.floor>c.sequence||!hex(c.head)||c.nonce!==expectedNonce||typeof expectedNonce!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(expectedNonce)||!['active','revoked','retired'].includes(c.status))fail('AUTH_SOURCE_V2_CURRENT');
  if(c.sequence===previous.sequence&&previous.head&&c.head!==previous.head)fail('AUTH_SOURCE_V2_EQUIVOCATION');if(historical&&(!integer(atMs)||atMs<c.issuedAtMs))fail('AUTH_SOURCE_V2_EXPIRED');
  window(c,historical?c.issuedAtMs:atMs,30000);if(c.expiresAtMs>Math.min(p.expiresAtMs,verified.enrollment.expiresAtMs))fail('AUTH_SOURCE_V2_EXPIRED');
  const rule=scopeRegistry.entry(contract.purpose);if(c.head!==sha(canonical(p.selection[rule.field])))fail(rule.headError);
  if(!historical&&c.status!=='active')fail('AUTH_SOURCE_V2_REVOKED');
  return seal({...(!historical&&contract.purpose===PRIMARY?{productDeviceAccountNamespaceDATA:{purpose:PRIMARY,sourceId:p.sourceId,instanceId:p.instanceId,generation:p.generation,accountIssuer:verified.enrollment.gatewayOrigin,accountSubject:p.selection.association.account}}:{}),...(Object.hasOwn(p.selection,'runtimeImageBindingV1')?{runtimeImageBindingV1DATA:inspectOriginalAuthRuntimeImageBindingV1DATA(p.selection.runtimeImageBindingV1,p.purpose).runtimeImageBindingV1}:{}),selection:p.selection,principalId:p.selection.association.account,subjectOwner:p.subjectOwner,subjectKeyVersion:c.subjectKeyVersion,generation:p.generation,sequence:c.sequence,floor:c.floor,head:c.head,status:c.status,timeFloor:atMs,expiresAtMs:Math.min(p.expiresAtMs,c.expiresAtMs,verified.enrollment.expiresAtMs),profileDigest:sha(profileRaw),sourceId:p.sourceId,instanceId:p.instanceId,executionHeight:verified.executionHeight,...(historical?{statementExecutionHeight:current.binding.executionHeight,historical:true}:{}),dataOnly:true,nativeAdmission:false});
 }
 return Object.freeze({sourcePolicy,deviceEnrollmentBodyDATA,deviceProfileBodyDATA,verifyEnrollment,verifyProfile,verifyCurrent});
}
