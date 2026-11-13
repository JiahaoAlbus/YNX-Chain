// PUBLIC Main queue/Source-lifecycle fixtures with the actual normal P06 entry,
// normal Main startup/service and sole tracked SDK DATA codec. No Native/Root
// admission, original Wallet accounts, signing, RPC or submissions are used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {encodePQNativeAction} from '@ynx-chain/wallet-auth/pq-native-action';
import {createNativePayMainEntry} from '../src/native-pay-client/main-entry.mjs';
import {createWalletNativePayProductStartup} from '../src/wallet-native-pay-product-startup.mjs';
import {createWalletNativePayProduct} from '../src/wallet-native-pay-product.mjs';
const account='0x'+'a'.repeat(40),intentId='npi_'+'d'.repeat(48);
const action={chainId:'c'.repeat(64),nativeChainId:'6423',owner:account,nonce:'1',fee:'1',kind:'invoice_terms',payload:{invoiceID:'invoice-public',sessionID:'session-public',recipient:'0x'+'b'.repeat(40),payer:'',assetID:'YNXT',unitVersion:'1',feeRule:'native-transfer-fee-one/v1',keyEpoch:'1',revision:'1',amount:'100',maxFee:'1',expiresAt:'1000'}};
const bytes=Buffer.from(encodePQNativeAction(action));
const view={merchant:account,request:{genesis:action.chainId,nativeChainId:action.nativeChainId},signingMessageHash:createHash('sha256').update(bytes).digest('hex')};
function fixture({cleanupCause,startup=false,noOp=false,retireAfterValidation=false}={}){
 let entered,finish,rejects=0,requested=0,published=0;const ready=new Promise(r=>entered=r),gate=new Promise(r=>finish=r),queue=new Map(),loans=new Set(),calls=[];
 const main={transactionSender:{submissions:{intentStore:{readPQOriginals:async()=>[],unresolvedPreparation:async()=>false}}},pendingRequests:()=>[...queue.values()],reject(id){rejects++;assert(queue.has(id));if(noOp)return;throw cleanupCause;},async requestPQTypedAction(){requested++;entered();await gate;const request={id:'PUBLIC-original-review',method:'ynx_signPQNativeAction',review:{account,typedReview:{action}}};queue.set(request.id,request);return{status:'approval-required',request};}};
 let current=true;
 if(retireAfterValidation){
  const request=main.requestPQTypedAction;
  main.requestPQTypedAction=async()=>{
   const result=await request();
   Object.defineProperty(result.request.review,'typedReview',{get(){current=false;return {action};}});
   return result;
  };
  main.reject=id=>{rejects++;assert.equal(id,'PUBLIC-original-review');queue.delete(id);};
 }
 const getContext=()=>({account,revision:1,locked:false,focused:current,changing:false}),getGuard=()=>({account,assert(){}});
 const pay={merchantTermsReview:async()=>({message:bytes.toString('base64'),intent:view}),readInvoiceIntent:async()=>view,readInvoice:async()=>({paidAtoms:'0'})};let entry;
 if(startup){entry=createWalletNativePayProductStartup({captureFactories:()=>({acquireOriginalProductSource(){let retired=false;const loan={current(){assert.equal(retired,false);},retire(){calls.push('retire');retired=true;},async join(){calls.push('join');},async close(){calls.push('close');},pay};loans.add(loan);return loan;},isOriginalProductSource:v=>loans.has(v)}),getMain:()=>main,getContext,getGuard});}
 else{entry=createNativePayMainEntry({getMain:()=>main,getContext});entry.compose({current(){},pay});}
 const service=createWalletNativePayProduct({entry:startup?entry:{...entry,invoke:entry.invokeResult},getMain:()=>main,getGuard,publishReview(){published++;assert.fail('late original review must not be published');}});
 return{entry,service,main,queue,ready,finish,calls,counts:()=>({rejects,requested,published})};
}
async function late(f,{startup=false,cleanupCause}={}){
 const flight=f.service.invoke({action:'terms-review',intentId});await f.ready;f.service.cancel();f.finish();
 if(startup)await assert.rejects(flight,e=>e===cleanupCause);else{const result=await flight;assert.equal(result.version,'ynx.pay.main-result/v1');assert.equal(result.ok,false);assert.equal(result.canRetry,false);assert.equal(result.outcome,'UNKNOWN');}
 assert.equal(f.queue.size,1);assert.equal(f.counts().published,0);
}
function throwsSame(fn,cause){let present=false;try{fn();}catch(e){present=true;assert.equal(e,cause);}assert.equal(present,true);}
for(const cleanupCause of [0,false,null])test(`normal P06 entry retains late review with cleanup ${String(cleanupCause)} through actual outer close`,async()=>{
 const f=fixture({cleanupCause});await late(f);
 const original=await f.service.invoke({action:'invoice',merchant:account,invoiceId:'invoice-public'});assert.equal(original.bill.paidAtoms,'0');
 throwsSame(()=>f.entry.cancel(),cleanupCause);throwsSame(()=>f.entry.cancel(),cleanupCause);
 await assert.rejects(f.entry.invoke({action:'terms-review',intentId}),e=>e===cleanupCause);
 assert.deepEqual(f.counts(),{rejects:1,requested:1,published:0});
 assert.throws(()=>f.service.assertSafeToClose(),{code:'NATIVE_PAY_MAIN_REVIEWS_RETAINED'});
 assert.equal(f.queue.size,1);assert.equal(f.counts().rejects,1);
 assert.throws(()=>f.entry.settleOriginalReview('PUBLIC-original-review',{}),{code:'NATIVE_PAY_MAIN_REVIEW_OWNER_CHANGED'});
 f.queue.clear();f.entry.settleOriginalReview('PUBLIC-original-review',f.main);assert.doesNotThrow(()=>f.service.assertSafeToClose());
});
for(const cleanupCause of [0,false,null])test(`normal startup controller really transmits cleanup ${String(cleanupCause)} debt to outer close`,async()=>{
 const f=fixture({cleanupCause,startup:true});await late(f,{startup:true,cleanupCause});
 const original=await f.service.invoke({action:'invoice',merchant:account,invoiceId:'invoice-public'});assert.equal(original.bill.paidAtoms,'0');
 throwsSame(()=>f.service.cancel(),cleanupCause);assert.equal(f.counts().rejects,1);
 assert.throws(()=>f.service.assertSafeToClose(),{code:'NATIVE_PAY_PRODUCT_CLEANUP_PENDING'});
 assert.deepEqual(f.calls,['retire','join','close','retire','join','close']);assert.equal(f.queue.size,1);
 assert.throws(()=>f.entry.settleOriginalReview('PUBLIC-original-review',f.main),{code:'NATIVE_PAY_MAIN_REVIEW_STILL_PENDING'});
 f.queue.clear();assert.equal(f.entry.settleOriginalReview('PUBLIC-original-review',f.main).settled,true);
 assert.doesNotThrow(()=>f.service.assertSafeToClose());assert.equal(f.counts().rejects,1);
});
test('no-op Main reject cannot turn a late queued request into a clean close',async()=>{
 const f=fixture({noOp:true});await late(f);assert.throws(()=>f.service.assertSafeToClose(),{code:'NATIVE_PAY_MAIN_REVIEWS_RETAINED'});assert.equal(f.counts().rejects,1);assert.equal(f.queue.size,1);
});
test('retirement after review validation cancels only the review retained by this invocation',async()=>{
 const f=fixture({retireAfterValidation:true});
 const other={id:'PUBLIC-other-review'};
 f.queue.set(other.id,other);
 const flight=f.entry.invoke({action:'terms-review',intentId});
 await f.ready;
 f.finish();
 await assert.rejects(flight,{code:'NATIVE_PAY_MAIN_CURRENT_UNAVAILABLE'});
 assert.deepEqual([...f.queue.values()],[other]);
 assert.deepEqual(f.counts(),{rejects:1,requested:1,published:0});
 assert.doesNotThrow(()=>f.entry.assertSafeToClose());
});
test('outer active operation is checked before consulting inner close; after settle exact inner falsy cause survives',async()=>{
 let release,consulted=0;const cause=false,entry={invoke:()=>new Promise(r=>release=r),assertSafeToClose(){consulted++;throw cause;}},service=createWalletNativePayProduct({entry,getMain:()=>({}),getGuard:()=>({assert(){}}),publishReview:()=>assert.fail()});
 const flight=service.invoke({});assert.throws(()=>service.assertSafeToClose(),{code:'NATIVE_PAY_MAIN_OPERATION_PENDING'});assert.equal(consulted,0);release({});await flight;throwsSame(()=>service.assertSafeToClose(),cause);assert.equal(consulted,1);
});
test('normal Main boot passes the real startup controller directly into its outer service and exit gate',async()=>{
 const source=await fs.readFile(new URL('../src/main.mjs',import.meta.url),'utf8');
 assert.match(source,/nativePayMainEntry=createWalletNativePayProductStartup\(/);assert.match(source,/createWalletNativePayProduct\(\{entry:nativePayMainEntry,/);assert.match(source,/nativePayProduct\?\.assertSafeToClose\(\)/);
});
