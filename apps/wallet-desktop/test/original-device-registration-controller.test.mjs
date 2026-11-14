import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {registerHooks} from 'node:module';
import {DesktopKeyLifecycle} from '../src/key-lifecycle.mjs';
import {FileTransactionIntentStore} from '../src/transaction-intent-store.mjs';
import {PRODUCT_SESSION_REGISTRY} from '../src/wallet-auth-contract.mjs';
import {configurePUBLICRegistration,createPUBLICSelection,createPUBLICRegistrationEvent} from './original-device-registration-public.fixture.mjs';
const PUBLICFixture=new URL('./original-device-registration-public.fixture.mjs',import.meta.url).href;
const sdkShim='data:text/javascript,'+encodeURIComponent(`import * as fixture from ${JSON.stringify(PUBLICFixture)}; export async function openOriginalProductDeviceV4RegistrationClient(...args){return globalThis.__deviceRegistrationOpen ? globalThis.__deviceRegistrationOpen(...args) : fixture.openOriginalProductDeviceV4RegistrationClient(...args);}`);
const authorityURL=new URL('../src/desktop-wallet-authority.mjs',import.meta.url).href,controllerURL=new URL('../src/original-device-registration-controller.mjs',import.meta.url).href;
registerHooks({resolve(specifier,context,next){
 if(context.parentURL===controllerURL&&specifier==='@ynx-chain/wallet-auth/original-product-device-v4-registration-client')return {url:sdkShim,shortCircuit:true};
 if(context.parentURL===controllerURL&&specifier==='electron'||
   context.parentURL===authorityURL&&['@ynx-chain/wallet-auth/product-session-pq-v4-codec','@ynx-chain/wallet-auth/pq-wallet-key-backup'].includes(specifier))return {url:PUBLICFixture,shortCircuit:true};
 return next(specifier,context);
}});
const {DesktopWalletAuthority,MemoryPermissionStore}=await import(authorityURL);
const {createOriginalDeviceRegistrationController,readOriginalDeviceRegistrationApprovedPublicDATA}=await import(controllerURL);
const account='0x'+'12'.repeat(20),networkId='a'.repeat(64);
async function setup(t,mode='normal'){
 const dir=await fs.mkdtemp(path.join(tmpdir(),'ynx-v4-registration-controller-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const filePath=path.join(dir,'journal.json'),store=new FileTransactionIntentStore({filePath});
 const lifecycle=new DesktopKeyLifecycle({authorizer:{available:()=>true,authenticate:async()=>{},inProcess:true},focused:()=>true,schedule:()=>null,unschedule:()=>{}});lifecycle.setAccount(account);await lifecycle.unlock();
 const f={mode,lifecycle,store,filePath,at:new Date(),registry:PRODUCT_SESSION_REGISTRY,counts:{open:0,readReview:0,prepare:0,submit:0,clientClose:0,plan:0,sign:0,verify:0,accountAcquire:0,accountClose:0,partialRetire:0,partialJoin:0,partialClose:0},sourceRetired:false,readDisk:async()=>JSON.parse(await fs.readFile(filePath,'utf8'))};
 configurePUBLICRegistration(f);f.selection=createPUBLICSelection(account,networkId);
 const view=Object.freeze({version:'YNX-PRODUCT-SESSION-ACCOUNT-POLICY/v1',networkId,canonicalOwner:account,
  checkpoint:Object.freeze({kind:'trusted-node-committed/v1',height:'100',blockHash:'22'.repeat(32)}),policyVersion:'YNX-ACCOUNT-POLICY/v1',algorithmVersion:'YNX-BATCH/v0.1',
  activeRecord:Object.freeze({revision:'1',registeredAt:'10',activeFrom:'20',pkA:'11'.repeat(2592),pkB:'22'.repeat(64)}),observedAt:f.at.toISOString(),expiresAt:new Date(+f.at+60000).toISOString()});
 f.policyView=view;
 const recognized=new WeakSet();const source=()=>{let retired=false;f.sourceRetired=false;const r={readOriginal:()=>view,assertCurrent(){if(f.sourceFailurePresent)throw f.sourceFailure;if(retired||f.sourceRevoked)throw Error('PUBLIC source retired');},async recheck(){},retire(){retired=true;f.sourceRetired=true;},async join(){},async close(){f.counts.accountClose++;}};recognized.add(r);return r;};
 const vault={authorization:lifecycle,async status(){return {initialized:true,account};},async withPQKeys(_binding,action,permission){permission.assert();const result=action(Object.freeze({PUBLICHandle:true}));if(mode==='sign-late-lock')lifecycle.lock();permission.assert();return result;}};
 const authority=new DesktopWalletAuthority({vault,permissions:new MemoryPermissionStore(),transactionSender:{submissions:{intentStore:store}},pqNetworkId:networkId,
  pqSessionSource:async()=>{f.counts.accountAcquire++;if(mode==='no-account-source')throw Object.assign(Error('PUBLIC missing'),{code:'PUBLIC_SOURCE_MISSING'});return source();},pqSessionRecognized:r=>recognized.has(r)});
 const originalApprove=authority.approveOriginalDeviceRegistration.bind(authority);
 authority.approveOriginalDeviceRegistration=(port,permission)=>{f.originalPort=port;f.onAccountEntry?.();return originalApprove(port,permission);};
 const controller=createOriginalDeviceRegistrationController({vault,networkId,authority});
 f.vault=vault;f.authority=authority;f.controller=controller;f.run=op=>lifecycle.run(op);f.event=createPUBLICRegistrationEvent(new URL('../src/index.html',import.meta.url).href);
 f.prepare=()=>f.run(()=>controller.prepareReview(f.selection));return f;
}
// Actual Main authority, lifecycle, journal and canonical plan construction;
// Native/Source/crypto/HTTP are PUBLIC controls above, not real authorization.
test('normal original account approval keeps Source alive through one durable pair submit and stops at original challenge',async t=>{
 const f=await setup(t),pending=await f.prepare();assert.equal(pending.method,'ynx_registerProductDeviceV4');assert.equal(f.counts.sign,0);
 const result=await f.run(()=>f.controller.approveOriginal(f.event,pending.id));assert.equal(result.phase,'awaiting-original-challenge');
 assert.equal(result.registered,false);assert.equal(result.newSession,false);assert.equal(result.accountApprovalSaved,true);
 assert.equal(f.counts.sign,1);assert.equal(f.counts.prepare,1);assert.equal(f.counts.submit,1);assert.equal(f.counts.clientClose,1);assert.equal(f.counts.accountClose,1);
 const row=(await f.readDisk()).sessionOriginals[0];assert.equal(row.approval.version,'4');assert.equal(row.pairSubmission.entered,true);assert.ok(row.pairSubmission.responseOriginal);assert.equal(row.cleanupComplete,true);
 await assert.rejects(f.run(()=>f.controller.approveOriginal(f.event,pending.id)),{code:'DEVICE_REGISTRATION_REVIEW_ALREADY_DECIDED'});
 const read=await f.run(()=>f.controller.readOriginalPairOutcome(row.requestDigest));assert.equal(read.queryOnly,true);assert.equal(read.canRetry,false);assert.equal(f.counts.submit,1);
 await f.controller.close();
});
test('rejecting the independent account review never enters keys, journal or SDK proof/HTTP',async t=>{
 const f=await setup(t),p=await f.prepare();await f.run(()=>f.controller.rejectOriginal(p.id));
 assert.equal(f.counts.sign,0);assert.equal(f.counts.prepare,0);assert.equal(f.counts.submit,0);await assert.rejects(fs.readFile(f.filePath));
 await assert.rejects(f.run(()=>f.controller.approveOriginal(f.event,p.id)));assert.equal(f.counts.accountAcquire,0);
});
test('creation result DTO, injected client and a foreign approval frame cannot grant account approval',async t=>{
 const f=await setup(t);assert.throws(()=>createOriginalDeviceRegistrationController({vault:f.vault,networkId,authority:f.authority,openClient:()=>{}}));
 await assert.rejects(f.run(()=>f.controller.prepareReview({registered:true})));const p=await f.prepare();
 await assert.rejects(f.run(()=>f.controller.approveOriginal({...f.event,senderFrame:{url:f.event.senderFrame.url}},p.id)),e=>e.data?.code==='UNTRUSTED_WALLET_FRAME');
 assert.equal(f.counts.sign,0);assert.equal(f.counts.submit,0);await f.controller.close();
});
for(const mode of ['sign-late-lock','late-lock','http-false','prepare-false','lost-late-abort','non-http-partial'])test('original '+mode+' retains only actual returned originals and never signs or submits a replacement',async t=>{
 const f=await setup(t,mode),p=await f.prepare();await assert.rejects(f.run(()=>f.controller.approveOriginal(f.event,p.id)));
 const row=(await f.readDisk()).sessionOriginals[0];assert.equal(row.approval.original,f.approvalOriginal);assert.equal(f.counts.sign,1);
 assert.equal(f.counts.submit,['sign-late-lock','prepare-false'].includes(mode)?0:1);
 if(mode==='late-lock')assert.ok(row.pairSubmission.responseOriginal,'real returned envelope saved before lock refusal');
 if(['lost-late-abort','non-http-partial','http-false'].includes(mode))assert.equal(row.pairSubmission.responseOriginal,null,'no fabricated HTTP response from progress or Native partial');
 if(['http-false','prepare-false'].includes(mode))assert.deepEqual(row.firstCause,{kind:'boolean',value:false,code:null});
 assert.equal(f.controller.readStatusDATA().registered,false);await assert.rejects(f.run(()=>f.controller.approveOriginal(f.event,p.id)));
});
test('an absent account Source blocks only this effect before journal/key entry and drains the original SDK client',async t=>{
 const f=await setup(t,'no-account-source'),p=await f.prepare();await assert.rejects(f.run(()=>f.controller.approveOriginal(f.event,p.id)));
 assert.equal(f.counts.sign,0);assert.equal(f.counts.prepare,0);assert.equal(f.counts.submit,0);assert.equal(f.counts.clientClose,1);await assert.rejects(fs.readFile(f.filePath));
});
test('SDK acquisition partial is adopted and drained in retire/join/close order',async t=>{
 const f=await setup(t,'open-partial');await assert.rejects(f.prepare(),{code:'PUBLIC_ACQUIRE'});assert.equal(f.counts.partialRetire,1);assert.equal(f.counts.partialJoin,1);assert.equal(f.counts.partialClose,1);assert.equal(f.counts.sign,0);assert.equal(f.controller.readStatusDATA().cleanupUnresolved,true);await assert.rejects(f.controller.close(),{code:'DEVICE_REGISTRATION_PARTIAL_RELEASE_UNCONFIRMED'});
});
test('partial waits for retire and close once but lacks a physical release witness',async t=>{
 const f=await setup(t),events=[];let releaseRetire,releaseClose;
 const retireWait=new Promise(r=>{releaseRetire=r;}),closeWait=new Promise(r=>{releaseClose=r;});
 const original=Object.assign(Error('PUBLIC acquisition failed'),{code:'PUBLIC_ACQUIRE',partial:{async retire(){events.push('retire');await retireWait;},join(){events.push('join');},async close(){events.push('close');await closeWait;}}});
 globalThis.__deviceRegistrationOpen=async()=>{throw original;};t.after(()=>{delete globalThis.__deviceRegistrationOpen;});
 const rejected=assert.rejects(f.prepare(),e=>e===original);await new Promise(r=>setImmediate(r));assert.deepEqual(events,['retire']);
 const c1=f.controller.close(),c2=f.controller.close();releaseRetire();await new Promise(r=>setImmediate(r));assert.deepEqual(events,['retire','join','close']);
 releaseClose();await rejected;await Promise.all([assert.rejects(c1,{code:'DEVICE_REGISTRATION_PARTIAL_RELEASE_UNCONFIRMED'}),assert.rejects(c2,{code:'DEVICE_REGISTRATION_PARTIAL_RELEASE_UNCONFIRMED'})]);
 assert.equal(f.controller.readStatusDATA().firstCauseCode,'PUBLIC_ACQUIRE');assert.equal(f.controller.readStatusDATA().cleanupUnresolved,true);
});
test('async partial retire rejection preserves cleanup cause and original acquisition failure',async t=>{
 const f=await setup(t),events=[],failure=false,original=Object.assign(Error('PUBLIC acquisition failed'),{code:'PUBLIC_ACQUIRE',partial:{async retire(){events.push('retire');throw failure;},join(){events.push('join');},close(){events.push('close');}}});
 globalThis.__deviceRegistrationOpen=async()=>{throw original;};t.after(()=>{delete globalThis.__deviceRegistrationOpen;});
 await assert.rejects(f.prepare(),e=>e===original);await assert.rejects(f.controller.close(),e=>e===failure);
 assert.deepEqual(events,['retire','join','close']);assert.equal(f.controller.readStatusDATA().firstCauseCode,'PUBLIC_ACQUIRE');
});
test('partial join pending prevents close and preserves unresolved custody',async t=>{
 const f=await setup(t),events=[],original=Object.assign(Error('PUBLIC acquisition failed'),{code:'PUBLIC_ACQUIRE',partial:{retire(){events.push('retire');},join(){events.push('join');return false;},close(){events.push('close');}}});
 globalThis.__deviceRegistrationOpen=async()=>{throw original;};t.after(()=>{delete globalThis.__deviceRegistrationOpen;});
 await assert.rejects(f.prepare(),e=>e===original);await assert.rejects(f.controller.close(),{code:'DEVICE_REGISTRATION_PARTIAL_CLEANUP_PENDING'});
 assert.deepEqual(events,['retire','join']);assert.equal(f.controller.readStatusDATA().cleanupUnresolved,true);
});
test('partial close rejection is retained without repeat cleanup',async t=>{
 const f=await setup(t),events=[],failure=Error('PUBLIC close failed'),original=Object.assign(Error('PUBLIC acquisition failed'),{code:'PUBLIC_ACQUIRE',partial:{retire(){events.push('retire');},join(){events.push('join');},close(){events.push('close');throw failure;}}});
 globalThis.__deviceRegistrationOpen=async()=>{throw original;};t.after(()=>{delete globalThis.__deviceRegistrationOpen;});
 await assert.rejects(f.prepare(),e=>e===original);await assert.rejects(f.controller.close(),e=>e===failure);await assert.rejects(f.controller.close(),e=>e===failure);
 assert.deepEqual(events,['retire','join','close']);assert.equal(f.controller.readStatusDATA().firstCauseCode,'PUBLIC_ACQUIRE');
});
test('late SDK acquisition is closed once when controller is already closing',async t=>{
 const f=await setup(t);let release,started;const entered=new Promise(r=>{started=r;}),wait=new Promise(r=>{release=r;}),calls=[];
 globalThis.__deviceRegistrationOpen=async()=>{started();await wait;return {readOriginalRegistrationReviewDATA(){calls.push('review');},async close(){calls.push('close');}};};t.after(()=>{delete globalThis.__deviceRegistrationOpen;});
 const rejected=assert.rejects(f.prepare());await entered;const closing=f.controller.close();release();await rejected;await closing;assert.deepEqual(calls,['close']);
});
test('lost whole-body ACK stops the real callee before SDK submit and cold outcome is query-only',async t=>{
 const f=await setup(t),replace=f.store.filePolicy.replace.bind(f.store.filePolicy);let lost=false;
 f.store.filePolicy.replace=async(...args)=>{const next=JSON.parse(await fs.readFile(args[0],'utf8'));await replace(...args);if(!lost&&next.sessionOriginals[0].pairSubmission){lost=true;throw false;}};
 const p=await f.prepare();await assert.rejects(f.run(()=>f.controller.approveOriginal(f.event,p.id)));assert.equal(f.counts.submit,0);assert.equal(f.counts.sign,1);
 const row=(await f.readDisk()).sessionOriginals[0],cold=new FileTransactionIntentStore({filePath:f.filePath});assert.equal((await cold.readSessionPairSubmission(account,row.requestDigest,()=>{})).queryOnly,true);
});
test('SDK cleanup first cause and debt remain distinct from retained response and block close',async t=>{
 const f=await setup(t,'client-close-false'),p=await f.prepare();await assert.rejects(f.run(()=>f.controller.approveOriginal(f.event,p.id)),e=>e===false);
 const row=(await f.readDisk()).sessionOriginals[0];assert.ok(row.pairSubmission.responseOriginal);assert.equal(row.cleanupComplete,false);assert.deepEqual(row.cleanupCause,{kind:'boolean',value:false,code:null});
 assert.equal(f.controller.readStatusDATA().cleanupUnresolved,true);await assert.rejects(f.controller.close(),e=>e===false);assert.equal(f.counts.clientClose,1);
});
test('account policy revocation after device proof preparation refuses body entry and HTTP despite a retained approval',async t=>{
 const f=await setup(t,'source-revoked-after-prepare'),p=await f.prepare();await assert.rejects(f.run(()=>f.controller.approveOriginal(f.event,p.id)));
 assert.equal(f.counts.sign,1);assert.equal(f.counts.prepare,1);assert.equal(f.counts.submit,0);
 const row=(await f.readDisk()).sessionOriginals[0];assert.ok(row.approval.original);assert.equal(row.pairSubmission,null);assert.equal(row.cleanupComplete,true);
});
test('close during fixed SDK submit keeps the complete late response before failing currentness and never creates a session',async t=>{
 const f=await setup(t),p=await f.prepare();let reached,release;const entered=new Promise(resolve=>{reached=resolve;}),wait=new Promise(resolve=>{release=resolve;});
 f.onSubmit=async()=>{reached();await wait;};
 const flow=f.run(()=>f.controller.approveOriginal(f.event,p.id)),rejected=assert.rejects(flow);await entered;
 const closing=f.controller.close();release();await rejected;await closing;
 const row=(await f.readDisk()).sessionOriginals[0];assert.ok(row.pairSubmission.responseOriginal);assert.equal(f.counts.submit,1);assert.equal(f.counts.sign,1);
 assert.equal(f.controller.readStatusDATA().registered,false);assert.equal(f.counts.clientClose,1);
});
test('a new controller only reads the original outcome; re-preparing a saved operation cannot acquire signing policy or issue HTTP',async t=>{
 const f=await setup(t),p=await f.prepare();await f.run(()=>f.controller.approveOriginal(f.event,p.id));const digest=f.view.requestDigest;
 const cold=createOriginalDeviceRegistrationController({vault:f.vault,networkId,authority:f.authority});
 const opened=f.counts.open,read=await f.run(()=>cold.readOriginalPairOutcome(digest));assert.equal(read.queryOnly,true);assert.equal(read.canRetry,false);assert.equal(f.counts.open,opened);
 await assert.rejects(f.run(()=>cold.prepareReview(f.selection)),{code:'DEVICE_REGISTRATION_QUERY_ORIGINAL_ONLY'});
 assert.equal(f.counts.accountAcquire,1);assert.equal(f.counts.sign,1);assert.equal(f.counts.submit,1);
});
test('old general authorization entry still refuses v4 and a foreign DTO cannot enter the private registration continuation',async t=>{
 const f=await setup(t),p=await f.prepare();
 await assert.rejects(f.run(()=>f.authority.approveCanonicalAuthorization(f.view.request,f.at.toISOString(),account)),e=>e.data?.code==='PQ_DEVICE_ISSUER_NOT_SUPPLIED');
 assert.throws(()=>f.authority.approveOriginalDeviceRegistration({registered:true},{assert(){}}),{code:'DEVICE_REGISTRATION_ORIGINAL_REVIEW_REQUIRED'});
 assert.equal(f.counts.sign,0);assert.equal(f.counts.accountAcquire,0);await f.run(()=>f.controller.rejectOriginal(p.id));
});
test('controller never returns a pre-finally success snapshot when its original client cleanup failed',async t=>{
 const f=await setup(t,'client-close-false'),original=f.authority.approveOriginalDeviceRegistration.bind(f.authority);
 // PUBLIC business-facade model: the actual pair, journal and authority run,
 // but a facade tolerates its cleanup failure. The controller must still reject
 // its own same close debt rather than return an earlier success snapshot.
 f.authority.approveOriginalDeviceRegistration=async(...args)=>{try{return await original(...args);}catch(e){if(e===false&&f.counts.submit===1)return {phase:'awaiting-original-challenge'};throw e;}};
 const p=await f.prepare();await assert.rejects(f.run(()=>f.controller.approveOriginal(f.event,p.id)),e=>e===false);
 assert.equal(f.counts.submit,1);assert.equal(f.controller.readStatusDATA().cleanupUnresolved,true);
});
test('business first failure survives a separate falsy cleanup failure',async t=>{
 const f=await setup(t,'http-error-close-false'),p=await f.prepare();await assert.rejects(f.run(()=>f.controller.approveOriginal(f.event,p.id)),{code:'PUBLIC_HTTP_FIRST'});
 const row=(await f.readDisk()).sessionOriginals[0];assert.equal(row.firstCause.code,'PUBLIC_HTTP_FIRST');assert.deepEqual(row.cleanupCause,{kind:'boolean',value:false,code:null});
 assert.equal(f.controller.readStatusDATA().firstCauseCode,'PUBLIC_HTTP_FIRST');assert.equal(f.counts.clientClose,1);
});

async function pairThenCold(t,mode='normal'){
 const f=await setup(t),p=await f.prepare();await f.run(()=>f.controller.approveOriginal(f.event,p.id));
 f.pairRow=(await f.readDisk()).sessionOriginals[0];await f.controller.close();f.mode=mode;
 f.controller=createOriginalDeviceRegistrationController({vault:f.vault,networkId,authority:f.authority});
 f.complete=()=>f.run(()=>f.controller.prepareCompletionReview(f.pairRow.requestDigest));return f;
}
const approveCompletion=(f,p)=>f.run(()=>f.controller.approveOriginal(f.event,p.id));
test('cold completion opens a fresh matching Source phase, reuses approval, persists its whole body before one HTTP and awaits Native',async t=>{
 const f=await pairThenCold(t),p=await f.complete();assert.equal(p.method,'ynx_completeProductDeviceV4');assert.equal(f.counts.sign,1);assert.equal(f.counts.completionPrepare??0,0);
 const r=await approveCompletion(f,p),row=(await f.readDisk()).sessionOriginals[0];
 assert.equal(r.phase,'awaiting-original-native-completion');assert.equal(r.registered,false);assert.equal(r.connected,false);assert.equal(r.newSession,false);assert.equal(r.accountApprovalReused,true);assert.equal(r.localSaveRequired,false);assert.equal(r.localSaveAvailable,true);
 assert.equal(f.counts.open,2);assert.equal(f.counts.accountAcquire,2);assert.equal(f.counts.accountClose,2);assert.equal(f.counts.clientClose,2);
 assert.equal(f.counts.sign,1);assert.equal(f.counts.plan,1);assert.equal(f.counts.nativeProof,1);assert.equal(f.counts.completionSubmit,1);
 assert.equal(row.version,3);assert.deepEqual(row.pairSubmission,f.pairRow.pairSubmission);assert.deepEqual(row.approval,f.pairRow.approval);assert.equal(row.operationId,f.pairRow.operationId);
 const c=row.completionSubmission;assert.notEqual(c.operationId,row.operationId);assert.equal(c.entered,true);assert.equal(c.memberOriginal,null);assert.ok(c.responseOriginal);assert.equal(c.cleanupComplete,true);
 const body=JSON.parse(c.originalBody);assert.equal(body.completion.deviceMember,Buffer.from([1,2,3,4]).toString('base64url'));assert.deepEqual(body.approval,JSON.parse(row.approval.original));
 const cold=createOriginalDeviceRegistrationController({vault:f.vault,networkId,authority:f.authority}),opened=f.counts.open;
 const outcome=await f.run(()=>cold.readOriginalCompletionOutcome(row.requestDigest));assert.equal(outcome.queryOnly,true);assert.equal(outcome.canRetry,false);assert.equal(outcome.registered,false);assert.equal(f.counts.open,opened);
 assert.ok(!JSON.stringify(outcome).includes('originalBody'));assert.ok(!JSON.stringify(outcome).includes('session DATA'));
 await assert.rejects(f.run(()=>cold.prepareCompletionReview(row.requestDigest)),{code:'DEVICE_COMPLETION_QUERY_ORIGINAL_ONLY'});assert.equal(f.counts.open,opened);
 const history=await f.store.sessionRecoverySummaries(account,()=>{});assert.equal(history[0].recordVersion,3);assert.equal(history[0].completionOriginalPresent,true);assert.equal(history[0].completionEntered,true);assert.equal(history[0].completionResponseRetained,true);
 assert.ok(!JSON.stringify(history).includes('originalBody'));await f.controller.close();
});
for(const mode of ['completion-before-member-false','completion-after-member-false','completion-http-false','completion-late-lock','completion-throw-with-original'])test('completion '+mode+' retains originals without a new account signature or replay',async t=>{
 const f=await pairThenCold(t,mode),p=await f.complete();await assert.rejects(approveCompletion(f,p));const row=(await f.readDisk()).sessionOriginals[0],c=row.completionSubmission;
 assert.equal(row.version,3);assert.equal(f.counts.sign,1);assert.deepEqual(row.pairSubmission,f.pairRow.pairSubmission);assert.equal(f.counts.nativeProof,1);
 assert.equal(f.counts.completionSubmit??0,mode.includes('before-member')||mode.includes('after-member')?0:1);
 if(mode==='completion-after-member-false')assert.equal(c.memberOriginal,Buffer.from([1,2,3,4]).toString('base64url'));
 if(['completion-late-lock','completion-throw-with-original'].includes(mode))assert.ok(c.responseOriginal);else assert.equal(c.responseOriginal,null);
 if(mode.endsWith('false'))assert.deepEqual(c.firstCause,{kind:'boolean',value:false,code:null});
 assert.equal(f.controller.readStatusDATA().registered,false);await assert.rejects(approveCompletion(f,p));
 if(mode!=='completion-late-lock'){
  const cold=createOriginalDeviceRegistrationController({vault:f.vault,networkId,authority:f.authority}),opened=f.counts.open;
  await assert.rejects(f.run(()=>cold.prepareCompletionReview(row.requestDigest)),{code:'DEVICE_COMPLETION_QUERY_ORIGINAL_ONLY'});assert.equal(f.counts.open,opened);
 }
});
test('fresh completion refuses the old pair pending operation before Native proof or account Source acquisition',async t=>{
 const f=await pairThenCold(t,'completion-pair-op');await assert.rejects(f.complete(),{code:'DEVICE_COMPLETION_ORIGINAL_BINDING'});
 assert.equal(f.counts.accountAcquire,1);assert.equal(f.counts.nativeProof??0,0);assert.equal(f.counts.sign,1);assert.equal((await f.readDisk()).sessionOriginals[0].version,2);
});
for(const point of ['intent','member','body','response'])test('completion lost '+point+' ACK is custody-only and cold marker never retries',async t=>{
 const f=await pairThenCold(t),replace=f.store.filePolicy.replace.bind(f.store.filePolicy);let lost=false;
 f.store.filePolicy.replace=async(...args)=>{const next=JSON.parse(await fs.readFile(args[0],'utf8')),c=next.sessionOriginals[0].completionSubmission;await replace(...args);
  const matches=c&&(point==='intent'?!c.entered&&c.memberOriginal===null:point==='member'?c.memberOriginal!==null:point==='body'?c.entered&&c.responseOriginal===null:c.responseOriginal!==null);
  if(!lost&&matches){lost=true;throw false;}};
 const p=await f.complete();await assert.rejects(approveCompletion(f,p));assert.equal(lost,true);const row=(await f.readDisk()).sessionOriginals[0];
 assert.equal(f.counts.nativeProof??0,point==='intent'?0:1);assert.equal(f.counts.completionSubmit??0,point==='response'?1:0);assert.equal(f.counts.sign,1);assert.equal(row.version,3);
 if(point==='response')assert.ok(row.completionSubmission.responseOriginal);assert.deepEqual(row.pairSubmission,f.pairRow.pairSubmission);
 const cold=createOriginalDeviceRegistrationController({vault:f.vault,networkId,authority:f.authority});await assert.rejects(f.run(()=>cold.prepareCompletionReview(row.requestDigest)),{code:'DEVICE_COMPLETION_QUERY_ORIGINAL_ONLY'});
 await f.controller.close();
});
test('completion close while HTTP is in flight stores the late original before current refusal',async t=>{
 const f=await pairThenCold(t),p=await f.complete();let reach,release;const entered=new Promise(r=>reach=r),held=new Promise(r=>release=r);f.onCompletionSubmit=async()=>{reach();await held;};
 const flow=approveCompletion(f,p),rejected=assert.rejects(flow);await entered;const closing=f.controller.close();release();await rejected;await closing;
 const row=(await f.readDisk()).sessionOriginals[0];assert.ok(row.completionSubmission.responseOriginal);assert.equal(f.counts.completionSubmit,1);assert.equal(f.counts.sign,1);assert.equal(f.counts.clientClose,2);assert.equal(row.completionSubmission.cleanupComplete,true);
});
test('completion parser copies only stable intrinsic byte arrays without executing buffer hooks',async()=>{
 const {copySessionCompletionMember}=await import('../src/wallet-session-original.mjs');let called=0;
 const bytes=new Uint8Array([1,2,3]);Object.defineProperty(bytes.buffer,'resizable',{get(){called++;return false;}});Object.defineProperty(bytes.buffer,'detached',{get(){called++;return false;}});
 assert.deepEqual(copySessionCompletionMember(bytes),Buffer.from([1,2,3]));assert.equal(called,0);
 for(const value of [new Uint8Array(new SharedArrayBuffer(3)),new Uint8Array(new ArrayBuffer(3,{maxByteLength:10})),new Proxy(new Uint8Array(3),{}),new Uint8Array(98305)])assert.throws(()=>copySessionCompletionMember(value));
 const detached=new Uint8Array(3);structuredClone(detached.buffer,{transfer:[detached.buffer]});assert.throws(()=>copySessionCompletionMember(detached));
});
async function reserveCompletionDATA(f){
 const {readSessionCompletionOriginalDATA}=await import('../src/wallet-session-original.mjs'),o=readSessionCompletionOriginalDATA(f.pairRow);
 const intent={operationId:'PUBLIC-completion-journal',requestDigest:o.requestDigest,registrationOriginal:o.registrationOriginal,approvalDigest:o.approvalDigest,challengeOriginal:o.challengeOriginal};
 const reserved=f.store.reserveSessionCompletionIntent(account,o.requestDigest,intent,()=>{});await reserved.ready;return {...reserved,o,intent};
}
function completionDATA(f,c,member){
 return {operationId:c.intent.operationId,requestDigest:c.o.requestDigest,registrationOriginal:c.o.registrationOriginal,challengeOriginal:c.o.challengeOriginal,memberOriginal:member,
  originalBody:JSON.stringify({}),dataOnly:true,registered:false,connected:false,newSession:false,SourceAdmission:false,NativeAdmission:false};
}
async function canonicalCompletionDATA(f,c,member){
 const {canonicalJSON}=await import('@ynx-chain/wallet-auth'),d=completionDATA(f,c,member);d.originalBody=canonicalJSON({operationId:d.operationId,request:f.pairRow.request,registrationOriginal:d.registrationOriginal,
  approval:JSON.parse(c.o.approvalOriginal),completion:{challenge:JSON.parse(c.o.challengeOriginal),deviceMember:member.toString('base64url')}});return d;
}
test('completion capacity reserves maximum original Member and escaped response within the current journal budget',async t=>{
 const f=await pairThenCold(t),c=await reserveCompletionDATA(f),member=Buffer.alloc(98304,0x37);f.store.captureSessionCompletionMember(c.token,member);await f.store.saveSessionCompletionMember(c.token);
 const d=await canonicalCompletionDATA(f,c,member);assert.equal((await f.store.beginSessionCompletionSubmission(c.token,d,()=>{})).created,true);
 assert.equal((await f.store.beginSessionCompletionSubmission(c.token,d,()=>{})).created,false);
 const {canonicalJSON,productSessionRequestDigest}=await import('@ynx-chain/wallet-auth');
 const {TRANSACTION_JOURNAL_MAX_BYTES}=await import('../src/bounded-private-file-read.mjs');
 const {sessionV4ReservedBytes,SESSION_V4_RESPONSE_RESERVE_BYTES}=await import('../src/wallet-session-original.mjs');
 // The journal now has its own 8 MiB budget; Vault/backup remain at 1 MiB.
 // Two small legacy fillers fit, while the live original response stays reserved.
 // Legacy/public retained DATA fills the same actual bounded file. It is not
 // cryptographic authority and does not cause a signer, Source or HTTP call.
 for(let i=0;i<2;i++){
  const request={...f.pairRow.request,nonce:('PUBLIC-extra-'+i).padEnd(43,'n')},createdAt=f.pairRow.createdAt,digest=productSessionRequestDigest(f.registry,request,new Date(createdAt));
  const old={version:1,account,requestId:'PUBLIC-filler-'+i,requestDigest:digest,request,createdAt,approval:null,deliveryAttempted:false,cleanupComplete:false,firstCause:null,storageCause:null,cleanupCause:null};
  const token=await f.store.reserveSessionOriginal(old,()=>{});f.store.captureSessionOriginal(token,{version:'2',result:'approved',requestDigest:digest,account:f.selection.identityBinding.account,padding:'x'.repeat(240000)});
  await f.store.saveSessionOriginal(token);
  const retained=await f.readDisk();assert.equal(sessionV4ReservedBytes(retained),SESSION_V4_RESPONSE_RESERVE_BYTES);
  assert.ok(Buffer.byteLength(JSON.stringify(retained)+'\n')+sessionV4ReservedBytes(retained)<=TRANSACTION_JOURNAL_MAX_BYTES);
 }
 const raw='"'.repeat(196608);f.store.captureSessionCompletionResponse(c.token,raw);await f.store.saveSessionCompletionResponse(c.token);await f.store.recordSessionCompletionFailure(c.token,{cleanupComplete:true});
 const row=(await f.readDisk()).sessionOriginals[0];assert.equal(row.completionSubmission.responseOriginal,raw);assert.equal(row.completionSubmission.memberOriginal,null);assert.deepEqual(row.pairSubmission,f.pairRow.pairSubmission);assert.ok((await fs.stat(f.filePath)).size<=TRANSACTION_JOURNAL_MAX_BYTES);
 assert.equal((await f.store.assertPQProgressSafeToClose()).safe,true);
});
test('completion entry write before replacement can only flush the same held body and never restore an HTTP capability',async t=>{
 const f=await pairThenCold(t),c=await reserveCompletionDATA(f),member=Buffer.from([3,4,5]);f.store.captureSessionCompletionMember(c.token,member);await f.store.saveSessionCompletionMember(c.token);
 const d=await canonicalCompletionDATA(f,c,member),replace=f.store.filePolicy.replace.bind(f.store.filePolicy);let once=true;
 f.store.filePolicy.replace=async(...args)=>{if(once){once=false;throw 0;}return replace(...args);};
 await assert.rejects(f.store.beginSessionCompletionSubmission(c.token,d,()=>{}));assert.equal((await f.readDisk()).sessionOriginals[0].completionSubmission.entered,false);
 await assert.rejects(f.store.assertPQProgressSafeToClose(),e=>e.data?.code==='SESSION_COMPLETION_CLOSE_UNCONFIRMED');
 assert.deepEqual(await f.store.saveSessionCompletionEntry(c.token),{stored:true,queryOnly:true,canRetry:false});
 await f.store.recordSessionCompletionFailure(c.token,{firstPresent:true,first:0,cleanupComplete:true});assert.equal((await f.store.assertPQProgressSafeToClose()).safe,true);
 await assert.rejects(f.store.beginSessionCompletionSubmission(c.token,d,()=>{}));const cold=new FileTransactionIntentStore({filePath:f.filePath});assert.throws(()=>cold.beginSessionCompletionSubmission(c.token,d,()=>{}));assert.equal(f.counts.completionSubmit??0,0);
});
test('completion first cause cannot close an unretired original Source or unsaved response',async t=>{
 const f=await pairThenCold(t),c=await reserveCompletionDATA(f);await f.store.recordSessionCompletionFailure(c.token,{firstPresent:true,first:false});
 await assert.rejects(f.store.assertPQProgressSafeToClose(),e=>e.data?.code==='SESSION_COMPLETION_CLOSE_UNCONFIRMED');
 await f.store.recordSessionCompletionFailure(c.token,{cleanupComplete:true});assert.equal((await f.store.assertPQProgressSafeToClose()).safe,true);
});
test('completion body rejects original member, challenge, operation, approval and foreign field substitutions before entry',async t=>{
 const f=await pairThenCold(t),c=await reserveCompletionDATA(f),member=Buffer.from([3,4,5]);f.store.captureSessionCompletionMember(c.token,member);await f.store.saveSessionCompletionMember(c.token);
 const d=await canonicalCompletionDATA(f,c,member),{canonicalJSON}=await import('@ynx-chain/wallet-auth');
 for(const edit of [x=>x.operationId=f.pairRow.operationId,x=>x.memberOriginal=Buffer.from([9]),x=>x.challengeOriginal='{}',x=>x.connected=true,x=>x.url='https://fake.invalid',x=>{let b=JSON.parse(x.originalBody);b.approval.walletProof='AB';x.originalBody=canonicalJSON(b);},x=>{let b=JSON.parse(x.originalBody);b.completion.deviceMember='AA';x.originalBody=canonicalJSON(b);},x=>x.originalBody+=' ']){
  const bad={...d};edit(bad);assert.throws(()=>f.store.beginSessionCompletionSubmission(c.token,bad,()=>{}));
 }
 assert.equal((await f.readDisk()).sessionOriginals[0].completionSubmission.entered,false);
 await f.store.recordSessionCompletionFailure(c.token,{firstPresent:true,first:false,cleanupComplete:true});
});
test('completion cleanup debt remains separate from a retained session response and no stale success is returned',async t=>{
 const f=await pairThenCold(t,'client-close-false'),p=await f.complete();await assert.rejects(approveCompletion(f,p),e=>e===false);
 const row=(await f.readDisk()).sessionOriginals[0],c=row.completionSubmission;assert.ok(c.responseOriginal);assert.equal(c.cleanupComplete,false);assert.deepEqual(c.cleanupCause,{kind:'boolean',value:false,code:null});
 assert.equal(row.cleanupComplete,true);assert.equal(row.cleanupCause,null);assert.equal(f.counts.sign,1);assert.equal(f.counts.completionSubmit,1);
 await assert.rejects(f.store.assertPQProgressSafeToClose(),e=>e.data?.code==='SESSION_COMPLETION_CLOSE_UNCONFIRMED');await assert.rejects(f.controller.close(),e=>e===false);
});
test('two independent completion reviews compete for one durable phase before producing any second Native proof',async t=>{
 const f=await pairThenCold(t),second=createOriginalDeviceRegistrationController({vault:f.vault,networkId,authority:f.authority}),p=await f.complete(),q=await f.run(()=>second.prepareCompletionReview(f.pairRow.requestDigest));
 await approveCompletion(f,p);await assert.rejects(f.run(()=>second.approveOriginal(f.event,q.id)));
 assert.equal(f.counts.nativeProof,1);assert.equal(f.counts.completionSubmit,1);assert.equal(f.counts.sign,1);
});
test('completion failure metadata never overwrites an unsaved held complete body',async t=>{
 const f=await pairThenCold(t),c=await reserveCompletionDATA(f),member=Buffer.from([4,5,6]);f.store.captureSessionCompletionMember(c.token,member);await f.store.saveSessionCompletionMember(c.token);
 const d=await canonicalCompletionDATA(f,c,member),replace=f.store.filePolicy.replace.bind(f.store.filePolicy);let once=true;f.store.filePolicy.replace=async(...a)=>{if(once){once=false;throw false;}return replace(...a);};
 await assert.rejects(f.store.beginSessionCompletionSubmission(c.token,d,()=>{}));await f.store.recordSessionCompletionFailure(c.token,{firstPresent:true,first:false,cleanupComplete:true});
 await assert.rejects(f.store.assertPQProgressSafeToClose(),e=>e.data?.code==='SESSION_COMPLETION_CLOSE_UNCONFIRMED');
 await f.store.saveSessionCompletionEntry(c.token);assert.equal((await f.readDisk()).sessionOriginals[0].completionSubmission.originalBody,d.originalBody);assert.equal((await f.store.assertPQProgressSafeToClose()).safe,true);
});
test('completion lost response ACK may reconcile exact readback at shutdown without any second HTTP or signature',async t=>{
 const f=await pairThenCold(t),c=await reserveCompletionDATA(f),member=Buffer.from([4,5,6]);f.store.captureSessionCompletionMember(c.token,member);await f.store.saveSessionCompletionMember(c.token);const d=await canonicalCompletionDATA(f,c,member);await f.store.beginSessionCompletionSubmission(c.token,d,()=>{});
 f.store.captureSessionCompletionResponse(c.token,'PUBLIC exact response');const replace=f.store.filePolicy.replace.bind(f.store.filePolicy);let once=true;f.store.filePolicy.replace=async(...a)=>{await replace(...a);if(once){once=false;throw false;}};
 await assert.rejects(f.store.saveSessionCompletionResponse(c.token));await f.store.recordSessionCompletionFailure(c.token,{firstPresent:true,first:false,cleanupComplete:true});assert.equal((await f.store.assertPQProgressSafeToClose()).safe,true);assert.equal(f.counts.sign,1);assert.equal(f.counts.completionSubmit??0,0);
});
for(const point of ['body','response'])test('normal controller can save the held completion '+point+' locally after lock without Native, keys or HTTP replay',async t=>{
 const f=await pairThenCold(t),replace=f.store.filePolicy.replace.bind(f.store.filePolicy);let once=true;
 f.store.filePolicy.replace=async(...a)=>{const row=JSON.parse(await fs.readFile(a[0],'utf8')).sessionOriginals[0].completionSubmission;
  if(once&&row&&(point==='body'?row.entered:row.responseOriginal!==null)){once=false;throw false;}await replace(...a);};
 const p=await f.complete();await assert.rejects(approveCompletion(f,p));f.lifecycle.lock();const count={...f.counts};
 assert.equal(f.controller.readStatusDATA().localSaveAvailable,true);assert.equal(f.controller.readStatusDATA().localSaveRequired,true);
 const saved=await f.controller.saveOriginalCompletionOutcome(f.pairRow.requestDigest);assert.equal(saved.queryOnly,true);assert.equal(saved.canRetry,false);assert.deepEqual(f.counts,count);
 assert.equal(f.controller.readStatusDATA().localSaveRequired,false);
 const row=(await f.readDisk()).sessionOriginals[0];assert.ok(row.completionSubmission.originalBody);if(point==='response')assert.ok(row.completionSubmission.responseOriginal);
 assert.equal((await f.store.assertPQProgressSafeToClose()).safe,true);await f.controller.close();
 const cold=createOriginalDeviceRegistrationController({vault:f.vault,networkId,authority:f.authority});await assert.rejects(cold.saveOriginalCompletionOutcome(f.pairRow.requestDigest),{code:'DEVICE_COMPLETION_HELD_ORIGINAL_REQUIRED'});
});

for(const fault of ['before-intent','intent-ack','failure-metadata'])test('storage recovery '+fault+' preserves intent-only and metadata debt through the normal locked local-save entry',async t=>{
 const f=await pairThenCold(t,fault==='failure-metadata'?'completion-before-member-false':'normal'),replace=f.store.filePolicy.replace.bind(f.store.filePolicy);let armed=true,first=true;
 f.store.filePolicy.replace=async(...a)=>{const c=JSON.parse(await fs.readFile(a[0],'utf8')).sessionOriginals[0].completionSubmission;
  if(armed&&c){if(fault==='intent-ack'&&first){first=false;await replace(...a);throw false;}
   if(fault!=='failure-metadata'||c.firstCause!==null||c.cleanupComplete)throw false;}
  return replace(...a);};
 const p=await f.complete();await assert.rejects(approveCompletion(f,p));f.lifecycle.lock();const counts={...f.counts};
 assert.equal(f.controller.readStatusDATA().localSaveAvailable,true);assert.equal(f.controller.readStatusDATA().localSaveRequired,true);
 await assert.rejects(f.store.assertPQProgressSafeToClose(),e=>e.data?.code==='SESSION_COMPLETION_CLOSE_UNCONFIRMED');
 armed=false;const saved=await f.controller.saveOriginalCompletionOutcome(f.pairRow.requestDigest);assert.equal(saved.stored,true);assert.deepEqual(f.counts,counts);
 assert.equal(f.controller.readStatusDATA().localSaveRequired,false);const row=(await f.readDisk()).sessionOriginals[0],c=row.completionSubmission;
 assert.equal(row.version,3);assert.equal(c.entered,false);assert.equal(c.memberOriginal,null);assert.equal(c.responseOriginal,null);assert.ok(c.firstCause);assert.ok(c.storageCause);assert.equal(c.cleanupCause,null);assert.equal(c.cleanupComplete,true);
 assert.deepEqual(row.pairSubmission,f.pairRow.pairSubmission);assert.equal((await f.store.assertPQProgressSafeToClose()).safe,true);
 await assert.rejects(f.controller.approveOriginal(f.event,p.id));assert.equal(f.counts.completionSubmit??0,0);assert.equal(f.counts.sign,1);
});
test('storage recovery saves cleanup failure metadata without clearing a real original close debt',async t=>{
 const f=await pairThenCold(t,'client-close-false'),replace=f.store.filePolicy.replace.bind(f.store.filePolicy);let armed=true;
 f.store.filePolicy.replace=async(...a)=>{const c=JSON.parse(await fs.readFile(a[0],'utf8')).sessionOriginals[0].completionSubmission;if(armed&&c?.cleanupCause)throw 0;return replace(...a);};
 const p=await f.complete();await assert.rejects(approveCompletion(f,p));f.lifecycle.lock();assert.equal(f.controller.readStatusDATA().localSaveRequired,true);armed=false;const counts={...f.counts};
 await f.controller.saveOriginalCompletionOutcome(f.pairRow.requestDigest);assert.deepEqual(f.counts,counts);assert.equal(f.controller.readStatusDATA().localSaveRequired,false);assert.equal(f.controller.readStatusDATA().cleanupUnresolved,true);
 const c=(await f.readDisk()).sessionOriginals[0].completionSubmission;assert.deepEqual(c.cleanupCause,{kind:'boolean',value:false,code:null});assert.equal(c.cleanupComplete,false);assert.ok(c.storageCause);
 await assert.rejects(f.store.assertPQProgressSafeToClose(),e=>e.data?.code==='SESSION_COMPLETION_CLOSE_UNCONFIRMED');
});
for(const point of ['before','ack'])test('storage recovery local flush '+point+' failure preserves first/storage causes and readback never gives an effect token',async t=>{
 const f=await pairThenCold(t),replace=f.store.filePolicy.replace.bind(f.store.filePolicy);let armed=true;
 f.store.filePolicy.replace=async(...a)=>{const c=JSON.parse(await fs.readFile(a[0],'utf8')).sessionOriginals[0].completionSubmission;if(armed&&c)throw false;return replace(...a);};
 const p=await f.complete();await assert.rejects(approveCompletion(f,p));f.lifecycle.lock();const counts={...f.counts};armed=false;
 let fail=true,writes=0;f.store.filePolicy.replace=async(...a)=>{writes++;if(fail&&point==='before')throw 0;await replace(...a);if(fail)throw 0;};
 await assert.rejects(f.controller.saveOriginalCompletionOutcome(f.pairRow.requestDigest));assert.equal(f.controller.readStatusDATA().localSaveRequired,true);
 fail=false;const before=writes;await f.controller.saveOriginalCompletionOutcome(f.pairRow.requestDigest);assert.equal(writes-before,point==='ack'?0:1);
 const c=(await f.readDisk()).sessionOriginals[0].completionSubmission;assert.equal(c.firstCause.code,'TRANSACTION_JOURNAL_WRITE_FAILED');assert.deepEqual(c.storageCause,{kind:'boolean',value:false,code:null});assert.equal(c.cleanupComplete,true);
 assert.deepEqual(f.counts,counts);assert.equal(f.controller.readStatusDATA().localSaveRequired,false);assert.equal((await f.store.assertPQProgressSafeToClose()).safe,true);
});
test('storage recovery direct same-token flush can preserve a failed intent but cannot set intentReady or permit a Native proof',async t=>{
 const f=await pairThenCold(t),{readSessionCompletionOriginalDATA}=await import('../src/wallet-session-original.mjs'),o=readSessionCompletionOriginalDATA(f.pairRow),intent={operationId:'PUBLIC-failed-intent',requestDigest:o.requestDigest,registrationOriginal:o.registrationOriginal,challengeOriginal:o.challengeOriginal,approvalDigest:o.approvalDigest};
 const replace=f.store.filePolicy.replace.bind(f.store.filePolicy);let once=true;f.store.filePolicy.replace=async(...a)=>{if(once){once=false;throw false;}return replace(...a);};
 const r=f.store.reserveSessionCompletionIntent(account,o.requestDigest,intent,()=>{});await assert.rejects(r.ready);await assert.rejects(f.store.recordSessionCompletionFailure(r.token,{firstPresent:true,first:0,cleanupComplete:true}));
 await f.store.saveSessionCompletionOriginal(r.token);assert.equal(f.store.readSessionCompletionStorageDATA(r.token).localSaveRequired,false);
 assert.throws(()=>f.store.captureSessionCompletionMember(r.token,Buffer.from([1])));assert.throws(()=>f.store.beginSessionCompletionSubmission(r.token,{},()=>{}));
 const cold=new FileTransactionIntentStore({filePath:f.filePath});assert.throws(()=>cold.readSessionCompletionStorageDATA(r.token));assert.throws(()=>cold.saveSessionCompletionOriginal(r.token));
 assert.equal((await f.store.assertPQProgressSafeToClose()).safe,true);assert.equal(f.counts.nativeProof??0,0);assert.equal(f.counts.completionSubmit??0,0);
});
test('storage recovery rejects an invalid unselected intent instead of returning a false stored success',async t=>{
 const f=await pairThenCold(t),r=f.store.reserveSessionCompletionIntent(account,f.pairRow.requestDigest,{operationId:f.pairRow.operationId},()=>{});await assert.rejects(r.ready);
 const state=f.store.readSessionCompletionStorageDATA(r.token);assert.equal(state.localSaveAvailable,false);assert.equal(state.localSaveRequired,false);await assert.rejects(f.store.saveSessionCompletionOriginal(r.token));assert.equal((await f.readDisk()).sessionOriginals[0].version,2);
});
for(const edit of ['operation','pair','cause'])test('storage recovery refuses foreign '+edit+' bytes without replacing either original',async t=>{
 const f=await pairThenCold(t,'completion-before-member-false'),p=await f.complete();await assert.rejects(approveCompletion(f,p));f.lifecycle.lock();
 const state=await f.readDisk(),row=state.sessionOriginals[0];if(edit==='operation')row.completionSubmission.operationId='PUBLIC-foreign-phase';
 if(edit==='pair')row.pairSubmission.responseOriginal='{"PUBLIC":"foreign response"}';
 if(edit==='cause')row.completionSubmission.firstCause={kind:'number',value:99,code:null};
 const foreign=JSON.stringify(state);await fs.writeFile(f.filePath,foreign);await assert.rejects(f.controller.saveOriginalCompletionOutcome(f.pairRow.requestDigest));assert.equal(await fs.readFile(f.filePath,'utf8'),foreign);assert.equal(f.controller.readStatusDATA().localSaveRequired,true);
 await assert.rejects(f.store.assertPQProgressSafeToClose());assert.equal(f.counts.completionSubmit??0,0);assert.equal(f.counts.sign,1);
});
test('storage recovery persists falsy first and cleanup metadata independently when both their original writes failed',async t=>{
 const f=await pairThenCold(t),c=await reserveCompletionDATA(f),replace=f.store.filePolicy.replace.bind(f.store.filePolicy);let fault=true;
 f.store.filePolicy.replace=async(...a)=>{if(fault)throw 0;return replace(...a);};await assert.rejects(f.store.recordSessionCompletionFailure(c.token,{firstPresent:true,first:false,cleanupPresent:true,cleanup:null}));
 fault=false;await f.store.saveSessionCompletionOriginal(c.token);const row=(await f.readDisk()).sessionOriginals[0].completionSubmission;
 assert.deepEqual(row.firstCause,{kind:'boolean',value:false,code:null});assert.deepEqual(row.cleanupCause,{kind:'object',value:null,code:null});assert.deepEqual(row.storageCause,{kind:'number',value:0,code:null});assert.equal(row.cleanupComplete,false);
 await assert.rejects(f.store.assertPQProgressSafeToClose(),e=>e.data?.code==='SESSION_COMPLETION_CLOSE_UNCONFIRMED');
});
test('storage recovery never accepts a disk-only cleanup-complete claim while the original phase is live',async t=>{
 const f=await pairThenCold(t),c=await reserveCompletionDATA(f),state=await f.readDisk();state.sessionOriginals[0].completionSubmission.cleanupComplete=true;const foreign=JSON.stringify(state);await fs.writeFile(f.filePath,foreign);
 await assert.rejects(f.store.assertPQProgressSafeToClose(),e=>e.data?.code==='SESSION_COMPLETION_CLOSE_UNCONFIRMED');await assert.rejects(f.store.saveSessionCompletionOriginal(c.token));assert.equal(await fs.readFile(f.filePath,'utf8'),foreign);
 assert.equal(f.store.readSessionCompletionStorageDATA(c.token).localSaveRequired,true);assert.equal(f.counts.nativeProof??0,0);
});
test('storage recovery returns stored only after final exact readback and retains debt if that read fails',async t=>{
 const f=await pairThenCold(t),c=await reserveCompletionDATA(f),replace=f.store.filePolicy.replace.bind(f.store.filePolicy);let armed=true;
 f.store.filePolicy.replace=async(...a)=>{if(armed)throw false;return replace(...a);};await assert.rejects(f.store.recordSessionCompletionFailure(c.token,{firstPresent:true,first:0,cleanupComplete:true}));armed=false;
 const io=f.store.io;let replaced=false,reads=0,writes=0;f.store.filePolicy.replace=async(...a)=>{await replace(...a);replaced=true;writes++;};
 f.store.io={...io,async open(file,flags,...rest){if(file===f.filePath&&replaced&&(flags&3)===0&&++reads===2)throw Object.assign(Error('PUBLIC final readback unavailable'),{code:'PUBLIC_READBACK'});return io.open(file,flags,...rest);}};
 await assert.rejects(f.store.saveSessionCompletionOriginal(c.token));assert.equal(f.store.readSessionCompletionStorageDATA(c.token).localSaveRequired,true);assert.equal(reads,2);assert.equal(writes,1);
 f.store.io=io;await f.store.saveSessionCompletionOriginal(c.token);assert.equal(writes,1,'same original readback needs no second replacement');assert.equal(f.store.readSessionCompletionStorageDATA(c.token).localSaveRequired,false);assert.equal((await f.store.assertPQProgressSafeToClose()).safe,true);
});
test('storage recovery explicitly retires a ready warm effect selection even when the local flush itself fails',async t=>{
 const f=await pairThenCold(t),c=await reserveCompletionDATA(f),member=Buffer.from([7,8,9]);f.store.captureSessionCompletionMember(c.token,member);await f.store.saveSessionCompletionMember(c.token);const d=await canonicalCompletionDATA(f,c,member),replace=f.store.filePolicy.replace.bind(f.store.filePolicy);let fail=true;
 f.store.filePolicy.replace=async(...a)=>{if(fail)throw false;return replace(...a);};await assert.rejects(f.store.recordSessionCompletionFailure(c.token,{firstPresent:true,first:false,cleanupComplete:true}));
 await assert.rejects(f.store.saveSessionCompletionOriginal(c.token));assert.throws(()=>f.store.beginSessionCompletionSubmission(c.token,d,()=>{}));
 fail=false;await f.store.saveSessionCompletionOriginal(c.token);assert.throws(()=>f.store.beginSessionCompletionSubmission(c.token,d,()=>{}));assert.equal((await f.readDisk()).sessionOriginals[0].completionSubmission.entered,false);assert.equal((await f.store.assertPQProgressSafeToClose()).safe,true);
 const other=await pairThenCold(t),phase=await reserveCompletionDATA(other);await other.store.recordSessionCompletionFailure(phase.token,{firstPresent:true,first:false,cleanupComplete:true});await other.store.saveSessionCompletionOriginal(phase.token);assert.throws(()=>other.store.captureSessionCompletionMember(phase.token,Buffer.from([1])));
});

test('approved public policy snapshot is exact nine-field DATA from same live original and expires with owner',async t=>{
 const f=await setup(t);let observed;
 f.onAccountEntry=()=>assert.throws(()=>readOriginalDeviceRegistrationApprovedPublicDATA(f.originalPort),{code:'DEVICE_REGISTRATION_APPROVED_PUBLIC_NOT_CURRENT'});
 f.onPrepare=()=>{observed=readOriginalDeviceRegistrationApprovedPublicDATA(f.originalPort);
  assert.equal(Object.isFrozen(observed),true);assert.deepEqual(JSON.parse(observed.policyOriginal),f.policyView);
  assert.equal(Object.keys(JSON.parse(observed.policyOriginal)).length,9);assert.equal(observed.approvalOriginal,f.approvalOriginal);
  assert.equal(observed.requestDigest,f.view.requestDigest);assert.equal(observed.operationId,f.view.scope.pendingId);
  assert.equal(observed.registrationOriginal,f.view.scope.registrationOriginal);assert.equal(observed.account,account);
  assert.equal(Object.hasOwn(observed,'policyRef'),false);assert.equal(Object.hasOwn(observed,'assertCurrent'),false);
  assert.deepEqual(readOriginalDeviceRegistrationApprovedPublicDATA(f.originalPort),observed);
 };
 const p=await f.prepare();await f.run(()=>f.controller.approveOriginal(f.event,p.id));
 assert.ok(observed);assert.equal(f.counts.accountAcquire,1);assert.equal(f.counts.sign,1);assert.equal(f.counts.submit,1);
 assert.throws(()=>readOriginalDeviceRegistrationApprovedPublicDATA(f.originalPort));
 assert.throws(()=>readOriginalDeviceRegistrationApprovedPublicDATA(Object.freeze({approvalOriginal:f.approvalOriginal,policyOriginal:observed.policyOriginal})),{code:'DEVICE_REGISTRATION_ORIGINAL_REVIEW_REQUIRED'});
 await f.controller.close();
});
for(const failure of [0,false,null])test('approved public snapshot preserves live original falsy refusal '+String(failure),async t=>{
 const f=await setup(t);f.onPrepare=()=>{f.sourceFailurePresent=true;f.sourceFailure=failure;
  try{readOriginalDeviceRegistrationApprovedPublicDATA(f.originalPort);assert.fail('expected original current refusal');}catch(e){assert.equal(e,failure);throw e;}
 };
 const p=await f.prepare();try{await f.run(()=>f.controller.approveOriginal(f.event,p.id));assert.fail('expected refusal');}catch(e){assert.equal(e,failure)}
 assert.equal(f.counts.sign,1);assert.equal(f.counts.accountAcquire,1);assert.equal(f.counts.submit,0);
 const row=(await f.readDisk()).sessionOriginals[0];assert.equal(row.approval.original,f.approvalOriginal);
 await assert.rejects(f.run(()=>f.controller.approveOriginal(f.event,p.id)));await f.controller.close();
});

test('approved public completion snapshot uses fresh held policy and original approval without signing again',async t=>{
 const f=await pairThenCold(t);let observed;
 f.onCompletionPrepare=()=>{observed=readOriginalDeviceRegistrationApprovedPublicDATA(f.originalPort);
  assert.deepEqual(JSON.parse(observed.policyOriginal),f.policyView);assert.equal(observed.approvalOriginal,f.pairRow.approval.original);
  assert.equal(observed.operationId,'PUBLIC-completion-original');assert.equal(f.counts.sign,1);assert.equal(f.counts.accountAcquire,2);
 };
 const p=await f.complete();await approveCompletion(f,p);assert.ok(observed);assert.equal(f.counts.sign,1);assert.equal(f.counts.accountAcquire,2);
 assert.throws(()=>readOriginalDeviceRegistrationApprovedPublicDATA(f.originalPort));await f.controller.close();
});
