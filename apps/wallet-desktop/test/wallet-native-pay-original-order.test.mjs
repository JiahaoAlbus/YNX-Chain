import test from 'node:test';
import assert from 'node:assert/strict';
import {createWalletNativePayProduct} from '../src/wallet-native-pay-product.mjs';
import {createWalletNativePayProductStartup} from '../src/wallet-native-pay-product-startup.mjs';
import {createNativePayMainEntry} from '../src/native-pay-client/main-entry.mjs';
import {createPrivateNativeProductPayClient} from '../src/native-pay-client/merchant-invoice-approval.mjs';

const merchant='0x'+'1'.repeat(40),payer='0x'+'2'.repeat(40),intentId='npi_'+'3'.repeat(48),termsHash='0x'+'4'.repeat(64);
const original={productId:'shop.order',storeId:'store-original',sourceOrder:'order:original',merchant,recipient:merchant,genesis:'a'.repeat(64),nativeChainId:'6423',assetId:'YNXT',unitVersion:'1',amountAtoms:'100',domainData:{schema:'ynx.shop.order.invoice/v1',order:{ID:'order:original'},approvedNativePrice:{PriceApprovalRef:'PUBLIC-original-price'}}};
const ref={productId:original.productId,sourceOrder:original.sourceOrder};
const terms={invoiceId:'invoice-original',sessionId:'session-original',recipient:merchant,payer,assetId:'YNXT',unitVersion:'1',feeRule:'native-transfer-fee-one/v1',keyEpoch:'1',revision:'1',amountAtoms:'100',maxFeeAtoms:'1',expiresAtHeight:'100'};
const view=()=>({intentId,originalOperation:intentId,request:structuredClone(original),merchant,state:'ISSUED',phase:'confirmed',signingMessageHash:'b'.repeat(64),termsNativeHash:termsHash,termsAbciHash:'0x'+'5'.repeat(64),terms:{...terms},invoice:{}});
const bill=()=>({genesis:original.genesis,nativeChainId:'6423',merchant,invoiceId:terms.invoiceId,sessionId:terms.sessionId,sourceOrder:original.sourceOrder,assetId:'YNXT',unitVersion:'1',principalAtoms:'100',paidAtoms:'0',refundedAtoms:'0',netPaidAtoms:'0',feeRule:terms.feeRule,maxFeeAtoms:'1',expiresAtHeight:'100',termsNativeHash:termsHash,termsHash:'b'.repeat(64),status:'terms_registered',refundStatus:'none',operations:{}});
function boot({lookup=view,readIntent=view,create,read=bill,main=null,change=()=>{},originalRead=()=>structuredClone(original),review=()=>({intent:view()}),operation=()=>{throw Error('Unexpected reconciliation');},extra={}}={}){
 const calls=[];let live=true;
 const current=()=>{if(!live)throw Object.assign(Error(),{code:'ORIGINAL_SOURCE_RETIRED'});};
 const pay=createPrivateNativeProductPayClient({origin:'https://pay.original.test',async requestPrivate(request){
  request.assertCurrent();calls.push({method:request.method,path:request.path,body:request.body});let result;
  if(request.path==='/v5/pay/invoice-intents/lookup'){result=await lookup();change('lookup');}
  else if(request.method==='GET'&&request.path===`/v5/pay/invoice-intents/${intentId}`){result=await readIntent();change('intent');}
  else if(request.method==='POST'&&request.path==='/v5/pay/invoice-intents'&&create){result=await create();}
  else if(request.method==='GET'&&request.path===`/v5/pay/invoices/${merchant}/${terms.invoiceId}`){result=await read();change('invoice');}
  else if(request.path===`/v5/pay/invoice-intents/${intentId}/merchant-review`){result=await review();}
  else if(request.method==='POST'&&request.path.startsWith(`/v5/pay/invoices/${merchant}/${terms.invoiceId}/operations/`)&&request.path.endsWith('/reconcile')){result=await operation();change('operation');}
  else throw Object.assign(Error(),{code:'PUBLIC_UNEXPECTED_CALL'});
  return {method:request.method,requestPath:request.path,status:200,contentType:'application/json',body:Buffer.from(JSON.stringify(result))};
 }});
 const entry=createNativePayMainEntry({getMain:()=>main,getContext:()=>({account:merchant,revision:1,focused:true})});
 entry.compose({pay,current,async readOriginalInvoiceIntent(selected,fence){fence();assert.deepEqual(selected,ref);calls.push({sourceRead:selected});return originalRead();},...extra});
 return{entry,pay,calls,revoke:()=>{live=false;}};
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
 const cold=boot({lookup:()=>({...view(),invoice:bill()})});const recovered=await cold.entry.invokeResult(result.recoveryActions[0]);assert.equal(recovered.ok,true);assert.equal(recovered.intent.originalOperation,intentId);assert.equal(cold.calls.length,2);
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
 const f=boot({lookup:()=>({...view(),state:'PREPARED',phase:'awaiting_merchant_approval',termsNativeHash:'',termsAbciHash:''})});const r=await f.entry.invokeResult({action:'order-invoice',...ref});assert.equal(r.ok,true);assert.equal(r.bill,undefined);assert.equal(r.queryOnly,true);assert.equal(f.calls.length,2);
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
 for(const action of ['order-terms-review','order-broadcast-review'])for(const change of [v=>v.terms.sessionId='other-session',v=>v.signingMessageHash='c'.repeat(64),v=>{v.state='ISSUED';v.phase='confirmed';v.termsNativeHash=termsHash;v.termsAbciHash=view().termsAbciHash;}]){
  const m=noSigningMain(),prepared=()=>({...view(),state:'PREPARED',phase:'awaiting_merchant_approval',termsNativeHash:'',termsAbciHash:''});
  const changed=()=>{const v=prepared();change(v);return v;};
  const f=boot({main:m.main,lookup:prepared,readIntent:changed,review:()=>({intent:changed()})});
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

const originalOperation=()=>({merchant,invoiceId:terms.invoiceId,nativeHash,abciHash:'0x'+'7'.repeat(64),kind:'invoice_settle',owner:payer,status:'unknown'});
test('normal original-operation recovery reconciles the retained hash once and reads the same receipt',async()=>{
 let reconciled=false,archives=0;
 const f=boot({read:()=>({...bill(),status:reconciled?'committed_paid':'unknown',paidAtoms:reconciled?'100':'0',netPaidAtoms:reconciled?'100':'0',operations:{[nativeHash]:{...originalOperation(),status:reconciled?'confirmed':'unknown'}}}),operation:()=>{reconciled=true;return {...originalOperation(),status:'confirmed'};},extra:{readOriginalArchiveReceipt:async(selected,current)=>{current();archives++;assert.equal(selected.nativeHash,nativeHash);return receipt();}}});
 const r=await f.entry.invokeResult({action:'order-reconcile-operation',...ref,nativeHash});
 assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.queryOnly,true);assert.equal(r.bill.paidAtoms,'100');assert.equal(r.archiveReceipt.nativeHash,nativeHash);assert.equal(r.reconciledOriginal.nativeHash,nativeHash);assert.equal(r.reconciledOriginal.status,'confirmed');assert.equal(r.canRetry,false);assert.equal(r.clientIndependentFinality,false);assert.equal(archives,1);
 assert.equal(f.calls.filter(c=>c.method==='POST'&&c.path?.endsWith('/reconcile')).length,1);assert.deepEqual(f.calls.find(c=>c.path?.endsWith('/reconcile')).body,Buffer.from('{}'));
});
test('operation recovery refuses an absent original hash before any reconcile call',async()=>{
 const f=boot({read:()=>({...bill(),operations:{}})}),r=await f.entry.invokeResult({action:'order-reconcile-operation',...ref,nativeHash});
 assert.equal(r.code,'NATIVE_PAY_ORIGINAL_HASH_REQUIRED');assert.equal(f.calls.length,3);assert.equal(r.canRetry,false);
});
test('operation recovery cannot splice a different response hash, kind or original owner',async()=>{
 for(const mutate of [v=>v.nativeHash=termsHash,v=>v.kind='invoice_refund',v=>v.owner=merchant,v=>v.abciHash='0x'+'8'.repeat(64)]){
  const f=boot({read:()=>({...bill(),operations:{[nativeHash]:originalOperation()}}),operation:()=>{const v=originalOperation();mutate(v);return v;}});
  const r=await f.entry.invokeResult({action:'order-reconcile-operation',...ref,nativeHash});assert.equal(r.code,'NATIVE_PAY_ORIGINAL_OPERATION_CHANGED');assert.equal(r.bill,undefined);assert.equal(f.calls.length,4);
 }
});
test('a lost original reconciliation response exposes only original queries, never another dispatch',async()=>{
 let posts=0;const f=boot({read:()=>({...bill(),operations:{[nativeHash]:originalOperation()}}),operation:()=>{posts++;throw Object.assign(Error(),{code:'PUBLIC_RECONCILIATION_REPLY_LOST'});}});
 const r=await f.entry.invokeResult({action:'order-reconcile-operation',...ref,nativeHash});assert.equal(r.ok,false);assert.equal(r.code,'PUBLIC_RECONCILIATION_REPLY_LOST');assert.equal(posts,1);assert.equal(r.reference.nativeHash,nativeHash);assert.equal(r.canRetry,false);assert.ok(r.recoveryActions.every(a=>['recover-archive','order-receipt','order-invoice','reconcile-archive'].includes(a.action)));
});
test('post-reconcile current revocation cannot publish old bill/receipt or retry',async()=>{
 let revoke;const f=boot({read:()=>({...bill(),operations:{[nativeHash]:originalOperation()}}),operation:()=>{revoke();return {...originalOperation(),status:'confirmed'};}});revoke=f.revoke;
 const r=await f.entry.invokeResult({action:'order-reconcile-operation',...ref,nativeHash});assert.equal(r.ok,false);assert.equal(r.reference,null);assert.equal(r.archiveReceipt,undefined);assert.equal(f.calls.length,4);
});
test('terms recovery accepts PREPARED original terms and cannot select payment before issuance',async()=>{
 const op={...originalOperation(),nativeHash:termsHash,abciHash:view().termsAbciHash,kind:'invoice_terms',owner:merchant};
 const f=boot({lookup:()=>({...view(),state:'PREPARED',phase:'unknown'}),read:()=>({...bill(),operations:{[termsHash]:op}}),operation:()=>op});
 const r=await f.entry.invokeResult({action:'order-reconcile-operation',...ref,nativeHash:termsHash});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.reconciledOriginal.kind,'invoice_terms');assert.equal(r.archiveReceipt,undefined);
 const pending=boot({lookup:()=>({...view(),state:'PREPARED',phase:'unknown'}),read:()=>({...bill(),operations:{[nativeHash]:originalOperation()}})});
 assert.equal((await pending.entry.invokeResult({action:'order-reconcile-operation',...ref,nativeHash})).code,'NATIVE_PAY_ORIGINAL_OPERATION_CHANGED');assert.equal(pending.calls.length,3);
});
test('invalid hash fails before Source read and terminal originals cannot change or regress',async()=>{
 const invalid=boot();assert.equal((await invalid.entry.invokeResult({action:'order-reconcile-operation',...ref,nativeHash:'different'})).code,'NATIVE_PAY_ORIGINAL_HASH_REQUIRED');assert.equal(invalid.calls.length,0);
 for(const status of ['unknown','submitted','confirmed_failed']){
  const f=boot({read:()=>({...bill(),operations:{[nativeHash]:{...originalOperation(),status:'confirmed'}}}),operation:()=>({...originalOperation(),status})});
  assert.equal((await f.entry.invokeResult({action:'order-reconcile-operation',...ref,nativeHash})).code,'NATIVE_PAY_ORIGINAL_OPERATION_CHANGED');assert.equal(f.calls.length,4);
 }
});
test('finality cannot regress in post-read or splice another receipt after reconciliation',async()=>{
 for(const mode of ['regress','receipt']){
  let reads=0;
  const f=boot({read:()=>({...bill(),operations:{[nativeHash]:{...originalOperation(),status:++reads===1||mode==='regress'?'unknown':'confirmed'}}}),operation:()=>({...originalOperation(),status:'confirmed'}),extra:{readOriginalArchiveReceipt:async()=>({...receipt(),abciHash:'0x'+'8'.repeat(64)})}});
  const r=await f.entry.invokeResult({action:'order-reconcile-operation',...ref,nativeHash});assert.equal(r.code,'NATIVE_PAY_ORIGINAL_OPERATION_CHANGED');assert.equal(r.bill,undefined);assert.equal(r.archiveReceipt,undefined);
 }
});
test('fresh original query may precede another explicit same-hash proof reconciliation without automatic retry',async()=>{
 let posts=0,confirmed=false;
 const f=boot({read:()=>({...bill(),status:confirmed?'committed_paid':'unknown',paidAtoms:confirmed?'100':'0',netPaidAtoms:confirmed?'100':'0',operations:{[nativeHash]:{...originalOperation(),status:confirmed?'confirmed':'unknown'}}}),operation:()=>{
  if(++posts===1)throw Object.assign(Error(),{code:'PUBLIC_ORIGINAL_PROOF_UNAVAILABLE'});
  confirmed=true;return {...originalOperation(),status:'confirmed'};
 },extra:{readOriginalArchiveReceipt:async()=>receipt()}});
 const action={action:'order-reconcile-operation',...ref,nativeHash};
 const first=await f.entry.invokeResult(action);assert.equal(first.ok,false);assert.equal(first.canRetry,false);assert.equal(posts,1);assert.ok(first.recoveryActions.every(v=>v.action==='recover-archive'));
 const queried=await f.entry.invokeResult({action:'order-invoice',...ref});assert.equal(queried.ok,true);assert.equal(queried.canRetry,false);assert.deepEqual(queried.pendingOriginals,[nativeHash]);assert.equal(queried.operations[0].status,'unknown');assert.equal(posts,1);
 // A second explicit invocation, never dispatched by the failure/query path.
 const next=await f.entry.invokeResult(action);assert.equal(next.ok,true,JSON.stringify(next));assert.equal(next.canRetry,false);assert.equal(next.reconciledOriginal.nativeHash,nativeHash);assert.equal(next.reconciledOriginal.status,'confirmed');assert.equal(posts,2);
});

