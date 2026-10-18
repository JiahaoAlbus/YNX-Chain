import { evmAddressFromYNX, ynxAddressFromEVM } from "@ynx-chain/wallet-auth";
import { randomUUID } from "node:crypto";
import { Wallet, formatEther, getAddress, parseEther, toQuantity } from "ethers";
import { CANONICAL_RPC_URL } from "./rpc.mjs";
import { providerError } from "./desktop-wallet-vault.mjs";
import { assertSameCapabilities, capabilityError, parseFeeModel, requireTransactionCapabilities } from "./rpc-capabilities.mjs";
import { rpcResponseError } from "./rpc-errors.mjs";
import { parseDurabilityModel } from "./transaction-durability.mjs";

const CHAIN_ID = "0x1917";
const REVIEW_TTL = 120_000;
const quantity = value => typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value);

export class CanonicalAccountNetwork {
  #sequence = 0;
  constructor({ fetchImpl = globalThis.fetch } = {}) { this.fetchImpl = fetchImpl; }
  async request(method, params = []) {
    try {
      const id = ++this.#sequence;
      const response = await this.fetchImpl(CANONICAL_RPC_URL, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        redirect: "error", signal: AbortSignal.timeout(10_000)
      });
      // Fetch serializes an origin's root URL with '/'. Accept only those two
      // fixed spellings of the same resource, never another path or redirect.
      if (response.redirected || response.url && response.url !== CANONICAL_RPC_URL && response.url !== CANONICAL_RPC_URL + "/") throw providerError(4900, "RPC_INVALID_RESPONSE", "The RPC response origin changed.");
      const payload = await response.json();
      if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.jsonrpc !== "2.0" || payload.id !== id || Object.hasOwn(payload, "result") === Object.hasOwn(payload, "error")) throw providerError(4900, "RPC_INVALID_RESPONSE", "YNX Testnet returned an invalid response");
      if (Object.hasOwn(payload, "error")) {
        if (!payload.error || typeof payload.error !== "object" || Array.isArray(payload.error) || !Number.isSafeInteger(payload.error.code) || typeof payload.error.message !== "string") throw providerError(4900, "RPC_INVALID_RESPONSE", "YNX Testnet returned an invalid RPC error");
        throw rpcResponseError(payload.error);
      }
      if (!response.ok) throw providerError(4900, "RPC_UNAVAILABLE", "YNX Testnet is unavailable. Try again shortly.");
      if (!("result" in payload)) throw providerError(4900, "RPC_INVALID_RESPONSE", "YNX Testnet returned an invalid response");
      return payload.result;
    } catch (error) {
      if (error?.data?.code) throw error;
      const timedOut = ["AbortError", "TimeoutError"].includes(error?.name);
      throw providerError(4900, timedOut ? "RPC_TIMEOUT" : "RPC_UNAVAILABLE", timedOut ? "The network check timed out. Please try again." : "Unable to reach YNX Testnet. Check your connection and try again.");
    }
  }
  async verifyChain() {
    if (await this.request("eth_chainId") !== CHAIN_ID) throw providerError(4901, "RPC_CHAIN_MISMATCH", "The network is not YNX Testnet. No transaction was signed.");
  }
  async balance(account) {
    const snapshot = await this.balanceSnapshot(account);
    requireTransactionCapabilities(snapshot.capabilities);
    return snapshot.raw;
  }
  async capabilities() {
    try {
      const model = parseFeeModel(await this.request("ynx_getFeeModel"));
      if (model.durability) {
        let advertised;
        try { advertised = await this.request("ynx_getDurabilityModel"); }
        catch (cause) {
          // Network/protocol failures are not evidence of an unsupported
          // contract. Preserve the exact first cause and do not retry it.
          if (cause?.data?.rpcCode !== -32601) throw cause;
          throw Object.assign(capabilityError("RPC_DURABILITY_UNSUPPORTED", "The node's explicit local durability model could not be verified."), { cause });
        }
        try { parseDurabilityModel(advertised); }
        catch (cause) { throw Object.assign(capabilityError("RPC_DURABILITY_UNSUPPORTED", "The node's explicit local durability model could not be verified."), { cause }); }
      }
      return model;
    }
    catch (error) {
      if (error?.data?.rpcCode === -32601) throw capabilityError("RPC_CAPABILITIES_UNKNOWN", "The network does not expose its amount units. Balance conversion and Ethereum transactions are unavailable until its capabilities can be verified.");
      throw error;
    }
  }
  async balanceSnapshot(account) {
    await this.verifyChain();
    const capabilities = await this.capabilities();
    const value = await this.request("eth_getBalance", [getAddress(account).toLowerCase(), "latest"]);
    if (!quantity(value)) throw providerError(4900, "RPC_INVALID_BALANCE", "The network returned an invalid balance");
    assertSameCapabilities(capabilities, await this.capabilities());
    await this.verifyChain();
    return { raw: value, unit: capabilities.unit, formatted: capabilities.unit === "wei" ? formatEther(value) : BigInt(value).toString(), capabilities };
  }
  async estimate(transaction) {
    await this.verifyChain();
    const capabilities = await this.capabilities();
    requireTransactionCapabilities(capabilities);
    let gas, gasPrice;
    try { [gas, gasPrice] = await Promise.all([this.request("eth_estimateGas", [transaction]), this.request("eth_gasPrice")]); }
    catch (error) { if (error?.data?.rpcCode === -32601) throw capabilityError("RPC_FEE_UNAVAILABLE", "The network fee methods are unavailable. Nothing was signed."); throw error; }
    if (!quantity(gas) || !quantity(gasPrice) || BigInt(gas) < 21_000n || BigInt(gasPrice) <= 0n) throw providerError(4900, "RPC_INVALID_FEE", "The network could not estimate a valid transaction fee");
    assertSameCapabilities(capabilities, await this.capabilities());
    await this.verifyChain();
    if (!capabilities.fullEVM && (gas !== capabilities.gas || gasPrice !== capabilities.gasPrice)) throw capabilityError("RPC_FIXED_FEE_MISMATCH", "The network fee differs from its verified native-transfer model.");
    return { gasLimit: toQuantity((BigInt(gas) * 120n + 99n) / 100n), gasPrice };
  }
}

