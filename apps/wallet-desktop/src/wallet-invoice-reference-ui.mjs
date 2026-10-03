import {walletPayInvoiceID} from "./wallet-pay-invoice-reference-id.mjs";
/** Public reference UI. No signer, payment session or transaction method. */
export function createInvoiceReferenceUI({getContext,request,render}) {
  let revision=0;
  const clear=()=>{revision++;render({busy:false,result:null,error:null})};
  async function check(reference){
    const before=getContext(),current=++revision;
    const live=()=>{const after=getContext();return current===revision&&before.open&&after.open&&Boolean(before.account)&&before.account===after.account&&before.keyRevision===after.keyRevision};
    if(!live())return;
    render({busy:true,result:null,error:null});
    try{
      const id=walletPayInvoiceID(reference),response=await request(reference);if(!live())return;
      const result=response?.value;
      if(!response?.ok||result?.invoice?.id!==id||result.account!==before.account||result.trust!=="legacy-service-projection-not-signed-invoice"||result.paymentAuthorized!==false||result.settlementVerified!==false||result.source!=="https://api.ynxweb4.com")throw Object.assign(new Error(),{code:response?.error?.code});
      render({busy:false,result,error:null});
    }catch(error){if(live())render({busy:false,result:null,error:error?.code==="PAY_SESSION_REQUIRED"?"The Pay service requires its account session. This query did not sign or pay anything.":"The invoice reference could not be checked at the configured Pay service. Retry or cancel; no payment was authorized."})}
  }
  return {clear,check};
}
