import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {canonicalJSON,createProductSessionRequest,productSessionRequestDigest,productPlatformBinding,ynxAddressFromEVM} from '@ynx-chain/wallet-auth';
import {inspectProductSessionDeviceRegistrationOriginalV4Data} from '@ynx-chain/wallet-auth/product-session-device-registration-v4';
import {FileTransactionIntentStore} from '../src/transaction-intent-store.mjs';
import {parseSessionOriginal,sessionOriginalCause,SESSION_V4_RESPONSE_MAX_BYTES} from '../src/wallet-session-original.mjs';
import {PRODUCT_SESSION_REGISTRY} from '../src/wallet-auth-contract.mjs';

// PUBLIC structural records, deliberately invalid dummy proofs. No signer,
// key, Native Source, account permission, HTTP or registration is exercised.
const account='0x'+'12'.repeat(20),at=new Date('2026-10-31T00:00:00.000Z');
function v4(id='original'){
 const b=productPlatformBinding(PRODUCT_SESSION_REGISTRY,'developer','macos');
 const reg={version:'4',registrationId:'00000000-0000-4000-8000-000000000001',networkId:'a'.repeat(64),canonicalOwner:account,
  productId:'developer',clientId:b.clientId,platform:'macos',applicationId:b.applicationId,bundleId:b.bundleId,packageId:b.packageId,
  origin:b.origin,callback:b.callback,deviceId:'PUBLIC-v4-device',generation:'1',revision:'1',pkA:'11'.repeat(2592),pkB:'22'.repeat(64),
  registeredAt:new Date(+at-1000).toISOString(),expiresAt:new Date(+at+3600000).toISOString(),revokedAt:null};
 const registrationOriginal=canonicalJSON(reg),deviceRegistrationDigest=inspectProductSessionDeviceRegistrationOriginalV4Data(Buffer.from(registrationOriginal)).registrationDigest;
 const request=createProductSessionRequest(PRODUCT_SESSION_REGISTRY,{productId:'developer',platform:'macos',deviceId:reg.deviceId,
  deviceAlgorithm:'ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512',deviceRegistrationId:reg.registrationId,
  deviceRegistrationRevision:'1',deviceRegistrationDigest,scopes:[b.scopes[0]],purpose:'PUBLIC registration journal test',nonce:('nonce-'+id).padEnd(32,'n'),state:('state-'+id).padEnd(32,'s')},at);
 const row={version:2,account,requestId:'request-'+id,requestDigest:productSessionRequestDigest(PRODUCT_SESSION_REGISTRY,request,at),request,
  createdAt:at.toISOString(),approval:null,deliveryAttempted:false,cleanupComplete:false,firstCause:null,storageCause:null,cleanupCause:null,
  operationId:'pending-'+id,registrationOriginal,pairSubmission:null};
 const {purpose,issuedAt,expiresAt,...bound}=request;
 const approval={...bound,result:'approved',requestDigest:row.requestDigest,account:ynxAddressFromEVM(account),
  accountAuthorization:{canonicalOwner:account,networkId:reg.networkId},issuedAt,expiresAt,walletProof:'AA'};
 const original=canonicalJSON(approval),wrapped={version:'4',original};
 const data={operationId:row.operationId,requestDigest:row.requestDigest,registrationOriginal,
  originalBody:canonicalJSON({operationId:row.operationId,request,registrationOriginal,registrationMember:'AA',approval}),
  dataOnly:true,registered:false,SourceAdmission:false,NativeAdmission:false};
 return {row,approval:wrapped,data};
}
function legacy(id='legacy'){
 const b=productPlatformBinding(PRODUCT_SESSION_REGISTRY,'developer','macos');
 const key=Buffer.from('036b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296','hex').toString('base64url');
 const request=createProductSessionRequest(PRODUCT_SESSION_REGISTRY,{productId:'developer',platform:'macos',deviceId:'PUBLIC-legacy-device',deviceKey:key,
  scopes:[b.scopes[0]],purpose:'PUBLIC legacy journal',nonce:('nonce-'+id).padEnd(32,'n'),state:('state-'+id).padEnd(32,'s')},at);
 return {version:1,account,requestId:id,requestDigest:productSessionRequestDigest(PRODUCT_SESSION_REGISTRY,request,at),request,createdAt:at.toISOString(),
  approval:null,deliveryAttempted:false,cleanupComplete:false,firstCause:null,storageCause:null,cleanupCause:null};
}
async function setup(t,id){
 const dir=await fs.mkdtemp(path.join(tmpdir(),'ynx-v4-session-journal-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const filePath=path.join(dir,'journal.json'),store=new FileTransactionIntentStore({filePath}),f=v4(id),guard=()=>{};
 const token=await store.reserveSessionOriginal(f.row,guard);store.captureSessionOriginal(token,f.approval);await store.saveSessionOriginal(token);
 return {...f,filePath,store,token,guard,cold:()=>new FileTransactionIntentStore({filePath})};
}
test('V4 stores exact approval.original as unverified DATA and old v1 keeps its exact field contract',()=>{
 const f=v4(),row=parseSessionOriginal({...f.row,approval:f.approval});assert.equal(row.approval.original,f.approval.original);
 assert.equal(Object.isFrozen(row.approval),true);assert.equal(Object.hasOwn(row,'registered'),false);
 const old=legacy();assert.deepEqual(parseSessionOriginal(old),old);assert.throws(()=>parseSessionOriginal({...old,operationId:'not-a-v1-field'}));
 assert.throws(()=>parseSessionOriginal({...f.row,approval:{...f.approval,verified:true}}));
 const a=JSON.parse(f.approval.original);a.walletProof='not-a-valid-signature';assert.doesNotThrow(()=>parseSessionOriginal({...f.row,approval:{version:'4',original:canonicalJSON(a)}}),'journal syntax is not crypto authority');
});
test('whole original body and entered are one durable update before the only permitted effect; cold is query-only',async t=>{
 const f=await setup(t),before=JSON.parse(await fs.readFile(f.filePath,'utf8'));assert.equal(before.sessionOriginals[0].pairSubmission,null);
 let posts=0;const first=await f.store.beginSessionPairSubmission(f.token,f.data,f.guard);if(first.created)posts++;
 const state=JSON.parse(await fs.readFile(f.filePath,'utf8')),p=state.sessionOriginals[0].pairSubmission;
 assert.equal(p.originalBody,f.data.originalBody);assert.equal(p.entered,true);assert.equal(posts,1);
 assert.equal((await f.store.beginSessionPairSubmission(f.token,f.data,f.guard)).created,false);
 const cold=f.cold(),read=await cold.readSessionPairSubmission(account,f.row.requestDigest,f.guard);
 assert.equal(read.queryOnly,true);assert.equal(read.canRetry,false);assert.equal(read.registered,false);assert.equal(read.storageConfirmed,true);
 assert.equal(read.pairSubmission.originalBody,f.data.originalBody);assert.throws(()=>cold.beginSessionPairSubmission(f.token,f.data,f.guard));
 const [summary]=await cold.sessionRecoverySummaries(account,f.guard);assert.equal(summary.queryOnly,true);assert.equal(summary.operationId,f.row.operationId);assert.equal(summary.pairStatus,'entry-retained');
 await assert.rejects(cold.reserveSessionOriginal(f.row,f.guard));assert.equal(posts,1);
});
for(const lost of ['entry-ack','late-lock'])test('V4 '+lost+' never releases a new effect and cold retains the same entered body',async t=>{
 const f=await setup(t,lost),replace=f.store.filePolicy.replace.bind(f.store.filePolicy);let current=true,tripped=false,posts=0;
 f.store.filePolicy.replace=async(...args)=>{const next=JSON.parse(await fs.readFile(args[0],'utf8'));await replace(...args);
  if(!tripped&&next.sessionOriginals[0].pairSubmission){tripped=true;if(lost==='entry-ack')throw false;current=false;}};
 const guard=()=>{if(!current)throw Object.assign(Error('late lock'),{code:'PUBLIC_LATE_LOCK'});};
 await assert.rejects(async()=>{const r=await f.store.beginSessionPairSubmission(f.token,f.data,guard);if(r.created)posts++;});
 assert.equal(posts,0);assert.equal(tripped,true);const row=await f.cold().readSessionPairSubmission(account,f.row.requestDigest,()=>{});
 assert.equal(row.pairSubmission.originalBody,f.data.originalBody);assert.equal(row.queryOnly,true);
 assert.equal((await f.store.beginSessionPairSubmission(f.token,f.data,()=>{})).created,false);
});
test('write failure before replacement fences the warm owner; readback preserves uncertainty without manufacturing disk entry',async t=>{
 const f=await setup(t),replace=f.store.filePolicy.replace.bind(f.store.filePolicy);let armed=true;
 f.store.filePolicy.replace=async(...args)=>{if(armed){armed=false;throw 0;}return replace(...args);};
 await assert.rejects(f.store.beginSessionPairSubmission(f.token,f.data,f.guard));
 assert.equal(JSON.parse(await fs.readFile(f.filePath,'utf8')).sessionOriginals[0].pairSubmission,null);
 const held=await f.store.readSessionPairSubmission(account,f.row.requestDigest,f.guard);assert.equal(held.status,'entry-save-unknown');assert.equal(held.storageConfirmed,false);
 await assert.rejects(f.store.beginSessionPairSubmission(f.token,f.data,f.guard),e=>e.data?.code==='SESSION_PAIR_OUTCOME_UNKNOWN');
 assert.equal((await f.cold().readSessionPairSubmission(account,f.row.requestDigest,f.guard)).canRetry,false);
});
test('response capture is synchronous and storage-only after late lock; malformed response stays opaque, never registration success',async t=>{
 const f=await setup(t);await f.store.beginSessionPairSubmission(f.token,f.data,f.guard);
 const raw='{PUBLIC malformed response';f.store.captureSessionPairResponse(f.token,raw);
 assert.equal(f.store.retainedSessionPairResponse(f.token).original,raw);assert.equal(f.store.retainedSessionPairResponse(f.token).storageConfirmed,false);
 assert.deepEqual(await f.store.saveSessionPairResponse(f.token),{stored:true,queryOnly:true,registered:false,operationId:f.row.operationId});
 const read=await f.cold().readSessionPairSubmission(account,f.row.requestDigest,()=>{});assert.equal(read.status,'response-retained');assert.equal(read.pairSubmission.responseOriginal,raw);
 assert.equal(read.newSession,false);assert.throws(()=>f.store.captureSessionPairResponse(f.token,'replacement'),e=>e.data?.code==='SESSION_PAIR_RESPONSE_ALREADY_CAPTURED');
});
test('lost response-save ACK retains the first complete original, separate storage/cleanup causes and storage-only recovery',async t=>{
 const f=await setup(t);await f.store.beginSessionPairSubmission(f.token,f.data,f.guard);const raw='{"PUBLIC":"original response"}';
 f.store.captureSessionPairResponse(f.token,raw);const replace=f.store.filePolicy.replace.bind(f.store.filePolicy);let tripped=false;
 f.store.filePolicy.replace=async(...args)=>{const next=JSON.parse(await fs.readFile(args[0],'utf8'));await replace(...args);if(!tripped&&next.sessionOriginals[0].pairSubmission?.responseOriginal){tripped=true;throw false;}};
 await assert.rejects(f.store.saveSessionPairResponse(f.token));assert.equal(f.store.retainedSessionPairResponse(f.token).original,raw);
 assert.equal((await f.cold().readSessionPairSubmission(account,f.row.requestDigest,()=>{})).pairSubmission.responseOriginal,raw);
 await f.store.recordSessionFailure(f.token,{firstPresent:true,first:0,cleanupPresent:true,cleanup:false});
 await f.store.saveSessionPairResponse(f.token);const record=await f.cold().readSessionOriginal(account,f.row.requestDigest,()=>{});
 assert.deepEqual(record.firstCause,sessionOriginalCause(0));assert.deepEqual(record.cleanupCause,sessionOriginalCause(false));assert.deepEqual(record.storageCause,sessionOriginalCause(false));
});
test('wrong operation/digest/body/registration/approval/URL fields refuse before any entry is persisted',async t=>{
 const f=await setup(t);for(const edit of [d=>{d.operationId='other';},d=>{d.requestDigest='0'.repeat(64);},d=>{d.registrationOriginal='{}';},d=>{d.originalBody+=' ';},d=>{d.url='https://other.invalid';},d=>{const b=JSON.parse(d.originalBody);b.approval.requestDigest='0'.repeat(64);d.originalBody=canonicalJSON(b);},d=>{d.originalBody='x'.repeat(393217);}]){
  const d={...f.data};edit(d);assert.throws(()=>f.store.beginSessionPairSubmission(f.token,d,f.guard));
 }
 assert.equal(JSON.parse(await fs.readFile(f.filePath,'utf8')).sessionOriginals[0].pairSubmission,null);
});
test('V4 parser bounds originals and rejects accessor/proxy inputs without executing their hooks',()=>{
 const f=v4();let called=0;const bad={...f.row};Object.defineProperty(bad,'registrationOriginal',{enumerable:true,get(){called++;return f.row.registrationOriginal;}});
 assert.throws(()=>parseSessionOriginal(bad));assert.throws(()=>parseSessionOriginal(new Proxy(f.row,{getPrototypeOf(){called++;return Object.prototype;}})));assert.equal(called,0);
 assert.throws(()=>parseSessionOriginal({...f.row,approval:{version:'4',original:'x'.repeat(196609)}}));
 assert.throws(()=>parseSessionOriginal({...f.row,registrationOriginal:'x'.repeat(16385)}));
});
test('response budget cannot be consumed by later slots; existing originals survive capacity refusal and max raw response still saves',async t=>{
 const f=await setup(t);await f.store.beginSessionPairSubmission(f.token,f.data,f.guard);
 for(let i=0;i<2;i++){const old=legacy('old-'+i),token=await f.store.reserveSessionOriginal(old,()=>{});f.store.captureSessionOriginal(token,{version:'2',result:'approved',requestDigest:old.requestDigest,account:ynxAddressFromEVM(account),padding:'x'.repeat(240000)});await f.store.saveSessionOriginal(token);}
 const before=JSON.parse(await fs.readFile(f.filePath,'utf8')),third=legacy('blocked-old'),token=await f.store.reserveSessionOriginal(third,()=>{});
 f.store.captureSessionOriginal(token,{version:'2',result:'approved',requestDigest:third.requestDigest,account:ynxAddressFromEVM(account),padding:'x'.repeat(240000)});await assert.rejects(f.store.saveSessionOriginal(token));
 const after=JSON.parse(await fs.readFile(f.filePath,'utf8'));assert.deepEqual(after.sessionOriginals.slice(0,3),before.sessionOriginals);
 const raw='"'.repeat(SESSION_V4_RESPONSE_MAX_BYTES);f.store.captureSessionPairResponse(f.token,raw);await f.store.saveSessionPairResponse(f.token);
 assert.equal((await f.cold().readSessionPairSubmission(account,f.row.requestDigest,()=>{})).pairSubmission.responseOriginal,raw);
 assert.ok((await fs.stat(f.filePath)).size<=1048576);
});
test('oversized returned original is retained privately even when it cannot be saved; no second capture or submission follows',async t=>{
 const f=await setup(t);await f.store.beginSessionPairSubmission(f.token,f.data,f.guard);const raw='x'.repeat(196609);f.store.captureSessionPairResponse(f.token,raw);
 await assert.rejects(f.store.saveSessionPairResponse(f.token));assert.equal(f.store.retainedSessionPairResponse(f.token).original,raw);assert.equal(f.store.retainedSessionPairResponse(f.token).storageConfirmed,false);
 assert.equal((await f.store.beginSessionPairSubmission(f.token,f.data,f.guard)).created,false);
});
test('close blocks an unsaved captured response and a live remote wait; storage-only completion can finish after close',async t=>{
 const f=await setup(t);await f.store.beginSessionPairSubmission(f.token,f.data,f.guard);
 await assert.rejects(f.store.assertPQProgressSafeToClose(),e=>e.data?.code==='SESSION_PAIR_CLOSE_UNCONFIRMED');
 f.store.captureSessionPairResponse(f.token,'{"PUBLIC":"returned"}');
 await assert.rejects(f.store.assertPQProgressSafeToClose(),e=>e.data?.code==='SESSION_PAIR_CLOSE_UNCONFIRMED');
 await f.store.saveSessionPairResponse(f.token);assert.equal((await f.store.assertPQProgressSafeToClose()).safe,true);
 assert.throws(()=>f.store.beginSessionPairSubmission(f.token,f.data,f.guard),e=>e.data?.code==='SESSION_PAIR_CLOSING');
});
test('close arriving during the entry write fences SDK submit and keeps the atomically stored original',async t=>{
 const f=await setup(t),replace=f.store.filePolicy.replace.bind(f.store.filePolicy);let closing;
 f.store.filePolicy.replace=async(...args)=>{await replace(...args);closing=f.store.assertPQProgressSafeToClose();};
 await assert.rejects(f.store.beginSessionPairSubmission(f.token,f.data,f.guard),e=>e.data?.code==='SESSION_PAIR_CLOSING');
 await closing;assert.equal((await f.cold().readSessionPairSubmission(account,f.row.requestDigest,f.guard)).pairSubmission.originalBody,f.data.originalBody);
});
test('uncertain entry can only flush its same body locally, then close with a retained UNKNOWN',async t=>{
 const f=await setup(t),replace=f.store.filePolicy.replace.bind(f.store.filePolicy);let lost=true;
 f.store.filePolicy.replace=async(...args)=>{if(lost){lost=false;throw false;}return replace(...args);};
 await assert.rejects(f.store.beginSessionPairSubmission(f.token,f.data,f.guard));
 await assert.rejects(f.store.assertPQProgressSafeToClose(),e=>e.data?.code==='SESSION_PAIR_CLOSE_UNCONFIRMED');
 assert.deepEqual(await f.store.saveSessionPairEntry(f.token),{stored:true,queryOnly:true,canRetry:false});
 await f.store.recordSessionFailure(f.token,{firstPresent:true,first:false,cleanupComplete:true});
 assert.equal((await f.store.assertPQProgressSafeToClose()).safe,true);
 const cold=await f.cold().readSessionPairSubmission(account,f.row.requestDigest,f.guard);assert.equal(cold.canRetry,false);assert.equal(cold.pairSubmission.originalBody,f.data.originalBody);
});
test('warm readback refuses a replaced pending operation even if its request digest and approval are unchanged',async t=>{
 const f=await setup(t);await f.store.beginSessionPairSubmission(f.token,f.data,f.guard);const state=JSON.parse(await fs.readFile(f.filePath,'utf8')),row=state.sessionOriginals[0];
 row.operationId='another-pending';row.pairSubmission.operationId=row.operationId;const body=JSON.parse(row.pairSubmission.originalBody);body.operationId=row.operationId;row.pairSubmission.originalBody=canonicalJSON(body);
 await fs.writeFile(f.filePath,JSON.stringify(state));
 await assert.rejects(f.store.readSessionPairSubmission(account,f.row.requestDigest,f.guard),e=>e.data?.code==='SESSION_PAIR_ORIGINAL_CONFLICT');
 assert.equal(f.store.retainedSessionPairResponse(f.token).captured,false);
});
test('V4 reserve does not return a signing token when close arrives during its durable write',async t=>{
 const dir=await fs.mkdtemp(path.join(tmpdir(),'ynx-v4-reserve-close-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const filePath=path.join(dir,'journal.json'),store=new FileTransactionIntentStore({filePath}),f=v4(),replace=store.filePolicy.replace.bind(store.filePolicy);let closing;
 store.filePolicy.replace=async(...args)=>{await replace(...args);closing=store.assertPQProgressSafeToClose();};
 await assert.rejects(store.reserveSessionOriginal(f.row,()=>{}),e=>e.data?.code==='SESSION_PAIR_CLOSING');await closing;
 const cold=await new FileTransactionIntentStore({filePath}).readSessionPairSubmission(account,f.row.requestDigest,()=>{});
 assert.equal(cold.queryOnly,true);assert.equal(cold.pairSubmission,null);
});
