import test from 'node:test';import assert from 'node:assert/strict';import {createNativePayActionApproval} from './merchant-invoice-approval.mjs';
import {createNativePayMainEntry} from './main-entry.mjs';
test('normal invoice-ID payment and refund review do not call review when original outcome is unknown',async()=>{
 for(const bill of [{status:'unknown'},{status:'committed_paid',refundStatus:'unknown'},{status:'committed_paid',operations:{original:{status:'submitted'}}}]){
  let reviews=0,reads=0;const pay={async readInvoice(m,id){reads++;assert.equal(id,'invoice-original');return bill},reviewSettlement(){reviews++},reviewRefund(){reviews++}};
  const main={requestPQTypedAction(){throw Error('unexpected review')},reject(){},transactionSender:{submissions:{intentStore:{readPQOriginals(){},unresolvedPreparation(){}}}}};
  const approval=createNativePayActionApproval({main,pay});
  await assert.rejects(approval.requestSettlement('merchant','invoice-original',()=>{}),{code:'NATIVE_PAY_ORIGINAL_RECONCILE_REQUIRED'});
  await assert.rejects(approval.requestRefund('merchant','invoice-original','refund-original','30',()=>{}),{code:'NATIVE_PAY_ORIGINAL_RECONCILE_REQUIRED'});
  assert.equal(reads,2);assert.equal(reviews,0);
 }
});
test('direct retained Member review rejects an already recorded original operation',async()=>{
 const account='0x'+'1'.repeat(40),nativeHash='0x'+'2'.repeat(64),originalHash='0x'+'3'.repeat(64);
 const main={requestPQTypedAction(){},reject(){},vault:{async status(){return {initialized:true,account}}},transactionSender:{submissions:{intentStore:{async readPQOriginals(){return [{kind:'pq-typed-action',hash:originalHash,account,typed:{memberHash:nativeHash}}]},unresolvedPreparation(){}}}}};
 const pay={async readInvoice(){return {operations:{[nativeHash]:{status:'unknown'}}}}};const approval=createNativePayActionApproval({main,pay});
 await assert.rejects(approval.readOriginalActionMember({merchant:account,invoiceId:'invoice-original',kind:'invoice_settle',originalHash},()=>{}),{code:'NATIVE_PAY_ORIGINAL_RECONCILE_REQUIRED'});
});
test('reopened normal entry reads the same invoice and retains a read-only recovery after an unknown refund',async()=>{
 const merchant='0x'+'1'.repeat(40),invoiceId='invoice-original';let reviews=0,reads=0;
 const pay={async readInvoice(m,id){reads++;assert.equal(m,merchant);assert.equal(id,invoiceId);return {merchant,invoiceId,status:'committed_paid',refundStatus:'unknown',paidAtoms:'100',refundedAtoms:'30',netPaidAtoms:'70'}},merchantTermsReview(){},readInvoiceIntent(){},reviewSettlement(){reviews++},reviewRefund(){reviews++}};
 const main={requestPQTypedAction(){throw Error('unexpected review')},reject(){},transactionSender:{submissions:{intentStore:{readPQOriginals(){},unresolvedPreparation(){}}}}};
 const open=()=>{const entry=createNativePayMainEntry({getMain:()=>main,getContext:()=>({account:merchant,revision:1,focused:true})});entry.compose({pay,current(){}});return entry};
 const first=await open().invokeResult({action:'invoice',merchant,invoiceId});assert.equal(first.outcomeUnknown,true);
 const reopened=open(),recovery=await reopened.invokeResult(first.recoveryActions[0]);assert.equal(recovery.outcomeUnknown,true);assert.equal(recovery.bill.refundedAtoms,'30');assert.equal(recovery.bill.netPaidAtoms,'70');
 for(const request of [{action:'pay-review',merchant,invoiceId},{action:'refund-review',merchant,invoiceId,refundId:'refund-original',amountAtoms:'30'}]){const result=await reopened.invokeResult(request);assert.equal(result.code,'NATIVE_PAY_ORIGINAL_RECONCILE_REQUIRED');assert.equal(result.canRetry,false);assert.deepEqual(result.recoveryActions,[{action:'invoice',merchant,invoiceId}])}
 assert.equal(reviews,0);assert.equal(reads,4);
});
