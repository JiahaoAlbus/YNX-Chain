import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativePayMainEntry} from './main-entry.mjs';
import {nativePayFailureCode,nativePayFailureResultDATA,nativePayRecoveryActions,readNativePayFailureCause} from './pay-business-client.mjs';
const merchant='0x'+'1'.repeat(40),nativeHash='0x'+'2'.repeat(64),abciHash='0x'+'3'.repeat(64),intentId='npi_'+'4'.repeat(48);
const original={productId:'shop.order',sourceOrder:'order:original',storeId:'store-original',merchant,recipient:merchant,genesis:'a'.repeat(64),nativeChainId:'6423',assetId:'YNXT',unitVersion:'1',amountAtoms:'100',domainData:{schema:'PUBLIC_ORIGINAL_DATA'}};
function boot(pay,extra={}){const entry=createNativePayMainEntry({getMain:()=>null,getContext:()=>({account:merchant,revision:1,focused:true})});entry.compose({pay,current(){},...extra});return entry;}
test('original invoice recovery reads terminal state before requesting proof reconciliation',async()=>{
 for(const [state,phase] of [['ISSUED','confirmed'],['PREPARED','confirmed_failed']]){
  let reads=0,posts=0;const entry=boot({async readInvoiceIntent(id){reads++;assert.equal(id,intentId);return {intentId:id,originalOperation:id,state,phase}},async reconcileInvoiceIntent(){posts++;throw Error('terminal must not reconcile')}});
  const result=await entry.invokeResult({action:'recover-intent',intentId});assert.equal(result.ok,true);assert.equal(result.queryOnly,true);assert.equal(reads,1);assert.equal(posts,0);
 }
});
test('original invoice recovery reconciles only the same unresolved intent',async()=>{
 let reads=0,posts=0;const entry=boot({async readInvoiceIntent(id){reads++;return {intentId:id,originalOperation:id,state:posts?'ISSUED':'PREPARED',phase:posts?'confirmed':'unknown'}},async reconcileInvoiceIntent(id){posts++;return {intentId:id,originalOperation:id}}});
 const result=await entry.invokeResult({action:'recover-intent',intentId});assert.equal(result.ok,true);assert.equal(result.intent.intentId,intentId);assert.equal(reads,2);assert.equal(posts,1);assert.equal(result.canRetry,false);
 let settled=false,lostPosts=0;const cold=()=>boot({async readInvoiceIntent(id){return {intentId:id,originalOperation:id,state:settled?'ISSUED':'PREPARED',phase:settled?'confirmed':'unknown'}},async reconcileInvoiceIntent(){lostPosts++;settled=true;throw Object.assign(Error('lost reply'),{code:'PUBLIC_ORIGINAL_REPLY_LOST'})}});
 const lost=await cold().invokeResult({action:'recover-intent',intentId});assert.equal(lost.code,'PUBLIC_ORIGINAL_REPLY_LOST');assert.equal(lost.canRetry,false);
 const reopened=await cold().invokeResult({action:'recover-intent',intentId});assert.equal(reopened.ok,true);assert.equal(reopened.intent.intentId,intentId);assert.equal(lostPosts,1);
 for(const step of ['initial','reconcile','final']){
  let n=0,calls=0;const bad=boot({async readInvoiceIntent(id){n++;return {intentId:id,originalOperation:(step==='initial'&&n===1||step==='final'&&n===2)?'npi_'+'9'.repeat(48):id,state:'PREPARED',phase:'unknown'}},async reconcileInvoiceIntent(id){calls++;return {intentId:id,originalOperation:step==='reconcile'?'npi_'+'9'.repeat(48):id}}});
  const rejected=await bad.invokeResult({action:'recover-intent',intentId});assert.equal(rejected.code,'NATIVE_INVOICE_ORIGINAL_BINDING');assert.equal(rejected.canRetry,false);assert.equal(calls,step==='initial'?0:1);
 }
});
test('Shop original source conflict stops create and lookup before any Pay request',async()=>{
 let creates=0,lookups=0,reads=0;
 const conflict=Object.assign(Error('conflict'),{status:409});
 const entry=boot({async createInvoiceIntent(){creates++},async lookupInvoiceIntent(){lookups++}},{async readOriginalInvoiceIntent(ref){reads++;assert.deepEqual(ref,{productId:original.productId,sourceOrder:original.sourceOrder});throw conflict}});
 for(const action of ['create-intent','lookup-intent']){
  const result=await entry.invokeResult({action,productId:original.productId,sourceOrder:original.sourceOrder});
  assert.equal(result.ok,false);assert.equal(result.code,'NATIVE_PAY_OPERATION_UNAVAILABLE');assert.equal(result.httpStatus,409);assert.equal(result.canRetry,false);
  assert.equal(readNativePayFailureCause(result).cause,conflict);
 }
 assert.equal(reads,2);assert.equal(creates,0);assert.equal(lookups,0);
});
test('normal result retains lost-create original selector and offers only original lookup',async()=>{
 const error=Object.assign(Error('PRIVATE_EXCEPTION_BODY'),{code:4100,data:{code:'NATIVE_PAY_HTTP_UNKNOWN',secret:'PRIVATE_MEMBER'}});let creates=0;
 const pay={async createInvoiceIntent(){creates++;throw error;}};
 const entry=boot(pay,{readOriginalInvoiceIntent:async()=>original});
 const result=await entry.invokeResult({action:'create-intent',productId:original.productId,sourceOrder:original.sourceOrder});
 assert.equal(result.ok,false);assert.equal(result.code,'NATIVE_PAY_HTTP_UNKNOWN');assert.equal(result.outcome,'UNKNOWN');assert.equal(result.recoveryOnly,true);assert.equal(result.canRetry,false);
 assert.deepEqual(result.recoveryActions,[{action:'lookup-intent',productId:original.productId,sourceOrder:original.sourceOrder}]);
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|member|envelope/);assert.equal(creates,1);assert.equal(readNativePayFailureCause(result).cause,error);assert.deepEqual(readNativePayFailureCause(structuredClone(result)),{present:false});
 const legacy=boot({async readInvoice(){throw error;}});await assert.rejects(legacy.invoke({action:'invoice',merchant,invoiceId:'invoice-original'}),e=>e===error);assert.equal(creates,1);
});
test('same-reference recovery never converts original ABCI hash to native hash or offers signed actions',()=>{
 const r=nativePayRecoveryActions({merchant,invoiceId:'invoice-original',kind:'invoice_refund',originalHash:abciHash});
 assert.deepEqual(r,[{action:'invoice',merchant,invoiceId:'invoice-original'}]);
 assert.deepEqual(nativePayRecoveryActions({merchant,invoiceId:'invoice-original',nativeHash}),[{action:'recover',merchant,invoiceId:'invoice-original',nativeHash}]);
 assert.deepEqual(nativePayRecoveryActions({intentId}),[{action:'intent',intentId}]);
 const archive={productId:'shop.order',sourceOrder:'order:original',merchant,invoiceId:'invoice-original',nativeHash};
 assert.deepEqual(nativePayRecoveryActions(archive),[{action:'recover-archive',...archive}]);
 assert.deepEqual(nativePayRecoveryActions({productId:'https://external',sourceOrder:'../order'}),[]);
});
test('normal result shows exact known totals beside pending original without granting retry/finality',async()=>{
 const amount='9007199254740993';
 const entry=boot({async readInvoice(){return {merchant,invoiceId:'invoice-original',status:'committed_paid',refundStatus:'unknown',paidAtoms:amount,refundedAtoms:'30',netPaidAtoms:'9007199254740963',termsMember:'PRIVATE_MEMBER',operations:{[nativeHash]:{nativeHash,abciHash,kind:'invoice_refund',status:'unknown',member:'PRIVATE_MEMBER'},[abciHash]:{nativeHash:abciHash,abciHash:nativeHash,kind:'invoice_settle',status:'confirmed'}}};}});
 const r=await entry.invokeResult({action:'invoice',merchant,invoiceId:'invoice-original'});
 assert.equal(r.ok,true);assert.equal(r.bill.paidAtoms,amount);assert.equal(r.bill.netPaidAtoms,'9007199254740963');assert.deepEqual(r.pendingOriginals,[nativeHash]);assert.equal(r.outcomeUnknown,true);assert.equal(r.clientIndependentFinality,false);assert.equal(r.canRetry,false);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_MEMBER/);
});
test('invoice and refund UNKNOWN remain visible even when the operation list is absent',async()=>{
 for(const [status,refundStatus] of [['unknown','none'],['committed_paid','unknown']]){
  let reads=0;const entry=boot({async readInvoice(m,id){reads++;assert.equal(m,merchant);assert.equal(id,'invoice-original');return {merchant,invoiceId:id,status,refundStatus,paidAtoms:'100',refundedAtoms:'30',netPaidAtoms:'70'};}});
  const result=await entry.invokeResult({action:'invoice',merchant,invoiceId:'invoice-original'});
  assert.equal(result.ok,true);assert.equal(result.outcomeUnknown,true);assert.equal(result.bill.refundedAtoms,'30');assert.equal(result.bill.netPaidAtoms,'70');assert.equal(result.canRetry,false);assert.deepEqual(result.recoveryActions,[{action:'invoice',merchant,invoiceId:'invoice-original'}]);assert.equal(reads,1);
 }
});
test('rejected or unavailable review is UNKNOWN DATA; original invoke preserves primitive first cause',async()=>{
 const error=false,entry=boot({async readInvoice(){throw error;}});
 await assert.rejects(entry.invoke({action:'invoice',merchant,invoiceId:'invoice-original'}),e=>e===error);
 const r=await entry.invokeResult({action:'invoice',merchant,invoiceId:'invoice-original'});assert.equal(r.ok,false);assert.equal(r.code,'NATIVE_PAY_OPERATION_UNAVAILABLE');assert.equal(r.outcome,'UNKNOWN');assert.equal(r.paymentAuthorized,false);assert.deepEqual(readNativePayFailureCause(r),{present:true,cause:false});
});
test('late account/Source cancel removes references and never publishes old private facts',async()=>{
 let reject;const entry=boot({readInvoice:()=>new Promise((_,no)=>reject=no)});
 const pending=entry.invokeResult({action:'invoice',merchant,invoiceId:'private-original'});
 reject(Object.assign(Error(),{code:'LOST_READ'}));queueMicrotask(()=>entry.cancel());
 const r=await pending;assert.equal(r.ok,false);assert.equal(r.reference,null);assert.deepEqual(r.recoveryActions,[]);assert.doesNotMatch(JSON.stringify(r),/private-original/);
});
test('busy result cannot borrow active operation recovery reference',async()=>{
 let resolve;const entry=boot({readInvoice:()=>new Promise(yes=>resolve=yes)});
 const first=entry.invokeResult({action:'invoice',merchant,invoiceId:'private-first'});
 const busy=await entry.invokeResult({action:'invoice',merchant,invoiceId:'private-second'});
 assert.equal(busy.code,'NATIVE_PAY_MAIN_BUSY');assert.equal(busy.reference,null);assert.deepEqual(busy.recoveryActions,[]);resolve({});await first;
});
test('failure projection executes no hostile metadata getter or Proxy trap',()=>{
 let hits=0;const error={};Object.defineProperty(error,'data',{get(){hits++;throw Error();}});Object.defineProperty(error,'code',{get(){hits++;throw Error();}});
 const state={};Object.defineProperty(state,'reference',{get(){hits++;throw Error();}});
 assert.equal(nativePayFailureCode(error),'NATIVE_PAY_OPERATION_UNAVAILABLE');assert.equal(nativePayFailureResultDATA(error,state).reference,null);
 assert.equal(nativePayFailureCode(new Proxy({},{get(){hits++;throw Error();},getOwnPropertyDescriptor(){hits++;throw Error();}})),'NATIVE_PAY_OPERATION_UNAVAILABLE');assert.equal(hits,0);
});
test('invalid or no-Source requests expose no composed capability or approval action',async()=>{
 const entry=createNativePayMainEntry({getMain:()=>null,getContext:()=>({})});
 for(const raw of [{action:'approve'},{action:'invoice',merchant,invoiceId:'invoice-original'}]){const r=await entry.invokeResult(raw);assert.equal(r.ok,false);assert.equal(r.reference,null);assert.equal(r.paymentAuthorized,false);assert.equal(r.canRetry,false);}
 assert.equal(entry.status().available,false);
});

test('status reports local Source connectivity without claiming Pay service or payment readiness',()=>{
 const entry=boot({});
 const status=entry.status();
 assert.equal(status.available,true);
 assert.equal(status.availabilityScope,'LOCAL_SOURCE_ONLY');
 assert.equal(status.serviceReadiness,'UNKNOWN');
 assert.equal(status.paymentAuthorized,false);
 const unavailable=createNativePayMainEntry({getMain:()=>null,getContext:()=>({account:merchant,revision:1,focused:true})});
 const missing=unavailable.status();
 assert.equal(missing.available,false);
 assert.equal(missing.reason,'NATIVE_PAY_MAIN_SOURCE_UNAVAILABLE');
 assert.equal(missing.serviceReadiness,'UNKNOWN');
});
