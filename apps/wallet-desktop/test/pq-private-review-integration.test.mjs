import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {EventEmitter} from 'node:events';
import * as fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {bindPublicWindow} from './public-transaction-electron-fixture.mjs';
registerHooks({resolve(specifier,context,next){return next(specifier==='electron'?new URL('./public-transaction-electron-fixture.mjs',import.meta.url).href:specifier,context);}});
const {DesktopWalletAuthority,MemoryPermissionStore,isOriginalPQTransactionReviewBorrow}=await import('../src/desktop-wallet-authority.mjs');
const auth=await import('../src/original-policy-supplier/transaction-permission.mjs');
const {DesktopKeyLifecycle}=await import('../src/key-lifecycle.mjs');
const {FileTransactionIntentStore}=await import('../src/transaction-intent-store.mjs');
const {createPQTransactionSubmission}=await import('../src/features/pq-transaction/submission.mjs');
const {decodePQMigrationRequest,decodePQTransferRequest,encodePQNativeTransfer}=await import('@ynx-chain/wallet-auth/pq-wallet-authorization');
const {parsePQAccountAuthorization}=await import('@ynx-chain/wallet-auth/pq-wallet-policy');
const {captureCometPolicyObservation}=await import('../src/original-policy-supplier/comet-projection.mjs');
const {encodeObservedPolicyOriginal}=await import('../src/original-policy-supplier/operator-policy-original.mjs');
// PUBLIC fixture only: the fixed member was created for a separate synthetic
// test. This Native custody stand-in performs no cryptography, key access,
// production approval, external I/O or actual Native provider invocation.
const vector=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/pq-public-http-af1cbaf.json.gz',import.meta.url))));
const decode=name=>decodePQMigrationRequest(Buffer.from(vector.originals.find(r=>r.name===name).wire,'base64'));
const first=decode('initial-migration').intent,second=decode('rotation').intent;
const member=Buffer.from(vector.originals.find(r=>r.name==='transfer-lost-response').wire,'base64');
const transfer=decodePQTransferRequest(member).transfer,chain=transfer.chainId,account=transfer.from;
async function fixture(t,{missingCapsule=false,lateLock=false,broadcastSource=null}={}){
 const dir=await fs.mkdtemp(path.join(tmpdir(),'PUBLIC-private-review-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const record=(intent,registeredAt)=>({algorithmVersion:intent.algorithmVersion,owner:account,pkA:intent.pkA,pkB:intent.pkB,revision:intent.newRevision,registeredAt,activeFrom:intent.activateAt,ledgerNonce:intent.ledgerNonce});
 const snapshot=parsePQAccountAuthorization({owner:account,executionHeight:'6',ledgerNonce:'3',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:chain,enableAt:'1',activeRevision:'2',records:[record(first,'2'),record(second,'4')]},{chainId:chain,nativeChainId:'6423',owner:account});
 const lifecycle=new DesktopKeyLifecycle({authorizer:{available:()=>true,authenticate:async()=>({account}),method:'PUBLIC-controlled'}});lifecycle.setFocused(true);await lifecycle.unlock();t.after(()=>lifecycle.lock());
 const policyBytes=Buffer.from(JSON.stringify({version:snapshot.policyVersion,networkId:chain,enableAt:snapshot.enableAt,records:snapshot.records}));
 const at=Date.now(),observation=captureCometPolicyObservation({kind:'comet-node-observed-app-state/v1',source:'comet-rpc',recordsView:'committed',committedHeight:'5',committedAppHash:'a'.repeat(64),independentFinality:false},snapshot);
 const view=Object.freeze({version:'YNX-WALLET-TRANSACTION-POLICY/v3',networkId:chain,nativeChainId:'6423',canonicalOwner:account,authorization:snapshot,observation,originalPolicy:encodeObservedPolicyOriginal(policyBytes.toString(),snapshot),observedAt:new Date(at-1000).toISOString(),expiresAt:new Date(at+60000).toISOString()});let retired=false,borrows=0,sourceReads=0,selected;
 const policy={assertCurrent(){if(retired)throw Error('PUBLIC-retired');},readOriginal:()=>view,copyOriginalPolicyBytes:()=>new Uint8Array(policyBytes),recheck:async()=>{},retire(){retired=true;},join:async()=>{},close:async()=>{}};
 const store=new FileTransactionIntentStore({filePath:path.join(dir,'journal.json')});
 if(lateLock){const capture=store.capturePQTransferMember.bind(store);store.capturePQTransferMember=(...args)=>{const result=capture(...args);lifecycle.lock();return result;};}
 const vault={authorization:lifecycle,status:async()=>({initialized:true,account}),assertPQNativeTransactionAvailable(){},withPQKeys(){assert.fail('No portable signer fallback');},withPQNativeTransaction:async(binding,request,capture,permission)=>{permission.assert();assert.equal(binding.owner,account);assert.deepEqual(request.policyOriginal,policyBytes);assert.deepEqual(request.messageOriginal,Buffer.from(encodePQNativeTransfer(transfer)));assert.equal(request.keyVersion,snapshot.activeRevision);assert.equal(request.executionHeight,snapshot.executionHeight);borrows++;capture({member:Buffer.from(member)});permission.assert();}};
 const authority=new DesktopWalletAuthority({vault,permissions:new MemoryPermissionStore(),transactionSender:{submissions:{intentStore:store}},pqPolicySource:async()=>{sourceReads++;retired=false;return policy;},pqPolicyRecognized:v=>v===policy,pqNetworkId:chain,pqTransactionPermissionSource:async(request,capsule,borrow)=>{selected=borrow;assert.equal(isOriginalPQTransactionReviewBorrow(borrow),true);return auth.acquireOriginalWalletTransactionPermission(request,capsule,borrow);},pqTransactionPermissionRecognized:auth.isOriginalWalletTransactionPermission,pqBroadcastSource:broadcastSource});
 const pending=await lifecycle.run(()=>authority.requestPQTransfer({to:transfer.to,amount:transfer.amount}));
 const sender=new EventEmitter();sender.isDestroyed=()=>false;sender.mainFrame={url:new URL('../src/index.html',import.meta.url).href};bindPublicWindow(sender);
 const event={sender,senderFrame:sender.mainFrame},capsule=missingCapsule?undefined:auth.captureOriginalWalletTransactionApprovalIPC(event,pending.request.id,'sign');
 return{authority,lifecycle,store,pending,capsule,sender,event,borrows:()=>borrows,sourceReads:()=>sourceReads,borrow:()=>selected};
}
test('actual authority and Auth factory/kernel capture one PUBLIC Native stand-in result; completed current survives pending removal',async t=>{
 const f=await fixture(t),result=await f.lifecycle.run(()=>f.authority.approve(f.pending.request.id,f.capsule));
 assert.equal(result.status,'success');assert.equal(f.borrows(),1);assert.equal((await f.store.readPQOriginals(account,()=>{})).length,1);
 assert.equal(isOriginalPQTransactionReviewBorrow({}),false);assert.throws(()=>f.borrow().assertCurrent());assert.equal(f.sender.listenerCount('destroyed'),0);
 await assert.rejects(()=>f.authority.approve(f.pending.request.id,f.capsule));assert.equal(f.borrows(),1);
});
test('separate broadcast active review uses fresh capsule, durable marker and one controlled effect; another review cannot repeat',async t=>{
 let f,controller,context,posts=0;
 const execute=async value=>{context=value;try{return await controller.broadcast(value.hash,value.guard);}finally{context=null;value.borrow.retire();await value.borrow.join();await value.borrow.close();}};
 f=await fixture(t,{broadcastSource:execute});
 controller=createPQTransactionSubmission({intentStore:f.store,networkId:chain,isOriginalWalletTransactionPermission:auth.isOriginalWalletTransactionPermission,acquireOriginalWalletTransactionPermission:request=>{assert.deepEqual(request,context.request);return auth.acquireOriginalWalletTransactionPermission(request,context.capsule,context.borrow);},transport:{submitTransfer:async(_request,current)=>{current();posts++;throw false;}}});
 const signed=await f.lifecycle.run(()=>f.authority.approve(f.pending.request.id,f.capsule)),hash=signed.result.hash;
 const review=await f.lifecycle.run(()=>f.authority.requestPQBroadcast(hash));assert.notEqual(review.request.id,f.pending.request.id);assert.equal(review.request.review.operationId,f.pending.request.id);
 const capsule=auth.captureOriginalWalletTransactionApprovalIPC(f.event,review.request.id,'broadcast');
 await assert.rejects(()=>f.lifecycle.run(()=>f.authority.approve(review.request.id,capsule)));
 assert.equal(posts,1);assert.equal(f.borrows(),1);
 assert.equal((await f.store.readPQProgress(account,hash,()=>{})).status,'submission-unknown');
 await assert.rejects(()=>f.lifecycle.run(()=>f.authority.requestPQBroadcast(hash)));assert.equal(posts,1);
 assert.equal(f.sender.listenerCount('destroyed'),0);
});
test('configured production permission supplier refuses missing real capsule before key borrow',async t=>{
 const f=await fixture(t,{missingCapsule:true});await assert.rejects(()=>f.lifecycle.run(()=>f.authority.approve(f.pending.request.id)),e=>e.data?.code==='PQ_TRANSACTION_PERMISSION_NOT_SUPPLIED');assert.equal(f.borrows(),0);
});
test('late lock retains signed original before permission completion refusal and never signs again',async t=>{
 const f=await fixture(t,{lateLock:true});await assert.rejects(()=>f.lifecycle.run(()=>f.authority.approve(f.pending.request.id,f.capsule)));
 assert.equal(f.borrows(),1);assert.ok(f.store.localOriginal(account)?.pq?.wire);assert.equal(f.sender.listenerCount('destroyed'),0);
});
test('lost signed-result save after focus loss refuses a fresh review while retaining original recovery',async t=>{
 const f=await fixture(t,{lateLock:true});await assert.rejects(()=>f.lifecycle.run(()=>f.authority.approve(f.pending.request.id,f.capsule)));
 const held=f.store.localOriginal(account),originalWire=held.pq.wire,originalHash=held.pq.hash;
 assert.ok((await f.store.unresolvedPreparation(account)));assert.equal(f.borrows(),1);
 await f.lifecycle.unlock();
 await assert.rejects(()=>f.lifecycle.run(()=>f.authority.requestPQTransfer({to:transfer.to,amount:transfer.amount})),e=>e.data?.code==='PQ_ORIGINAL_RECONCILE_REQUIRED');
 assert.equal(f.borrows(),1);assert.equal(f.store.localOriginal(account).pq.wire,originalWire);
 const cold=new FileTransactionIntentStore({filePath:f.store.filePath});f.authority.transactionSender.submissions.intentStore=cold;
 await assert.rejects(()=>f.lifecycle.run(()=>f.authority.requestPQTransfer({to:transfer.to,amount:transfer.amount})),e=>e.data?.code==='PQ_ORIGINAL_RECONCILE_REQUIRED');
 assert.ok(await cold.unresolvedPreparation(account));assert.equal(f.borrows(),1);
 await f.store.saveOriginal(account,originalHash,()=>{});assert.equal((await f.store.readPQOriginals(account,()=>{}))[0].wire,originalWire);
 await f.store.reserveOriginal('0x'+'ee'.repeat(20),'pq-transfer');
 const next=await f.lifecycle.run(()=>f.authority.requestPQTransfer({to:transfer.to,amount:transfer.amount}));assert.equal(next.status,'approval-required');
 assert.throws(()=>f.authority.reject(next.request.id));assert.equal(f.borrows(),1);
});
test('focus loss while checking the original journal cannot acquire a new policy or approval',async t=>{
 const f=await fixture(t,{lateLock:true});await assert.rejects(()=>f.lifecycle.run(()=>f.authority.approve(f.pending.request.id,f.capsule)));
 const held=f.store.localOriginal(account);await f.lifecycle.unlock();await f.store.saveOriginal(account,held.pq.hash,()=>{});
 let release,entered;const started=new Promise(resolve=>{entered=resolve}),gate=new Promise(resolve=>{release=resolve});
 const original=f.store.unresolvedPreparation.bind(f.store);f.store.unresolvedPreparation=async selected=>{entered();await gate;return original(selected);};
 const before=f.sourceReads(),work=f.lifecycle.run(()=>f.authority.requestPQTransfer({to:transfer.to,amount:transfer.amount}));
 await started;f.lifecycle.lock();release();await assert.rejects(work);assert.equal(f.sourceReads(),before);assert.equal(f.borrows(),1);
 assert.equal((await f.store.readPQOriginals(account,()=>{}))[0].hash,held.pq.hash);
});
test('R95 navigation before factory retires actual original borrow without key access or preparation marker',async t=>{
 const f=await fixture(t);f.sender.emit('did-start-navigation');
 await assert.rejects(()=>f.lifecycle.run(()=>f.authority.approve(f.pending.request.id,f.capsule)));
 assert.equal(f.borrows(),0);assert.equal(await f.store.unresolvedPreparation(account),null);
 assert.throws(()=>f.borrow().assertCurrent());assert.equal(f.sender.listenerCount('destroyed'),0);
});
test('cancelling fresh broadcast review retains signed original and enters no effect',async t=>{
 let effects=0;const f=await fixture(t,{broadcastSource:async()=>{effects++;}}),signed=await f.lifecycle.run(()=>f.authority.approve(f.pending.request.id,f.capsule));
 const review=await f.lifecycle.run(()=>f.authority.requestPQBroadcast(signed.result.hash));
 assert.throws(()=>f.authority.reject(review.request.id));
 assert.equal(effects,0);assert.equal((await f.store.readPQProgress(account,signed.result.hash,()=>{})).status,'signed-unsubmitted');assert.equal(f.borrows(),1);
});