export class NativeWalletService {
  constructor({ vault, network = new CanonicalAccountNetwork(), sender, clock = () => Date.now(), requestId = randomUUID, onTransferAttempt = () => {} }) {
    this.vault = vault; this.network = network; this.sender = sender; this.clock = clock; this.requestId = requestId;
    this.pending = new Map();
    this.attemptSequence=0;this.attempts=new Map();this.onTransferAttempt=onTransferAttempt;
  }
  clear() { this.pending.clear(); }
  beginTransferAttempt(id, action) {
    const review=this.pending.get(id);
    if(action!=="approve"||!review||this.attempts.get(id)?.state==="in-progress")return null;
    const record={attempt:++this.attemptSequence,account:review.account,startedAt:this.clock(),updatedAt:this.clock(),stage:"approval-gate",state:"in-progress",code:null,hash:null};
    this.attempts.set(id,record);
    while(this.attempts.size>32)this.attempts.delete(this.attempts.keys().next().value);
    this.publishTransferAttempt(record);return record;
  }
  transferAttempts(account) { return [...this.attempts.values()].filter(record=>record.account===account).map(record=>Object.freeze({...record})); }
  publishTransferAttempt(record) { try { this.onTransferAttempt(Object.freeze({...record})); } catch {} }
  transferStage(id,stage) {const record=this.attempts.get(id);if(record?.state==="in-progress"){record.stage=stage;record.updatedAt=this.clock();this.publishTransferAttempt(record)}}
  finishTransferAttempt(record,result) {
    if(!record||![...this.attempts.values()].includes(record))return;
    const hash=result?.ok===true&&result.value?.hash;
    if(typeof hash==="string"&&/^0x[0-9a-f]{64}$/.test(hash)){record.state="submitted";record.hash=hash;record.code=null}
    else {
      const code=result?.error?.data?.code??result?.error?.code;
      record.code=["WALLET_LOCKED","WALLET_OPERATION_CANCELLED","WALLET_OPERATION_BUSY","REQUEST_EXPIRED","UNKNOWN_OR_EXPIRED_REQUEST","ACCOUNT_CHANGED","RPC_CHAIN_MISMATCH","TRANSACTION_RESOLUTION_REQUIRED","EXTERNAL_OUTCOME_UNKNOWN","RPC_TRANSACTION_REJECTED"].includes(code)?code:"TRANSFER_FAILED";
      // Before entering sender.send there is no signing or outward submission.
      // Once the sender is entered, its original journal/receipt owns the answer.
      record.state=record.stage==="submitting"?"result-unconfirmed":record.stage==="approval-gate"?"rejected-before-key-access":"rejected-before-submission";
    }
    record.updatedAt=this.clock();this.publishTransferAttempt(record);
  }
  async balance() {
    const status = await this.vault.status();
    if (!status.initialized) throw providerError(4100, "ACCOUNT_NOT_CREATED", "Create or import an account first");
    const snapshot = await this.network.balanceSnapshot(status.account);
    return { account: status.account, raw: snapshot.raw, wei: snapshot.unit === "wei" ? snapshot.raw : null, unit: snapshot.unit, formatted: snapshot.formatted, transferEnabled: snapshot.capabilities.enabled && (snapshot.capabilities.fullEVM === true || Boolean(snapshot.capabilities.durability)), capabilityVersion: snapshot.capabilities.version, durabilityVersion: snapshot.capabilities.durability?.version ?? null, symbol: "YNXT", chainId: CHAIN_ID, checkedAt: new Date(this.clock()).toISOString() };
  }
  async prepareTransfer({ to, amount } = {}) {
    this.pending.clear();
    let recipient, value;
    try {
      recipient = typeof to === "string" && to.startsWith("ynx1") ? evmAddressFromYNX(to) : getAddress(to).toLowerCase();
      if (recipient === "0x0000000000000000000000000000000000000000" || typeof amount !== "string" || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(amount) || amount.length > 80) throw new Error();
      value = parseEther(amount);
      if (value <= 0n) throw new Error();
    } catch { throw providerError(-32602, "INVALID_TRANSFER", "Enter a valid nonzero recipient and a positive YNXT amount with up to 18 decimals"); }
    const status = await this.vault.status();
    if (!status.initialized) throw providerError(4100, "ACCOUNT_NOT_CREATED", "Create or import an account first");
    const tx = { from: status.account, to: recipient, value: toQuantity(value), chainId: CHAIN_ID };
    const capabilities = await this.network.capabilities();
    requireTransactionCapabilities(capabilities);
    // This UI creates a fresh plain transfer. A verified fixed-fee adapter
    // needs its exact gas quote, not execution-estimation headroom. Existing
    // caller-supplied transaction snapshots and budgets are never rewritten.
    if (!capabilities.fullEVM) tx.gas = capabilities.gas;
    const balance = BigInt(await this.network.balance(status.account));
    if (balance < value) throw providerError(-32000, "INSUFFICIENT_FUNDS", "Insufficient YNXT for this amount. Add Testnet funds before sending.");
    if (typeof this.sender?.prepare !== "function") throw providerError(4200, "TRANSACTION_TRANSPORT_UNAVAILABLE", "Canonical transaction preparation is unavailable");
    const snapshot = await this.sender.prepare(status.account, tx);
    if ((await this.vault.status()).account !== status.account) throw providerError(4100, "ACCOUNT_CHANGED", "The selected account changed. Prepare the transfer again.");
    const maximumFee = BigInt(snapshot.gasLimit) * BigInt(snapshot.gasPrice ?? snapshot.maxFeePerGas);
    if (balance < value + maximumFee) throw providerError(-32000, "INSUFFICIENT_FUNDS", "Insufficient YNXT to cover the amount and network fee");
    this.vault.authorization?.current().assert();
    const id = this.requestId(), createdAt = this.clock();
    const record = Object.freeze({ id, account: status.account, transaction: snapshot, createdAt });
    this.pending.clear();
    this.pending.set(id, record);
    return { id, account: status.account, to: recipient, ynxFrom: ynxAddressFromEVM(status.account), ynxTo: ynxAddressFromEVM(recipient), amount: formatEther(value), ...this.sender.reviewDetails?.(snapshot), maximumFee: formatEther(maximumFee), total: formatEther(value + maximumFee), symbol: "YNXT", chainId: CHAIN_ID, transaction: snapshot, expiresAt: new Date(createdAt + REVIEW_TTL).toISOString() };
  }
  async transferAction(id, action) {
    this.transferStage(id,"review-check");
    if (!["approve", "reject"].includes(action)) throw providerError(-32602, "INVALID_TRANSFER_ACTION", "Choose approve or reject");
    const request = this.pending.get(id);
    this.pending.delete(id);
    if (!request) throw providerError(4100, "UNKNOWN_OR_EXPIRED_REQUEST", "Prepare the transfer again before confirming");
    if (action === "reject") return { rejected: true, transactionCreated: false };
    if (this.clock() - request.createdAt >= REVIEW_TTL) throw providerError(4100, "REQUEST_EXPIRED", "The transfer review expired. Check the current fee and try again.");
    const status = await this.vault.status();
    if (status.account !== request.account) throw providerError(4100, "ACCOUNT_CHANGED", "The selected account changed. Review the transfer again.");
    this.transferStage(id,"verifying-network");
    await this.network.verifyChain();
    this.transferStage(id,"key-access");
    const hash = await this.vault.withSecret(async (secret, identity, guard) => {
      if (identity.account !== request.account) throw providerError(4100, "ACCOUNT_CHANGED", "The selected account changed");
      this.transferStage(id,"submitting");
      return this.sender.send(new Wallet(`0x${secret}`), request.transaction, guard);
    });
    return { hash, status: "submitted", confirmed: false, account: request.account, to: request.transaction.to, amount: formatEther(request.transaction.value) };
  }
}
