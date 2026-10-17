import {canonicalJSON,evmAddressFromYNX,nativeTransferHash,parseSignedNativeTransfer} from "@ynx-chain/wallet-auth";
import {sha256} from "@noble/hashes/sha2.js";
import {bytesToHex} from "@noble/hashes/utils.js";
import {verifySignedPayInvoice} from "../chain/walletPaySignedInvoice";
import {verifyNativeDurability} from "../chain/nativeDurability";
import type {NativeTransferOutboxEntry} from "../chain/nativeTransferOutbox";
import {parseWalletSignedPayRecord,type WalletSignedPayRecord} from "./walletSignedPayRecord";
import type {createPayInvoiceSignerPolicy} from "@ynx-chain/wallet-auth";
type Policy=ReturnType<typeof createPayInvoiceSignerPolicy>;
export const SIGNED_PAY_SETTLEMENT_PREFIX="ynx.wallet.pay-signed-settlement.v2.";
export const SIGNED_PAY_RECEIPT_PREFIX="ynx.wallet.pay-signed-receipt.v2.";
export const SIGNED_PAY_PAID_INVOICE_PREFIX="ynx.wallet.pay-signed-invoice-paid.v2.";
export const SIGNED_PAY_HISTORY_HEAD_PREFIX="ynx.wallet.pay-signed-history-head.v2.";
export const SIGNED_PAY_HISTORY_NODE_PREFIX="ynx.wallet.pay-signed-history-node.v2.";
export type SignedPaySettlement=Readonly<{
  id:string;chainId:"ynx_6423-1";transactionHash:string;blockNumber:number;finality:"committed";
  payer:string;payee:string;payoutAddress:string;amount:number;asset:"YNXT";invoiceId:string;
  centralInvoiceId:string;intentId:string;intentDigest:string;requestNonce:string;idempotencyKey:string;
  receiptId:string;status:"committed";auditHash:string;auditId:string;committedAt:string;
  source:"authoritative-central-pay-api";sourceAsOf:string;sourceVersion:1;confidence:"authoritative";
}>;
export type SignedPaySettlementState=Readonly<{version:2;account:string;hash:string;intentDigest:string;
  idempotencyKey:string;phase:"unknown"|"verified";settlement:SignedPaySettlement|null}>;
export type WalletSignedPayReceipt=Readonly<{version:2;record:WalletSignedPayRecord;original:NativeTransferOutboxEntry;
  settlement:SignedPaySettlement;consensusFinality:false}>;
const fail=():never=>{throw Error("PAY_SIGNED_SETTLEMENT_BINDING_MISMATCH")};
const object=(value:unknown):value is Record<string,any>=>!!value&&typeof value==="object"&&!Array.isArray(value);
function text(value:unknown,max=128):string{if(typeof value!=="string"||!value||value.trim()!==value||value.length>max||/[\x00-\x1f\x7f]/.test(value))return fail();return value}
function identifier(value:unknown):string{const result=text(value);if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(result))return fail();return result}
function time(value:unknown):string{const result=text(value,40),at=Date.parse(result);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(result)||!Number.isFinite(at)||new Date(at).toISOString().slice(0,19)!==result.slice(0,19))return fail();return result}
export function signedPayIdempotencyKey(record:WalletSignedPayRecord):string{return "wallet-signed-pay-"+bytesToHex(sha256(new TextEncoder().encode(canonicalJSON([record.account,record.invoice.id,record.paymentResult.intentDigest,record.transfer.hash]))))}
export function assertSignedPayOriginal(record:WalletSignedPayRecord,original:NativeTransferOutboxEntry){
  if(!original||original.account!==record.account||original.origin!==record.origin||original.payload!==record.transfer.payload||original.hash!==record.transfer.hash||
    canonicalJSON(parseSignedNativeTransfer(original.payload))!==canonicalJSON(original.transaction)||nativeTransferHash(original.payload)!==original.hash||
    original.transaction.from!==evmAddressFromYNX(record.account)||!["accepted","done"].includes(original.phase)||
    !verifyNativeDurability(original.durabilityEvidence,original.transaction,original.hash,original.origin))return fail();
}
/** Original Pay53eb model.go SettlementEvidence. MUST come through A's
 * authenticated canonical business transport, not public invoice GET. This
 * validates bindings, never authenticates its own source/confidence strings. */
