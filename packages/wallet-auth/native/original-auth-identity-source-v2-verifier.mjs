import{SERVER_TLS_SOURCE_PURPOSE as TLS_PURPOSE,SERVER_TLS_SOURCE_SELECTION_KEY as TLS_KEY,SERVER_TLS_SOURCE_OPERATIONS as TLS_OPS,inspectOriginalServerTLSIdentityScopeV1DATA}from'./original-server-tls-source-contract.mjs';
import{DESKTOP_GRANT_SOURCE_PURPOSE as DGA_PURPOSE,DESKTOP_GRANT_SOURCE_SELECTION_KEY as DGA_KEY,DESKTOP_GRANT_SOURCE_OPERATIONS as DGA_OPS,inspectOriginalDesktopGrantAuthorityScopeV1DATA}from'./original-desktop-task-grant-source-contract.mjs';
import{WALLET_MOBILE_QUALIFIED_SOURCE_PURPOSE as WM_PURPOSE,WALLET_MOBILE_QUALIFIED_SOURCE_SELECTION_KEY as WM_KEY,WALLET_MOBILE_QUALIFIED_SOURCE_OPERATIONS as WM_OPS,inspectWalletMobileQualifiedSourceScopeV1DATA}from'./original-wallet-mobile-qualified-source-contract.mjs';
import{NETWORK_CURRENT_PUBLISHER_SOURCE_PURPOSE as NCP_PURPOSE,NETWORK_CURRENT_PUBLISHER_SELECTION_KEY as NCP_KEY,NETWORK_CURRENT_PUBLISHER_OPERATIONS as NCP_OPS,inspectOriginalNetworkCurrentPublisherScopeV1DATA}from'./original-network-current-publisher-source-contract.mjs';
import{NETWORK_RESOURCE_PENDING_CONSENT_SOURCE_PURPOSE as NPR_PURPOSE,NETWORK_RESOURCE_PENDING_CONSENT_SOURCE_SELECTION_KEY as NPR_KEY,inspectOriginalNetworkPendingConsentSourceScopeV1DATA,captureOriginalNetworkPendingConsentOriginalsV1DATA,assertOriginalNetworkPendingConsentOriginalsCurrentV1DATA}from'./original-network-resource-pending-source-contract.mjs';
import{NETWORK_RESOURCE_SOURCE_PURPOSE as NR_PURPOSE,NETWORK_RESOURCE_SOURCE_SELECTION_KEY as NR_KEY,NETWORK_RESOURCE_SOURCE_OPERATIONS as NR_OPS,inspectOriginalNetworkResourceSourceScopeV2DATA,captureOriginalNetworkResourceOriginalsV1DATA,assertOriginalNetworkResourceOriginalsCurrentV1DATA}from'./original-network-resource-source-v2-contract.mjs';
import{WALLET_NATIVE_PRODUCT_SOURCE_PURPOSE as WPR_PURPOSE,WALLET_NATIVE_PRODUCT_SELECTION_KEY as WPR_KEY,WALLET_NATIVE_PRODUCT_OPERATIONS as WPR_OPS,WALLET_NATIVE_PRODUCT_LEGACY_OPERATIONS as WPR_LEGACY_OPS,inspectOriginalWalletProductScopeV1DATA}from'./original-wallet-product-source-contract.mjs';
import{BROWSER_SELECTED_PAGES_SOURCE_PURPOSE as BROWSER_PURPOSE,BROWSER_SELECTED_PAGES_SOURCE_SELECTION_KEY as BROWSER_KEY,BROWSER_SELECTED_PAGES_SOURCE_OPERATIONS as BROWSER_OPS,BROWSER_SELECTED_PAGES_APPLICATION_ID,inspectOriginalBrowserSelectedPagesScopeV1DATA}from'./original-browser-selected-pages-source-contract.mjs';
import{WALLET_NATIVE_PAY_CLIENT_SOURCE_PURPOSE as WPC_PURPOSE,WALLET_NATIVE_PAY_CLIENT_SELECTION_KEY as WPC_KEY,WALLET_NATIVE_PAY_CLIENT_OPERATIONS as WPC_OPS,inspectOriginalWalletPayClientScopeV1DATA}from'./original-wallet-pay-client-source-contract.mjs';
import{AI_NATIVE_TASK_ACTION_V6_SOURCE_PURPOSE as AI_PURPOSE,AI_NATIVE_TASK_ACTION_V6_SELECTION_KEY as AI_KEY,AI_NATIVE_TASK_ACTION_V6_OPERATIONS as AI_OPS,inspectOriginalAITaskActionV6SourceScopeDATA}from'./original-ai-task-action-v6-source-contract.mjs';
import{PAY_NATIVE_CLOUD_BILL_SOURCE_PURPOSE as PAY_PURPOSE,PAY_NATIVE_CLOUD_BILL_SELECTION_KEY as PAY_KEY,PAY_NATIVE_CLOUD_BILL_OPERATIONS as PAY_OPS,inspectOriginalPayCloudBillMappingV1DATA}from'./original-pay-cloud-bill-source-contract.mjs';
import{inspectOriginalAuthRuntimeImageBindingV1DATA,ORIGINAL_AUTH_RUNTIME_IMAGE_BINDING_V1_PURPOSES}from'./original-auth-runtime-image-binding-v1.mjs';
import{PRODUCT_DEVICE_V4_REGISTERED_FINALIZATION_PURPOSE,PRODUCT_DEVICE_V4_REGISTERED_FINALIZATION_OPERATIONS,inspectOriginalProductDeviceV4RegisteredFinalizationScopeDATA}from'./original-product-device-v4-registered-finalization-source-contract.mjs';
import{PRODUCT_SESSION_HTTP_PROOF_V5_SOURCE_PURPOSE,PRODUCT_SESSION_HTTP_PROOF_V5_SOURCE_OPERATIONS,inspectOriginalProductSessionHTTPProofV5SourceScopeDATA}from'./original-product-session-http-v5-source-contract.mjs';
import{CLOUD_DEPLOYMENT_EXECUTION_V2_PURPOSE,CLOUD_DEPLOYMENT_EXECUTION_V2_OPERATIONS,inspectOriginalCloudDeploymentExecutionV2ScopeDATA}from'./original-cloud-deployment-execution-v2-contract.mjs';
import{CLOUD_DEPLOYMENT_RECOVERY_V2_PURPOSE,CLOUD_DEPLOYMENT_RECOVERY_V2_OPERATIONS,inspectOriginalCloudDeploymentRecoveryV2ScopeDATA}from'./original-cloud-deployment-recovery-v2-contract.mjs';
import{IDE_DEPLOYMENT_V2_SOURCE_PURPOSE,IDE_DEPLOYMENT_V2_OPERATIONS,inspectOriginalIDEDeploymentV2ScopeDATA}from'./original-ide-deployment-v2-contract.mjs';
// Original Auth v2 credential mathematics. Not a Source/Root constructor,
// registration issuer, Native admission, signing owner, session or TLS upgrade.
// Native must supply independently authenticated current registration views
// under its original protected owner BEFORE AND AFTER using these functions.
import {encodeFields} from '@ynx/batch-v01-candidate';
import {canonical,sha,originalSignatureContract} from './original-auth-identity-source-verifier.mjs';
import {exactPQRecord,pqDecodeBase64url,pqBase64url} from '../src/pq-wallet-contract.js';
import {pqU64} from '../src/pq-wallet-authorization.js';
import {inspectPQAuthorizationView,assertPQAuthorizationCurrent} from '../src/pq-wallet-policy.js';
import {verifyPQRegisteredMemberData} from '../src/pq-registered-member.js';
import {inspectIDEArtifactPublisherPublicOriginalData} from '../src/ide-artifact-signature.js';
import {inspectOriginalIDEApprovalScopeDATA,ORIGINAL_IDE_APPROVAL_SOURCE_PURPOSE} from './original-ide-publication-approval-contract.mjs';
import {encodeOriginalDeveloperPrincipalDATA} from './original-developer-principal-data.mjs';
import {PQ_HOST_CATALOG_SOURCE_PURPOSE,PQ_HOST_CATALOG_SOURCE_OPERATIONS,inspectOriginalPQHostCatalogSourceScopeDATA} from './original-pq-host-catalog-source-contract.mjs';
import {PRODUCT_DEVICE_V4_SOURCE_PURPOSE,PRODUCT_DEVICE_V4_SOURCE_OPERATIONS,inspectOriginalProductDeviceV4SourceScopeDATA} from './original-product-device-v4-source-contract.mjs';
import {PRODUCT_DEVICE_V4_PENDING_PURPOSE,PRODUCT_DEVICE_V4_PENDING_OPERATIONS,inspectOriginalProductDeviceV4PendingScopeDATA} from './original-product-device-v4-pending-source-contract.mjs';
import{PRODUCT_DEVICE_V4_PROVISIONING_PURPOSE,PRODUCT_DEVICE_V4_PROVISIONING_OPERATIONS,inspectOriginalProductDeviceV4ProvisioningScopeDATA}from'./original-product-device-v4-provisioning-source-contract.mjs';
import{PRODUCT_DEVICE_V4_QUERY_PURPOSE,PRODUCT_DEVICE_V4_QUERY_OPERATIONS,inspectOriginalProductDeviceV4QueryScopeDATA}from'./original-product-device-v4-query-source-contract.mjs';
const deviceFamily=p=>[PRODUCT_DEVICE_V4_SOURCE_PURPOSE,PRODUCT_DEVICE_V4_PENDING_PURPOSE,PRODUCT_DEVICE_V4_PROVISIONING_PURPOSE,PRODUCT_DEVICE_V4_QUERY_PURPOSE,PRODUCT_DEVICE_V4_REGISTERED_FINALIZATION_PURPOSE,PRODUCT_SESSION_HTTP_PROOF_V5_SOURCE_PURPOSE].includes(p);
const deviceOperations=p=>p===PRODUCT_DEVICE_V4_REGISTERED_FINALIZATION_PURPOSE?PRODUCT_DEVICE_V4_REGISTERED_FINALIZATION_OPERATIONS:p===PRODUCT_SESSION_HTTP_PROOF_V5_SOURCE_PURPOSE?PRODUCT_SESSION_HTTP_PROOF_V5_SOURCE_OPERATIONS:p===PRODUCT_DEVICE_V4_QUERY_PURPOSE?PRODUCT_DEVICE_V4_QUERY_OPERATIONS:p===PRODUCT_DEVICE_V4_PROVISIONING_PURPOSE?PRODUCT_DEVICE_V4_PROVISIONING_OPERATIONS:p===PRODUCT_DEVICE_V4_PENDING_PURPOSE?PRODUCT_DEVICE_V4_PENDING_OPERATIONS:PRODUCT_DEVICE_V4_SOURCE_OPERATIONS;
const deviceField=p=>p===PRODUCT_DEVICE_V4_REGISTERED_FINALIZATION_PURPOSE?'productSessionDeviceV4RegisteredFinalization':p===PRODUCT_SESSION_HTTP_PROOF_V5_SOURCE_PURPOSE?'productSessionHTTPProofV5':p===PRODUCT_DEVICE_V4_QUERY_PURPOSE?'productSessionDeviceV4Query':p===PRODUCT_DEVICE_V4_PROVISIONING_PURPOSE?'productSessionDeviceV4Provisioning':p===PRODUCT_DEVICE_V4_PENDING_PURPOSE?'productSessionDeviceV4Pending':'productSessionDeviceV4';

