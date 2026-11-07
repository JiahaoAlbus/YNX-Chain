// Actual normal Main wrapper and ProductSource consumer. The Go service owns
// persistent original operations and independent Core proofs. PUBLIC controls
// below are not genuine merchant authority or Wallet approval.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createNativePayMainEntry} from '../r6/main-entry.mjs';
import {composeNativePayProductSource} from '../r6/product-source.mjs';
import {createPrivateNativeProductPayClient} from '../r6/merchant-invoice-approval.mjs';

const input=JSON.parse(fs.readFileSync(0,'utf8')),{original,nativeHash,kind,mode,origin}=input;
const wrapper=process.env.PAY_MAIN_PRODUCT_MODULE;
assert.equal(createHash('sha256').update(fs.readFileSync(wrapper)).digest('hex'),process.env.PAY_MAIN_PRODUCT_SHA256);
const {createWalletNativePayProduct}=await import(pathToFileURL(wrapper).href);
const calls=[];let sourceReads=0,retired=0,joined=0,closed=0;
const invoicePath='/v5/pay/invoices/'+original.merchant+'/'+input.invoiceId;
const pay=createPrivateNativeProductPayClient({origin,async requestPrivate(r){
 r.assertCurrent();
 assert.ok(r.method==='GET'||r.method==='POST'&&(r.path==='/v5/pay/invoice-intents/lookup'||r.path===invoicePath+'/operations/'+nativeHash+'/reconcile'));
 if(r.body)assert.deepEqual(JSON.parse(Buffer.from(r.body)),r.path.endsWith('/lookup')?original:{});
 calls.push({method:r.method,path:r.path});
 const response=await fetch(r.origin+r.path,{method:r.method,body:r.body,headers:r.body?{'Content-Type':'application/json'}:{},redirect:'manual',signal:r.signal});
 return {method:r.method,requestPath:r.path,status:response.status,contentType:response.headers.get('content-type'),cacheControl:response.headers.get('cache-control'),body:new Uint8Array(await response.arrayBuffer())};
}});
const forbidden=()=>{throw Error('Recovery touched original Main approval/journal');};
const main={pendingRequests:()=>[],requestPQTypedAction:forbidden,requestPQPayBroadcast:forbidden,reject:forbidden};
// A recovery consumer has no signing Main Source. The normal outer wrapper
// still owns pending reviews, while the private ProductSource owns these reads.
const entry=createNativePayMainEntry({getMain:()=>null,getContext:()=>({account:original.merchant,revision:1,focused:true})});
const loan={pay,current(){},retire(){retired++;},async join(){joined++;},async close(){closed++;},readOriginalShopNativeInvoiceRequestDATA(order,current){current();assert.equal(order,original.sourceOrder);sourceReads++;return original;}};
const source=await composeNativePayProductSource(entry,{acquireOriginalProductSource:async()=>loan,isOriginalProductSource:v=>v===loan});
const service=createWalletNativePayProduct({entry:{...entry,invoke:entry.invokeResult},getMain:()=>main,getGuard:()=>({account:original.merchant,assert(){}}),publishReview:forbidden});
const ref={productId:original.productId,sourceOrder:original.sourceOrder};
try{
 if(mode==='revoked'){
  const denied=await service.invoke({action:'order-reconcile-operation',...ref,nativeHash});
  assert.equal(denied.ok,false);assert.equal(denied.httpStatus,503);assert.equal(calls.length,1);assert.equal(denied.canRetry,false);
 }else if(mode==='readonly'){
  const result=await service.invoke({action:'order-receipt',...ref,nativeHash});
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.archiveReceipt.nativeHash,nativeHash);assert.equal(result.archiveReceipt.netPaidAtoms,'70');
  const all=await service.invoke({action:'order-reconcile',...ref});assert.equal(all.ok,true,JSON.stringify(all));assert.equal(all.reconciliation.receipts.length,2);assert.equal(all.reconciliation.completeKnownOriginals,true);assert.equal(all.reconciliation.netPaidAtoms,'70');
  assert.equal(calls.filter(c=>c.path.endsWith('/reconcile')).length,0);
 }else{
  const result=await service.invoke({action:'order-reconcile-operation',...ref,nativeHash});
  if(mode==='lost'){
   assert.equal(result.ok,false);assert.equal(result.outcome,'UNKNOWN');assert.equal(result.canRetry,false);assert.equal(result.reference.nativeHash,nativeHash);
   assert.deepEqual(result.recoveryActions,[{action:'recover-archive',...ref,merchant:original.merchant,invoiceId:input.invoiceId,nativeHash}]);
   const recovered=await service.invoke(result.recoveryActions[0]);assert.equal(recovered.ok,true,JSON.stringify(recovered));assert.equal(recovered.archiveReceipt.nativeHash,nativeHash);assert.equal(recovered.archiveReceipt.netPaidAtoms,'100');
  }else{
   assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.reconciledOriginal.nativeHash,nativeHash);assert.equal(result.reconciledOriginal.kind,kind);assert.equal(result.reconciledOriginal.status,'confirmed');assert.equal(result.queryOnly,true);assert.equal(result.canRetry,false);assert.equal(result.clientIndependentFinality,false);
   if(kind==='invoice_refund'){assert.equal(result.archiveReceipt.netPaidAtoms,'70');assert.equal(result.archiveReceipt.refundedAtoms,'30');}
   else assert.equal(result.archiveReceipt,undefined);
  }
  assert.equal(calls.filter(c=>c.path.endsWith('/reconcile')).length,1);
 }
 service.assertSafeToClose();
}finally{source.retire();await source.join();await source.close();source.assertSafeToClose();}
assert.deepEqual([retired,joined,closed],[1,1,1]);
console.log(JSON.stringify({mode,kind,nativeHash,originalOrder:original.sourceOrder,normalMainWrapper:true,sourceReads,calls,cleanup:{retired,joined,closed},signing:0,memberPOST:0,SourceAdmission:false}));
