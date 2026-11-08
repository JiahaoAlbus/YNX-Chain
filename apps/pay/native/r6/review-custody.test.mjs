import test from 'node:test';
import assert from 'node:assert/strict';
import {createOriginalPayReviewTracker,createNativePayMainEntry} from './main-entry.mjs';
import {retainOriginalPayReview} from './merchant-invoice-approval.mjs';

function fixture(reject){
 const id='PUBLIC-original-review',queue=new Map([[id,{id}]]),tracker=createOriginalPayReviewTracker();let calls=0;
 const main={pendingRequests:()=>[...queue.values()],reject(value){calls++;assert.equal(value,id);return reject(queue,id);}};
 const custody={remember:value=>tracker.remember(value,main),settled:value=>tracker.settled(value,main),cleanupFailed:(value,cause)=>tracker.cleanupFailed(value,main,cause)};
 return {id,queue,tracker,main,custody,pending:{request:{id}},calls:()=>calls};
}
const thrown=(fn,expected)=>{let present=false;try{fn();}catch(cause){present=true;assert.equal(cause,expected);}assert(present);};

test('an original review is retained before the late current and byte checks, and only same-Main completion releases it',()=>{
 const f=fixture(()=>assert.fail('successful review must not be rejected'));
 const check=()=>assert.throws(()=>f.tracker.assertSafeToClose(),{code:'NATIVE_PAY_MAIN_REVIEWS_RETAINED'});
 assert.equal(retainOriginalPayReview(f.main,f.pending,check,check,f.custody),f.pending);
 assert.equal(f.calls(),0);
 assert.throws(()=>f.tracker.settled(f.id,{}),{code:'NATIVE_PAY_MAIN_REVIEW_OWNER_CHANGED'});
 f.queue.clear();f.tracker.settled(f.id,f.main);f.tracker.assertSafeToClose();
});

test('late current and cleanup failures preserve distinct falsy causes without rejecting the same UNKNOWN request again',()=>{
 for(const [primary,cleanup] of [[0,false],[false,0],[null,undefined],[undefined,null]]){
  const f=fixture(()=>{throw cleanup;});
  thrown(()=>retainOriginalPayReview(f.main,f.pending,()=>{throw primary;},()=>assert.fail(),f.custody),primary);
  for(let i=0;i<2;i++){
   thrown(()=>f.tracker.cancel(),cleanup);thrown(()=>f.tracker.assertReviewAvailable(),cleanup);
   assert.throws(()=>f.tracker.assertSafeToClose(),{code:'NATIVE_PAY_MAIN_REVIEWS_RETAINED'});
  }
  assert.equal(f.calls(),1);assert.equal(f.queue.size,1);
  assert.throws(()=>f.tracker.settled(f.id,f.main),{code:'NATIVE_PAY_MAIN_REVIEW_STILL_PENDING'});
  f.queue.clear();f.tracker.settled(f.id,f.main);f.tracker.assertSafeToClose();
 }
});

test('actual Main rejection convention removes the original review while preserving the late failure',()=>{
 const f=fixture((queue,id)=>{queue.delete(id);throw Object.assign(Error(),{code:4001,data:{code:'USER_REJECTED_REQUEST'}});});
 thrown(()=>retainOriginalPayReview(f.main,f.pending,()=>{throw 0;},()=>assert.fail(),f.custody),0);
 f.tracker.assertSafeToClose();assert.equal(f.tracker.cancel().cancelled,true);assert.equal(f.calls(),1);
});

test('a no-op rejection cannot be reported as cancelled or retried after the pending request remains live',()=>{
 const f=fixture(()=>{});
 f.tracker.remember(f.id,f.main);
 assert.throws(()=>f.tracker.cancel(),{code:'NATIVE_PAY_MAIN_REVIEW_STILL_PENDING'});
 assert.throws(()=>f.tracker.cancel(),{code:'NATIVE_PAY_MAIN_REVIEW_STILL_PENDING'});
 assert.equal(f.calls(),1);assert.equal(f.queue.size,1);
 assert.throws(()=>f.tracker.assertSafeToClose(),{code:'NATIVE_PAY_MAIN_REVIEWS_RETAINED'});
});

test('a late validation failure with no-op rejection keeps the original frozen error and independent cleanup debt',()=>{
 const primary=Object.freeze(Object.assign(Error(),{code:'PUBLIC_REVIEW_CHANGED'})),f=fixture(()=>{});
 thrown(()=>retainOriginalPayReview(f.main,f.pending,()=>{},()=>{throw primary;},f.custody),primary);
 assert.throws(()=>f.tracker.cancel(),{code:'NATIVE_PAY_MAIN_REVIEW_STILL_PENDING'});
 assert.equal(f.calls(),1);assert.equal(f.queue.size,1);
});

test('normal Main close assertion waits for its actual active read without closing borrowed Source',async()=>{
 const account='0x'+'a'.repeat(40);let resolve,closed=0;
 const entry=createNativePayMainEntry({getMain:()=>null,getContext:()=>({account,revision:1,focused:true})});
 entry.compose({current(){},close(){closed++;},pay:{readInvoice:()=>new Promise(r=>resolve=r)}});
 const flight=entry.invoke({action:'invoice',merchant:account,invoiceId:'PUBLIC-original'});
 assert.throws(()=>entry.assertSafeToClose(),{code:'NATIVE_PAY_MAIN_OPERATION_PENDING'});
 resolve({});await flight;entry.assertSafeToClose();assert.equal(closed,0);
});
