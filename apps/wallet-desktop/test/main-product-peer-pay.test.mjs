import test from 'node:test';
import assert from 'node:assert/strict';
import {createMainProductPeerPayProducer} from '../src/native-pay-client/main-product-peer-pay.mjs';
import {createPrivateNativeInvoiceClient} from '../src/native-pay-client/merchant-invoice-approval.mjs';
import {createPrivateNativeProductPayClient} from '../src/native-pay-client/merchant-invoice-approval.mjs';

// Controlled Main/resource fixtures exercise the actual fixed private client;
// they are deliberately not Auth/Root qualification or a production Source.
const account='0x'+'12'.repeat(20),networkId='34'.repeat(32),merchant='0x'+'56'.repeat(20),invoiceId='invoice-1',intentId='npi_'+'ab'.repeat(24),hash='0x'+'cd'.repeat(32);
const operations=['createInvoiceIntent','lookupInvoiceIntent','merchantTermsReview','readInvoiceIntent','readInvoice','readInvoiceEvents','reviewSettlement','reviewRefund','reconcileInvoiceIntent','reconcileOperation','readOriginalArchiveReceipt','readOriginalArchiveReconciliation','readInvoiceOriginals'];
const original={productId:'shop.order',sourceOrder:'order.one',merchant,recipient:account,genesis:networkId,nativeChainId:'6423',assetId:'YNXT',unitVersion:'1',amountAtoms:'100',domainData:{PUBLIC:true}};
test('Main uses the supplied safe13 client whose own methods exclude every signed Member and packet dispatch',()=>{
 const safe=createPrivateNativeProductPayClient({origin:'https://pay.example.invalid',requestPrivate:()=>{throw Error('TRANSPORT_NOT_EXPECTED');}});
 assert.ok(Object.isFrozen(safe));assert.deepEqual(Object.keys(safe).sort(),operations.toSorted());
 for(const name of ['submitMerchantMember','submitSettlement','submitRefund','submitMerchantMemberPacket','submitSettlementPacket','submitRefundPacket','readInvoicePacket','readInvoiceIntentPacket'])assert.equal(Object.hasOwn(safe,name),false);
});
function fixture({allowed=operations,request,resourceCurrent=()=>{},retire=()=>{},join=async()=>{},close=async()=>{}}={}){
 const calls=[],lifecycle=[];let context={account,networkId,revision:1,locked:false,changing:false,focused:true};
 const scopeDATA={version:1,networkId,account,protectedResourceRef:'pay.resource.one',operations:[...allowed],products:[{productId:'shop.order',sourceOrder:'order.one'}]};
 const resource={protectedResourceRef:'pay.resource.one',networkId,origin:'https://pay.example.invalid',
  async requestPrivate(input){calls.push(input);input.assertCurrent();if(request)return request(input);return packet(input,{merchant,invoiceId,intentId,events:[],intent:{intentId}});},
  current:resourceCurrent,
  retire(){lifecycle.push('retire');return retire();},
  async join(){lifecycle.push('join');return join();},
  async close(){lifecycle.push('close');return close();}};
 const args={scopeDATA,resource,getContext:()=>context};
 return {args,calls,lifecycle,get context(){return context;},set context(value){context=value;},open:()=>createMainProductPeerPayProducer(args)};
}
function packet(input,value,status=200){return{method:input.method,requestPath:input.path,status,contentType:'application/json',body:Buffer.from(JSON.stringify(value))};}
async function dispose(p){p.retire();await p.join();await p.close();p.assertSafeToClose();}