export const AUTH_SOURCE_V2='YNX-AUTH-SOURCE/v2';
export const AUTH_SOURCE_DOMAIN_V2='YNX/AUTH/SOURCE-ORIGINAL/V2';
export const AUTH_SOURCE_STATEMENT_CAP=393216;
const suite='YNX-BATCH/v0.1',ops=['beginYNX','handleReturn','restore','disconnect'];
const relayPurpose='ide-contract-relay-v1',relayOps=['ynx_preparePQContractAction','ynx_preparePQContractBroadcast','ynx_getPQContractOriginal'];
const projectPurpose='ide-project-authority-v1',projectOps=['CurrentProject','CurrentPublisher','RecheckProject'];
const controlPurpose='ide-project-control-authority-v1',controlOps=['CaptureProjectControl','RecheckProjectControl'];
import{inspectOriginalProjectControlCaptureDATA}from'./original-ide-project-control-capture.mjs';
import{evmAddressFromYNX}from'../src/crypto.js';
import{inspectOriginalProjectControlCustodyDATA}from'./original-ide-project-control-custody-data.mjs';
const publicationOps=['approval.capture','approval.current','approval.revoke'];
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
function envelope(raw,role,frame,snapshot,networkId,expectedOwner,historicalCurrent=false){
 const e=parse(raw);exact(e,['version','algorithmVersion','role','networkId','owner','keyVersion','executionHeight','body','member']);
 if(e.version!==2||e.algorithmVersion!==suite||e.role!==role||e.networkId!==networkId||e.owner!==expectedOwner)fail('AUTH_SOURCE_V2_SIGNER_BINDING');
 const binding=context({networkId:e.networkId,owner:e.owner,keyVersion:e.keyVersion,executionHeight:e.executionHeight});
 // e.executionHeight is SIGNED issuance context. A pinned enrollment/profile
 // is not reissued for every block. Registration authority, however, must be
 // current at the independently observed snapshot height and current revision.
 inspectPQAuthorizationView(snapshot); // refuse unbranded/getter objects first
 const observed=decimal(snapshot.executionHeight),issued=decimal(e.executionHeight);
 if(issued>observed)fail('AUTH_SOURCE_V2_STATEMENT_HEIGHT');
 if(role==='current'&&!historicalCurrent&&issued!==observed)fail('AUTH_SOURCE_V2_CURRENT_HEIGHT');
 const historic=inspectPQAuthorizationView(snapshot,e.executionHeight);
 if(!historic.activeRecord||historic.activeRecord.revision!==e.keyVersion||historic.authorizationStatus==='revoked')fail('AUTH_SOURCE_V2_ISSUANCE_KEY_REQUIRED');
 let bytes,wire,bodyRaw;try{bytes=pqDecodeBase64url(e.body,{max:65536});wire=pqDecodeBase64url(e.member,{max:262144});bodyRaw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail('AUTH_SOURCE_V2_ENCODING');}
 const body=parse(bodyRaw,65536);
 const math=verifyPQRegisteredMemberData(snapshot,wire,{chainId:networkId,owner:expectedOwner,keyVersion:e.keyVersion,executionHeight:snapshot.executionHeight,purpose:purposes[role],message:encodeOriginalAuthSourceStatementV2(role,frame,binding,bodyRaw)});
 if(math.memberCount!==1||math.memberIndex!==0)fail('AUTH_SOURCE_V2_N1_REQUIRED');
 return Object.freeze({body,binding:seal({...binding}),dataOnly:true,nativeAdmission:false});
}
function sourcePolicy(policy){
 const pqCatalog=policy?.signatureContract?.purpose===PQ_HOST_CATALOG_SOURCE_PURPOSE;
 const ai=policy?.signatureContract?.purpose===AI_PURPOSE;
 const mobile=policy?.signatureContract?.purpose===WM_PURPOSE;
 const device=deviceFamily(policy?.signatureContract?.purpose),pay=[DGA_PURPOSE,TLS_PURPOSE,NCP_PURPOSE,NPR_PURPOSE,NR_PURPOSE,PAY_PURPOSE,WPC_PURPOSE,BROWSER_PURPOSE,WPR_PURPOSE].includes(policy?.signatureContract?.purpose);
 exact(policy,mobile?['rootDigest','enrollmentDigest','endpoint','spki','signatureContract','applicationId','productId','platform']:ai?['rootDigest','enrollmentDigest','endpoint','spki','signatureContract','applicationId','productId','platform','sourceRole']:pay?['rootDigest','enrollmentDigest','endpoint','spki','signatureContract','applicationId','productId','platform']:device?['rootDigest','enrollmentDigest','endpoint','spki','signatureContract','applicationId','productId']:pqCatalog?['rootDigest','enrollmentDigest','endpoint','spki','signatureContract','applicationId']:['rootDigest','enrollmentDigest','endpoint','spki','signatureContract']);
 if(mobile&&(policy.productId!=='wallet'||!['ios','android'].includes(policy.platform)||typeof policy.applicationId!=='string'||!/^[A-Za-z][A-Za-z0-9.-]{2,131}$/.test(policy.applicationId)))fail('MOBILE_SOURCE_POLICY');
 if(ai&&(!['client','server'].includes(policy.sourceRole)||!(policy.sourceRole==='client'?['ios','android']:['linux','macos','windows']).includes(policy.platform)||policy.productId!=='ai'||policy.sourceRole==='client'&&policy.applicationId!=='com.ynxweb4.ai'||typeof policy.applicationId!=='string'||!/^[A-Za-z][A-Za-z0-9.-]{2,131}$/.test(policy.applicationId)))fail('AI_TASK_SOURCE_POLICY');
 if(pay&&(!['linux','macos','windows'].includes(policy.platform)||typeof policy.applicationId!=='string'||!/^[A-Za-z][A-Za-z0-9.-]{2,131}$/.test(policy.applicationId)||typeof policy.productId!=='string'||!/^[a-z][a-z0-9-]{1,31}$/.test(policy.productId)))fail('PAY_SOURCE_POLICY');
 if(policy?.signatureContract?.purpose===WPR_PURPOSE&&policy.productId!=='wallet')fail('WALLET_PRODUCT_SOURCE_POLICY');
 if(policy?.signatureContract?.purpose===WPC_PURPOSE&&policy.productId!=='wallet')fail('WALLET_PAY_CLIENT_SOURCE_POLICY');
 if(policy?.signatureContract?.purpose===BROWSER_PURPOSE&&(policy.productId!=='browser'||policy.platform!=='macos'||policy.applicationId!==BROWSER_SELECTED_PAGES_APPLICATION_ID))fail('BROWSER_SELECTED_PAGES_SOURCE_POLICY');
 if(device&&(typeof policy.applicationId!=='string'||!/^[A-Za-z][A-Za-z0-9.-]{2,131}$/.test(policy.applicationId)||typeof policy.productId!=='string'||!/^[a-z][a-z0-9-]{1,31}$/.test(policy.productId)))fail('AUTH_SOURCE_V2_DEVICE_APPLICATION');
 if(pqCatalog&&(typeof policy.applicationId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9.-]{0,255}$/.test(policy.applicationId)))fail('AUTH_SOURCE_V2_PQ_CATALOG_APPLICATION');
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
// Same device body checks are used BEFORE protected role-key access/signing
// and AFTER registered envelope verification. DATA is not a Root/role grant.
function deviceEnrollmentBodyDATA(root,e,policy,registrations,atMs){
 exact(e,['version','purpose','rootId','rootOwner','sourceId','service','productId','platform','applicationId','gatewayOrigin','registryDigest','profileOwner','currentOwner','endpoint','spki','currentStatePath','operations','issuedAtMs','expiresAtMs']);
 if(e.version!==2||e.purpose!==policy.signatureContract.purpose||!deviceFamily(e.purpose)||root.purpose!==e.purpose||e.rootId!==root.rootId||e.rootOwner!==root.rootOwner||!token(e.sourceId)||!owner(e.profileOwner)||!owner(e.currentOwner)||new Set([root.rootOwner,e.profileOwner,e.currentOwner]).size!==3||e.service!==e.purpose||e.productId!==policy.productId||e.platform!=='macos'||e.applicationId!==policy.applicationId||e.gatewayOrigin!=='https://wallet-auth.ynxweb4.com'||!hex(e.registryDigest)||e.endpoint!==policy.endpoint||e.spki!==policy.spki||!absolute(e.currentStatePath)||canonical(e.operations)!==canonical(deviceOperations(e.purpose)))fail('AUTH_SOURCE_V2_DEVICE_ENROLLMENT_BODY');
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
 const data=p.purpose===PRODUCT_DEVICE_V4_REGISTERED_FINALIZATION_PURPOSE?inspectOriginalProductDeviceV4RegisteredFinalizationScopeDATA(s[field],a,root.networkId,p.subjectOwner,p.issuedAtMs,p.expiresAtMs,atMs):p.purpose===PRODUCT_SESSION_HTTP_PROOF_V5_SOURCE_PURPOSE?inspectOriginalProductSessionHTTPProofV5SourceScopeDATA(s[field],a,root.networkId,p.subjectOwner,p.issuedAtMs,p.expiresAtMs,atMs):p.purpose===PRODUCT_DEVICE_V4_QUERY_PURPOSE?inspectOriginalProductDeviceV4QueryScopeDATA(s[field],a,root.networkId,p.subjectOwner,p.issuedAtMs,p.expiresAtMs,atMs):p.purpose===PRODUCT_DEVICE_V4_PROVISIONING_PURPOSE?inspectOriginalProductDeviceV4ProvisioningScopeDATA(s[field],a,root.networkId,p.subjectOwner,p.issuedAtMs,p.expiresAtMs,atMs):p.purpose===PRODUCT_DEVICE_V4_PENDING_PURPOSE?inspectOriginalProductDeviceV4PendingScopeDATA(s[field],a,root.networkId,p.subjectOwner,p.issuedAtMs,p.expiresAtMs,atMs):inspectOriginalProductDeviceV4SourceScopeDATA(s[field],a,root.networkId,p.subjectOwner,p.issuedAtMs,p.expiresAtMs,atMs),height=registrations.root.executionHeight;
 for(const [snapshot,id]of [[registrations.root,root.rootOwner],[registrations.profile,e.profileOwner],[registrations.current,e.currentOwner],[registrations.subject,p.subjectOwner]]){const record=active(snapshot,root.networkId,id,height);if(data.devicePublic&&(record.pkA===data.devicePublic.pkA||record.pkB===data.devicePublic.pkB))fail('AUTH_SOURCE_V2_DEVICE_KEY_ROLE_COLLISION');}
 const accountRecord=active(registrations.subject,root.networkId,p.subjectOwner,height);if(data.accountAuthorization)for(const k of ['pkA','pkB','revision','registeredAt','activeFrom'])if(accountRecord[k]!==data.accountAuthorization[k])fail('AUTH_SOURCE_V2_DEVICE_ACCOUNT_CURRENT_CHANGED');
 return data;
}
export function inspectOriginalProductDeviceV4IssuanceBodyDATA(role,rootRaw,enrollmentRaw,bodyRaw,policy,registrations,atMs){
 const contract=sourcePolicy(policy);if(!deviceFamily(contract.purpose)||!['enrollment','profile'].includes(role))fail('AUTH_SOURCE_V2_DEVICE_ISSUANCE_ROLE_REQUIRED');exact(registrations,['root','profile','current','subject']);
 const root=parse(rootRaw,16384);exact(root,['version','algorithmVersion','purpose','rootId','networkId','rootOwner']);if(sha(rootRaw)!==policy.rootDigest||root.version!==2||root.algorithmVersion!==suite||root.purpose!==contract.purpose||!token(root.rootId)||!hex(root.networkId)||!owner(root.rootOwner))fail('AUTH_SOURCE_V2_ROOT');
 const body=parse(bodyRaw,65536);
 if(role==='enrollment')deviceEnrollmentBodyDATA(root,body,policy,registrations,atMs);
 else{const verified=verifyOriginalAuthSourceEnrollmentV2(rootRaw,enrollmentRaw,policy,registrations,atMs);deviceProfileBodyDATA(root,verified.enrollment,body,policy,registrations,atMs);}
 return Object.freeze({role,bodySHA256:sha(bodyRaw),dataOnly:true,authorized:false,nativeAdmission:false});
}
function serverTLSEnrollmentBodyDATA(root,e,policy,registrations,atMs){
 exact(e,['version','purpose','rootId','rootOwner','sourceId','service','productId','platform','applicationId','gatewayOrigin','registryDigest','profileOwner','currentOwner','endpoint','spki','currentStatePath','operations','issuedAtMs','expiresAtMs']);
 if(e.version!==2||e.purpose!==TLS_PURPOSE||root.purpose!==TLS_PURPOSE||e.rootId!==root.rootId||e.rootOwner!==root.rootOwner||!token(e.sourceId)||!owner(e.profileOwner)||!owner(e.currentOwner)||new Set([root.rootOwner,e.profileOwner,e.currentOwner]).size!==3||e.service!==TLS_PURPOSE||e.productId!==policy.productId||e.platform!==policy.platform||e.applicationId!==policy.applicationId||e.gatewayOrigin!=='https://wallet-auth.ynxweb4.com'||!hex(e.registryDigest)||e.endpoint!==policy.endpoint||e.spki!==policy.spki||!absolute(e.currentStatePath)||canonical(e.operations)!==canonical(TLS_OPS))fail('SERVER_TLS_SOURCE_ENROLLMENT');
 window(e,atMs,86400000);const height=registrations.root.executionHeight,records=[active(registrations.root,root.networkId,root.rootOwner,height),active(registrations.profile,root.networkId,e.profileOwner,height),active(registrations.current,root.networkId,e.currentOwner,height)];
 for(let i=0;i<records.length;i++)for(let j=0;j<i;j++)if(records[i].pkA===records[j].pkA||records[i].pkB===records[j].pkB)fail('AUTH_SOURCE_V2_KEYS_NOT_DISTINCT');
}
function serverTLSProfileBodyDATA(root,e,p,enrollmentRaw,policy,registrations,atMs){
 exact(p,['version','purpose','sourceId','enrollmentDigest','instanceId','generation','minimumSequence','minimumFloor','subjectOwner','selection','issuedAtMs','expiresAtMs']);
 if(p.version!==2||p.purpose!==TLS_PURPOSE||p.sourceId!==e.sourceId||p.enrollmentDigest!==sha(enrollmentRaw)||!token(p.instanceId)||!integer(p.generation)||p.generation<1||!integer(p.minimumSequence)||p.minimumSequence<1||!integer(p.minimumFloor)||p.minimumFloor>p.minimumSequence||!owner(p.subjectOwner))fail('SERVER_TLS_SOURCE_PROFILE');
 window(p,atMs,86400000);if(p.issuedAtMs<e.issuedAtMs||p.expiresAtMs>e.expiresAtMs)fail('AUTH_SOURCE_V2_EXPIRED');
 const s=p.selection;exact(s,['association','expectedRequest','originalHostStatePath','originalHostTerminalDirectory',TLS_KEY]);const a=s.association;exact(a,['account','clientId','productId','platform','applicationId','deviceId']);
 if(a.account!==p.subjectOwner||a.productId!==policy.productId||a.platform!==policy.platform||a.applicationId!==policy.applicationId)fail('SERVER_TLS_SOURCE_ASSOCIATION');
 const r=s.expectedRequest;exact(r,['service','productId','platform','applicationId','gatewayOrigin','registryDigest','operations','instanceId']);
 if(r.service!==TLS_PURPOSE||r.productId!==e.productId||r.platform!==e.platform||r.applicationId!==e.applicationId||r.gatewayOrigin!==e.gatewayOrigin||r.registryDigest!==e.registryDigest||canonical(r.operations)!==canonical(TLS_OPS)||r.instanceId!==p.instanceId||!absolute(s.originalHostStatePath)||s.originalHostTerminalDirectory!==s.originalHostStatePath+'.private-terminal')fail('SERVER_TLS_SOURCE_REQUEST');
 const data=inspectOriginalServerTLSIdentityScopeV1DATA(s[TLS_KEY],a,root.networkId,p.subjectOwner,p.sourceId,p.instanceId,p.issuedAtMs,p.expiresAtMs,atMs),height=registrations.root.executionHeight;
 const records=[[registrations.root,root.rootOwner],[registrations.profile,e.profileOwner],[registrations.current,e.currentOwner],[registrations.subject,p.subjectOwner]].map(([snapshot,id])=>active(snapshot,root.networkId,id,height));
 for(let i=0;i<records.length;i++)for(let j=0;j<i;j++)if(records[i].pkA===records[j].pkA||records[i].pkB===records[j].pkB)fail('AUTH_SOURCE_V2_KEYS_NOT_DISTINCT');
 return Object.freeze({subjectKeyVersion:selectOriginalAuthSourceAlgorithm(registrations.subject,2).keyVersion,effectExpiresAtMs:data.effectExpiresAtMs});
}
export function inspectOriginalServerTLSSourceIssuanceBodyV1DATA(role,rootRaw,enrollmentRaw,bodyRaw,policy,registrations,atMs){
 const contract=sourcePolicy(policy);if(contract.purpose!==TLS_PURPOSE||!['enrollment','profile'].includes(role))fail('SERVER_TLS_SOURCE_ISSUANCE_ROLE');exact(registrations,['root','profile','current','subject']);
 const root=parse(rootRaw,16384);exact(root,['version','algorithmVersion','purpose','rootId','networkId','rootOwner']);if(sha(rootRaw)!==policy.rootDigest||root.version!==2||root.algorithmVersion!==suite||root.purpose!==TLS_PURPOSE||!token(root.rootId)||!hex(root.networkId)||!owner(root.rootOwner))fail('AUTH_SOURCE_V2_ROOT');
 const body=parse(bodyRaw,65536);let effectExpiresAtMs=body.expiresAtMs;
 if(role==='enrollment')serverTLSEnrollmentBodyDATA(root,body,policy,registrations,atMs);else{const{enrollment}=verifyOriginalAuthSourceEnrollmentV2(rootRaw,enrollmentRaw,policy,registrations,atMs);effectExpiresAtMs=serverTLSProfileBodyDATA(root,enrollment,body,enrollmentRaw,policy,registrations,atMs).effectExpiresAtMs;}
 return Object.freeze({role,bodySHA256:sha(bodyRaw),effectExpiresAtMs,dataOnly:true,authorized:false,nativeAdmission:false});
}

