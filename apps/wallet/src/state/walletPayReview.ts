import {evmAddressFromYNX} from "@ynx-chain/wallet-auth";
import {assertWalletPayReview,parseWalletPayInvoice,parseWalletPaySettlement,WalletPayError,type WalletPayInvoice} from "../chain/walletPayInvoice";
import {verifyNativeDurability} from "../chain/nativeDurability";
import type {NativeTransferOutboxEntry} from "../chain/nativeTransferOutbox";
import type {WalletPayBinding} from "./walletPayFlow";

export type WalletPayAction="pay"|"check"|"settle"|"done";
export type WalletPayReview=Readonly<{invoice:WalletPayInvoice;account:string;hash:string|null;
  state:"review"|"invoice_unavailable"|"other_transfer_pending"|"original_unavailable"|"transfer_unconfirmed"|"settlement_pending"|"settled";
  actions:readonly WalletPayAction[]}>;

/** Derive visible payment truth from the original record, not a paid status bit.
 * Buttons only request explicit actions; the operation lease and flow still
 * revalidate every outward effect. No QR, session or signature is approved here. */
export function buildWalletPayReview(account:string,invoice:WalletPayInvoice,binding:WalletPayBinding|null,
  transfer:NativeTransferOutboxEntry|null,now=Date.now()):WalletPayReview{
  evmAddressFromYNX(account);const parsed=parseWalletPayInvoice(invoice,invoice.id);
  const view=(state:WalletPayReview["state"],actions:WalletPayAction[]):WalletPayReview=>
    Object.freeze({invoice:parsed,account,hash:binding?.hash??null,state,actions:Object.freeze(actions)});
  if(transfer&&transfer.account!==account||binding&&(binding.account!==account||JSON.stringify(binding.invoice)!==JSON.stringify(parsed)))
    throw new WalletPayError("PAY_REVIEW_ACCOUNT_OR_INVOICE_MISMATCH");
  if(!binding){
    if(transfer&&(transfer.phase!=="done"||!verifyNativeDurability(transfer.durabilityEvidence,transfer.transaction,transfer.hash,transfer.origin)))return view("other_transfer_pending",[]);
    try{assertWalletPayReview(parsed,account,now)}catch{return view("invoice_unavailable",[])}
    return view("review",["pay"]);
  }
  if(!transfer||transfer.hash!==binding.hash||transfer.origin!==binding.origin)return view("original_unavailable",[]);
  const durable=["accepted","done"].includes(transfer.phase)&&
    verifyNativeDurability(transfer.durabilityEvidence,transfer.transaction,transfer.hash,transfer.origin);
  if(!durable)return view("transfer_unconfirmed",["check"]);
  if(binding.phase!=="settled")return view("settlement_pending",["settle"]);
  parseWalletPaySettlement(binding.settlement,parsed,account,transfer);
  return view("settled",["done"]);
}
