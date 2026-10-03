import {decodeLocalQRText} from "./walletconnect-qr-decoder.mjs";
import {walletPayInvoiceID} from "./wallet-pay-invoice-reference-id.mjs";
/** Decode on-device pixels into a public reference only. No HTTP, URLs,
 * product-session authority, wallet keys, Pair or payment side effects. */
export function decodeInvoiceReferenceQR(input){
  return Object.freeze({invoiceID:walletPayInvoiceID(decodeLocalQRText(input)),decodedLocally:true,uploaded:false});
}