const pendingTermsOperation=()=>({...originalOperation(),nativeHash:termsHash,abciHash:'0x'+'5'.repeat(64),kind:'invoice_terms',owner:merchant});
test('pending merchant terms query exposes only the retained original operation and original lookup recovery',async()=>{
 const f=boot({lookup:()=>({...view(),state:'PREPARED',phase:'unknown'}),read:()=>({...bill(),status:'awaiting_terms_finality',operations:{[termsHash]:pendingTermsOperation()}})});
 const r=await f.entry.invokeResult({action:'order-invoice',...ref});
 assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.queryOnly,true);assert.equal(r.recoveryOnly,true);assert.equal(r.approvalRequired,false);assert.equal(r.outcomeUnknown,true);assert.equal(r.bill.paidAtoms,'0');assert.deepEqual(r.pendingOriginals,[termsHash]);assert.equal(r.reference.nativeHash,termsHash);assert.equal(r.operations[0].abciHash,view().termsAbciHash);assert.equal(r.canRetry,false);
 assert.deepEqual(r.recoveryActions,[{action:'lookup-intent',...ref}]);assert.equal(f.calls.length,3);assert.equal(f.calls.filter(c=>c.path?.endsWith('/reconcile')).length,0);assert.equal(r.walletRequest,undefined);
});
test('unsigned or retained pre-send terms never invent an operation or read an absent invoice',async()=>{
 for(const phase of ['awaiting_merchant_approval','signed_not_submitted','unknown']){
  const f=boot({lookup:()=>({...view(),state:'PREPARED',phase,termsNativeHash:'',termsAbciHash:''})});
  const r=await f.entry.invokeResult({action:'order-invoice',...ref});assert.equal(r.ok,true);assert.equal(r.bill,undefined);assert.equal(r.pendingOriginals,undefined);assert.equal(r.reference.nativeHash,undefined);assert.equal(r.recoveryOnly,phase!=='awaiting_merchant_approval');assert.equal(r.outcomeUnknown===true,phase==='unknown');assert.equal(f.calls.length,2);assert.deepEqual(r.recoveryActions,[{action:'lookup-intent',...ref}]);
 }
});
test('pending terms cannot display another operation, ABCI identity, or premature money projection',async()=>{
 for(const edit of [b=>b.operations[termsHash].kind='invoice_settle',b=>b.operations[termsHash].owner=payer,b=>b.operations[termsHash].abciHash='0x'+'8'.repeat(64),b=>b.paidAtoms='100',b=>b.refundedAtoms='1',b=>b.netPaidAtoms='1',b=>b.sourceOrder='foreign-order']){
  const f=boot({lookup:()=>({...view(),state:'PREPARED',phase:'unknown'}),read:()=>{const b={...bill(),operations:{[termsHash]:pendingTermsOperation()}};edit(b);return b;}});
  const r=await f.entry.invokeResult({action:'order-invoice',...ref});assert.equal(r.ok,false);assert.equal(r.bill,undefined);assert.equal(r.operations,undefined);assert.equal(f.calls.length,3);assert.deepEqual(r.recoveryActions,[{action:'lookup-intent',...ref}]);
 }
});
test('lost pending terms bill read retains only original query recovery and does not reconcile or sign',async()=>{
 const f=boot({lookup:()=>({...view(),state:'PREPARED',phase:'unknown'}),read:()=>{throw Object.assign(Error(),{code:'PUBLIC_PENDING_READ_LOST'});}});
 const r=await f.entry.invokeResult({action:'order-invoice',...ref});assert.equal(r.ok,false);assert.equal(r.code,'PUBLIC_PENDING_READ_LOST');assert.equal(r.reference.nativeHash,termsHash);assert.deepEqual(r.recoveryActions,[{action:'lookup-intent',...ref}]);assert.equal(r.canRetry,false);assert.equal(f.calls.length,3);
});
test('prepared terms require a complete native/ABCI pair before invoice reads or new review',async()=>{
 for(const fields of [{termsNativeHash:'',termsAbciHash:view().termsAbciHash},{termsNativeHash:termsHash,termsAbciHash:''},{termsNativeHash:termsHash,termsAbciHash:'invalid'}]){
  const f=boot({lookup:()=>({...view(),state:'PREPARED',phase:'unknown',...fields})});const r=await f.entry.invokeResult({action:'order-invoice',...ref});assert.equal(r.ok,false);assert.equal(r.code,'NATIVE_PAY_ORIGINAL_PRODUCT_INTENT_INVALID');assert.equal(f.calls.length,2);
 }
 const m=noSigningMain(),f=boot({main:m.main,lookup:()=>({...view(),state:'PREPARED',phase:'awaiting_merchant_approval'})});
 const r=await f.entry.invokeResult({action:'order-terms-review',...ref});assert.equal(r.code,'NATIVE_PAY_ORIGINAL_RECONCILE_REQUIRED');assert.equal(m.touched(),0);assert.equal(f.calls.length,2);
});
test('original lookup recovery keeps pending terms visible and checks its embedded original bill',async()=>{
 for(const paid of ['0','100']){
  const f=boot({lookup:()=>({...view(),state:'PREPARED',phase:'unknown',invoice:{...bill(),paidAtoms:paid,operations:{[termsHash]:pendingTermsOperation()}}})});
  const r=await f.entry.invokeResult({action:'lookup-intent',...ref});assert.equal(f.calls.length,2);assert.equal(r.canRetry,false);
  if(paid==='0'){assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.recoveryOnly,true);assert.equal(r.outcomeUnknown,true);assert.deepEqual(r.pendingOriginals,[termsHash]);assert.equal(r.reference.nativeHash,termsHash);}
  else{assert.equal(r.code,'NATIVE_PAY_ORIGINAL_ORDER_BINDING');assert.equal(r.bill,undefined);}
  assert.deepEqual(r.recoveryActions,[{action:'lookup-intent',...ref}]);
 }
});

