import {createPublicKey,createHash,verify} from 'node:crypto';
import {canonicalJSON,exactFields,WalletAuthError} from './canonical.js';
import {parseProductSession} from './product-session-v2.js';
import {verifyProductSessionProofV2} from './product-session-proof-v2.js';
import {captureOriginalRecoveryJSON, captureOriginalRecoveryIdentity, parseOriginalOperationMapping} from './original-operation-recovery-state.js';

// NEW explicitly versioned INTERNAL purpose. No old browser Backend-Proof,
// registration or endpoint is promoted into this source capability.
export const ORIGINAL_BACKEND_OPERATION_PROOF_VERSION='ynx-original-backend-operation-proof/v1';
const AUTHENTICATORS=new WeakSet();
export function assertOriginalBackendOperationAuthenticator(value){if(!AUTHENTICATORS.has(value))fail('ORIGINAL_OPERATION_REGISTRATION_UNAVAILABLE');return value;}
const PURPOSES=['prepared-publication/v1','mapped-recovery/v1'];
const DOMAIN='YNX_ORIGINAL_BACKEND_OPERATION_PROOF_V1\n';
const digest=value=>createHash('sha256').update(canonicalJSON(value)).digest('hex');
const fail=code=>{throw new WalletAuthError(code,'Original registered operation purpose failed closed')};
const sync=value=>{if(value&&typeof value.then==='function')fail('ORIGINAL_OPERATION_SOURCE_ASYNC');return value};
function time(value){const t=Date.parse(value);if(typeof value!=='string'||!Number.isFinite(t)||new Date(t).toISOString()!==value)fail('ORIGINAL_OPERATION_PROOF_INVALID');return t;}
function decode(value,bytes){if(typeof value!=='string'||!/^[A-Za-z0-9_-]+$/.test(value))fail('ORIGINAL_OPERATION_PROOF_INVALID');const b=Buffer.from(value,'base64url');if(b.length!==bytes||b.toString('base64url')!==value)fail('ORIGINAL_OPERATION_PROOF_INVALID');return b;}

