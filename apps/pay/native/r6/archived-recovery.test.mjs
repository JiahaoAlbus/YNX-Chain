import test from 'node:test';
import assert from 'node:assert/strict';
import {NativePayBusinessClient} from './pay-business-client.mjs';
import {createNativePayMainEntry} from './main-entry.mjs';
import {composeNativePayProductSource} from './product-source.mjs';
import {nativeArchiveReconciliationData} from './archive-receipt.mjs';
const merchant='0x'+'1'.repeat(40),settlement='0x'+'2'.repeat(64),refund='0x'+'3'.repeat(64);
const original={productId:'shop.order',storeId:'store-original',sourceOrder:'order-original',merchant,recipient:merchant,genesis:'a'.repeat(64),nativeChainId:'6423',assetId:'YNXT',unitVersion:'1',amountAtoms:'100',domainData:{schema:'PUBLIC_original_request_DATA_not_authority'}};
const reference={productId:original.productId,sourceOrder:original.sourceOrder,merchant,invoiceId:'invoice-original',nativeHash:refund};
// PUBLIC compact DTO controls only; actual Math/HTTP/Store tests are in Go.
const receipt=(kind='invoice_refund')=>({version:'ynx.pay.native.archive-receipt/v1',productId:original.productId,storeId:original.storeId,sourceOrder:original.sourceOrder,merchant,invoiceId:reference.invoiceId,sessionId:'session-original',genesis:original.genesis,nativeChainId:original.nativeChainId,nativeHash:kind==='invoice_settle'?settlement:refund,abciHash:'0x'+'4'.repeat(64),kind,status:'confirmed',archiveDigest:'5'.repeat(64),termsHash:'6'.repeat(64),...(kind==='invoice_refund'?{settlementNativeHash:settlement}:{}),eventClaim:'7'.repeat(64),executionHeight:'13',principalAtoms:kind==='invoice_settle'?'100':'30',paidAtoms:'100',refundedAtoms:kind==='invoice_settle'?'0':'30',netPaidAtoms:kind==='invoice_settle'?'100':'70',proofVerification:'original-independent-core-verifier',dataOnly:true,queryOnly:true,canRetry:false,SourceAdmission:false,nativeGrant:false});
function runtime(read=async()=>receipt()) {return{current(){},pay:{},readOriginalInvoiceIntent:async()=>original,readOriginalArchiveReceipt:read};}
test('r6 normal entry uses qualified original read port; original reviews and r5 scope are unchanged',async()=>{
 let reads=0,posts=0;
 const loan={current(){},pay:{readInvoice:async()=>({operations:{[refund]:{status:'confirmed'}}}),reconcileOperation(){posts++;}},readOriginalShopNativeInvoiceRequestDATA:async()=>original,readOriginalArchiveReceipt:async(ref,current)=>{current();reads++;assert.deepEqual(ref,reference);return receipt();},retire(){},async join(){},async close(){}};
 const main=createNativePayMainEntry({getMain:()=>null,getContext:()=>({account:merchant,revision:1,focused:true})});
 const source=await composeNativePayProductSource(main,{acquireOriginalProductSource:async()=>loan,isOriginalProductSource:value=>value===loan});
 const result=await main.invoke({action:'recover-archive',...reference});assert.equal(result.archiveReceipt.netPaidAtoms,'70');assert.equal(result.clientIndependentFinality,false);assert.equal(result.queryOnly,true);assert.equal(result.archiveReceipt.SourceAdmission,false);
 assert.equal(result.archiveReceipt.member,undefined);assert.equal(result.archiveReceipt.proof,undefined);
 const plain=await main.invoke({action:'recover',merchant,invoiceId:reference.invoiceId,nativeHash:refund});assert.equal(plain.archive.reason,'NATIVE_PAY_ORIGINAL_PRODUCT_REFERENCE_REQUIRED');assert.equal(posts,0);assert.equal(reads,1);
 source.retire();await source.join();await source.close();
});
test('lost archive response cold recovery repeats exact read only and preserves old missing archive code',async()=>{
 const calls=[];let lost=true;const read=async ref=>{calls.push(structuredClone(ref));if(lost){lost=false;throw Object.assign(Error(),{code:'PUBLIC_ARCHIVE_RESPONSE_LOST'});}return receipt();};
 await assert.rejects(new NativePayBusinessClient(runtime(read)).recoverArchivedInvoice(original.productId,original.sourceOrder,merchant,reference.invoiceId,refund),{code:'PUBLIC_ARCHIVE_RESPONSE_LOST'});
 const cold=new NativePayBusinessClient(runtime(read));assert.equal((await cold.recoverArchivedInvoice(original.productId,original.sourceOrder,merchant,reference.invoiceId,refund)).archiveReceipt.nativeHash,refund);assert.deepEqual(calls,[reference,reference]);
 const legacy=new NativePayBusinessClient(runtime(async()=>{throw Object.assign(Error(),{code:'NATIVE_PAY_SETTLEMENT_ARCHIVE_UNAVAILABLE',status:409});}));
 await assert.rejects(legacy.recoverArchivedInvoice(original.productId,original.sourceOrder,merchant,reference.invoiceId,refund),{code:'NATIVE_PAY_SETTLEMENT_ARCHIVE_UNAVAILABLE',status:409});assert.equal(legacy.snapshot().archiveReceipt,undefined);
});
test('late cancel or Source revoke cannot publish an archive receipt or trigger a send',async()=>{
 let release,live=true;const r=runtime(()=>new Promise(resolve=>release=resolve));r.current=()=>{if(!live)throw Object.assign(Error(),{code:'ORIGINAL_SOURCE_RETIRED'});};
 const client=new NativePayBusinessClient(r),pending=client.recoverArchivedInvoice(original.productId,original.sourceOrder,merchant,reference.invoiceId,refund);
 while(!release)await new Promise(resolve=>setImmediate(resolve));live=false;release(receipt());await assert.rejects(pending,{code:'ORIGINAL_SOURCE_RETIRED'});assert.equal(client.snapshot().archiveReceipt,undefined);
 live=true;const cancelled=client.recoverArchivedInvoice(original.productId,original.sourceOrder,merchant,reference.invoiceId,refund);await new Promise(resolve=>setImmediate(resolve));client.invalidate();release(receipt());await assert.rejects(cancelled,{code:'NATIVE_PAY_SELECTION_CHANGED'});assert.equal(client.snapshot().archiveReceipt,undefined);
});
test('actual bound receipt port result cannot retarget product/order/invoice/hash or change principal',async()=>{
 for(const change of [r=>r.sourceOrder='other-order',r=>r.productId='other.product',r=>r.invoiceId='other-invoice',r=>r.nativeHash=settlement,r=>r.paidAtoms='99',r=>r.SourceAdmission=true]){
  const value=receipt();change(value);const client=new NativePayBusinessClient(runtime(async()=>value));await assert.rejects(client.recoverArchivedInvoice(original.productId,original.sourceOrder,merchant,reference.invoiceId,refund),{code:'NATIVE_PAY_ARCHIVE_RECEIPT_BINDING'});
 }
});
test('merchant reconciliation retains known original receipts and pending references without inventing completion',async()=>{
 const value={version:'ynx.pay.native.archive-reconciliation/v1',productId:original.productId,storeId:original.storeId,sourceOrder:original.sourceOrder,merchant,invoiceId:reference.invoiceId,genesis:original.genesis,nativeChainId:original.nativeChainId,principalAtoms:'100',paidAtoms:'100',refundedAtoms:'30',netPaidAtoms:'70',receipts:[receipt('invoice_settle'),receipt()],pendingOriginals:['0x'+'8'.repeat(64)],completeKnownOriginals:false,proofVerification:'original-independent-core-verifier',dataOnly:true,queryOnly:true,canRetry:false,SourceAdmission:false,nativeGrant:false};
 const r=runtime();r.readOriginalArchiveReconciliation=async()=>value;
 const result=await new NativePayBusinessClient(r).reconcileArchivedInvoice(original.productId,original.sourceOrder,merchant,reference.invoiceId);assert.equal(result.reconciliation.receipts.length,2);assert.equal(result.reconciliation.completeKnownOriginals,false);assert.equal(result.reconciliation.netPaidAtoms,'70');
 let getters=0;const trap=[receipt()];Object.defineProperty(trap,'0',{enumerable:true,get(){getters++;return receipt();}});
 assert.throws(()=>nativeArchiveReconciliationData({...value,receipts:trap},original,reference),{code:'NATIVE_PAY_ARCHIVE_RECEIPT_BINDING'});assert.equal(getters,0);
});
