import test from 'node:test';
import assert from 'node:assert/strict';
import {createOriginalShopPayNavigation,createOriginalShopPayNavigationFromMainIPC} from './pay-intent-navigation.mjs';
const operation='npi_'+'ab'.repeat(24);
test('PUBLIC Main port contract: only original typed intent/read recovery, never approval or send',async()=>{
 const calls=[];let available=true;
 const entry={status(){return {available,normalMainEntry:true,paymentAuthorized:false}},async invoke(request){calls.push(request);return {reference:{intentId:operation},intent:{intentId:operation,originalOperation:operation,state:'PREPARED'},clientIndependentFinality:false}}};
 const nav=createOriginalShopPayNavigation({entry,current(){}});
 assert.equal((await nav.openOriginalIntent(operation)).originalOperation,operation);
 assert.equal((await nav.recoverOriginalIntent(operation)).queryOnly,true);
 assert.deepEqual(calls,[{action:'intent',intentId:operation},{action:'intent',intentId:operation}]);
 available=false;await assert.rejects(nav.openOriginalIntent(operation),{code:'SHOP_NATIVE_PAY_MAIN_UNAVAILABLE'});assert.equal(calls.length,2);
 await assert.rejects(nav.openOriginalIntent({url:'fake',capsule:{approve:true}}),{code:'SHOP_NATIVE_PAY_ORIGINAL_REQUIRED'});
});
test('missing actual Main Source retains its first cause without invoking Main',async()=>{
 let invoked=0;
 const nav=createOriginalShopPayNavigation({entry:{status(){return {available:false,normalMainEntry:true,paymentAuthorized:false,reason:'NATIVE_PAY_MAIN_SOURCE_UNAVAILABLE'}},invoke(){invoked++;}},current(){}});
 for(const action of ['openOriginalIntent','recoverOriginalIntent']){
  await assert.rejects(nav[action](operation),error=>error.code==='SHOP_NATIVE_PAY_MAIN_UNAVAILABLE'&&error.cause?.code==='NATIVE_PAY_MAIN_SOURCE_UNAVAILABLE');
 }
 assert.equal(invoked,0);
});
test('context revoked during status lookup cannot dispatch the original read',async()=>{
 let revoked=false,invoked=0;
 const nav=createOriginalShopPayNavigation({entry:{async status(){revoked=true;return {available:true,normalMainEntry:true,paymentAuthorized:false}},invoke(){invoked++;}},current(){if(revoked)throw Error('PUBLIC original context revoked')}});
 await assert.rejects(nav.recoverOriginalIntent(operation),/PUBLIC original context revoked/);
 assert.equal(invoked,0);
});
test('late account/Source change or rebound original cannot become navigation success',async()=>{
 let locked=false;
 const entry={status(){return {available:true,normalMainEntry:true,paymentAuthorized:false}},async invoke(){locked=true;return {reference:{intentId:operation},intent:{intentId:operation,originalOperation:operation,state:'ISSUED'},clientIndependentFinality:false}}};
 const nav=createOriginalShopPayNavigation({entry,current(){if(locked)throw Error('PUBLIC original context changed')}});
 await assert.rejects(nav.openOriginalIntent(operation),/PUBLIC original context changed/);
 const wrong=createOriginalShopPayNavigation({entry:{...entry,async invoke(){return {reference:{intentId:'foreign'}}}},current(){}});
 await assert.rejects(wrong.openOriginalIntent(operation),{code:'SHOP_NATIVE_PAY_ORIGINAL_CHANGED'});
});
const sourceOrder='order_original',merchant='0x'+'1'.repeat(40),invoiceId='invoice_original';
function originalEntry(overrides={}){
 const calls=[];
 const entry={status(){return {available:true,normalMainEntry:true,paymentAuthorized:false}},async invoke(request){calls.push({...request});return {reference:{productId:'shop.order',sourceOrder,merchant,invoiceId,intentId:operation,...(request.refundId?{refundId:request.refundId}:{})},intent:{intentId:operation,originalOperation:operation,state:'ISSUED'},queryOnly:request.action==='order-invoice',approvalRequired:request.action!=='order-invoice',clientIndependentFinality:false,canRetry:false,...(request.action==='order-invoice'?{bill:{sourceOrder,merchant,invoiceId}}:{walletRequest:{id:'original-review',method:'ynx_signPQNativeAction',approvalRequired:true}})}},...overrides};
 return {calls,entry,nav:createOriginalShopPayNavigation({entry,current(){}})};
}
test('original order navigation and cold UNKNOWN recovery select read-only order-invoice with no invoice/merchant/amount override',async()=>{
 const f=originalEntry();const first=await f.nav.openOriginalOrder(sourceOrder),cold=await f.nav.recoverOriginalOrder(sourceOrder);
 assert.equal(first.originalOperation,operation);assert.equal(cold.queryOnly,true);assert.equal(cold.paymentAuthorized,false);
 assert.deepEqual(f.calls,[{action:'order-invoice',productId:'shop.order',sourceOrder},{action:'order-invoice',productId:'shop.order',sourceOrder}]);
 for(const input of [{sourceOrder,merchant},'../other','order?amount=1','',null])await assert.rejects(f.nav.openOriginalOrder(input),{code:'SHOP_NATIVE_PAY_ORDER_REQUIRED'});
 assert.equal(f.calls.length,2);
});
test('explicit terms/payment/refund each opens only its original Main review once and never reports payment authorization',async()=>{
 const f=originalEntry();
 for(const result of [await f.nav.reviewOriginalOrderTerms(sourceOrder),await f.nav.reviewOriginalOrderPayment(sourceOrder),await f.nav.reviewOriginalOrderRefund(sourceOrder,'refund_retained','18446744073709551615')]){assert.equal(result.reviewPending,true);assert.equal(result.paymentAuthorized,false);assert.equal(result.clientIndependentFinality,false);assert.equal(result.reviewID,'original-review');}
 assert.deepEqual(f.calls,[{action:'order-terms-review',productId:'shop.order',sourceOrder},{action:'order-pay-review',productId:'shop.order',sourceOrder},{action:'order-refund-review',productId:'shop.order',sourceOrder,refundId:'refund_retained',amountAtoms:'18446744073709551615'}]);
 for(const amount of ['0','01','1.5',1,'18446744073709551616'])await assert.rejects(f.nav.reviewOriginalOrderRefund(sourceOrder,'refund_retained',amount),{code:'SHOP_NATIVE_PAY_REFUND_ORIGINAL_REQUIRED'});
 assert.equal(f.calls.length,3);
});
test('order response rebinding and fake completed/approved review are refused without retry',async()=>{
 for(const change of [r=>{r.reference.sourceOrder='foreign';},r=>{r.reference.productId='other';},r=>{r.reference.intentId='foreign';},r=>{r.bill.invoiceId='foreign';},r=>{r.clientIndependentFinality=true;},r=>{r.queryOnly=false;}]){
  const f=originalEntry();const invoke=f.entry.invoke;f.entry.invoke=async request=>{const r=await invoke(request);change(r);return r;};
  await assert.rejects(f.nav.recoverOriginalOrder(sourceOrder),{code:'SHOP_NATIVE_PAY_ORIGINAL_CHANGED'});assert.equal(f.calls.length,1);
 }
 const f=originalEntry();const invoke=f.entry.invoke;f.entry.invoke=async request=>{const r=await invoke(request);r.walletRequest.method='ynx_broadcast';return r;};
 await assert.rejects(f.nav.reviewOriginalOrderPayment(sourceOrder),{code:'SHOP_NATIVE_PAY_REVIEW_CHANGED'});assert.equal(f.calls.length,1);
});
test('prepared unknown original remains read-only, and context or Main denial retains its original cause',async()=>{
 const f=originalEntry();const invoke=f.entry.invoke;f.entry.invoke=async request=>{const r=await invoke(request);r.intent.state='PREPARED';r.recoveryOnly=true;delete r.bill;return r;};
 assert.equal((await f.nav.recoverOriginalOrder(sourceOrder)).recoveryOnly,true);assert.equal(f.calls[0].action,'order-invoice');
 const cause=Object.assign(Error('original pending'),{code:'NATIVE_PAY_ORIGINAL_RECONCILE_REQUIRED'});
 f.entry.invoke=async()=>{throw cause;};await assert.rejects(f.nav.reviewOriginalOrderPayment(sourceOrder),error=>error===cause);
});
test('one in-flight original action prevents duplicate dispatch and context withdrawal cannot adopt a late read',async()=>{
 let release,locked=false;const f=originalEntry();f.entry.invoke=()=>new Promise(resolve=>release=resolve);
 const nav=createOriginalShopPayNavigation({entry:f.entry,current(){if(locked)throw Error('original current retired');}});
 const pending=nav.openOriginalOrder(sourceOrder);await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(nav.recoverOriginalOrder(sourceOrder),{code:'SHOP_NATIVE_PAY_MAIN_BUSY'});
 locked=true;release({});await assert.rejects(pending,/original current retired/);
});

