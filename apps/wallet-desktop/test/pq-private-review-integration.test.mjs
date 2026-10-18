import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {EventEmitter} from 'node:events';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {bindPublicWindow} from './public-transaction-electron-fixture.mjs';
registerHooks({resolve(specifier,context,next){return next(specifier==='electron'?new URL('./public-transaction-electron-fixture.mjs',import.meta.url).href:specifier,context);}});
const {DesktopWalletAuthority,MemoryPermissionStore,isOriginalPQTransactionReviewBorrow}=await import('../src/desktop-wallet-authority.mjs');
const auth=await import('../src/original-policy-supplier/transaction-permission.mjs');
const {DesktopKeyLifecycle}=await import('../src/key-lifecycle.mjs');
const {FileTransactionIntentStore}=await import('../src/transaction-intent-store.mjs');
const {createPQTransactionSubmission}=await import('../src/features/pq-transaction/submission.mjs');
const keys=await import('@ynx-chain/wallet-auth/pq-wallet-key-backup');
const {pqPublicBindingToRegistrationKeys}=await import('@ynx-chain/wallet-auth/pq-wallet-authorization');
const {parsePQAccountAuthorization}=await import('@ynx-chain/wallet-auth/pq-wallet-policy');
const chain='a'.repeat(64),account='0x'+'11'.repeat(20);
async function fixture(t,{missingCapsule=false,lateLock=false,broadcastSource=null}={}){
 const dir=await fs.mkdtemp(path.join(tmpdir(),'PUBLIC-private-review-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const handle=await keys.createPQWalletKeyHandle({chainId:chain,owner:account});t.after(()=>keys.destroyPQWalletKeyHandle(handle));
 const binding=keys.readPQWalletKeyPublic(handle),pair=pqPublicBindingToRegistrationKeys(binding);
 const snapshot=parsePQAccountAuthorization({owner:account,executionHeight:'30',ledgerNonce:'1',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:chain,enableAt:'10',activeRevision:'1',records:[{algorithmVersion:pair.algorithmVersion,owner:account,pkA:pair.pkA,pkB:pair.pkB,revision:'1',registeredAt:'10',activeFrom:'20',ledgerNonce:'1'}]},{chainId:chain,nativeChainId:'6423',owner:account});
 const lifecycle=new DesktopKeyLifecycle({authorizer:{available:()=>true,authenticate:async()=>({account}),method:'PUBLIC-controlled'}});lifecycle.setFocused(true);await lifecycle.unlock();t.after(()=>lifecycle.lock());
 const at=Date.now(),view=Object.freeze({version:'YNX-WALLET-TRANSACTION-POLICY/v1',networkId:chain,nativeChainId:'6423',canonicalOwner:account,authorization:snapshot,observedAt:new Date(at-1000).toISOString(),expiresAt:new Date(at+60000).toISOString()});let retired=false,borrows=0,selected;
 const policy={assertCurrent(){if(retired)throw Error('PUBLIC-retired');},readOriginal:()=>view,recheck:async()=>{},retire(){retired=true;},join:async()=>{},close:async()=>{}};
 const store=new FileTransactionIntentStore({filePath:path.join(dir,'journal.json')});
 if(lateLock){const capture=store.captureOriginal.bind(store);store.captureOriginal=(...args)=>{capture(...args);lifecycle.lock();};}
 const vault={authorization:lifecycle,status:async()=>({initialized:true,account}),withPQKeys:async(_b,action,permission)=>{permission.assert();borrows++;return action(handle);}};
 const authority=new DesktopWalletAuthority({vault,permissions:new MemoryPermissionStore(),transactionSender:{submissions:{intentStore:store}},pqPolicySource:async()=>{retired=false;return policy;},pqPolicyRecognized:v=>v===policy,pqNetworkId:chain,pqTransactionPermissionSource:async(request,capsule,borrow)=>{selected=borrow;assert.equal(isOriginalPQTransactionReviewBorrow(borrow),true);return auth.acquireOriginalWalletTransactionPermission(request,capsule,borrow);},pqTransactionPermissionRecognized:auth.isOriginalWalletTransactionPermission,pqBroadcastSource:broadcastSource});
 const pending=await lifecycle.run(()=>authority.requestPQTransfer({to:'0x'+'22'.repeat(20),amount:'3'}));
 const sender=new EventEmitter();sender.isDestroyed=()=>false;sender.mainFrame={url:new URL('../src/index.html',import.meta.url).href};bindPublicWindow(sender);
 const event={sender,senderFrame:sender.mainFrame},capsule=missingCapsule?undefined:auth.captureOriginalWalletTransactionApprovalIPC(event,pending.request.id,'sign');
 return{authority,lifecycle,store,pending,capsule,sender,event,borrows:()=>borrows,borrow:()=>selected};
}
test('actual authority active-review borrow and actual Auth factory/kernel sign once; completed current survives pending removal',async t=>{
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
