import {types} from 'node:util';
import {createNativeInvoiceMerchantApproval,createNativePayActionApproval,retainOriginalPayReview} from './merchant-invoice-approval.mjs';
import {nativeInvoiceProductIntentData,nativeInvoiceOrderBindingDATA,assertNativeInvoiceOrderBillDATA,nativeInvoiceOrderOperationDATA,assertNativeInvoiceOriginalOperationDATA} from './invoice-product-intent.mjs';
import {nativeArchiveReceiptData,nativeArchiveReconciliationData} from './archive-receipt.mjs';
const failure=code=>Object.assign(Error(code),{code});
const clone=value=>structuredClone(value);
// Wallet provider errors keep their precise domain code in data.code; the
// numeric outer provider code must not hide a missing production Source.
function own(value,key){
 if(!value||typeof value!=='object'||types.isProxy(value))return undefined;
 const field=Object.getOwnPropertyDescriptor(value,key);
 return field&&Object.hasOwn(field,'value')?field.value:undefined;
}
export function nativePayFailureCode(error,fallback='NATIVE_PAY_OPERATION_UNAVAILABLE'){
 for(const code of [own(own(error,'data'),'code'),own(error,'code')])if(typeof code==='string'&&/^[A-Za-z0-9_:-]{1,128}$/.test(code))return code;
 return fallback;
}
const referenceFields=['productId','sourceOrder','merchant','invoiceId','intentId','nativeHash','originalHash','kind','refundId'];
function readReference(value){
 if(!value||typeof value!=='object'||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)return null;
 const out={};
 for(const key of referenceFields){const v=own(value,key);if(typeof v==='string'&&v.length<=256)out[key]=v;}
 return Object.keys(out).length?out:null;
}
// Same-reference query DATA only. An ABCI originalHash is never relabelled as
// a nativeHash, and no returned action creates, signs, approves or resends.
export function nativePayRecoveryActions(reference,{protectedOrder=false}={}){
 const r=readReference(reference);if(!r)return [];
 const retainedIntent=/^npi_[0-9a-f]{48}$/.test(r.intentId??'');
 const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(v),merchant=/^0x[0-9a-f]{40}$/.test(r.merchant??''),hash=/^0x[0-9a-f]{64}$/.test(r.nativeHash??'');
 // Only the private host may unwrap this selector and supply its original
 // holder. The generic Main entry cannot dispatch this recovery descriptor.
 if(protectedOrder)return retainedIntent&&r.productId==='shop.order'&&id(r.sourceOrder)
  ?[{requiresOriginalHolder:true,request:{action:'order-invoice',productId:r.productId,sourceOrder:r.sourceOrder}}]:[];
 if(r.kind==='invoice_terms'&&id(r.productId)&&id(r.sourceOrder))return [{action:'lookup-intent',productId:r.productId,sourceOrder:r.sourceOrder}];
 if(id(r.productId)&&id(r.sourceOrder)){
  if(merchant&&id(r.invoiceId))return [{action:hash?'recover-archive':'reconcile-archive',productId:r.productId,sourceOrder:r.sourceOrder,merchant:r.merchant,invoiceId:r.invoiceId,...(hash?{nativeHash:r.nativeHash}:{})}];
  return [{action:'lookup-intent',productId:r.productId,sourceOrder:r.sourceOrder}];
 }
 if(retainedIntent)return [{action:'intent',intentId:r.intentId}];
 if(merchant&&id(r.invoiceId))return [{action:hash?'recover':'invoice',merchant:r.merchant,invoiceId:r.invoiceId,...(hash?{nativeHash:r.nativeHash}:{})}];
 return [];
}
// Private diagnostic association only. Structured-cloned renderer DATA has
// no entry; this is neither a new transaction journal nor an authorization.
const failureCauses=new WeakMap();
export function readNativePayFailureCause(result){
 return failureCauses.has(result)?{present:true,cause:failureCauses.get(result)}:{present:false};
}
export function nativePayFailureResultDATA(error,state=null,options){
 const code=nativePayFailureCode(error),reference=readReference(own(state,'reference')),status=own(error,'status');
 const result={version:'ynx.pay.main-result/v1',ok:false,phase:'unavailable',reason:code,code,reference,
  recoveryOnly:own(state,'recoveryOnly')===true,recoveryActions:nativePayRecoveryActions(reference,options),canRetry:false,
  clientIndependentFinality:false,paymentAuthorized:false,outcome:'UNKNOWN',
  ...(Number.isInteger(status)&&status>=100&&status<=599?{httpStatus:status}:{})};
 failureCauses.set(result,error);return result;
}

