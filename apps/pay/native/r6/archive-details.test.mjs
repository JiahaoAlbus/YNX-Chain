import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeArchiveReceiptData} from './archive-receipt.mjs';
const merchant='0x'+'1'.repeat(40),payer='0x'+'2'.repeat(40),nativeHash='0x'+'3'.repeat(64),settlement='0x'+'4'.repeat(64);
const original={productId:'shop.order',storeId:'store-original',sourceOrder:'order-original',merchant,recipient:merchant,genesis:'a'.repeat(64),nativeChainId:'6423',assetId:'YNXT',unitVersion:'1',amountAtoms:'100'};
const ref={merchant,invoiceId:'invoice-original',nativeHash};
const receipt=()=>({version:'ynx.pay.native.archive-receipt/v1',productId:original.productId,storeId:original.storeId,sourceOrder:original.sourceOrder,merchant,invoiceId:ref.invoiceId,sessionId:'session-original',genesis:original.genesis,nativeChainId:original.nativeChainId,nativeHash,abciHash:'0x'+'5'.repeat(64),kind:'invoice_refund',status:'confirmed',archiveDigest:'6'.repeat(64),termsHash:'7'.repeat(64),settlementNativeHash:settlement,eventClaim:'8'.repeat(64),executionHeight:'42',principalAtoms:'30',paidAtoms:'100',refundedAtoms:'30',netPaidAtoms:'70',proofVerification:'original-independent-core-verifier',dataOnly:true,queryOnly:true,canRetry:false,SourceAdmission:false,nativeGrant:false,assetId:'YNXT',unitVersion:'1',executionIndex:'3',executionMember:'0',executionEvent:'0',refundId:'return:original',payer,recipient:payer});
test('refund original identity and verified execution DATA survive the compact projection',()=>{
 const out=nativeArchiveReceiptData(receipt(),original,ref);
 assert.equal(out.refundId,'return:original');assert.equal(out.payer,payer);assert.equal(out.recipient,payer);assert.equal(out.executionIndex,'3');assert.equal(out.SourceAdmission,false);assert.ok(Object.isFrozen(out));
});
test('detail projection rejects partial fields, wrong units, unsafe coordinates and wrong refund recipient',()=>{
 for(const edit of [r=>delete r.executionIndex,r=>r.unitVersion='2',r=>r.assetId='BTC',r=>r.executionIndex='03',r=>r.executionIndex='4294967296',r=>r.executionEvent='1',r=>r.recipient=merchant,r=>r.payer=merchant,r=>r.refundId='../other']){
  const r=receipt();edit(r);assert.throws(()=>nativeArchiveReceiptData(r,original,ref),{code:'NATIVE_PAY_ARCHIVE_RECEIPT_BINDING'});
 }
});
test('older compact DTO remains readable with absent details and cannot assert a refund ID alone',()=>{
 const r=receipt();for(const k of ['executionIndex','executionMember','executionEvent','assetId','unitVersion','refundId','payer','recipient'])delete r[k];
 assert.equal(nativeArchiveReceiptData(r,original,ref).refundId,undefined);
 assert.throws(()=>nativeArchiveReceiptData({...r,refundId:'return:invented'},original,ref),{code:'NATIVE_PAY_ARCHIVE_RECEIPT_BINDING'});
});
