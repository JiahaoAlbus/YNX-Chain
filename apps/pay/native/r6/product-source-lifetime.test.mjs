import test from 'node:test';
import assert from 'node:assert/strict';
import {openNativePayProductSource} from './product-source.mjs';
import {createPrivateNativeProductPayClient} from './merchant-invoice-approval.mjs';

// PUBLIC resource custody controls, not a Native/Root recognizer or grant.
const ref={productId:'shop.order',sourceOrder:'order:001',merchant:'0x'+'a'.repeat(40),invoiceId:'invoice:001',nativeHash:'0x'+'b'.repeat(64)};
const fence=signal=>Object.defineProperty(()=>{},'signal',{value:signal});
async function open(ports={}){
 const loan={current(){},pay:{},retire(){},async join(){},async close(){},...ports};
 return openNativePayProductSource({acquireOriginalProductSource:()=>loan,isOriginalProductSource:value=>value===loan});
}
async function release(source){source.retire();await source.join();await source.close();source.assertSafeToClose();}

test('caller cancellation reaches the fixed private request; held call drains before original join',async()=>{
 let entered,signal,joins=0,closes=0;
 const started=new Promise(resolve=>entered=resolve);
 const pay=createPrivateNativeProductPayClient({origin:'https://public-control.invalid',requestPrivate:request=>{
  signal=request.assertCurrent.signal;assert.equal(request.path,'/v5/pay/products/shop.order/order%3A001/invoices/'+ref.merchant+'/invoice%3A001/originals/'+ref.nativeHash+'/receipt');
  return new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(Object.assign(Error(),{code:'PUBLIC_ORIGINAL_CANCELLED'})),{once:true});entered();});
 }});
 const source=await open({pay,join(){joins++;},close(){closes++;}}),abort=new AbortController();
 const pending=source.readOriginalArchiveReceipt(ref,fence(abort.signal));
 await started;assert.equal(source.status().active,1);abort.abort();assert.equal(signal.aborted,true);
 source.retire();const joining=source.join();assert.equal(joins,0);
 await assert.rejects(pending,{code:'PUBLIC_ORIGINAL_CANCELLED'});await joining;
 assert.equal(joins,1);assert.equal(source.status().active,0);await source.close();source.assertSafeToClose();assert.equal(closes,1);
});

test('pre-abort refuses before service IO and late ignored abort cannot release DATA',async()=>{
 let reads=0,finish,started;
 const entered=new Promise(resolve=>started=resolve),abort=new AbortController();abort.abort();
 const source=await open({pay:{readOriginalArchiveReceipt(){reads++;started();return new Promise(resolve=>finish=resolve);}}});
 await assert.rejects(source.readOriginalArchiveReceipt(ref,fence(abort.signal)),{code:'NATIVE_PAY_PRODUCT_REQUEST_CANCELLED'});assert.equal(reads,0);
 const live=new AbortController(),pending=source.readOriginalArchiveReceipt(ref,fence(live.signal));
 await entered;live.abort();finish({dataOnly:true});await assert.rejects(pending,{code:'NATIVE_PAY_PRODUCT_REQUEST_CANCELLED'});
 await release(source);
});

test('reentrant original join and close observe the same reserved one-shot custody',async()=>{
 let source,joining,closing,joins=0,closes=0;
 source=await open({join(){joins++;joining=source.join();},close(){closes++;closing=source.close();}});
 source.retire();const j=source.join();assert.equal(j,joining);await j;assert.equal(source.join(),j);
 const c=source.close();assert.equal(c,closing);await c;assert.equal(source.close(),c);
 assert.equal(joins,1);assert.equal(closes,1);source.assertSafeToClose();
});