function originalSourceEnrollmentBodyDATA(root,e,policy,registrations,atMs){
 if(policy.signatureContract.purpose===TLS_PURPOSE)return serverTLSEnrollmentBodyDATA(root,e,policy,registrations,atMs);
 if(policy.signatureContract.purpose===DGA_PURPOSE)return desktopGrantEnrollmentBodyDATA(root,e,policy,registrations,atMs);
 if(policy.signatureContract.purpose===WM_PURPOSE)return mobileEnrollmentBodyDATA(root,e,policy,registrations,atMs);
 if(policy.signatureContract.purpose===NCP_PURPOSE)return publisherEnrollmentBodyDATA(root,e,policy,registrations,atMs);
 if([NR_PURPOSE,NPR_PURPOSE].includes(policy.signatureContract.purpose))return networkEnrollmentBodyDATA(root,e,policy,registrations,atMs);
 if(policy.signatureContract.purpose===AI_PURPOSE)return aiEnrollmentBodyDATA(root,e,policy,registrations,atMs);
 if([PAY_PURPOSE,WPC_PURPOSE,BROWSER_PURPOSE,WPR_PURPOSE].includes(policy.signatureContract.purpose))return payEnrollmentBodyDATA(root,e,policy,registrations,atMs,policy.signatureContract.purpose===WPC_PURPOSE);
 const contract=sourcePolicy(policy);
 const pqCatalog=contract.purpose===PQ_HOST_CATALOG_SOURCE_PURPOSE,device=deviceFamily(contract.purpose);
 const relay=contract.purpose===relayPurpose,projectAuthority=contract.purpose===projectPurpose,control=contract.purpose===controlPurpose,publication=contract.purpose===ORIGINAL_IDE_APPROVAL_SOURCE_PURPOSE,execution=contract.purpose===CLOUD_DEPLOYMENT_EXECUTION_V2_PURPOSE,recovery=contract.purpose===CLOUD_DEPLOYMENT_RECOVERY_V2_PURPOSE,deployment=contract.purpose===IDE_DEPLOYMENT_V2_SOURCE_PURPOSE,expectedOps=execution?CLOUD_DEPLOYMENT_EXECUTION_V2_OPERATIONS:recovery?CLOUD_DEPLOYMENT_RECOVERY_V2_OPERATIONS:deployment?IDE_DEPLOYMENT_V2_OPERATIONS:device?deviceOperations(contract.purpose):pqCatalog?PQ_HOST_CATALOG_SOURCE_OPERATIONS:relay?relayOps:projectAuthority?projectOps:control?controlOps:publication?publicationOps:ops;
 if(device)deviceEnrollmentBodyDATA(root,e,policy,registrations,atMs);
 exact(e,['version','purpose','rootId','rootOwner','sourceId','service','productId','platform','applicationId','gatewayOrigin','registryDigest','profileOwner','currentOwner','endpoint','spki','currentStatePath','operations','issuedAtMs','expiresAtMs']);
 if(e.version!==2||e.purpose!==contract.purpose||e.rootId!==root.rootId||e.rootOwner!==root.rootOwner||!token(e.sourceId)||!owner(e.profileOwner)||!owner(e.currentOwner)||new Set([root.rootOwner,e.profileOwner,e.currentOwner]).size!==3||e.service!==((execution||recovery)?contract.purpose:deployment?IDE_DEPLOYMENT_V2_SOURCE_PURPOSE:device?contract.purpose:pqCatalog?PQ_HOST_CATALOG_SOURCE_PURPOSE:relay?relayPurpose:projectAuthority?projectPurpose:control?controlPurpose:publication?ORIGINAL_IDE_APPROVAL_SOURCE_PURPOSE:'wallet-product-session-v2')||e.productId!==(device?policy.productId:pqCatalog?'wallet':'developer')||e.platform!=='macos'||e.applicationId!==((device||pqCatalog)?policy.applicationId:'com.ynxweb4.developer.testnetpreview')||e.gatewayOrigin!=='https://wallet-auth.ynxweb4.com'||!hex(e.registryDigest)||e.endpoint!==policy.endpoint||e.spki!==policy.spki||canonical(e.operations)!==canonical(expectedOps)||!absolute(e.currentStatePath))fail('AUTH_SOURCE_V2_ENROLLMENT');
 window(e,atMs,86400000);
 const height=registrations.root.executionHeight;
 const roleKeys=[active(registrations.root,root.networkId,root.rootOwner,height),active(registrations.profile,root.networkId,e.profileOwner,height),active(registrations.current,root.networkId,e.currentOwner,height)];
 for(let i=0;i<roleKeys.length;i++)for(let j=0;j<i;j++)if(roleKeys[i].pkA===roleKeys[j].pkA||roleKeys[i].pkB===roleKeys[j].pkB)fail('AUTH_SOURCE_V2_KEYS_NOT_DISTINCT');
}
function originalSourceProfileBodyDATA(root,e,p,enrollmentRaw,policy,registrations,atMs,networkOriginals){
 if(policy.signatureContract.purpose===TLS_PURPOSE)return serverTLSProfileBodyDATA(root,e,p,enrollmentRaw,policy,registrations,atMs);
 if(Object.hasOwn(p.selection??{},TLS_KEY))fail("SERVER_TLS_DEDICATED_PURPOSE_REQUIRED");
 if(policy.signatureContract.purpose===DGA_PURPOSE)return desktopGrantProfileBodyDATA(root,e,p,enrollmentRaw,policy,registrations,atMs);
 if(Object.hasOwn(p.selection??{},DGA_KEY))fail("DESKTOP_GRANT_DEDICATED_PURPOSE_REQUIRED");
 if(policy.signatureContract.purpose===WM_PURPOSE)return mobileProfileBodyDATA(root,e,p,enrollmentRaw,policy,registrations,atMs);
 if(Object.hasOwn(p.selection??{},WM_KEY))fail('MOBILE_SOURCE_DEDICATED_PURPOSE_REQUIRED');
 if(policy.signatureContract.purpose===NCP_PURPOSE)return publisherProfileBodyDATA(root,e,p,enrollmentRaw,policy,registrations,atMs);
 if(Object.hasOwn(p.selection??{},NCP_KEY))fail("NETWORK_PUBLISHER_DEDICATED_PURPOSE_REQUIRED");
 if([NR_PURPOSE,NPR_PURPOSE].includes(policy.signatureContract.purpose))return networkProfileBodyDATA(root,e,p,enrollmentRaw,policy,registrations,atMs,networkOriginals);
 if(Object.hasOwn(p.selection??{},NPR_KEY))fail('NETWORK_PENDING_DEDICATED_PURPOSE_REQUIRED');
 if(Object.hasOwn(p.selection??{},NR_KEY))fail("NETWORK_RESOURCE_DEDICATED_PURPOSE_REQUIRED");
 if(policy.signatureContract.purpose===AI_PURPOSE)return aiProfileBodyDATA(root,e,p,enrollmentRaw,policy,registrations,atMs);
 if(Object.hasOwn(p.selection??{},AI_KEY))fail('AI_TASK_SOURCE_DEDICATED_PURPOSE_REQUIRED');
 if([PAY_PURPOSE,WPC_PURPOSE,BROWSER_PURPOSE,WPR_PURPOSE].includes(policy.signatureContract.purpose))return payProfileBodyDATA(root,e,p,enrollmentRaw,policy,registrations,atMs,policy.signatureContract.purpose===WPC_PURPOSE);
 if(Object.hasOwn(p.selection??{},WPR_KEY))fail('WALLET_PRODUCT_SOURCE_DEDICATED_PURPOSE_REQUIRED');
 if(Object.hasOwn(p.selection??{},BROWSER_KEY))fail('BROWSER_SELECTED_PAGES_SOURCE_DEDICATED_PURPOSE_REQUIRED');
 if(Object.hasOwn(p.selection??{},WPC_KEY))fail('WALLET_PAY_CLIENT_SOURCE_DEDICATED_PURPOSE_REQUIRED');
 if(Object.hasOwn(p.selection??{},PAY_KEY))fail('PAY_SOURCE_DEDICATED_PURPOSE_REQUIRED');
 const contract=sourcePolicy(policy),pqCatalog=contract.purpose===PQ_HOST_CATALOG_SOURCE_PURPOSE,device=deviceFamily(contract.purpose);
 const relay=contract.purpose===relayPurpose,projectAuthority=contract.purpose===projectPurpose,control=contract.purpose===controlPurpose,publication=contract.purpose===ORIGINAL_IDE_APPROVAL_SOURCE_PURPOSE,execution=contract.purpose===CLOUD_DEPLOYMENT_EXECUTION_V2_PURPOSE,recovery=contract.purpose===CLOUD_DEPLOYMENT_RECOVERY_V2_PURPOSE,deployment=contract.purpose===IDE_DEPLOYMENT_V2_SOURCE_PURPOSE,expectedOps=execution?CLOUD_DEPLOYMENT_EXECUTION_V2_OPERATIONS:recovery?CLOUD_DEPLOYMENT_RECOVERY_V2_OPERATIONS:deployment?IDE_DEPLOYMENT_V2_OPERATIONS:device?deviceOperations(contract.purpose):pqCatalog?PQ_HOST_CATALOG_SOURCE_OPERATIONS:relay?relayOps:projectAuthority?projectOps:control?controlOps:publication?publicationOps:ops;
 exact(p,['version','purpose','sourceId','enrollmentDigest','instanceId','generation','minimumSequence','minimumFloor','subjectOwner','selection','issuedAtMs','expiresAtMs']);
 if(p.version!==2||p.purpose!==contract.purpose||p.sourceId!==e.sourceId||p.enrollmentDigest!==sha(enrollmentRaw)||!token(p.instanceId)||!integer(p.generation)||p.generation<1||!integer(p.minimumSequence)||p.minimumSequence<1||!integer(p.minimumFloor)||p.minimumFloor>p.minimumSequence||!owner(p.subjectOwner))fail('AUTH_SOURCE_V2_PROFILE');
 const s=p.selection;
 if(Object.hasOwn(s??{},'runtimeImageBindingV1')&&!ORIGINAL_AUTH_RUNTIME_IMAGE_BINDING_V1_PURPOSES.includes(p.purpose))fail('AUTH_RUNTIME_IMAGE_BINDING_V1_PURPOSE');
 // Preserve all existing signed product/ownership/permission metadata. Only
 // these original fields are interpreted here; do not silently drop extras
 // or rewrite the original application's role schema during key migration.
 if(!s||Object.getPrototypeOf(s)!==Object.prototype||!['association','expectedRequest','originalHostStatePath','originalHostTerminalDirectory'].every(k=>Object.hasOwn(s,k)))fail('AUTH_SOURCE_V2_SCHEMA');
 const a=s.association;exact(a,['account','clientId','productId','platform','applicationId','deviceId']);
 if(Object.values(a).some(x=>typeof x!=='string'||!x||x.length>512)||a.productId!==e.productId||a.platform!==e.platform||a.applicationId!==e.applicationId)fail('AUTH_SOURCE_V2_ASSOCIATION');
 if(pqCatalog)inspectOriginalPQHostCatalogSourceScopeDATA(s.pqHostCatalogSource,a,root.networkId,p.expiresAtMs,atMs);
 else if(Object.hasOwn(s,'pqHostCatalogSource'))fail('AUTH_SOURCE_V2_PQ_CATALOG_DEDICATED_PURPOSE_REQUIRED');
 if(device)deviceProfileBodyDATA(root,e,p,policy,registrations,atMs);
 else if(execution||recovery){const field=execution?'cloudDeploymentExecutionV2':'cloudDeploymentRecoveryV2';exact(s,['association','expectedRequest','originalHostStatePath','originalHostTerminalDirectory',field]);const data=(execution?inspectOriginalCloudDeploymentExecutionV2ScopeDATA:inspectOriginalCloudDeploymentRecoveryV2ScopeDATA)(s[field],a,root.networkId,p.subjectOwner,p.sourceId,p.instanceId,p.generation,p.issuedAtMs,p.expiresAtMs,atMs);if(execution)for(const [snapshot,id]of [[registrations.root,root.rootOwner],[registrations.profile,e.profileOwner],[registrations.current,e.currentOwner],[registrations.subject,p.subjectOwner]]){const record=active(snapshot,root.networkId,id,registrations.root.executionHeight);for(const role of[data.publisher,data.issuer])if(record.pkA===Buffer.from(role.pkA,'base64url').toString('hex')||record.pkB===Buffer.from(role.pkB,'base64url').toString('hex'))fail('DEPLOYMENT_EXECUTION_V2_ROLE_COLLISION');}}
 else if(deployment){exact(s,['association','expectedRequest','originalHostStatePath','originalHostTerminalDirectory','ideDeploymentV2']);const deploymentData=inspectOriginalIDEDeploymentV2ScopeDATA(s.ideDeploymentV2,a,root.networkId,p.subjectOwner,p.sourceId,p.instanceId,p.generation,p.issuedAtMs,p.expiresAtMs,atMs);for(const [snapshot,id]of [[registrations.root,root.rootOwner],[registrations.profile,e.profileOwner],[registrations.current,e.currentOwner],[registrations.subject,p.subjectOwner]]){const record=active(snapshot,root.networkId,id,registrations.root.executionHeight);for(const role of [deploymentData.publisher,deploymentData.issuer])if(record.pkA===Buffer.from(role.pkA,'base64url').toString('hex')||record.pkB===Buffer.from(role.pkB,'base64url').toString('hex'))fail('IDE_DEPLOYMENT_V2_RELEASE_KEY_ROLE_COLLISION');}}else if(Object.hasOwn(s,'cloudDeploymentExecutionV2')||Object.hasOwn(s,'cloudDeploymentRecoveryV2'))fail('DEPLOYMENT_EXECUTION_V2_DEDICATED_SOURCE_REQUIRED');else if(Object.hasOwn(s,'ideDeploymentV2'))fail('IDE_DEPLOYMENT_V2_DEDICATED_SOURCE_REQUIRED');
 else if(Object.hasOwn(s,'productSessionDeviceV4')||Object.hasOwn(s,'productSessionDeviceV4Pending')||Object.hasOwn(s,'productSessionDeviceV4Provisioning')||Object.hasOwn(s,'productSessionDeviceV4Query')||Object.hasOwn(s,'productSessionDeviceV4RegisteredFinalization')||Object.hasOwn(s,'productSessionHTTPProofV5'))fail('AUTH_SOURCE_V2_DEVICE_DEDICATED_PURPOSE_REQUIRED');
 const r=s.expectedRequest;
 if(!r||r.service!==e.service||r.productId!==e.productId||r.platform!==e.platform||r.applicationId!==e.applicationId||r.gatewayOrigin!==e.gatewayOrigin||r.registryDigest!==e.registryDigest||canonical(r.operations)!==canonical(expectedOps)||r.instanceId!==p.instanceId||!absolute(s.originalHostStatePath)||s.originalHostTerminalDirectory!==s.originalHostStatePath+'.private-terminal')fail('AUTH_SOURCE_V2_REQUEST');
 if(relay){
  const scope=s.contractRelay,project=s.projectCurrent,peer=s.identityPeerBinding;
  exact(scope,['kind','projectId','projectGeneration','callerIdentity','origin','expiresMS','chainId','methods','relayURL']);
  exact(project,['projectId','projectGeneration','account','sessionId','callerIdentity','expiresMS']);
  exact(peer,['walletCodeIdentity','ideCodeIdentity','nodeCodeIdentity','nodeSHA256','entrySHA256','provenanceSHA256']);
  if(scope.kind!==relayPurpose||scope.origin!=='https://developer.ynxweb4.com'||scope.chainId!=='eip155:6423'||scope.relayURL!=='wss://relay.walletconnect.org'||canonical(scope.methods)!==canonical(relayOps)||!token(scope.projectId)||!integer(scope.projectGeneration)||scope.projectGeneration<1||!integer(scope.expiresMS)||scope.expiresMS<=atMs||scope.expiresMS>p.expiresAtMs||scope.projectId!==project.projectId||scope.projectGeneration!==project.projectGeneration||scope.callerIdentity!==project.callerIdentity||scope.callerIdentity!==peer.nodeCodeIdentity||project.account!==a.account||!token(project.sessionId)||!integer(project.expiresMS)||scope.expiresMS>project.expiresMS||project.expiresMS>p.expiresAtMs)fail('AUTH_SOURCE_V2_RELAY_PROJECT_CURRENT');
  for(const k of ['walletCodeIdentity','ideCodeIdentity','nodeCodeIdentity'])if(typeof peer[k]!=='string'||!peer[k]||peer[k].length>1024||/[\x00-\x1f\x7f]/.test(peer[k]))fail('AUTH_SOURCE_V2_RELAY_PEER');
  for(const k of ['nodeSHA256','entrySHA256','provenanceSHA256'])if(!hex(peer[k]))fail('AUTH_SOURCE_V2_RELAY_PEER');
  const launch=s.projectLaunch;
  if(!hex(s.contractRelayRuntimeSHA256))fail('AUTH_SOURCE_V2_RELAY_RUNTIME_BINDING');
  exact(launch,['projectId','projectGeneration','localProjectId','workspace','profile','node']);
  if(launch.projectId!==scope.projectId||launch.projectGeneration!==scope.projectGeneration||typeof launch.localProjectId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(launch.localProjectId))fail('AUTH_SOURCE_V2_RELAY_LAUNCH');
  for(const k of ['workspace','profile']){exact(launch[k],['path','device','inode']);if(!absolute(launch[k].path)||launch[k].path==='/'||/[\x00-\x1f\x7f]/.test(launch[k].path)||Buffer.byteLength(launch[k].path)>4096)fail('AUTH_SOURCE_V2_RELAY_LAUNCH');decimal(launch[k].device);decimal(launch[k].inode,true);}
  exact(launch.node,['pid','parent','uid','gid','startSeconds','startMicros']);
  for(const k of ['pid','parent','uid','gid','startSeconds','startMicros'])decimal(launch.node[k],['pid','parent','startSeconds'].includes(k));
  if(BigInt(launch.node.startMicros)>999999n)fail('AUTH_SOURCE_V2_RELAY_LAUNCH');
 }else if(Object.hasOwn(s,'contractRelay')||Object.hasOwn(s,'projectCurrent'))fail('AUTH_SOURCE_V2_RELAY_DEDICATED_PURPOSE_REQUIRED');
 if(control){const peer=s.identityPeerBinding;exact(peer,['walletCodeIdentity','ideCodeIdentity','nodeCodeIdentity','nodeSHA256','entrySHA256','provenanceSHA256']);if(typeof peer.walletCodeIdentity!=='string'||!peer.walletCodeIdentity.length||peer.walletCodeIdentity.length>256||Buffer.from(peer.walletCodeIdentity,'base64').toString('base64')!==peer.walletCodeIdentity||['walletCodeIdentity','ideCodeIdentity','nodeCodeIdentity'].some(k=>typeof peer[k]!=='string'||!peer[k].length||Buffer.byteLength(peer[k])>1024)||['nodeSHA256','entrySHA256','provenanceSHA256'].some(k=>!hex(peer[k])))fail('AUTH_SOURCE_V2_CONTROL_CALLER');if(evmAddressFromYNX(a.account)!==p.subjectOwner)fail('AUTH_SOURCE_V2_CONTROL_SUBJECT');inspectOriginalProjectControlCaptureDATA(s.projectControlCapture,a,root.networkId,peer.walletCodeIdentity,p.issuedAtMs,p.expiresAtMs,atMs);}
 else if(Object.hasOwn(s,'projectControlCapture'))fail('AUTH_SOURCE_V2_CONTROL_DEDICATED_PURPOSE_REQUIRED');
 if(Object.hasOwn(s,'projectControlCustody')){if(!control)fail('AUTH_SOURCE_V2_CONTROL_DEDICATED_PURPOSE_REQUIRED');inspectOriginalProjectControlCustodyDATA(s.projectControlCustody,root.networkId,p.subjectOwner,registrations.subject,p.issuedAtMs,p.expiresAtMs,atMs);}
 if(projectAuthority){verifyProjectAuthority(s,p,e,root,registrations,atMs);if(Object.hasOwn(s,'projectSelection'))verifyProjectSelection(s,p,atMs);}
 else if(Object.hasOwn(s,'projectAuthority')||Object.hasOwn(s,'projectSelection'))fail('AUTH_SOURCE_V2_PROJECT_DEDICATED_PURPOSE_REQUIRED');
 window(p,atMs,86400000);if(p.issuedAtMs<e.issuedAtMs||p.expiresAtMs>e.expiresAtMs)fail('AUTH_SOURCE_V2_EXPIRED');
 const height=registrations.root.executionHeight;decimal(height);
 active(registrations.subject,root.networkId,p.subjectOwner,height);
 if(publication)verifyPublicationAuthority(s,p,e,root,registrations,atMs);
 else if(Object.hasOwn(s,'publicationApprovalAuthority'))fail('AUTH_SOURCE_V2_PUBLICATION_DEDICATED_PURPOSE_REQUIRED');
 const selected=selectOriginalAuthSourceAlgorithm(registrations.subject,2);
 return Object.freeze({subjectKeyVersion:selected.keyVersion});
}
// Unsigned DATA preflight under the SAME original schemas, not Root authority.
// Normal issuer calls before opening role keys and again at each signing fence.
export function inspectOriginalIDEContractRelayIssuanceBodyDATA(role,rootRaw,enrollmentRaw,bodyRaw,policy,registrations,atMs){
 const contract=sourcePolicy(policy);
 if(contract.purpose!==relayPurpose||!['enrollment','profile'].includes(role))fail('IDE_RELAY_ISSUANCE_ROLE_REQUIRED');
 exact(registrations,['root','profile','current','subject']);
 const root=parse(rootRaw,16384);exact(root,['version','algorithmVersion','purpose','rootId','networkId','rootOwner']);
 if(sha(rootRaw)!==policy.rootDigest||root.version!==2||root.algorithmVersion!==suite||root.purpose!==relayPurpose||!token(root.rootId)||!hex(root.networkId)||!owner(root.rootOwner))fail('AUTH_SOURCE_V2_ROOT');
 const body=parse(bodyRaw,65536);
 if(role==='enrollment')originalSourceEnrollmentBodyDATA(root,body,policy,registrations,atMs);
 else{const {enrollment}=verifyOriginalAuthSourceEnrollmentV2(rootRaw,enrollmentRaw,policy,registrations,atMs);originalSourceProfileBodyDATA(root,enrollment,body,enrollmentRaw,policy,registrations,atMs);}
 // The existing verifier validates the dedicated project/peer/launch schema.
 // The issuer must fence its shorter signed project lease BEFORE key entry,
 // not discover expiry only in the post-signature profile verifier.
 const effectExpiresAtMs=role==='profile'?Math.min(body.expiresAtMs,body.selection.contractRelay.expiresMS,body.selection.projectCurrent.expiresMS):body.expiresAtMs;
 return Object.freeze({role,bodySHA256:sha(bodyRaw),effectExpiresAtMs,dataOnly:true,authorized:false,nativeAdmission:false});
}
export function inspectOriginalIDEDeploymentV2IssuanceBodyDATA(role,rootRaw,enrollmentRaw,bodyRaw,policy,registrations,atMs){
 const contract=sourcePolicy(policy);if(![IDE_DEPLOYMENT_V2_SOURCE_PURPOSE,CLOUD_DEPLOYMENT_EXECUTION_V2_PURPOSE,CLOUD_DEPLOYMENT_RECOVERY_V2_PURPOSE].includes(contract.purpose)||!['enrollment','profile'].includes(role))fail('IDE_DEPLOYMENT_V2_ISSUANCE_ROLE_REQUIRED');
 exact(registrations,['root','profile','current','subject']);
 const root=parse(rootRaw,16384);exact(root,['version','algorithmVersion','purpose','rootId','networkId','rootOwner']);
 if(sha(rootRaw)!==policy.rootDigest||root.version!==2||root.algorithmVersion!==suite||root.purpose!==contract.purpose||!token(root.rootId)||!hex(root.networkId)||!owner(root.rootOwner))fail('AUTH_SOURCE_V2_ROOT');
 const body=parse(bodyRaw,65536);
 if(role==='enrollment')originalSourceEnrollmentBodyDATA(root,body,policy,registrations,atMs);
 else{const {enrollment}=verifyOriginalAuthSourceEnrollmentV2(rootRaw,enrollmentRaw,policy,registrations,atMs);originalSourceProfileBodyDATA(root,enrollment,body,enrollmentRaw,policy,registrations,atMs);}
 const special=role==='profile'&&(contract.purpose===CLOUD_DEPLOYMENT_EXECUTION_V2_PURPOSE||contract.purpose===CLOUD_DEPLOYMENT_RECOVERY_V2_PURPOSE),field=contract.purpose===CLOUD_DEPLOYMENT_EXECUTION_V2_PURPOSE?'cloudDeploymentExecutionV2':'cloudDeploymentRecoveryV2';
 const effectExpiresAtMs=special?(contract.purpose===CLOUD_DEPLOYMENT_EXECUTION_V2_PURPOSE?inspectOriginalCloudDeploymentExecutionV2ScopeDATA:inspectOriginalCloudDeploymentRecoveryV2ScopeDATA)(body.selection[field],body.selection.association,root.networkId,body.subjectOwner,body.sourceId,body.instanceId,body.generation,body.issuedAtMs,body.expiresAtMs,atMs).effectExpiresAtMs:role==='profile'?Math.min(body.expiresAtMs,...['publisherOriginal','issuerOriginal','projectOriginal','resourceOriginal','approvalOriginal'].map(k=>parse(body.selection.ideDeploymentV2[k],32768).expiresAtMs)):body.expiresAtMs;
 return Object.freeze({role,bodySHA256:sha(bodyRaw),effectExpiresAtMs,dataOnly:true,authorized:false,nativeAdmission:false});
}
export function verifyOriginalAuthSourceEnrollmentV2(rootRaw,enrollmentRaw,policy,registrations,atMs){
 const contract=sourcePolicy(policy);
 const pqCatalog=contract.purpose===PQ_HOST_CATALOG_SOURCE_PURPOSE,device=deviceFamily(contract.purpose);
 const relay=contract.purpose===relayPurpose,projectAuthority=contract.purpose===projectPurpose,control=contract.purpose===controlPurpose,publication=contract.purpose===ORIGINAL_IDE_APPROVAL_SOURCE_PURPOSE,execution=contract.purpose===CLOUD_DEPLOYMENT_EXECUTION_V2_PURPOSE,recovery=contract.purpose===CLOUD_DEPLOYMENT_RECOVERY_V2_PURPOSE,deployment=contract.purpose===IDE_DEPLOYMENT_V2_SOURCE_PURPOSE,expectedOps=execution?CLOUD_DEPLOYMENT_EXECUTION_V2_OPERATIONS:recovery?CLOUD_DEPLOYMENT_RECOVERY_V2_OPERATIONS:deployment?IDE_DEPLOYMENT_V2_OPERATIONS:device?deviceOperations(contract.purpose):pqCatalog?PQ_HOST_CATALOG_SOURCE_OPERATIONS:relay?relayOps:projectAuthority?projectOps:control?controlOps:publication?publicationOps:ops;
 exact(registrations,['root','profile','current','subject']);
 if(sha(rootRaw)!==policy.rootDigest||sha(enrollmentRaw)!==policy.enrollmentDigest)fail('AUTH_SOURCE_V2_NOT_PINNED');
 const root=parse(rootRaw,16384);exact(root,['version','algorithmVersion','purpose','rootId','networkId','rootOwner']);
 if(root.version!==2||root.algorithmVersion!==suite||root.purpose!==contract.purpose||!token(root.rootId)||!hex(root.networkId)||!owner(root.rootOwner))fail('AUTH_SOURCE_V2_ROOT');
 // Root authority is the independently pinned original, NOT certificate keys.
 const enrollment=envelope(enrollmentRaw,'enrollment',contract.enrollmentFrame,registrations.root,root.networkId,root.rootOwner);
 const e=enrollment.body;
 originalSourceEnrollmentBodyDATA(root,e,policy,registrations,atMs);
 return seal({root,enrollment:e,enrollmentBinding:enrollment.binding,executionHeight:registrations.root.executionHeight,dataOnly:true,nativeAdmission:false});
}
export function verifyOriginalAuthSourceProfileV2(rootRaw,enrollmentRaw,profileRaw,policy,registrations,atMs,networkOriginals){
 const contract=sourcePolicy(policy),pqCatalog=contract.purpose===PQ_HOST_CATALOG_SOURCE_PURPOSE,device=deviceFamily(contract.purpose);
 const relay=contract.purpose===relayPurpose,projectAuthority=contract.purpose===projectPurpose,control=contract.purpose===controlPurpose,publication=contract.purpose===ORIGINAL_IDE_APPROVAL_SOURCE_PURPOSE,execution=contract.purpose===CLOUD_DEPLOYMENT_EXECUTION_V2_PURPOSE,recovery=contract.purpose===CLOUD_DEPLOYMENT_RECOVERY_V2_PURPOSE,deployment=contract.purpose===IDE_DEPLOYMENT_V2_SOURCE_PURPOSE,expectedOps=execution?CLOUD_DEPLOYMENT_EXECUTION_V2_OPERATIONS:recovery?CLOUD_DEPLOYMENT_RECOVERY_V2_OPERATIONS:deployment?IDE_DEPLOYMENT_V2_OPERATIONS:device?deviceOperations(contract.purpose):pqCatalog?PQ_HOST_CATALOG_SOURCE_OPERATIONS:relay?relayOps:projectAuthority?projectOps:control?controlOps:publication?publicationOps:ops;
 const {root,enrollment:e,enrollmentBinding}=verifyOriginalAuthSourceEnrollmentV2(rootRaw,enrollmentRaw,policy,registrations,atMs);
 const profile=envelope(profileRaw,'profile',contract.profileFrame,registrations.profile,root.networkId,e.profileOwner),p=profile.body;
 const {subjectKeyVersion,agentPublic,effectExpiresAtMs}=originalSourceProfileBodyDATA(root,e,p,enrollmentRaw,policy,registrations,atMs,networkOriginals);
 return Object.freeze({root,enrollment:e,profile:p,executionHeight:registrations.root.executionHeight,credentialIssuedHeights:Object.freeze({enrollment:enrollmentBinding.executionHeight,profile:profile.binding.executionHeight}),subjectKeyVersion,...([WM_PURPOSE,NR_PURPOSE,NPR_PURPOSE].includes(contract.purpose)?{effectExpiresAtMs}:{}),...(contract.purpose===AI_PURPOSE&&agentPublic?{agentPublic}:{}),dataOnly:true,nativeAdmission:false});
}
function verifyPublicationAuthority(s,p,e,root,registrations,at){
 const a=s.publicationApprovalAuthority;exact(a,['scopeOriginal','principal','publisherOriginal','callerIdentity']);
 const scope=inspectOriginalIDEApprovalScopeDATA(a.scopeOriginal),principal=encodeOriginalDeveloperPrincipalDATA(a.principal);
 if(scope.sourceId!==p.sourceId||scope.instanceId!==p.instanceId||scope.generation!==String(p.generation)||scope.principalSHA256!==principal.principalSHA256||scope.account!==a.principal.account||scope.deviceId!==a.principal.deviceId||scope.account!==s.association.account||scope.deviceId!==s.association.deviceId||scope.expiresAtMs>p.expiresAtMs||scope.expiresAtMs>e.expiresAtMs||BigInt(a.principal.expiresMS)<=BigInt(at)||BigInt(scope.expiresAtMs)>BigInt(a.principal.expiresMS)||a.callerIdentity!==scope.callerIdentity)fail('AUTH_SOURCE_V2_PUBLICATION_SCOPE');
 const peer=s.identityPeerBinding;exact(peer,['walletCodeIdentity','ideCodeIdentity','nodeCodeIdentity','nodeSHA256','entrySHA256','provenanceSHA256']);
 for(const k of ['walletCodeIdentity','ideCodeIdentity','nodeCodeIdentity'])if(typeof peer[k]!=='string'||!peer[k]||peer[k].length>1024||/[\x00-\x1f\x7f]/.test(peer[k]))fail('AUTH_SOURCE_V2_PUBLICATION_CALLER');
 for(const k of ['nodeSHA256','entrySHA256','provenanceSHA256'])if(!hex(peer[k]))fail('AUTH_SOURCE_V2_PUBLICATION_CALLER');if(a.callerIdentity!==peer.nodeCodeIdentity)fail('AUTH_SOURCE_V2_PUBLICATION_CALLER');
 let raw;try{raw=pqDecodeBase64url(a.publisherOriginal,{max:8192});if(!raw.length||pqBase64url(raw)!==a.publisherOriginal)fail('AUTH_SOURCE_V2_PUBLICATION_PUBLISHER');}catch{fail('AUTH_SOURCE_V2_PUBLICATION_PUBLISHER');}
 const publisher=inspectIDEArtifactPublisherPublicOriginalData(new Uint8Array(raw));if(sha(Buffer.from(raw))!==scope.publisherPublicSHA256||publisher.networkId!==root.networkId||publisher.subjectOwner!==p.subjectOwner||publisher.account!==scope.account||publisher.projectId!==scope.projectId||publisher.publisherId!==scope.publisherId||publisher.publisherKeyVersion!==scope.publisherKeyVersion)fail('AUTH_SOURCE_V2_PUBLICATION_PUBLISHER');
 for(const role of ['root','profile','current','subject']){const record=inspectPQAuthorizationView(registrations[role]).activeRecord;if(!record||record.pkA===Buffer.from(publisher.pkA).toString('hex')||record.pkB===Buffer.from(publisher.pkB).toString('hex'))fail('AUTH_SOURCE_V2_PUBLICATION_ROLE_COLLISION');}
}
function verifyProjectSelection(s,profile,at){
 const d=s.projectSelection,a=s.projectAuthority;
 exact(d,['version','projectId','publisherId','projectRevision','catalogRevision','localProjectId','workspace','profile','node','expiresMS']);
 if(d.version!=='YNX-IDE-WORKSPACE-PROJECT-SELECTION/v1'||d.projectId!==a.project.projectId||d.projectRevision!==a.project.projectRevision||d.catalogRevision!==a.project.catalogRevision||d.publisherId!==(a.publisher===null?null:a.publisher.publisherId)||typeof d.localProjectId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(d.localProjectId))fail('AUTH_SOURCE_V2_PROJECT_SELECTION_BINDING');
 if(!integer(d.expiresMS)||d.expiresMS<=at||d.expiresMS>profile.expiresAtMs||d.expiresMS>a.principal.expiresMS||d.expiresMS>a.project.expiresMS||(a.publisher!==null&&d.expiresMS>a.publisher.expiresMS))fail('AUTH_SOURCE_V2_PROJECT_SELECTION_EXPIRED');
 for(const k of ['workspace','profile']){const p=d[k];exact(p,['path','device','inode']);
  if(!absolute(p.path)||p.path==='/'||!p.path.isWellFormed()||p.path.endsWith('/')||p.path.includes('//')||p.path.includes('\\')||/[\x00-\x1f\x7f]/.test(p.path)||Buffer.byteLength(p.path)>4096)fail('AUTH_SOURCE_V2_PROJECT_SELECTION_DIRECTORY');decimal(p.device);decimal(p.inode,true);
 }
 exact(d.node,['pid','parent','uid','gid','startSeconds','startMicros']);for(const k of ['pid','parent','uid','gid','startSeconds','startMicros'])decimal(d.node[k],['pid','parent','startSeconds'].includes(k));
 if(BigInt(d.node.pid)<=1n||BigInt(d.node.parent)<=1n||BigInt(d.node.startMicros)>999999n)fail('AUTH_SOURCE_V2_PROJECT_SELECTION_PROCESS');
}
function verifyProjectAuthority(s,profile,enrollment,root,registrations,at){
 const a=s.projectAuthority;exact(a,['principal','project','publisher','endpoint','spki']);const p=a.principal,j=a.project,k=a.publisher;
 exact(p,['account','deviceId','sessionRef','currentRef','accountGeneration','sessionGeneration','expiresMS']);
 exact(j,['projectId','ownerAccount','runtimeOrigin','currentReference','projectRevision','catalogRevision','read','publish','runtime','expiresMS']);
 if(k!==null)exact(k,['account','projectId','publisherId','keyRole','publicOriginal','publicSHA256','registrationRef','revision','expiresMS','revoked']);
 const text=x=>typeof x==='string'&&x.length>0&&Buffer.byteLength(x)<=256&&!/[\x00-\x20\x7f\ud800-\udfff]/u.test(x)&&x.trim()===x;
 for(const key of ['account','deviceId','sessionRef','currentRef'])if(!text(p[key]))fail('AUTH_SOURCE_V2_PROJECT_PRINCIPAL');
 for(const key of ['projectId','ownerAccount','currentReference'])if(!text(j[key]))fail('AUTH_SOURCE_V2_PROJECT_CURRENT');
 if(k!==null)for(const key of ['account','projectId','publisherId','registrationRef'])if(!text(k[key]))fail('AUTH_SOURCE_V2_PROJECT_PUBLISHER');
 for(const key of ['accountGeneration','sessionGeneration'])decimal(p[key],true);for(const key of ['projectRevision','catalogRevision'])decimal(j[key],true);if(k!==null)decimal(k.revision,true);
 const origin=(value,empty=false)=>{if(empty&&value==='')return true;try{const u=new URL(value);return typeof value==='string'&&u.protocol==='https:'&&!!u.hostname&&!u.username&&!u.password&&!u.search&&!u.hash&&(u.pathname==='/'||u.pathname==='')&&u.origin===value;}catch{return false;}};
 let endpoint;try{endpoint=new URL(a.endpoint);}catch{fail('AUTH_SOURCE_V2_PROJECT_ENDPOINT');}
 if(typeof a.endpoint!=='string'||a.endpoint!==endpoint.href||endpoint.protocol!=='https:'||!endpoint.hostname||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||!hex(a.spki)||!origin(j.runtimeOrigin,true))fail('AUTH_SOURCE_V2_PROJECT_ENDPOINT');
 if(['read','publish','runtime'].some(key=>typeof j[key]!=='boolean')||(!j.read&&!j.publish&&!j.runtime)||p.account!==s.association.account||p.deviceId!==s.association.deviceId||(k!==null&&(k.revoked!==false||k.keyRole!=='ide-artifact-publisher'||!hex(k.publicSHA256)||k.account!==p.account||k.projectId!==j.projectId)))fail('AUTH_SOURCE_V2_PROJECT_BINDING');
 for(const row of k===null?[p,j]:[p,j,k])if(!integer(row.expiresMS)||row.expiresMS<=at||row.expiresMS>Math.min(profile.expiresAtMs,enrollment.expiresAtMs))fail('AUTH_SOURCE_V2_PROJECT_EXPIRED');
 if(k===null)return; // Project access may predate a registered purpose key.
 let raw,r13;try{raw=pqDecodeBase64url(k.publicOriginal,{max:8192});r13=inspectIDEArtifactPublisherPublicOriginalData(raw);}catch{fail('AUTH_SOURCE_V2_PROJECT_R13');}
 const record=active(registrations.subject,root.networkId,profile.subjectOwner,registrations.root.executionHeight);
 if(sha(raw)!==k.publicSHA256||r13.networkId!==root.networkId||r13.subjectOwner!==profile.subjectOwner||r13.account!==p.account||r13.projectId!==j.projectId||r13.publisherId!==k.publisherId)fail('AUTH_SOURCE_V2_PROJECT_REGISTERED_PUBLISHER');
 // R13 is an independently registered purpose key, NOT the native account
 // signing key/revision. Its exact original+registrationRef/revision is bound
 // by the dedicated protected project-authority Source profile. Never force
 // account-key reuse or pretend account registration registers a publisher.
 const pkA=Buffer.from(r13.pkA).toString('hex'),pkB=Buffer.from(r13.pkB).toString('hex');
 for(const [snapshot,id]of [[registrations.root,root.rootOwner],[registrations.profile,enrollment.profileOwner],[registrations.current,enrollment.currentOwner],[registrations.subject,profile.subjectOwner]]){const other=active(snapshot,root.networkId,id,registrations.root.executionHeight);if(pkA===other.pkA||pkB===other.pkB||(snapshot!==registrations.subject&&(record.pkA===other.pkA||record.pkB===other.pkB)))fail('AUTH_SOURCE_V2_PROJECT_PUBLISHER_ROLE_COLLISION');}
}
function verifySourceCurrentV2(rootRaw,enrollmentRaw,profileRaw,currentRaw,policy,registrations,expectedNonce,previous,atMs,historical,networkOriginals){
 const verified=verifyOriginalAuthSourceProfileV2(rootRaw,enrollmentRaw,profileRaw,policy,registrations,atMs,networkOriginals),contract=sourcePolicy(policy);
 exact(previous,['sequence','floor','head','timeFloor','executionHeight']);
 if(decimal(previous.executionHeight)>decimal(verified.executionHeight))fail('AUTH_SOURCE_V2_OBSERVATION_ROLLBACK');
 if(!integer(previous.sequence)||!integer(previous.floor)||!integer(previous.timeFloor)||!(previous.head===''||hex(previous.head))||atMs<previous.timeFloor)fail('AUTH_SOURCE_V2_ROLLBACK');
 const current=envelope(currentRaw,'current',contract.currentFrame,registrations.current,verified.root.networkId,verified.enrollment.currentOwner,historical),c=current.body,p=verified.profile;
 exact(c,['version','purpose','sourceId','enrollmentDigest','profileDigest','instanceId','generation','subjectOwner','subjectKeyVersion','sequence','floor','head','status','nonce','issuedAtMs','expiresAtMs']);
 if(c.version!==2||c.purpose!==contract.purpose||c.sourceId!==p.sourceId||c.enrollmentDigest!==policy.enrollmentDigest||c.profileDigest!==sha(profileRaw)||c.instanceId!==p.instanceId||c.generation!==p.generation||c.subjectOwner!==p.subjectOwner||c.subjectKeyVersion!==verified.subjectKeyVersion||(!historical&&current.binding.executionHeight!==verified.executionHeight)||!integer(c.sequence)||c.sequence<Math.max(p.minimumSequence,previous.sequence)||!integer(c.floor)||c.floor<Math.max(p.minimumFloor,previous.floor)||c.floor>c.sequence||!hex(c.head)||c.nonce!==expectedNonce||typeof expectedNonce!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(expectedNonce)||!['active','revoked','retired'].includes(c.status))fail('AUTH_SOURCE_V2_CURRENT');
 if(c.sequence===previous.sequence&&previous.head&&c.head!==previous.head)fail('AUTH_SOURCE_V2_EQUIVOCATION');
 if(historical&&(!integer(atMs)||atMs<c.issuedAtMs))fail('AUTH_SOURCE_V2_EXPIRED');
 window(c,historical?c.issuedAtMs:atMs,30000);if(c.expiresAtMs>Math.min(p.expiresAtMs,verified.enrollment.expiresAtMs))fail('AUTH_SOURCE_V2_EXPIRED');
 if([CLOUD_DEPLOYMENT_EXECUTION_V2_PURPOSE,CLOUD_DEPLOYMENT_RECOVERY_V2_PURPOSE].includes(contract.purpose)&&c.head!==sha(canonical(p.selection[contract.purpose===CLOUD_DEPLOYMENT_EXECUTION_V2_PURPOSE?'cloudDeploymentExecutionV2':'cloudDeploymentRecoveryV2'])))fail('DEPLOYMENT_EXECUTION_V2_CURRENT_HEAD');
 if([NR_PURPOSE,NPR_PURPOSE].includes(contract.purpose)&&(c.head!==sha(canonical(p.selection[contract.purpose===NPR_PURPOSE?NPR_KEY:NR_KEY]))||c.expiresAtMs>verified.effectExpiresAtMs))fail('NETWORK_RESOURCE_SOURCE_CURRENT_HEAD_OR_WINDOW');
 if(contract.purpose===WM_PURPOSE&&(c.head!==sha(canonical(p.selection[WM_KEY]))||c.expiresAtMs>verified.effectExpiresAtMs))fail('MOBILE_SOURCE_CURRENT_HEAD_OR_WINDOW');
 if(contract.purpose===NCP_PURPOSE&&c.head!==sha(canonical(p.selection[NCP_KEY])))fail('NETWORK_PUBLISHER_SOURCE_CURRENT_HEAD');
 if(contract.purpose===IDE_DEPLOYMENT_V2_SOURCE_PURPOSE&&c.head!==sha(canonical(p.selection.ideDeploymentV2)))fail('IDE_DEPLOYMENT_V2_CURRENT_HEAD');
 if(contract.purpose===AI_PURPOSE){const data=inspectOriginalAITaskActionV6SourceScopeDATA(p.selection[AI_KEY],p.selection.association,verified.root.networkId,p.subjectOwner,p.sourceId,p.instanceId,p.issuedAtMs,p.expiresAtMs,atMs);if(c.head!==sha(canonical(p.selection[AI_KEY])))fail('AI_TASK_SOURCE_CURRENT_HEAD');if(c.expiresAtMs>data.effectExpiresAtMs)fail('AI_TASK_SOURCE_CURRENT_WINDOW');}
 if(contract.purpose===TLS_PURPOSE){const data=inspectOriginalServerTLSIdentityScopeV1DATA(p.selection[TLS_KEY],p.selection.association,verified.root.networkId,p.subjectOwner,p.sourceId,p.instanceId,p.issuedAtMs,p.expiresAtMs,atMs);if(c.head!==data.scopeHead||c.expiresAtMs>data.effectExpiresAtMs)fail('SERVER_TLS_SOURCE_CURRENT_HEAD_OR_WINDOW');}
 if(contract.purpose===DGA_PURPOSE){const data=inspectOriginalDesktopGrantAuthorityScopeV1DATA(p.selection[DGA_KEY],p.selection.association,verified.root.networkId,p.subjectOwner,p.sourceId,p.instanceId,p.issuedAtMs,p.expiresAtMs,atMs);if(c.head!==data.scopeHead||c.expiresAtMs>data.effectExpiresAtMs)fail('DESKTOP_GRANT_SOURCE_CURRENT_HEAD_OR_WINDOW');}
 if(contract.purpose===WPR_PURPOSE){const data=inspectOriginalWalletProductScopeV1DATA(p.selection[WPR_KEY],verified.root.networkId,p.subjectOwner,p.issuedAtMs,p.expiresAtMs,atMs);if(c.head!==sha(data.scopeOriginal))fail('WALLET_PRODUCT_SOURCE_CURRENT_HEAD');if(c.expiresAtMs>data.effectExpiresAtMs)fail('WALLET_PRODUCT_SOURCE_CURRENT_WINDOW');}
 if(contract.purpose===BROWSER_PURPOSE){const data=inspectOriginalBrowserSelectedPagesScopeV1DATA(p.selection[BROWSER_KEY],p.selection.association,verified.root.networkId,p.subjectOwner,p.sourceId,p.instanceId,p.issuedAtMs,p.expiresAtMs,atMs);if(c.head!==sha(data.scopeOriginal))fail('BROWSER_SELECTED_PAGES_SOURCE_CURRENT_HEAD');if(c.expiresAtMs>data.effectExpiresAtMs)fail('BROWSER_SELECTED_PAGES_SOURCE_CURRENT_WINDOW');}
 if(contract.purpose===WPC_PURPOSE){const data=inspectOriginalWalletPayClientScopeV1DATA(p.selection[WPC_KEY],verified.root.networkId,p.subjectOwner,p.issuedAtMs,p.expiresAtMs,atMs);if(c.head!==sha(data.scopeOriginal))fail('WALLET_PAY_CLIENT_SOURCE_CURRENT_HEAD');if(c.expiresAtMs>data.effectExpiresAtMs)fail('WALLET_PAY_CLIENT_SOURCE_CURRENT_WINDOW');}
 if(contract.purpose===PAY_PURPOSE){if(c.head!==sha(canonical(p.selection[PAY_KEY])))fail('PAY_SOURCE_CURRENT_MAPPING_HEAD');if(c.expiresAtMs>inspectOriginalPayCloudBillMappingV1DATA(p.selection[PAY_KEY],verified.root.networkId,p.subjectOwner,p.expiresAtMs,atMs).effectExpiresAtMs)fail('PAY_SOURCE_CURRENT_WINDOW');}
 if(contract.purpose===controlPurpose&&(c.head!==sha(canonical(p.selection.projectControlCapture))||BigInt(c.expiresAtMs)>BigInt(p.selection.projectControlCapture.expiresAtMs)))fail('AUTH_SOURCE_V2_CONTROL_CAPTURE_HEAD');
 if(contract.purpose===PQ_HOST_CATALOG_SOURCE_PURPOSE&&(c.head!==sha(canonical(p.selection.pqHostCatalogSource))||c.expiresAtMs>p.selection.pqHostCatalogSource.expiresAtMs))fail('AUTH_SOURCE_V2_PQ_CATALOG_HEAD');
 if(contract.purpose===PRODUCT_DEVICE_V4_SOURCE_PURPOSE&&c.head!==sha(canonical(p.selection.productSessionDeviceV4)))fail('AUTH_SOURCE_V2_DEVICE_HEAD');
 if(contract.purpose===PRODUCT_DEVICE_V4_PROVISIONING_PURPOSE&&c.head!==sha(canonical(p.selection.productSessionDeviceV4Provisioning)))fail('AUTH_SOURCE_V2_DEVICE_PROVISIONING_HEAD');
 if(contract.purpose===PRODUCT_DEVICE_V4_QUERY_PURPOSE&&c.head!==sha(canonical(p.selection.productSessionDeviceV4Query)))fail('AUTH_SOURCE_V2_DEVICE_QUERY_HEAD');
 if(contract.purpose===PRODUCT_DEVICE_V4_PENDING_PURPOSE&&c.head!==sha(canonical(p.selection.productSessionDeviceV4Pending)))fail('AUTH_SOURCE_V2_DEVICE_PENDING_HEAD');
 if(contract.purpose===PRODUCT_DEVICE_V4_REGISTERED_FINALIZATION_PURPOSE&&c.head!==sha(canonical(p.selection.productSessionDeviceV4RegisteredFinalization)))fail('AUTH_SOURCE_V2_DEVICE_REGISTERED_FINALIZATION_HEAD');
 if(contract.purpose===PRODUCT_SESSION_HTTP_PROOF_V5_SOURCE_PURPOSE&&c.head!==sha(canonical(p.selection.productSessionHTTPProofV5)))fail('AUTH_SOURCE_V2_HTTP_V5_HEAD');
 if(!historical&&c.status!=='active')fail('AUTH_SOURCE_V2_REVOKED');
 return seal({...(Object.hasOwn(p.selection,'runtimeImageBindingV1')?{runtimeImageBindingV1DATA:inspectOriginalAuthRuntimeImageBindingV1DATA(p.selection.runtimeImageBindingV1,p.purpose).runtimeImageBindingV1}:{}),...(contract.purpose===AI_PURPOSE&&verified.agentPublic?{agentPublic:verified.agentPublic}:{}),selection:p.selection,principalId:contract.purpose===WM_PURPOSE?p.selection[WM_KEY].context.account:p.selection.association.account,subjectOwner:p.subjectOwner,subjectKeyVersion:c.subjectKeyVersion,generation:p.generation,sequence:c.sequence,floor:c.floor,head:c.head,status:c.status,timeFloor:atMs,expiresAtMs:Math.min(p.expiresAtMs,c.expiresAtMs,verified.enrollment.expiresAtMs),profileDigest:sha(profileRaw),sourceId:p.sourceId,instanceId:p.instanceId,executionHeight:verified.executionHeight,...(historical?{statementExecutionHeight:current.binding.executionHeight,historical:true}:{}),dataOnly:true,nativeAdmission:false});
}

