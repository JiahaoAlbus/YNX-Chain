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
const authorityURL=new URL('../src/desktop-wallet-authority.mjs',import.meta.url).href,controllerURL=new URL('../src/original-device-registration-controller.mjs',import.meta.url).href;
registerHooks({resolve(specifier,context,next){
 if(context.parentURL===controllerURL&&(specifier==='electron'||specifier==='@ynx-chain/wallet-auth/original-product-device-v4-registration-client')||
   context.parentURL===authorityURL&&['@ynx-chain/wallet-auth/product-session-pq-v4-codec','@ynx-chain/wallet-auth/pq-wallet-key-backup'].includes(specifier))return {url:PUBLICFixture,shortCircuit:true};
 return next(specifier,context);
}});
const {DesktopWalletAuthority,MemoryPermissionStore}=await import(authorityURL);
const {createOriginalDeviceRegistrationController}=await import(controllerURL);
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
 const source={readOriginal:()=>view,assertCurrent(){if(f.sourceRetired||f.sourceRevoked)throw Error('PUBLIC source retired');},async recheck(){},retire(){f.sourceRetired=true;},async join(){},async close(){f.counts.accountClose++;}};
 const vault={authorization:lifecycle,async status(){return {initialized:true,account};},async withPQKeys(_binding,action,permission){permission.assert();const result=action(Object.freeze({PUBLICHandle:true}));if(mode==='sign-late-lock')lifecycle.lock();permission.assert();return result;}};
 const authority=new DesktopWalletAuthority({vault,permissions:new MemoryPermissionStore(),transactionSender:{submissions:{intentStore:store}},pqNetworkId:networkId,
  pqSessionSource:async()=>{f.counts.accountAcquire++;if(mode==='no-account-source')throw Object.assign(Error('PUBLIC missing'),{code:'PUBLIC_SOURCE_MISSING'});return source;},pqSessionRecognized:r=>r===source});
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
 const f=await setup(t,'open-partial');await assert.rejects(f.prepare());assert.equal(f.counts.partialRetire,1);assert.equal(f.counts.partialJoin,1);assert.equal(f.counts.partialClose,1);assert.equal(f.counts.sign,0);
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
