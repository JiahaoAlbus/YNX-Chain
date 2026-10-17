import test from 'node:test';
import assert from 'node:assert/strict';
import {DesktopKeyLifecycle} from '../src/key-lifecycle.mjs';
import {createDualPQKeyPreparation} from '../src/wallet-pq-key-preparation.mjs';
const account='0x'+'1'.repeat(40),network='2'.repeat(64);
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function fixture(){
 let binding={account,network},prepareCalls=0,saveCalls=0,readCalls=0,mode;
 const material=Object.freeze({TEST_ONLY_SECRET:'not-real-key-material'}),receipt=Object.freeze({TEST_ONLY_RECEIPT:true}),states=[];
 const lifecycle=new DesktopKeyLifecycle({authorizer:{available:()=>true,authenticate:async()=>{},inProcess:true},focused:()=>true,schedule:()=>null,unschedule:()=>{}});
 lifecycle.setAccount(account);await lifecycle.unlock();
 const source={prepare:async kind=>{prepareCalls++;mode=kind;return material;},persist:async value=>{saveCalls++;assert.equal(value,material);return receipt;},reconcile:async value=>{readCalls++;assert.equal(value,material);return receipt;},verifyPersisted:async(value,r)=>value===material&&r===receipt};
 const controller=createDualPQKeyPreparation({lifecycle,getBinding:()=>binding,source,id:()=> 'TEST-ONLY-operation',onState:s=>states.push(s)});
 return {controller,lifecycle,source,material,receipt,states,setBinding:b=>binding=b,counts:()=>({prepareCalls,saveCalls,readCalls,mode})};
}
for(const kind of ['generate','restore'])test(`PQ ${kind} retains original and verified persistence without exposing material`,async()=>{
 const f=await fixture(),s=await f.controller[kind]();
 assert.equal(s.phase,'saved');assert.equal(s.persisted,true);assert.equal(s.busy,false);assert.equal(s.recoveryRequired,false);
 assert.equal(f.controller.selectRetainedOutcome(x=>x.record.material),f.material);
 assert.equal(JSON.stringify(f.states).includes('TEST_ONLY_SECRET'),false);
 assert.deepEqual(f.counts(),{prepareCalls:1,saveCalls:1,readCalls:0,mode:kind});
 await assert.rejects(f.controller.generate(),{code:'PQ_KEY_ORIGINAL_REQUIRES_RECOVERY'});f.lifecycle.lock();
});
for(const boundary of ['lock','cancel','account','network'])test(`PQ returned original survives ${boundary} before persistence`,async()=>{
 const f=await fixture(),gate=deferred();f.source.prepare=async()=>{gate.resolve();await pending.promise;return f.material;};const pending=deferred();
 const work=f.controller.generate();await gate.promise;
 if(boundary==='lock')f.lifecycle.lock();else if(boundary==='cancel')f.controller.cancel();else f.setBinding({...{account,network},[boundary]:boundary==='network'?'3'.repeat(64):'0x'+'3'.repeat(40)});
 pending.resolve();await assert.rejects(work,{code:'PQ_KEY_PREPARATION_INCOMPLETE'});
 assert.equal(f.controller.status().phase,'retained');assert.equal(f.controller.selectRetainedOutcome(x=>x.record.material),f.material);assert.equal(f.counts().saveCalls,0);
 if(boundary==='lock')await f.lifecycle.unlock();f.setBinding({account,network});await f.controller.saveRetained();assert.equal(f.counts().saveCalls,1);f.lifecycle.lock();
});
test('PQ a lost save acknowledgement is not retried; only the original is read back',async()=>{
 const f=await fixture();let saves=0;f.source.persist=async()=>{saves++;throw null;};
 await assert.rejects(f.controller.generate());assert.equal(f.controller.status().phase,'save-unknown');
 assert.equal(f.controller.selectRetainedOutcome(x=>x.firstCausePresent),true);assert.equal(f.controller.selectRetainedOutcome(x=>x.firstCause),null);
 f.controller.cancel();assert.equal(f.controller.status().phase,'save-unknown');
 await assert.rejects(f.controller.saveRetained());await assert.rejects(f.controller.generate());assert.equal(saves,1);
 await f.controller.reconcile();assert.equal(f.controller.status().phase,'saved');assert.equal(f.counts().readCalls,1);assert.equal(saves,1);f.lifecycle.lock();
});
test('PQ late save result remains retained, and cannot show success after lock',async()=>{
 const f=await fixture(),entered=deferred(),finish=deferred();f.source.persist=async()=>{entered.resolve();return finish.promise;};
 const work=f.controller.generate();await entered.promise;f.lifecycle.lock();finish.resolve(f.receipt);await assert.rejects(work);
 assert.equal(f.controller.status().phase,'save-unknown');assert.equal(f.controller.selectRetainedOutcome(x=>x.record.receipt),f.receipt);
 await f.lifecycle.unlock();await f.controller.reconcile();assert.equal(f.controller.status().persisted,true);f.lifecycle.lock();
});
test('PQ failure with no returned handle remains preparation-unknown, never automatic KeyGen',async()=>{
 const f=await fixture();let attempts=0;f.source.prepare=async()=>{attempts++;throw false;};
 await assert.rejects(f.controller.generate());assert.equal(f.controller.status().phase,'prepare-unknown');assert.equal(f.controller.status().hasOriginal,false);
 assert.equal(f.controller.selectRetainedOutcome(x=>x.firstCause),false);f.controller.cancel();assert.equal(f.controller.status().phase,'prepare-unknown');
 await assert.rejects(f.controller.generate());await assert.rejects(f.controller.saveRetained());await assert.rejects(f.controller.reconcile());assert.equal(attempts,1);f.lifecycle.lock();
});
test('PQ known verified persistence never rolls back when a notification locks Wallet',async()=>{
 const f=await fixture(),controller=createDualPQKeyPreparation({lifecycle:f.lifecycle,getBinding:()=>({account,network}),source:f.source,id:()=> 'TEST-operation',onState:s=>{if(s.phase==='saved')f.lifecycle.lock();}});
 await assert.rejects(controller.generate());assert.equal(controller.status().phase,'saved');assert.equal(controller.status().persisted,true);assert.equal(controller.status().recoveryRequired,false);
 controller.cancel();assert.equal(controller.status().phase,'saved');
});
test('PQ wrong selected lifecycle account never enters key preparation',async()=>{
 const f=await fixture();f.setBinding({account:'0x'+'3'.repeat(40),network});await assert.rejects(f.controller.generate());assert.equal(f.counts().prepareCalls,0);assert.equal(f.controller.status().hasOriginal,false);f.lifecycle.lock();
});
test('PQ reconciliation refuses wrong binding and unverified readback without a write',async()=>{
 const f=await fixture();f.source.persist=async()=>{throw Error('TEST_ONLY lost ack');};await assert.rejects(f.controller.generate());
 f.setBinding({account,network:'3'.repeat(64)});await assert.rejects(f.controller.reconcile(),{code:'PQ_KEY_BINDING_CHANGED'});assert.equal(f.counts().readCalls,0);
 f.setBinding({account,network});f.source.reconcile=async()=>null;await assert.rejects(f.controller.reconcile());assert.equal(f.controller.status().phase,'save-unknown');f.lifecycle.lock();
});
