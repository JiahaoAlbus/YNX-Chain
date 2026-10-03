import {randomUUID} from "node:crypto";
import {evmAddressFromYNX} from "@ynx-chain/wallet-auth";
import {createProtectedDesktopPayFlow} from "./wallet-pay-flow.mjs";
import {verifyWalletPayQuote} from "./wallet-pay-quote.mjs";
import {walletPayInvoiceID} from "./wallet-pay-invoice-reference-id.mjs";
const fail=code=>{throw Object.assign(new Error(code),{code})};
const stage=entry=>entry.settlement?"settled":entry.settlementAttempted?"settlement_unknown":entry.evidence?"settlement_pending":"transfer_unconfirmed";
function summary(entry,status=stage(entry)){
  const {record}=entry;
  return Object.freeze({account:record.account,hash:record.transfer.hash,invoiceId:record.invoice.id,merchant:record.invoice.merchantName,recipient:record.invoice.payoutAddress,
    amount:record.invoice.amount,fee:record.invoice.fee,total:record.intent.total,status,checkpointVerified:!!entry.evidence,settlementVerified:!!entry.settlement,
    settlementAttempted:entry.settlementAttempted,broadcastAttempted:entry.broadcastAttempted,consensusFinality:false});
}
/** Main-only service. compose() is deliberately NOT exposed to IPC, renderer,
 * command-line args or env. A must supply admitted real ports in its normal
 * boot composition; the shipped default remains explicit unavailable.
 * Review IDs refer only to verified main-held quotes, never renderer packets.
 */
