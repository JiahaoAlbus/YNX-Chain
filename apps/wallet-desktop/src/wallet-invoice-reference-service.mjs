import {WalletPayInvoiceClient} from "./wallet-pay-invoice-reference.mjs";
export function createInvoiceReferenceService({client=new WalletPayInvoiceClient(),getContext}) {
  return async reference=>{
    const before=getContext();
    const guard=()=>{
      const current=getContext();
      if(!before.account||!before.focused||before.changing||!current.focused||current.changing||current.account!==before.account||current.revision!==before.revision)
        throw Object.assign(new Error("Wallet context changed. Query this invoice again."),{code:"PAY_READ_CANCELLED"});
    };
    guard();const invoice=await client.invoice(reference,guard);guard();
    return {invoice,account:before.account,source:client.origin,trust:"legacy-service-projection-not-signed-invoice",paymentAuthorized:false,settlementVerified:false};
  };
}
