import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DesktopKeyLifecycle} from '../src/key-lifecycle.mjs';
const load=()=>import('../src/wallet-pq-key-entry.mjs');
const account='0x'+'1'.repeat(40),network='2'.repeat(64);
async function fixture({late=false}={}){
 const {createPQKeyPreparationEntry}=await load();
 const lifecycle=new DesktopKeyLifecycle({authorizer:{available:()=>true,authenticate:async()=>{},inProcess:true},focused:()=>true,schedule:()=>null,unschedule:()=>{}});
 lifecycle.setAccount(account);await lifecycle.unlock();
 const handle={},binding={chainId:network,owner:account},receipt={recordDigest:'TEST-ONLY'};
 let creates=0,saves=0,reads=0,retires=0,resolve,entered;
 const started=new Promise(r=>entered=r),gate=new Promise(r=>resolve=r);
 const sdk={validatePQNetworkBinding:v=>v,createPQWalletKeyHandle:async()=>{creates++;return handle;},readPQWalletKeyPublic:()=>binding,assertPQPublicBindingMatches:(a,b)=>assert.deepEqual(a,b),restorePQWalletKeyHandle:()=>assert.fail('No restore or signature requested'),destroyPQWalletKeyHandle:()=>{retires++;return true;},readPQWalletKeyCleanupOutcome:()=>({retired:true,cleanupComplete:true,cleanupUnknown:false})};
 const vault={assertPQPreparationAvailable:async()=>{},reservePQPreparation:async input=>{assert.equal(input.operationId,'TEST-original');assert.equal(input.network.owner,account);},savePQKeys:async input=>{assert.equal(input.handle,handle);saves++;entered();if(late)await gate;return receipt;},readPQKeys:async()=>{reads++;return receipt;},verifySavedPQKeys:async input=>input.receipt===receipt};
 return {entry:createPQKeyPreparationEntry({lifecycle,vault,sdk,networkId:network,id:()=> 'TEST-original'}),lifecycle,vault,started,resolve,counts:()=>({creates,saves,reads,retires})};
}
test('normal PQ entry binds selected protected account and saves once, exposing no SDK handle',async()=>{
 const f=await fixture();const result=await f.entry.generate();assert.equal(result.persisted,true);
 assert.equal(JSON.stringify(result).includes('recordDigest'),false);
 await assert.rejects(f.entry.generate());assert.deepEqual(f.counts(),{creates:1,saves:1,reads:0,retires:0});
 f.lifecycle.lock();assert.equal(f.entry.status().persisted,true);assert.equal(f.counts().retires,1);
});
test('normal PQ entry retains late save across lock and read-only reconciles original without generating again',async()=>{
 const f=await fixture({late:true}),work=f.entry.generate();await f.started;f.lifecycle.lock();f.resolve();await assert.rejects(work);
 assert.equal(f.entry.status().phase,'save-unknown');await f.lifecycle.unlock();await f.entry.reconcile();
 assert.equal(f.entry.status().persisted,true);assert.deepEqual(f.counts(),{creates:1,saves:1,reads:1,retires:1});
});
test('normal main and preload expose only status, explicit generate, original reconcile and cancel',async()=>{
 const main=await readFile(new URL('../src/main.mjs',import.meta.url),'utf8'),preload=await readFile(new URL('../src/preload.cjs',import.meta.url),'utf8');
 assert.ok(main.includes('pqKeyPreparation = createPQKeyPreparationEntry'),'normal-main factory must be instantiated');
 for(const action of ['status','generate','reconcile','cancel','recover']){assert.ok(main.includes(`wallet:pq-keys-${action}`));assert.ok(preload.includes(`wallet:pq-keys-${action}`));}
 assert.equal(preload.includes('selectRetainedOutcome'),false);assert.equal(preload.includes('selectOriginal'),false);
});
test('PQ known existing record is refused before entering custody generation or creating false UNKNOWN',async()=>{
 const f=await fixture();const refuse=async()=>{throw Object.assign(Error('ORIGINAL_EXISTS'),{code:'PASSWORD_VAULT_PQ_ORIGINAL_EXISTS'});};f.vault.assertPQPreparationAvailable=refuse;f.vault.reservePQPreparation=refuse;
 await assert.rejects(f.entry.generate());assert.equal(f.entry.status().preparationUnknown,false);assert.equal(f.counts().creates,0);
});
test('PQ recovered fact cannot be cached under another account after lifecycle result delivery',async()=>{
 const f=await fixture();f.vault.readPQPreparationStatus=async()=>({phase:'saved',persisted:true,cleanupDebt:false});
 const run=f.lifecycle.run.bind(f.lifecycle);f.lifecycle.run=async action=>{const value=await run(action);f.lifecycle.setAccount('0x'+'3'.repeat(40));return value;};
 await assert.rejects(f.entry.recover());assert.equal(f.entry.status().persisted,false);
});
