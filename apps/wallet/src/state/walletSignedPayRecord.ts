import {canonicalJSON,evmAddressFromYNX,nativeTransferHash,parseProductSession,parseSignedNativeTransfer,verifyPayPaymentResult,type PayPaymentIntent,type PayPaymentResult,type ProductSessionV2} from "@ynx-chain/wallet-auth";
import {verifyWalletPayQuote} from "../chain/walletPayQuote";
import type {SignedPayInvoice} from "../chain/walletPaySignedInvoice";
import type {NativeTransferPrepared} from "../chain/nativeTransferOutbox";
import {NativeChainClient} from "../chain/nativeTransfer";
import type {createPayInvoiceSignerPolicy} from "@ynx-chain/wallet-auth";
import {assertSignedPaySessionBinding,assertSignedPayExpectedPayer} from "../security/prepareSignedPayTransfer";

export const SIGNED_PAY_BINDING_PREFIX="ynx.wallet.pay-signed-binding.v2.";
export type WalletSignedPayRecord=Readonly<{
  version:2;account:string;origin:string;invoice:SignedPayInvoice;intent:PayPaymentIntent;
  paymentResult:PayPaymentResult;transfer:NativeTransferPrepared;session:ProductSessionV2;
}>;
/** Historical public evidence only. Quote expiry never erases a record or
 * makes it payable again. Protected historical signer policy is still required;
 * this parser does not trust the record's own public key or grant a session. */
export function parseWalletSignedPayRecord(raw:string,account:string,policy:ReturnType<typeof createPayInvoiceSignerPolicy>,guard:()=>void):WalletSignedPayRecord{
  guard();evmAddressFromYNX(account);
  if(raw.length>16384)throw Error("PAY_SIGNED_RECORD_INVALID");
  const value=JSON.parse(raw);
  if(!value||typeof value!=="object"||Object.keys(value).sort().join(",")!=="account,intent,invoice,origin,paymentResult,session,transfer,version"||value.version!==2||value.account!==account||new NativeChainClient(value.origin).origin!==value.origin)
    throw Error("PAY_SIGNED_RECORD_INVALID");
  const issued=Date.parse(value.paymentResult?.issuedAt);
  if(!Number.isFinite(issued))throw Error("PAY_SIGNED_RECORD_INVALID");
  const quote=verifyWalletPayQuote(value.invoice,value.intent,policy,guard,issued);
  assertSignedPayExpectedPayer(quote.invoice,account);
  const paymentResult=verifyPayPaymentResult(value.paymentResult,quote.intent,account,new Date(issued));
  const session=parseProductSession(value.session);assertSignedPaySessionBinding(session,quote.intent,account);
  if(issued<Date.parse(session.issuedAt)||issued>=Date.parse(session.expiresAt))throw Error("PAY_SIGNED_RECORD_BINDING_MISMATCH");
  const transfer=value.transfer;
  if(!transfer||Object.keys(transfer).sort().join(",")!=="hash,payload,transaction"||typeof transfer.payload!=="string"||transfer.payload.length>2048)
    throw Error("PAY_SIGNED_RECORD_INVALID");
  const transaction=parseSignedNativeTransfer(transfer.payload),hash=nativeTransferHash(transfer.payload);
  if(canonicalJSON(transaction)!==canonicalJSON(transfer.transaction)||hash!==transfer.hash||hash!==paymentResult.transactionHash||
    transaction.from!==evmAddressFromYNX(account)||transaction.publicKey!==paymentResult.accountPublicKey||transaction.to!==evmAddressFromYNX(quote.intent.payoutAddress)||transaction.amount!==quote.intent.amount||transaction.fee!==quote.intent.fee)
    throw Error("PAY_SIGNED_RECORD_BINDING_MISMATCH");
  guard();return Object.freeze({version:2,account,origin:value.origin,invoice:quote.invoice,intent:quote.intent,paymentResult,session,transfer:Object.freeze({payload:transfer.payload,hash,transaction})});
}
