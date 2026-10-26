import {installOriginalProductSessionV4ReadConsumer} from './product-session-device-v4-private.js';
// Original Node/Electron consumer of Auth's separate paired-device slot. The
// fixed protocol provider is Node-only; no browser polyfill or classic fallback.
import {Buffer} from 'node:buffer';
import {types} from 'node:util';
import {canonicalJSON,digestHex,WalletAuthError} from './canonical.js';
import {evmAddressFromYNX} from './crypto.js';
import {exactPQRecord,PQ_SUITE} from './pq-wallet-contract.js';
import {pqU64,pqHex} from './pq-wallet-authorization.js';
import {parseProductSession} from './product-session-v2.js';
import {inspectProductSessionDeviceRegistrationOriginalV4Data,inspectProductSessionHTTPProofForDeviceRecordV4Data} from './product-session-device-registration-v4.js';
import {parseProductSessionHTTPProofV4Unsigned,encodeProductSessionHTTPProofV4Message,inspectProductSessionHTTPProofV4Data,encodeProductSessionProofHeaderV4,decodeProductSessionProofHeaderV4,PRODUCT_SESSION_PROOF_HEADER_V4} from './product-session-proof-v4.js';
import {httpBodyDigest} from './session-proof.js';
const fail=code=>{throw new WalletAuthError(code,code);};
const CONTEXT=['version','algorithm','securityLevel','networkId','account','deviceId','generation','registrationId','revision','registrationDigest','scopes','purpose'];
export const PRODUCT_SESSION_DEVICE_V4_EXPECTED_FIELDS=Object.freeze(['networkId','canonicalOwner','account','sessionBinding','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId','generation','registrationId','revision','registrationDigest']);
function positive(s){if(typeof s!=='string'||!pqU64(s))fail('PQ_DEVICE_CONTEXT_INVALID');return s;}
function context(device){
 exactPQRecord(device,['version','algorithm','readContext','produceHTTPProof']);
 if(device.version!=='4'||device.algorithm!==PQ_SUITE||typeof device.readContext!=='function'||typeof device.produceHTTPProof!=='function')fail('PQ_NATIVE_DEVICE_PRODUCER_NOT_SUPPLIED');
 const c=device.readContext();if(types.isProxy(c))fail('PQ_DEVICE_CONTEXT_INVALID');exactPQRecord(c,CONTEXT);
 if(c.version!=='4'||c.algorithm!==PQ_SUITE||!['os-protected','hardware-backed'].includes(c.securityLevel)||typeof c.deviceId!=='string'||!/^[A-Za-z0-9._:-]{8,128}$/.test(c.deviceId)||typeof c.registrationId!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(c.registrationId)||typeof c.registrationDigest!=='string'||!/^[0-9a-f]{64}$/.test(c.registrationDigest)||typeof c.purpose!=='string'||!c.purpose.length||c.purpose.length>180)fail('PQ_DEVICE_CONTEXT_INVALID');
 const networkId=pqHex(c.networkId,32).toString('hex');evmAddressFromYNX(c.account);positive(c.generation);positive(c.revision);
 if(types.isProxy(c.scopes)||!Array.isArray(c.scopes)||c.scopes.length<1||c.scopes.length>8||c.scopes.some(s=>typeof s!=='string'||s.length<1||s.length>64)||new Set(c.scopes).size!==c.scopes.length||[...c.scopes].sort().join('\n')!==c.scopes.join('\n'))fail('SCOPE_WIDENING');
 return Object.freeze({...c,networkId,scopes:Object.freeze([...c.scopes])});
}
function expectedFor(session,c,binding){
 if(session.version!=='4'||session.deviceAlgorithm!==PQ_SUITE||c.account!==session.account||session.deviceId!==c.deviceId||session.deviceRegistrationId!==c.registrationId||session.deviceRegistrationRevision!==c.revision||session.deviceRegistrationDigest!==c.registrationDigest||session.accountAuthorization.networkId!==c.networkId)fail('PQ_DEVICE_SESSION_BINDING_MISMATCH');
 for(const k of ['chainId','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback'])if(session[k]!==binding[k])fail('CROSS_PRODUCT_SESSION');
 if(session.scopes.some(s=>!c.scopes.includes(s)||!binding.scopes.includes(s)))fail('SCOPE_WIDENING');
 return Object.freeze({networkId:c.networkId,canonicalOwner:evmAddressFromYNX(session.account),account:session.account,sessionBinding:session.sessionBinding,productId:session.productId,clientId:session.clientId,platform:session.platform,applicationId:session.applicationId,bundleId:session.bundleId,packageId:session.packageId,origin:session.origin,callback:session.callback,deviceId:session.deviceId,generation:c.generation,registrationId:c.registrationId,revision:c.revision,registrationDigest:c.registrationDigest});
}
function assertSource(source){if(!source||['readCurrent','assertCurrent','readRegistrationOriginal','readSessionOriginal'].some(n=>typeof source[n]!=='function'))fail('PRODUCT_SESSION_DEVICE_CURRENT_NOT_SUPPLIED');}
async function current(source,held,abortContext,active){active();if(await source.assertCurrent(held,abortContext)!==undefined)fail('PQ_DEVICE_CURRENT_REFUSED');active();}
function original(source,held,expected,rawSession,at){
 const sessionRaw=source.readSessionOriginal(held);if(typeof sessionRaw!=='string'||sessionRaw!==rawSession)fail('PQ_DEVICE_ORIGINAL_SESSION_CHANGED');
 const bytes=source.readRegistrationOriginal(held),view=inspectProductSessionDeviceRegistrationOriginalV4Data(bytes),r=view.record;
 for(const k of ['networkId','canonicalOwner','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId','generation','registrationId','revision'])if(r[k]!==expected[k])fail('PQ_DEVICE_REGISTRATION_CHANGED');
 if(view.registrationDigest!==expected.registrationDigest||r.revokedAt!==null||r.registeredAt>at.toISOString()||r.expiresAt<=at.toISOString())fail('PQ_DEVICE_REGISTRATION_INACTIVE');
 return Object.freeze({record:r,bytes:Buffer.from(bytes)});
}
function captureGET(input,session,c,binding){
 if(types.isProxy(input)||types.isProxy(input?.requiredScopes))fail('PQ_SCHEMA_INVALID');
 exactPQRecord(input,['method','path','body','requiredScopes']);const method=input.method,path=input.path;
 if(method!=='GET'||input.body!==''||typeof path!=='string'||!/^\/[A-Za-z0-9._~!$&'()*+,;=:@\/-]{1,255}$/.test(path)||path.includes('//')||path.endsWith('/')||path.split('/').some(s=>s==='.'||s==='..')||path.startsWith('/v2/product-sessions/')||path.startsWith('/v2/browser-sessions/'))fail('HTTP_BINDING_MISMATCH');
 if(!Array.isArray(input.requiredScopes)||input.requiredScopes.length<1||input.requiredScopes.length>8)fail('SCOPE_WIDENING');
 const scopes=Array.from({length:input.requiredScopes.length},(_,i)=>input.requiredScopes[i]);
 if(scopes.some(s=>typeof s!=='string'||!session.scopes.includes(s)||!c.scopes.includes(s)||!binding.scopes.includes(s))||new Set(scopes).size!==scopes.length||[...scopes].sort().join('\n')!==scopes.join('\n'))fail('SCOPE_WIDENING');
 return Object.freeze({method,path,body:'',requiredScopes:Object.freeze(scopes)});
}
// Original RecoverableProductSessionClient delegates only this new versioned
// branch. No second login state machine, Source setter or registration engine.
function originalAbortFence(abortContext){
 if(!abortContext||types.isProxy(abortContext)||!Object.isFrozen(abortContext))fail('PQ_DEVICE_ABORT_CONTEXT_REQUIRED');
 exactPQRecord(abortContext,['signal'],'PQ_DEVICE_ABORT_CONTEXT_REQUIRED');
 const signal=abortContext.signal;if(types.isProxy(signal))fail('PQ_DEVICE_ABORT_CONTEXT_REQUIRED');
 const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get,reason=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'reason').get;
 try{aborted.call(signal);}catch{fail('PQ_DEVICE_ABORT_CONTEXT_REQUIRED');}
 return ()=>{if(aborted.call(signal))throw reason.call(signal);};
}
export async function openExistingProductSessionV4Read(options){
 exactPQRecord(options,['binding','storageKey','storage','device','deviceCurrent','abortContext','token','now','assertLocalCurrent']);
 const {binding,storageKey,storage,device,deviceCurrent:source,abortContext,token,now,assertLocalCurrent}=options;
 assertSource(source);const assertOriginalNotAborted=originalAbortFence(abortContext),c=context(device),contextBytes=canonicalJSON(c),nonces=new Set(),flights=new Set(),retainedOriginals=new Map();
 let closed=false,firstPresent=false,firstCause,originalRaw,session,expected,timeFloor=-Infinity,signing=false,closing;
 const active=()=>{if(firstPresent)throw firstCause;assertOriginalNotAborted();if(closed)fail('BUSINESS_READ_RETIRED');assertLocalCurrent();if(canonicalJSON(context(device))!==contextBytes)fail('PQ_DEVICE_CONTEXT_CHANGED');};
 const latch=cause=>{if(!firstPresent){firstPresent=true;firstCause=cause;}};
 const readback=async()=>{
  active();if(storage.revocationRequested?.()===true)fail('REVOCATION_PENDING');
  if(await storage.get(storageKey+':revoke')!==null)fail('REVOCATION_PENDING');active();
  const raw=await storage.get(storageKey);active();if(typeof raw!=='string'||Buffer.byteLength(raw)>16384)fail('SESSION_INACTIVE');
  const parsed=parseProductSession(JSON.parse(raw));const e=expectedFor(parsed,c,binding);
  if(originalRaw!==undefined&&raw!==originalRaw)fail('PQ_DEVICE_ORIGINAL_SESSION_CHANGED');originalRaw=raw;session=parsed;expected=e;
  if(await storage.get(storageKey+':revoke')!==null||storage.revocationRequested?.()===true)fail('REVOCATION_PENDING');active();
 };
 const time=async()=>{active();const at=await now();active();if(!(at instanceof Date)||!Number.isFinite(+at)||+at<timeFloor)fail('CLOCK_UNAVAILABLE');timeFloor=+at;if(at.toISOString()<session.issuedAt||at.toISOString()>=session.expiresAt)fail('SESSION_EXPIRED');return at;};
 await readback(); // No Source acquisition, network, key creation or signing.
 const execute=async input=>{
  const request=captureGET(input,session,c,binding);active();if(signing)fail('PQ_DEVICE_PROOF_ALREADY_ENTERED');signing=true;
  let op=null,held=null,selected=null,entered=false,failed=false,cause,proofResult;
  const select=e=>{if(!failed){failed=true;cause=e;}};
  try{
   await readback();const at=await time();await readback();
   held=await source.readCurrent(expected,abortContext);active();if(!held||typeof held!=='object')fail('PRODUCT_SESSION_DEVICE_CURRENT_NOT_SUPPLIED');
   await current(source,held,abortContext,active);selected=original(source,held,expected,originalRaw,at);await current(source,held,abortContext,active);
   const nonce=token();if(typeof nonce!=='string'||! /^[A-Za-z0-9_-]{32,64}$/.test(nonce)||nonces.has(nonce))fail('INVALID_RANDOM_SOURCE');nonces.add(nonce);
   const expiresAt=new Date(Math.min(+at+30000,Date.parse(session.expiresAt),Date.parse(selected.record.expiresAt))).toISOString();
   const unsigned=parseProductSessionHTTPProofV4Unsigned({version:'4',sessionBinding:session.sessionBinding,productId:session.productId,clientId:session.clientId,applicationId:session.applicationId,bundleId:session.bundleId,packageId:session.packageId,origin:session.origin,callback:session.callback,account:session.account,canonicalOwner:expected.canonicalOwner,deviceId:session.deviceId,deviceRegistrationId:expected.registrationId,deviceRegistrationRevision:expected.revision,deviceRegistrationDigest:expected.registrationDigest,method:'GET',path:request.path,bodyDigest:httpBodyDigest(''),nonce,issuedAt:at.toISOString(),expiresAt});
   // Native constructs/compares the SAME E5; no arbitrary raw signing port.
   encodeProductSessionHTTPProofV4Message(unsigned,expected.networkId);await current(source,held,abortContext,active);await readback();
   entered=true;try{op=await device.produceHTTPProof(Object.freeze({version:'4',networkId:expected.networkId,unsigned}),held,abortContext);}catch(error){if(error!==null&&(typeof error==='object'||typeof error==='function')&&Object.hasOwn(error,'partial'))op=error.partial;throw error;}
   active();if(!op||['readOriginalMember','assertCurrent','retire','join','close'].some(n=>typeof op[n]!=='function'))fail('PQ_NATIVE_PROOF_OPERATION_REQUIRED');
   if(op.assertCurrent()!==undefined)fail('PQ_NATIVE_PROOF_CURRENT_REFUSED');const raw=op.readOriginalMember();
   if(!(raw instanceof Uint8Array)||raw.buffer instanceof SharedArrayBuffer)fail('PQ_NATIVE_PROOF_BYTES_INVALID');const member=Buffer.from(raw);
   inspectProductSessionHTTPProofV4Data(member,{networkId:expected.networkId,unsigned,pkA:selected.record.pkA,pkB:selected.record.pkB});
   await current(source,held,abortContext,active);const after=await time();await readback();if(after.toISOString()>=expiresAt)fail('SESSION_EXPIRED');
   const latest=original(source,held,expected,originalRaw,after);if(!latest.bytes.equals(selected.bytes))fail('PQ_DEVICE_REGISTRATION_CHANGED');await current(source,held,abortContext,active);if(op.assertCurrent()!==undefined)fail('PQ_NATIVE_PROOF_CURRENT_REFUSED');
   proofResult=Object.freeze({version:'4',proofHeaderName:PRODUCT_SESSION_PROOF_HEADER_V4,proofHeader:encodeProductSessionProofHeaderV4(unsigned,member),body:'',signatureVerified:true,NativeAdmission:false,SourceAdmission:false});
  }catch(error){select(error);}
  // Adopt first, then retire/join/close this actual original operation once.
  // An UNKNOWN result is never retried or discarded to produce a new signature.
  if(op&&entered){try{const original=op.readOriginalMember();if(original instanceof Uint8Array&&!(original.buffer instanceof SharedArrayBuffer)&&original.length<=98304)retainedOriginals.set(op,Buffer.from(original));}catch(error){select(error);}}
  if(op){for(const name of ['retire','join','close']){try{if(typeof op[name]!=='function'||await op[name]()!==undefined)fail('PQ_NATIVE_PROOF_CUSTODY_UNKNOWN');}catch(error){select(error);}}}
  if(!failed){try{await current(source,held,abortContext,active);const end=await time();await readback();if(end.toISOString()>=decodeProductSessionProofHeaderV4(proofResult.proofHeader).expiresAt||!original(source,held,expected,originalRaw,end).bytes.equals(selected.bytes))fail('PQ_DEVICE_POST_CUSTODY_CHANGED');await current(source,held,abortContext,active);}catch(error){select(error);}}
  signing=false;if(failed){if(entered)latch(cause);throw cause;}if(op)retainedOriginals.delete(op);active();return proofResult;
 };
 return Object.freeze({
  capabilities:Object.freeze({kind:'existing-native-business-read-v4',algorithm:PQ_SUITE,identityGrant:false,nativeAdmission:false,connected:false,newSession:false}),
  createBusinessProof(input){const run=execute(input);flights.add(run);void run.finally(()=>flights.delete(run)).catch(()=>{});return run;},
  close(){closed=true;if(!closing)closing=Promise.allSettled([...flights]).then(()=>{if(firstPresent)throw firstCause;});return closing;},
 });
}
export function productSessionHTTPProofV4ReplayKey(header){const p=decodeProductSessionProofHeaderV4(header);return digestHex('YNX_PRODUCT_SESSION_HTTP_PROOF_V4_REPLAY',{version:'4',sessionBinding:p.sessionBinding,deviceRegistrationId:p.deviceRegistrationId,deviceRegistrationRevision:p.deviceRegistrationRevision,deviceRegistrationDigest:p.deviceRegistrationDigest,nonce:p.nonce});}
/** Same original Auth current and replay transaction must own this call. A
 * successful return remains DATA; the original host alone retains credentials. */
export async function verifyOriginalProductSessionHTTPProofV4(input){
 if(types.isProxy(input))fail('PQ_SCHEMA_INVALID');
 exactPQRecord(input,['headerName','header','request','expected','source','abortContext','at','consumeNonce']);
 if(types.isProxy(input)||types.isProxy(input.expected)||types.isProxy(input.request))fail('PQ_SCHEMA_INVALID');
 if(input.headerName!==PRODUCT_SESSION_PROOF_HEADER_V4)fail('PQ_DEVICE_HEADER_VERSION_REQUIRED');assertSource(input.source);exactPQRecord(input.expected,PRODUCT_SESSION_DEVICE_V4_EXPECTED_FIELDS);
 exactPQRecord(input.request,['method','path','body','requiredScopes']);
 const supplied=input.request.body;
 if(typeof supplied!=='string'&&(!(supplied instanceof Uint8Array)||supplied.buffer instanceof SharedArrayBuffer)||typeof supplied==='string'&&Buffer.byteLength(supplied)>16777216||supplied instanceof Uint8Array&&supplied.length>16777216)fail('HTTP_BINDING_MISMATCH');
 if(!Array.isArray(input.request.requiredScopes)||input.request.requiredScopes.length<1||input.request.requiredScopes.length>8)fail('SCOPE_WIDENING');
 const capturedRequest=Object.freeze({method:input.request.method,path:input.request.path,body:typeof supplied==='string'?supplied:Buffer.from(supplied),requiredScopes:Object.freeze(Array.from({length:input.request.requiredScopes.length},(_,i)=>input.request.requiredScopes[i]))}),capturedExpected=Object.freeze({...input.expected});
 if(!(input.at instanceof Date)||types.isProxy(input.at)||!Number.isFinite(Date.prototype.getTime.call(input.at)))fail('CLOCK_UNAVAILABLE');
 input=Object.freeze({...input,expected:capturedExpected,request:capturedRequest,at:new Date(Date.prototype.getTime.call(input.at))});
 if(!(input.at instanceof Date)||!Number.isFinite(+input.at)||typeof input.consumeNonce!=='function')fail('PQ_DEVICE_REPLAY_OWNER_REQUIRED');
 const active=originalAbortFence(input.abortContext);active();
 const held=await input.source.readCurrent(input.expected,input.abortContext);await current(input.source,held,input.abortContext,active);
 const raw=input.source.readSessionOriginal(held);if(typeof raw!=='string'||Buffer.byteLength(raw)>16384)fail('PQ_DEVICE_ORIGINAL_SESSION_CHANGED');const session=parseProductSession(JSON.parse(raw));if(session.version!=='4'||session.sessionBinding!==input.expected.sessionBinding)fail('PQ_DEVICE_SESSION_BINDING_MISMATCH');
 const selected=original(input.source,held,input.expected,raw,input.at),r=selected.record;
 for(const k of ['productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId','account'])if(session[k]!==input.expected[k])fail('PQ_DEVICE_SESSION_BINDING_MISMATCH');
 if(session.deviceRegistrationId!==r.registrationId||session.deviceRegistrationRevision!==r.revision||session.deviceRegistrationDigest!==input.expected.registrationDigest||session.accountAuthorization.networkId!==r.networkId||session.issuedAt>input.at.toISOString()||session.expiresAt<=input.at.toISOString())fail('PQ_DEVICE_SESSION_BINDING_MISMATCH');
 exactPQRecord(input.request,['method','path','body','requiredScopes']);if(typeof input.request.body!=='string'&&!(input.request.body instanceof Uint8Array))fail('HTTP_BINDING_MISMATCH');
 const p=decodeProductSessionProofHeaderV4(input.header),{member,...unsigned}=p;
 if(p.method!==input.request.method||p.path!==input.request.path||p.bodyDigest!==httpBodyDigest(input.request.body)||p.sessionBinding!==session.sessionBinding||p.account!==session.account||p.issuedAt<session.issuedAt||p.expiresAt>session.expiresAt)fail('HTTP_BINDING_MISMATCH');
 const scopes=input.request.requiredScopes;if(!Array.isArray(scopes)||scopes.length<1||scopes.length>8||scopes.some(s=>typeof s!=='string'||!session.scopes.includes(s))||new Set(scopes).size!==scopes.length||[...scopes].sort().join('\n')!==scopes.join('\n'))fail('SCOPE_WIDENING');
 const verified=inspectProductSessionHTTPProofForDeviceRecordV4Data(input.header,selected.bytes,{networkId:r.networkId,unsigned,at:input.at.toISOString()});
 await current(input.source,held,input.abortContext,active);const key=productSessionHTTPProofV4ReplayKey(input.header);
 if(await input.consumeNonce(Object.freeze({key,nonce:p.nonce,sessionBinding:p.sessionBinding,expiresAt:p.expiresAt}),held,input.abortContext)!==undefined)fail('PQ_DEVICE_REPLAY_REFUSED');
 await current(input.source,held,input.abortContext,active);if(!original(input.source,held,input.expected,raw,input.at).bytes.equals(selected.bytes))fail('PQ_DEVICE_REGISTRATION_CHANGED');
 return Object.freeze({session,proof:p,replayKey:key,signatureVerified:verified.signatureVerified,dataOnly:true,authorized:false,nativeAdmission:false});
}

installOriginalProductSessionV4ReadConsumer(openExistingProductSessionV4Read);
/** Inspect actual original Node rawHeaders. This enforces parsing budgets only;
 * it cannot attest a deployed client/server/host/proxy or admit a counterpart. */
export function readProductSessionV4BoundedHTTPHeaders(rawHeaders){
 if(types.isProxy(rawHeaders)||!Array.isArray(rawHeaders)||rawHeaders.length%2||rawHeaders.length>256)fail('PQ_DEVICE_HTTP_HEADERS_INVALID');let total=2,proof=null;
 for(let i=0;i<rawHeaders.length;i+=2){const name=rawHeaders[i],value=rawHeaders[i+1];if(typeof name!=='string'||! /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(name)||typeof value!=='string'||/[\r\n\0]/.test(value))fail('PQ_DEVICE_HTTP_HEADERS_INVALID');total+=Buffer.byteLength(name)+2+Buffer.byteLength(value)+2;if(total>262144)fail('PQ_DEVICE_HTTP_HEADER_BUDGET');const lower=name.toLowerCase();if(lower==='x-ynx-product-session-proof-v2')fail('PQ_DEVICE_HEADER_VERSION_REQUIRED');if(lower===PRODUCT_SESSION_PROOF_HEADER_V4){if(proof!==null||Buffer.byteLength(value)>196608)fail('PQ_DEVICE_HTTP_HEADER_BUDGET');proof=value;}}
 if(proof===null)fail('PQ_DEVICE_HEADER_VERSION_REQUIRED');decodeProductSessionProofHeaderV4(proof);return Object.freeze({headerName:PRODUCT_SESSION_PROOF_HEADER_V4,proofHeader:proof,totalBytes:total,proofHeaderMaxBytes:196608,totalHeaderMaxBytes:262144,budgetOnly:true,counterpartDeployed:false,nativeAdmission:false});
}
