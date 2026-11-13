// PUBLIC controls: real Main authority/lifecycle/journal and sole SDK public
// codecs/approval plan DATA, but explicit fake Electron/Native/account Source
// and signature handles. No real Wallet keys, Native factory, HTTP or issuer.
import test from 'node:test';import assert from 'node:assert/strict';import * as fs from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';import {registerHooks} from 'node:module';
import {canonicalJSON,createProductSessionRequest,productPlatformBinding} from '@ynx-chain/wallet-auth';
import {inspectProductSessionDeviceRegistrationOriginalV4Data} from '@ynx-chain/wallet-auth/product-session-device-registration-v4';
import {bindDeviceRegistrationUI} from '../src/wallet-device-registration-ui.mjs';
import {DesktopKeyLifecycle} from '../src/key-lifecycle.mjs';import {FileTransactionIntentStore} from '../src/transaction-intent-store.mjs';import {PRODUCT_SESSION_REGISTRY} from '../src/wallet-auth-contract.mjs';
import {configurePUBLICRegistration,createPUBLICSelection,createPUBLICRegistrationEvent} from './original-device-registration-public.fixture.mjs';
const fixtureURL=new URL('./original-device-registration-public.fixture.mjs',import.meta.url).href,authorityURL=new URL('../src/desktop-wallet-authority.mjs',import.meta.url).href,controllerURL=new URL('../src/original-device-registration-controller.mjs',import.meta.url).href;
registerHooks({resolve(specifier,context,next){if(context.parentURL===controllerURL&&(specifier==='electron'||specifier==='@ynx-chain/wallet-auth/original-product-device-v4-registration-client')||context.parentURL===authorityURL&&['@ynx-chain/wallet-auth/product-session-pq-v4-codec','@ynx-chain/wallet-auth/pq-wallet-key-backup'].includes(specifier))return{url:fixtureURL,shortCircuit:true};return next(specifier,context);}});
const {DesktopWalletAuthority,MemoryPermissionStore}=await import(authorityURL);const {createOriginalDeviceRegistrationController}=await import(controllerURL);
const {inspectOriginalDeviceAccountApprovalDATA}=await import('../src/wallet-device-first-approval-data.mjs');
const account='0x'+'12'.repeat(20),networkId='a'.repeat(64);
function originalRequest(f){const i=f.selection.identityBinding,b=productPlatformBinding(PRODUCT_SESSION_REGISTRY,i.productId,i.platform),record={version:'4',registrationId:'00000000-0000-4000-8000-000000000002',networkId,canonicalOwner:account,...Object.fromEntries(['productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId'].map(k=>[k,i[k]])),generation:'1',revision:'1',pkA:Buffer.from(f.selection.publicPair.pkA).toString('hex'),pkB:Buffer.from(f.selection.publicPair.pkB).toString('hex'),registeredAt:new Date(+f.at-1000).toISOString(),expiresAt:new Date(+f.at+600000).toISOString(),revokedAt:null},registrationOriginal=canonicalJSON(record),registrationDigest=inspectProductSessionDeviceRegistrationOriginalV4Data(Buffer.from(registrationOriginal)).registrationDigest,request=createProductSessionRequest(PRODUCT_SESSION_REGISTRY,{productId:i.productId,platform:i.platform,deviceId:i.deviceId,deviceAlgorithm:'ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512',deviceRegistrationId:record.registrationId,deviceRegistrationRevision:record.revision,deviceRegistrationDigest:registrationDigest,scopes:[b.scopes[0]],purpose:'PUBLIC independent first account approval',nonce:'n'.repeat(43),state:'s'.repeat(43)},f.at);return{operationId:'d'.repeat(64),requestOriginal:canonicalJSON(request),registrationOriginal};}
async function setup(t,mode='normal'){
 const dir=await fs.mkdtemp(path.join(tmpdir(),'ynx-main-first-device-approval-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const filePath=path.join(dir,'journal.json'),store=new FileTransactionIntentStore({filePath}),lifecycle=new DesktopKeyLifecycle({authorizer:{available:()=>true,authenticate:async()=>{},inProcess:true},focused:()=>true,schedule:()=>null,unschedule:()=>{}});lifecycle.setAccount(account);await lifecycle.unlock();
 const f={mode:'open-partial',at:new Date(),registry:PRODUCT_SESSION_REGISTRY,counts:{open:0,readReview:0,prepare:0,submit:0,clientClose:0,plan:0,sign:0,verify:0,accountAcquire:0,accountClose:0}};configurePUBLICRegistration(f);f.selection=createPUBLICSelection(account,networkId);f.originals=originalRequest(f);
 const policy={version:'YNX-PRODUCT-SESSION-ACCOUNT-POLICY/v1',networkId,canonicalOwner:account,checkpoint:{kind:'trusted-node-committed/v1',height:'100',blockHash:'22'.repeat(32)},policyVersion:'YNX-ACCOUNT-POLICY/v1',algorithmVersion:'YNX-BATCH/v0.1',activeRecord:{revision:'1',registeredAt:'10',activeFrom:'20',pkA:'11'.repeat(2592),pkB:'22'.repeat(64)},observedAt:f.at.toISOString(),expiresAt:new Date(+f.at+60000).toISOString()};const recognized=new WeakSet();
 const vault={authorization:lifecycle,async status(){return{initialized:true,account};},async withPQKeys(_binding,action,permission){permission.assert();if(mode==='before-signer-false')throw false;const result=action(Object.freeze({PUBLICHandle:true}));if(mode==='late-lock')lifecycle.lock();if(f.afterSignerReturn)await f.afterSignerReturn();permission.assert();return result;}};
 const authority=new DesktopWalletAuthority({vault,permissions:new MemoryPermissionStore(),transactionSender:{submissions:{intentStore:store}},pqNetworkId:networkId,pqSessionSource:async()=>{f.counts.accountAcquire++;if(mode==='missing-policy')throw false;let retired=false;const r={readOriginal:()=>policy,assertCurrent(){if(retired)throw Error('PUBLIC policy retired');},async recheck(){},retire(){retired=true;},async join(){},async close(){f.counts.accountClose++;if(mode==='cleanup-false')throw false;}};recognized.add(r);return r;},pqSessionRecognized:r=>recognized.has(r)});
 f.vault=vault;f.authority=authority;f.store=store;f.filePath=filePath;f.lifecycle=lifecycle;f.controller=createOriginalDeviceRegistrationController({vault,networkId,authority});f.run=op=>lifecycle.run(op);f.event=createPUBLICRegistrationEvent(new URL('../src/index.html',import.meta.url).href);f.prepare=()=>f.run(()=>f.controller.prepareAccountApprovalReview(f.selection,f.originals));f.disk=async()=>JSON.parse(await fs.readFile(filePath,'utf8'));return f;
}
test('first account approval prepares independently, saves original signature under real Main journal, never opens pending Source or pairs',async t=>{const f=await setup(t),p=await f.prepare();assert.equal(p.method,'ynx_approveProductDeviceV4Account');assert.equal(f.counts.open,0);assert.equal(f.counts.sign,0);const result=await f.run(()=>f.controller.approveOriginal(f.event,p.id));assert.equal(result.phase,'account-approval-retained');assert.equal(result.accountApprovalSaved,true);assert.equal(result.pairSubmitted,false);assert.equal(result.registered,false);assert.equal(result.newSession,false);assert.equal(f.counts.sign,1);assert.equal(f.counts.accountAcquire,1);assert.equal(f.counts.accountClose,1);assert.equal(f.counts.prepare,0);assert.equal(f.counts.submit,0);assert.equal(f.counts.open,0);const row=(await f.disk()).sessionOriginals[0];assert.equal(row.operationId,f.originals.operationId);assert.equal(row.registrationOriginal,f.originals.registrationOriginal);assert.equal(row.approval.original,f.approvalOriginal);assert.equal(row.pairSubmission,null);assert.equal(row.cleanupComplete,true);await assert.rejects(f.run(()=>f.controller.approveOriginal(f.event,p.id)),{code:'DEVICE_REGISTRATION_REVIEW_ALREADY_DECIDED'});assert.equal(f.counts.sign,1);await f.controller.close();});
test('public originals alone or a foreign IPC frame cannot become account approval',async t=>{const f=await setup(t);assert.throws(()=>f.authority.approveOriginalDeviceRegistration(f.originals,{assert(){}}),{code:'DEVICE_REGISTRATION_ORIGINAL_REVIEW_REQUIRED'});const p=await f.prepare();await assert.rejects(f.run(()=>f.controller.approveOriginal({...f.event,senderFrame:{url:f.event.senderFrame.url}},p.id)),e=>e.data?.code==='UNTRUSTED_WALLET_FRAME');assert.equal(f.counts.sign,0);assert.equal(f.counts.accountAcquire,0);await f.controller.rejectOriginal(p.id);assert.equal(f.counts.open,0);});
test('reject/cancel independent review enters neither policy, keys nor pending profile/journal',async t=>{const f=await setup(t),p=await f.prepare();const result=await f.controller.rejectOriginal(p.id);assert.equal(result.phase,'cancelled-before-account');assert.equal(f.counts.sign,0);assert.equal(f.counts.accountAcquire,0);assert.equal(f.counts.open,0);await assert.rejects(fs.readFile(f.filePath));});
for(const mode of ['late-lock','cleanup-false'])test('first approval '+mode+' retains SAME journal original and never repeats signature or HTTP',async t=>{const f=await setup(t,mode),p=await f.prepare();await assert.rejects(f.run(()=>f.controller.approveOriginal(f.event,p.id)));const row=(await f.disk()).sessionOriginals[0];assert.equal(row.approval.original,f.approvalOriginal);assert.equal(row.pairSubmission,null);assert.equal(f.counts.sign,1);assert.equal(f.counts.submit,0);assert.equal(f.counts.open,0);assert.equal(f.counts.accountClose,1);await assert.rejects(f.run(()=>f.controller.approveOriginal(f.event,p.id)));assert.equal(f.counts.sign,1);if(mode==='cleanup-false')assert.equal(row.cleanupCause.kind,'boolean');});
test('missing real committed policy is still refused after explicit review; no Source exception',async t=>{const f=await setup(t,'missing-policy'),p=await f.prepare();await assert.rejects(f.run(()=>f.controller.approveOriginal(f.event,p.id)),e=>e===false);assert.equal(f.counts.sign,0);assert.equal(f.counts.open,0);assert.equal(f.counts.submit,0);});
for(const mode of ['normal','before-signer-false'])test('cold same request remains query-only after '+mode+'; no replacement review or signature',async t=>{const f=await setup(t,mode),p=await f.prepare();if(mode==='normal')await f.run(()=>f.controller.approveOriginal(f.event,p.id));else await assert.rejects(f.run(()=>f.controller.approveOriginal(f.event,p.id)),e=>e===false);await f.controller.close();const coldStore=new FileTransactionIntentStore({filePath:f.filePath});
 const cold=createOriginalDeviceRegistrationController({
  vault:f.vault, networkId, authority:{approveOriginalDeviceRegistration:()=>assert.fail('Cold query entered approval'),transactionSender:{submissions:{intentStore:coldStore}}}
 });
 const [row]=await f.run(()=>coldStore.sessionRecoverySummaries(account,()=>f.lifecycle.current().assert()));
 const read=()=>f.run(()=>cold.readOriginalPairOutcome(row.requestDigest));
 const result=await read();
 assert.equal(result.status,'not-entered');
 assert.equal(result.signed,mode==='normal');
 assert.equal(result.queryOnly,true);
 assert.equal(result.canRetry,false);
 assert.equal(result.registered,false);
 assert.equal(result.originalResponseRetained,false);
 assert.equal(Object.hasOwn(result,'approval'),false);
 assert.equal(Object.hasOwn(result,'approvalOriginal'),false);
 class Element {
  children=[];
  listeners={};
  append(...children){this.children.push(...children);}
  replaceChildren(){this.children=[];}
  addEventListener(event,listener){this.listeners[event]=listener;}
 }
 const nodes=new Map(['#app-device-register','#app-device-register-cancel','#app-device-register-status','#app-device-registration-history'].map(id=>[id,new Element()]));
 let queries=0;
 const ui=bindDeviceRegistrationUI({
  root:{querySelector:id=>nodes.get(id),createElement:()=>new Element()},
  readContext:()=>f.lifecycle.status(),readCreation:()=>({phase:'idle'}),
  api:{
   deviceRegistrationStatus:async()=>({ok:true,value:cold.readStatusDATA()}),
   deviceRegistrationHistory:async()=>({ok:true,value:[row]}),
   deviceRegistrationOutcome:async digest=>{
    assert.equal(digest,row.requestDigest);
    queries++;
    return {ok:true,value:await read()};
   }
  }
 });
 await ui.refresh();
 const [item]=nodes.get('#app-device-registration-history').children;
 const [,query,text]=item.children;
 const expected=mode==='normal'?/Original account approval saved/:/Original account approval outcome is unknown/;
 assert.match(text.textContent,expected);
 await query.listeners.click();
 assert.match(text.textContent,expected);
 assert.equal(queries,1);
 assert.equal(item.children.length,3);
 await assert.rejects(f.run(()=>cold.prepareAccountApprovalReview(f.selection,f.originals)),{code:'DEVICE_REGISTRATION_QUERY_ORIGINAL_ONLY'});assert.equal(f.counts.sign,mode==='normal'?1:0);assert.equal(f.counts.open,0);await cold.close();});
test('sole public codecs bind exact original bytes/app/generation/pair/request digest/window without issuing or renewing an operation',async t=>{const f=await setup(t),at=f.at,ok=inspectOriginalDeviceAccountApprovalDATA(f.selection,f.originals,{networkId,account,at});assert.equal(ok.scope.pendingId,f.originals.operationId);assert.equal(ok.scope.registrationOriginal,f.originals.registrationOriginal);assert.equal(ok.approvedAccount,false);assert.equal(ok.SourceAdmission,false);for(const change of [o=>o.extra=true,o=>delete o.operationId,o=>o.operationId='PUBLIC-not-an-allocation-hash',o=>o.requestOriginal=' '+o.requestOriginal,o=>{const r=JSON.parse(o.requestOriginal);r.deviceRegistrationDigest='b'.repeat(64);o.requestOriginal=canonicalJSON(r);},o=>{const r=JSON.parse(o.registrationOriginal);r.generation='2';o.registrationOriginal=canonicalJSON(r);},o=>{const r=JSON.parse(o.registrationOriginal);r.pkB='55'.repeat(64);o.registrationOriginal=canonicalJSON(r);},o=>{const r=JSON.parse(o.requestOriginal);r.expiresAt=r.issuedAt;o.requestOriginal=canonicalJSON(r);}]){const o=structuredClone(f.originals);change(o);assert.throws(()=>inspectOriginalDeviceAccountApprovalDATA(f.selection,o,{networkId,account,at}));}assert.equal(f.counts.open,0);assert.equal(f.counts.sign,0);});
test('existing registration IPC remains zeroarg and does not accept new public DTO or fabricate fixed request getter',async()=>{const main=await fs.readFile(new URL('../src/main.mjs',import.meta.url),'utf8'),section=main.slice(main.indexOf("handleWalletIPC('wallet:prepare-device-registration'"),main.indexOf("handleWalletIPC('wallet:device-registration-status'"));assert.match(section,/if\(args.length\)/);assert.match(section,/prepareReview\(selection\)/);assert.doesNotMatch(section,/prepareAccountApprovalReview|requestOriginal|registrationOriginal/);});

test('explicit cancellation after signer return waits original capture/save rather than claiming unsigned cancellation',async t=>{
 const f=await setup(t);let entered,release;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);f.afterSignerReturn=async()=>{entered();await gate;};const p=await f.prepare(),approval=f.run(()=>f.controller.approveOriginal(f.event,p.id)),refused=assert.rejects(approval);await ready;const cancelled=f.controller.rejectOriginal(p.id);release();await refused;const result=await cancelled,row=(await f.disk()).sessionOriginals[0];assert.equal(row.approval.original,f.approvalOriginal);assert.equal(result.phase,'account-approval-retained');assert.equal(result.accountApprovalSaved,true);assert.equal(result.queryOnly,true);assert.equal(row.pairSubmission,null);assert.equal(f.counts.sign,1);assert.equal(f.counts.open,0);assert.equal(f.counts.submit,0);assert.equal(f.counts.accountClose,1);
});
