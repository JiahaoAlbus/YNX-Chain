// Actual r6 normal consumer; Go bridges only its original typed private reader
// and independent verifier. PUBLIC recognition is never Native admission.
import assert from 'node:assert/strict';
import {createInterface} from 'node:readline';
import {createNativePayMainEntry} from '../r6/main-entry.mjs';
import {composeNativePayProductSource} from '../r6/product-source.mjs';
import {createPrivateNativeInvoiceClient} from '../r6/merchant-invoice-approval.mjs';
const lines=createInterface({input:process.stdin,crlfDelay:Infinity})[Symbol.asyncIterator]();
const read=async()=>{const value=await lines.next();if(value.done)throw Error('Original typed reader closed');return JSON.parse(value.value);};
const input=await read(),{original,invoiceId,settlementHash,refundHash}=input;
let origin=input.origin;
async function call(type,reference){process.stdout.write(JSON.stringify({type,reference})+'\n');const value=await read();if(value.error)throw Object.assign(Error(value.error),{code:value.error,status:value.status});return value.result;}
async function boot(){
 const pay=createPrivateNativeInvoiceClient({origin,async requestPrivate(request){
  request.assertCurrent();assert.equal(request.method,'GET');assert.equal(request.body,undefined);
  const packet=await call('private-read',{...ref,origin:request.origin,method:request.method,path:request.path});request.assertCurrent();
  return {...packet,body:Buffer.from(packet.body,'base64')};
 }});
 const loan={pay,current(){},retire(){},async join(){},async close(){},async readOriginalShopNativeInvoiceRequestDATA(order,current){current();assert.equal(order,original.sourceOrder);return original;}};
 const entry=createNativePayMainEntry({getMain:()=>null,getContext:()=>({account:original.merchant,revision:1,focused:true})});
 const source=await composeNativePayProductSource(entry,{acquireOriginalProductSource:async()=>loan,isOriginalProductSource:value=>value===loan});
 return{entry,async close(){source.retire();await source.join();await source.close();source.assertSafeToClose();}};
}
const ref={productId:original.productId,sourceOrder:original.sourceOrder,merchant:original.merchant,invoiceId};
let runtime=await boot();
try{
 await assert.rejects(runtime.entry.invoke({action:'recover-archive',...ref,nativeHash:settlementHash}),{code:'NATIVE_PAY_ARCHIVE_QUERY_UNAVAILABLE',status:0});
 await runtime.close();runtime=await boot();
 const paid=await runtime.entry.invoke({action:'recover-archive',...ref,nativeHash:settlementHash});
 assert.equal(paid.archiveReceipt.paidAtoms,'100');assert.equal(paid.archiveReceipt.refundedAtoms,'0');assert.equal(paid.queryOnly,true);assert.equal(paid.clientIndependentFinality,false);
 const restarted=await call('restart',ref);origin=restarted.origin;await runtime.close();runtime=await boot();
 const refund=await runtime.entry.invoke({action:'recover-archive',...ref,nativeHash:refundHash});assert.equal(refund.archiveReceipt.principalAtoms,'30');assert.equal(refund.archiveReceipt.netPaidAtoms,'70');
 const reconciled=await runtime.entry.invoke({action:'reconcile-archive',...ref});
 assert.equal(reconciled.reconciliation.receipts.length,2);assert.equal(reconciled.reconciliation.completeKnownOriginals,true);assert.equal(reconciled.reconciliation.paidAtoms,'100');assert.equal(reconciled.reconciliation.refundedAtoms,'30');assert.equal(reconciled.reconciliation.netPaidAtoms,'70');
 assert.equal(reconciled.reconciliation.SourceAdmission,false);assert.equal(reconciled.reconciliation.nativeGrant,false);
 for(const receipt of reconciled.reconciliation.receipts){assert.equal(receipt.proof,undefined);assert.equal(receipt.member,undefined);assert.equal(receipt.sourceOrder,original.sourceOrder);assert.equal(receipt.productId,original.productId);}
 await assert.rejects(runtime.entry.invoke({action:'recover-archive',...ref,nativeHash:'0x'+'f'.repeat(64)}),{code:'NATIVE_PAY_SETTLEMENT_ARCHIVE_UNAVAILABLE',status:409});
 await call('revoke',ref);
 await assert.rejects(runtime.entry.invoke({action:'recover-archive',...ref,nativeHash:refundHash}),{code:'NATIVE_PAY_AUTHORITY_UNAVAILABLE',status:503});
 process.stdout.write(JSON.stringify({type:'done',result:{recovery:true,lostResponseSameOriginalQuery:true,coldNormalHTTPStore:true,merchantReconciliation:reconciled.reconciliation,SourceAdmission:false,signing:false,POST:false}})+'\n');
}finally{await runtime.close();await lines.return();}