/** Fresh nonce/current admission DATA. Historical heads never satisfy this API. */
export function verifyOriginalAuthSourceCurrentV2(rootRaw,enrollmentRaw,profileRaw,currentRaw,policy,registrations,expectedNonce,previous,atMs,networkOriginals){
 if(arguments.length!==([NR_PURPOSE,NPR_PURPOSE].includes(policy?.signatureContract?.purpose)?10:9))fail('AUTH_SOURCE_V2_ARGUMENTS');
 return verifySourceCurrentV2(rootRaw,enrollmentRaw,profileRaw,currentRaw,policy,registrations,expectedNonce,previous,atMs,false,networkOriginals);
}
/** Historical signature/rollback baseline DATA only. Still requires currently
 * valid pinned profile and independent current same-height registered full pairs.
 * Expired current heads and terminal statuses are retained, never treated as
 * latest authority. Native must retain terminal state and fetch fresh nonce
 * current before any admission; extract only the five Previous fields. */
export function verifyOriginalAuthSourceTransitionV2(rootRaw,enrollmentRaw,profileRaw,currentRaw,policy,registrations,expectedNonce,previous,atMs,networkOriginals){
 if(arguments.length!==([NR_PURPOSE,NPR_PURPOSE].includes(policy?.signatureContract?.purpose)?10:9))fail('AUTH_SOURCE_V2_ARGUMENTS');
 return verifySourceCurrentV2(rootRaw,enrollmentRaw,profileRaw,currentRaw,policy,registrations,expectedNonce,previous,atMs,true,networkOriginals);
}