test('normal Main invokeResult refusal preserves its precise code without recovery or review fallback',async()=>{
 const f=originalEntry({async invoke(){return {ok:false,code:'NATIVE_PAY_ORIGINAL_RECONCILE_REQUIRED'};}});
 await assert.rejects(f.nav.recoverOriginalOrder(sourceOrder),{code:'NATIVE_PAY_ORIGINAL_RECONCILE_REQUIRED'});
 await assert.rejects(f.nav.reviewOriginalOrderTerms(sourceOrder),{code:'NATIVE_PAY_ORIGINAL_RECONCILE_REQUIRED'});
});

test('normal per-request Main readiness can acquire its own Source once; readiness itself grants no payment',async()=>{
 const f=originalEntry({status(){return {available:false,canRequest:true,reason:'NATIVE_PAY_PRODUCT_SOURCE_REQUIRES_CURRENT_REQUEST',normalMainEntry:true,paymentAuthorized:false};}});
 assert.equal((await f.nav.openOriginalOrder(sourceOrder)).paymentAuthorized,false);assert.equal(f.calls.length,1);
 const cause=Object.assign(Error('actual protected Source absent'),{code:'AUTH_IDENTITY_ORIGINAL_SOURCE_NOT_SUPPLIED'});f.entry.invoke=async()=>{throw cause;};
 await assert.rejects(f.nav.recoverOriginalOrder(sourceOrder),error=>error===cause);assert.equal(f.calls.length,1);
});
test('actual normal Main IPC envelope maps original methods and pending review without token or new transport',async()=>{
 const f=originalEntry(),calls=[];
 const api={async nativePayStatus(){calls.push('status');return {ok:true,value:{available:false,canRequest:true,normalMainEntry:true,paymentAuthorized:false}};},async nativePayInvoke(request){calls.push({...request});return {ok:true,value:await f.entry.invoke(request)};}};
 const nav=createOriginalShopPayNavigationFromMainIPC({api,current(){}});
 assert.equal((await nav.recoverOriginalOrder(sourceOrder)).queryOnly,true);
 assert.equal((await nav.reviewOriginalOrderPayment(sourceOrder)).reviewPending,true);
 assert.deepEqual(calls,['status',{action:'order-invoice',productId:'shop.order',sourceOrder},'status',{action:'order-pay-review',productId:'shop.order',sourceOrder}]);
 api.nativePayInvoke=()=>{throw Error('changed mutable export must not replace captured original')};
 assert.equal((await nav.openOriginalOrder(sourceOrder)).queryOnly,true);
});
test('Main IPC error/current withdrawal never turns into available status or a replacement dispatch',async()=>{
 let calls=0,retired=false;
 const api={async nativePayStatus(){return {ok:true,value:{available:false,canRequest:true,normalMainEntry:true,paymentAuthorized:false}};},async nativePayInvoke(){calls++;return {ok:false,error:{code:'AUTH_IDENTITY_ORIGINAL_SOURCE_NOT_SUPPLIED',message:'private message is not adopted'}};}};
 const nav=createOriginalShopPayNavigationFromMainIPC({api,current(){if(retired)throw Error('actual original context retired');}});
 await assert.rejects(nav.openOriginalOrder(sourceOrder),{code:'AUTH_IDENTITY_ORIGINAL_SOURCE_NOT_SUPPLIED'});assert.equal(calls,1);
 const late=createOriginalShopPayNavigationFromMainIPC({api:{...api,async nativePayStatus(){retired=true;return {ok:true,value:{available:true,normalMainEntry:true,paymentAuthorized:false}};}},current(){if(retired)throw Error('actual original context retired');}});
 await assert.rejects(late.recoverOriginalOrder(sourceOrder),/actual original context retired/);assert.equal(calls,1);
 const numeric=createOriginalShopPayNavigationFromMainIPC({api:{nativePayStatus:async()=>({ok:false,error:{code:4100}}),nativePayInvoke:()=>{calls++;}},current(){}});
 await assert.rejects(numeric.openOriginalOrder(sourceOrder),error=>error.code==='SHOP_NATIVE_PAY_MAIN_UNAVAILABLE'&&error.cause?.code===4100);assert.equal(calls,1);
});

