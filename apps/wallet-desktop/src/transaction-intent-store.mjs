import * as filesystem from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { parseFeeModel, capabilityFingerprint, capabilityError } from "./rpc-capabilities.mjs";
import { CANONICAL_RPC_URL } from "./rpc.mjs";

const HASH = /^0x[0-9a-f]{64}$/, ACCOUNT = /^0x[0-9a-f]{40}$/;
const quantity = value => typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value);
const invalid = () => capabilityError("TRANSACTION_JOURNAL_INVALID", "The local transaction journal cannot be verified. New transactions are blocked; preserve the journal and check any known transaction hashes.");
function validateIntent(record) {
  if (!record || Object.keys(record).sort().join() !== "account,attempts,capabilities,chainId,hash,nonce,to,value" || !ACCOUNT.test(record.account) || !ACCOUNT.test(record.to) || !HASH.test(record.hash) || record.chainId !== "0x1917" || !quantity(record.nonce) || !quantity(record.value) || BigInt(record.value) <= 0n || !Number.isSafeInteger(record.attempts) || record.attempts < 1) throw invalid();
  const model = parseFeeModel(record.capabilities);
  if (!model.enabled || capabilityFingerprint(model) !== capabilityFingerprint(record.capabilities)) throw invalid();
}
function validateRejection(proof) {
  if (!proof || proof.rpcCode !== -32003 || proof.rpcResponse !== true || proof.rpcHttpSuccess !== true || proof.rpcDefiniteRejection !== true || proof.rpcMethod !== "eth_sendRawTransaction" || proof.rpcOrigin !== CANONICAL_RPC_URL || !Number.isSafeInteger(proof.rpcRequestId) || proof.outcomeUnknown === true || proof.code !== "RPC_TRANSACTION_REJECTED") throw invalid();
}
export function assertIntentReceipt(intent, receipt) {
  if (!receipt || receipt.transactionHash !== intent.hash || receipt.from?.toLowerCase() !== intent.account || receipt.to?.toLowerCase() !== intent.to || receipt.contractAddress !== null || !["0x0", "0x1"].includes(receipt.status) || !HASH.test(receipt.blockHash) || !quantity(receipt.blockNumber) || BigInt(receipt.blockNumber) === 0n || !quantity(receipt.gasUsed) || !quantity(receipt.effectiveGasPrice) || !quantity(receipt.ynxFeeWei)) throw invalid();
  const fee = BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice);
  if (receipt.type !== "0x0" || receipt.gasUsed !== intent.capabilities.gas || receipt.effectiveGasPrice !== intent.capabilities.gasPrice || fee !== BigInt(receipt.ynxFeeWei) || fee !== BigInt(intent.capabilities.feeWei)) throw invalid();
}

export class FileTransactionIntentStore {
  #mutations = Promise.resolve();
  constructor({ filePath, io = filesystem }) { if (!path.isAbsolute(filePath ?? "")) throw new Error("Transaction journal requires an absolute path"); this.filePath = filePath; this.io = io; }
  async snapshot() { return (await this.#read()).records; }
  async #read() {
    let handle;
    try {
      handle = await this.io.open(this.filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 1024 * 1024 || (process.platform !== "win32" && (stat.mode & 0o077) !== 0)) throw invalid();
      const data = JSON.parse(await handle.readFile("utf8"));
      if (!data || Object.keys(data).sort().join() !== "records,rejections,schemaVersion" || data.schemaVersion !== 1 || !Array.isArray(data.records) || !Array.isArray(data.rejections) || data.records.length > 1024 || data.rejections.length > 1024) throw invalid();
      data.records.forEach(validateIntent);
      for (const entry of data.rejections) { if (!entry || Object.keys(entry).sort().join() !== "intent,proof") throw invalid(); validateIntent(entry.intent); validateRejection(entry.proof); if (entry.intent.attempts !== 1) throw invalid(); }
      if (new Set(data.records.map(record => record.hash)).size !== data.records.length || new Set(data.records.map(record => record.account)).size !== data.records.length) throw invalid();
      return structuredClone(data);
    } catch (error) { if (error?.code === "ENOENT") return { schemaVersion: 1, records: [], rejections: [] }; throw invalid(); }
    finally { await handle?.close(); }
  }
  async add(intent, { retry = false } = {}) {
    validateIntent({ ...intent, attempts: 1 });
    return this.#mutate(async () => {
      const state = await this.#read(), prior = state.records.find(item => item.account === intent.account);
      if (prior) {
        const { attempts, ...original } = prior;
        if (!retry || capabilityFingerprint(original) !== capabilityFingerprint(intent)) throw capabilityError("TRANSACTION_RESOLUTION_REQUIRED", "A previous transaction for this account is still unresolved.");
        if (attempts >= Number.MAX_SAFE_INTEGER) throw invalid();
        prior.attempts++;
      } else {
        if (retry) throw invalid();
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
      state.records = state.records.filter(item => item.hash !== hash);
      state.rejections.push({ intent, proof });
      await this.#write(state);
    });
  }
  async resolve(hash, account, receipt) {
    return this.#mutate(async () => {
      const state = await this.#read(), record = state.records.find(item => item.hash === hash);
      if (!record || record.account !== account) throw invalid();
      assertIntentReceipt(record, receipt);
      state.records = state.records.filter(item => item.hash !== hash);
      await this.#write(state);
    });
  }
  #mutate(action) { const result = this.#mutations.then(action); this.#mutations = result.catch(() => {}); return result; }
  async #write(state) {
    const directory = path.dirname(this.filePath), temporary = `${this.filePath}.${randomUUID()}.tmp`;
    let file, dir;
    try {
      if (state.records.length > 1024 || state.rejections.length > 1024) throw invalid();
      const encoded = `${JSON.stringify(state)}\n`;
      if (Buffer.byteLength(encoded) > 1024 * 1024) throw invalid();
      await this.io.mkdir(directory, { recursive: true, mode: 0o700 });
      file = await this.io.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      await file.writeFile(encoded, "utf8");
      await file.sync(); await file.close(); file = null;
      await this.io.rename(temporary, this.filePath);
      dir = await this.io.open(directory, constants.O_RDONLY); await dir.sync();
    } catch {
      throw capabilityError("TRANSACTION_JOURNAL_WRITE_FAILED", "The transaction journal could not be saved durably. No new broadcast may start; preserve any existing unresolved entry.");
    } finally { await file?.close(); await dir?.close(); await this.io.unlink(temporary).catch(() => {}); }
  }
}