test('actual fixed client emits only the requested finite preparation/read/reconcile routes',async()=>{
 const f=fixture(),p=f.open(),current=()=>{};
 await p.pay.readInvoice(merchant,invoiceId,current);
 await p.pay.readInvoiceEvents(merchant,invoiceId,current);
 await p.pay.readInvoiceIntent(intentId,current);
 await p.pay.merchantTermsReview(intentId,current);
 await p.pay.reviewSettlement(merchant,invoiceId,current);
 await p.pay.reviewRefund(merchant,invoiceId,'refund.one','3',current);
 await p.pay.reconcileInvoiceIntent(intentId,current);
 await p.pay.reconcileOperation(merchant,invoiceId,hash,current);
 assert.deepEqual(f.calls.map(x=>[x.method,x.path]),[
  ['GET',`/v5/pay/invoices/${merchant}/${invoiceId}`],['GET',`/v5/pay/invoices/${merchant}/${invoiceId}/events`],['GET',`/v5/pay/invoice-intents/${intentId}`],['POST',`/v5/pay/invoice-intents/${intentId}/merchant-review`],['POST',`/v5/pay/invoices/${merchant}/${invoiceId}/review`],['POST',`/v5/pay/invoices/${merchant}/${invoiceId}/refund-review`],['POST',`/v5/pay/invoice-intents/${intentId}/reconcile`],['POST',`/v5/pay/invoices/${merchant}/${invoiceId}/operations/${hash}/reconcile`]]);
 assert.equal(Buffer.from(f.calls[5].body).toString(),'{"refundId":"refund.one","amountAtoms":"3"}');
 assert.deepEqual(Object.keys(p.pay),operations.filter(x=>x!=='readInvoiceOriginals'));
 for(const forbidden of ['requestPrivate','submitMerchantMemberPacket','submitSettlementPacket','submitRefundPacket','submitMerchantMember','submitSettlement','submitRefund','approve','sign'])assert.equal(p.pay[forbidden],undefined);
 assert.equal(p.statusDATA().SourceAdmission,false);await dispose(p);assert.deepEqual(f.lifecycle,['retire','join','close']);
});
test('scope, resource, account and network are independent AND checks before transport',async()=>{
 for(const change of [f=>{f.args.resource.protectedResourceRef='other.resource';},f=>{f.args.resource.networkId='aa'.repeat(32);},f=>{f.context={...f.context,account:'0x'+'11'.repeat(20)};},f=>{f.context={...f.context,networkId:'aa'.repeat(32)};},f=>{f.context={...f.context,locked:true};}]){
  const f=fixture();change(f);assert.throws(()=>f.open(),/RESOURCE_NOT_SELECTED|CURRENT_UNAVAILABLE/);assert.equal(f.calls.length,0);assert.deepEqual(f.lifecycle,[]);
 }
 const f=fixture({allowed:['readInvoice']}),p=f.open();await assert.rejects(p.pay.reviewSettlement(merchant,invoiceId,()=>{}),/OPERATION_NOT_ALLOWED/);assert.equal(f.calls.length,0);
 assert.throws(()=>p.pay.readInvoice(merchant,invoiceId),/ARGUMENTS_INVALID/);await assert.rejects(p.pay.readInvoice(merchant,invoiceId,()=>true),/CALLER_CURRENT_RESULT/);assert.equal(f.calls.length,0);await dispose(p);
});
test('scope DATA rejects accessors, proxies, holes, duplicates and signed operations without invoking getters',()=>{
 for(const change of [s=>{s.operations=['submitSettlement'];},s=>{s.operations=['readInvoice','readInvoice'];},s=>{s.operations=new Proxy(['readInvoice'],{});},s=>{s.operations=new Array(1);},s=>{Object.defineProperty(s.operations,'0',{get(){throw Error('GETTER MUST NOT RUN');},enumerable:true});},s=>{s.products=[{productId:'shop.order',sourceOrder:'order.one',actor:'admin'}];}]){
  const f=fixture();change(f.args.scopeDATA);assert.throws(()=>f.open(),/MAIN_PRODUCT_PAY_SCOPE_INVALID/);assert.equal(f.calls.length,0);
 }
});
test('original product allowlist prevents preparation for an unselected retained order',async()=>{
 const f=fixture({request:async input=>{const request=JSON.parse(Buffer.from(input.body));return packet(input,{intentId,originalOperation:intentId,request,merchant,state:'PREPARED',phase:'prepared',terms:{recipient:account,amountAtoms:'100',assetId:'YNXT',unitVersion:'1'}});}}),p=f.open();
 await assert.rejects(p.pay.createInvoiceIntent({...original,sourceOrder:'other.order'},()=>{}),/PRODUCT_NOT_ALLOWED/);
 await assert.rejects(p.pay.createInvoiceIntent({...original,genesis:'ff'.repeat(32)},()=>{}),/NETWORK_CHANGED/);assert.equal(f.calls.length,0);
 await p.pay.createInvoiceIntent(original,()=>{});await p.pay.lookupInvoiceIntent(original,()=>{});assert.deepEqual(f.calls.map(x=>x.path),['/v5/pay/invoice-intents','/v5/pay/invoice-intents/lookup']);assert.deepEqual(f.calls[0].body,f.calls[1].body);await dispose(p);
});
test('archive readers use actual r6 fixed GETs, while an older client explicitly refuses the missing methods',async()=>{
 const f=fixture(),p=f.open(),ref={productId:'shop.order',sourceOrder:'order.one',merchant,invoiceId},probe=createPrivateNativeInvoiceClient({origin:f.args.resource.origin,requestPrivate:async()=>{throw Error('NOT CALLED');}});
 if(typeof probe.readOriginalArchiveReceipt!=='function'){
  await assert.rejects(p.pay.readOriginalArchiveReceipt({...ref,nativeHash:hash},()=>{}),/CLIENT_METHOD_NOT_SUPPLIED/);await assert.rejects(p.pay.readOriginalArchiveReconciliation(ref,()=>{}),/CLIENT_METHOD_NOT_SUPPLIED/);assert.equal(f.calls.length,0);
 }else{
  await assert.rejects(p.pay.readOriginalArchiveReceipt({...ref,sourceOrder:'other.order',nativeHash:hash},()=>{}),/PRODUCT_NOT_ALLOWED/);assert.equal(f.calls.length,0);
  await p.pay.readOriginalArchiveReceipt({...ref,nativeHash:hash},()=>{});await p.pay.readOriginalArchiveReconciliation(ref,()=>{});
  assert.deepEqual(f.calls.map(x=>[x.method,x.path,x.body]),[['GET',`/v5/pay/products/shop.order/order.one/invoices/${merchant}/${invoiceId}/originals/${hash}/receipt`,undefined],['GET',`/v5/pay/products/shop.order/order.one/invoices/${merchant}/${invoiceId}/archive-reconciliation`,undefined]]);
 }await dispose(p);
});
test('the original caller abort signal cancels the same in-flight private request',async()=>{
 let release,started;const reached=new Promise(resolve=>{started=resolve;});
 const f=fixture({request:input=>new Promise(resolve=>{release=()=>resolve(packet(input,{merchant,invoiceId}));started();})}),p=f.open(),caller=new AbortController(),current=()=>{};Object.defineProperty(current,'signal',{value:caller.signal});
 const task=p.pay.readInvoice(merchant,invoiceId,current);await reached;caller.abort();assert.equal(f.calls[0].assertCurrent.signal.aborted,true);release();await assert.rejects(task,/REQUEST_CANCELLED/);assert.equal(f.calls.length,1);await dispose(p);
});
test('lock/revision change during a real call rejects its late result and never repeats the request',async()=>{
 let release,started;const reached=new Promise(resolve=>{started=resolve;});
 const f=fixture({request:input=>new Promise(resolve=>{release=()=>resolve(packet(input,{merchant,invoiceId}));started();})}),p=f.open();
 const task=p.pay.readInvoice(merchant,invoiceId,()=>{});await reached;f.context={...f.context,revision:2,locked:true};release();await assert.rejects(task,/CURRENT_UNAVAILABLE/);
 assert.equal(f.calls.length,1);assert.equal(p.statusDATA().currentFailed,true);assert.equal(p.statusDATA().operationErrorPresent,true);await assert.rejects(p.pay.readInvoice(merchant,invoiceId,()=>{}),/CURRENT_UNAVAILABLE/);assert.equal(f.calls.length,1);await dispose(p);
});
test('retire aborts the same request signal, then join drains before close exactly once',async()=>{
 let release,started;const reached=new Promise(resolve=>{started=resolve;});
 const f=fixture({request:input=>new Promise(resolve=>{release=()=>resolve(packet(input,{merchant,invoiceId}));started();})}),p=f.open();
 assert.throws(()=>p.join(),/RETIRE_REQUIRED/);const task=p.pay.readInvoice(merchant,invoiceId,()=>{});await reached;
 p.retire();assert.equal(f.calls[0].assertCurrent.signal.aborted,true);const joining=p.join();assert.throws(()=>p.close(),/CHILDREN_RETAINED/);assert.deepEqual(f.lifecycle,['retire']);
 release();await assert.rejects(task,/RETIRED/);await joining;await p.close();await p.close();p.retire();p.assertSafeToClose();assert.deepEqual(f.lifecycle,['retire','join','close']);
});
test('transport/cleanup falsy causes retain presence and failed close is never retried',async()=>{
 const f=fixture({request:async()=>{throw false;},close:async()=>{throw null;}}),p=f.open();
 await assert.rejects(p.pay.readInvoice(merchant,invoiceId,()=>{}),e=>e===false);assert.equal(p.statusDATA().operationErrorPresent,true);assert.equal(p.statusDATA().operationError,false);assert.equal(f.calls.length,1);
 p.retire();await p.join();const first=p.close();await assert.rejects(first,e=>e===null);assert.equal(p.close(),first);await assert.rejects(p.close(),e=>e===null);assert.equal(p.statusDATA().cleanupErrorPresent,true);assert.equal(p.statusDATA().cleanupError,null);assert.throws(()=>p.assertSafeToClose(),/CLOSE_UNCONFIRMED/);assert.deepEqual(f.lifecycle,['retire','join','close']);
});
test('reentrant original lifecycle ports observe one reserved join/close promise',async()=>{
 let p,reenteredJoin,reenteredClose;
 const f=fixture({join:()=>{reenteredJoin=p.join();},close:()=>{reenteredClose=p.close();}});p=f.open();p.retire();const joining=p.join();await joining;assert.equal(reenteredJoin,joining);const closing=p.close();await closing;assert.equal(reenteredClose,closing);assert.deepEqual(f.lifecycle,['retire','join','close']);p.assertSafeToClose();
});
test('failed original join retains the same falsy cause and never invokes close or retries',async()=>{
 const f=fixture({join:async()=>{throw false;}}),p=f.open();p.retire();const joined=p.join();await assert.rejects(joined,e=>e===false);assert.equal(p.join(),joined);await assert.rejects(p.join(),e=>e===false);assert.throws(()=>p.close(),/CHILDREN_RETAINED/);assert.deepEqual(f.lifecycle,['retire','join']);assert.equal(p.statusDATA().cleanupErrorPresent,true);assert.equal(p.statusDATA().cleanupError,false);
});
test('the actual client preserves precise private-service failure, without transport fallback',async()=>{
 const f=fixture({request:async input=>packet(input,{code:'NATIVE_PRODUCT_SOURCE_REVOKED'},503)}),p=f.open();
 await assert.rejects(p.pay.readInvoice(merchant,invoiceId,()=>{}),e=>e.code==='NATIVE_PRODUCT_SOURCE_REVOKED'&&e.status===503);assert.equal(f.calls.length,1);await dispose(p);
});
