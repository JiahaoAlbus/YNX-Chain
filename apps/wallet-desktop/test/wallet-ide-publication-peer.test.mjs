import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {readFileSync,readdirSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {WalletIDEIdentityPeerKernel} from '../src/wallet-ide-identity-peer-kernel.mjs';
import {WalletIDEIdentityReviewKernel} from '../src/wallet-ide-identity-review-kernel.mjs';
import {WalletIDEPublicationReviewKernel} from '../src/artifact-publication/publication-review-kernel.mjs';
import {WalletIDEIdentityEvidence} from '../src/wallet-ide-identity-evidence.mjs';
import {DesktopKeyLifecycle} from '../src/key-lifecycle.mjs';
// PUBLIC Native/source seams. Real Main peer, review control, lifecycle leases
// and immutable private filesystem/cold reads execute; no real key or network.
async function fixture(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'ynx-publication-peer-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const account='0x'+'ab'.repeat(20),network='cd'.repeat(32),raw='PUBLIC original release request',manifest={byteSize:3,contentDigest:'a'.repeat(64),projectId:'PUBLIC-project',publishPurpose:'release',targetEnvironment:'testnet',version:'PUBLIC-v1'},invocation=JSON.stringify(manifest),body={owner:account,networkId:network,purpose:'AUTH-PROTECTED-KEY-CALL',requestId:'PUBLIC-request',expiresAtMs:'30000'};
 const nativeId='11111111-1111-4111-8111-111111111111',ref='22222222-2222-4222-8222-222222222222',wire=Buffer.from(JSON.stringify({PUBLIC:'Native canonical result stand-in, not signed crypto'}));
 let approved=false,entered=false,signed=false,stored=false,retired=false,closed=false,closeSelected=false,sourceRetired=false,sourceCloses=0,signs=0,sends=0,saves=0,closes=0,oldSends=0,locked=false,captureFault=false,saveFault=false,selectionFault=false,sendFault=false,copyFault=false,approveFault=false,closeFault=false,viewFault=null,afterSign=()=>{};
 const directory=path.join(root,'evidence');
 const records=()=>{let names;try{names=readdirSync(directory);}catch{return [];}return names.map(n=>{const b=readFileSync(path.join(directory,n)),at=Buffer.byteLength('YNXIDEID1\n');return JSON.parse(b.subarray(at+4+b.readUInt32BE(at)).toString());});};
 const io={...fs,async open(...args){const h=await fs.open(...args);if(typeof args[1]==='number'&&(args[1]&1))return new Proxy(h,{get(o,k){if(k==='writeFile')return async bytes=>{if(selectionFault&&Buffer.from(bytes).includes(Buffer.from('"phase":"send-selected"'))){selectionFault=false;throw false;}return o.writeFile(bytes);};const v=Reflect.get(o,k);return typeof v==='function'?v.bind(o):v;}});return h;}};
 const evidence=new WalletIDEIdentityEvidence({directory,io});
 const native={copyOriginalReview(){if(captureFault)throw Object.assign(Error('PUBLIC publisher absent'),{code:'PUBLIC_PUBLISHER_ABSENT'});const view={reviewId:nativeId,requestId:body.requestId,purpose:'ARTIFACT-RELEASE',account,networkId:network,publication:manifest,publisherId:'PUBLIC-publisher',publisherRegistrationRef:'PUBLIC-registration',publisherRevision:'1',publisherKeyVersion:'2'};if(viewFault==='publication')view.publication={...manifest,version:'foreign'};else if(viewFault)view[viewFault]='foreign';return view;},
  approveOriginalReview(id){assert.equal(id,nativeId);assert(!retired&&!approved);if(approveFault)throw false;approved=true;return {actualApprovalRef:ref};},
  signOriginalRelease(id){assert.equal(id,ref);assert(approved&&!entered);assert(records().some(r=>r.phase==='decision-selected'&&r.decision==='approve'));entered=true;signs++;signed=true;stored=!saveFault;afterSign();if(saveFault)throw false;},
  copyOriginalSigningOutcome(){return {stored,effectEntered:entered,hasSignedResult:signed,phase:signed?'signed-unhanded':entered?'failed':'not-entered'};},copyOriginalPublicationResult(){if(copyFault)throw false;assert(signed);return new Uint8Array(wire);},saveOriginalSigningOutcome(){saves++;assert(entered&&!saveFault);stored=true;},
  async sendOriginalPublicationResult(){assert(!retired&&stored&&signed);const saved=records();assert(saved.some(r=>r.phase==='send-selected'&&r.wire===wire.toString('base64')));assert(saved.every(r=>r.version!=='YNX-WALLET-IDE-IDENTITY-EVIDENCE/v1'||r.decision!=='approve'));sends++;if(sendFault)throw false;},retire(){retired=true;},close(){assert(!entered||stored);if(!closeSelected){closeSelected=true;closes++;}if(closeFault)throw false;closed=true;}};
 const source={assertReady(){},current(){if(sourceRetired)throw Error('PUBLIC Source retired');},launch(){},async receiveRequest(){return {requestRaw:raw,invocationRaw:invocation};},copyRequestOriginal:()=>raw,async sendDecision(decision,proof){assert(['cancel','reject'].includes(decision));assert.equal(proof,undefined);oldSends++;},retire(){sourceRetired=true;},join(){},close(){assert.equal(closes,1);sourceCloses++;}};
 let review;
 const peer=new WalletIDEIdentityPeerKernel({evidence,acquireSource:()=>source,isSource:v=>v===source,inspect:()=>body,acquirePolicy:()=>assert.fail('publication must not acquire account Auth policy'),isPolicy:()=>false,isPolicyCleanupOwner:()=>false,
  createReview:args=>{assert.equal(args.originalSource,source);const base=new WalletIDEIdentityReviewKernel({...args,publication:{...manifest,dataOnly:true,artifactVerified:false,publisherCurrent:false,publicationAuthorized:false},inspect:()=>({body}),now:()=>1000,persistOriginal:r=>evidence.persist(r),createAction:()=>assert.fail('publication must not call account Auth signer')});return review=new WalletIDEPublicationReviewKernel({base,invocationOriginal:invocation,assertCurrent:args.assertCurrent,captureNative:()=>native});}});
 const life=new DesktopKeyLifecycle({authorizer:{available:()=>true,authenticate:async()=>({}),method:'PUBLIC unlock'},focused:()=>!locked});life.setAccount(account);await life.unlock();t.after(()=>life.lock());
 const run=fn=>life.run(()=>fn(life.current()));
 const coldHistory=async()=>{const forbidden=()=>assert.fail('cold history must not acquire Source, keys or Native'),cold=new WalletIDEIdentityPeerKernel({evidence:new WalletIDEIdentityEvidence({directory}),acquireSource:forbidden,isSource:forbidden,inspect:forbidden,createReview:forbidden,acquirePolicy:forbidden,isPolicy:forbidden,isPolicyCleanupOwner:forbidden});return run(g=>cold.history(g));};
 return {peer,evidence,run,wire,records,coldHistory,review:()=>review,counts:()=>({signs,sends,saves,closes,sourceCloses,oldSends}),captureFault:()=>{captureFault=true;},selectionFault:()=>{selectionFault=true;},saveFault:v=>{saveFault=v;},sendFault:()=>{sendFault=true;},copyFault:v=>{copyFault=v;},approveFault:()=>{approveFault=true;},closeFault:()=>{closeFault=true;},viewFault:k=>{viewFault=k;},afterSign:fn=>{afterSign=fn;},lock(){locked=true;life.lock('focus-lost');peer.retire();},async unlock(){locked=false;await life.unlock();}};
}
test('publication uses original Native holder, durable original result and send selection before kind6, never Auth proof2',async t=>{
 const f=await fixture(t),v=await f.run(g=>f.peer.start(g));assert.equal(v.approvalAvailable,true);assert.equal(v.nativePublication.publisherRegistrationRef,'PUBLIC-registration');
 const r=await f.run(g=>f.peer.decide(v.reviewId,'approve',g));assert.equal(r.recorded,true);assert.equal(r.sendReturned,true);assert.equal(r.effectAcknowledged,false);assert.equal(r.handoffAuthorized,false);await f.peer.shutdown();f.peer.assertSafeToClose();
 assert.deepEqual(f.counts(),{signs:1,sends:1,saves:0,closes:1,sourceCloses:1,oldSends:0});const h=await f.run(g=>f.peer.history(g));assert.equal(h.records[0].hasSignedResult,true);assert.equal(h.records[0].sendReturned,true);assert.equal(h.records[0].handoffAuthorized,false);
});
test('missing Native publisher keeps rejection/cancellation available and retains the acquisition cause',async t=>{
 for(const choice of ['reject','cancel']){const f=await fixture(t);f.captureFault();const v=await f.run(g=>f.peer.start(g));assert.equal(v.approvalAvailable,false);assert.equal(f.peer.status().firstCausePresent,true);await assert.rejects(f.run(g=>f.peer.decide(v.reviewId,'approve',g)),{code:'AUTH_IDENTITY_PUBLICATION_APPROVAL_NOT_SUPPLIED'});await f.run(g=>f.peer.decide(v.reviewId,choice,g));await f.peer.shutdown();assert.equal(f.counts().signs,0);assert.equal(f.counts().oldSends,1);}
});
test('lock after Native sign keeps exact result; unlock only drains original local metadata',async t=>{
 const f=await fixture(t),v=await f.run(g=>f.peer.start(g));f.afterSign(()=>f.lock());await assert.rejects(f.run(g=>f.peer.decide(v.reviewId,'approve',g)));assert.equal(f.review().status().hasSignedResult,true);assert(Buffer.from(f.review().readOriginalResult().wire).equals(f.wire));await f.unlock();await f.run(g=>f.peer.save(g));f.peer.assertSafeToClose();assert.equal(f.counts().signs,1);assert.equal(f.counts().sends,0);
});
test('Native result-save failure is explicitly reconciled after retirement with no replacement signature or send',async t=>{
 const f=await fixture(t),v=await f.run(g=>f.peer.start(g));f.saveFault(true);await assert.rejects(f.run(g=>f.peer.decide(v.reviewId,'approve',g)),e=>e===false);assert.throws(()=>f.peer.assertSafeToClose());f.saveFault(false);await f.run(g=>f.peer.save(g));f.peer.assertSafeToClose();assert.equal(f.counts().signs,1);assert.equal(f.counts().saves,1);assert.equal(f.counts().sends,0);assert(f.records().some(r=>r.firstCause.type==='boolean'));
});
test('send-selection persistence failure and uncertain kind6 return never reselect or resend',async t=>{
 for(const fault of ['selectionFault','sendFault']){const f=await fixture(t),v=await f.run(g=>f.peer.start(g));f[fault]();await assert.rejects(f.run(g=>f.peer.decide(v.reviewId,'approve',g)));await f.run(g=>f.peer.save(g));f.peer.assertSafeToClose();assert.equal(f.counts().signs,1);assert.equal(f.counts().sends,fault==='sendFault'?1:0);const h=await f.run(g=>f.peer.history(g));assert.equal(h.records[0].hasSignedResult,true);assert.equal(h.records[0].sendReturned,false);}
});
test('failed public copy retains Native signed state; explicit read recovery persists it without re-signing',async t=>{
 const f=await fixture(t),v=await f.run(g=>f.peer.start(g));f.copyFault(true);await assert.rejects(f.run(g=>f.peer.decide(v.reviewId,'approve',g)));assert.equal(f.review().status().hasSignedResult,true);assert.equal(f.peer.status().hasSignedResult,true);assert.equal(f.peer.status().signatureState,'signed-native-copy-pending');assert.equal(f.peer.status().resultCopyAvailable,false);assert.throws(()=>f.peer.assertSafeToClose());f.copyFault(false);await f.run(g=>f.peer.save(g));f.peer.assertSafeToClose();assert.equal(f.counts().signs,1);assert.equal(f.counts().saves,0);assert.equal(f.counts().sends,0);const h=await f.run(g=>f.peer.history(g));assert.equal(h.records[0].hasSignedResult,true);
});
test('cold history preserves known Native signature before a public wire copy can be recovered',async t=>{
 const f=await fixture(t),v=await f.run(g=>f.peer.start(g));f.copyFault(true);await assert.rejects(f.run(g=>f.peer.decide(v.reviewId,'approve',g)));const h=await f.coldHistory();assert.equal(h.records.length,1);assert.equal(h.records[0].hasSignedResult,true);assert.equal(h.records[0].resultCopyAvailable,false);assert.equal(h.records[0].signatureState,'signed-native-copy-pending');assert.equal(f.counts().signs,1);assert.equal(f.counts().sends,0);f.copyFault(false);await f.run(g=>f.peer.save(g));
});
test('foreign Native request/account/network/manifest/review cannot enable the approval path',async t=>{
 for(const key of ['requestId','account','networkId','publication','reviewId']){const f=await fixture(t);f.viewFault(key);const v=await f.run(g=>f.peer.start(g));assert.equal(v.approvalAvailable,false);await assert.rejects(f.run(g=>f.peer.decide(v.reviewId,'approve',g)));await f.run(g=>f.peer.decide(v.reviewId,'cancel',g));await f.peer.shutdown();assert.equal(f.counts().signs,0);}
});
test('failed Native approval before an effect records the failure and closes without fabricating a signed result',async t=>{
 const f=await fixture(t),v=await f.run(g=>f.peer.start(g));f.approveFault();await assert.rejects(f.run(g=>f.peer.decide(v.reviewId,'approve',g)),e=>e===false);assert.equal(f.review().status().hasSignedResult,false);await f.run(g=>f.peer.save(g));f.peer.assertSafeToClose();assert.equal(f.counts().signs,0);assert.equal(f.counts().saves,0);assert.equal(f.counts().sends,0);assert(f.records().some(r=>r.firstCause.type==='boolean'));
});
test('Native child cleanup uncertainty fences parent close and never selects another signature or return',async t=>{
 const f=await fixture(t),v=await f.run(g=>f.peer.start(g));await f.run(g=>f.peer.decide(v.reviewId,'approve',g));f.closeFault();await assert.rejects(f.peer.shutdown(),e=>e===false);assert.throws(()=>f.peer.assertSafeToClose());await assert.rejects(f.run(g=>f.peer.save(g)),e=>e===false);assert.deepEqual(f.counts(),{signs:1,sends:1,saves:0,closes:1,sourceCloses:0,oldSends:0});
});