// Full original enrollment/profile/current mathematics and independent actual
// build-facts expectation. This DATA result is never a preload/Source grant.
export function verifyOriginalAuthSourceRuntimeImageBindingCurrentV1DATA(rootRaw,enrollmentRaw,profileRaw,currentRaw,policy,registrations,expectedNonce,previous,atMs,expectedRuntimeImageBindingV1){
 const current=verifyOriginalAuthSourceCurrentV2(rootRaw,enrollmentRaw,profileRaw,currentRaw,policy,registrations,expectedNonce,previous,atMs);
 const expected=inspectOriginalAuthRuntimeImageBindingV1DATA(expectedRuntimeImageBindingV1,policy.signatureContract.purpose).runtimeImageBindingV1;
 if(!Object.hasOwn(current,'runtimeImageBindingV1DATA'))fail('AUTH_RUNTIME_IMAGE_BINDING_V1_NOT_SUPPLIED');
 if(canonical(current.runtimeImageBindingV1DATA)!==canonical(expected))fail('AUTH_RUNTIME_IMAGE_BINDING_V1_EXPECTED_MISMATCH');
 return seal({runtimeImageBindingV1DATA:current.runtimeImageBindingV1DATA,profileDigest:current.profileDigest,currentDigest:sha(currentRaw),sourceId:current.sourceId,instanceId:current.instanceId,generation:current.generation,sequence:current.sequence,expiresAtMs:current.expiresAtMs,dataOnly:true,SourceAdmission:false,NativeAdmission:false,preLoadQualified:false,sameModuleInstanceVerified:false});
}

