import * as filesystem from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { PrivateFilePolicy } from "./platform-private-file.mjs";
import {readBoundedPrivateFile,PRIVATE_FILE_MAX_BYTES} from "./bounded-private-file-read.mjs";
import { Transaction, toQuantity } from "ethers";
import { parseFeeModel, capabilityFingerprint, capabilityError, assertCompatibleIntentCapabilities } from "./rpc-capabilities.mjs";
import { validateDurableReceipt, uint64, UINT64_MAX } from "./transaction-durability.mjs";
import { CANONICAL_RPC_URL, LEGACY_RPC_URL } from "./rpc.mjs";
import {canonicalJSON,evmAddressFromYNX} from "@ynx-chain/wallet-auth";
import {assertDesktopSignedPayStorage,parseDesktopSignedPayRecord} from "./wallet-pay-record.mjs";
import {assertDesktopPayProgress,assertDesktopPayEvidence,parseDesktopPaySettlement} from "./wallet-pay-settlement.mjs";

const HASH = /^0x[0-9a-f]{64}$/, ACCOUNT = /^0x[0-9a-f]{40}$/;
const quantity = value => typeof value === "string" && value.length <= 128 && /^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value);
const invalid = () => capabilityError("TRANSACTION_JOURNAL_INVALID", "The local transaction journal cannot be verified. New transactions are blocked; preserve the journal and check any known transaction hashes.");
function validateIntent(record, legacy = false) {
  const keys = legacy ? "account,attempts,capabilities,chainId,hash,nonce,to,value" : "account,attempts,capabilities,chainId,hash,nonce,origin,raw,to,value";
  if (!record || Object.keys(record).sort().join() !== keys || typeof record.account !== "string" || !ACCOUNT.test(record.account) || typeof record.to !== "string" || !ACCOUNT.test(record.to) || record.to === record.account || typeof record.hash !== "string" || !HASH.test(record.hash) || record.chainId !== "0x1917" || !quantity(record.nonce) || !quantity(record.value) || BigInt(record.value) <= 0n || !Number.isSafeInteger(record.attempts) || record.attempts < 1) throw invalid();
  const model = parseFeeModel(record.capabilities), value = BigInt(record.value), quantum = BigInt(model.amountQuantumWei);
  if (!model.enabled || value % quantum !== 0n || value / quantum > 9223372036854775807n || uint64(record.nonce) === UINT64_MAX || capabilityFingerprint(model) !== capabilityFingerprint(record.capabilities)) throw invalid();
  if (!legacy) {
    if (![CANONICAL_RPC_URL,LEGACY_RPC_URL].includes(record.origin) || record.raw !== null && (typeof record.raw !== "string" || record.raw.length > 32_768 || !/^0x(?:[0-9a-f]{2})+$/.test(record.raw))) throw invalid();
    if (record.raw !== null) validateRawIntent(record);
  }
}
export function validateRawIntent(record) {
  try {
    const tx = Transaction.from(record.raw);
    if (!tx.isSigned() || tx.hash !== record.hash || tx.from?.toLowerCase() !== record.account || tx.to?.toLowerCase() !== record.to || tx.chainId !== 6423n || tx.type !== 0 || tx.data !== "0x" || tx.accessList !== null || toQuantity(tx.nonce) !== record.nonce || toQuantity(tx.value) !== record.value || toQuantity(tx.gasPrice) !== record.capabilities.gasPrice || tx.gasLimit < BigInt(record.capabilities.gas) || tx.gasLimit > BigInt(record.capabilities.maxGasLimit)) throw invalid();
    return tx;
  } catch { throw invalid(); }
}
function validateRejection(proof, origin) {
  if (!proof || ![CANONICAL_RPC_URL,LEGACY_RPC_URL].includes(origin) || proof.rpcCode !== -32003 || proof.rpcResponse !== true || proof.rpcHttpSuccess !== true || proof.rpcDefiniteRejection !== true || proof.rpcMethod !== "eth_sendRawTransaction" || proof.rpcOrigin !== origin || !Number.isSafeInteger(proof.rpcRequestId) || proof.outcomeUnknown === true || proof.code !== "RPC_TRANSACTION_REJECTED") throw invalid();
}
export function assertIntentReceipt(intent, receipt, capabilities = intent.capabilities) {
  try { assertCompatibleIntentCapabilities(intent.capabilities, capabilities); return validateDurableReceipt(intent, receipt, capabilities); }
  catch { throw invalid(); }
}
function parseState(data) {
  if (!data || ![1, 2, 3, 4].includes(data.schemaVersion)) throw invalid();
  const legacy = data.schemaVersion === 1;
  const signed = data.schemaVersion >= 3;
  if (Object.keys(data).sort().join() !== (legacy ? "records,rejections,schemaVersion" : data.schemaVersion===4 ? "payHistory,payProgress,records,rejections,resolutions,schemaVersion,signedPayments" : signed ? "records,rejections,resolutions,schemaVersion,signedPayments" : "records,rejections,resolutions,schemaVersion") || !Array.isArray(data.records) || !Array.isArray(data.rejections) || data.records.length > 1024 || data.rejections.length > 1024 || !legacy && (!Array.isArray(data.resolutions) || data.resolutions.length > 1024)) throw invalid();
  if(signed){
    if(!Array.isArray(data.signedPayments)||data.signedPayments.length>1024)throw invalid();
    try{data.signedPayments.forEach(assertDesktopSignedPayStorage)}catch{throw invalid()}
    if(new Set(data.signedPayments.map(record=>record.account)).size!==data.signedPayments.length||new Set(data.signedPayments.map(record=>record.transfer.hash)).size!==data.signedPayments.length||data.signedPayments.some(record=>data.records.some(entry=>entry.account===evmAddressFromYNX(record.account))))throw invalid();
  }
  if(data.schemaVersion===4){
    if(!Array.isArray(data.payProgress)||!Array.isArray(data.payHistory)||data.payProgress.length!==data.signedPayments.length||data.payHistory.length>1024)throw invalid();
    try{[...data.payProgress,...data.payHistory].forEach(assertDesktopPayProgress)}catch{throw invalid()}
    if(new Set(data.payProgress.map(entry=>entry.record.transfer.hash)).size!==data.payProgress.length||
      data.payProgress.some(entry=>!data.signedPayments.some(record=>canonicalJSON(record)===canonicalJSON(entry.record)))||
      data.payHistory.some(entry=>!entry.evidence||!entry.settlement)||
      new Set([...data.payProgress,...data.payHistory].map(entry=>entry.record.transfer.hash)).size!==data.payProgress.length+data.payHistory.length||
      new Set([...data.payProgress,...data.payHistory].map(entry=>canonicalJSON([entry.record.account,entry.record.invoice.id]))).size!==data.payProgress.length+data.payHistory.length)throw invalid();
  }
  data.records.forEach(record => validateIntent(record, legacy));
  for (const entry of data.rejections) { if (!entry || Object.keys(entry).sort().join() !== "intent,proof") throw invalid(); validateIntent(entry.intent, legacy); validateRejection(entry.proof, legacy ? entry.proof?.rpcOrigin : entry.intent.origin); if (entry.intent.attempts !== 1) throw invalid(); }
  if (new Set(data.records.map(record => record.hash)).size !== data.records.length || new Set(data.records.map(record => record.account)).size !== data.records.length) throw invalid();
  if (legacy) {
    // V1 has no signed bytes or durable receipt evidence. Keep pending records as
    // unresolved, and never synthesize a signature or a terminal confirmation.
    const upgrade = (record, origin = CANONICAL_RPC_URL) => ({ ...record, origin, raw: null });
    return { schemaVersion: 2, records: data.records.map(record => upgrade(record)), rejections: data.rejections.map(entry => ({ intent: upgrade(entry.intent, entry.proof.rpcOrigin), proof: entry.proof })), resolutions: [] };
  }
  for (const entry of data.resolutions) {
    if (!entry || Object.keys(entry).sort().join() !== "capabilities,intent,receipt") throw invalid();
    validateIntent(entry.intent); const model = parseFeeModel(entry.capabilities);
    if (capabilityFingerprint(model) !== capabilityFingerprint(entry.capabilities)) throw invalid();
    assertIntentReceipt(entry.intent, entry.receipt, model);
  }
  if (new Set(data.resolutions.map(entry => entry.intent.hash)).size !== data.resolutions.length || data.records.some(record => data.resolutions.some(entry => entry.intent.hash === record.hash))) throw invalid();
  return data;
}
const empty = () => ({ schemaVersion: 2, records: [], rejections: [], resolutions: [] });
const payEntry=(record,broadcastAttempted=true)=>({version:1,record,broadcastAttempted,evidence:null,settlementAttempted:false,settlement:null,consensusFinality:false});
// Earlier schemas cannot prove that an outward effect did NOT start. Migration
// conservatively fences a second POST, and never happens on a read alone.
const paySuccessor=state=>state.schemaVersion===4?state:{...state,schemaVersion:4,signedPayments:state.signedPayments??[],payProgress:(state.signedPayments??[]).map(record=>payEntry(record)),payHistory:[]};

