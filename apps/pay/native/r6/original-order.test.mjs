import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativePayMainEntry} from './main-entry.mjs';
import {createPrivateNativeProductPayClient} from './merchant-invoice-approval.mjs';

const merchant='0x'+'1'.repeat(40),payer='0x'+'2'.repeat(40),intentId='npi_'+'3'.repeat(48),termsHash='0x'+'4'.repeat(64);
const original={productId:'shop.order',storeId:'store-original',sourceOrder:'order:original',merchant,recipient:merchant,genesis:'a'.repeat(64),nativeChainId:'6423',assetId:'YNXT',unitVersion:'1',amountAtoms:'100',domainData:{schema:'ynx.shop.order.invoice/v1',order:{ID:'order:original'},approvedNativePrice:{PriceApprovalRef:'PUBLIC-original-price'}}};
const ref={productId:original.productId,sourceOrder:original.sourceOrder};
const terms={invoiceId:'invoice-original',sessionId:'session-original',recipient:merchant,payer,assetId:'YNXT',unitVersion:'1',feeRule:'native-transfer-fee-one/v1',keyEpoch:'1',revision:'1',amountAtoms:'100',maxFeeAtoms:'1',expiresAtHeight:'100'};
const view=()=>({intentId,originalOperation:intentId,request:structuredClone(original),merchant,state:'ISSUED',phase:'confirmed',signingMessageHash:'b'.repeat(64),termsNativeHash:termsHash,termsAbciHash:'0x'+'5'.repeat(64),terms:{...terms},invoice:{}});
const bill=()=>({genesis:original.genesis,nativeChainId:'6423',merchant,invoiceId:terms.invoiceId,sessionId:terms.sessionId,sourceOrder:original.sourceOrder,assetId:'YNXT',unitVersion:'1',principalAtoms:'100',paidAtoms:'0',refundedAtoms:'0',netPaidAtoms:'0',feeRule:terms.feeRule,maxFeeAtoms:'1',expiresAtHeight:'100',termsNativeHash:termsHash,termsHash:'b'.repeat(64),status:'terms_registered',refundStatus:'none',operations:{}});
function boot({lookup=view,read=bill,main=null,change=()=>{},originalRead=()=>structuredClone(original),review=()=>({intent:view()}),extra={}}={}){
 const calls=[];let live=true;
 const current=()=>{if(!live)throw Object.assign(Error(),{code:'ORIGINAL_SOURCE_RETIRED'});};
 const pay=createPrivateNativeProductPayClient({origin:'https://pay.original.test',async requestPrivate(request){
  request.assertCurrent();calls.push({method:request.method,path:request.path,body:request.body});let result;
  if(request.path==='/v5/pay/invoice-intents/lookup'){result=await lookup();change('lookup');}
  else if(request.method==='GET'&&request.path===`/v5/pay/invoices/${merchant}/${terms.invoiceId}`){result=await read();change('invoice');}
  else if(request.path===`/v5/pay/invoice-intents/${intentId}/merchant-review`||request.path===`/v5/pay/invoice-intents/${intentId}`){result=await review();}
  else throw Object.assign(Error(),{code:'PUBLIC_UNEXPECTED_CALL'});
  return {method:request.method,requestPath:request.path,status:200,contentType:'application/json',body:Buffer.from(JSON.stringify(result))};
 }});
 const entry=createNativePayMainEntry({getMain:()=>main,getContext:()=>({account:merchant,revision:1,focused:true})});
 entry.compose({pay,current,async readOriginalInvoiceIntent(selected,fence){fence();assert.deepEqual(selected,ref);calls.push({sourceRead:selected});return originalRead();},...extra});
 return{entry,calls,revoke:()=>{live=false;}};
}
test('original-order invoice derives merchant/invoice once from the frozen original lookup',async()=>{
 const {entry,calls}=boot();const r=await entry.invokeResult({action:'order-invoice',...ref});
 assert.equal(r.ok,true);assert.equal(r.queryOnly,true);assert.equal(r.bill.sourceOrder,original.sourceOrder);
 assert.deepEqual(r.reference,{...ref,merchant,invoiceId:terms.invoiceId,intentId});assert.equal(r.intent.originalOperation,intentId);
 assert.equal(calls.length,3);assert.equal(calls[0].sourceRead.sourceOrder,ref.sourceOrder);assert.equal(calls[1].path,'/v5/pay/invoice-intents/lookup');assert.equal(calls[2].path,`/v5/pay/invoices/${merchant}/${terms.invoiceId}`);
 assert.deepEqual(JSON.parse(Buffer.from(calls[1].body)),original);assert.equal(r.canRetry,false);assert.equal(r.clientIndependentFinality,false);
});
test('original open-payer terms retain the service wildcard without selecting a payer',async()=>{
 const f=boot({lookup:()=>({...view(),terms:{...terms,payer:''}})});
 const r=await f.entry.invokeResult({action:'order-invoice',...ref});assert.equal(r.ok,true);assert.equal(r.approvalRequired,false);assert.equal(f.calls.length,3);
});
test('order operations reject renderer merchant/invoice overrides before any original read',async()=>{
 const {entry,calls}=boot();for(const override of [{merchant},{invoiceId:'other'},{amountAtoms:'1'},{grant:{approved:true}}]){
  const r=await entry.invokeResult({action:'order-invoice',...ref,...override});assert.equal(r.code,'NATIVE_PAY_MAIN_INPUT_INVALID');
 }assert.equal(calls.length,0);
});
test('original lookup drift refuses before invoice read or Main review',async()=>{
 for(const mutate of [v=>v.request.storeId='other-store',v=>v.request.sourceOrder='other-order',v=>v.request.amountAtoms='99',v=>v.originalOperation='npi_'+'9'.repeat(48),v=>v.terms.invoiceId='../foreign',v=>v.terms.sessionId='foreign/session',v=>v.terms.maxFeeAtoms='2']){
  const {entry,calls}=boot({lookup:()=>{const v=view();mutate(v);return v;}});const r=await entry.invokeResult({action:'order-invoice',...ref});assert.equal(r.ok,false);assert.equal(calls.length,2);assert.equal(r.reference.sourceOrder,ref.sourceOrder);
 }
});
test('invoice read is bound to original order, session, network, terms and amount',async()=>{
 for(const mutate of [v=>v.sourceOrder='other-order',v=>v.sessionId='other-session',v=>v.genesis='c'.repeat(64),v=>v.nativeChainId='6424',v=>v.principalAtoms='101',v=>v.termsNativeHash='0x'+'f'.repeat(64),v=>v.termsHash='c'.repeat(64),v=>v.maxFeeAtoms='2']){
  const {entry}=boot({read:()=>{const v=bill();mutate(v);return v;}});const r=await entry.invokeResult({action:'order-invoice',...ref});assert.equal(r.ok,false);assert.equal(r.code,'NATIVE_PAY_ORIGINAL_ORDER_BINDING');assert.equal(r.bill,undefined);
 }
});
test('lost original lookup offers read-only same-order recovery and never creates or retries',async()=>{
 let lookups=0;const first=boot({lookup(){lookups++;throw Object.assign(Error(),{code:'PUBLIC_LOOKUP_LOST'});}});
 const result=await first.entry.invokeResult({action:'order-pay-review',...ref});assert.equal(result.ok,false);assert.equal(lookups,1);assert.equal(first.calls.length,2);
 assert.deepEqual(result.recoveryActions,[{action:'lookup-intent',...ref}]);assert.equal(result.canRetry,false);
 const cold=boot();const recovered=await cold.entry.invokeResult(result.recoveryActions[0]);assert.equal(recovered.ok,true);assert.equal(recovered.intent.originalOperation,intentId);assert.equal(cold.calls.length,2);
});
test('retirement during lookup never reads bill, requests review or exposes stale original reference',async()=>{
 let resolve;const f=boot({lookup:()=>new Promise(yes=>resolve=yes)});const pending=f.entry.invokeResult({action:'order-invoice',...ref});
 for(let i=0;i<100&&!resolve;i++)await new Promise(yes=>setImmediate(yes));assert.equal(typeof resolve,'function');f.revoke();resolve(view());const r=await pending;assert.equal(r.ok,false);assert.equal(r.reference,null);assert.equal(f.calls.length,2);
});
test('PREPARED and UNKNOWN stay query-only; they cannot enter payer or refund review',async()=>{
 for(const action of ['order-pay-review','order-refund-review','order-terms-review']){
  const f=boot({lookup:()=>({...view(),state:'PREPARED',phase:'unknown'})});const r=await f.entry.invokeResult({action,...ref,...(action==='order-refund-review'?{refundId:'refund-original',amountAtoms:'30'}:{})});
  assert.equal(r.ok,false);assert.equal(r.code,'NATIVE_PAY_ORIGINAL_RECONCILE_REQUIRED');assert.equal(f.calls.length,2);assert.equal(r.canRetry,false);
 }
 const f=boot({lookup:()=>({...view(),state:'PREPARED',phase:'awaiting_merchant_approval'})});const r=await f.entry.invokeResult({action:'order-invoice',...ref});assert.equal(r.ok,true);assert.equal(r.bill,undefined);assert.equal(r.queryOnly,true);assert.equal(f.calls.length,2);
});

