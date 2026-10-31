import {createNativeInvoiceMerchantApproval,createNativePayActionApproval} from './merchant-invoice-approval.mjs';
const failure=code=>Object.assign(Error(code),{code});
const clone=value=>structuredClone(value);

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
  catch(error){if(revision===this.#revision){let recovery;try{this.#runtime.current();recovery=this.#state.recovery;}catch{}this.#state={phase:'unavailable',reason:error.code??'NATIVE_PAY_OPERATION_UNAVAILABLE',reference:clone(reference),bill:null,recoveryOnly:phase==='submitting',...(recovery?{recovery}: {})};}throw error;}
 }
 async openInvoice(merchant,invoiceId){return this.#run({merchant,invoiceId},'reading',async current=>{const bill=await this.#pay.readInvoice(merchant,invoiceId);current();return {bill,clientIndependentFinality:false};});}
 async openIntent(intentId){return this.#run({intentId},'reading',async current=>{const intent=await this.#pay.readInvoiceIntent(intentId);current();return {intent,bill:intent.invoice??null,clientIndependentFinality:false};});}
 async reviewMerchantTerms(intentId){return this.#run({intentId},'reviewing',async current=>{if(!this.#merchant)throw failure('NATIVE_INVOICE_MAIN_SOURCE_UNAVAILABLE');const pending=await this.#merchant.requestMerchantTerms(intentId,current);return {walletRequest:pending.request,approvalRequired:true,bill:null};});}
 async reviewPayment(merchant,invoiceId){return this.#run({merchant,invoiceId},'reviewing',async current=>{if(!this.#actions)throw failure('NATIVE_INVOICE_MAIN_SOURCE_UNAVAILABLE');const pending=await this.#actions.requestSettlement(merchant,invoiceId,current);return {walletRequest:pending.request,approvalRequired:true,bill:null};});}
 async reviewRefund(merchant,invoiceId,refundId,amountAtoms){return this.#run({merchant,invoiceId,refundId},'reviewing',async current=>{if(!this.#actions)throw failure('NATIVE_INVOICE_MAIN_SOURCE_UNAVAILABLE');const pending=await this.#actions.requestRefund(merchant,invoiceId,refundId,amountAtoms,current);return {walletRequest:pending.request,approvalRequired:true,bill:null};});}
 // The original Main/Auth callee owns the actual protected approval and its
 // durable submission reservation. It must call send from that same context.
 // A boolean, callback response, pasted Member or CLI flag grants nothing.
 async #submit(reference,read,send){return this.#run(reference,'submitting',async current=>{
  if(typeof this.#runtime.withSubmissionApproval!=='function')throw failure('NATIVE_PAY_BROADCAST_APPROVAL_UNAVAILABLE');
  const original=await read(current);current();this.#state.recovery={...reference,nativeHash:original.nativeHash,abciHash:original.abciHash};let entered=false;
  const result=await this.#runtime.withSubmissionApproval(Object.freeze({...reference,nativeHash:original.nativeHash,abciHash:original.abciHash,mainOperationId:original.operationId}),async()=>{
   current();if(entered)throw failure('NATIVE_PAY_ORIGINAL_SEND_ALREADY_ENTERED');entered=true;
   // No retry/catch-and-send path. Original Main and Pay archival survive all
   // late focus/logout/network failures before any UI result is published.
   return send(original,current);
  });current();if(!entered)throw failure('NATIVE_PAY_BROADCAST_APPROVAL_UNAVAILABLE');
  return {result,bill:null,recovery:{...reference,nativeHash:original.nativeHash,abciHash:original.abciHash},clientIndependentFinality:false};
 });}
 async submitMerchantTerms(intentId,originalHash){return this.#submit({intentId,kind:'invoice_terms',originalHash},current=>{if(!this.#merchant)throw failure('NATIVE_INVOICE_MAIN_SOURCE_UNAVAILABLE');return this.#merchant.readOriginalMerchantMember(intentId,originalHash,current);},(original,current)=>{current();return this.#pay.submitMerchantMember(intentId,Buffer.from(original.member,'base64'));});}
 async submitPayment(merchant,invoiceId,originalHash){return this.#submit({merchant,invoiceId,kind:'invoice_settle',originalHash},current=>{if(!this.#actions)throw failure('NATIVE_INVOICE_MAIN_SOURCE_UNAVAILABLE');return this.#actions.readOriginalActionMember({merchant,invoiceId,kind:'invoice_settle',originalHash},current);},(original,current)=>{current();return this.#pay.submitSettlement(merchant,invoiceId,Buffer.from(original.member,'base64'));});}
 async submitRefund(merchant,invoiceId,originalHash){return this.#submit({merchant,invoiceId,kind:'invoice_refund',originalHash},current=>{if(!this.#actions)throw failure('NATIVE_INVOICE_MAIN_SOURCE_UNAVAILABLE');return this.#actions.readOriginalActionMember({merchant,invoiceId,kind:'invoice_refund',originalHash},current);},(original,current)=>{current();return this.#pay.submitRefund(merchant,invoiceId,Buffer.from(original.member,'base64'));});}
 async recoverInvoice(merchant,invoiceId,nativeHash){return this.#run({merchant,invoiceId,nativeHash},'recovering',async current=>{
  const before=await this.#pay.readInvoice(merchant,invoiceId);current();
  if(nativeHash){if(!before.operations?.[nativeHash])throw failure('NATIVE_PAY_ORIGINAL_HASH_REQUIRED');await this.#pay.reconcileOperation(merchant,invoiceId,nativeHash);current();}
  const bill=await this.#pay.readInvoice(merchant,invoiceId);current();return {bill,queryOnly:true,clientIndependentFinality:false};
 });}
 async recoverIntent(intentId){return this.#run({intentId},'recovering',async current=>{await this.#pay.reconcileInvoiceIntent(intentId);current();const intent=await this.#pay.readInvoiceIntent(intentId);current();return {intent,bill:intent.invoice??null,queryOnly:true,clientIndependentFinality:false};});}
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
 return summary;
}