// A configuration document is NOT proof of actual enrollment/registration. The
// fixed protected registration source must independently remain current. No
// private key, grant, registered role, HTTP mount or device source is generated.
export function createOriginalBackendOperationAuthenticator(options){
 exactFields(options,['registrations','assertOriginalRegisteredSourceCurrent','originalNow'],'Original operation registered source');
 if(!Array.isArray(options.registrations)||options.registrations.length===0||options.registrations.length>32||typeof options.assertOriginalRegisteredSourceCurrent!=='function'||typeof options.originalNow!=='function')fail('ORIGINAL_OPERATION_REGISTRATION_UNAVAILABLE');
 const nowSource=options.originalNow,currentSource=options.assertOriginalRegisteredSourceCurrent;
 const records=new Map();
 for(const raw of options.registrations){
  const r=captureOriginalRecoveryJSON(raw);
  exactFields(r,['version','productId','clientId','platform','backendClientId','keyId','publicKey','sourceDigest','scopes','purposes','recoveryPath'],'Explicit original operation registration');
  if(r.version!=='ynx-original-operation-registration/v1'||!/^[a-z][a-z0-9-]{1,31}$/.test(r.productId)||!/^[a-z][a-z0-9._-]{2,63}$/.test(r.clientId)||!['web','android','ios','macos','linux','windows'].includes(r.platform)||r.backendClientId!==r.clientId+'-business-'+r.platform+'-v1'||typeof r.keyId!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(r.keyId)||!/^[0-9a-f]{64}$/.test(r.sourceDigest)||!Array.isArray(r.scopes)||r.scopes.length===0||r.scopes.length>8||!Array.isArray(r.purposes)||r.purposes.length===0||r.purposes.some(p=>!PURPOSES.includes(p))||new Set(r.purposes).size!==r.purposes.length)fail('ORIGINAL_OPERATION_REGISTRATION_INVALID');
  if(r.purposes.includes('mapped-recovery/v1')){if(typeof r.recoveryPath!=='string'||!/^\/[A-Za-z0-9._~!$&'()*+,;=:@\/-]{1,255}$/.test(r.recoveryPath)||r.recoveryPath.includes('//')||r.recoveryPath.endsWith('/'))fail('ORIGINAL_OPERATION_REGISTRATION_INVALID');}else if(r.recoveryPath!==null)fail('ORIGINAL_OPERATION_REGISTRATION_INVALID');
  let previous='';for(const scope of r.scopes){if(typeof scope!=='string'||!/^[a-z][a-z0-9._:-]{1,63}$/.test(scope)||scope<=previous)fail('ORIGINAL_OPERATION_REGISTRATION_INVALID');previous=scope;}
  let key;try{key=createPublicKey(r.publicKey)}catch{fail('ORIGINAL_OPERATION_REGISTRATION_INVALID')}
  if(key.asymmetricKeyType!=='ed25519'||records.has(r.backendClientId))fail('ORIGINAL_OPERATION_REGISTRATION_INVALID');
  records.set(r.backendClientId,{registration:r,key});
 }
 const capabilities=new WeakMap();
 const clock=floor=>{const at=sync(nowSource());if(!(at instanceof Date)||!Number.isFinite(at.getTime())||at.getTime()<floor)fail('ORIGINAL_OPERATION_CLOCK_UNAVAILABLE');return at.getTime()};
 function authenticate(raw,expected){
  const value=captureOriginalRecoveryJSON(raw),bound=captureOriginalRecoveryJSON(expected);
  exactFields(value,['body','proof'],'Original purpose authenticated request');
  if(canonicalJSON(value.body)!==canonicalJSON(bound))fail('ORIGINAL_OPERATION_BODY_MISMATCH');
  const recovery=value.body.purpose==='mapped-recovery/v1';
  if(!recovery&&value.body.purpose!=='prepared-publication/v1')fail('ORIGINAL_OPERATION_PURPOSE_UNAVAILABLE');
  exactFields(value.body,recovery?['purpose','captured','identity','mapping','request','actionProof','requiredScopes','productId']:['purpose','captured','preparation','actionProof','requiredScopes','productId'],'Original purpose bound request');
  exactFields(value.body.captured,['session','projection'],'Original same-writer captured authority');
  const session=parseProductSession(value.body.captured.session),p=value.proof;
  exactFields(p,['version','issuer','audience','purpose','backendClientId','keyId','sourceDigest','bodyDigest','issuedAt','expiresAt','nonce','signature'],'Original operation confidential proof');
  const source=records.get(p.backendClientId);
  if(!source||p.version!==ORIGINAL_BACKEND_OPERATION_PROOF_VERSION||p.issuer!=='https://wallet-auth.ynxweb4.com'||p.audience!=='ynx:original-backend-operation:v1'||p.purpose!==value.body.purpose||!source.registration.purposes.includes(p.purpose)||p.keyId!==source.registration.keyId||p.sourceDigest!==source.registration.sourceDigest||source.registration.productId!==session.productId||source.registration.clientId!==session.clientId||source.registration.platform!==session.platform||value.body.productId!==session.productId||p.bodyDigest!==digest(value.body))fail('ORIGINAL_OPERATION_REGISTRATION_MISMATCH');
  let preparation;
  if(recovery){
   const identity=captureOriginalRecoveryIdentity(value.body.identity),mapping=parseOriginalOperationMapping(value.body.mapping);
   for(const field of Object.keys(identity))if(identity[field]!==mapping[field])fail('ORIGINAL_OPERATION_BODY_MISMATCH');
   exactFields(value.body.request,['method','path','bodyDigest'],'Original registered recovery read');
   if(value.body.request.method!=='GET'||value.body.request.path!==source.registration.recoveryPath||value.body.request.bodyDigest!==digest(identity))fail('ORIGINAL_OPERATION_BODY_MISMATCH');
   preparation={productOperationId:mapping.productOperationId,sessionBinding:mapping.sessionBinding,method:value.body.request.method,path:value.body.request.path,wireDigest:value.body.request.bodyDigest};
  }else{
   exactFields(value.body.preparation,['productOperationId','sessionBinding','method','path','wireDigest'],'Original operation preparation descriptor');
   preparation=value.body.preparation;
  }
  if(preparation.sessionBinding!==session.sessionBinding||typeof preparation.productOperationId!=='string'||!/^[A-Za-z0-9._:-]{1,256}$/.test(preparation.productOperationId)||!Array.isArray(value.body.requiredScopes)||value.body.requiredScopes.length===0||new Set(value.body.requiredScopes).size!==value.body.requiredScopes.length||value.body.requiredScopes.some(scope=>!source.registration.scopes.includes(scope)||!session.scopes.includes(scope)))fail('ORIGINAL_OPERATION_REGISTRATION_MISMATCH');
  decode(p.nonce,32);const signature=decode(p.signature,64),issued=time(p.issuedAt),expires=time(p.expiresAt);
  const {signature:omitted,...signed}=p;
  if(expires<=issued||expires-issued>30000||expires>time(session.expiresAt)||!verify(null,Buffer.from(DOMAIN+canonicalJSON(signed)),source.key,signature))fail('ORIGINAL_OPERATION_PROOF_INVALID');
  let floor=issued;
  const validate=()=>{
   const at=clock(floor);floor=at;
   if(issued>at||expires<=at)fail('ORIGINAL_OPERATION_PROOF_EXPIRED');
   const checked=sync(currentSource(source.registration,{session,projection:value.body.captured.projection,purpose:p.purpose},new Date(at)));
   if(checked!==undefined)fail('ORIGINAL_OPERATION_SOURCE_INVALID');
   // Fresh AFTER the last external source callback; unchanged tuple cannot
   // release expired backend/device action, Session or original finite lease.
   const fresh=clock(floor);floor=fresh;
   if(expires<=fresh)fail('ORIGINAL_OPERATION_PROOF_EXPIRED');
   const device=verifyProductSessionProofV2(value.body.actionProof,session,{method:preparation.method,path:preparation.path,bodyDigest:preparation.wireDigest},new Date(fresh));
   if(time(device.expiresAt)-time(device.issuedAt)>30000||expires>time(device.expiresAt))fail('ORIGINAL_OPERATION_ACTION_WINDOW_INVALID');
   return device;
  };
  validate();
  const capability=Object.freeze({purpose:p.purpose});
  capabilities.set(capability,{value,source,validate,expiresAt:p.expiresAt,nonce:p.nonce});
  return capability;
 }
 function current(capability){const value=capabilities.get(capability);if(!value)fail('ORIGINAL_OPERATION_CAPABILITY_REQUIRED');value.validate();return Object.freeze({registration:Object.freeze({readerId:value.source.registration.backendClientId+':'+value.value.proof.purpose.replace('/','-'),sourceDigest:value.source.registration.sourceDigest,productId:value.value.body.captured.session.productId,clientId:value.value.body.captured.session.clientId,platform:value.value.body.captured.session.platform,account:value.value.body.captured.session.account,deviceBinding:value.value.body.captured.session.deviceBinding}),proofNonce:value.nonce,proofExpiresAt:value.expiresAt});}
 const authenticator=Object.freeze({authenticate,assertCurrent:current});AUTHENTICATORS.add(authenticator);return authenticator;
}
