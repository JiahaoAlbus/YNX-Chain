import assert from 'node:assert/strict';
import test from 'node:test';
import {DesktopKeyLifecycle} from '../src/key-lifecycle.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function fixture(options={}) { const life=new DesktopKeyLifecycle({authorizer:{available:()=>true,authenticate:async()=>{},method:'fixture'},...options}); life.setAccount('original');life.setFocused(true);await life.unlock();return life; }
const cancelled=e=>e?.data?.code==='WALLET_OPERATION_CANCELLED';
test('owned native dialog waits for late parent focus without performing key or write work',async()=>{
 const life=await fixture();let writes=0;
 await life.run(async lease=>{ const result=await life.withOwnedDialog(async()=>{life.setFocused(false);setTimeout(()=>life.setFocused(true),30);return 'selected';});assert.equal(result,'selected');await lease.step(async()=>{assert.equal(life.status().focused,true);writes++}); });
 assert.equal(writes,1);assert.equal(life.status().locked,false);assert.equal(life.status().ownedDialogPhase,null);
});
for(const change of ['manual-lock','screen-lock','account-change','cancel','deadline','review-change'])test(change+' while returning from owned dialog prevents any write',async()=>{
 let now=0,review=true;const life=await fixture({now:()=>now,ttlMs:100});let writes=0;
 await assert.rejects(life.run(async lease=>{await life.withOwnedDialog(async()=>{life.setFocused(false);setTimeout(()=>{if(change.endsWith('lock'))life.lock();if(change==='account-change')life.setAccount('different');if(change==='cancel')life.cancelOperations();if(change==='deadline')now=100;if(change==='review-change')review=false;life.setFocused(true)},10);return 'selected'});await lease.step(async()=>{writes++});},{assertCurrent:()=>{if(!review)throw Object.assign(Error('stale'),{data:{code:'WALLET_OPERATION_CANCELLED'}})}}),cancelled);assert.equal(writes,0);assert.equal(life.status().ownedDialogPhase,null);
});
test('missing native focus is bounded and remains locked; later focus cannot revive operation',async()=>{
 const life=await fixture();let writes=0;const start=Date.now();await assert.rejects(life.run(async lease=>{await life.withOwnedDialog(async()=>{life.setFocused(false);return 'selected'});await lease.step(async()=>{writes++})}),cancelled);assert.ok(Date.now()-start<1500);assert.equal(life.status().locked,true);life.setFocused(true);await pause(10);assert.equal(writes,0);assert.equal(life.status().locked,true);
});
test('ordinary background blur is still an immediate lock',async()=>{const life=await fixture();life.setFocused(false);assert.equal(life.status().locked,true);await assert.rejects(life.run(()=>assert.fail('must not run')));});