test('issued Shop intent replies bind their embedded invoice before rendering it',async()=>{
 for(const action of ['lookup-intent','create-intent']){
  const replies=[
   {invoice:{...bill(),paidAtoms:'100',refundedAtoms:'30',netPaidAtoms:'70'}},
   {invoice:{...bill(),sourceOrder:'other-order',paidAtoms:'100'}},
   {invoice:{...bill(),termsNativeHash:'0x'+'8'.repeat(64)}},
   {invoice:undefined}
  ];
  for(const [index,fields] of replies.entries()){
   const reply=()=>({...view(),...fields});
   const {entry,calls}=boot({lookup:reply,create:reply});
   const result=await entry.invokeResult({action,...ref});
   assert.equal(result.ok,index===0,JSON.stringify({action,index,result}));
   if(index===0){
    assert.equal(result.bill.sourceOrder,ref.sourceOrder);
    assert.equal(result.bill.netPaidAtoms,'70');
    assert.equal(result.queryOnly,action==='lookup-intent');
   }else{
    assert.equal(result.bill,undefined);
    assert.deepEqual(result.recoveryActions,[{action:'lookup-intent',...ref}]);
   }
   assert.equal(result.walletRequest,undefined);
   assert.equal(result.canRetry,false);
   assert.equal(calls.length,2);
   assert.equal(calls[1].path,action==='lookup-intent'?'/v5/pay/invoice-intents/lookup':'/v5/pay/invoice-intents');
  }
 }
});