test('failed original join retains falsy first cause without retry or close',async()=>{
 let joins=0,closes=0;
 const source=await open({join(){joins++;throw false;},close(){closes++;}});source.retire();
 const j=source.join();await assert.rejects(j,cause=>cause===false);assert.equal(source.join(),j);
 await assert.rejects(source.join(),cause=>cause===false);assert.equal(joins,1);assert.equal(closes,0);
 assert.throws(()=>source.close(),{code:'NATIVE_PAY_PRODUCT_CHILDREN_RETAINED'});
 assert.throws(()=>source.assertSafeToClose(),{code:'NATIVE_PAY_PRODUCT_CLOSE_UNCONFIRMED'});
});

test('UNKNOWN close retains original primitive cause, resource and promise without retry',async()=>{
 let closes=0;const source=await open({close(){closes++;throw undefined;}});source.retire();await source.join();
 const c=source.close();await assert.rejects(c,cause=>cause===undefined);assert.equal(source.close(),c);
 await assert.rejects(source.close(),cause=>cause===undefined);assert.equal(closes,1);assert.equal(source.status().closed,false);
 assert.throws(()=>source.assertSafeToClose(),{code:'NATIVE_PAY_PRODUCT_CLOSE_UNCONFIRMED'});
});

test('nonnull original partial is adopted before failure and drains exact original ports',async()=>{
 let closes=0;const original=Object.assign(Error('PUBLIC_CAPTURE_FAILED'),{partial:{current(){},retire(){},join(){},close(){closes++;}}});
 let caught;try{await openNativePayProductSource({acquireOriginalProductSource(){throw original;},isOriginalProductSource:value=>value===original.partial});}catch(cause){caught=cause;}
 assert.equal(caught.cause,original);assert.equal(caught.partial.status().operationFailed,true);
 await release(caught.partial);assert.equal(closes,1);assert.equal(caught.partial.status().SourceAdmission,false);
});

test('throwing caller listener cleanup drains original read and preserves the first cause',async()=>{
 for(const readFails of [false,true]){
  let joins=0,closes=0,lateAbort;
  const initial=Object.assign(Error('PUBLIC_ORIGINAL_READ_FAILED'),{code:'PUBLIC_ORIGINAL_READ_FAILED'});
  const source=await open({readOriginalArchiveReceipt(){if(readFails)throw initial;return {dataOnly:true};},join(){joins++;},close(){closes++;}});
  const signal=new AbortController().signal;
  Object.defineProperties(signal,{addEventListener:{value(_name,listener){lateAbort=listener;}},removeEventListener:{value(){throw false;}}});
  await assert.rejects(source.readOriginalArchiveReceipt(ref,fence(signal)),cause=>cause===(readFails?initial:false));
  assert.equal(source.status().active,0);assert.equal(source.status().cleanupFailed,true);
  assert.throws(()=>source.current(),cause=>cause===(readFails?initial:false));
  source.retire();await source.join();
  const closed=source.close();await assert.rejects(closed,cause=>cause===false);assert.equal(source.close(),closed);
  assert.equal(joins,1);assert.equal(closes,1);assert.equal(source.status().closed,true);
  lateAbort();assert.equal(closes,1);assert.equal(source.status().active,0);
  assert.throws(()=>source.assertSafeToClose(),{code:'NATIVE_PAY_PRODUCT_CLOSE_UNCONFIRMED'});
 }
});

test('listener registration failure adopts its possible installation before read and cleanup',async()=>{
 let reads=0,removed=0,closes=0,lateAbort;
 const source=await open({readOriginalArchiveReceipt(){reads++;},close(){closes++;}});
 const signal=new AbortController().signal;
 Object.defineProperties(signal,{addEventListener:{value(_name,listener){lateAbort=listener;throw null;}},removeEventListener:{value(){removed++;throw false;}}});
 await assert.rejects(source.readOriginalArchiveReceipt(ref,fence(signal)),cause=>cause===null);
 assert.equal(reads,0);assert.equal(removed,1);assert.equal(source.status().active,0);assert.equal(source.status().cleanupFailed,true);
 assert.throws(()=>source.current(),cause=>cause===null);
 source.retire();await source.join();await assert.rejects(source.close(),cause=>cause===false);
 assert.equal(closes,1);lateAbort();assert.equal(source.status().active,0);
});