function payEnrollmentBodyDATA(root,e,policy,registrations,atMs,wallet=false){
 const browser=policy.signatureContract.purpose===BROWSER_PURPOSE,product=policy.signatureContract.purpose===WPR_PURPOSE,purpose=browser?BROWSER_PURPOSE:product?WPR_PURPOSE:wallet?WPC_PURPOSE:PAY_PURPOSE,operations=browser?BROWSER_OPS:product?(canonical(e.operations)===canonical(WPR_LEGACY_OPS)?WPR_LEGACY_OPS:WPR_OPS):wallet?WPC_OPS:PAY_OPS;
 exact(e,['version','purpose','rootId','rootOwner','sourceId','service','productId','platform','applicationId','gatewayOrigin','registryDigest','profileOwner','currentOwner','endpoint','spki','currentStatePath','operations','issuedAtMs','expiresAtMs']);
 if(e.version!==2||e.purpose!==purpose||root.purpose!==purpose||e.rootId!==root.rootId||e.rootOwner!==root.rootOwner||!token(e.sourceId)||!owner(e.profileOwner)||!owner(e.currentOwner)||new Set([root.rootOwner,e.profileOwner,e.currentOwner]).size!==3||e.service!==purpose||e.productId!==policy.productId||e.platform!==policy.platform||e.applicationId!==policy.applicationId||e.gatewayOrigin!=='https://wallet-auth.ynxweb4.com'||!hex(e.registryDigest)||e.endpoint!==policy.endpoint||e.spki!==policy.spki||!absolute(e.currentStatePath)||canonical(e.operations)!==canonical(operations))fail('PAY_SOURCE_ENROLLMENT_BODY');
 window(e,atMs,86400000);const height=registrations.root.executionHeight,records=[active(registrations.root,root.networkId,root.rootOwner,height),active(registrations.profile,root.networkId,e.profileOwner,height),active(registrations.current,root.networkId,e.currentOwner,height)];for(let i=0;i<records.length;i++)for(let j=0;j<i;j++)if(records[i].pkA===records[j].pkA||records[i].pkB===records[j].pkB)fail('AUTH_SOURCE_V2_KEYS_NOT_DISTINCT');
}
function payProfileBodyDATA(root,e,p,enrollmentRaw,policy,registrations,atMs,wallet=false){
 const browser=policy.signatureContract.purpose===BROWSER_PURPOSE,product=policy.signatureContract.purpose===WPR_PURPOSE,purpose=browser?BROWSER_PURPOSE:product?WPR_PURPOSE:wallet?WPC_PURPOSE:PAY_PURPOSE,operations=browser?BROWSER_OPS:product?(canonical(e.operations)===canonical(WPR_LEGACY_OPS)?WPR_LEGACY_OPS:WPR_OPS):wallet?WPC_OPS:PAY_OPS,key=browser?BROWSER_KEY:product?WPR_KEY:wallet?WPC_KEY:PAY_KEY;
 exact(p,['version','purpose','sourceId','enrollmentDigest','instanceId','generation','minimumSequence','minimumFloor','subjectOwner','selection','issuedAtMs','expiresAtMs']);
 if(p.version!==2||p.purpose!==purpose||p.sourceId!==e.sourceId||p.enrollmentDigest!==sha(enrollmentRaw)||!token(p.instanceId)||!integer(p.generation)||p.generation<1||!integer(p.minimumSequence)||p.minimumSequence<1||!integer(p.minimumFloor)||p.minimumFloor>p.minimumSequence||!owner(p.subjectOwner))fail('PAY_SOURCE_PROFILE');window(p,atMs,86400000);if(p.issuedAtMs<e.issuedAtMs||p.expiresAtMs>e.expiresAtMs)fail('AUTH_SOURCE_V2_EXPIRED');
 const s=p.selection,hasRuntimeImageBinding=Object.hasOwn(s,'runtimeImageBindingV1');exact(s,['association','expectedRequest','originalHostStatePath','originalHostTerminalDirectory',key,...(hasRuntimeImageBinding?['runtimeImageBindingV1']:[])]);if(hasRuntimeImageBinding){if(!product)fail('AUTH_RUNTIME_IMAGE_BINDING_V1_PURPOSE');inspectOriginalAuthRuntimeImageBindingV1DATA(s.runtimeImageBindingV1,purpose)}const a=s.association;exact(a,['account','clientId','productId','platform','applicationId','deviceId']);if(Object.values(a).some(v=>typeof v!=='string'||!v||!v.isWellFormed()||Buffer.byteLength(v)>512)||a.account!==p.subjectOwner||a.productId!==e.productId||a.platform!==e.platform||a.applicationId!==e.applicationId)fail('PAY_SOURCE_ASSOCIATION');
 const r=s.expectedRequest;exact(r,['service','productId','platform','applicationId','gatewayOrigin','registryDigest','operations','instanceId']);if(r.service!==e.service||r.productId!==e.productId||r.platform!==e.platform||r.applicationId!==e.applicationId||r.gatewayOrigin!==e.gatewayOrigin||r.registryDigest!==e.registryDigest||canonical(r.operations)!==canonical(operations)||r.instanceId!==p.instanceId||!absolute(s.originalHostStatePath)||s.originalHostTerminalDirectory!==s.originalHostStatePath+'.private-terminal')fail('PAY_SOURCE_REQUEST');
 const data=browser?inspectOriginalBrowserSelectedPagesScopeV1DATA(s[key],a,root.networkId,p.subjectOwner,p.sourceId,p.instanceId,p.issuedAtMs,p.expiresAtMs,atMs):product?inspectOriginalWalletProductScopeV1DATA(s[key],root.networkId,p.subjectOwner,p.issuedAtMs,p.expiresAtMs,atMs):wallet?inspectOriginalWalletPayClientScopeV1DATA(s[key],root.networkId,p.subjectOwner,p.issuedAtMs,p.expiresAtMs,atMs):inspectOriginalPayCloudBillMappingV1DATA(s[key],root.networkId,p.subjectOwner,p.expiresAtMs,atMs),height=registrations.root.executionHeight,subject=active(registrations.subject,root.networkId,p.subjectOwner,height);for(const [view,id]of[[registrations.root,root.rootOwner],[registrations.profile,e.profileOwner],[registrations.current,e.currentOwner]]){const other=active(view,root.networkId,id,height);if(subject.pkA===other.pkA||subject.pkB===other.pkB)fail('PAY_SOURCE_SUBJECT_ROLE_COLLISION');}if(product&&data.scope.operations.some(op=>!e.operations.includes(op)))fail('WALLET_PRODUCT_SOURCE_ENROLLMENT_OPERATION_NOT_GRANTED');return Object.freeze({subjectKeyVersion:selectOriginalAuthSourceAlgorithm(registrations.subject,2).keyVersion,effectExpiresAtMs:data.effectExpiresAtMs});
}
export function inspectOriginalPayCloudBillSourceIssuanceBodyDATA(role,rootRaw,enrollmentRaw,bodyRaw,policy,registrations,atMs){
 const contract=sourcePolicy(policy);if(contract.purpose!==PAY_PURPOSE||!['enrollment','profile'].includes(role))fail('PAY_SOURCE_ISSUANCE_ROLE_REQUIRED');exact(registrations,['root','profile','current','subject']);const root=parse(rootRaw,16384);exact(root,['version','algorithmVersion','purpose','rootId','networkId','rootOwner']);if(sha(rootRaw)!==policy.rootDigest||root.version!==2||root.algorithmVersion!==suite||root.purpose!==PAY_PURPOSE||!token(root.rootId)||!hex(root.networkId)||!owner(root.rootOwner))fail('AUTH_SOURCE_V2_ROOT');const body=parse(bodyRaw,65536);let effectExpiresAtMs=body.expiresAtMs;if(role==='enrollment')payEnrollmentBodyDATA(root,body,policy,registrations,atMs);else{const v=verifyOriginalAuthSourceEnrollmentV2(rootRaw,enrollmentRaw,policy,registrations,atMs);effectExpiresAtMs=payProfileBodyDATA(root,v.enrollment,body,enrollmentRaw,policy,registrations,atMs).effectExpiresAtMs;}return Object.freeze({role,bodySHA256:sha(bodyRaw),effectExpiresAtMs,dataOnly:true,authorized:false,nativeAdmission:false});
}

function aiEnrollmentBodyDATA(root,e,policy,registrations,atMs){
 exact(e,['version','purpose','rootId','rootOwner','sourceId','service','productId','platform','applicationId','gatewayOrigin','registryDigest','profileOwner','currentOwner','endpoint','spki','currentStatePath','operations','issuedAtMs','expiresAtMs','sourceRole']);
 if(e.version!==2||e.sourceRole!==policy.sourceRole||e.purpose!==AI_PURPOSE||root.purpose!==AI_PURPOSE||e.rootId!==root.rootId||e.rootOwner!==root.rootOwner||!token(e.sourceId)||!owner(e.profileOwner)||!owner(e.currentOwner)||new Set([root.rootOwner,e.profileOwner,e.currentOwner]).size!==3||e.service!==AI_PURPOSE||e.productId!==policy.productId||e.platform!==policy.platform||e.applicationId!==policy.applicationId||e.gatewayOrigin!=='https://wallet-auth.ynxweb4.com'||!hex(e.registryDigest)||e.endpoint!==policy.endpoint||e.spki!==policy.spki||!absolute(e.currentStatePath)||canonical(e.operations)!==canonical(AI_OPS))fail('AI_TASK_SOURCE_ENROLLMENT_BODY');
 window(e,atMs,86400000);const height=registrations.root.executionHeight,records=[active(registrations.root,root.networkId,root.rootOwner,height),active(registrations.profile,root.networkId,e.profileOwner,height),active(registrations.current,root.networkId,e.currentOwner,height)];for(let i=0;i<records.length;i++)for(let j=0;j<i;j++)if(records[i].pkA===records[j].pkA||records[i].pkB===records[j].pkB)fail('AUTH_SOURCE_V2_KEYS_NOT_DISTINCT');
}
function aiProfileBodyDATA(root,e,p,enrollmentRaw,policy,registrations,atMs){
 exact(p,['version','purpose','sourceId','enrollmentDigest','instanceId','generation','minimumSequence','minimumFloor','subjectOwner','selection','issuedAtMs','expiresAtMs']);
 if(p.version!==2||p.purpose!==AI_PURPOSE||p.sourceId!==e.sourceId||p.enrollmentDigest!==sha(enrollmentRaw)||!token(p.instanceId)||!integer(p.generation)||p.generation<1||!integer(p.minimumSequence)||p.minimumSequence<1||!integer(p.minimumFloor)||p.minimumFloor>p.minimumSequence||!owner(p.subjectOwner))fail('AI_TASK_SOURCE_PROFILE');window(p,atMs,86400000);if(p.issuedAtMs<e.issuedAtMs||p.expiresAtMs>e.expiresAtMs)fail('AUTH_SOURCE_V2_EXPIRED');
 const s=p.selection;exact(s,['association','expectedRequest','originalHostStatePath','originalHostTerminalDirectory',AI_KEY]);const a=s.association;exact(a,['account','clientId','productId','platform','applicationId','deviceId']);if(Object.values(a).some(v=>typeof v!=='string'||!v||!v.isWellFormed()||Buffer.byteLength(v)>512)||(policy.sourceRole==='server'&&a.account!==p.subjectOwner)||a.productId!==e.productId||a.platform!==e.platform||a.applicationId!==e.applicationId)fail('AI_TASK_SOURCE_ASSOCIATION');
 const r=s.expectedRequest;exact(r,['service','productId','platform','applicationId','gatewayOrigin','registryDigest','operations','instanceId']);if(r.service!==e.service||r.productId!==e.productId||r.platform!==e.platform||r.applicationId!==e.applicationId||r.gatewayOrigin!==e.gatewayOrigin||r.registryDigest!==e.registryDigest||canonical(r.operations)!==canonical(AI_OPS)||r.instanceId!==p.instanceId||!absolute(s.originalHostStatePath)||s.originalHostTerminalDirectory!==s.originalHostStatePath+'.private-terminal')fail('AI_TASK_SOURCE_REQUEST');
 const data=inspectOriginalAITaskActionV6SourceScopeDATA(s[AI_KEY],a,root.networkId,p.subjectOwner,p.sourceId,p.instanceId,p.issuedAtMs,p.expiresAtMs,atMs),height=registrations.root.executionHeight,subject=active(registrations.subject,root.networkId,p.subjectOwner,height);for(const [view,id]of[[registrations.root,root.rootOwner],[registrations.profile,e.profileOwner],[registrations.current,e.currentOwner]]){const other=active(view,root.networkId,id,height);if(subject.pkA===other.pkA||subject.pkB===other.pkB)fail('AI_TASK_SOURCE_SUBJECT_ROLE_COLLISION');}if(s[AI_KEY].role!==e.sourceRole)fail('AI_TASK_SOURCE_ROLE');if(data.devicePublic)for(const [view,id]of[[registrations.root,root.rootOwner],[registrations.profile,e.profileOwner],[registrations.current,e.currentOwner],[registrations.subject,p.subjectOwner]]){const other=active(view,root.networkId,id,height);if(other.pkA===data.devicePublic.pkA||other.pkB===data.devicePublic.pkB)fail('AI_TASK_SOURCE_DEVICE_ROLE_COLLISION');}if(data.agentPublic)for(const [view,id]of[[registrations.root,root.rootOwner],[registrations.profile,e.profileOwner],[registrations.current,e.currentOwner],[registrations.subject,p.subjectOwner]]){const other=active(view,root.networkId,id,height);if(other.pkA===data.agentPublic.pkA||other.pkB===data.agentPublic.pkB)fail('AI_TASK_AGENT_REGISTERED_ROLE_COLLISION');}if(data.accountAuthorization)for(const k of ['pkA','pkB','revision','registeredAt','activeFrom'])if(subject[k]!==data.accountAuthorization[k])fail('AI_TASK_SOURCE_ACCOUNT_CURRENT_CHANGED');if(data.serverIssuer)for(const k of ['pkA','pkB'])if(subject[k]!==data.serverIssuer[k]||subject.revision!==data.serverIssuer.revision)fail('AI_TASK_SOURCE_SERVER_PAIR_CURRENT');return Object.freeze({subjectKeyVersion:selectOriginalAuthSourceAlgorithm(registrations.subject,2).keyVersion,effectExpiresAtMs:data.effectExpiresAtMs,...(data.agentPublic?{agentPublic:data.agentPublic}:{})});
}
export function inspectOriginalAITaskActionV6SourceIssuanceBodyDATA(role,rootRaw,enrollmentRaw,bodyRaw,policy,registrations,atMs){
 const contract=sourcePolicy(policy);if(contract.purpose!==AI_PURPOSE||!['enrollment','profile'].includes(role))fail('AI_TASK_SOURCE_ISSUANCE_ROLE_REQUIRED');exact(registrations,['root','profile','current','subject']);const root=parse(rootRaw,16384);exact(root,['version','algorithmVersion','purpose','rootId','networkId','rootOwner']);if(sha(rootRaw)!==policy.rootDigest||root.version!==2||root.algorithmVersion!==suite||root.purpose!==AI_PURPOSE||!token(root.rootId)||!hex(root.networkId)||!owner(root.rootOwner))fail('AUTH_SOURCE_V2_ROOT');const body=parse(bodyRaw,65536);let effectExpiresAtMs=body.expiresAtMs;if(role==='enrollment')aiEnrollmentBodyDATA(root,body,policy,registrations,atMs);else{const v=verifyOriginalAuthSourceEnrollmentV2(rootRaw,enrollmentRaw,policy,registrations,atMs);effectExpiresAtMs=aiProfileBodyDATA(root,v.enrollment,body,enrollmentRaw,policy,registrations,atMs).effectExpiresAtMs;}return Object.freeze({role,bodySHA256:sha(bodyRaw),effectExpiresAtMs,dataOnly:true,authorized:false,nativeAdmission:false});
}

