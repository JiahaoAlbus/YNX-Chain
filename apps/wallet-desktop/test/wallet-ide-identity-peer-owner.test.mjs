import test from 'node:test';import assert from 'node:assert/strict';
import {createWalletIDEIdentityPeerOwner} from '../src/wallet-ide-identity-peer-owner.mjs';
import {WalletIDEIdentityPeerKernel} from '../src/wallet-ide-identity-peer-kernel.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const flush=()=>new Promise(r=>setImmediate(r));
test('late fixed module load cannot construct or launch peer after Main shutdown; shutdown waits load',async()=>{
 const gate=deferred();let constructed=0;const held=createWalletIDEIdentityPeerOwner({load:()=>gate.promise,create(){constructed++;assert.fail('late peer');}});
 const loading=held.get();const observed=assert.rejects(loading,{code:'AUTH_IDENTITY_PEER_CLOSING'});let closed=false;const shutdown=held.shutdown().then(()=>closed=true);await flush();assert.equal(closed,false);assert.throws(()=>held.assertSafeToClose());gate.resolve({PUBLIC:true});await observed;await shutdown;assert.equal(constructed,0);held.assertSafeToClose();assert.throws(()=>held.get(),{code:'AUTH_IDENTITY_PEER_CLOSING'});
});
test('held original owner drains exactly once and remains reachable only for explicit recovery after failed close',async()=>{
 let fail=true,closes=0,creates=0;const cause=false,owner={retire(){},async shutdown(){closes++;if(fail)throw cause;},assertSafeToClose(){if(fail)throw cause;}};
 const held=createWalletIDEIdentityPeerOwner({load:async()=>({PUBLIC:true}),create(){creates++;return owner;}});assert.equal(await held.get(),owner);
 await assert.rejects(held.shutdown(),e=>e===cause);assert.throws(()=>held.assertSafeToClose());assert.equal(await held.get(),owner);fail=false;await held.shutdown();held.assertSafeToClose();assert.equal(creates,1);assert.equal(closes,2);
});
test('owner adopted during reentrant construction is drained even when get late fence refuses',async()=>{
 let shutdown,closed=0;const owner={retire(){},async shutdown(){closed++;},assertSafeToClose(){}};let held;
 held=createWalletIDEIdentityPeerOwner({load:async()=>({PUBLIC:true}),create(){shutdown=held.shutdown();return owner;}});
 await assert.rejects(held.get(),{code:'AUTH_IDENTITY_PEER_CLOSING'});await assert.rejects(shutdown,{code:'AUTH_IDENTITY_PEER_CLOSING'});assert.equal(closed,1);assert.throws(()=>held.assertSafeToClose());
});
function cold(evidence){const forbidden=()=>assert.fail('cold query must not open Native/approval/policy');return new WalletIDEIdentityPeerKernel({evidence,acquireSource:forbidden,isSource:forbidden,inspect:forbidden,createReview:forbidden,acquirePolicy:forbidden,isPolicy:forbidden,isPolicyCleanupOwner:forbidden});}
test('cold original record IO is adopted before execution; retirement rejects late result and shutdown waits actual read',async()=>{
 const gate=deferred(),entered=deferred();let candidates=0;const peer=cold({async candidates(){candidates++;entered.resolve();return gate.promise;},read(){assert.fail('retired index cannot select another disk read');},assertSafeToClose(){}}),guard={account:'0x'+'1'.repeat(40),assert(){}};
 const query=peer.history(guard),observed=assert.rejects(query,{code:'AUTH_IDENTITY_PEER_RETIRED'});await entered.promise;assert.throws(()=>peer.assertSafeToClose());let closed=false;const shutdown=peer.shutdown().then(()=>closed=true);await flush();assert.equal(closed,false);assert.throws(()=>peer.history(guard),{code:'AUTH_IDENTITY_PEER_CLOSING'});assert.throws(()=>peer.start(guard),{code:'AUTH_IDENTITY_PEER_CLOSING'});gate.resolve({candidates:[{PUBLIC:true}],unreadable:0});await observed;await shutdown;peer.assertSafeToClose();assert.equal(candidates,1);
});
test('retiring query before first microtask performs no disk or Native work',async()=>{
 let reads=0;const peer=cold({candidates(){reads++;return{candidates:[],unreadable:0};},assertSafeToClose(){}}),guard={account:'0x'+'1'.repeat(40),assert(){}};const query=peer.history(guard);peer.retire();await assert.rejects(query,{code:'AUTH_IDENTITY_PEER_RETIRED'});assert.equal(reads,0);await peer.shutdown();peer.assertSafeToClose();
});
test('cold read retains original disk cause, finishes custody, and never reissues',async()=>{
 const cause=Object.assign(Error('PUBLIC disk error'),{code:'PUBLIC_IO'});let reads=0;const peer=cold({async candidates(){reads++;throw cause;},assertSafeToClose(){}});await assert.rejects(peer.history({assert(){}}),e=>e===cause);await peer.shutdown();peer.assertSafeToClose();assert.equal(reads,1);
});
