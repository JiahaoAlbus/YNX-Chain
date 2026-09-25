import { Transaction, formatEther } from "ethers";
import { assertSameCapabilities, assertCompatibleIntentCapabilities, capabilityError } from "./rpc-capabilities.mjs";
import { parseDurabilityModel, parseDurabilityProof, validateDurableReceipt } from "./transaction-durability.mjs";
import { CANONICAL_RPC_URL } from "./rpc.mjs";

const HASH = /^0x[0-9a-f]{64}$/;
const failure = (code, message, data = {}) => Object.assign(capabilityError(code, message), { data: { code, ...data } });

// V2 stores exact signed bytes in the private local journal before any POST.
// Neither public UI rows nor errors expose those replayable bytes.
export class TransactionSubmissions {
  #records = new Map();
  #busy = new Set();
  constructor({ provider, capabilities, verifyChain, intentStore }) { this.provider = provider; this.capabilities = capabilities; this.verifyChain = verifyChain; this.intentStore = intentStore; }
  async #intents() {
    if (!this.intentStore) throw failure("TRANSACTION_JOURNAL_UNAVAILABLE", "A durable transaction journal is required before signing or broadcasting.");
    return this.intentStore.snapshot();
  }
  async list(account) {
    return (await this.#intents()).filter(record => record.account === account).map(record => ({ hash: record.hash, account, status: this.#records.get(record.hash)?.status ?? "uncertain", canRetryExact: Boolean(record.raw ?? this.#records.get(record.hash)?.raw), to: record.to, amount: formatEther(record.value) }));
  }
  async assertResolved(account) {
    const record = (await this.#intents()).find(item => item.account === account);
    if (record) throw failure("TRANSACTION_RESOLUTION_REQUIRED", "A previous transaction's outcome is unconfirmed. Check its hash or retry the identical signed transaction before creating another transfer.", { outcomeUnknown: true, transactionHash: record.hash });
  }
  async submit(raw, transaction, capabilities, guard) {
    const hash = Transaction.from(raw).hash;
    const record = { hash, raw, transaction, account: transaction.from, capabilities, status: "broadcasting" };
    return this.#exclusive(record.account, () => this.#broadcast(record, guard, false));
  }
  async #exclusive(account, action) {
    if (this.#busy.has(account)) throw failure("TRANSACTION_CHECK_IN_PROGRESS", "This account already has a transaction submission or receipt check in progress.");
    this.#busy.add(account);
    try { return await action(); } finally { this.#busy.delete(account); }
  }
  async #broadcast(record, guard, retry) {
    const intent = { account: record.account, chainId: record.transaction.chainId, nonce: record.transaction.nonce, hash: record.hash, to: record.transaction.to, value: record.transaction.value, capabilities: record.capabilities, raw: record.raw, origin: CANONICAL_RPC_URL };
    // Persist intent before entering the outward-effect boundary. A crash or
    // lock after this write still leaves a conservative unresolved marker.
    await this.intentStore.add(intent, { retry });
    this.#records.set(record.hash, record);
    await this.verifyChain();
    assertSameCapabilities(record.capabilities, await this.capabilities());
    await this.verifyChain();
    let started = false;
    const send = async () => {
      started = true;
      record.status = "broadcasting";
      const hash = await this.provider.send("eth_sendRawTransaction", [record.raw]);
      if (typeof hash !== "string" || hash.toLowerCase() !== record.hash) throw failure("TRANSACTION_HASH_MISMATCH", "The network returned a hash different from the signed transaction.");
      if (!["confirmed", "failed"].includes(record.status)) record.status = "submitted";
      return record.hash;
    };
    try { return guard?.submit ? await guard.submit(send) : await send(); }
    catch (error) {
      if (!started) { record.status = "uncertain"; throw error; }
      if (["confirmed", "failed"].includes(record.status)) return record.hash;
      if (!retry && error?.data?.rpcCode === -32003 && error.data.rpcResponse === true && error.data.rpcHttpSuccess === true && error.data.rpcDefiniteRejection === true) {
        await this.intentStore.reject(record.hash, record.account, error.data);
        this.#records.delete(record.hash);
        throw error;
      }
      record.status = "uncertain";
      const rpc = error?.data?.rpcResponse ? error.data : {};
      throw Object.assign(failure(rpc.code === "TRANSACTION_DURABILITY_UNCERTAIN" ? rpc.code : "EXTERNAL_OUTCOME_UNKNOWN", "Transaction submission is unconfirmed. Check this hash or explicitly retry the same signed bytes; do not create a new transaction.", { ...rpc, code: rpc.code === "TRANSACTION_DURABILITY_UNCERTAIN" ? rpc.code : "EXTERNAL_OUTCOME_UNKNOWN", outcomeUnknown: true, transactionHash: record.hash, ...(rpc.transactionHash && rpc.transactionHash !== record.hash ? { reportedTransactionHash: rpc.transactionHash } : {}) }), { code: -32002 });
    }
  }
  async check(hash, account) {
    return this.#exclusive(account, () => this.#check(hash, account));
  }
  async #check(hash, account) {
    if (!HASH.test(hash) || typeof account !== "string") throw failure("INVALID_TRANSACTION_HASH", "Enter a valid transaction hash.");
    const intent = (await this.#intents()).find(record => record.hash === hash);
    const historical = !intent && this.intentStore.resolutions ? (await this.intentStore.resolutions()).find(entry => entry.intent.hash === hash) : null;
    const boundIntent = intent ?? historical?.intent, record = this.#records.get(hash);
    if ((intent && intent.account !== account) || (record && record.account !== account)) throw failure("ACCOUNT_CHANGED", "Select the account that submitted this transaction.");
    if (!boundIntent || boundIntent.account !== account) throw failure("TRANSACTION_INTENT_REQUIRED", "A matching local signed intent is required to verify this transaction's amount, fee and nonce.");
    await this.verifyChain();
    const capabilities = await this.capabilities();
    parseDurabilityModel(capabilities.durability);
    assertCompatibleIntentCapabilities(boundIntent.capabilities, capabilities);
    let receipt, state;
    try { receipt = await this.provider.send("eth_getTransactionReceipt", [hash]); }
    catch (error) {
      const proof = error?.data?.ynxDurability;
      if (!proof || error.data.transactionHash !== hash || !["uncertain", "memory_only"].includes(proof.status)) throw error;
      state = parseDurabilityProof(proof, hash);
    }
    if (receipt === null) state = parseDurabilityProof(await this.provider.send("ynx_getTransactionDurability", [hash]), hash);
    assertSameCapabilities(capabilities, await this.capabilities());
    await this.verifyChain();
    if (state) return { hash, account, status: state.status === "pending_durable" ? "pending_durable" : "uncertain", durabilityStatus: state.status, confirmed: false, consensusFinality: false, canRetryExact: Boolean(intent?.raw ?? record?.raw) };
    const evidence = validateDurableReceipt(boundIntent, receipt, capabilities), fee = BigInt(evidence.ynxFeeWei);
    if (intent) await this.intentStore.resolve(hash, account, evidence, capabilities);
    if (record) { record.status = receipt.status === "0x1" ? "confirmed" : "failed"; record.raw = null; }
    return { hash, account, status: receipt.status === "0x1" ? "confirmed" : "failed", confirmed: true, successful: receipt.status === "0x1", actualFee: formatEther(fee), blockNumber: receipt.blockNumber, confirmationScope: "local-snapshot", consensusFinality: false, canRetryExact: false };
  }
  async retry(hash, account, guard) {
    return this.#exclusive(account, () => this.#retry(hash, account, guard));
  }
  async #retry(hash, account, guard) {
    guard.assert();
    if (guard.account !== account) throw failure("ACCOUNT_CHANGED", "Unlock the account that signed these exact bytes.");
    let record = this.#records.get(hash);
    if (!record) {
      const intent = (await this.#intents()).find(item => item.hash === hash && item.account === account);
      if (intent?.raw) { record = { hash, raw: intent.raw, account, transaction: { ...intent, from: account }, capabilities: intent.capabilities, status: "uncertain" }; this.#records.set(hash, record); }
    }
    if (!record || record.account !== account || !record.raw) throw failure("EXACT_RETRY_UNAVAILABLE", "The original signed bytes are unavailable for this account. Check the transaction hash; do not recreate its signature.");
    const status = await this.#check(hash, account);
    guard.assert();
    if (status.confirmed) return status;
    await this.verifyChain();
    assertSameCapabilities(record.capabilities, await this.capabilities());
    guard.assert();
    return { hash: await this.#broadcast(record, guard, true), account, status: "submitted", confirmed: false, retriedExactBytes: true };
  }
}
