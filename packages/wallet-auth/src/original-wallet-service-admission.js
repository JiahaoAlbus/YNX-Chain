import {KeyObject,createPublicKey,createHash,sign,verify} from 'node:crypto';
import {types,TextDecoder} from 'node:util';
import {canonicalJSON,exactFields,WalletAuthError} from './canonical.js';
import {captureOriginalRecoveryJSON} from './original-operation-recovery-state.js';
import {readOriginalOperationProtectedSource} from './original-operation-protected-startup.js';

const PURPOSE='wallet-product-session-v2-service-admission/v1';
const ROLE='wallet-product-session-v2-admission-publisher/v1';
const REQUEST_DOMAIN='YNX_WALLET_SERVICE_ADMISSION_REQUEST_V1\n';
const ROLE_DOMAIN='YNX_WALLET_SERVICE_ADMISSION_PUBLISHER_V1\n';
const ADMISSION_DOMAIN='YNX_WALLET_SERVICE_ADMISSION_V1\n';
const RUNTIME_DOMAIN='YNX_WALLET_SERVICE_RUNTIME_OBSERVATION_V1\n';
const OPERATIONS=Object.freeze(['beginYNX','handleReturn','restore','disconnect']);
const fail=(code='WALLET_SERVICE_ADMISSION_NOT_SUPPLIED')=>{throw new WalletAuthError(code,'Original Wallet service admission is unavailable');};
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const hex=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const token=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const nonce=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v)&&Buffer.from(v,'base64url').toString('base64url')===v;
function raw(value){
 const detached=captureOriginalRecoveryJSON(value),text=canonicalJSON(detached);
 if(Buffer.byteLength(text)>16384)fail('WALLET_SERVICE_ADMISSION_CAPACITY');
 return Object.freeze({value:detached,text});
}
function json(bytes){let text,value;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);value=JSON.parse(text);}catch{fail('WALLET_SERVICE_ADMISSION_SOURCE_INVALID');}const out=raw(value);if(text!==out.text)fail('WALLET_SERVICE_ADMISSION_SOURCE_INVALID');return out.value;}
function publicKey(pem){if(typeof pem!=='string'||pem.length>4096||!pem.startsWith('-----BEGIN PUBLIC KEY-----')||pem.includes('PRIVATE KEY'))fail();let key;try{key=createPublicKey(pem);}catch{fail();}if(key.asymmetricKeyType!=='ed25519')fail();return key;}
function proof(s){if(typeof s!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(s))fail();const b=Buffer.from(s,'base64url');if(b.length!==64||b.toString('base64url')!==s)fail();return b;}
function finite(at){if(types.isProxy(at)||!(at instanceof Date))fail('WALLET_SERVICE_ADMISSION_CLOCK_UNAVAILABLE');const t=Date.prototype.getTime.call(at);if(!Number.isSafeInteger(t)||t<0)fail('WALLET_SERVICE_ADMISSION_CLOCK_UNAVAILABLE');return t;}
function request(value){
 const r=raw(value).value;
 exactFields(r,['version','purpose','service','productId','platform','applicationId','gatewayOrigin','registryDigest','consumerManifestDigest','gatewayManifestDigest','instanceId','currentReference','operations','requestNonce','requestedAtMs','expiresAtMs'],'Original service admission request');
 if(r.version!==1||r.purpose!==PURPOSE||r.service!=='wallet-product-session-v2'||r.productId!=='developer'||r.platform!=='macos'||r.applicationId!=='com.ynxweb4.developer.testnetpreview'||r.gatewayOrigin!=='https://wallet-auth.ynxweb4.com'||!hex(r.registryDigest)||!hex(r.consumerManifestDigest)||!hex(r.gatewayManifestDigest)||!token(r.instanceId)||!hex(r.currentReference)||!nonce(r.requestNonce)||canonicalJSON(r.operations)!==canonicalJSON(OPERATIONS)||!Number.isSafeInteger(r.requestedAtMs)||r.requestedAtMs<0||!Number.isSafeInteger(r.expiresAtMs)||r.expiresAtMs<=r.requestedAtMs||r.expiresAtMs-r.requestedAtMs>86400000)fail('WALLET_SERVICE_ADMISSION_REQUEST_INVALID');
 return r;
}
// Public application material only. No root enrollment, signer selection,
// service readiness, account permission or project/resource grant is inferred.
export function prepareOriginalWalletServiceAdmissionReview(input){
 const r=request(input),text=canonicalJSON(r);
 return Object.freeze({version:1,purpose:PURPOSE,requestRaw:text,reviewDigest:sha(REQUEST_DOMAIN+text),service:r.service,productId:r.productId,platform:r.platform,applicationId:r.applicationId,gatewayOrigin:r.gatewayOrigin,instanceId:r.instanceId,currentReference:r.currentReference,consumerManifestDigest:r.consumerManifestDigest,gatewayManifestDigest:r.gatewayManifestDigest,registryDigest:r.registryDigest,operations:Object.freeze([...r.operations]),expiresAtMs:r.expiresAtMs,warning:'Service entry approval only. This does not approve an account, project, resource action, transfer or device enrollment. A signed publisher role and original runtime readiness are separately required.'});
}
function configuration(input){
 const o=raw(input).value;
 exactFields(o,['rootPath','rootDigest','rolePath','roleDigest'],'Original admission source selection');
 if(!hex(o.rootDigest)||!hex(o.roleDigest))fail();
 const check=()=>{readOriginalOperationProtectedSource(o.rootPath,o.rootDigest);readOriginalOperationProtectedSource(o.rolePath,o.roleDigest);};
 const root=json(readOriginalOperationProtectedSource(o.rootPath,o.rootDigest));
 exactFields(root,['version','purpose','rootId','rootKeyId','publicKey'],'Independently approved admission root');
 if(root.version!==1||root.purpose!==ROLE||!token(root.rootId)||!token(root.rootKeyId))fail();
 const role=json(readOriginalOperationProtectedSource(o.rolePath,o.roleDigest));
 exactFields(role,['version','purpose','rootId','rootKeyId','keyId','publicKey','environment','service','productId','platform','gatewayOrigin','registryDigest','issuedAtMs','expiresAtMs','registrationNonce','signature'],'NEW admission publisher role');
 if(role.version!==1||role.purpose!==ROLE||role.rootId!==root.rootId||role.rootKeyId!==root.rootKeyId||!token(role.keyId)||role.environment!=='testnet'||role.service!=='wallet-product-session-v2'||role.productId!=='developer'||role.platform!=='macos'||role.gatewayOrigin!=='https://wallet-auth.ynxweb4.com'||!hex(role.registryDigest)||!nonce(role.registrationNonce)||!Number.isSafeInteger(role.issuedAtMs)||role.issuedAtMs<0||!Number.isSafeInteger(role.expiresAtMs)||role.expiresAtMs<=role.issuedAtMs||role.expiresAtMs-role.issuedAtMs>86400000)fail();
 const {signature,...body}=role;
 if(!verify(null,Buffer.from(ROLE_DOMAIN+canonicalJSON(body)),publicKey(root.publicKey),proof(signature)))fail();
 const key=publicKey(role.publicKey);check();return {root,role,key,check,roleDigest:sha(canonicalJSON(role))};
}
// This is the authenticated PUBLIC certificate binding, not a role issuer.
// The independently signed certificate remains separate from enrollment metadata.
export function prepareOriginalWalletServiceAdmissionHolderBinding(sourceSelection,originalNow){
 if(typeof originalNow!=='function'||types.isProxy(originalNow))fail();
 const cfg=configuration(sourceSelection);
 const binding=Object.freeze({rootDigest:sha(canonicalJSON(cfg.root)),rootId:cfg.root.rootId,rootKeyId:cfg.root.rootKeyId,rootPublicKey:publicKey(cfg.root.publicKey).export({format:'der',type:'spki'}).subarray(-32).toString('base64url'),keyId:cfg.role.keyId,holderPublicKey:cfg.key.export({format:'der',type:'spki'}).subarray(-32).toString('base64url'),registryDigest:cfg.role.registryDigest,registrationNonce:cfg.role.registrationNonce,issuedAtMs:cfg.role.issuedAtMs,expiresAtMs:cfg.role.expiresAtMs,roleDigest:cfg.roleDigest});
 const current=boundary(cfg,originalNow,(_input,now)=>{const t=now();if(t<binding.issuedAtMs||t>=binding.expiresAtMs)fail('WALLET_SERVICE_ADMISSION_EXPIRED');},(_result,t)=>{if(t<binding.issuedAtMs||t>=binding.expiresAtMs)fail('WALLET_SERVICE_ADMISSION_EXPIRED');});
 current(null);
 const validate=boundary(cfg,originalNow,(input,now)=>{
  const {i,r,v}=validateOriginalAdmissionPublication(cfg,input,now);
  return Object.freeze({requestRaw:i.requestRaw,reviewDigest:i.reviewDigest,runtimeRaw:i.observedRuntimeRaw,expiresAtMs:Math.min(r.expiresAtMs,v.expiresAtMs,cfg.role.expiresAtMs)});
 },(result,t)=>{if(t>=result.expiresAtMs)fail('WALLET_SERVICE_ADMISSION_EXPIRED');});
 return Object.freeze({binding,assertCurrent(){current(null);},validateReviewedOriginalPublication:validate});
}
function boundary(cfg,clock,work,release){
 let active=false,invalid=false,floor=-1;
 return input=>{
  if(active){invalid=true;fail('WALLET_SERVICE_ADMISSION_REENTRANT');}if(invalid)fail('WALLET_SERVICE_ADMISSION_RETIRED');active=true;
  const now=()=>{const t=finite(clock());if(invalid||t<floor)fail('WALLET_SERVICE_ADMISSION_CLOCK_UNAVAILABLE');floor=t;cfg.check();return t;};
  try{cfg.check();const result=work(input,now),final=now();release(result,final);cfg.check();if(invalid)fail('WALLET_SERVICE_ADMISSION_RETIRED');return result;}catch(e){invalid=true;throw e;}finally{active=false;}
 };
}
function lifetime(role,r,t){if(t<role.issuedAtMs||t>=role.expiresAtMs||t<r.requestedAtMs||t>=r.expiresAtMs||r.registryDigest!==role.registryDigest)fail('WALLET_SERVICE_ADMISSION_EXPIRED');}
// Private same-Vault publisher only. The caller must hold the actual original
// runtime observer and recheck it before and after this synchronous signing
// boundary. A structural observation is not readiness or permission.
export function signOriginalWalletServiceRuntimeObservation(sourceSelection,protectedSigningKey,observationRaw,originalNow){
 const cfg=configuration(sourceSelection);
 if(typeof observationRaw!=='string'||Buffer.byteLength(observationRaw)>8192)fail('WALLET_SERVICE_ADMISSION_RUNTIME_NOT_CONFIGURED');
 let observation;try{observation=raw(JSON.parse(observationRaw)).value;}catch{fail('WALLET_SERVICE_ADMISSION_RUNTIME_NOT_CONFIGURED');}
 exactFields(observation,['instanceId','currentReference','gatewayManifestDigest','registryDigest','observedAtMs','expiresAtMs','sequence','state'],'Original runtime observation');
 if(canonicalJSON(observation)!==observationRaw||!token(observation.instanceId)||!token(observation.currentReference)||!hex(observation.gatewayManifestDigest)||observation.registryDigest!==cfg.role.registryDigest||!Number.isSafeInteger(observation.sequence)||observation.sequence<1||observation.state!=='ready'||!Number.isSafeInteger(observation.observedAtMs)||!Number.isSafeInteger(observation.expiresAtMs)||observation.expiresAtMs<=observation.observedAtMs||observation.expiresAtMs-observation.observedAtMs>30000)fail('WALLET_SERVICE_ADMISSION_RUNTIME_NOT_CONFIGURED');
 if(!(protectedSigningKey instanceof KeyObject)||protectedSigningKey.type!=='private'||protectedSigningKey.asymmetricKeyType!=='ed25519'||!createPublicKey(protectedSigningKey).export({format:'der',type:'spki'}).equals(cfg.key.export({format:'der',type:'spki'})))fail('WALLET_SERVICE_ADMISSION_HOLDER_MISMATCH');
 const check=t=>{if(t<cfg.role.issuedAtMs||t>=cfg.role.expiresAtMs||t<observation.observedAtMs||t>=observation.expiresAtMs)fail('WALLET_SERVICE_ADMISSION_EXPIRED');};
 return boundary(cfg,originalNow,(_input,now)=>{
  check(now());
  const body={version:1,purpose:'wallet-product-session-v2-runtime-observation/v1',keyId:cfg.role.keyId,roleDigest:cfg.roleDigest,observation};
  return canonicalJSON({...body,signature:sign(null,Buffer.from(RUNTIME_DOMAIN+canonicalJSON(body)),protectedSigningKey).toString('base64url')});
 },(_result,t)=>check(t))(null);
}
function validateOriginalAdmissionPublication(cfg,input,now){
  const i=raw(input).value;exactFields(i,['requestRaw','reviewDigest','decision','observedRuntimeRaw'],'Original normal admission decision');
  if(i.decision!=='approve'||typeof i.requestRaw!=='string')fail('WALLET_SERVICE_ADMISSION_REVIEW_REQUIRED');let parsed;try{parsed=JSON.parse(i.requestRaw);}catch{fail();}const r=request(parsed),review=prepareOriginalWalletServiceAdmissionReview(r);
  if(review.requestRaw!==i.requestRaw||review.reviewDigest!==i.reviewDigest)fail('WALLET_SERVICE_ADMISSION_REVIEW_MISMATCH');
  if(typeof i.observedRuntimeRaw!=='string'||Buffer.byteLength(i.observedRuntimeRaw)>8192)fail('WALLET_SERVICE_ADMISSION_RUNTIME_NOT_CONFIGURED');let runtime;try{runtime=JSON.parse(i.observedRuntimeRaw);}catch{fail();}runtime=raw(runtime).value;
  exactFields(runtime,['version','purpose','keyId','roleDigest','observation','signature'],'Original authenticated runtime carrier');
  const {signature:runtimeSignature,...runtimeBody}=runtime;
  if(canonicalJSON(runtime)!==i.observedRuntimeRaw||runtime.version!==1||runtime.purpose!=='wallet-product-session-v2-runtime-observation/v1'||runtime.keyId!==cfg.role.keyId||runtime.roleDigest!==cfg.roleDigest||!verify(null,Buffer.from(RUNTIME_DOMAIN+canonicalJSON(runtimeBody)),cfg.key,proof(runtimeSignature)))fail('WALLET_SERVICE_ADMISSION_RUNTIME_NOT_CONFIGURED');
  const v=runtime.observation;exactFields(v,['instanceId','currentReference','gatewayManifestDigest','registryDigest','observedAtMs','expiresAtMs','sequence','state'],'Original runtime observation');
  const t=now();lifetime(cfg.role,r,t);
  if(v.instanceId!==r.instanceId||v.currentReference!==r.currentReference||v.gatewayManifestDigest!==r.gatewayManifestDigest||v.registryDigest!==r.registryDigest||v.state!=='ready'||!Number.isSafeInteger(v.sequence)||v.sequence<1||!Number.isSafeInteger(v.observedAtMs)||v.observedAtMs>t||v.observedAtMs<t-30000||!Number.isSafeInteger(v.expiresAtMs)||v.expiresAtMs<=t||v.expiresAtMs-v.observedAtMs>30000)fail('WALLET_SERVICE_ADMISSION_RUNTIME_NOT_CONFIGURED');
  return {i,r,review,runtime,v,t};
}
// The actual approved holder supplies the KeyObject. This factory never reads
// private files, generates keys, promotes Session signatures or self-signs roots.
// Readiness is an original protected runtime observation, separately signed by
// this approved publisher after its real runtime checks. No empty/void callback
// can be accepted as readiness. Persistent current sequencing remains at that
// existing runtime writer; this module creates no parallel Store.
export function prepareOriginalWalletServiceAdmissionPublisher(sourceSelection,protectedSigningKey,originalNow){
 if(typeof originalNow!=='function'||types.isProxy(originalNow))fail();const cfg=configuration(sourceSelection);
 if(!(protectedSigningKey instanceof KeyObject)||protectedSigningKey.type!=='private'||protectedSigningKey.asymmetricKeyType!=='ed25519'||!createPublicKey(protectedSigningKey).equals(cfg.key))fail('WALLET_SERVICE_ADMISSION_HOLDER_NOT_CONFIGURED');
 const publish=boundary(cfg,originalNow,(input,now)=>{
  const {i,r,review,v,t}=validateOriginalAdmissionPublication(cfg,input,now);
  // Only the already authenticated protected runtime writer can publish this
  // carrier. No readiness producer is installed by this module. A DTO, void
  // callback, project file, SDK pin or self-reported header cannot substitute it.
  const body={version:1,purpose:PURPOSE,keyId:cfg.role.keyId,roleDigest:cfg.roleDigest,request:r,reviewDigest:review.reviewDigest,runtimeRaw:i.observedRuntimeRaw,issuedAtMs:t,expiresAtMs:Math.min(r.expiresAtMs,cfg.role.expiresAtMs,v.expiresAtMs)};
  const signed=canonicalJSON({...body,signature:sign(null,Buffer.from(ADMISSION_DOMAIN+canonicalJSON(body)),protectedSigningKey).toString('base64url')});
  if(Buffer.byteLength(signed)>16384)fail('WALLET_SERVICE_ADMISSION_CAPACITY');const end=now();lifetime(cfg.role,r,end);if(end>=body.expiresAtMs)fail('WALLET_SERVICE_ADMISSION_EXPIRED');return signed;
 },(signed,final)=>{const result=JSON.parse(signed);if(final>=result.expiresAtMs)fail('WALLET_SERVICE_ADMISSION_EXPIRED');});
 return Object.freeze({purpose:PURPOSE,publishReviewedOriginalAdmission:publish});
}
// Fixed protected immutable receipt, NOT a project/browser supplied token. The
// trusted IDE owner injects this object into NativeWalletController; no SDK or
// frontend global is consulted. A fresh publisher receipt requires an explicit
// new protected source selection, not extension of the old expiry.
export function prepareOriginalWalletServiceAdmission(sourceSelection,receiptSelection,expectedRequest,originalNow){
 if(typeof originalNow!=='function'||types.isProxy(originalNow))fail();const cfg=configuration(sourceSelection),r=request(expectedRequest),s=raw(receiptSelection).value;
 exactFields(s,['receiptPath','receiptDigest'],'Original admission receipt source');if(!hex(s.receiptDigest))fail();
 const captured=json(readOriginalOperationProtectedSource(s.receiptPath,s.receiptDigest));
 const checkReceipt=()=>readOriginalOperationProtectedSource(s.receiptPath,s.receiptDigest);
 const checked=boundary({...cfg,check(){cfg.check();checkReceipt();}},originalNow,(input,now)=>{
  const i=raw(input).value;exactFields(i,['service','productId','platform','gatewayOrigin','operation'],'Original service admission call');
  if(i.service!==r.service||i.productId!==r.productId||i.platform!==r.platform||i.gatewayOrigin!==r.gatewayOrigin||!OPERATIONS.includes(i.operation))fail('WALLET_SERVICE_ADMISSION_BINDING_MISMATCH');
  checkReceipt();validateOriginalAdmissionReceipt(cfg,captured,r,now);checkReceipt();return undefined;
 },(_result,final)=>{if(final<captured.issuedAtMs||final>=captured.expiresAtMs)fail('WALLET_SERVICE_ADMISSION_EXPIRED');});
 return Object.freeze({purpose:PURPOSE,assertCurrent:checked});
}

