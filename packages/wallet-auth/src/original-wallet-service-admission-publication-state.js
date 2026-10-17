import {createHash} from 'node:crypto';
import {types} from 'node:util';

export const ORIGINAL_WALLET_SERVICE_ADMISSION_PUBLICATION_NAMESPACE = 'wallet-product-session-v2-admission-publication-metadata/v1';
export const ORIGINAL_WALLET_SERVICE_ADMISSION_PUBLICATION_MAX_BYTES = 65536;
const PURPOSE='wallet-product-session-v2-service-admission/v1';
const REQUEST_DOMAIN='YNX_WALLET_SERVICE_ADMISSION_REQUEST_V1\n';
const OPS=['beginYNX','handleReturn','restore','disconnect'];
const REQUEST=['version','purpose','service','productId','platform','applicationId','gatewayOrigin','registryDigest','consumerManifestDigest','gatewayManifestDigest','instanceId','currentReference','operations','requestNonce','requestedAtMs','expiresAtMs'];
const SOURCE=['rootDigest','roleDigest','rootId','rootKeyId','rootPublicKey','keyId','holderPublicKey','registryDigest','registrationNonce','issuedAtMs','expiresAtMs'];
const RECORD=['enrollmentOperationId','registrationNonce','requestNonce','requestRaw','reviewDigest','roleSource','runtimeRaw','state','signedRaw'];
// Protected catalog metadata only. Never another signed/public permission.
function parseDelivery(d,record){
 exact(d,['state','receiptDigest','sequence','consumerManifestDigest','firstCause']);
 if(record.state!=='signed'||!['entered','UNKNOWN','acknowledged'].includes(d.state))fail();
 hex(d.receiptDigest);hex(d.consumerManifestDigest);
 const request=parseRequest(record.requestRaw),runtime=JSON.parse(record.runtimeRaw);
 if(d.receiptDigest!==sha(record.signedRaw)||d.consumerManifestDigest!==request.consumerManifestDigest||d.sequence!==runtime.observation.sequence)fail();
 if(d.firstCause!==null&&(typeof d.firstCause!=='string'||!/^[_A-Z0-9]{1,128}$/.test(d.firstCause)))fail();
 if(d.state==='UNKNOWN'&&d.firstCause===null||d.state!=='UNKNOWN'&&d.firstCause!==null)fail();
}
const fail=(code='WALLET_SERVICE_PUBLICATION_METADATA_INVALID')=>{const e=new Error(code);e.code=code;throw e;};
function canonical(v){if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';}
function capture(raw,limit=65536){const seen=new WeakSet();let nodes=0;function walk(v,d){if(++nodes>8192||d>24)fail();if(v===null||typeof v==='string'||typeof v==='boolean')return v;if(typeof v==='number'&&Number.isSafeInteger(v))return v;if(!v||typeof v!=='object'||types.isProxy(v)||seen.has(v))fail();seen.add(v);const a=Array.isArray(v);if(a&&v.length>8192)fail();if(Object.getPrototypeOf(v)!==(a?Array.prototype:Object.prototype))fail();const ds=Object.getOwnPropertyDescriptors(v),out=a?[]:{};if(Reflect.ownKeys(ds).some(k=>typeof k!=='string'))fail();if(a&&Object.keys(ds).filter(k=>k!=='length').join(',')!==Array.from({length:v.length},(_,i)=>String(i)).join(','))fail();for(const [k,x]of Object.entries(ds)){if(a&&k==='length')continue;if(!x.enumerable||!('value'in x))fail();Object.defineProperty(out,k,{value:walk(x.value,d+1),enumerable:true,writable:true,configurable:true});}return out;}const v=walk(raw,0);if(Buffer.byteLength(canonical(v))>limit)fail('WALLET_SERVICE_PUBLICATION_CAPACITY');return v;}
function exact(v,ks){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==[...ks].sort().join('|'))fail();}
function hex(v){if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))fail();}
function token(v){if(typeof v!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(v))fail();}
function bytes(v,n){if(typeof v!=='string'||!/^[A-Za-z0-9_-]+$/.test(v))fail();const b=Buffer.from(v,'base64url');if(b.length!==n||b.toString('base64url')!==v)fail();}
function finite(v){if(!Number.isSafeInteger(v)||v<0)fail();}
function rawJSON(text,max){if(typeof text!=='string'||Buffer.byteLength(text)>max)fail();let v;try{v=JSON.parse(text);}catch{fail();}v=capture(v,max);if(canonical(v)!==text)fail();return v;}
function sha(v){return createHash('sha256').update(v).digest('hex');}
function parseRequest(raw){const r=rawJSON(raw,16384);exact(r,REQUEST);if(r.version!==1||r.purpose!==PURPOSE||r.service!=='wallet-product-session-v2'||r.productId!=='developer'||r.platform!=='macos'||r.applicationId!=='com.ynxweb4.developer.testnetpreview'||r.gatewayOrigin!=='https://wallet-auth.ynxweb4.com'||canonical(r.operations)!==canonical(OPS))fail();for(const k of ['registryDigest','consumerManifestDigest','gatewayManifestDigest','currentReference'])hex(r[k]);token(r.instanceId);bytes(r.requestNonce,32);finite(r.requestedAtMs);finite(r.expiresAtMs);if(r.expiresAtMs<=r.requestedAtMs||r.expiresAtMs-r.requestedAtMs>86400000)fail();return r;}
function parseSource(s){exact(s,SOURCE);for(const k of ['rootDigest','roleDigest','registryDigest'])hex(s[k]);for(const k of ['rootId','rootKeyId','keyId'])token(s[k]);bytes(s.rootPublicKey,32);bytes(s.holderPublicKey,32);bytes(s.registrationNonce,32);finite(s.issuedAtMs);finite(s.expiresAtMs);if(s.expiresAtMs<=s.issuedAtMs||s.expiresAtMs-s.issuedAtMs>86400000)fail();}
function parseRuntime(raw,r,s){const v=rawJSON(raw,8192);exact(v,['version','purpose','keyId','roleDigest','observation','signature']);if(v.version!==1||v.purpose!=='wallet-product-session-v2-runtime-observation/v1'||v.keyId!==s.keyId||v.roleDigest!==s.roleDigest)fail();bytes(v.signature,64);const o=v.observation;exact(o,['instanceId','currentReference','gatewayManifestDigest','registryDigest','observedAtMs','expiresAtMs','sequence','state']);if(o.instanceId!==r.instanceId||o.currentReference!==r.currentReference||o.gatewayManifestDigest!==r.gatewayManifestDigest||o.registryDigest!==r.registryDigest||o.state!=='ready'||!Number.isSafeInteger(o.sequence)||o.sequence<1)fail();finite(o.observedAtMs);finite(o.expiresAtMs);if(o.expiresAtMs<=o.observedAtMs||o.expiresAtMs-o.observedAtMs>30000)fail();return o;}
function parseSigned(raw,record,r,s,o){const v=rawJSON(raw,16384);exact(v,['version','purpose','keyId','roleDigest','request','reviewDigest','runtimeRaw','issuedAtMs','expiresAtMs','signature']);if(v.version!==1||v.purpose!==PURPOSE||v.keyId!==s.keyId||v.roleDigest!==s.roleDigest||canonical(v.request)!==record.requestRaw||v.reviewDigest!==record.reviewDigest||v.runtimeRaw!==record.runtimeRaw)fail();bytes(v.signature,64);finite(v.issuedAtMs);finite(v.expiresAtMs);if(v.issuedAtMs<Math.max(r.requestedAtMs,s.issuedAtMs,o.observedAtMs)||v.issuedAtMs>=Math.min(r.expiresAtMs,s.expiresAtMs,o.expiresAtMs)||v.issuedAtMs-o.observedAtMs>30000||v.expiresAtMs!==Math.min(r.expiresAtMs,s.expiresAtMs,o.expiresAtMs)||v.expiresAtMs<=v.issuedAtMs)fail();}
function parseRecord(v){exact(v,Object.hasOwn(v,'delivery')?[...RECORD,'delivery']:RECORD);token(v.enrollmentOperationId);bytes(v.registrationNonce,32);bytes(v.requestNonce,32);hex(v.reviewDigest);parseSource(v.roleSource);const r=parseRequest(v.requestRaw);if(v.registrationNonce!==v.roleSource.registrationNonce||v.requestNonce!==r.requestNonce||r.registryDigest!==v.roleSource.registryDigest||v.reviewDigest!==sha(REQUEST_DOMAIN+v.requestRaw))fail();const o=parseRuntime(v.runtimeRaw,r,v.roleSource);if(!['pending','UNKNOWN','signed'].includes(v.state))fail();if(v.state==='signed'){if(typeof v.signedRaw!=='string')fail();parseSigned(v.signedRaw,v,r,v.roleSource,o);}else if(v.signedRaw!==null)fail();if(Object.hasOwn(v,'delivery'))parseDelivery(v.delivery,v);return v;}

