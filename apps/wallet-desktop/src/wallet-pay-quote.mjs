import {parsePayPaymentIntent,payPaymentIntentDigest} from "@ynx-chain/wallet-auth";
import {verifySignedPayInvoice,SignedPayInvoiceError} from "./wallet-pay-signed-invoice.mjs";
/** Exact same signed invoice / SDK intent binding as Native. Protected policy
 * is required; no QR keys, account-session authority or payment is synthesized. */
export function verifyWalletPayQuote(rawInvoice,rawIntent,policy,guard,now=Date.now()){
  guard();const intent=parsePayPaymentIntent(rawIntent,new Date(now));
  const verified=verifySignedPayInvoice(rawInvoice,intent.invoiceId,policy,guard,now),invoice=verified.invoice;
  if(!verified.quoteTimeCurrent)throw new SignedPayInvoiceError("PAY_SIGNED_QUOTE_NOT_CURRENT");
  if(intent.centralInvoiceId!==invoice.centralInvoiceId||intent.merchantId!==invoice.merchantId||
    intent.merchantName!==invoice.merchantName||intent.payoutAddress!==invoice.payoutAddress||
    intent.amount!==invoice.amount||intent.asset!==invoice.asset||intent.chainId!==invoice.network||
    intent.fee!==invoice.fee||intent.invoiceSignature!==invoice.signature||intent.total!==invoice.amount+invoice.fee)
    throw new SignedPayInvoiceError("PAY_SIGNED_QUOTE_BINDING_MISMATCH");
  if(Date.parse(intent.quoteIssuedAt)<Date.parse(invoice.createdAt)||Date.parse(intent.quoteExpiresAt)>Date.parse(invoice.expiresAt))
    throw new SignedPayInvoiceError("PAY_SIGNED_QUOTE_LIFETIME_MISMATCH");
  const intentDigest=payPaymentIntentDigest(intent);guard();
  return Object.freeze({invoice,intent,intentDigest,signatureVerified:true,quoteBound:true,
    accountSessionVerified:false,paymentAuthorized:false,settlementVerified:false,
    truthfulStatus:"pinned-signed-invoice-and-quote-only-not-payment-authorization"});
}
