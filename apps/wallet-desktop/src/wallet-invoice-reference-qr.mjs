import {decodeLocalQRText} from "./walletconnect-qr-decoder.mjs";
import {walletPayInvoiceID,WalletPayError} from "./wallet-pay-invoice-reference-id.mjs";
import {ambiguousWalletInvoiceReference} from './wallet-qr-reference-policy.mjs';
/** Decode on-device pixels into a public reference only. No HTTP, URLs,
 * product-session authority, wallet keys, Pair or payment side effects. */
export function decodeInvoiceReferenceQR(input){
  const text=decodeLocalQRText(input);
  if(ambiguousWalletInvoiceReference(text))throw new WalletPayError('PAY_INVALID_REFERENCE');
  return Object.freeze({invoiceID:walletPayInvoiceID(text),decodedLocally:true,uploaded:false});
}