function validateOriginalAdmissionReceipt(cfg,captured,r,now){
  exactFields(captured,['version','purpose','keyId','roleDigest','request','reviewDigest','runtimeRaw','issuedAtMs','expiresAtMs','signature'],'Original signed admission');
  if(captured.version!==1||captured.purpose!==PURPOSE||captured.keyId!==cfg.role.keyId||captured.roleDigest!==cfg.roleDigest||canonicalJSON(captured.request)!==canonicalJSON(r)||captured.reviewDigest!==prepareOriginalWalletServiceAdmissionReview(r).reviewDigest)fail('WALLET_SERVICE_ADMISSION_BINDING_MISMATCH');
  const {signature,...body}=captured;if(!verify(null,Buffer.from(ADMISSION_DOMAIN+canonicalJSON(body)),cfg.key,proof(signature)))fail();
  const t=now();lifetime(cfg.role,r,t);if(typeof captured.runtimeRaw!=='string'||Buffer.byteLength(captured.runtimeRaw)>8192)fail();let runtime;try{runtime=JSON.parse(captured.runtimeRaw);}catch{fail();}runtime=raw(runtime).value;exactFields(runtime,['version','purpose','keyId','roleDigest','observation','signature'],'Signed runtime source');const {signature:runtimeSignature,...runtimeBody}=runtime;
  if(canonicalJSON(runtime)!==captured.runtimeRaw||runtime.version!==1||runtime.purpose!=='wallet-product-session-v2-runtime-observation/v1'||runtime.keyId!==cfg.role.keyId||runtime.roleDigest!==cfg.roleDigest||!verify(null,Buffer.from(RUNTIME_DOMAIN+canonicalJSON(runtimeBody)),cfg.key,proof(runtimeSignature)))fail();const v=runtime.observation;
  exactFields(v,['instanceId','currentReference','gatewayManifestDigest','registryDigest','observedAtMs','expiresAtMs','sequence','state'],'Original signed readiness');
  if(v.instanceId!==r.instanceId||v.currentReference!==r.currentReference||v.gatewayManifestDigest!==r.gatewayManifestDigest||v.registryDigest!==r.registryDigest||v.state!=='ready'||!Number.isSafeInteger(v.sequence)||v.sequence<1||!Number.isSafeInteger(v.observedAtMs)||v.observedAtMs>t||!Number.isSafeInteger(v.expiresAtMs)||v.expiresAtMs<=t||v.expiresAtMs-v.observedAtMs>30000||!Number.isSafeInteger(captured.issuedAtMs)||captured.issuedAtMs<v.observedAtMs||captured.issuedAtMs>t||!Number.isSafeInteger(captured.expiresAtMs)||captured.expiresAtMs<=t||captured.expiresAtMs>Math.min(r.expiresAtMs,cfg.role.expiresAtMs,v.expiresAtMs))fail('WALLET_SERVICE_ADMISSION_EXPIRED');
  const final=now();if(final>=captured.expiresAtMs||final>=v.expiresAtMs)fail('WALLET_SERVICE_ADMISSION_EXPIRED');return captured.expiresAtMs;
}

// PRIVATE native installer input only; signature validity is not registration,
// installation or service admission. Source selection is fixed by original main.
export function validateOriginalWalletServiceAdmissionReceiptRaw(sourceSelection,signedRaw,expectedRequest,originalNow){
 if(typeof originalNow!=='function'||types.isProxy(originalNow)||typeof signedRaw!=='string'||Buffer.byteLength(signedRaw)>16384)fail();
 const cfg=configuration(sourceSelection),r=request(expectedRequest);let captured;try{captured=raw(JSON.parse(signedRaw)).value;}catch{fail();}
 if(canonicalJSON(captured)!==signedRaw)fail();
 const validate=boundary(cfg,originalNow,(_input,now)=>{const expiresAtMs=validateOriginalAdmissionReceipt(cfg,captured,r,now);return Object.freeze({requestNonce:r.requestNonce,receiptDigest:sha(signedRaw),expiresAtMs});},(result,t)=>{if(t<captured.issuedAtMs||t>=result.expiresAtMs)fail('WALLET_SERVICE_ADMISSION_EXPIRED');});
 return validate(null);
}