export function inspectOriginalWalletPayClientSourceIssuanceBodyDATA(role,rootRaw,enrollmentRaw,bodyRaw,policy,registrations,atMs){
 const contract=sourcePolicy(policy);if(contract.purpose!==WPC_PURPOSE||!['enrollment','profile'].includes(role))fail('WALLET_PAY_CLIENT_SOURCE_ISSUANCE_ROLE_REQUIRED');
 exact(registrations,['root','profile','current','subject']);const root=parse(rootRaw,16384);exact(root,['version','algorithmVersion','purpose','rootId','networkId','rootOwner']);
 if(sha(rootRaw)!==policy.rootDigest||root.version!==2||root.algorithmVersion!==suite||root.purpose!==WPC_PURPOSE||!token(root.rootId)||!hex(root.networkId)||!owner(root.rootOwner))fail('AUTH_SOURCE_V2_ROOT');
 const body=parse(bodyRaw,65536);let effectExpiresAtMs=body.expiresAtMs;
 if(role==='enrollment')payEnrollmentBodyDATA(root,body,policy,registrations,atMs,true);
 else {const v=verifyOriginalAuthSourceEnrollmentV2(rootRaw,enrollmentRaw,policy,registrations,atMs);effectExpiresAtMs=payProfileBodyDATA(root,v.enrollment,body,enrollmentRaw,policy,registrations,atMs,true).effectExpiresAtMs;}
 return Object.freeze({role,bodySHA256:sha(bodyRaw),effectExpiresAtMs,dataOnly:true,authorized:false,nativeAdmission:false});
}

export function inspectOriginalBrowserSelectedPagesSourceIssuanceBodyDATA(role,rootRaw,enrollmentRaw,bodyRaw,policy,registrations,atMs){
 const contract=sourcePolicy(policy);if(contract.purpose!==BROWSER_PURPOSE||!['enrollment','profile'].includes(role))fail('BROWSER_SELECTED_PAGES_SOURCE_ISSUANCE_ROLE_REQUIRED');
 exact(registrations,['root','profile','current','subject']);const root=parse(rootRaw,16384);exact(root,['version','algorithmVersion','purpose','rootId','networkId','rootOwner']);
 if(sha(rootRaw)!==policy.rootDigest||root.version!==2||root.algorithmVersion!==suite||root.purpose!==BROWSER_PURPOSE||!token(root.rootId)||!hex(root.networkId)||!owner(root.rootOwner))fail('AUTH_SOURCE_V2_ROOT');
 const body=parse(bodyRaw,65536);let effectExpiresAtMs=body.expiresAtMs;
 if(role==='enrollment')payEnrollmentBodyDATA(root,body,policy,registrations,atMs,true);
 else {const v=verifyOriginalAuthSourceEnrollmentV2(rootRaw,enrollmentRaw,policy,registrations,atMs);effectExpiresAtMs=payProfileBodyDATA(root,v.enrollment,body,enrollmentRaw,policy,registrations,atMs,true).effectExpiresAtMs;}
 return Object.freeze({role,bodySHA256:sha(bodyRaw),effectExpiresAtMs,dataOnly:true,authorized:false,nativeAdmission:false});
}

export function inspectOriginalWalletProductSourceIssuanceBodyDATA(role,rootRaw,enrollmentRaw,bodyRaw,policy,registrations,atMs){
 const contract=sourcePolicy(policy);if(contract.purpose!==WPR_PURPOSE||!['enrollment','profile'].includes(role))fail('WALLET_PRODUCT_SOURCE_ISSUANCE_ROLE_REQUIRED');
 exact(registrations,['root','profile','current','subject']);const root=parse(rootRaw,16384);exact(root,['version','algorithmVersion','purpose','rootId','networkId','rootOwner']);
 if(sha(rootRaw)!==policy.rootDigest||root.version!==2||root.algorithmVersion!==suite||root.purpose!==WPR_PURPOSE||!token(root.rootId)||!hex(root.networkId)||!owner(root.rootOwner))fail('AUTH_SOURCE_V2_ROOT');
 const body=parse(bodyRaw,65536);let effectExpiresAtMs=body.expiresAtMs;
 if(role==='enrollment')payEnrollmentBodyDATA(root,body,policy,registrations,atMs,false);
 else{const v=verifyOriginalAuthSourceEnrollmentV2(rootRaw,enrollmentRaw,policy,registrations,atMs);effectExpiresAtMs=payProfileBodyDATA(root,v.enrollment,body,enrollmentRaw,policy,registrations,atMs,false).effectExpiresAtMs;}
 return Object.freeze({role,bodySHA256:sha(bodyRaw),effectExpiresAtMs,dataOnly:true,authorized:false,nativeAdmission:false});
}

// Dedicated finite Resource Source family. The actual thirteen originals are
// independent arguments, never profile JSON, a DTO registration or a provider.
function networkEnrollmentBodyDATA(root,e,policy,registrations,atMs){
 const purpose=policy.signatureContract.purpose;if(![NR_PURPOSE,NPR_PURPOSE].includes(purpose))fail('NETWORK_SOURCE_DEDICATED_PURPOSE');sourcePolicy(policy);exact(e,['version','purpose','rootId','rootOwner','sourceId','service','productId','platform','applicationId','gatewayOrigin','registryDigest','profileOwner','currentOwner','endpoint','spki','currentStatePath','operations','issuedAtMs','expiresAtMs']);
 if(e.version!==2||e.purpose!==purpose||root.purpose!==purpose||e.rootId!==root.rootId||e.rootOwner!==root.rootOwner||!token(e.sourceId)||!owner(e.profileOwner)||!owner(e.currentOwner)||new Set([root.rootOwner,e.profileOwner,e.currentOwner]).size!==3||e.service!==purpose||e.productId!==policy.productId||e.platform!==policy.platform||e.applicationId!==policy.applicationId||e.gatewayOrigin!=='https://wallet-auth.ynxweb4.com'||!hex(e.registryDigest)||e.endpoint!==policy.endpoint||e.spki!==policy.spki||!absolute(e.currentStatePath)||canonical(e.operations)!==canonical(NR_OPS))fail('NETWORK_RESOURCE_SOURCE_ENROLLMENT');
 window(e,atMs,86400000);const h=registrations.root.executionHeight,keys=[[registrations.root,root.rootOwner],[registrations.profile,e.profileOwner],[registrations.current,e.currentOwner]].map(([v,id])=>active(v,root.networkId,id,h));for(let i=0;i<keys.length;i++)for(let j=0;j<i;j++)if(keys[i].pkA===keys[j].pkA||keys[i].pkB===keys[j].pkB)fail('AUTH_SOURCE_V2_KEYS_NOT_DISTINCT');
}
function networkProfileBodyDATA(root,e,p,enrollmentRaw,policy,registrations,atMs,networkOriginals){
 const purpose=policy.signatureContract.purpose,pending=purpose===NPR_PURPOSE,key=pending?NPR_KEY:NR_KEY;if(![NR_PURPOSE,NPR_PURPOSE].includes(purpose))fail('NETWORK_SOURCE_DEDICATED_PURPOSE');
 exact(p,['version','purpose','sourceId','enrollmentDigest','instanceId','generation','minimumSequence','minimumFloor','subjectOwner','selection','issuedAtMs','expiresAtMs']);
 if(p.version!==2||p.purpose!==purpose||p.sourceId!==e.sourceId||p.enrollmentDigest!==sha(enrollmentRaw)||!token(p.instanceId)||!integer(p.generation)||p.generation<1||!integer(p.minimumSequence)||p.minimumSequence<1||!integer(p.minimumFloor)||p.minimumFloor>p.minimumSequence||!owner(p.subjectOwner))fail('NETWORK_RESOURCE_SOURCE_PROFILE');window(p,atMs,86400000);if(p.issuedAtMs<e.issuedAtMs||p.expiresAtMs>e.expiresAtMs)fail('AUTH_SOURCE_V2_EXPIRED');
 const s=p.selection;exact(s,['association','expectedRequest','originalHostStatePath','originalHostTerminalDirectory',key]);const a=s.association;exact(a,['account','clientId','productId','platform','applicationId','deviceId']);if(Object.values(a).some(x=>typeof x!=='string'||!x||x.length>512)||a.productId!==e.productId||a.platform!==e.platform||a.applicationId!==e.applicationId)fail('AUTH_SOURCE_V2_ASSOCIATION');
 const r=s.expectedRequest;exact(r,['service','productId','platform','applicationId','gatewayOrigin','registryDigest','operations','instanceId']);if(r.service!==e.service||r.productId!==e.productId||r.platform!==e.platform||r.applicationId!==e.applicationId||r.gatewayOrigin!==e.gatewayOrigin||r.registryDigest!==e.registryDigest||canonical(r.operations)!==canonical(NR_OPS)||r.instanceId!==p.instanceId||!absolute(s.originalHostStatePath)||s.originalHostTerminalDirectory!==s.originalHostStatePath+'.private-terminal')fail('AUTH_SOURCE_V2_REQUEST');
 const data=(pending?inspectOriginalNetworkPendingConsentSourceScopeV1DATA:inspectOriginalNetworkResourceSourceScopeV2DATA)(s[key],a,root.networkId,p.subjectOwner,p.sourceId,p.instanceId,p.issuedAtMs,p.expiresAtMs,atMs,networkOriginals),h=registrations.root.executionHeight,subject=active(registrations.subject,root.networkId,p.subjectOwner,h);
 const originals=(pending?captureOriginalNetworkPendingConsentOriginalsV1DATA:captureOriginalNetworkResourceOriginalsV1DATA)(networkOriginals);for(const reg of[originals.issuerRegistration,originals.principalRegistration]){if(reg.executionHeight!==h)fail('NETWORK_RESOURCE_REGISTRATION_HEIGHT');if(reg.owner===p.subjectOwner)assertPQAuthorizationCurrent(registrations.subject,reg);}
 for(const[v,id]of[[registrations.root,root.rootOwner],[registrations.profile,e.profileOwner],[registrations.current,e.currentOwner]]){const other=active(v,root.networkId,id,h);if(subject.pkA===other.pkA||subject.pkB===other.pkB)fail('NETWORK_RESOURCE_SUBJECT_ROLE_COLLISION');for(const reg of[originals.issuerRegistration,originals.principalRegistration]){const signed=inspectPQAuthorizationView(reg).activeRecord;if(!signed||signed.pkA===other.pkA||signed.pkB===other.pkB)fail('NETWORK_RESOURCE_SIGNER_ROLE_COLLISION');}}
 return Object.freeze({subjectKeyVersion:selectOriginalAuthSourceAlgorithm(registrations.subject,2).keyVersion,effectExpiresAtMs:data.effectExpiresAtMs});
}
export function inspectOriginalNetworkResourceSourceIssuanceBodyV2DATA(role,rootRaw,enrollmentRaw,bodyRaw,policy,registrations,atMs,networkOriginals){
 const contract=sourcePolicy(policy);if(contract.purpose!==NR_PURPOSE||!['enrollment','profile'].includes(role))fail('NETWORK_RESOURCE_SOURCE_ISSUANCE_ROLE');exact(registrations,['root','profile','current','subject']);
 const root=parse(rootRaw,16384);exact(root,['version','algorithmVersion','purpose','rootId','networkId','rootOwner']);if(sha(rootRaw)!==policy.rootDigest||root.version!==2||root.algorithmVersion!==suite||root.purpose!==NR_PURPOSE||!token(root.rootId)||!hex(root.networkId)||!owner(root.rootOwner))fail('AUTH_SOURCE_V2_ROOT');const body=parse(bodyRaw,65536);let effectExpiresAtMs=body.expiresAtMs;
 if(role==='enrollment')networkEnrollmentBodyDATA(root,body,policy,registrations,atMs);else{const v=verifyOriginalAuthSourceEnrollmentV2(rootRaw,enrollmentRaw,policy,registrations,atMs);effectExpiresAtMs=networkProfileBodyDATA(root,v.enrollment,body,enrollmentRaw,policy,registrations,atMs,networkOriginals).effectExpiresAtMs;}return Object.freeze({role,bodySHA256:sha(bodyRaw),effectExpiresAtMs,dataOnly:true,authorized:false,nativeAdmission:false});
}

export function inspectOriginalNetworkPendingConsentSourceIssuanceBodyV1DATA(role,rootRaw,enrollmentRaw,bodyRaw,policy,registrations,atMs,networkOriginals){
 const contract=sourcePolicy(policy);if(contract.purpose!==NPR_PURPOSE||!['enrollment','profile'].includes(role))fail('NETWORK_RESOURCE_SOURCE_ISSUANCE_ROLE');exact(registrations,['root','profile','current','subject']);
 const root=parse(rootRaw,16384);exact(root,['version','algorithmVersion','purpose','rootId','networkId','rootOwner']);if(sha(rootRaw)!==policy.rootDigest||root.version!==2||root.algorithmVersion!==suite||root.purpose!==NPR_PURPOSE||!token(root.rootId)||!hex(root.networkId)||!owner(root.rootOwner))fail('AUTH_SOURCE_V2_ROOT');const body=parse(bodyRaw,65536);let effectExpiresAtMs=body.expiresAtMs;
 if(role==='enrollment')networkEnrollmentBodyDATA(root,body,policy,registrations,atMs);else{const v=verifyOriginalAuthSourceEnrollmentV2(rootRaw,enrollmentRaw,policy,registrations,atMs);effectExpiresAtMs=networkProfileBodyDATA(root,v.enrollment,body,enrollmentRaw,policy,registrations,atMs,networkOriginals).effectExpiresAtMs;}return Object.freeze({role,bodySHA256:sha(bodyRaw),effectExpiresAtMs,dataOnly:true,authorized:false,nativeAdmission:false});
}

