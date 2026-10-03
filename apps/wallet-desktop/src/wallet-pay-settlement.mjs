import {createHash} from "node:crypto";
import {canonicalJSON} from "@ynx-chain/wallet-auth";
import {assertDesktopSignedPayStorage} from "./wallet-pay-record.mjs";
import {verifySignedPayInvoice} from "./wallet-pay-signed-invoice.mjs";
import {parseDurabilityModel,validateNativeJSONReceipt} from "./transaction-durability.mjs";
const fail=()=>{throw Object.assign(new Error("PAY_SIGNED_SETTLEMENT_BINDING_MISMATCH"),{code:"PAY_SIGNED_SETTLEMENT_BINDING_MISMATCH"})};
const keys=(value,expected)=>{if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).sort().join()!==expected)fail()};
export function desktopPayIdempotencyKey(record){return "wallet-signed-pay-"+createHash("sha256").update(canonicalJSON([record.account,record.invoice.id,record.paymentResult.intentDigest,record.transfer.hash])).digest("hex")}
export function assertDesktopPayEvidence(record,evidence){
  assertDesktopSignedPayStorage(record);
  keys(evidence,"capability,chainId,origin,receipt,version");
  if(evidence.version!==1||evidence.origin!==record.origin||evidence.chainId!=="0x1917")fail();
  parseDurabilityModel(evidence.capability);
  validateNativeJSONReceipt(record.transfer.transaction,record.transfer.hash,evidence.receipt,evidence.capability);
  return evidence;
}
/** Original Pay53eb settlement wire. These source/confidence fields are NOT
 * authentication: only A's mandatory protected transport may supply a response.
 * A native local checkpoint is never promoted to consensus finality. */
export function parseDesktopPaySettlement(value,record,evidence){
  assertDesktopPayEvidence(record,evidence);
  keys(value,"amount,asset,auditHash,auditId,blockNumber,centralInvoiceId,chainId,committedAt,confidence,finality,id,idempotencyKey,intentDigest,intentId,invoiceId,payee,payer,payoutAddress,receiptId,requestNonce,source,sourceAsOf,sourceVersion,status,transactionHash");
  if(value.chainId!=="ynx_6423-1"||value.asset!=="YNXT"||value.status!=="committed"||value.finality!=="committed"||value.source!=="authoritative-central-pay-api"||value.sourceVersion!==1||value.confidence!=="authoritative")fail();
  for(const key of ["id","invoiceId","centralInvoiceId","intentId","receiptId","idempotencyKey"]){if(typeof value[key]!=="string"||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value[key]))fail()}
  if(!Number.isSafeInteger(value.blockNumber)||value.blockNumber<=0||value.amount!==record.invoice.amount||
    value.invoiceId!==record.invoice.id||value.centralInvoiceId!==record.invoice.centralInvoiceId||value.intentId!==record.invoice.intentId||
    value.payer!==record.account||value.payee!==record.invoice.payoutAddress||value.payoutAddress!==record.invoice.payoutAddress||
    value.transactionHash!==record.transfer.hash||value.intentDigest!==record.paymentResult.intentDigest||value.requestNonce!==record.intent.requestId||
    value.idempotencyKey!==desktopPayIdempotencyKey(record)||value.receiptId!==value.id||typeof value.auditId!=="string"||typeof value.auditHash!=="string"||!/^aud_[a-f0-9]{20}$/.test(value.auditId)||!/^[a-f0-9]{64}$/.test(value.auditHash))fail();
  for(const key of ["committedAt","sourceAsOf"]){const time=value[key],at=Date.parse(time);if(typeof time!=="string"||time.length>40||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(time)||!Number.isFinite(at)||new Date(at).toISOString().slice(0,19)!==time.slice(0,19))fail()}
  if(value.sourceAsOf!==value.committedAt||Date.parse(value.committedAt)<Date.parse(record.paymentResult.issuedAt))fail();
  return Object.freeze({...value});
}
export function parseDesktopPaySettlementResponse(response,record,evidence,policy,guard){
  guard();if(!response||response.status!=="committed")fail();
  const verified=verifySignedPayInvoice(response,record.invoice.id,policy,guard,Date.parse(record.paymentResult.issuedAt));
  if(canonicalJSON(verified.invoice)!==canonicalJSON(record.invoice))fail();
  const settlement=parseDesktopPaySettlement(response.settlement,record,evidence);guard();return settlement;
}
/** Structural historical validation only. Live authority and independent signer
 * policy are rechecked by journal readers, not trusted from stored fields. */
export function assertDesktopPayProgress(entry){
  keys(entry,"broadcastAttempted,consensusFinality,evidence,record,settlement,settlementAttempted,version");
  if(entry.version!==1||entry.consensusFinality!==false||typeof entry.broadcastAttempted!=="boolean"||typeof entry.settlementAttempted!=="boolean")fail();
  assertDesktopSignedPayStorage(entry.record);
  if(entry.evidence!==null)assertDesktopPayEvidence(entry.record,entry.evidence);
  if(entry.settlementAttempted&&!entry.evidence||entry.settlement!==null&&!entry.evidence)fail();
  if(entry.settlement!==null)parseDesktopPaySettlement(entry.settlement,entry.record,entry.evidence);
  return entry;
}
