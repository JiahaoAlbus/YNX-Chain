import {createNativeInvoiceMerchantApproval,createNativePayActionApproval,rejectNativePayPending} from './merchant-invoice-approval.mjs';
import {nativeInvoiceProductIntentData} from './invoice-product-intent.mjs';
import {nativeArchiveReceiptData,nativeArchiveReconciliationData} from './archive-receipt.mjs';
const failure=code=>Object.assign(Error(code),{code});
const clone=value=>structuredClone(value);
// Wallet provider errors keep their precise domain code in data.code; the
// numeric outer provider code must not hide a missing production Source.
export function nativePayFailureCode(error,fallback='NATIVE_PAY_OPERATION_UNAVAILABLE'){
 for(const code of [error?.data?.code,error?.code])if(typeof code==='string'&&/^[A-Za-z0-9_:-]{1,128}$/.test(code))return code;
 return fallback;
}

/** Client orchestration only. Pay owns invoice/funds/outbox state and Main owns
 * approvals, original Members and submission UNKNOWN. This client persists no
 * second transaction journal, balance, approval or retry counter. */
export class NativePayBusinessClient {
 #runtime; #pay; #merchant; #actions; #revision=0; #state={phase:'unavailable',reason:'NATIVE_PAY_SOURCE_UNAVAILABLE',reference:null,bill:null};
 constructor(runtime){
  if(typeof runtime?.current!=='function'||!runtime.pay)throw failure('NATIVE_PAY_SOURCE_UNAVAILABLE');
  this.#runtime=runtime;this.#pay=runtime.pay;
  if(runtime.main){this.#merchant=createNativeInvoiceMerchantApproval({main:runtime.main,pay:this.#pay});this.#actions=createNativePayActionApproval({main:runtime.main,pay:this.#pay,readInvoiceOriginals:runtime.readInvoiceOriginals});}
 }
 snapshot(){return clone(this.#state);}
 invalidate(reason='NATIVE_PAY_SOURCE_UNAVAILABLE'){this.#revision++;this.#state={phase:'unavailable',reason,reference:null,bill:null};return this.snapshot();}
 #fence(revision){this.#runtime.current();if(revision!==this.#revision)throw failure('NATIVE_PAY_SELECTION_CHANGED');}
 async #run(reference,phase,work){
  const revision=++this.#revision,current=()=>this.#fence(revision);
  this.#state={phase,reason:null,reference:clone(reference),bill:null};
  try{current();const result=await work(current);current();this.#state={phase:'ready',reason:null,reference:clone(reference),...result};return this.snapshot();}
  catch(error){if(revision===this.#revision){let recovery;try{this.#runtime.current();recovery=this.#state.recovery;}catch{}this.#state={phase:'unavailable',reason:nativePayFailureCode(error),reference:clone(reference),bill:null,recoveryOnly:phase==='submitting'||phase==='creating-intent',...(recovery?{recovery}: {})};}throw error;}
 }
 async #originalProductIntent(productId,sourceOrder,current){
  if(typeof productId!=='string'||typeof sourceOrder!=='string'||![productId,sourceOrder].every(v=>/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(v)))throw failure('NATIVE_PAY_PRODUCT_REFERENCE_INVALID');
  if(typeof this.#runtime.readOriginalInvoiceIntent!=='function')throw failure('NATIVE_PAY_PRODUCT_ORIGINAL_UNAVAILABLE');
  current();const original=await this.#runtime.readOriginalInvoiceIntent(Object.freeze({productId,sourceOrder}),current);current();
  const request=nativeInvoiceProductIntentData(original);
  if(request.productId!==productId||request.sourceOrder!==sourceOrder)throw failure('NATIVE_PAY_PRODUCT_REFERENCE_CHANGED');
  return request;
 }
 async createInvoiceIntent(productId,sourceOrder){return this.#run({productId,sourceOrder},'creating-intent',async current=>{
  if(typeof this.#pay.createInvoiceIntent!=='function')throw failure('NATIVE_PAY_INTENT_PRODUCER_UNAVAILABLE');
  const original=await this.#originalProductIntent(productId,sourceOrder,current);current();
  const intent=await this.#pay.createInvoiceIntent(original,current);current();
  return {intent,bill:intent.invoice??null,clientIndependentFinality:false};
 });}
 async lookupOriginalInvoiceIntent(productId,sourceOrder){return this.#run({productId,sourceOrder},'recovering',async current=>{
  if(typeof this.#pay.lookupInvoiceIntent!=='function')throw failure('NATIVE_PAY_INTENT_LOOKUP_UNAVAILABLE');
  const original=await this.#originalProductIntent(productId,sourceOrder,current);current();
  const intent=await this.#pay.lookupInvoiceIntent(original,current);current();
  return {intent,bill:intent.invoice??null,queryOnly:true,clientIndependentFinality:false};
 });}
 async openInvoice(merchant,invoiceId){return this.#run({merchant,invoiceId},'reading',async current=>{const bill=await this.#pay.readInvoice(merchant,invoiceId,current);current();return {bill,clientIndependentFinality:false};});}
 async openIntent(intentId){return this.#run({intentId},'reading',async current=>{const intent=await this.#pay.readInvoiceIntent(intentId,current);current();return {intent,bill:intent.invoice??null,clientIndependentFinality:false};});}
 async reviewMerchantTerms(intentId){return this.#run({intentId},'reviewing',async current=>{if(!this.#merchant)throw failure('NATIVE_INVOICE_MAIN_SOURCE_UNAVAILABLE');const pending=await this.#merchant.requestMerchantTerms(intentId,current);return {walletRequest:pending.request,approvalRequired:true,bill:null};});}
 async reviewPayment(merchant,invoiceId){return this.#run({merchant,invoiceId},'reviewing',async current=>{if(!this.#actions)throw failure('NATIVE_INVOICE_MAIN_SOURCE_UNAVAILABLE');const pending=await this.#actions.requestSettlement(merchant,invoiceId,current);return {walletRequest:pending.request,approvalRequired:true,bill:null};});}
 async reviewRefund(merchant,invoiceId,refundId,amountAtoms){return this.#run({merchant,invoiceId,refundId},'reviewing',async current=>{if(!this.#actions)throw failure('NATIVE_INVOICE_MAIN_SOURCE_UNAVAILABLE');const pending=await this.#actions.requestRefund(merchant,invoiceId,refundId,amountAtoms,current);return {walletRequest:pending.request,approvalRequired:true,bill:null};});}
 // Normal Main entry: request its existing separate broadcast review. The
 // existing Main UI/Auth pipeline owns approval, durable UNKNOWN and dispatch.
 // This method never invokes approve(), a supplied send callback, or Core.
 async reviewOriginalBroadcast(reference){return this.#run(reference,'reviewing',async current=>{
  const {kind,merchant,invoiceId,intentId,originalHash}=reference;
  // Core's existing requestPQBroadcast(hash) has no Pay target association.
  // Only the fixed original P01 Pay review entry may select that target.
  if(typeof this.#runtime.main?.requestPQPayBroadcast!=='function')throw failure('NATIVE_PAY_MAIN_PAY_REVIEW_UNAVAILABLE');
  let original;
  if(kind==='invoice_terms'){
   if(!this.#merchant)throw failure('NATIVE_INVOICE_MAIN_SOURCE_UNAVAILABLE');
   original=await this.#merchant.readOriginalMerchantMember(intentId,originalHash,current);
  }else if(['invoice_settle','invoice_refund'].includes(kind)){
   if(!this.#actions)throw failure('NATIVE_INVOICE_MAIN_SOURCE_UNAVAILABLE');
   original=await this.#actions.readOriginalActionMember({merchant,invoiceId,kind,originalHash},current);
  }else throw failure('NATIVE_PAY_ACTION_REFERENCE_REQUIRED');
  const payReference=kind==='invoice_terms'?{hash:original.abciHash,kind,intentId}:{hash:original.abciHash,kind,merchant:original.merchant??merchant,invoiceId:original.invoiceId??invoiceId};
  current();const pending=await this.#runtime.main.requestPQPayBroadcast(Object.freeze(payReference));
  try{current();const review=pending?.request?.review;
   if(pending?.status!=='approval-required'||pending.request.method!=='ynx_broadcastPQNativeAction'||review.hash!==original.abciHash||review.memberHash!==original.nativeHash||review.account!==original.owner||review.operationId!==original.operationId||review.typedAction?.kind!==kind)throw failure('NATIVE_PAY_MAIN_BROADCAST_REVIEW_CHANGED');
  }catch(error){if(pending?.request?.id)try{rejectNativePayPending(this.#runtime.main,pending.request.id);}catch(cleanup){if(error&&typeof error==='object')error.cleanupCause=cleanup;}throw error;}
  return {walletRequest:pending.request,approvalRequired:true,bill:null,recovery:{...reference,nativeHash:original.nativeHash,abciHash:original.abciHash},clientIndependentFinality:false};
 });}
 // Compatibility command names now request the original Wallet's separate
 // Pay broadcast review only. Production never accepts a send/approval
 // callback here; the same original Main UI/Native pipeline owns execution.
 async submitMerchantTerms(intentId,originalHash){return this.reviewOriginalBroadcast({kind:'invoice_terms',merchant:'',invoiceId:'',intentId,originalHash});}
 async submitPayment(merchant,invoiceId,originalHash){return this.reviewOriginalBroadcast({kind:'invoice_settle',merchant,invoiceId,intentId:'',originalHash});}
 async submitRefund(merchant,invoiceId,originalHash){return this.reviewOriginalBroadcast({kind:'invoice_refund',merchant,invoiceId,intentId:'',originalHash});}
 async recoverInvoice(merchant,invoiceId,nativeHash){return this.#run({merchant,invoiceId,nativeHash},'recovering',async current=>{
  const before=await this.#pay.readInvoice(merchant,invoiceId,current);current();
  if(nativeHash&&!before.operations?.[nativeHash])throw failure('NATIVE_PAY_ORIGINAL_HASH_REQUIRED');
  return {bill:before,archive:{phase:'unavailable',reason:'NATIVE_PAY_ORIGINAL_PRODUCT_REFERENCE_REQUIRED'},queryOnly:true,clientIndependentFinality:false};
 });}
 async recoverArchivedInvoice(productId,sourceOrder,merchant,invoiceId,nativeHash){return this.#run({productId,sourceOrder,merchant,invoiceId,nativeHash},'recovering',async current=>{
  const original=await this.#originalProductIntent(productId,sourceOrder,current);
  if(original.merchant!==merchant||!/^0x[0-9a-f]{64}$/.test(nativeHash??''))throw failure('NATIVE_PAY_ORIGINAL_HASH_REQUIRED');
  if(typeof this.#runtime.readOriginalArchiveReceipt!=='function')throw failure('NATIVE_PAY_ARCHIVE_READER_UNAVAILABLE');
  const ref=Object.freeze({productId,sourceOrder,merchant,invoiceId,nativeHash});
  const value=await this.#runtime.readOriginalArchiveReceipt(ref,current);current();
  return {archiveReceipt:nativeArchiveReceiptData(value,original,ref),bill:null,queryOnly:true,clientIndependentFinality:false};
 });}
 async reconcileArchivedInvoice(productId,sourceOrder,merchant,invoiceId){return this.#run({productId,sourceOrder,merchant,invoiceId},'recovering',async current=>{
  const original=await this.#originalProductIntent(productId,sourceOrder,current);
  if(original.merchant!==merchant)throw failure('NATIVE_PAY_PRODUCT_REFERENCE_CHANGED');
  if(typeof this.#runtime.readOriginalArchiveReconciliation!=='function')throw failure('NATIVE_PAY_ARCHIVE_READER_UNAVAILABLE');
  const ref=Object.freeze({productId,sourceOrder,merchant,invoiceId});
  const value=await this.#runtime.readOriginalArchiveReconciliation(ref,current);current();
  return {reconciliation:nativeArchiveReconciliationData(value,original,ref),bill:null,queryOnly:true,clientIndependentFinality:false};
 });}
 async recoverIntent(intentId){return this.#run({intentId},'recovering',async current=>{await this.#pay.reconcileInvoiceIntent(intentId,current);current();const intent=await this.#pay.readInvoiceIntent(intentId,current);current();return {intent,bill:intent.invoice??null,queryOnly:true,clientIndependentFinality:false};});}
 async syncNotifications(merchant,invoiceId){return this.#run({merchant,invoiceId},'recovering',async current=>{
  let bill=await this.#pay.readInvoice(merchant,invoiceId,current);current();
  const inbox=this.#runtime.notificationInbox,readScope=this.#runtime.readNotificationScope;
  if(!inbox||typeof readScope!=='function')return {bill,notifications:{phase:'unavailable',reason:'NATIVE_PAY_NOTIFICATION_SCOPE_UNAVAILABLE'},queryOnly:true,clientIndependentFinality:false};
  let scope;
  try{const supplied=await readScope();current();if(typeof supplied.current!=='function')throw failure('NATIVE_PAY_NOTIFICATION_SCOPE_UNAVAILABLE');scope=Object.freeze({source:supplied.source,principal:supplied.principal,genesis:supplied.genesis,bindingDigest:supplied.bindingDigest,current:supplied.current});}
  catch(error){current();return {bill,notifications:{phase:'unavailable',reason:error.code??'NATIVE_PAY_NOTIFICATION_SCOPE_UNAVAILABLE'},queryOnly:true,clientIndependentFinality:false};}
  const scopeCurrent=()=>{current();if(scope.current()!==undefined)throw failure('NATIVE_PAY_NOTIFICATION_SCOPE_UNAVAILABLE');};
  let feed;
  try{feed=await this.#pay.readInvoiceEvents(merchant,invoiceId,scopeCurrent);scopeCurrent();
  if(feed.events.some(e=>e.merchant!==merchant||e.invoiceId!==invoiceId||e.genesis!==bill.genesis||e.sourceOrder!==bill.sourceOrder||e.sessionId!==bill.sessionId))throw failure('NATIVE_PAY_EVENT_REFERENCE_MISMATCH');
  inbox.stage(scope,feed.events,scopeCurrent);
  }catch(error){scopeCurrent();return {bill,notifications:{phase:'unavailable',reason:error.code??'NATIVE_PAY_EVENT_READ_UNAVAILABLE'},queryOnly:true,clientIndependentFinality:false};}
  const pending=inbox.pending(scope,merchant,invoiceId,scopeCurrent);let refreshed=0,reason=null;
  for(const event of pending){
   try{
    scopeCurrent();const original=bill.operations?.[event.nativeHash];
    if(!original||original.status!=='confirmed'||!original.effect||original.abciHash!==event.abciHash||original.kind!==event.kind||original.effect.merchant!==event.merchant||original.effect.genesis!==event.genesis||original.effect.invoiceId!==event.invoiceId||original.effect.sessionId!==event.sessionId||original.effect.nativeHash!==event.nativeHash||original.effect.abciHash!==event.abciHash||original.effect.member!==event.memberIndex||original.effect.event!==event.eventIndex||original.effect.height!==event.executionHeight)throw failure('NATIVE_PAY_EVENT_ORIGINAL_UNAVAILABLE');
    if(typeof this.#runtime.refreshOriginalProduct!=='function')throw failure('NATIVE_PAY_PRODUCT_READER_UNAVAILABLE');
    // Existing Cloud/Shop original lookup only; never create/reprice/pay from
    // an event. The callback result is not used as a funds receipt.
    const observed=await this.#runtime.refreshOriginalProduct(Object.freeze({...event}),scopeCurrent);scopeCurrent();
    if(observed?.sourceOrder!==event.sourceOrder||observed?.queryOnly!==true)throw failure('NATIVE_PAY_PRODUCT_READER_UNAVAILABLE');
    inbox.refreshed(scope,event,scopeCurrent);refreshed++;
   }catch(error){scopeCurrent();reason=error.code??'NATIVE_PAY_NOTIFICATION_REFRESH_PENDING';break;}
  }
  bill=await this.#pay.readInvoice(merchant,invoiceId,scopeCurrent);scopeCurrent();
  return {bill,notifications:{phase:reason?'pending':'refreshed',refreshed,pending:inbox.pending(scope,merchant,invoiceId,scopeCurrent).length,reason},queryOnly:true,clientIndependentFinality:false};
 });}

}

// UI/CLI output excludes full Member/envelope/policy material. Facts stay the
// original authenticated Pay projection, never a locally invented paid receipt.
export function nativePaySummary(state){
 const bill=state.bill;
 const summary={phase:state.phase,reason:state.reason??null,reference:state.reference,approvalRequired:state.approvalRequired===true,queryOnly:state.queryOnly===true,recoveryOnly:state.recoveryOnly===true,clientIndependentFinality:false};
 if(bill)summary.bill=Object.fromEntries(['genesis','nativeChainId','merchant','invoiceId','sessionId','sourceOrder','status','refundStatus','assetId','unitVersion','principalAtoms','paidAtoms','refundedAtoms','netPaidAtoms','termsFeeAtoms','paymentFeeAtoms','refundFeeAtoms','feeRule','maxFeeAtoms','expiresAtHeight','termsNativeHash','settlementNativeHash'].map(k=>[k,bill[k]]));
 if(bill?.operations)summary.operations=Object.values(bill.operations).map(op=>({nativeHash:op.nativeHash,abciHash:op.abciHash,kind:op.kind,status:op.status,failure:op.failure??null}));
 if(state.intent)summary.intent={intentId:state.intent.intentId,originalOperation:state.intent.originalOperation,state:state.intent.state,phase:state.intent.phase,termsNativeHash:state.intent.termsNativeHash};
 if(state.walletRequest)summary.walletRequest={id:state.walletRequest.id,method:state.walletRequest.method,review:state.walletRequest.review.invoice??{title:state.walletRequest.review.title},approvalRequired:true};
 if(state.recovery)summary.recovery=state.recovery;
 if(state.notifications)summary.notifications=state.notifications;
 if(state.archive)summary.archive=state.archive;
 if(state.archiveReceipt)summary.archiveReceipt=state.archiveReceipt;
 if(state.reconciliation)summary.reconciliation=state.reconciliation;
 return summary;
}