export class FileTransactionIntentStore {
  #mutations = Promise.resolve();
  constructor({ filePath, io = filesystem, filePolicy = new PrivateFilePolicy({ io }) }) { if (!path.isAbsolute(filePath ?? "")) throw new Error("Transaction journal requires an absolute path"); this.filePath = filePath; this.io = io; this.filePolicy = filePolicy; }
  async snapshot() { return (await this.#read()).records; }
  async resolutions() { return (await this.#read()).resolutions; }
  async assertNoSignedPayment(account){
    const records=(await this.#read()).signedPayments??[];
    if(records.some(record=>evmAddressFromYNX(record.account)===account))throw capabilityError("PAY_SIGNED_ORIGINAL_REQUIRES_REVIEW","A signed Pay original remains retained. Review its original hash and settlement; do not create a replacement transaction.");
  }
  async signedPayment(account,policy,guard){
    guard();const record=((await this.#read()).signedPayments??[]).find(value=>value.account===account);guard();
    return record?parseDesktopSignedPayRecord(canonicalJSON(record),account,policy,guard):null;
  }
  async retainSignedPayment(record,policy,guard,{forBroadcast=false}={}){
    const saved=parseDesktopSignedPayRecord(canonicalJSON(record),record.account,policy,guard);
    return this.#mutate(async()=>{
      guard();const state=await this.#read();guard();
      const prior=(state.signedPayments??[]).find(value=>value.account===saved.account);
      if(prior){if(canonicalJSON(prior)!==canonicalJSON(saved))throw invalid();return parseDesktopSignedPayRecord(canonicalJSON(prior),saved.account,policy,guard)}
      if(state.records.some(value=>value.account===evmAddressFromYNX(saved.account)))throw capabilityError("TRANSACTION_RESOLUTION_REQUIRED","The existing transaction must be resolved before signed Pay.");
      if((state.payHistory??[]).some(entry=>entry.record.account===saved.account&&entry.record.invoice.id===saved.invoice.id))throw capabilityError("PAY_INVOICE_ALREADY_PAID","This invoice already has a retained paid receipt.");
      const next=forBroadcast||state.schemaVersion===4?paySuccessor(state):{...state,schemaVersion:3,signedPayments:state.signedPayments??[]};
      next.signedPayments=[...next.signedPayments,saved];
      if(next.schemaVersion===4)next.payProgress=[...next.payProgress,payEntry(saved,!forBroadcast)];
      await this.#write(next);guard();
      const readback=await this.signedPayment(saved.account,policy,guard);guard();
      if(!readback||canonicalJSON(readback)!==canonicalJSON(saved))throw invalid();return readback;
    });
  }
  async payHistory(account,policy,guard){
    guard();const state=await this.#read();guard();
    return (state.payHistory??[]).filter(entry=>entry.record.account===account).map(entry=>this.#verifiedPayEntry(entry,account,policy,guard));
  }
  async signedPayProgress(account,policy,guard){
    guard();const state=await this.#read();guard();const record=(state.signedPayments??[]).find(value=>value.account===account);
    if(!record)return null;
    return this.#verifiedPayEntry((state.payProgress??[]).find(entry=>entry.record.account===account)??payEntry(record),account,policy,guard);
  }
  #verifiedPayEntry(entry,account,policy,guard){
    const record=parseDesktopSignedPayRecord(canonicalJSON(entry.record),account,policy,guard);assertDesktopPayProgress(entry);guard();return structuredClone({...entry,record});
  }
  async #changePay(account,hash,policy,guard,change){
    return this.#mutate(async()=>{
      guard();const state=paySuccessor(await this.#read());guard();const entry=state.payProgress.find(value=>value.record.account===account&&value.record.transfer.hash===hash);
      if(!entry)throw invalid();this.#verifiedPayEntry(entry,account,policy,guard);change(entry,state);guard();
      await this.#write(state);guard();return structuredClone(entry);
    });
  }
  async claimSignedPayBroadcast(account,hash,policy,guard){
    return this.#changePay(account,hash,policy,guard,entry=>{
      if(entry.broadcastAttempted)throw capabilityError("PAY_ORIGINAL_CHECK_ONLY","Check the original transaction; no repeated payment broadcast is allowed.");
      entry.broadcastAttempted=true;
    });
  }
  async saveSignedPayEvidence(account,hash,evidence,policy,guard){
    return this.#changePay(account,hash,policy,guard,entry=>{
      assertDesktopPayEvidence(entry.record,evidence);
      if(entry.evidence&&canonicalJSON(entry.evidence)!==canonicalJSON(evidence))throw invalid();
      entry.evidence=structuredClone(evidence);
    });
  }
  async claimSignedPaySettlement(account,hash,policy,guard){
    return this.#changePay(account,hash,policy,guard,entry=>{
      if(!entry.evidence||entry.settlementAttempted||entry.settlement)throw capabilityError("PAY_ORIGINAL_RECEIPT_CHECK_ONLY","Read the original settlement receipt; do not submit another result.");
      entry.settlementAttempted=true;
    });
  }
  async saveSignedPaySettlement(account,hash,settlement,policy,guard){
    return this.#changePay(account,hash,policy,guard,entry=>{
      const verified=parseDesktopPaySettlement(settlement,entry.record,entry.evidence);
      if(entry.settlement&&canonicalJSON(entry.settlement)!==canonicalJSON(verified))throw invalid();
      entry.settlement=verified;
    });
  }
  async archiveSignedPay(account,hash,policy,guard){
    return this.#mutate(async()=>{
      guard();const state=paySuccessor(await this.#read());guard();const prior=state.payHistory.find(entry=>entry.record.account===account&&entry.record.transfer.hash===hash);
      if(prior)return this.#verifiedPayEntry(prior,account,policy,guard);
      const entry=state.payProgress.find(entry=>entry.record.account===account&&entry.record.transfer.hash===hash);
      if(!entry||!entry.settlement||!entry.evidence)throw invalid();this.#verifiedPayEntry(entry,account,policy,guard);
      // One existing private-file replacement atomically links history, the paid
      // invoice marker, and release of the active original. No second vault or
      // transient deletion window can lose a verified receipt.
      state.payHistory.push(entry);state.payProgress=state.payProgress.filter(value=>value!==entry);
      state.signedPayments=state.signedPayments.filter(record=>record.transfer.hash!==hash);guard();await this.#write(state);guard();
      const readback=(await this.payHistory(account,policy,guard)).find(value=>value.record.transfer.hash===hash);
      if(!readback||canonicalJSON(readback)!==canonicalJSON(entry))throw invalid();return readback;
    });
  }
  async #read(filePath = this.filePath) {
    let handle, failed = false, stage = "probe";
    try {
      await this.filePolicy.available(filePath);
      stage = "open";
      handle = await this.io.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      stage = "inspect";
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > PRIVATE_FILE_MAX_BYTES) throw invalid();
      await this.filePolicy.assertPrivate(filePath, stat);
      return structuredClone(parseState(JSON.parse(await readBoundedPrivateFile(handle))));
    } catch (error) { failed = true; if (error?.code === "ENOENT" && stage === "open" && !handle && filePath === this.filePath) return empty(); throw invalid(); }
    finally { try { await handle?.close(); } catch { if (!failed) throw invalid(); } }
  }
  async add(intent, { retry = false } = {}) {
    validateIntent({ ...intent, attempts: 1 });
    if (intent.raw === null) throw invalid(); // Only the explicit V1 read can yield a no-raw pending entry.
    return this.#mutate(async () => {
      const state = await this.#read(), prior = state.records.find(item => item.account === intent.account);
      if((state.signedPayments??[]).some(record=>evmAddressFromYNX(record.account)===intent.account))throw capabilityError("PAY_SIGNED_ORIGINAL_REQUIRES_REVIEW","The retained signed Pay original must be reviewed before another broadcast.");
      if (prior) {
        const { attempts, ...original } = prior;
        if (!retry || capabilityFingerprint(original) !== capabilityFingerprint(intent)) throw capabilityError("TRANSACTION_RESOLUTION_REQUIRED", "A previous transaction for this account is still unresolved.");
        if (attempts >= Number.MAX_SAFE_INTEGER) throw invalid(); prior.attempts++;
      } else {
        if (retry || state.resolutions.some(entry => entry.intent.hash === intent.hash)) throw invalid();
        state.records.push({ ...intent, attempts: 1 });
      }
      await this.#write(state);
    });
  }
  async reject(hash, account, proof) {
    return this.#mutate(async () => {
      const state = await this.#read(), intent = state.records.find(item => item.hash === hash);
      if (!intent || intent.account !== account || intent.attempts !== 1) throw invalid();
      validateRejection(proof, intent.origin);
      state.records = state.records.filter(item => item.hash !== hash); state.rejections.push({ intent, proof }); await this.#write(state);
    });
  }
  async resolve(hash, account, receipt, capabilities) {
    return this.#mutate(async () => {
      const state = await this.#read(), record = state.records.find(item => item.hash === hash);
      if (!record || record.account !== account) throw invalid();
      const model = parseFeeModel(capabilities ?? record.capabilities), evidence = assertIntentReceipt(record, receipt, model);
      state.records = state.records.filter(item => item.hash !== hash); state.resolutions.push({ intent: record, receipt: evidence, capabilities: model }); await this.#write(state);
    });
  }
  #mutate(action) { const result = this.#mutations.then(action); this.#mutations = result.catch(() => {}); return result; }
  async #write(state) {
    const directory = path.dirname(this.filePath), temporary = `${this.filePath}.${randomUUID()}.tmp`;
    let file;
    try {
      parseState(state); const encoded = `${JSON.stringify(state)}\n`;
      if (Buffer.byteLength(encoded) > 1024 * 1024) throw invalid();
      await this.filePolicy.directory(directory);
      file = await this.io.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      await this.filePolicy.protect(temporary);
      await file.writeFile(encoded, "utf8"); await file.sync(); await file.close(); file = null;
      if (capabilityFingerprint(await this.#read(temporary)) !== capabilityFingerprint(state)) throw invalid();
      await this.filePolicy.replace(temporary, this.filePath);
      if (capabilityFingerprint(await this.#read()) !== capabilityFingerprint(state)) throw invalid();
    } catch {
      throw capabilityError("TRANSACTION_JOURNAL_WRITE_FAILED", "The transaction journal could not be saved durably. No new broadcast may start; preserve any existing unresolved entry.");
    } finally { await file?.close(); await this.io.unlink(temporary).catch(() => {}); }
  }
}