test('protected Shop order resolves its original intent by GET before reviews and reconciliation',async()=>{
 const actions={
  'order-invoice':{},
  'order-terms-review':{},
  'order-pay-review':{},
  'order-refund-review':{refundId:'refund-original',amountAtoms:'30'},
  'order-broadcast-review':{kind:'invoice_settle',originalHash:'0x'+'8'.repeat(64)},
  'order-reconcile-operation':{nativeHash:'0x'+'6'.repeat(64)}
 };
 for(const [action,extra] of Object.entries(actions)){
  for(const readIntent of [
   ()=>({...view(),intentId:'npi_'+'9'.repeat(48),originalOperation:'npi_'+'9'.repeat(48)}),
   ()=>({...view(),request:{...original,sourceOrder:'foreign-order'}})
  ]){
   const main=noSigningMain();
   const f=boot({main:main.main,readIntent});
   const result=await f.entry.invokeOriginalOrderResult({action,...ref,...extra},intentId,()=>{});
   assert.equal(result.ok,false);
   assert.equal(result.reference.intentId,undefined);
   assert.deepEqual(result.recoveryActions,[]);
   assert.equal(result.walletRequest,undefined);
   assert.equal(main.touched(),0);
   assert.deepEqual(f.calls,[{sourceRead:ref},{method:'GET',path:`/v5/pay/invoice-intents/${intentId}`,body:undefined}]);
  }
 }
 const f=boot();
 const result=await f.entry.invokeOriginalOrderResult({action:'order-invoice',...ref},intentId,()=>{});
 assert.equal(result.ok,true);
 assert.equal(result.reference.intentId,intentId);
 assert.deepEqual(f.calls.map(call=>call.path),[undefined,`/v5/pay/invoice-intents/${intentId}`,`/v5/pay/invoices/${merchant}/${terms.invoiceId}`]);
});

