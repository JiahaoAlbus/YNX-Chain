import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';import {AsyncLocalStorage} from 'node:async_hooks';
import {canonicalJSON} from '@ynx-chain/wallet-auth';import {createOriginalWalletPayContextBridge} from '../src/original-policy-supplier/pay-native-context.mjs';
const code=await fs.readFile(new URL('../src/main.mjs',import.meta.url),'utf8'),start=code.indexOf('export function captureOriginalWalletPayContextForNative('),end=code.indexOf('\nasync function executeOriginalPQBroadcast(',start);assert.ok(start>0&&end>start);
// Execute actual Main capture/acquire body. Native factory, permission/borrow
// predicates, keyAccess and already-verified journal reader are PUBLIC seams.
function fixture({query=false}={}){
 let locked=false,changed=false,calls=0;const original=Object.freeze({account:'0x'+'11'.repeat(20),hash:'0x'+'aa'.repeat(32)}),target=Object.freeze({service:'pay',kind:'invoice_terms',intentId:'npi_public'}),member=Buffer.from([1,2,3]);
 const guard={account:original.account,expiresAtMs:Date.now()+10000,assert(){if(locked)throw Error('PUBLIC_LOCK');},assertEffectCurrent(){if(locked)throw Error('PUBLIC_LOCK');}},request=Object.freeze({action:'broadcast'}),permission=Object.freeze({readOriginal:()=>({expiresAt:new Date(Date.now()+8000).toISOString()}),assertCurrent:()=>guard.assertEffectCurrent(),async recheck(){guard.assertEffectCurrent();}}),borrow=Object.freeze({readApprovalIdentity:()=>({reviewId:'PUBLIC-review'}),assertCurrent:()=>guard.assertEffectCurrent()}),capsule=Object.freeze(Object.create(null));
 const broadcast=new AsyncLocalStorage(),native=new AsyncLocalStorage(),owners=new WeakSet(),bridge=createOriginalWalletPayContextBridge(()=>native.getStore(),{isOriginalNativeOwner:x=>owners.has(x)});
 const sandbox={pqBroadcastApprovalContext:broadcast,pqPayNativeContext:native,originalPayContextBridge:bridge,keyAccess:{current:()=>guard},isOriginalWalletTransactionPermission:x=>x===permission,isOriginalPQTransactionReviewBorrow:x=>x===borrow,PQ_CANONICAL_NETWORK_ID:'aa'.repeat(32),canonicalJSON,
 async readPQSubmissionOriginal(_store,hash,{account,guard:g}){g.assert();assert.equal(hash,original.hash);assert.equal(account,original.account);return {binding:{hash:original.hash},original:changed?Object.freeze({...original,hash:'0x'+'bb'.repeat(32)}):original,typed:{local:{member}}};},
 originalPQPaySupply:{async acquireOriginalPaySource(){calls++;return sandbox.invoke();}},
 };
 const compiled=vm.compileFunction(code.slice(start,end).replaceAll('export function','function')+';return {captureOriginalWalletPayContextForNative,isOriginalWalletPayContextForNative,associateOriginalWalletPayNativeRetirement,copyOriginalWalletPayNativeDeadline,acquireOriginalMainPaySource};',[],{contextExtensions:[sandbox]})();
 const store={async readPQPaySubmissionTarget(account,hash,current){current();assert.equal(account,original.account);assert.equal(hash,original.hash);return target;}},parent={request,permission,borrow,capsule,hash:original.hash,payTarget:target,selected:true,closed:false};
 const input={request:query?null:request,original,target};
 return {compiled,parent,bridge,sandbox,member,original,target,permission,borrow,capsule,guard,owners,lock(){locked=true;},change(){changed=true;},calls:()=>calls,run:()=>query?compiled.acquireOriginalMainPaySource(input,store):broadcast.run(parent,()=>compiled.acquireOriginalMainPaySource(input,store)),outside:()=>compiled.acquireOriginalMainPaySource(input,store)};
}
test('actual Main fixed zero-input capture returns same approved refs only inside its source-acquisition ALS',async()=>{
 const f=fixture();assert.throws(()=>f.compiled.captureOriginalWalletPayContextForNative(),{code:'PAY_NATIVE_CONTEXT_NOT_ACTIVE'});
 let peer;f.sandbox.invoke=()=>{peer=f.compiled.captureOriginalWalletPayContextForNative();const r=peer.readOriginal();assert.equal(r.permission,f.permission);assert.equal(r.borrow,f.borrow);assert.equal(r.capsule,f.capsule);assert.equal(r.request,f.parent.request);assert.equal(f.compiled.isOriginalWalletPayContextForNative(peer),true);assert.equal(peer.claim(),undefined);return {PUBLIC:true};};
 await f.run();assert.equal(f.calls(),1);await peer.recheck();assert.deepEqual(peer.readOriginal().signedMember,f.member);await peer.close();f.bridge.assertSafeToClose();
});
test('actual Main query capture has null approval refs and derives Member/target from current selected journal',async()=>{
 const f=fixture({query:true});let peer;f.sandbox.invoke=()=>{peer=f.compiled.captureOriginalWalletPayContextForNative();return {};};await f.run();const r=peer.readOriginal();assert.equal(r.purpose,'query');for(const k of ['request','permission','capsule','borrow'])assert.equal(r[k],null);assert.deepEqual(r.signedMember,f.member);f.lock();assert.throws(()=>peer.assertCurrent(),/PUBLIC_LOCK/);await peer.close();
});
test('missing original approved ALS or changed original fails before calling Native factory',async()=>{
 const outside=fixture();await assert.rejects(outside.outside(),{code:'PAY_NATIVE_CONTEXT_APPROVAL_REQUIRED'});assert.equal(outside.calls(),0);
 const changed=fixture();changed.change();await assert.rejects(changed.run(),{code:'PAY_NATIVE_CONTEXT_ORIGINAL_REQUIRED'});assert.equal(changed.calls(),0);
});
test('factory falsy failure drains Main-only peer; actual nonnull partial retains it for Native/controller cleanup',async()=>{
 const f=fixture();let peer;f.sandbox.invoke=()=>{peer=f.compiled.captureOriginalWalletPayContextForNative();throw false;};await assert.rejects(f.run(),x=>x===false);assert.throws(()=>peer.assertCurrent(),{code:'PAY_NATIVE_CONTEXT_RETIRED'});f.bridge.assertSafeToClose();
 const p=fixture();let held;p.sandbox.invoke=()=>{held=p.compiled.captureOriginalWalletPayContextForNative();throw Object.assign(Error('PUBLIC_PARTIAL'),{partial:{PUBLIC:'native-owner'}});};await assert.rejects(p.run(),/PUBLIC_PARTIAL/);held.assertCurrent();assert.throws(()=>p.bridge.assertSafeToClose(),{code:'PAY_NATIVE_CONTEXT_CLOSE_UNCONFIRMED'});await held.close();p.bridge.assertSafeToClose();
});

test('actual Main fixed association exports bind same recognized owner and copy actual guard deadline',async()=>{
 const f=fixture({query:true});let peer,calls=0;const owner=Object.freeze(Object.defineProperty({},'retire',{value(){calls++;}}));f.owners.add(owner);
 f.sandbox.invoke=()=>{peer=f.compiled.captureOriginalWalletPayContextForNative();assert.equal(f.compiled.copyOriginalWalletPayNativeDeadline(peer).expiresAtMs,f.guard.expiresAtMs);assert.equal(f.compiled.associateOriginalWalletPayNativeRetirement(peer,owner),undefined);return owner;};
 assert.equal(await f.run(),owner);f.bridge.invalidateAll();assert.equal(calls,1);await assert.rejects(peer.close(),{code:'PAY_NATIVE_CONTEXT_NATIVE_JOIN_REQUIRED'});f.bridge.observedNativeJoin(owner);await peer.close();f.bridge.assertSafeToClose();
});
