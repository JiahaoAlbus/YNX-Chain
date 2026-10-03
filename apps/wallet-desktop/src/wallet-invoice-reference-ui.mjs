import {walletPayInvoiceID} from "./wallet-pay-invoice-reference-id.mjs";
/** Public reference UI. No signer, payment session or transaction method. */
export function createInvoiceReferenceUI({getContext,request,render,requestQR,applyReference=()=>{}}) {
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
  async function importQR(readInput){
    const before=getContext(),current=++revision;
    const live=()=>{const after=getContext();return current===revision&&before.open&&after.open&&Boolean(before.account)&&before.account===after.account&&before.keyRevision===after.keyRevision};
    if(!live())return;
    render({busy:true,result:null,error:null,notice:"Reading the QR image on this device…"});
    try{
      const input=await readInput();if(!live())return;
      const response=await requestQR(input);if(!live())return;
      const value=response?.value;
      if(!response?.ok||value?.decodedLocally!==true||value.uploaded!==false||walletPayInvoiceID(value.invoiceID)!==value.invoiceID)throw new Error("Invalid QR reference");
      applyReference(value.invoiceID);
      render({busy:false,result:null,error:null,notice:"Invoice reference read locally. Review it, then choose Check at Pay service. Nothing was uploaded, queried or paid."});
    }catch{if(live())render({busy:false,result:null,error:"No supported Pay invoice reference was found. Choose another PNG, JPEG or WebP QR image up to 10 MB; nothing was paid."})}
  }
  return {clear,check,importQR};
}