export function emptyOriginalWalletServiceAdmissionPublicationState(){return {version:1,purpose:ORIGINAL_WALLET_SERVICE_ADMISSION_PUBLICATION_NAMESPACE,records:[]};}
export function parseOriginalWalletServiceAdmissionPublicationState(raw){const s=capture(raw);exact(s,['version','purpose','records']);if(s.version!==1||s.purpose!==ORIGINAL_WALLET_SERVICE_ADMISSION_PUBLICATION_NAMESPACE||!Array.isArray(s.records)||s.records.length>32)fail();const nonces=new Set();let unresolved=false;for(const r of s.records){parseRecord(r);if(nonces.has(r.requestNonce)||unresolved)fail();nonces.add(r.requestNonce);if(r.state!=='signed'||r.delivery&&r.delivery.state!=='acknowledged')unresolved=true;}return s;}
/** Metadata candidate only: commit same original catalog BEFORE signing. */
export function reserveOriginalWalletServiceAdmissionPublication(raw,input){const state=parseOriginalWalletServiceAdmissionPublicationState(raw),i=capture(input);exact(i,RECORD.filter(k=>!['state','signedRaw'].includes(k)));const record=parseRecord({...i,state:'pending',signedRaw:null});const existing=state.records.find(r=>r.requestNonce===record.requestNonce);if(existing){const {state:_state,signedRaw:_signed,delivery:_delivery,...binding}=existing;if(canonical(binding)!==canonical(i))fail('WALLET_SERVICE_PUBLICATION_CONFLICT');return {state,record:capture(existing),readOnly:true};}if(state.records.some(r=>r.state!=='signed'||r.delivery&&r.delivery.state!=='acknowledged'))fail('WALLET_SERVICE_PUBLICATION_UNRESOLVED');state.records.push(record);return {state:parseOriginalWalletServiceAdmissionPublicationState(state),record:capture(record),readOnly:false};}
/** Persist UNKNOWN before the ONE original publisher/sign attempt. */
export function markOriginalWalletServiceAdmissionPublicationUnknown(raw,requestNonce){const state=parseOriginalWalletServiceAdmissionPublicationState(raw);bytes(requestNonce,32);const record=state.records.find(r=>r.requestNonce===requestNonce);if(!record)fail();const readOnly=record.state!=='pending';if(!readOnly)record.state='UNKNOWN';return {state,record:capture(record),readOnly};}
/** INTERNAL only. A must verify this exact captured receipt under its genuine
 * publisher/current+Vault lease before invoking/committing. This verifies NO
 * signature, root, role, runtime readiness or authority. */