test('protected operation and current stay out of renderer input and a revoked host discards the read',async()=>{
 const f=boot(),input={action:'order-invoice',...ref};
 assert.equal((await f.entry.invokeResult({...input,expectedOriginalOperation:intentId})).code,'NATIVE_PAY_MAIN_INPUT_INVALID');
 assert.equal((await f.entry.invokeOriginalOrderResult(input,undefined,()=>{})).code,'NATIVE_PAY_MAIN_ORIGINAL_OPERATION_REQUIRED');
 assert.equal((await f.entry.invokeOriginalOrderResult(input,intentId,()=>true)).code,'NATIVE_PAY_MAIN_HOST_CURRENT_INVALID');
 assert.equal((await f.entry.invokeOriginalOrderResult({action:'create-intent',...ref},intentId,()=>{})).code,'NATIVE_PAY_MAIN_INPUT_INVALID');
 assert.equal(f.calls.length,0);

 let revoked=false;
 const late=boot({change:step=>{if(step==='intent')revoked=true;}});
 const result=await late.entry.invokeOriginalOrderResult(input,intentId,()=>{if(revoked)throw 0;});
 assert.equal(result.ok,false);
 assert.equal(result.reference,null);
 assert.equal(result.bill,undefined);
 assert.equal(late.calls.length,2);
});