export function parseSignedPaySettlement(value:unknown,record:WalletSignedPayRecord,original:NativeTransferOutboxEntry):SignedPaySettlement{
  assertSignedPayOriginal(record,original);if(!object(value))return fail();
  const keys="amount,asset,auditHash,auditId,blockNumber,centralInvoiceId,chainId,committedAt,confidence,finality,id,idempotencyKey,intentDigest,intentId,invoiceId,payee,payer,payoutAddress,receiptId,requestNonce,source,sourceAsOf,sourceVersion,status,transactionHash";
  if(Object.keys(value).sort().join(",")!==keys||value.chainId!=="ynx_6423-1"||value.asset!=="YNXT"||value.status!=="committed"||value.finality!=="committed"||value.source!=="authoritative-central-pay-api"||value.sourceVersion!==1||value.confidence!=="authoritative")return fail();
  for(const key of ["id","invoiceId","centralInvoiceId","intentId","receiptId","idempotencyKey"])identifier(value[key]);
  if(!Number.isSafeInteger(value.blockNumber)||value.blockNumber<=0||!Number.isSafeInteger(value.amount)||value.amount!==record.invoice.amount||
    value.invoiceId!==record.invoice.id||value.centralInvoiceId!==record.invoice.centralInvoiceId||value.intentId!==record.invoice.intentId||
    value.payer!==record.account||value.payee!==record.invoice.payoutAddress||value.payoutAddress!==record.invoice.payoutAddress||
    value.transactionHash!==record.transfer.hash||value.intentDigest!==record.paymentResult.intentDigest||value.requestNonce!==record.intent.requestId||
    value.idempotencyKey!==signedPayIdempotencyKey(record)||value.receiptId!==value.id||!/^aud_[a-f0-9]{20}$/.test(value.auditId)||! /^[a-f0-9]{64}$/.test(value.auditHash))return fail();
  time(value.committedAt);time(value.sourceAsOf);
  if(value.sourceAsOf!==value.committedAt||Date.parse(value.committedAt)<Date.parse(record.paymentResult.issuedAt))return fail();
  // The two ledger records may commit at different heights. Do NOT fabricate
  // equality with native payment block, or promote local durability to finality.
  return Object.freeze({...value}) as SignedPaySettlement;
}
export function parseSignedPaySettlementResponse(response:unknown,record:WalletSignedPayRecord,original:NativeTransferOutboxEntry,policy:Policy,guard:()=>void):SignedPaySettlement{
  guard();if(!object(response)||response.status!=="committed")return fail();
  const verified=verifySignedPayInvoice(response,record.invoice.id,policy,guard,Date.parse(record.paymentResult.issuedAt));
  if(canonicalJSON(verified.invoice)!==canonicalJSON(record.invoice))return fail();
  const settlement=parseSignedPaySettlement(response.settlement,record,original);guard();return settlement;
}
export function parseSignedPaySettlementState(raw:string,record:WalletSignedPayRecord,original:NativeTransferOutboxEntry):SignedPaySettlementState{
  if(raw.length>8192)return fail();const value=JSON.parse(raw);
  if(!object(value)||Object.keys(value).sort().join(",")!=="account,hash,idempotencyKey,intentDigest,phase,settlement,version"||value.version!==2||value.account!==record.account||value.hash!==record.transfer.hash||value.intentDigest!==record.paymentResult.intentDigest||value.idempotencyKey!==signedPayIdempotencyKey(record)||!["unknown","verified"].includes(value.phase))return fail();
  if(value.phase==="unknown"&&value.settlement!==null||value.phase==="verified"&&!value.settlement)return fail();
  return Object.freeze({...value,settlement:value.phase==="verified"?parseSignedPaySettlement(value.settlement,record,original):null}) as SignedPaySettlementState;
}
export function parseWalletSignedPayReceipt(raw:string,account:string,hash:string,policy:Policy,guard:()=>void):WalletSignedPayReceipt{
  guard();if(raw.length>32768)return fail();const value=JSON.parse(raw);
  if(!object(value)||Object.keys(value).sort().join(",")!=="consensusFinality,original,record,settlement,version"||value.version!==2||value.consensusFinality!==false)return fail();
  const record=parseWalletSignedPayRecord(canonicalJSON(value.record),account,policy,guard);
  if(record.transfer.hash!==hash)return fail();const original=value.original as NativeTransferOutboxEntry;
  assertSignedPayOriginal(record,original);const settlement=parseSignedPaySettlement(value.settlement,record,original);
  guard();return Object.freeze({version:2,record,original:Object.freeze({...original,transaction:parseSignedNativeTransfer(original.payload)}),settlement,consensusFinality:false});
}