export function recordOriginalWalletServiceAdmissionPublicationSigned(raw,requestNonce,signedRaw){const state=parseOriginalWalletServiceAdmissionPublicationState(raw);bytes(requestNonce,32);const record=state.records.find(r=>r.requestNonce===requestNonce);if(!record)fail();const captured=rawJSON(signedRaw,16384),text=canonical(captured);if(record.state==='signed'){if(record.signedRaw!==text)fail('WALLET_SERVICE_PUBLICATION_CONFLICT');return {state,record:capture(record),readOnly:true};}if(record.state!=='UNKNOWN')fail('WALLET_SERVICE_PUBLICATION_UNKNOWN_REQUIRED');const candidate={...record,state:'signed',signedRaw:text};parseRecord(candidate);Object.assign(record,candidate);return {state:parseOriginalWalletServiceAdmissionPublicationState(state),record:capture(record),readOnly:false};}
/** Internal cold recovery data, NEVER a permission capability or normal IPC. */
export function readOriginalWalletServiceAdmissionPublication(raw,requestNonce){const state=parseOriginalWalletServiceAdmissionPublicationState(raw);bytes(requestNonce,32);const record=state.records.find(r=>r.requestNonce===requestNonce);if(!record)fail();return {record:capture(record),readOnly:true};}
/** A must enforce this on EVERY same-catalog rewrite, including privileged
 * internal callers. A void retention assertion is never approval/current. */