// Independent publisher-only delegation. No consumer originals/current9 input.
function publisherEnrollmentBodyDATA(root,e,policy,registrations,atMs){
 sourcePolicy(policy);exact(e,['version','purpose','rootId','rootOwner','sourceId','service','productId','platform','applicationId','gatewayOrigin','registryDigest','profileOwner','currentOwner','endpoint','spki','currentStatePath','operations','issuedAtMs','expiresAtMs']);
 if(e.version!==2||e.purpose!==NCP_PURPOSE||root.purpose!==NCP_PURPOSE||e.rootId!==root.rootId||e.rootOwner!==root.rootOwner||!token(e.sourceId)||!owner(e.profileOwner)||!owner(e.currentOwner)||new Set([root.rootOwner,e.profileOwner,e.currentOwner]).size!==3||e.service!==NCP_PURPOSE||e.productId!=='network'||policy.productId!==e.productId||e.platform!==policy.platform||e.applicationId!==policy.applicationId||e.gatewayOrigin!=='https://wallet-auth.ynxweb4.com'||!hex(e.registryDigest)||e.endpoint!==policy.endpoint||e.spki!==policy.spki||!absolute(e.currentStatePath)||canonical(e.operations)!==canonical(NCP_OPS))fail('NETWORK_PUBLISHER_SOURCE_ENROLLMENT');
 window(e,atMs,86400000);const h=registrations.root.executionHeight,roles=[[registrations.root,root.rootOwner],[registrations.profile,e.profileOwner],[registrations.current,e.currentOwner]].map(([v,id])=>active(v,root.networkId,id,h));
 for(let i=0;i<roles.length;i++)for(let j=0;j<i;j++)if(roles[i].pkA===roles[j].pkA||roles[i].pkB===roles[j].pkB)fail('AUTH_SOURCE_V2_KEYS_NOT_DISTINCT');
}
function publisherProfileBodyDATA(root,e,p,enrollmentRaw,policy,registrations,atMs){
 exact(p,['version','purpose','sourceId','enrollmentDigest','instanceId','generation','minimumSequence','minimumFloor','subjectOwner','selection','issuedAtMs','expiresAtMs']);
 if(p.version!==2||p.purpose!==NCP_PURPOSE||p.sourceId!==e.sourceId||p.enrollmentDigest!==sha(enrollmentRaw)||!token(p.instanceId)||!integer(p.generation)||p.generation<1||!integer(p.minimumSequence)||p.minimumSequence<1||!integer(p.minimumFloor)||p.minimumFloor<0||p.minimumFloor>p.minimumSequence||p.subjectOwner!==e.currentOwner)fail('NETWORK_PUBLISHER_SOURCE_PROFILE');
 window(p,atMs,86400000);if(p.issuedAtMs<e.issuedAtMs||p.expiresAtMs>e.expiresAtMs)fail('AUTH_SOURCE_V2_EXPIRED');
 const s=p.selection;exact(s,['association','expectedRequest','originalHostStatePath','originalHostTerminalDirectory',NCP_KEY]);const a=s.association;
 const data=inspectOriginalNetworkCurrentPublisherScopeV1DATA(s[NCP_KEY],a,root.networkId,p.subjectOwner,p.sourceId,p.instanceId,e.currentOwner);
 if(data.descriptor.resourceCurrentFrame===policy.signatureContract.currentFrame)fail('NETWORK_PUBLISHER_DISTINCT_CURRENT_FRAME_REQUIRED');
 if(a.platform!==e.platform||a.applicationId!==e.applicationId)fail('NETWORK_PUBLISHER_ASSOCIATION');
 const r=s.expectedRequest;exact(r,['service','productId','platform','applicationId','gatewayOrigin','registryDigest','operations','instanceId']);
 if(r.service!==e.service||r.productId!==e.productId||r.platform!==e.platform||r.applicationId!==e.applicationId||r.gatewayOrigin!==e.gatewayOrigin||r.registryDigest!==e.registryDigest||canonical(r.operations)!==canonical(NCP_OPS)||r.instanceId!==p.instanceId||!absolute(s.originalHostStatePath)||s.originalHostTerminalDirectory!==s.originalHostStatePath+'.private-terminal')fail('NETWORK_PUBLISHER_REQUEST');
 const h=registrations.root.executionHeight;active(registrations.subject,root.networkId,p.subjectOwner,h);active(registrations.current,root.networkId,e.currentOwner,h);assertPQAuthorizationCurrent(registrations.current,registrations.subject);
 return Object.freeze({subjectKeyVersion:selectOriginalAuthSourceAlgorithm(registrations.subject,2).keyVersion,effectExpiresAtMs:p.expiresAtMs,descriptor:data.descriptor});
}
export function inspectOriginalNetworkCurrentPublisherIssuanceBodyV1DATA(role,rootRaw,enrollmentRaw,bodyRaw,policy,registrations,atMs){
 const contract=sourcePolicy(policy);if(contract.purpose!==NCP_PURPOSE||!['enrollment','profile'].includes(role))fail('NETWORK_PUBLISHER_ISSUANCE_ROLE');exact(registrations,['root','profile','current','subject']);
 const root=parse(rootRaw,16384);exact(root,['version','algorithmVersion','purpose','rootId','networkId','rootOwner']);if(sha(rootRaw)!==policy.rootDigest||root.version!==2||root.algorithmVersion!==suite||root.purpose!==NCP_PURPOSE||!token(root.rootId)||!hex(root.networkId)||!owner(root.rootOwner))fail('AUTH_SOURCE_V2_ROOT');
 const body=parse(bodyRaw,65536);if(role==='enrollment')publisherEnrollmentBodyDATA(root,body,policy,registrations,atMs);else{const v=verifyOriginalAuthSourceEnrollmentV2(rootRaw,enrollmentRaw,policy,registrations,atMs);publisherProfileBodyDATA(root,v.enrollment,body,enrollmentRaw,policy,registrations,atMs);}
 return Object.freeze({role,bodySHA256:sha(bodyRaw),effectExpiresAtMs:body.expiresAtMs,dataOnly:true,authorized:false,nativeAdmission:false});
}

// Mobile qualification DATA shares the sole E8/N1 role verifier. Native must
// independently qualify review/binding/backup/current/once; scope hashes do not.
function mobileEnrollmentBodyDATA(root,e,policy,registrations,atMs){
 sourcePolicy(policy);exact(e,['version','purpose','rootId','rootOwner','sourceId','service','productId','platform','applicationId','gatewayOrigin','registryDigest','profileOwner','currentOwner','endpoint','spki','currentStatePath','operations','issuedAtMs','expiresAtMs']);
 // Opaque locator syntax only: never resolved by Node or treated as a grant.
 if(e.version!==2||e.purpose!==WM_PURPOSE||root.purpose!==WM_PURPOSE||e.rootId!==root.rootId||e.rootOwner!==root.rootOwner||!token(e.sourceId)||!owner(e.profileOwner)||!owner(e.currentOwner)||new Set([root.rootOwner,e.profileOwner,e.currentOwner]).size!==3||e.service!==WM_PURPOSE||e.productId!=='wallet'||e.platform!==policy.platform||e.applicationId!==policy.applicationId||e.gatewayOrigin!=='https://wallet-auth.ynxweb4.com'||!hex(e.registryDigest)||e.endpoint!==policy.endpoint||e.spki!==policy.spki||typeof e.currentStatePath!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(e.currentStatePath)||canonical(e.operations)!==canonical(WM_OPS))fail('MOBILE_SOURCE_ENROLLMENT');
 window(e,atMs,86400000);const h=registrations.root.executionHeight;active(registrations.root,root.networkId,root.rootOwner,h);active(registrations.profile,root.networkId,e.profileOwner,h);active(registrations.current,root.networkId,e.currentOwner,h);
}
function mobileProfileBodyDATA(root,e,p,enrollmentRaw,policy,registrations,atMs){
 exact(p,['version','purpose','sourceId','enrollmentDigest','instanceId','generation','minimumSequence','minimumFloor','subjectOwner','selection','issuedAtMs','expiresAtMs']);
 if(p.version!==2||p.purpose!==WM_PURPOSE||p.sourceId!==e.sourceId||p.enrollmentDigest!==sha(enrollmentRaw)||!token(p.instanceId)||!integer(p.generation)||p.generation<1||!integer(p.minimumSequence)||p.minimumSequence<1||!integer(p.minimumFloor)||p.minimumFloor>p.minimumSequence||!owner(p.subjectOwner))fail('MOBILE_SOURCE_PROFILE');
 window(p,atMs,86400000);if(p.issuedAtMs<e.issuedAtMs||p.expiresAtMs>e.expiresAtMs)fail('AUTH_SOURCE_V2_EXPIRED');exact(p.selection,[WM_KEY]);const s=inspectWalletMobileQualifiedSourceScopeV1DATA(p.selection[WM_KEY]),c=s.context;
 if(c.networkId!==root.networkId||c.account!==p.subjectOwner||c.platform!==e.platform||c.applicationId!==e.applicationId)fail('MOBILE_SOURCE_SCOPE_BINDING');
 if(s.issuedAtMs<p.issuedAtMs||s.expiresAtMs>p.expiresAtMs||atMs<s.issuedAtMs||atMs>=s.expiresAtMs)fail('MOBILE_SOURCE_SCOPE_WINDOW');
 const h=registrations.root.executionHeight;active(registrations.subject,root.networkId,p.subjectOwner,h);const selected=selectOriginalAuthSourceAlgorithm(registrations.subject,2);
 if(s.mode!==3&&c.keyVersion!==selected.keyVersion)fail('MOBILE_SOURCE_REGISTERED_PAIR_REVISION');
 return Object.freeze({subjectKeyVersion:selected.keyVersion,effectExpiresAtMs:s.expiresAtMs});
}
export function inspectWalletMobileQualifiedSourceIssuanceBodyV1DATA(role,rootRaw,enrollmentRaw,bodyRaw,policy,registrations,atMs){
 const contract=sourcePolicy(policy);if(contract.purpose!==WM_PURPOSE||!['enrollment','profile'].includes(role))fail('MOBILE_SOURCE_ISSUANCE_ROLE');exact(registrations,['root','profile','current','subject']);
 const root=parse(rootRaw,16384);exact(root,['version','algorithmVersion','purpose','rootId','networkId','rootOwner']);if(sha(rootRaw)!==policy.rootDigest||root.version!==2||root.algorithmVersion!==suite||root.purpose!==WM_PURPOSE||!token(root.rootId)||!hex(root.networkId)||!owner(root.rootOwner))fail('AUTH_SOURCE_V2_ROOT');
 const body=parse(bodyRaw,65536);let effectExpiresAtMs=body.expiresAtMs;if(role==='enrollment')mobileEnrollmentBodyDATA(root,body,policy,registrations,atMs);else{const v=verifyOriginalAuthSourceEnrollmentV2(rootRaw,enrollmentRaw,policy,registrations,atMs);effectExpiresAtMs=mobileProfileBodyDATA(root,v.enrollment,body,enrollmentRaw,policy,registrations,atMs).effectExpiresAtMs;}
 return Object.freeze({role,bodySHA256:sha(bodyRaw),effectExpiresAtMs,dataOnly:true,authorized:false,nativeAdmission:false});
}

function desktopGrantEnrollmentBodyDATA(root,e,policy,registrations,atMs){
 exact(e,['version','purpose','rootId','rootOwner','sourceId','service','productId','platform','applicationId','gatewayOrigin','registryDigest','profileOwner','currentOwner','endpoint','spki','currentStatePath','operations','issuedAtMs','expiresAtMs']);
 if(e.version!==2||e.purpose!==DGA_PURPOSE||root.purpose!==DGA_PURPOSE||e.rootId!==root.rootId||e.rootOwner!==root.rootOwner||!token(e.sourceId)||!owner(e.profileOwner)||!owner(e.currentOwner)||new Set([root.rootOwner,e.profileOwner,e.currentOwner]).size!==3||e.service!==DGA_PURPOSE||e.productId!==policy.productId||e.platform!==policy.platform||e.applicationId!==policy.applicationId||e.gatewayOrigin!=='https://wallet-auth.ynxweb4.com'||!hex(e.registryDigest)||e.endpoint!==policy.endpoint||e.spki!==policy.spki||!absolute(e.currentStatePath)||canonical(e.operations)!==canonical(DGA_OPS))fail('DESKTOP_GRANT_SOURCE_ENROLLMENT');
 window(e,atMs,86400000);const height=registrations.root.executionHeight,records=[active(registrations.root,root.networkId,root.rootOwner,height),active(registrations.profile,root.networkId,e.profileOwner,height),active(registrations.current,root.networkId,e.currentOwner,height)];
 for(let i=0;i<records.length;i++)for(let j=0;j<i;j++)if(records[i].pkA===records[j].pkA||records[i].pkB===records[j].pkB)fail('AUTH_SOURCE_V2_KEYS_NOT_DISTINCT');
}

function desktopGrantProfileBodyDATA(root,e,p,enrollmentRaw,policy,registrations,atMs){
 exact(p,['version','purpose','sourceId','enrollmentDigest','instanceId','generation','minimumSequence','minimumFloor','subjectOwner','selection','issuedAtMs','expiresAtMs']);
 if(p.version!==2||p.purpose!==DGA_PURPOSE||p.sourceId!==e.sourceId||p.enrollmentDigest!==sha(enrollmentRaw)||!token(p.instanceId)||!integer(p.generation)||p.generation<1||!integer(p.minimumSequence)||p.minimumSequence<1||!integer(p.minimumFloor)||p.minimumFloor>p.minimumSequence||!owner(p.subjectOwner))fail('DESKTOP_GRANT_SOURCE_PROFILE');
 window(p,atMs,86400000);if(p.issuedAtMs<e.issuedAtMs||p.expiresAtMs>e.expiresAtMs)fail('AUTH_SOURCE_V2_EXPIRED');
 const s=p.selection;exact(s,['association','expectedRequest','originalHostStatePath','originalHostTerminalDirectory',DGA_KEY]);const a=s.association;exact(a,['account','clientId','productId','platform','applicationId','deviceId']);
 if(a.account!==p.subjectOwner||a.productId!==policy.productId||a.platform!==policy.platform||a.applicationId!==policy.applicationId)fail('DESKTOP_GRANT_SOURCE_ASSOCIATION');
 const r=s.expectedRequest;exact(r,['service','productId','platform','applicationId','gatewayOrigin','registryDigest','operations','instanceId']);
 if(r.service!==DGA_PURPOSE||r.productId!==e.productId||r.platform!==e.platform||r.applicationId!==e.applicationId||r.gatewayOrigin!==e.gatewayOrigin||r.registryDigest!==e.registryDigest||canonical(r.operations)!==canonical(DGA_OPS)||r.instanceId!==p.instanceId||!absolute(s.originalHostStatePath)||s.originalHostTerminalDirectory!==s.originalHostStatePath+'.private-terminal')fail('DESKTOP_GRANT_SOURCE_REQUEST');
 const data=inspectOriginalDesktopGrantAuthorityScopeV1DATA(s[DGA_KEY],a,root.networkId,p.subjectOwner,p.sourceId,p.instanceId,p.issuedAtMs,p.expiresAtMs,atMs),height=registrations.root.executionHeight;
 const records=[[registrations.root,root.rootOwner],[registrations.profile,e.profileOwner],[registrations.current,e.currentOwner],[registrations.subject,p.subjectOwner]].map(([snapshot,id])=>active(snapshot,root.networkId,id,height));
 for(let i=0;i<records.length;i++)for(let j=0;j<i;j++)if(records[i].pkA===records[j].pkA||records[i].pkB===records[j].pkB)fail('AUTH_SOURCE_V2_KEYS_NOT_DISTINCT');
 return Object.freeze({subjectKeyVersion:selectOriginalAuthSourceAlgorithm(registrations.subject,2).keyVersion,effectExpiresAtMs:data.effectExpiresAtMs});
}

export function inspectOriginalDesktopGrantAuthorityIssuanceBodyV1DATA(role,rootRaw,enrollmentRaw,bodyRaw,policy,registrations,atMs){
 const contract=sourcePolicy(policy);if(contract.purpose!==DGA_PURPOSE||!['enrollment','profile'].includes(role))fail('DESKTOP_GRANT_SOURCE_ISSUANCE_ROLE');exact(registrations,['root','profile','current','subject']);
 const root=parse(rootRaw,16384);exact(root,['version','algorithmVersion','purpose','rootId','networkId','rootOwner']);if(sha(rootRaw)!==policy.rootDigest||root.version!==2||root.algorithmVersion!==suite||root.purpose!==DGA_PURPOSE||!token(root.rootId)||!hex(root.networkId)||!owner(root.rootOwner))fail('AUTH_SOURCE_V2_ROOT');
 const body=parse(bodyRaw,65536);let effectExpiresAtMs=body.expiresAtMs;
 if(role==='enrollment')desktopGrantEnrollmentBodyDATA(root,body,policy,registrations,atMs);else{const{enrollment}=verifyOriginalAuthSourceEnrollmentV2(rootRaw,enrollmentRaw,policy,registrations,atMs);effectExpiresAtMs=desktopGrantProfileBodyDATA(root,enrollment,body,enrollmentRaw,policy,registrations,atMs).effectExpiresAtMs;}
 return Object.freeze({role,bodySHA256:sha(bodyRaw),effectExpiresAtMs,dataOnly:true,authorized:false,nativeAdmission:false});
}

