import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import{createMainStandalonePayNavigationSteps}from'../src/main-standalone-pay-navigation.mjs';import{DesktopKeyLifecycle}from'../src/key-lifecycle.mjs';import{createWalletNativePayProduct}from'../src/wallet-native-pay-product.mjs';
const account='0x'+'1'.repeat(40),other='0x'+'2'.repeat(40),deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}},flush=()=>new Promise(r=>setImmediate(r));
const originalOperation='npi_'+'a'.repeat(48);
async function fixture(patch={}){let steps,clock=1000,focused=true;const calls=[];const key=new DesktopKeyLifecycle({now:()=>clock,ttlMs:5000,unlockTtlMs:10000,focused:()=>focused,authorizer:{available:()=>true,authenticate:async()=>{}},schedule:()=>({unref(){}}),unschedule(){},beforeInvalidate:()=>steps?.retireAll()});key.setAccount(account);await key.unlock();const pay={status:()=>{calls.push('status');return{normalMainEntry:true,canRequest:true,available:false,sourceSupplied:false,paymentAuthorized:false};},invoke:async input=>{calls.push(input);return{version:'ynx.pay.main-result/v1',ok:true,reference:{productId:input.productId,sourceOrder:input.sourceOrder},queryOnly:true};},...patch};steps=createMainStandalonePayNavigationSteps({nativePayProduct:pay,keyAccess:key});return{key,pay,steps,calls,setClock:v=>clock=v,blur(){focused=false;key.setFocused(false);}};}
test('Main-private status/invoke uses SAME actual ALS key lease, current account and fixed original order selector without native authority',async()=>{const f=await fixture();await f.key.run(async()=>{const step=f.steps.openOrder('PUBLIC-order');assert.equal((await step.status()).ok,true);const reply=await step.invoke();assert.equal(reply.ok,true);assert.deepEqual(f.calls,['status',{action:'order-invoice',productId:'shop.order',sourceOrder:'PUBLIC-order'}]);await step.close();step.assertSafeToClose();});await f.steps.close();assert.doesNotThrow(()=>f.steps.assertSafeToClose());});
test('outside normal Main current context or locked state cannot open a step',async()=>{const f=await fixture();assert.throws(()=>f.steps.openOrder('PUBLIC-order'));f.key.lock();await assert.rejects(f.key.run(()=>f.steps.openOrder('PUBLIC-order')));assert.equal(f.calls.length,0);});
test('one active order, status once and invoke once prevent duplicate navigation or substituted action',async()=>{const f=await fixture();await f.key.run(async()=>{const step=f.steps.openOrder('PUBLIC-order');assert.throws(()=>f.steps.openOrder('OTHER-order'),{code:'STANDALONE_PAY_NAVIGATION_BUSY'});assert.equal((await step.invoke()).error.code,'STANDALONE_PAY_NOT_READY');await step.status();assert.equal((await step.status()).error.code,'STANDALONE_PAY_STATUS_ONCE');assert.equal((await step.invoke({action:'pay-review'})).error.code,'STANDALONE_PAY_ARGUMENTS_INVALID');await step.invoke();assert.equal((await step.invoke()).error.code,'STANDALONE_PAY_INVOKE_ONCE');assert.equal(f.calls.length,2);await step.close();});});
test('canRequest false remains actual status and cannot invoke; available false alone is expected per-request state',async()=>{const f=await fixture({status:()=>({normalMainEntry:true,canRequest:false,available:false,paymentAuthorized:false,reason:'ORIGINAL_NOT_READY'})});await f.key.run(async()=>{const step=f.steps.openOrder('PUBLIC-order');const status=await step.status();assert.equal(status.value.reason,'ORIGINAL_NOT_READY');assert.equal((await step.invoke()).error.code,'STANDALONE_PAY_NOT_READY');await step.close();});assert.equal(f.calls.length,0);});
test('actual Main generation/deadline/locked account changes retire late result rather than publishing success',async()=>{for(const mutation of ['lock','revision','account','deadline','focus']){const gate=deferred(),f=await fixture({invoke:()=>gate.promise});await assert.rejects(f.key.run(async()=>{const step=f.steps.openOrder('PUBLIC-order');await step.status();const work=step.invoke();await flush();if(mutation==='lock')f.key.lock();if(mutation==='revision')f.key.cancelOperations();if(mutation==='account')f.key.setAccount(other);if(mutation==='deadline')f.setClock(6000);if(mutation==='focus')f.blur();gate.resolve({ok:true,bill:{status:'MUST_NOT_PUBLISH'}});assert.equal((await work).ok,false);await step.close();assert.doesNotThrow(()=>step.assertSafeToClose());}),error=>error.data?.code==='WALLET_OPERATION_CANCELLED');}});
test('retire/join/close waits actual pending query, does not cancel or close global Pay or parent key owner',async()=>{const gate=deferred(),f=await fixture({invoke:()=>gate.promise,cancel(){assert.fail('global Pay cancel');},close(){assert.fail('parent Pay close');}});await f.key.run(async()=>{const step=f.steps.openOrder('PUBLIC-order');await step.status();const pending=step.invoke();await flush();step.retire();let joined=false;const join=step.join().then(()=>joined=true);await flush();assert.equal(joined,false);assert.throws(()=>step.assertSafeToClose());gate.resolve({ok:true});await pending;await join;assert.equal(joined,true);await step.close();assert.doesNotThrow(()=>step.assertSafeToClose());});});
test('pending step is adopted before reentrant join/retire from service entry, so cleanup cannot miss the operation',async()=>{let step,join;const gate=deferred(),f=await fixture({status:()=>{join=step.join();return gate.promise;}});await f.key.run(async()=>{step=f.steps.openOrder('PUBLIC-order');const pending=step.status();await flush();let done=false;void join.then(()=>done=true);await flush();assert.equal(done,false);gate.resolve({normalMainEntry:true,canRequest:true,paymentAuthorized:false});assert.equal((await pending).ok,false);await join;await step.close();});});
test('original thrown cause retained privately while normal outer error code is public and never retried',async()=>{const cause=Object.assign(Error('PRIVATE'),{code:'ORIGINAL_READ_REFUSAL',privateKey:'SECRET'}),f=await fixture({invoke:async()=>{throw cause;}});await f.key.run(async()=>{const step=f.steps.openOrder('PUBLIC-order');await step.status();const result=await step.invoke();assert.equal(result.ok,false);assert.equal(result.error.code,'ORIGINAL_READ_REFUSAL');assert(!JSON.stringify(result).includes('PRIVATE'));assert(!JSON.stringify(result).includes('SECRET'));assert.equal(step.readFirstCause().cause,cause);assert.equal((await step.invoke()).error.code,'STANDALONE_PAY_INVOKE_ONCE');assert.equal(step.readFirstCause().cause,cause);await step.close();});});
test('P06 flat UNKNOWN result is preserved as inner failure, never converted into outer success payment or automatic recovery',async()=>{const inner={version:'ynx.pay.main-result/v1',ok:false,outcome:'UNKNOWN',canRetry:false,recoveryActions:[],code:'P06_FAILURE'},f=await fixture({invoke:async()=>inner});await f.key.run(async()=>{const step=f.steps.openOrder('PUBLIC-order');await step.status();const result=await step.invoke();assert.equal(result.ok,true);assert.equal(result.value,inner);assert.equal(result.value.ok,false);await step.close();});});
test('normal existing Pay product wrapper is reused without another source/provider/sign/broadcast path',async()=>{const f=await fixture(),calls=[];const product=createWalletNativePayProduct({entry:{status:()=>({normalMainEntry:true,canRequest:true,paymentAuthorized:false}),invoke:async input=>{calls.push(input);return{version:'ynx.pay.main-result/v1',ok:true,queryOnly:true};}},getMain:()=>({pendingRequests:()=>[]}),getGuard:()=>f.key.current(),publishReview(){assert.fail('no signing review');}}),steps=createMainStandalonePayNavigationSteps({nativePayProduct:product,keyAccess:f.key});await f.key.run(async()=>{const step=steps.openOrder('PUBLIC-order');await step.status();await step.invoke();await step.close();});assert.equal(calls.length,1);assert.equal(calls[0].action,'order-invoice');});
test('selector/zeroarg methods cannot accept object contexts/path/url/session or supply caller identity',async()=>{const f=await fixture();await f.key.run(async()=>{for(const value of [{sourceOrder:'PUBLIC',account},'../file','https://example.invalid',''])assert.throws(()=>f.steps.openOrder(value));const step=f.steps.openOrder('PUBLIC-order');assert.equal((await step.status({session:'fake'})).error.code,'STANDALONE_PAY_ARGUMENTS_INVALID');assert.equal(f.calls.length,0);await step.close();});});
test('source Main composition retains internal steps only, no preload exposure, registration or Native transport claim',()=>{const main=fs.readFileSync(new URL('../src/main.mjs',import.meta.url),'utf8'),preload=fs.readFileSync(new URL('../src/preload.cjs',import.meta.url),'utf8');assert(main.includes('createMainStandalonePayNavigationSteps({nativePayProduct,keyAccess})'));assert(main.includes('standalonePayNavigationSteps?.retireAll()'));assert(main.includes("settle('standalone-pay',()=>standalonePayNavigationSteps?.close())"));assert(!/standalonePayNavigation|standalone-pay-navigation/.test(preload));});
const actions=[['openOrder','order-invoice'],['openOrderTermsReview','order-terms-review'],['openOrderPayReview','order-pay-review'],['openOrderRefundReview','order-refund-review']];
test('all four fixed Main-private methods reuse actual product status/invoke, preserve atoms as original string and only publish existing review',async()=>{
 for(const[method,action]of actions){const f=await fixture(),calls=[],published=[],review={id:'PUBLIC-original-review',method:'ynx_signPQNativeAction',review:{account}},reply={version:'ynx.pay.main-result/v1',ok:true,...(action==='order-invoice'?{}:{walletRequest:{id:review.id,method:review.method}})};
 const product=createWalletNativePayProduct({entry:{status:()=>({normalMainEntry:true,canRequest:true,available:false,paymentAuthorized:false}),invoke:async input=>{assert(Object.isFrozen(input));calls.push(input);return reply;}},getMain:()=>({pendingRequests:()=>[review]}),getGuard:()=>f.key.current(),publishReview:r=>published.push(r)}),steps=createMainStandalonePayNavigationSteps({nativePayProduct:product,keyAccess:f.key});
 await f.key.run(async()=>{const amount='18446744073709551615',args=method==='openOrderRefundReview'?['PUBLIC-order','PUBLIC-refund',amount]:['PUBLIC-order'],child=steps[method](...args);await child.status();assert.equal((await child.invoke()).value,reply);assert.deepEqual(calls,[{action,productId:'shop.order',sourceOrder:'PUBLIC-order',...(method==='openOrderRefundReview'?{refundId:'PUBLIC-refund',amountAtoms:amount}:{})}]);assert.equal(published.length,action==='order-invoice'?0:1);if(published.length)assert.equal(published[0],review);await child.close();});await steps.close();
 }
});
test('refund accepts only two original strings and never Number/BigInt/coerced or caller-shaped payloads',async()=>{
 const f=await fixture();await f.key.run(async()=>{for(const amount of [1,1n,null,{},'', '1.5','1e8','-1','1\n','1'.repeat(257)])assert.throws(()=>f.steps.openOrderRefundReview('PUBLIC-order','refund',amount),{code:'STANDALONE_PAY_REFUND_INVALID'});for(const args of [['PUBLIC-order'],['PUBLIC-order','refund','1','EXTRA']])assert.throws(()=>f.steps.openOrderRefundReview(...args),{code:'STANDALONE_PAY_ORDER_INVALID'});assert.throws(()=>f.steps.openOrderRefundReview('PUBLIC-order',{toString(){assert.fail('no coercion');}},'1'));assert.equal(f.calls.length,0);
 const child=f.steps.openOrderRefundReview('PUBLIC-order','refund','000123');await child.status();await child.invoke();assert.equal(f.calls[1].amountAtoms,'000123','authoritative callee decides canonical/range validity; this bridge never rewrites originals');await child.close();});
});
test('terms/payment/refund review share original once-only and single held child lifecycle without cross-action replacement',async()=>{
 const f=await fixture();await f.key.run(async()=>{const child=f.steps.openOrderTermsReview('PUBLIC-order');assert.throws(()=>f.steps.openOrderPayReview('PUBLIC-order'),{code:'STANDALONE_PAY_NAVIGATION_BUSY'});await child.status();await child.invoke();assert.equal((await child.invoke()).error.code,'STANDALONE_PAY_INVOKE_ONCE');await child.close();const refund=f.steps.openOrderRefundReview('PUBLIC-order','refund','9007199254740993');await refund.status();await refund.invoke();assert.equal(f.calls[3].amountAtoms,'9007199254740993');await refund.close();});
});
test('all review actions reject late lock/account/revision/deadline/focus result using SAME actual Main lease',async()=>{
 for(const[method]of actions.slice(1))for(const mutation of ['lock','account','revision','deadline','focus']){const gate=deferred(),f=await fixture({invoke:()=>gate.promise});await assert.rejects(f.key.run(async()=>{const child=method==='openOrderRefundReview'?f.steps[method]('PUBLIC-order','refund','1'):f.steps[method]('PUBLIC-order');await child.status();const work=child.invoke();await flush();if(mutation==='lock')f.key.lock();if(mutation==='account')f.key.setAccount(other);if(mutation==='revision')f.key.cancelOperations();if(mutation==='deadline')f.setClock(6000);if(mutation==='focus')f.blur();gate.resolve({version:'ynx.pay.main-result/v1',ok:true,walletRequest:{id:'MUST_NOT_RETURN'}});assert.equal((await work).ok,false);await child.close();}),e=>e.data?.code==='WALLET_OPERATION_CANCELLED');}
});
test('each review UNKNOWN remains the exact original flat result, cannot retry or acquire replacement action',async()=>{
 for(const[method]of actions.slice(1)){const inner={version:'ynx.pay.main-result/v1',ok:false,outcome:'UNKNOWN',canRetry:false,recoveryActions:[],code:'ORIGINAL_UNKNOWN'},f=await fixture({invoke:async()=>inner});await f.key.run(async()=>{const child=method==='openOrderRefundReview'?f.steps[method]('PUBLIC-order','refund','1'):f.steps[method]('PUBLIC-order');await child.status();assert.equal((await child.invoke()).value,inner);assert.equal((await child.invoke()).error.code,'STANDALONE_PAY_INVOKE_ONCE');await child.close();});}
});
test('all four actual P06 Main input actions are consumed but missing real Source remains a refusal, never fixture admission',async()=>{
 const {createNativePayMainEntry}=await import('../src/native-pay-client/main-entry.mjs');
 for(const[method]of actions){const f=await fixture(),entry=createNativePayMainEntry({getMain:()=>{assert.fail('no real Source');},getContext:()=>{assert.fail('no real Source');}}),product=createWalletNativePayProduct({entry:{status:()=>({normalMainEntry:true,canRequest:true,paymentAuthorized:false}),invoke:input=>entry.invoke(input)},getMain:()=>({pendingRequests:()=>[]}),getGuard:()=>f.key.current(),publishReview(){assert.fail('Source refusal cannot publish a review');}}),steps=createMainStandalonePayNavigationSteps({nativePayProduct:product,keyAccess:f.key});
 await f.key.run(async()=>{const child=method==='openOrderRefundReview'?steps[method]('PUBLIC-order','refund','18446744073709551615'):steps[method]('PUBLIC-order');await child.status();const result=await child.invoke();assert.equal(result.ok,false);assert.equal(result.error.code,'NATIVE_PAY_MAIN_SOURCE_UNAVAILABLE');await child.close();});}
});
test('private original-operation reconciliation uses exact retained hash, existing normal Main port, once-only and no fabricated Source',async()=>{
 const originalHash='0x'+'a'.repeat(64),f=await fixture();await f.key.run(async()=>{for(const h of [undefined,'',123,'0x123'])assert.throws(()=>f.steps.openOrderReconcileOperation('PUBLIC-order',h),{code:'STANDALONE_PAY_ORIGINAL_HASH_INVALID'});const child=f.steps.openOrderReconcileOperation('PUBLIC-order',originalHash);await child.status();await child.invoke();assert.deepEqual(f.calls[1],{action:'order-reconcile-operation',productId:'shop.order',sourceOrder:'PUBLIC-order',nativeHash:originalHash});assert.equal((await child.invoke()).error.code,'STANDALONE_PAY_INVOKE_ONCE');await child.close();});
 const {createNativePayMainEntry}=await import('../src/native-pay-client/main-entry.mjs'),entry=createNativePayMainEntry({getMain:()=>{},getContext:()=>{}});await assert.rejects(entry.invoke({action:'order-reconcile-operation',productId:'shop.order',sourceOrder:'PUBLIC-order',nativeHash:originalHash}),{code:'NATIVE_PAY_MAIN_SOURCE_UNAVAILABLE'});
});