test('Wallet Main protected startup refuses a foreign intent after one GET and drains the original parent', async () => {
  const foreign = 'npi_' + '9'.repeat(48);
  const {pay, calls} = boot({readIntent: () => ({...view(), intentId: foreign, originalOperation: foreign})});
  const lifecycle = [];
  const loan = {
    pay,
    current() {},
    retire() { lifecycle.push('retire'); },
    async join() { lifecycle.push('join'); },
    async close() { lifecycle.push('close'); },
    async readOriginalShopNativeInvoiceRequestDATA(order, current) {
      current();
      assert.equal(order, original.sourceOrder);
      return structuredClone(original);
    }
  };
  const getGuard = () => ({account: merchant, assert() {}});
  const getMain = () => noReview.main;
  const noReview = noSigningMain();
  const entry = createWalletNativePayProductStartup({
    captureFactories: () => ({
      acquireOriginalProductSource: () => loan,
      isOriginalProductSource: value => value === loan
    }),
    getMain,
    getGuard,
    getContext: () => ({account: merchant, revision: 1, focused: true})
  });
  const product = createWalletNativePayProduct({
    entry, getMain, getGuard,
    publishReview() { assert.fail('foreign intent reached review publication'); }
  });
  const result = await product.invokeOriginalOrderResult({action: 'order-pay-review', ...ref}, intentId, () => {});
  assert.equal(result.ok, false);
  assert.equal(result.walletRequest, undefined);
  assert.equal(noReview.touched(), 0);
  assert.deepEqual(calls, [{method: 'GET', path: `/v5/pay/invoice-intents/${intentId}`, body: undefined}]);
  assert.deepEqual(lifecycle, ['retire', 'join', 'close']);
  await entry.shutdown();
});

test('a protected review on an UNKNOWN bill offers only the bound intent GET',async()=>{
 for(const [action,extra] of [['order-pay-review',{}],['order-refund-review',{refundId:'refund-original',amountAtoms:'30'}]]){
  for(const status of [{status:'unknown'},{refundStatus:'unknown'}]){
   const m=noSigningMain(),f=boot({main:m.main,read:()=>({...bill(),...status})});
   const result=await f.entry.invokeOriginalOrderResult({action,...ref,...extra},intentId,()=>{});
   assert.equal(result.code,'NATIVE_PAY_ORIGINAL_RECONCILE_REQUIRED');
   assert.equal(result.canRetry,false);
   assert.deepEqual(result.recoveryActions,[{action:'intent',intentId}]);
   assert.equal(m.touched(),0);
   assert.deepEqual(f.calls.slice(1).map(call=>call.method),['GET','GET']);
  }
 }
});
