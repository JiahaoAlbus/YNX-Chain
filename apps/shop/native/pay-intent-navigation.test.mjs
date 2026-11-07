import test from 'node:test';
import assert from 'node:assert/strict';
import {createOriginalShopPayNavigation} from './pay-intent-navigation.mjs';
const operation='npi_'+'ab'.repeat(24);
test('PUBLIC Main port contract: only original typed intent/read recovery, never approval or send',async()=>{
 const calls=[];let available=true;
 const entry={status(){return {available,normalMainEntry:true,paymentAuthorized:false}},async invoke(request){calls.push(request);return {reference:{intentId:operation},intent:{intentId:operation,originalOperation:operation,state:'PREPARED'},clientIndependentFinality:false}}};
 const nav=createOriginalShopPayNavigation({entry,current(){}});
 assert.equal((await nav.openOriginalIntent(operation)).originalOperation,operation);
 assert.equal((await nav.recoverOriginalIntent(operation)).queryOnly,true);
 assert.deepEqual(calls,[{action:'intent',intentId:operation},{action:'intent',intentId:operation}]);
 available=false;await assert.rejects(nav.openOriginalIntent(operation),{code:'SHOP_NATIVE_PAY_MAIN_UNAVAILABLE'});assert.equal(calls.length,2);
 await assert.rejects(nav.openOriginalIntent({url:'fake',capsule:{approve:true}}),{code:'SHOP_NATIVE_PAY_ORIGINAL_REQUIRED'});
});
test('missing actual Main Source retains its first cause without invoking Main',async()=>{
 let invoked=0;
 const nav=createOriginalShopPayNavigation({entry:{status(){return {available:false,normalMainEntry:true,paymentAuthorized:false,reason:'NATIVE_PAY_MAIN_SOURCE_UNAVAILABLE'}},invoke(){invoked++;}},current(){}});
 for(const action of ['openOriginalIntent','recoverOriginalIntent']){
  await assert.rejects(nav[action](operation),error=>error.code==='SHOP_NATIVE_PAY_MAIN_UNAVAILABLE'&&error.cause?.code==='NATIVE_PAY_MAIN_SOURCE_UNAVAILABLE');
 }
 assert.equal(invoked,0);
});
test('context revoked during status lookup cannot dispatch the original read',async()=>{
 let revoked=false,invoked=0;
 const nav=createOriginalShopPayNavigation({entry:{async status(){revoked=true;return {available:true,normalMainEntry:true,paymentAuthorized:false}},invoke(){invoked++;}},current(){if(revoked)throw Error('PUBLIC original context revoked')}});
 await assert.rejects(nav.recoverOriginalIntent(operation),/PUBLIC original context revoked/);
 assert.equal(invoked,0);
});
test('late account/Source change or rebound original cannot become navigation success',async()=>{
 let locked=false;
 const entry={status(){return {available:true,normalMainEntry:true,paymentAuthorized:false}},async invoke(){locked=true;return {reference:{intentId:operation},intent:{intentId:operation,originalOperation:operation,state:'ISSUED'},clientIndependentFinality:false}}};
 const nav=createOriginalShopPayNavigation({entry,current(){if(locked)throw Error('PUBLIC original context changed')}});
 await assert.rejects(nav.openOriginalIntent(operation),/PUBLIC original context changed/);
 const wrong=createOriginalShopPayNavigation({entry:{...entry,async invoke(){return {reference:{intentId:'foreign'}}}},current(){}});
 await assert.rejects(wrong.openOriginalIntent(operation),{code:'SHOP_NATIVE_PAY_ORIGINAL_CHANGED'});
});
const sourceOrder='order_original',merchant='0x'+'1'.repeat(40),invoiceId='invoice_original';
function originalEntry(overrides={}){
 const calls=[];
 const entry={status(){return {available:true,normalMainEntry:true,paymentAuthorized:false}},async invoke(request){calls.push({...request});return {reference:{productId:'shop.order',sourceOrder,merchant,invoiceId,intentId:operation,...(request.refundId?{refundId:request.refundId}:{})},intent:{intentId:operation,originalOperation:operation,state:'ISSUED'},queryOnly:request.action==='order-invoice',approvalRequired:request.action!=='order-invoice',clientIndependentFinality:false,canRetry:false,...(request.action==='order-invoice'?{bill:{sourceOrder,merchant,invoiceId}}:{walletRequest:{id:'original-review',method:'ynx_signPQNativeAction',approvalRequired:true}})}},...overrides};
 return {calls,entry,nav:createOriginalShopPayNavigation({entry,current(){}})};
}
test('original order navigation and cold UNKNOWN recovery select read-only order-invoice with no invoice/merchant/amount override',async()=>{
 const f=originalEntry();const first=await f.nav.openOriginalOrder(sourceOrder),cold=await f.nav.recoverOriginalOrder(sourceOrder);
 assert.equal(first.originalOperation,operation);assert.equal(cold.queryOnly,true);assert.equal(cold.paymentAuthorized,false);
 assert.deepEqual(f.calls,[{action:'order-invoice',productId:'shop.order',sourceOrder},{action:'order-invoice',productId:'shop.order',sourceOrder}]);
 for(const input of [{sourceOrder,merchant},'../other','order?amount=1','',null])await assert.rejects(f.nav.openOriginalOrder(input),{code:'SHOP_NATIVE_PAY_ORDER_REQUIRED'});
 assert.equal(f.calls.length,2);
});
test('explicit terms/payment/refund each opens only its original Main review once and never reports payment authorization',async()=>{
 const f=originalEntry();
 for(const result of [await f.nav.reviewOriginalOrderTerms(sourceOrder),await f.nav.reviewOriginalOrderPayment(sourceOrder),await f.nav.reviewOriginalOrderRefund(sourceOrder,'refund_retained','18446744073709551615')]){assert.equal(result.reviewPending,true);assert.equal(result.paymentAuthorized,false);assert.equal(result.clientIndependentFinality,false);assert.equal(result.reviewID,'original-review');}
 assert.deepEqual(f.calls,[{action:'order-terms-review',productId:'shop.order',sourceOrder},{action:'order-pay-review',productId:'shop.order',sourceOrder},{action:'order-refund-review',productId:'shop.order',sourceOrder,refundId:'refund_retained',amountAtoms:'18446744073709551615'}]);
 for(const amount of ['0','01','1.5',1,'18446744073709551616'])await assert.rejects(f.nav.reviewOriginalOrderRefund(sourceOrder,'refund_retained',amount),{code:'SHOP_NATIVE_PAY_REFUND_ORIGINAL_REQUIRED'});
 assert.equal(f.calls.length,3);
});
test('order response rebinding and fake completed/approved review are refused without retry',async()=>{
 for(const change of [r=>{r.reference.sourceOrder='foreign';},r=>{r.reference.productId='other';},r=>{r.reference.intentId='foreign';},r=>{r.bill.invoiceId='foreign';},r=>{r.clientIndependentFinality=true;},r=>{r.queryOnly=false;}]){
  const f=originalEntry();const invoke=f.entry.invoke;f.entry.invoke=async request=>{const r=await invoke(request);change(r);return r;};
  await assert.rejects(f.nav.recoverOriginalOrder(sourceOrder),{code:'SHOP_NATIVE_PAY_ORIGINAL_CHANGED'});assert.equal(f.calls.length,1);
 }
 const f=originalEntry();const invoke=f.entry.invoke;f.entry.invoke=async request=>{const r=await invoke(request);r.walletRequest.method='ynx_broadcast';return r;};
 await assert.rejects(f.nav.reviewOriginalOrderPayment(sourceOrder),{code:'SHOP_NATIVE_PAY_REVIEW_CHANGED'});assert.equal(f.calls.length,1);
});
test('prepared unknown original remains read-only, and context or Main denial retains its original cause',async()=>{
 const f=originalEntry();const invoke=f.entry.invoke;f.entry.invoke=async request=>{const r=await invoke(request);r.intent.state='PREPARED';r.recoveryOnly=true;delete r.bill;return r;};
 assert.equal((await f.nav.recoverOriginalOrder(sourceOrder)).recoveryOnly,true);assert.equal(f.calls[0].action,'order-invoice');
 const cause=Object.assign(Error('original pending'),{code:'NATIVE_PAY_ORIGINAL_RECONCILE_REQUIRED'});
 f.entry.invoke=async()=>{throw cause;};await assert.rejects(f.nav.reviewOriginalOrderPayment(sourceOrder),error=>error===cause);
});
test('one in-flight original action prevents duplicate dispatch and context withdrawal cannot adopt a late read',async()=>{
 let release,locked=false;const f=originalEntry();f.entry.invoke=()=>new Promise(resolve=>release=resolve);
 const nav=createOriginalShopPayNavigation({entry:f.entry,current(){if(locked)throw Error('original current retired');}});
 const pending=nav.openOriginalOrder(sourceOrder);await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(nav.recoverOriginalOrder(sourceOrder),{code:'SHOP_NATIVE_PAY_MAIN_BUSY'});
 locked=true;release({});await assert.rejects(pending,/original current retired/);
});

test('normal Main invokeResult refusal preserves its precise code without recovery or review fallback',async()=>{
 const f=originalEntry({async invoke(){return {ok:false,code:'NATIVE_PAY_ORIGINAL_RECONCILE_REQUIRED'};}});
 await assert.rejects(f.nav.recoverOriginalOrder(sourceOrder),{code:'NATIVE_PAY_ORIGINAL_RECONCILE_REQUIRED'});
 await assert.rejects(f.nav.reviewOriginalOrderTerms(sourceOrder),{code:'NATIVE_PAY_ORIGINAL_RECONCILE_REQUIRED'});
});