test('explicit current Main request refusal wins over an older available flag',async()=>{
 const f=originalEntry({status(){return {available:true,canRequest:false,normalMainEntry:true,paymentAuthorized:false,reason:'NATIVE_PAY_MAIN_CURRENT_UNAVAILABLE'};}});
 await assert.rejects(f.nav.openOriginalOrder(sourceOrder),error=>error.code==='SHOP_NATIVE_PAY_MAIN_UNAVAILABLE'&&error.cause?.code==='NATIVE_PAY_MAIN_CURRENT_UNAVAILABLE');
 assert.equal(f.calls.length,0);
});

const originalNativeHash='0x'+'6'.repeat(64),originalAbciHash='0x'+'7'.repeat(64),originalPayer='0x'+'2'.repeat(40);
function operationResult(status='unknown'){
 const reconciledOriginal={merchant,invoiceId,nativeHash:originalNativeHash,abciHash:originalAbciHash,kind:'invoice_settle',owner:originalPayer,status};
 return {reference:{productId:'shop.order',sourceOrder,merchant,invoiceId,intentId:operation,nativeHash:originalNativeHash},
  reconciledOriginal,bill:{sourceOrder,merchant,invoiceId,sessionId:'session_original',genesis:'a'.repeat(64),nativeChainId:'6423'},
  operations:[{nativeHash:originalNativeHash,abciHash:originalAbciHash,kind:reconciledOriginal.kind,status}],
  queryOnly:true,approvalRequired:false,clientIndependentFinality:false,canRetry:false};
}
function operationReceipt(){return {version:'ynx.pay.native.archive-receipt/v1',productId:'shop.order',sourceOrder,merchant,invoiceId,nativeHash:originalNativeHash,abciHash:originalAbciHash,sessionId:'session_original',genesis:'a'.repeat(64),nativeChainId:'6423',kind:'invoice_settle',status:'confirmed',proofVerification:'original-independent-core-verifier',dataOnly:true,queryOnly:true,canRetry:false,SourceAdmission:false,nativeGrant:false};}
function operationFixture(change=()=>{}){
 const calls=[];const entry={status:()=>({available:true,normalMainEntry:true,paymentAuthorized:false}),async invoke(request){calls.push({...request});const result=operationResult();change(result,request);return result;}};
 return {calls,entry,nav:createOriginalShopPayNavigation({entry,current(){}})};
}
test('original operation delta: explicit reconciliation sends only the original selector and never asserts funds finality',async()=>{
 const f=operationFixture(),result=await f.nav.reconcileOriginalOrderOperation(sourceOrder,originalNativeHash);
 assert.deepEqual(f.calls,[{action:'order-reconcile-operation',productId:'shop.order',sourceOrder,nativeHash:originalNativeHash}]);
 assert.equal(result.originalOperation,operation);assert.equal(result.nativeHash,originalNativeHash);assert.equal(result.operationStatus,'unknown');
 assert.equal(result.queryOnly,true);assert.equal(result.canRetry,false);assert.equal(result.paymentAuthorized,false);assert.equal(result.clientIndependentFinality,false);assert.equal(Object.isFrozen(result),true);
 assert.equal(result.walletRequest,undefined);assert.equal(result.bill,undefined);
});
test('original operation delta: invalid selectors refuse before any Main status or dispatch',async()=>{
 let calls=0;const nav=createOriginalShopPayNavigation({entry:{status(){calls++;},invoke(){calls++;}},current(){}});
 for(const hash of ['',originalAbciHash.toUpperCase(),{},'0x1',null])await assert.rejects(nav.reconcileOriginalOrderOperation(sourceOrder,hash),{code:'SHOP_NATIVE_PAY_ORIGINAL_HASH_REQUIRED'});
 await assert.rejects(nav.reconcileOriginalOrderOperation('../order',originalNativeHash),{code:'SHOP_NATIVE_PAY_ORDER_REQUIRED'});assert.equal(calls,0);
});
test('original operation delta: retained terms, submitted refund and confirmed failure remain data without funds authorization',async()=>{
 for(const [kind,status]of [['invoice_terms','unknown'],['invoice_refund','submitted'],['invoice_settle','confirmed_failed']]){
  const f=operationFixture(r=>{r.reconciledOriginal.kind=r.operations[0].kind=kind;r.reconciledOriginal.status=r.operations[0].status=status;r.reconciledOriginal.owner=kind==='invoice_settle'?originalPayer:merchant;
   if(status==='confirmed_failed')r.archiveReceipt={...operationReceipt(),kind,status};});
  const value=await f.nav.reconcileOriginalOrderOperation(sourceOrder,originalNativeHash);
  assert.equal(value.operationKind,kind);assert.equal(value.operationStatus,status);assert.equal(value.paymentAuthorized,false);assert.equal(value.clientIndependentFinality,false);assert.equal(value.canRetry,false);
 }
});
test('original operation delta: rebound reference, bill and retained operation summaries refuse without dispatch replay',async()=>{
 const changes=[r=>r.reference.productId='cloud.ide-usage',r=>r.reference.sourceOrder='foreign',r=>r.reference.intentId='foreign',r=>r.reference.nativeHash=originalAbciHash,
  r=>r.reference.merchant='foreign',r=>r.reference.invoiceId='../foreign',r=>r.reconciledOriginal.merchant='0x'+'9'.repeat(40),r=>r.reconciledOriginal.invoiceId='foreign',
  r=>r.reconciledOriginal.nativeHash=originalAbciHash,r=>r.reconciledOriginal.abciHash='invalid',r=>r.reconciledOriginal.kind='transfer',r=>r.reconciledOriginal.status='paid',r=>r.reconciledOriginal.owner=merchant,
  r=>r.bill.sourceOrder='foreign',r=>r.bill.merchant='0x'+'9'.repeat(40),r=>r.bill.invoiceId='foreign',r=>delete r.bill,
  r=>r.operations=[],r=>r.operations.push({...r.operations[0]}),r=>r.operations[0].abciHash=originalNativeHash,r=>r.operations[0].kind='invoice_refund',r=>r.operations[0].status='confirmed',r=>r.archiveReceipt=operationReceipt()];
 for(const change of changes){const f=operationFixture(change);await assert.rejects(f.nav.reconcileOriginalOrderOperation(sourceOrder,originalNativeHash),{code:'SHOP_NATIVE_PAY_ORIGINAL_CHANGED'});assert.equal(f.calls.length,1);}
});
test('original operation delta: approval, retry and missing terminal archive claims cannot become reconciliation success',async()=>{
 for(const change of [r=>r.queryOnly=false,r=>r.approvalRequired=true,r=>r.clientIndependentFinality=true,r=>r.paymentAuthorized=true,r=>r.canRetry=true,r=>r.walletRequest={id:'forbidden'}]){
  const f=operationFixture(change);await assert.rejects(f.nav.reconcileOriginalOrderOperation(sourceOrder,originalNativeHash),{code:'SHOP_NATIVE_PAY_ORIGINAL_CHANGED'});assert.equal(f.calls.length,1);
 }
 const terminal=operationFixture(r=>{r.reconciledOriginal.status=r.operations[0].status='confirmed';});
 await assert.rejects(terminal.nav.reconcileOriginalOrderOperation(sourceOrder,originalNativeHash),{code:'SHOP_NATIVE_PAY_ORIGINAL_CHANGED'});
 for(const change of [r=>r.archiveReceipt.nativeHash=originalAbciHash,r=>r.archiveReceipt.abciHash=originalNativeHash,r=>r.archiveReceipt.sessionId='foreign',r=>r.archiveReceipt.SourceAdmission=true,r=>r.archiveReceipt.nativeGrant=true,r=>r.archiveReceipt.queryOnly=false]){
  const f=operationFixture(r=>{r.reconciledOriginal.status=r.operations[0].status='confirmed';r.archiveReceipt=operationReceipt();change(r);});
  await assert.rejects(f.nav.reconcileOriginalOrderOperation(sourceOrder,originalNativeHash),{code:'SHOP_NATIVE_PAY_ORIGINAL_CHANGED'});
 }
 const f=operationFixture(r=>{r.reconciledOriginal.status=r.operations[0].status='confirmed';r.archiveReceipt=operationReceipt();});
 const value=await f.nav.reconcileOriginalOrderOperation(sourceOrder,originalNativeHash);assert.equal(value.operationStatus,'confirmed');assert.equal(value.paymentAuthorized,false);assert.equal(value.clientIndependentFinality,false);
});
test('original operation delta: lost reply retains only known original input and recovery performs one archive read',async()=>{
 const f=operationFixture(),cause=Object.assign(Error('controlled response lost'),{code:'PUBLIC_RECONCILIATION_REPLY_LOST'});
 f.entry.invoke=async request=>{f.calls.push({...request});throw cause;};
 await assert.rejects(f.nav.reconcileOriginalOrderOperation(sourceOrder,originalNativeHash),error=>{
  assert.equal(error.cause,cause);assert.deepEqual(error.originalReference,{productId:'shop.order',sourceOrder,nativeHash:originalNativeHash});
  assert.deepEqual(error.recoveryAction,{action:'order-receipt',productId:'shop.order',sourceOrder,nativeHash:originalNativeHash});
  assert.equal(error.canRetry,false);assert.equal(error.outcome,'UNKNOWN');assert.equal(error.originalReference.intentId,undefined);return error.code===cause.code;
 });
 f.entry.invoke=async request=>{f.calls.push({...request});return {...operationResult(),archiveReceipt:operationReceipt()};};
 const recovered=await f.nav.recoverOriginalOrderOperation(sourceOrder,originalNativeHash);
 assert.equal(recovered.queryOnly,true);assert.equal(recovered.paymentAuthorized,false);
 assert.deepEqual(f.calls.map(c=>c.action),['order-reconcile-operation','order-receipt']);assert.equal(f.calls[1].nativeHash,originalNativeHash);
 const normal=originalEntry();await normal.nav.recoverOriginalOrder(sourceOrder);assert.equal(normal.calls[0].action,'order-invoice');
});
test('original operation delta: archive recovery rejects another operation and cannot enter review',async()=>{
 for(const change of [r=>r.reference.nativeHash=originalAbciHash,r=>r.archiveReceipt.invoiceId='foreign',r=>r.archiveReceipt.productId='other',r=>r.archiveReceipt.status='unknown',r=>r.archiveReceipt.dataOnly=false,r=>r.archiveReceipt.canRetry=true,r=>r.walletRequest={}]){
  const f=operationFixture(r=>{r.archiveReceipt=operationReceipt();change(r);});
  await assert.rejects(f.nav.recoverOriginalOrderOperation(sourceOrder,originalNativeHash),{code:'SHOP_NATIVE_PAY_ORIGINAL_CHANGED'});assert.deepEqual(f.calls.map(c=>c.action),['order-receipt']);
 }
});
test('original operation delta: normal Main IPC preserves exact original action and rejects retirement without publishing recovery metadata',async()=>{
 const f=operationFixture(),api={nativePayStatus:async()=>({ok:true,value:f.entry.status()}),nativePayInvoke:async r=>({ok:true,value:await f.entry.invoke(r)})};
 const nav=createOriginalShopPayNavigationFromMainIPC({api,current(){}});await nav.reconcileOriginalOrderOperation(sourceOrder,originalNativeHash);assert.equal(f.calls[0].action,'order-reconcile-operation');
 let release,retired=false;const cause=Object.assign(Error('current retired'),{code:'PUBLIC_CURRENT_RETIRED'});
 const current=()=>{if(retired)throw cause;},held=createOriginalShopPayNavigation({entry:{...f.entry,invoke:()=>new Promise(resolve=>release=resolve)},current});
 const pending=held.reconcileOriginalOrderOperation(sourceOrder,originalNativeHash);await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(held.reconcileOriginalOrderOperation(sourceOrder,originalNativeHash),{code:'SHOP_NATIVE_PAY_MAIN_BUSY'});
 retired=true;release(operationResult());await assert.rejects(pending,error=>error===cause&&error.originalReference===undefined);
});

