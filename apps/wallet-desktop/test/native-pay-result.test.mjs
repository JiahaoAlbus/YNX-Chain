import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativePayMainEntry} from '../src/native-pay-client/main-entry.mjs';
import {nativePayFailureCode,nativePayFailureResultDATA,nativePayRecoveryActions,readNativePayFailureCause} from '../src/native-pay-client/pay-business-client.mjs';
const merchant='0x'+'1'.repeat(40),nativeHash='0x'+'2'.repeat(64),abciHash='0x'+'3'.repeat(64),intentId='npi_'+'4'.repeat(48);
const original={productId:'shop.order',sourceOrder:'order:original',storeId:'store-original',merchant,recipient:merchant,genesis:'a'.repeat(64),nativeChainId:'6423',assetId:'YNXT',unitVersion:'1',amountAtoms:'100',domainData:{schema:'PUBLIC_ORIGINAL_DATA'}};
function boot(pay,extra={}){const entry=createNativePayMainEntry({getMain:()=>null,getContext:()=>({account:merchant,revision:1,focused:true})});entry.compose({pay,current(){},...extra});return entry;}
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
