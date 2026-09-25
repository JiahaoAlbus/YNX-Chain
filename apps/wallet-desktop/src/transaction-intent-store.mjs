import * as filesystem from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { PrivateFilePolicy } from "./platform-private-file.mjs";
import { Transaction, toQuantity } from "ethers";
import { parseFeeModel, capabilityFingerprint, capabilityError, assertCompatibleIntentCapabilities } from "./rpc-capabilities.mjs";
import { validateDurableReceipt, uint64, UINT64_MAX } from "./transaction-durability.mjs";
import { CANONICAL_RPC_URL } from "./rpc.mjs";

const HASH = /^0x[0-9a-f]{64}$/, ACCOUNT = /^0x[0-9a-f]{40}$/;
const quantity = value => typeof value === "string" && value.length <= 128 && /^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value);
const invalid = () => capabilityError("TRANSACTION_JOURNAL_INVALID", "The local transaction journal cannot be verified. New transactions are blocked; preserve the journal and check any known transaction hashes.");
function validateIntent(record, legacy = false) {
  const keys = legacy ? "account,attempts,capabilities,chainId,hash,nonce,to,value" : "account,attempts,capabilities,chainId,hash,nonce,origin,raw,to,value";
  if (!record || Object.keys(record).sort().join() !== keys || typeof record.account !== "string" || !ACCOUNT.test(record.account) || typeof record.to !== "string" || !ACCOUNT.test(record.to) || record.to === record.account || typeof record.hash !== "string" || !HASH.test(record.hash) || record.chainId !== "0x1917" || !quantity(record.nonce) || !quantity(record.value) || BigInt(record.value) <= 0n || !Number.isSafeInteger(record.attempts) || record.attempts < 1) throw invalid();
  const model = parseFeeModel(record.capabilities), value = BigInt(record.value), quantum = BigInt(model.amountQuantumWei);
  if (!model.enabled || value % quantum !== 0n || value / quantum > 9223372036854775807n || uint64(record.nonce) === UINT64_MAX || capabilityFingerprint(model) !== capabilityFingerprint(record.capabilities)) throw invalid();
  if (!legacy) {
    if (record.origin !== CANONICAL_RPC_URL || record.raw !== null && (typeof record.raw !== "string" || record.raw.length > 32_768 || !/^0x(?:[0-9a-f]{2})+$/.test(record.raw))) throw invalid();
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
function validateRejection(proof) {
  if (!proof || proof.rpcCode !== -32003 || proof.rpcResponse !== true || proof.rpcHttpSuccess !== true || proof.rpcDefiniteRejection !== true || proof.rpcMethod !== "eth_sendRawTransaction" || proof.rpcOrigin !== CANONICAL_RPC_URL || !Number.isSafeInteger(proof.rpcRequestId) || proof.outcomeUnknown === true || proof.code !== "RPC_TRANSACTION_REJECTED") throw invalid();
}
export function assertIntentReceipt(intent, receipt, capabilities = intent.capabilities) {
  try { assertCompatibleIntentCapabilities(intent.capabilities, capabilities); return validateDurableReceipt(intent, receipt, capabilities); }
  catch { throw invalid(); }
}
function parseState(data) {
  if (!data || ![1, 2].includes(data.schemaVersion)) throw invalid();
  const legacy = data.schemaVersion === 1;
  if (Object.keys(data).sort().join() !== (legacy ? "records,rejections,schemaVersion" : "records,rejections,resolutions,schemaVersion") || !Array.isArray(data.records) || !Array.isArray(data.rejections) || data.records.length > 1024 || data.rejections.length > 1024 || !legacy && (!Array.isArray(data.resolutions) || data.resolutions.length > 1024)) throw invalid();
  data.records.forEach(record => validateIntent(record, legacy));
  for (const entry of data.rejections) { if (!entry || Object.keys(entry).sort().join() !== "intent,proof") throw invalid(); validateIntent(entry.intent, legacy); validateRejection(entry.proof); if (entry.intent.attempts !== 1) throw invalid(); }
  if (new Set(data.records.map(record => record.hash)).size !== data.records.length || new Set(data.records.map(record => record.account)).size !== data.records.length) throw invalid();
  if (legacy) {
    // V1 has no signed bytes or durable receipt evidence. Keep pending records as
    // unresolved, and never synthesize a signature or a terminal confirmation.
    const upgrade = record => ({ ...record, origin: CANONICAL_RPC_URL, raw: null });
    return { schemaVersion: 2, records: data.records.map(upgrade), rejections: data.rejections.map(entry => ({ intent: upgrade(entry.intent), proof: entry.proof })), resolutions: [] };
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

export class FileTransactionIntentStore {
  #mutations = Promise.resolve();
  constructor({ filePath, io = filesystem, filePolicy = new PrivateFilePolicy({ io }) }) { if (!path.isAbsolute(filePath ?? "")) throw new Error("Transaction journal requires an absolute path"); this.filePath = filePath; this.io = io; this.filePolicy = filePolicy; }
  async snapshot() { return (await this.#read()).records; }
  async resolutions() { return (await this.#read()).resolutions; }
  async #read(filePath = this.filePath) {
    let handle;
    try {
      await this.filePolicy.available(filePath);
      handle = await this.io.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 1024 * 1024) throw invalid();
      await this.filePolicy.assertPrivate(filePath, stat);
      return structuredClone(parseState(JSON.parse(await handle.readFile("utf8"))));
    } catch (error) { if (error?.code === "ENOENT" && filePath === this.filePath) return empty(); throw invalid(); }
    finally { await handle?.close(); }
  }
  async add(intent, { retry = false } = {}) {
    validateIntent({ ...intent, attempts: 1 });
    if (intent.raw === null) throw invalid(); // Only the explicit V1 read can yield a no-raw pending entry.
    return this.#mutate(async () => {
      const state = await this.#read(), prior = state.records.find(item => item.account === intent.account);
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
    validateRejection(proof);
    return this.#mutate(async () => {
      const state = await this.#read(), intent = state.records.find(item => item.hash === hash);
      if (!intent || intent.account !== account || intent.attempts !== 1) throw invalid();
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