export function assertOriginalWalletServiceAdmissionPublicationRetention(previous,next){
 const old=parseOriginalWalletServiceAdmissionPublicationState(previous),fresh=parseOriginalWalletServiceAdmissionPublicationState(next);
 if(fresh.records.length<old.records.length)fail('WALLET_SERVICE_PUBLICATION_RETENTION');
 for(let index=0;index<old.records.length;index++){
  const a=old.records[index],b=fresh.records[index];
  const {state:oldState,signedRaw:oldSigned,delivery:oldDelivery,...oldBinding}=a,{state:newState,signedRaw:newSigned,delivery:newDelivery,...newBinding}=b;
  if(canonical(oldBinding)!==canonical(newBinding))fail('WALLET_SERVICE_PUBLICATION_RETENTION');
  if(oldState===newState){if(oldSigned!==newSigned)fail('WALLET_SERVICE_PUBLICATION_RETENTION');}
  else if(!(oldState==='pending'&&newState==='UNKNOWN'&&newSigned===null||oldState==='UNKNOWN'&&newState==='signed'))fail('WALLET_SERVICE_PUBLICATION_RETENTION');
  if(oldDelivery){
   if(!newDelivery)fail('WALLET_SERVICE_DELIVERY_RETENTION');
   const {state:os,firstCause:oc,...ob}=oldDelivery,{state:ns,firstCause:nc,...nb}=newDelivery;
   if(canonical(ob)!==canonical(nb)||os===ns&&oc!==nc||os!==ns&&!(os==='entered'&&['UNKNOWN','acknowledged'].includes(ns)))fail('WALLET_SERVICE_DELIVERY_RETENTION');
  }else if(newDelivery&&(oldState!=='signed'||newDelivery.state!=='entered'))fail('WALLET_SERVICE_DELIVERY_RETENTION');
 }
 if(fresh.records.length>old.records.length){
  if(old.records.some(r=>r.state!=='signed'||r.delivery&&r.delivery.state!=='acknowledged'))fail('WALLET_SERVICE_PUBLICATION_UNRESOLVED');
  for(const r of fresh.records.slice(old.records.length))if(r.state!=='pending'||r.signedRaw!==null||r.delivery)fail('WALLET_SERVICE_PUBLICATION_RETENTION');
 }
}

/** Persist in the original protected catalog BEFORE the channel write. Cold
 * entered/UNKNOWN are read-only unresolved facts, never a retry capability. */
export function enterOriginalWalletServiceAdmissionDelivery(raw,requestNonce){
 const state=parseOriginalWalletServiceAdmissionPublicationState(raw);bytes(requestNonce,32);
 const record=state.records.find(r=>r.requestNonce===requestNonce);
 if(!record||record.state!=='signed'||record!==state.records.at(-1))fail('WALLET_SERVICE_DELIVERY_NOT_INSTALLED');
 if(record.delivery)fail('WALLET_SERVICE_DELIVERY_ALREADY_ENTERED');
 if(state.records.some(r=>r!==record&&(r.state!=='signed'||r.delivery&&r.delivery.state!=='acknowledged')))fail('WALLET_SERVICE_PUBLICATION_UNRESOLVED');
 const request=parseRequest(record.requestRaw),runtime=JSON.parse(record.runtimeRaw);
 record.delivery={state:'entered',receiptDigest:sha(record.signedRaw),sequence:runtime.observation.sequence,consumerManifestDigest:request.consumerManifestDigest,firstCause:null};
 return {state:parseOriginalWalletServiceAdmissionPublicationState(state),record:capture(record),readOnly:false};
}
export function markOriginalWalletServiceAdmissionDeliveryUnknown(raw,requestNonce,cause){
 const state=parseOriginalWalletServiceAdmissionPublicationState(raw);bytes(requestNonce,32);
 const record=state.records.find(r=>r.requestNonce===requestNonce);
 if(!record?.delivery)fail('WALLET_SERVICE_DELIVERY_NOT_ENTERED');
 if(typeof cause!=='string'||!/^[_A-Z0-9]{1,128}$/.test(cause))fail();
 if(record.delivery.state!=='entered')return {state,record:capture(record),readOnly:true};
 record.delivery.state='UNKNOWN';record.delivery.firstCause=cause;
 return {state:parseOriginalWalletServiceAdmissionPublicationState(state),record:capture(record),readOnly:false};
}
export function acknowledgeOriginalWalletServiceAdmissionDelivery(raw,ack){
 const state=parseOriginalWalletServiceAdmissionPublicationState(raw),a=capture(ack);
 exact(a,['type','requestNonce','receiptDigest','sequence','consumerManifestDigest']);bytes(a.requestNonce,32);
 const record=state.records.find(r=>r.requestNonce===a.requestNonce),d=record?.delivery;
 if(!d||a.type!=='ack'||a.receiptDigest!==d.receiptDigest||a.sequence!==d.sequence||a.consumerManifestDigest!==d.consumerManifestDigest)fail('WALLET_SERVICE_DELIVERY_ACK_MISMATCH');
 if(d.state!=='entered')fail('WALLET_SERVICE_DELIVERY_UNRESOLVED');
 d.state='acknowledged';return {state:parseOriginalWalletServiceAdmissionPublicationState(state),record:capture(record),readOnly:false};
}