function noSigningMain(){
 let touched=0;
 const refuse=()=>{touched++;throw Error('No Main review or journal access expected');};
 return {main:{requestPQTypedAction:refuse,requestPQPayBroadcast:refuse,reject:refuse,vault:{status:refuse},transactionSender:{submissions:{intentStore:{readPQOriginals:refuse,unresolvedPreparation:refuse}}}},touched:()=>touched};
}
test('payment, refund and retained broadcast recheck original bill before any Main/journal access',async()=>{
 for(const action of ['order-pay-review','order-refund-review','order-broadcast-review']){
  const m=noSigningMain(),f=boot({main:m.main,read:()=>({...bill(),sessionId:'foreign-session'})});
  const r=await f.entry.invokeResult({action,...ref,...(action==='order-refund-review'?{refundId:'refund-original',amountAtoms:'30'}:{}),...(action==='order-broadcast-review'?{kind:'invoice_refund',originalHash:'0x'+'8'.repeat(64)}:{})});
  assert.equal(r.code,'NATIVE_PAY_ORIGINAL_ORDER_BINDING');assert.equal(m.touched(),0);assert.equal(f.calls.length,3);assert.equal(r.canRetry,false);
 }
});
test('merchant review or original-Member read cannot splice a changed lookup generation',async()=>{
 for(const action of ['order-terms-review','order-broadcast-review'])for(const change of [v=>v.terms.sessionId='other-session',v=>v.signingMessageHash='c'.repeat(64),v=>{v.state='ISSUED';v.phase='confirmed';}]){
  const m=noSigningMain(),prepared=()=>({...view(),state:'PREPARED',phase:'awaiting_merchant_approval'});
  const f=boot({main:m.main,lookup:prepared,review:()=>{const v=prepared();change(v);return action==='order-terms-review'?{intent:v}:v;}});
  const r=await f.entry.invokeResult({action,...ref,...(action==='order-broadcast-review'?{kind:'invoice_terms',originalHash:'0x'+'8'.repeat(64)}:{})});
  assert.equal(r.code,'NATIVE_PAY_ORIGINAL_ORDER_BINDING');assert.equal(m.touched(),0);assert.equal(f.calls.length,3);
 }
});
const nativeHash='0x'+'6'.repeat(64);
function receipt(){return {version:'ynx.pay.native.archive-receipt/v1',...ref,storeId:original.storeId,merchant,invoiceId:terms.invoiceId,genesis:original.genesis,nativeChainId:original.nativeChainId,principalAtoms:'100',paidAtoms:'100',refundedAtoms:'0',netPaidAtoms:'100',proofVerification:'original-independent-core-verifier',dataOnly:true,queryOnly:true,canRetry:false,SourceAdmission:false,nativeGrant:false,sessionId:terms.sessionId,nativeHash,abciHash:'0x'+'7'.repeat(64),kind:'invoice_settle',status:'confirmed',archiveDigest:'8'.repeat(64),termsHash:'b'.repeat(64),eventClaim:'9'.repeat(64),executionHeight:'10'};}
function reconciliation(row=receipt()){const {sessionId,nativeHash,abciHash,kind,status,archiveDigest,termsHash,eventClaim,executionHeight,...common}=row;return {...common,version:'ynx.pay.native.archive-reconciliation/v1',receipts:[row],pendingOriginals:[],completeKnownOriginals:true};}
test('order receipt and reconciliation use derived reference and reject another session or terms hash',async()=>{
 for(const action of ['order-receipt','order-reconcile'])for(const mutate of [()=>{},v=>v.sessionId='foreign-session',v=>v.termsHash='c'.repeat(64)]){
  let reads=0;const value=receipt();mutate(value);
  const read=async(selected,current)=>{current();reads++;assert.deepEqual(selected,{...ref,merchant,invoiceId:terms.invoiceId,...(action==='order-receipt'?{nativeHash}:{})});return action==='order-receipt'?value:reconciliation(value);};
  const f=boot({extra:{readOriginalArchiveReceipt:read,readOriginalArchiveReconciliation:read}}),r=await f.entry.invokeResult({action,...ref,...(action==='order-receipt'?{nativeHash}:{})});
  assert.equal(reads,1);assert.equal(f.calls.length,2);
  if(value.sessionId===terms.sessionId&&value.termsHash==='b'.repeat(64)){assert.equal(r.ok,true);assert.equal(r.queryOnly,true);assert.equal(r.clientIndependentFinality,false);}
  else {assert.equal(r.code,'NATIVE_PAY_ORIGINAL_ORDER_BINDING');assert.equal(r.archiveReceipt,undefined);assert.equal(r.reconciliation,undefined);}
 }
});
test('late retirement during receipt read drains the original read without publishing receipt',async()=>{
 let release;const f=boot({extra:{readOriginalArchiveReceipt:()=>new Promise(resolve=>release=resolve)}});
 const pending=f.entry.invokeResult({action:'order-receipt',...ref,nativeHash});
 for(let i=0;i<100&&!release;i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(typeof release,'function');
 f.revoke();release(receipt());const r=await pending;assert.equal(r.ok,false);assert.equal(r.reference,null);assert.equal(r.archiveReceipt,undefined);assert.equal(f.calls.length,2);
});