test('protected navigation without the Main holder never falls back to legacy invoke',async()=>{
 const f=await fixture();
 await f.key.run(async()=>{
  assert.throws(()=>f.steps.openProtectedOrder('order-pay-review','PUBLIC-order'),{code:'STANDALONE_PAY_PROTECTED_HOLDER_REQUIRED'});
  assert.throws(()=>f.steps.openProtectedOrder('create-intent','PUBLIC-order'),{code:'STANDALONE_PAY_ORDER_INVALID'});
  assert.deepEqual(f.calls,[]);
 });
});

test('protected status and invoke bind the retained npi and same holder across awaits',async()=>{
 const f=await fixture(),gate=deferred(),calls=[],reply=Object.freeze({ok:true,queryOnly:true});
 let holder,currentHolder;
 const product=createWalletNativePayProduct({
  entry:{status:()=>f.pay.status(),invoke(){assert.fail('legacy invoke');},async invokeOriginalOrderResult(request,npi,current){
   current();calls.push({request,npi});if(request.action==='order-pay-review')await gate.promise;current();return reply;
  }},
  getMain:()=>({pendingRequests:()=>[]}),getGuard:()=>f.key.current(),publishReview(){assert.fail('revoked holder published a review');},
 });
 const steps=createMainStandalonePayNavigationSteps({nativePayProduct:product,keyAccess:f.key,captureOriginalShopHolder(request){
  holder=currentHolder=Object.freeze({request,originalOperation,account,walletGeneration:f.key.status().revision,nativeGeneration:3,session:Object.freeze({}),current:()=>currentHolder});
  return holder;
 }});
 await f.key.run(async()=>{
  const read=steps.openProtectedOrder('order-invoice','PUBLIC-order');
  assert.equal((await read.status()).ok,true);
  assert.equal((await read.invoke()).value,reply);
  await read.close();
  const child=steps.openProtectedOrder('order-pay-review','PUBLIC-order');
  assert.equal((await child.status()).ok,true);
  const pending=child.invoke();
  await flush();
  assert.deepEqual(calls.map(({request,npi})=>[request.action,request.productId,request.sourceOrder,npi]),[
   ['order-invoice','shop.order','PUBLIC-order',originalOperation],
   ['order-pay-review','shop.order','PUBLIC-order',originalOperation],
  ]);
  currentHolder=Object.freeze({...holder,nativeGeneration:4});
  gate.resolve();
  assert.equal((await pending).error.code,'STANDALONE_PAY_PROTECTED_HOLDER_CHANGED');
  await child.close();
 });
});

test('protected capture rejects a substituted request, account, generation or operation before status',async()=>{
 const f=await fixture({invokeOriginalOrderResult(){assert.fail('invalid holder invoked');}});
 await f.key.run(async()=>{
  for(const patch of [{request:{}},{account:other},{walletGeneration:-1},{nativeGeneration:NaN},{originalOperation:'invalid'}]){
   const steps=createMainStandalonePayNavigationSteps({nativePayProduct:f.pay,keyAccess:f.key,captureOriginalShopHolder(request){
    const holder=Object.freeze({request,originalOperation,account,walletGeneration:f.key.status().revision,nativeGeneration:3,session:{},current:()=>holder,...patch});
    return holder;
   }});
   assert.throws(()=>steps.openProtectedOrder('order-pay-review','PUBLIC-order'),{code:'STANDALONE_PAY_PROTECTED_HOLDER_INVALID'});
   assert.deepEqual(f.calls,[]);
  }
 });
});