export function createDesktopPayService({getContext,getIdentity,getRuntime,now=Date.now,id=randomUUID}){
  let integration=null,flow=null,review=null,epoch=0,active=null;
  const contextGuard=()=>{
    const before=getContext(),generation=epoch;
    const guard=()=>{const after=getContext();if(generation!==epoch||!before.account||before.locked||before.changing||!before.focused||after.locked||after.changing||!after.focused||before.account!==after.account||before.revision!==after.revision)fail("PAY_REVIEW_CANCELLED")};
    guard();return {before,guard};
  };
  const required=()=>{if(!flow||!integration)fail("PAY_PROTECTED_INTEGRATION_UNAVAILABLE")};
  const operation=async action=>{
    required();if(active)fail("PAY_OPERATION_BUSY");const captured=contextGuard();active=captured;
    try{return await action(captured)}finally{if(active===captured)active=null}
  };
  const identity=async(before,guard)=>{
    guard();const value=await getIdentity();guard();
    const selected=value?.accounts?.find(entry=>entry.account===before.account);
    if(value?.account!==before.account||!selected||selected.ynxAccount!==value.ynxAccount||evmAddressFromYNX(value.ynxAccount)!==before.account||typeof selected.publicKey!=="string"||value.recoveryRequired)fail("PAY_PROTECTED_IDENTITY_MISMATCH");
    return {account:value.ynxAccount,accountPublicKey:selected.publicKey};
  };
  const service=Object.freeze({
    compose(input){
      if(integration||active)fail("PAY_PROTECTED_INTEGRATION_ALREADY_CONFIGURED");
      if(typeof input?.quoteProvider?.reviewInvoice!=="function")fail("PAY_PROTECTED_INTEGRATION_REQUIRED");
      const runtime=getRuntime();
      // The vault, journal and lifecycle come from the actual Wallet runtime,
      // not from A's input or a new account/profile store.
      const candidate=createProtectedDesktopPayFlow({...input,...runtime,now,assertCurrent:()=>{if(!active)fail("PAY_REVIEW_CANCELLED");active.guard()}});
      integration=Object.freeze({...input,quoteProvider:Object.freeze({reviewInvoice:input.quoteProvider.reviewInvoice.bind(input.quoteProvider)})});flow=candidate;
    },
    status(){return Object.freeze({available:!!flow,reason:flow?null:"PAY_PROTECTED_INTEGRATION_UNAVAILABLE",paymentAuthorized:false})},
    cancel(){epoch++;review=null;return {cancelled:true,originalRetained:true}},
    review(reference){
      // Editing or re-querying also retires a pending review before its await.
      if(active)fail("PAY_OPERATION_BUSY");epoch++;review=null;
      return operation(async({before,guard})=>{
        const invoiceId=walletPayInvoiceID(reference),selected=await identity(before,guard);
        const restored=await flow.restore(selected.account);guard();if(restored)return {kind:"original",original:summary(restored.entry)};
        const paid=(await flow.history(selected.account)).find(entry=>entry.record.invoice.id===invoiceId);guard();
        if(paid)return {kind:"archived",original:summary(paid,"archived")};
        const value=await integration.quoteProvider.reviewInvoice(invoiceId,{...selected,guard});guard();
        const quote=verifyWalletPayQuote(value?.rawInvoice,value?.rawIntent,integration.policy,guard,now());
        if(quote.invoice.id!==invoiceId)fail("PAY_SIGNED_INVOICE_ID_MISMATCH");
        const token=id();if(typeof token!=="string"||!token||token.length>128)fail("PAY_REVIEW_INVALID");
        review={id:token,guard,request:{rawInvoice:quote.invoice,rawIntent:quote.intent,reviewedIntentDigest:quote.intentDigest,review:{...selected,to:quote.intent.payoutAddress,amount:quote.intent.amount}}};
        return {kind:"review",review:{id:token,account:selected.account,invoiceId,merchant:quote.invoice.merchantName,recipient:quote.invoice.payoutAddress,
          amount:quote.intent.amount,fee:quote.intent.fee,total:quote.intent.total,expiresAt:quote.intent.quoteExpiresAt,intentDigest:quote.intentDigest,paymentAuthorized:false}};
      });
    },
    action(input){return operation(async({before,guard})=>{
      if(!input||Object.keys(input).sort().join()!=="action,id"||typeof input.id!=="string"||input.id.length>128)fail("PAY_ACTION_INVALID");
      const selected=await identity(before,guard);
      if(input.action==="approve"){
        const original=review;review=null;
        if(!original||original.id!==input.id||original.request.review.account!==selected.account)fail("PAY_REVIEW_INVALID");original.guard();guard();
        const approved=await flow.approve(original.request);guard();
        return {kind:"original",original:summary({record:approved.record,broadcastAttempted:true,evidence:null,settlementAttempted:false,settlement:null})};
      }
      const restored=await flow.restore(selected.account);guard();
      if(!restored&&input.action==="done"){
        const archived=await flow.done(selected.account,input.id);guard();return {kind:"archived",original:summary(archived,"archived")};
      }
      if(!restored||restored.entry.record.transfer.hash!==input.id)fail("PAY_SIGNED_ORIGINAL_BINDING_MISMATCH");
      let entry;
      if(input.action==="check")entry=await flow.checkOriginal(selected.account);
      else if(input.action==="settle")entry=await flow.settleOriginal(selected.account);
      else if(input.action==="receipt")entry=await flow.readOriginalReceipt(selected.account);
      else if(input.action==="done")entry=await flow.done(selected.account,input.id);
      else fail("PAY_ACTION_INVALID");
      guard();return {kind:input.action==="done"?"archived":"original",original:summary(entry,input.action==="done"?"archived":stage(entry))};
    })},
    restore(){return operation(async({before,guard})=>{
      review=null;const selected=await identity(before,guard),restored=await flow.restore(selected.account);guard();
      return {kind:"original",original:restored?summary(restored.entry):null};
    })},
    history(cursor=null){return operation(async({before,guard})=>{
      if(cursor!==null&&(typeof cursor!=="string"||!/^0x[0-9a-f]{64}$/.test(cursor)))fail("PAY_HISTORY_CURSOR_INVALID");
      const selected=await identity(before,guard),records=(await flow.history(selected.account)).slice().reverse();guard();
      const offset=cursor===null?0:records.findIndex(entry=>entry.record.transfer.hash===cursor)+1;if(cursor!==null&&offset===0)fail("PAY_HISTORY_CURSOR_INVALID");
      const page=records.slice(offset,offset+50),nextCursor=offset+50<records.length?page.at(-1).record.transfer.hash:null;
      return {account:selected.account,records:page.map(entry=>summary(entry,"archived")),nextCursor};
    })},
  });
  return service;
}
export function installDesktopPayIPC({handleWalletIPC,safeIPC,service}){
  // handleWalletIPC enforces the exact installed live main frame for EVERY
  // handler, including public-looking status and cancel. No raw ipcMain bypass.
  handleWalletIPC("wallet:pay-status",()=>safeIPC(()=>service.status()));
  handleWalletIPC("wallet:pay-review",(_event,reference)=>safeIPC(()=>service.review(reference)));
  handleWalletIPC("wallet:pay-action",(_event,input)=>safeIPC(()=>service.action(input)));
  handleWalletIPC("wallet:pay-restore",()=>safeIPC(()=>service.restore()));
  handleWalletIPC("wallet:pay-history",(_event,cursor)=>safeIPC(()=>service.history(cursor??null)));
  handleWalletIPC("wallet:pay-cancel",()=>safeIPC(()=>service.cancel()));
}
