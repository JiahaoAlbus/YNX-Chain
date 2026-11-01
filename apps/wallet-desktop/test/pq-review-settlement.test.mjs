import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';
import {createOriginalPayReviewTracker} from '../src/native-pay-client/main-entry.mjs';
const source=await fs.readFile(new URL('../src/desktop-wallet-authority.mjs',import.meta.url),'utf8');
const methods=source.slice(source.indexOf('  #setPQReview('),source.indexOf('\n  #trackPQ('));const approval=source.slice(source.indexOf('  approve(id,capsule)'),source.indexOf('\n  shutdownPQReviews('));
// Actual Authority settlement/close/approve methods run with PUBLIC policy
// and signing boundary doubles. No account, Native Source or signature made.
const Harness=vm.compileFunction(`return class {
 #pqReviews=new WeakMap();#pqReviewByOwner=new WeakMap();#pqReviewNotified=new WeakSet();#activeReviews=new Map();#pqTxOwners=new Set();#pqOwners=new Set();#pqInitialReviews=new WeakMap();#onPQReviewSettled;
 pending=new Map();vault={pqCleanupUnresolved:()=>false};
 constructor(notify,approve){this.#onPQReviewSettled=notify;this.work=approve;}
 #trackPQ(action){return action();}#take(id){const p=this.pending.get(id);this.pending.delete(id);return p;}#approvePending(p,c){return this.work(p,c);}
 remember(id,owner){const p={id};this.pending.set(id,p);this.#setPQReview(p,{owner});this.#pqOwners.add(owner);}
 pendingRequests(){return [...this.pending.values()];}
 reject(id){const p=this.#take(id);return this.#closePQ(this.#pqReviews.get(p).owner);}
 ${methods}\n${approval}
}`)();
function policy({gate=Promise.resolve(),failure=false}={}){let closed=false,debt=false;return {status:()=>({closed,cleanupDebt:debt}),retire(){},async close(){await gate;if(failure){debt=true;throw false;}closed=true;}};}
test('actual approval cleanup and active-review removal precede same-Main P06 settlement notification',async()=>{
 const tracker=createOriginalPayReviewTracker(),events=[],owner=policy();let main;
 main=new Harness((id,same)=>{assert.equal(same,main);assert.equal(owner.status().closed,true);events.push(tracker.settled(id,same).settled);},async()=>({status:'success'}));main.remember('PUBLIC',owner);tracker.remember('PUBLIC',main);await main.approve('PUBLIC',{});assert.deepEqual(events,[true]);assert.equal(tracker.cancel().cancelled,true);
});
test('actual rejection waits original close promise; removal alone never triggers notification',async()=>{
 let release;const gate=new Promise(r=>release=r),owner=policy({gate}),events=[];const main=new Harness((id,same)=>events.push({id,same}),async()=>{});main.remember('PUBLIC',owner);const pending=main.reject('PUBLIC');assert.equal(main.pendingRequests().length,0);assert.equal(events.length,0);release();await pending;assert.equal(events.length,1);assert.equal(events[0].same,main);
});
test('failed actual cleanup retains falsy cause and never notifies settlement',async()=>{
 const owner=policy({failure:true});let notifications=0;const main=new Harness(()=>{notifications++;},async()=>{throw false;});main.remember('PUBLIC',owner);await assert.rejects(main.approve('PUBLIC',{}),e=>e===false);assert.equal(notifications,0);assert.equal(owner.status().cleanupDebt,true);
});
test('UNKNOWN operation with completed cleanup can retire bookkeeping without changing original failure',async()=>{
 const owner=policy();let notifications=0;const main=new Harness(()=>{notifications++;},async()=>{throw false;});main.remember('PUBLIC',owner);await assert.rejects(main.approve('PUBLIC',{}),e=>e===false);assert.equal(notifications,1);
});
test('settlement notification is Main-only and does not have IPC/preload exposure',async()=>{
 const main=await fs.readFile(new URL('../src/main.mjs',import.meta.url),'utf8'),preload=await fs.readFile(new URL('../src/preload.cjs',import.meta.url),'utf8');assert.ok(main.includes('onPQReviewSettled:(id,owner)=>'));assert.equal(preload.includes('settleOriginalReview'),false);assert.equal(/handleWalletIPC\([^\n]*settleOriginalReview/.test(main),false);
});
