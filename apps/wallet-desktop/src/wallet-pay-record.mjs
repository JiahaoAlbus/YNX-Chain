import {createHash} from "node:crypto";
import {canonicalJSON,evmAddressFromYNX,nativeTransferHash,parseProductSession,parseSignedNativeTransfer,verifyPayPaymentResult} from "@ynx-chain/wallet-auth";
import {assertDesktopPaySession} from "./wallet-pay-prepare.mjs";
import {verifyWalletPayQuote} from "./wallet-pay-quote.mjs";
import {CANONICAL_RPC_URL} from "./rpc.mjs";
const invalid=()=>{throw Object.assign(new Error("PAY_SIGNED_RECORD_INVALID"),{code:"PAY_SIGNED_RECORD_INVALID"})};
/** Storage integrity narrowing only. This cannot trust the record's merchant
 * key or grant a live session. Even invalid data must block replacement. */
export function assertDesktopSignedPayStorage(record){
  if(!record||Object.keys(record).sort().join()!=="account,intent,invoice,origin,paymentResult,session,transfer,version"||record.version!==2||record.origin!==CANONICAL_RPC_URL||JSON.stringify(record).length>16384)invalid();
  evmAddressFromYNX(record.account);
  const transfer=record.transfer;
  if(!transfer||Object.keys(transfer).sort().join()!=="hash,payload,transaction"||typeof transfer.payload!=="string"||transfer.payload.length>2048)invalid();
  const transaction=parseSignedNativeTransfer(transfer.payload),hash=nativeTransferHash(transfer.payload),issued=Date.parse(record.paymentResult?.issuedAt);
  if(!Number.isFinite(issued)||canonicalJSON(transaction)!==canonicalJSON(transfer.transaction)||hash!==transfer.hash||transaction.from!==evmAddressFromYNX(record.account))invalid();
  const result=verifyPayPaymentResult(record.paymentResult,record.intent,record.account,new Date(issued));
  if(hash!==result.transactionHash||transaction.publicKey!==result.accountPublicKey||transaction.to!==evmAddressFromYNX(record.intent.payoutAddress)||transaction.amount!==record.intent.amount||transaction.fee!==record.intent.fee)invalid();
  const session=parseProductSession(record.session);assertDesktopPaySession(session,record.intent,record.account);
  if(issued<Date.parse(session.issuedAt)||issued>=Date.parse(session.expiresAt))invalid();
  return record;
}
/** Full historical invoice verification uses A's INDEPENDENT pinned policy at
 * the original result time. Expired quotes remain evidence, never new consent. */
export function parseDesktopSignedPayRecord(raw,account,policy,guard){
  guard();if(typeof raw!=="string"||raw.length>16384)invalid();const value=assertDesktopSignedPayStorage(JSON.parse(raw));
  if(value.account!==account)invalid();
  const quote=verifyWalletPayQuote(value.invoice,value.intent,policy,guard,Date.parse(value.paymentResult.issuedAt));
  if(quote.invoice.expectedPayerHash&&quote.invoice.expectedPayerHash!==createHash("sha256").update(`YNX_PAY_EXPECTED_PAYER_V1|${account}`).digest("hex"))invalid();
  guard();return Object.freeze({...value,invoice:quote.invoice,intent:quote.intent,transfer:Object.freeze({...value.transfer,transaction:parseSignedNativeTransfer(value.transfer.payload)}),session:parseProductSession(value.session)});
}