test('original operation fixed P06 joint: actual Main and private client consume one retained UNKNOWN and lost replies remain archive reads',{
 skip:!process.env.YNX_SHOP_FIXED_PAY_RECOVERY_HANDOFF && !process.env.YNX_SHOP_FIXED_PAY_RECOVERY_SOURCE_ROOT
},async()=>{
 const {readFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto'),{pathToFileURL}=await import('node:url');
 let handoff;
 if(process.env.YNX_SHOP_FIXED_PAY_RECOVERY_HANDOFF){
  const bytes=await readFile(process.env.YNX_SHOP_FIXED_PAY_RECOVERY_HANDOFF);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'3bf5de51c371cea99dcacb48881a9cfabe27829ea40d680d5d7742a40474b43b');handoff=JSON.parse(bytes);
 }else{
  const bytes=await readFile(new URL('./testdata/pay-original-operation-source.json',import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'cb9bfb7d025c4b698dbe446a06977f4ccee4409f141cfa48c200701d50c59604');
  const manifest=JSON.parse(bytes);assert.equal(manifest.sourceCommit,'2645269e97e067541c3dc60d3ad84d29497807c0');
  assert.equal(manifest.supplierHandoffSHA256,'3bf5de51c371cea99dcacb48881a9cfabe27829ea40d680d5d7742a40474b43b');
  const {join}=await import('node:path');handoff={source:manifest.source.map(file=>({...file,path:join(process.env.YNX_SHOP_FIXED_PAY_RECOVERY_SOURCE_ROOT,file.relative)}))};
 }
 assert.equal(handoff.source.length,9);
 for(const file of handoff.source){const content=await readFile(file.path);assert.equal(content.length,file.bytes);assert.equal(createHash('sha256').update(content).digest('hex'),file.sha256);}
 const module=async name=>import(pathToFileURL(handoff.source.find(f=>f.relative.endsWith('/'+name)).path).href);
 const {createNativePayMainEntry}=await module('main-entry.mjs'),{createPrivateNativeProductPayClient}=await module('merchant-invoice-approval.mjs');
 // Real fixed P06 code, controlled transport DATA. UNKNOWN is never replaced
 // by a fabricated proof, qualified Source, Main approval or signed Member.
 const termsHash='0x'+'4'.repeat(64),original={productId:'shop.order',storeId:'store_original',sourceOrder,merchant,recipient:merchant,genesis:'a'.repeat(64),nativeChainId:'6423',assetId:'YNXT',unitVersion:'1',amountAtoms:'100',domainData:{schema:'ynx.shop.order.invoice/v1',order:{ID:sourceOrder},approvedNativePrice:{PriceApprovalRef:'PUBLIC-controlled-original'}}};
 const terms={invoiceId,sessionId:'session_original',recipient:merchant,payer:originalPayer,assetId:'YNXT',unitVersion:'1',feeRule:'native-transfer-fee-one/v1',keyEpoch:'1',revision:'1',amountAtoms:'100',maxFeeAtoms:'1',expiresAtHeight:'100'};
 const intent={intentId:operation,originalOperation:operation,request:original,merchant,state:'ISSUED',phase:'confirmed',signingMessageHash:'b'.repeat(64),termsNativeHash:termsHash,termsAbciHash:'0x'+'5'.repeat(64),terms,invoice:{}};
 const retained=operationResult().reconciledOriginal;
 const bill={genesis:original.genesis,nativeChainId:'6423',merchant,invoiceId,sessionId:terms.sessionId,sourceOrder,assetId:'YNXT',unitVersion:'1',principalAtoms:'100',paidAtoms:'0',refundedAtoms:'0',netPaidAtoms:'0',feeRule:terms.feeRule,maxFeeAtoms:'1',expiresAtHeight:'100',termsNativeHash:termsHash,termsHash:intent.signingMessageHash,status:'unknown',refundStatus:'none',operations:{[originalNativeHash]:retained}};
 for(const loseReply of [false,true]){
  const calls=[],mainCalls=[],archiveCalls=[];
  const pay=createPrivateNativeProductPayClient({origin:'https://controlled-original.test',async requestPrivate(request){
   request.assertCurrent();calls.push({method:request.method,path:request.path});let value;
   if(request.path==='/v5/pay/invoice-intents/lookup')value=intent;
   else if(request.method==='GET'&&request.path===`/v5/pay/invoices/${merchant}/${invoiceId}`)value=bill;
   else if(request.method==='POST'&&request.path===`/v5/pay/invoices/${merchant}/${invoiceId}/operations/${originalNativeHash}/reconcile`){
    assert.deepEqual(Buffer.from(request.body),Buffer.from('{}'));
    if(loseReply)throw Object.assign(Error('controlled reconcile response lost'),{code:'PUBLIC_RECONCILIATION_REPLY_LOST'});
    value=retained;
   }else throw Error('Unexpected create/review/Member dispatch');
   return {method:request.method,requestPath:request.path,status:200,contentType:'application/json',body:Buffer.from(JSON.stringify(value))};
  }});
  const main=createNativePayMainEntry({getMain:()=>null,getContext:()=>({account:merchant,revision:1,focused:true})});
  main.compose({pay,current(){},async readOriginalInvoiceIntent(ref,current){current();assert.deepEqual(ref,{productId:'shop.order',sourceOrder});return original;},async readOriginalArchiveReceipt(ref,current){current();archiveCalls.push(ref);throw Object.assign(Error('controlled archive remains UNKNOWN'),{code:'PUBLIC_ARCHIVE_UNKNOWN'});}});
  const nav=createOriginalShopPayNavigationFromMainIPC({api:{nativePayStatus:async()=>({ok:true,value:main.status()}),nativePayInvoke:async request=>{mainCalls.push(request);return {ok:true,value:await main.invokeResult(request)};}},current(){}});
  if(loseReply){
   await assert.rejects(nav.reconcileOriginalOrderOperation(sourceOrder,originalNativeHash),error=>error.code==='PUBLIC_RECONCILIATION_REPLY_LOST'&&error.originalReference.nativeHash===originalNativeHash);
   await assert.rejects(nav.recoverOriginalOrderOperation(sourceOrder,originalNativeHash),{code:'PUBLIC_ARCHIVE_UNKNOWN'});
   assert.equal(archiveCalls.length,1);assert.equal(archiveCalls[0].nativeHash,originalNativeHash);
   assert.deepEqual(mainCalls.map(r=>r.action),['order-reconcile-operation','order-receipt']);
  }else{
   const result=await nav.reconcileOriginalOrderOperation(sourceOrder,originalNativeHash);
   assert.equal(result.operationStatus,'unknown');assert.equal(result.paymentAuthorized,false);assert.equal(result.clientIndependentFinality,false);
  }
  await nav.recoverOriginalOrder(sourceOrder);assert.equal(mainCalls.at(-1).action,'order-invoice');
  assert.equal(calls.filter(r=>r.path.endsWith('/reconcile')).length,1);assert.equal(calls.some(r=>/create|review|broadcast|submit/.test(r.path)),false);
 }
});