/** Client orchestration only. Pay owns invoice/funds/outbox state and Main owns
 * approvals, original Members and submission UNKNOWN. This client persists no
 * second transaction journal, balance, approval or retry counter. */
export class NativePayBusinessClient {
 #runtime; #pay; #merchant; #actions; #expectedOriginalOperation; #revision=0; #state={phase:'unavailable',reason:'NATIVE_PAY_SOURCE_UNAVAILABLE',reference:null,bill:null};
 constructor(runtime){
  if(typeof runtime?.current!=='function'||!runtime.pay)throw failure('NATIVE_PAY_SOURCE_UNAVAILABLE');
  this.#runtime=runtime;this.#pay=runtime.pay;
  this.#expectedOriginalOperation=runtime.expectedOriginalOperation;
  if(runtime.main){this.#merchant=createNativeInvoiceMerchantApproval({main:runtime.main,pay:this.#pay,reviewCustody:runtime.reviewCustody});this.#actions=createNativePayActionApproval({main:runtime.main,pay:this.#pay,readInvoiceOriginals:runtime.readInvoiceOriginals,reviewCustody:runtime.reviewCustody});}
 }
 snapshot(){return clone(this.#state);}
 invalidate(reason='NATIVE_PAY_SOURCE_UNAVAILABLE'){this.#revision++;this.#state={phase:'unavailable',reason,reference:null,bill:null};return this.snapshot();}
 #fence(revision){this.#runtime.current();if(revision!==this.#revision)throw failure('NATIVE_PAY_SELECTION_CHANGED');}
 async #run(reference,phase,work){
  const revision=++this.#revision,current=()=>this.#fence(revision);
  const signal=types.isProxy(this.#runtime.current)?undefined:Object.getOwnPropertyDescriptor(this.#runtime.current,'signal')?.value;
  if(signal!==undefined)Object.defineProperty(current,'signal',{value:signal});
  this.#state={phase,reason:null,reference:clone(reference),bill:null};
  try{current();const result=await work(current);current();this.#state={phase:'ready',reason:null,reference:clone(reference),...result};return this.snapshot();}
  catch(error){if(revision===this.#revision){let recovery;try{this.#runtime.current();recovery=this.#state.recovery;}catch{}this.#state={phase:'unavailable',reason:nativePayFailureCode(error),reference:clone(reference),bill:null,recoveryOnly:phase==='submitting'||phase==='creating-intent',...(recovery?{recovery}: {})};}throw error;}
 }
 async #originalProductIntent(productId,sourceOrder,current){
  if(typeof productId!=='string'||typeof sourceOrder!=='string'||![productId,sourceOrder].every(v=>/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(v)))throw failure('NATIVE_PAY_PRODUCT_REFERENCE_INVALID');
  const protectedOrder=this.#expectedOriginalOperation!==undefined;
  const reader=protectedOrder?'readOriginalShopInvoiceIntent':'readOriginalInvoiceIntent';
  if(typeof this.#runtime[reader]!=='function')throw failure(protectedOrder?'NATIVE_PAY_SHOP_ORIGINAL_SOURCE_NOT_SUPPLIED':'NATIVE_PAY_PRODUCT_ORIGINAL_UNAVAILABLE');
  current();const original=await this.#runtime[reader](Object.freeze({productId,sourceOrder}),current);current();
  const request=nativeInvoiceProductIntentData(original);
  if(request.productId!==productId||request.sourceOrder!==sourceOrder)throw failure('NATIVE_PAY_PRODUCT_REFERENCE_CHANGED');
  return request;
 }
 async #originalOrder(reference,current){
  const original=await this.#originalProductIntent(reference.productId,reference.sourceOrder,current);
  if(original.productId!=='shop.order')throw failure('NATIVE_PAY_INTENT_LOOKUP_UNAVAILABLE');
  const expected=this.#expectedOriginalOperation;
  let intent;
  if(expected===undefined){
   if(typeof this.#pay.lookupInvoiceIntent!=='function')throw failure('NATIVE_PAY_INTENT_LOOKUP_UNAVAILABLE');
   intent=await this.#pay.lookupInvoiceIntent(original,current);
  }else{
   // The host already holds the original intent ID. Read that exact record
   // through the existing GET, which does not reconcile or repair the Store.
   if(typeof expected!=='string'||!/^npi_[0-9a-f]{48}$/.test(expected))throw failure('NATIVE_PAY_MAIN_ORIGINAL_OPERATION_REQUIRED');
   if(typeof this.#pay.readInvoiceIntent!=='function')throw failure('NATIVE_PAY_INTENT_LOOKUP_UNAVAILABLE');
   intent=await this.#pay.readInvoiceIntent(expected,current);
  }
  current();
  const binding=nativeInvoiceOrderBindingDATA(intent,original);
  if(expected!==undefined&&binding.intentId!==expected)throw failure('NATIVE_PAY_ORIGINAL_OPERATION_CHANGED');
  Object.assign(reference,{merchant:binding.merchant,invoiceId:binding.terms.invoiceId,intentId:binding.intentId});
  if(binding.state==='PREPARED')reference.kind='invoice_terms';
  return {intent,binding};
 }
 #orderReviewReady(binding,kind){
  if(kind==='invoice_terms'?binding.state!=='PREPARED'||binding.phase!=='awaiting_merchant_approval'||binding.termsNativeHash!==''||binding.termsAbciHash!=='':binding.state!=='ISSUED')
   throw failure('NATIVE_PAY_ORIGINAL_RECONCILE_REQUIRED');
 }
 async openOriginalOrderInvoice(productId,sourceOrder){const reference={productId,sourceOrder};return this.#run(reference,'reading',async current=>{
  const {intent,binding}=await this.#originalOrder(reference,current);
  if(binding.state==='PREPARED'){
   if(binding.termsNativeHash==='')return {intent,bill:null,queryOnly:true,recoveryOnly:binding.phase!=='awaiting_merchant_approval',clientIndependentFinality:false};
   if(!/^0x[0-9a-f]{64}$/.test(binding.termsNativeHash)||!/^0x[0-9a-f]{64}$/.test(binding.termsAbciHash))throw failure('NATIVE_PAY_ORIGINAL_ORDER_BINDING');
   reference.nativeHash=binding.termsNativeHash;
   const bill=await this.#pay.readInvoice(binding.merchant,binding.terms.invoiceId,current);current();
   const operation=nativeInvoiceOrderOperationDATA(bill,binding,binding.termsNativeHash);
   if(operation.kind!=='invoice_terms')throw failure('NATIVE_PAY_ORIGINAL_OPERATION_CHANGED');
   return {intent,bill,queryOnly:true,recoveryOnly:true,clientIndependentFinality:false};
  }
  const bill=await this.#pay.readInvoice(binding.merchant,binding.terms.invoiceId,current);current();
  assertNativeInvoiceOrderBillDATA(bill,binding);return {intent,bill,queryOnly:true,clientIndependentFinality:false};
 });}
 async reviewOriginalOrderTerms(productId,sourceOrder){const reference={productId,sourceOrder};return this.#run(reference,'reviewing',async current=>{
  const {binding}=await this.#originalOrder(reference,current);this.#orderReviewReady(binding,'invoice_terms');
  if(!this.#merchant)throw failure('NATIVE_INVOICE_MAIN_SOURCE_UNAVAILABLE');
  const pending=await this.#merchant.requestMerchantTerms(binding.intentId,current,binding);
  return {walletRequest:pending.request,approvalRequired:true,bill:null,clientIndependentFinality:false};
 });}
 async #reviewOriginalOrderAction(productId,sourceOrder,refund){
  const reference={productId,sourceOrder,...(refund?{refundId:refund.refundId}:{})};
  return this.#run(reference,'reviewing',async current=>{
   const {binding}=await this.#originalOrder(reference,current);this.#orderReviewReady(binding,refund?'invoice_refund':'invoice_settle');
   if(!this.#actions)throw failure('NATIVE_INVOICE_MAIN_SOURCE_UNAVAILABLE');
   const pending=refund?await this.#actions.requestRefund(binding.merchant,binding.terms.invoiceId,refund.refundId,refund.amountAtoms,current,binding):
    await this.#actions.requestSettlement(binding.merchant,binding.terms.invoiceId,current,binding);
   return {walletRequest:pending.request,approvalRequired:true,bill:null,clientIndependentFinality:false};
  });
 }
 async reviewOriginalOrderPayment(productId,sourceOrder){return this.#reviewOriginalOrderAction(productId,sourceOrder);}
 async reviewOriginalOrderRefund(productId,sourceOrder,refundId,amountAtoms){return this.#reviewOriginalOrderAction(productId,sourceOrder,{refundId,amountAtoms});}
 async recoverOriginalOrderReceipt(productId,sourceOrder,nativeHash){const reference={productId,sourceOrder,nativeHash};return this.#run(reference,'recovering',async current=>{
  const {binding}=await this.#originalOrder(reference,current);this.#orderReviewReady(binding,'invoice_settle');
  if(!/^0x[0-9a-f]{64}$/.test(nativeHash??''))throw failure('NATIVE_PAY_ORIGINAL_HASH_REQUIRED');
  if(typeof this.#runtime.readOriginalArchiveReceipt!=='function')throw failure('NATIVE_PAY_ARCHIVE_READER_UNAVAILABLE');
  const ref=Object.freeze({productId,sourceOrder,merchant:binding.merchant,invoiceId:binding.terms.invoiceId,nativeHash});
  const value=await this.#runtime.readOriginalArchiveReceipt(ref,current);current();
  const receipt=nativeArchiveReceiptData(value,binding.original,ref);
  if(receipt.sessionId!==binding.terms.sessionId||receipt.termsHash!==binding.signingMessageHash)throw failure('NATIVE_PAY_ORIGINAL_ORDER_BINDING');
  return {archiveReceipt:receipt,bill:null,queryOnly:true,clientIndependentFinality:false};
 });}
 async reconcileOriginalOrder(productId,sourceOrder){const reference={productId,sourceOrder};return this.#run(reference,'recovering',async current=>{
  const {binding}=await this.#originalOrder(reference,current);this.#orderReviewReady(binding,'invoice_settle');
  if(typeof this.#runtime.readOriginalArchiveReconciliation!=='function')throw failure('NATIVE_PAY_ARCHIVE_READER_UNAVAILABLE');
  const ref=Object.freeze({productId,sourceOrder,merchant:binding.merchant,invoiceId:binding.terms.invoiceId});
  const value=await this.#runtime.readOriginalArchiveReconciliation(ref,current);current();
  const reconciliation=nativeArchiveReconciliationData(value,binding.original,ref);
  if(reconciliation.receipts.some(row=>row.sessionId!==binding.terms.sessionId||row.termsHash!==binding.signingMessageHash))throw failure('NATIVE_PAY_ORIGINAL_ORDER_BINDING');
  return {reconciliation,bill:null,queryOnly:true,clientIndependentFinality:false};
 });}
 async reconcileOriginalOrderOperation(productId,sourceOrder,nativeHash){const reference={productId,sourceOrder,nativeHash};return this.#run(reference,'recovering',async current=>{
  if(!/^0x[0-9a-f]{64}$/.test(nativeHash??''))throw failure('NATIVE_PAY_ORIGINAL_HASH_REQUIRED');
  const {binding}=await this.#originalOrder(reference,current);
  let bill=await this.#pay.readInvoice(binding.merchant,binding.terms.invoiceId,current);current();
  let observed=nativeInvoiceOrderOperationDATA(bill,binding,nativeHash);
  if(observed.kind==='invoice_terms')reference.kind='invoice_terms';
  // A lost reconcile response can leave an already terminal original. Read
  // its archive directly. Only an unresolved original needs a proof request.
  if(!['confirmed','confirmed_failed'].includes(observed.status)){
   if(typeof this.#pay.reconcileOperation!=='function')throw failure('NATIVE_PAY_ORIGINAL_RECONCILER_UNAVAILABLE');
   const result=await this.#pay.reconcileOperation(binding.merchant,binding.terms.invoiceId,nativeHash,current);current();
   assertNativeInvoiceOriginalOperationDATA(result,observed);
   const reconciled={...observed,status:Object.getOwnPropertyDescriptor(result,'status').value};
   bill=await this.#pay.readInvoice(binding.merchant,binding.terms.invoiceId,current);current();
   observed=nativeInvoiceOrderOperationDATA(bill,binding,nativeHash);
   assertNativeInvoiceOriginalOperationDATA(observed,reconciled);
  }
  let archiveReceipt;
  if(['invoice_settle','invoice_refund'].includes(observed.kind)&&['confirmed','confirmed_failed'].includes(observed.status)){
   if(typeof this.#runtime.readOriginalArchiveReceipt!=='function')throw failure('NATIVE_PAY_ARCHIVE_READER_UNAVAILABLE');
   const ref=Object.freeze({productId,sourceOrder,merchant:binding.merchant,invoiceId:binding.terms.invoiceId,nativeHash});
   const value=await this.#runtime.readOriginalArchiveReceipt(ref,current);current();
   archiveReceipt=nativeArchiveReceiptData(value,binding.original,ref);
   if(archiveReceipt.sessionId!==binding.terms.sessionId||archiveReceipt.termsHash!==binding.signingMessageHash||archiveReceipt.kind!==observed.kind||archiveReceipt.abciHash!==observed.abciHash||archiveReceipt.status!==observed.status)throw failure('NATIVE_PAY_ORIGINAL_OPERATION_CHANGED');
  }
  return {bill,reconciledOriginal:observed,...(archiveReceipt?{archiveReceipt}:{}),queryOnly:true,clientIndependentFinality:false};
 });}
 #originalIntentResult(original,intent,reference,queryOnly){
  const result={intent,bill:intent.invoice??null,clientIndependentFinality:false};
  if(queryOnly)result.queryOnly=true;
  if(original.productId!=='shop.order')return result;

  const binding=nativeInvoiceOrderBindingDATA(intent,original);
  if(binding.state==='ISSUED'){
   assertNativeInvoiceOrderBillDATA(intent.invoice,binding);
   return result;
  }

  Object.assign(reference,{merchant:binding.merchant,invoiceId:binding.terms.invoiceId,intentId:binding.intentId,kind:'invoice_terms'});
  const hasOriginalTerms=binding.termsNativeHash!=='';
  if(hasOriginalTerms){
   reference.nativeHash=binding.termsNativeHash;
   nativeInvoiceOrderOperationDATA(intent.invoice,binding,binding.termsNativeHash);
  }
  return {...result,bill:hasOriginalTerms?intent.invoice:null,recoveryOnly:hasOriginalTerms||binding.phase!=='awaiting_merchant_approval'};
 }
 async createInvoiceIntent(productId,sourceOrder){const reference={productId,sourceOrder};return this.#run(reference,'creating-intent',async current=>{
  if(typeof this.#pay.createInvoiceIntent!=='function')throw failure('NATIVE_PAY_INTENT_PRODUCER_UNAVAILABLE');
  const original=await this.#originalProductIntent(productId,sourceOrder,current);current();
  const intent=await this.#pay.createInvoiceIntent(original,current);current();
  return this.#originalIntentResult(original,intent,reference,false);
 });}
 async lookupOriginalInvoiceIntent(productId,sourceOrder){const reference={productId,sourceOrder};return this.#run(reference,'recovering',async current=>{
  if(typeof this.#pay.lookupInvoiceIntent!=='function')throw failure('NATIVE_PAY_INTENT_LOOKUP_UNAVAILABLE');
  const original=await this.#originalProductIntent(productId,sourceOrder,current);current();
  const intent=await this.#pay.lookupInvoiceIntent(original,current);current();
  return this.#originalIntentResult(original,intent,reference,true);
 });}
 async openInvoice(merchant,invoiceId){return this.#run({merchant,invoiceId},'reading',async current=>{const bill=await this.#pay.readInvoice(merchant,invoiceId,current);current();return {bill,clientIndependentFinality:false};});}
 async openIntent(intentId){return this.#run({intentId},'reading',async current=>{const intent=await this.#pay.readInvoiceIntent(intentId,current);current();return {intent,bill:intent.invoice??null,clientIndependentFinality:false};});}
 async reviewMerchantTerms(intentId){return this.#run({intentId},'reviewing',async current=>{if(!this.#merchant)throw failure('NATIVE_INVOICE_MAIN_SOURCE_UNAVAILABLE');const pending=await this.#merchant.requestMerchantTerms(intentId,current);return {walletRequest:pending.request,approvalRequired:true,bill:null};});}
 async reviewPayment(merchant,invoiceId){return this.#run({merchant,invoiceId},'reviewing',async current=>{if(!this.#actions)throw failure('NATIVE_INVOICE_MAIN_SOURCE_UNAVAILABLE');const pending=await this.#actions.requestSettlement(merchant,invoiceId,current);return {walletRequest:pending.request,approvalRequired:true,bill:null};});}
 async reviewRefund(merchant,invoiceId,refundId,amountAtoms){return this.#run({merchant,invoiceId,refundId},'reviewing',async current=>{if(!this.#actions)throw failure('NATIVE_INVOICE_MAIN_SOURCE_UNAVAILABLE');const pending=await this.#actions.requestRefund(merchant,invoiceId,refundId,amountAtoms,current);return {walletRequest:pending.request,approvalRequired:true,bill:null};});}
 // Normal Main entry: request its existing separate broadcast review. The
 // existing Main UI/Auth pipeline owns approval, durable UNKNOWN and dispatch.
 // This method never invokes approve(), a supplied send callback, or Core.
 async #reviewOriginalBroadcast(reference,current,originalOrder){
  const {kind,merchant,invoiceId,intentId,originalHash}=reference;
  // Core's existing requestPQBroadcast(hash) has no Pay target association.
  // Only the fixed original P01 Pay review entry may select that target.
  if(typeof this.#runtime.main?.requestPQPayBroadcast!=='function')throw failure('NATIVE_PAY_MAIN_PAY_REVIEW_UNAVAILABLE');
  let original;
  if(kind==='invoice_terms'){
   if(!this.#merchant)throw failure('NATIVE_INVOICE_MAIN_SOURCE_UNAVAILABLE');
   original=await this.#merchant.readOriginalMerchantMember(intentId,originalHash,current,originalOrder);
  }else if(['invoice_settle','invoice_refund'].includes(kind)){
   if(!this.#actions)throw failure('NATIVE_INVOICE_MAIN_SOURCE_UNAVAILABLE');
   original=await this.#actions.readOriginalActionMember({merchant,invoiceId,kind,originalHash},current,originalOrder);
  }else throw failure('NATIVE_PAY_ACTION_REFERENCE_REQUIRED');
  const payReference=kind==='invoice_terms'?{hash:original.abciHash,kind,intentId}:{hash:original.abciHash,kind,merchant:original.merchant??merchant,invoiceId:original.invoiceId??invoiceId};
  current();const pending=await this.#runtime.main.requestPQPayBroadcast(Object.freeze(payReference));
  retainOriginalPayReview(this.#runtime.main,pending,current,()=>{const review=pending?.request?.review;
   if(pending?.status!=='approval-required'||pending.request.method!=='ynx_broadcastPQNativeAction'||review.hash!==original.abciHash||review.memberHash!==original.nativeHash||review.account!==original.owner||review.operationId!==original.operationId||review.typedAction?.kind!==kind)throw failure('NATIVE_PAY_MAIN_BROADCAST_REVIEW_CHANGED');
   if(originalOrder){
    const merchantTarget=originalOrder.merchant,invoiceTarget=originalOrder.terms.invoiceId;
    const requestPath=kind==='invoice_terms'?`/v5/pay/invoice-intents/${intentId}/merchant-member`:
     `/v5/pay/invoices/${merchantTarget}/${invoiceTarget}/${kind==='invoice_settle'?'settlements':'refunds'}`;
    const target={version:1,service:'pay',kind,intentId:kind==='invoice_terms'?intentId:null,merchant:merchantTarget,invoiceId:invoiceTarget,requestPath};
    if(Object.entries(target).some(([key,value])=>own(review.payTarget,key)!==value))throw failure('NATIVE_PAY_MAIN_BROADCAST_REVIEW_CHANGED');
   }
  },this.#runtime.reviewCustody);
  return {walletRequest:pending.request,approvalRequired:true,bill:null,recovery:{...reference,nativeHash:original.nativeHash,abciHash:original.abciHash},clientIndependentFinality:false};
 }
 async reviewOriginalBroadcast(reference){return this.#run(reference,'reviewing',current=>this.#reviewOriginalBroadcast(reference,current));}
 async reviewOriginalOrderBroadcast(productId,sourceOrder,kind,originalHash){const reference={productId,sourceOrder,kind,originalHash};return this.#run(reference,'reviewing',async current=>{
  const {binding}=await this.#originalOrder(reference,current);
  if(!['invoice_terms','invoice_settle','invoice_refund'].includes(kind))throw failure('NATIVE_PAY_ACTION_REFERENCE_REQUIRED');
  if(kind!=='invoice_terms'||this.#expectedOriginalOperation!==undefined)this.#orderReviewReady(binding,kind);
  return this.#reviewOriginalBroadcast(reference,current,binding);
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
export function nativePaySummary(state,options){
 const bill=state.bill;
 const summary={phase:state.phase,reason:state.reason??null,reference:state.reference,approvalRequired:state.approvalRequired===true,queryOnly:state.queryOnly===true,recoveryOnly:state.recoveryOnly===true,clientIndependentFinality:false,canRetry:false,recoveryActions:nativePayRecoveryActions(state.reference,options)};
 if(bill)summary.bill=Object.fromEntries(['genesis','nativeChainId','merchant','invoiceId','sessionId','sourceOrder','status','refundStatus','assetId','unitVersion','principalAtoms','paidAtoms','refundedAtoms','netPaidAtoms','termsFeeAtoms','paymentFeeAtoms','refundFeeAtoms','feeRule','maxFeeAtoms','expiresAtHeight','termsNativeHash','settlementNativeHash'].map(k=>[k,bill[k]]));
 if(bill?.operations)summary.operations=Object.values(bill.operations).map(op=>({nativeHash:op.nativeHash,abciHash:op.abciHash,kind:op.kind,status:op.status,failure:op.failure??null}));
 if(summary.operations){summary.pendingOriginals=summary.operations.filter(op=>['unknown','submitted'].includes(op.status)).map(op=>op.nativeHash);summary.outcomeUnknown=summary.pendingOriginals.length>0||bill.status==='unknown'||bill.refundStatus==='unknown';}
 if(state.intent)summary.intent={intentId:state.intent.intentId,originalOperation:state.intent.originalOperation,state:state.intent.state,phase:state.intent.phase,termsNativeHash:state.intent.termsNativeHash};
 if(['unknown','submitted'].includes(state.intent?.phase))summary.outcomeUnknown=true;
 if(state.walletRequest)summary.walletRequest={id:state.walletRequest.id,method:state.walletRequest.method,review:state.walletRequest.review.invoice??{title:state.walletRequest.review.title},approvalRequired:true};
 if(state.recovery)summary.recovery=state.recovery;
 if(state.notifications)summary.notifications=state.notifications;
 if(state.archive)summary.archive=state.archive;
 if(state.archiveReceipt)summary.archiveReceipt=state.archiveReceipt;
 if(state.reconciliation)summary.reconciliation=state.reconciliation;
 if(state.reconciledOriginal)summary.reconciledOriginal=state.reconciledOriginal;
 return summary;
}
