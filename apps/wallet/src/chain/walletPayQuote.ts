import {parsePayPaymentIntent,payPaymentIntentDigest,type createPayInvoiceSignerPolicy} from "@ynx-chain/wallet-auth";
import {verifySignedPayInvoice,SignedPayInvoiceError} from "./walletPaySignedInvoice";

/** Bind the ORIGINAL signed merchant invoice to the ORIGINAL SDK intent.
 * Policy is a protected issuer input, never a QR/server-supplied key. This
 * verifies no account session, consent, transfer, broadcast or settlement. */
export function verifyWalletPayQuote(rawInvoice:unknown,rawIntent:unknown,
  policy:ReturnType<typeof createPayInvoiceSignerPolicy>,guard:()=>void,now=Date.now()){
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
  return Object.freeze({invoice,intent,intentDigest,signatureVerified:true as const,quoteBound:true as const,
    accountSessionVerified:false as const,paymentAuthorized:false as const,settlementVerified:false as const,
    truthfulStatus:"pinned-signed-invoice-and-quote-only-not-payment-authorization" as const});
}
