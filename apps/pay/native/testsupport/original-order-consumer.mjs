// Original Main product wrapper + normal private Go HTTP handler, reopened
// retained PUBLIC Store. This fixture supplies no genuine Source or signer.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createNativePayMainEntry} from '../r6/main-entry.mjs';
import {composeNativePayProductSource} from '../r6/product-source.mjs';
import {createPrivateNativeProductPayClient} from '../r6/merchant-invoice-approval.mjs';

const input=JSON.parse(fs.readFileSync(0,'utf8')),{original,scenario,origin}=input;
const wrapper=process.env.PAY_MAIN_PRODUCT_MODULE;
assert.equal(createHash('sha256').update(fs.readFileSync(wrapper)).digest('hex'),process.env.PAY_MAIN_PRODUCT_SHA256);
const {createWalletNativePayProduct}=await import(pathToFileURL(wrapper).href);
let lose=scenario==='lost-lookup',sourceReads=0;const calls=[];
const pay=createPrivateNativeProductPayClient({origin,async requestPrivate(r){
 r.assertCurrent();assert.ok(r.method==='GET'||r.method==='POST'&&r.path==='/v5/pay/invoice-intents/lookup');
 calls.push({method:r.method,path:r.path});
 if(r.body)assert.deepEqual(JSON.parse(Buffer.from(r.body)),original);
 const response=await fetch(r.origin+r.path,{method:r.method,body:r.body,headers:r.body?{'Content-Type':'application/json'}:{},redirect:'manual'}),body=new Uint8Array(await response.arrayBuffer());
 if(lose){lose=false;assert.equal(response.status,200);throw Object.assign(Error('PUBLIC original lookup reply lost'),{code:'PUBLIC_ORIGINAL_LOOKUP_LOST'});}
 return {method:r.method,requestPath:r.path,status:response.status,contentType:response.headers.get('content-type'),body};
}});
const main={pendingRequests:()=>[]},entry=createNativePayMainEntry({getMain:()=>null,getContext:()=>({account:original.merchant,revision:1,focused:true})});
const loan={pay,current(){},retire(){},async join(){},async close(){},readOriginalShopNativeInvoiceRequestDATA(order,current){current();assert.equal(order,original.sourceOrder);sourceReads++;return original;}};
const source=await composeNativePayProductSource(entry,{acquireOriginalProductSource:async()=>loan,isOriginalProductSource:v=>v===loan});
const service=createWalletNativePayProduct({entry:{...entry,invoke:entry.invokeResult},getMain:()=>main,getGuard:()=>({account:original.merchant,assert(){}}),publishReview(){throw Error('Historical reads must not request approval');}});
const ref={productId:original.productId,sourceOrder:original.sourceOrder};
try{
 if(scenario==='lost-lookup'){
  const r=await service.invoke({action:'order-pay-review',...ref});assert.equal(r.ok,false);assert.equal(r.code,'PUBLIC_ORIGINAL_LOOKUP_LOST');assert.equal(r.canRetry,false);assert.equal(r.outcome,'UNKNOWN');
  assert.deepEqual(r.recoveryActions,[{action:'lookup-intent',...ref}]);assert.equal(calls.length,1);
 }else if(scenario==='cold-receipts'){
  const bill=await service.invoke({action:'order-invoice',...ref});assert.equal(bill.ok,true,JSON.stringify(bill));assert.equal(bill.intent.intentId,input.intentId);assert.equal(bill.bill.invoiceId,input.invoiceId);assert.equal(bill.bill.sessionId,input.sessionId);assert.equal(bill.bill.paidAtoms,'100');assert.equal(bill.bill.refundedAtoms,'30');
  const paid=await service.invoke({action:'order-receipt',...ref,nativeHash:input.settlementHash});assert.equal(paid.ok,true,JSON.stringify(paid));assert.equal(paid.archiveReceipt.paidAtoms,'100');assert.equal(paid.archiveReceipt.refundedAtoms,'0');assert.equal(paid.archiveReceipt.sessionId,input.sessionId);
  const refund=await service.invoke({action:'order-receipt',...ref,nativeHash:input.refundHash});assert.equal(refund.ok,true,JSON.stringify(refund));assert.equal(refund.archiveReceipt.principalAtoms,'30');assert.equal(refund.archiveReceipt.netPaidAtoms,'70');assert.equal(refund.archiveReceipt.settlementNativeHash,input.settlementHash);
  const reconciled=await service.invoke({action:'order-reconcile',...ref});assert.equal(reconciled.ok,true,JSON.stringify(reconciled));assert.equal(reconciled.reconciliation.receipts.length,2);assert.equal(reconciled.reconciliation.completeKnownOriginals,true);assert.equal(reconciled.reconciliation.netPaidAtoms,'70');
  for(const r of [bill,paid,refund,reconciled]){assert.equal(r.queryOnly,true);assert.equal(r.canRetry,false);assert.equal(r.clientIndependentFinality,false);assert.doesNotMatch(JSON.stringify(r),/termsMember|termsEnvelope|signingMessage|domainData/);}
  assert.equal(sourceReads,4);
 }else{
  const r=await service.invoke({action:'order-invoice',...ref});assert.equal(r.ok,false);assert.equal(r.code,'NATIVE_PAY_AUTHORITY_UNAVAILABLE');assert.equal(r.httpStatus,503);assert.equal(r.canRetry,false);assert.equal(calls.length,1);
 }
 service.assertSafeToClose();
 console.log(JSON.stringify({scenario,originalOrder:original.sourceOrder,intentId:input.intentId,normalMainWrapper:true,sourceReads,calls,signing:0,effectPOST:0,SourceAdmission:false}));
}finally{source.retire();await source.join();await source.close();source.assertSafeToClose();}
