import { parsePaymentRecipient, type PaymentRecipient } from "../chain/paymentRequest";
import { reviewWalletConnectQrPayload } from "../walletConnect/qr";
import {walletPayInvoiceID} from "../chain/walletPayInvoice";

export type WalletScanResult = Readonly<{kind:"payment";payment:PaymentRecipient}> | Readonly<{kind:"walletconnect";uri:string}> | Readonly<{kind:"invoice";invoiceID:string}>;
/** Classification only: never opens URLs, pairs, signs or broadcasts. */
export function parseWalletScan(value:unknown, at=new Date()):WalletScanResult {
  if(typeof value!=="string"||value.length>2048)throw new Error("INVALID_WALLET_QR");
  if(value.startsWith("wc:"))return Object.freeze({kind:"walletconnect",uri:reviewWalletConnectQrPayload(value,"ready",at)});
  try{return Object.freeze({kind:"payment",payment:parsePaymentRecipient(value)})}
  catch{return Object.freeze({kind:"invoice",invoiceID:walletPayInvoiceID(value)})}
}
